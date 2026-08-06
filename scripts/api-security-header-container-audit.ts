import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const ORIGIN = "http://localhost:5173";
const ISSUER = "https://api-header-audit.example/student/v2.0";
const AUDIENCE = "api://ap2-header-audit";
const KEY_ID = "api-header-audit-key";
const image = `ap2-api-header-audit:${process.pid}`;
const container = `ap2-api-header-audit-${process.pid}`;
const HEADER_NAMES = [
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "cache-control",
  "content-security-policy",
  "content-type",
  "referrer-policy",
  "vary",
  "x-content-type-options",
  "x-frame-options",
] as const;

interface Observation {
  status: number;
  bodyBytes: number;
  headers: Record<string, string | null>;
}

async function main(): Promise<void> {
  const availability = spawnSync(
    "podman",
    ["info", "--format", "{{.Version.Version}}"],
    { encoding: "utf8" },
  );
  if (availability.status !== 0) {
    throw new Error("Podman is required for the API header audit.");
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
  });
  const jwks = createJwksServer(publicKey);
  const jwksPort = await listen(jwks);
  const apiPort = await reservePort();
  let created = false;
  try {
    run(["build", "--format", "docker", "--tag", image, "."], "inherit");
    run([
      "run",
      "--detach",
      "--name",
      container,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--publish",
      `127.0.0.1:${apiPort}:3000`,
      "--env",
      `AUTH_ISSUER=${ISSUER}`,
      "--env",
      `AUTH_AUDIENCE=${AUDIENCE}`,
      "--env",
      `AUTH_JWKS_URL=http://host.containers.internal:${jwksPort}/jwks`,
      "--env",
      "AUTH_ALLOW_INSECURE_JWKS=true",
      "--env",
      `CORS_ALLOWED_ORIGIN=${ORIGIN}`,
      image,
    ]);
    created = true;
    const base = `http://127.0.0.1:${apiPort}`;
    await waitForHealth(base);
    const token = fixtureToken(privateKey);
    const authorization = { Authorization: `Bearer ${token}` };
    const matrix: Record<string, Observation> = {};
    matrix.health = await observe(`${base}/health`);
    matrix.hostSpoof = await observe(`${base}/health`, {
      headers: {
        Host: "untrusted.example",
        "X-Forwarded-Host": "public.example",
        "X-Forwarded-Proto": "https",
      },
    });
    matrix.preflight = await observe(`${base}/api/sharepoint-trusted-version-lifecycle`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });
    matrix.preflightRejected = await observe(`${base}/api/sharepoint-trusted-version-lifecycle`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "Authorization, Content-Type, X-Extra",
      },
    });
    matrix.originRejectedBeforeAuth = await observe(
      `${base}/api/sharepoint-trusted-version-lifecycle`,
      {
        method: "POST",
        headers: {
          Origin: "https://unconfigured.example",
          "Content-Type": "application/json",
        },
        body: "{",
      },
    );
    matrix.authRefusal = await observe(`${base}/api/whoami`, {
      headers: { Origin: ORIGIN },
    });
    matrix.pureSuccess = await observe(`${base}/api/whoami`, {
      headers: { ...authorization, Origin: ORIGIN },
    });
    matrix.validationRefusal = await observe(`${base}/api/sharepoint-trusted-version-lifecycle`, {
      method: "POST",
      headers: {
        ...authorization,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    matrix.sizeRefusal = await observe(`${base}/api/sharepoint-trusted-version-lifecycle`, {
      method: "POST",
      headers: {
        ...authorization,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "x".repeat(512) }),
    });
    matrix.mutationBoundary = await observe(`${base}/api/simulated-email`, {
      method: "POST",
      headers: { ...authorization, Origin: ORIGIN },
    });
    matrix.notFound = await observe(`${base}/not-found`, {
      headers: { Origin: ORIGIN },
    });
    assertMatrix(matrix);
    console.log(JSON.stringify({
      schemaVersion: 1,
      label: "API_SECURITY_HEADER_AUDIT",
      status: "pass",
      matrix,
    }, null, 2));
  } finally {
    if (created) {
      spawnSync("podman", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], {
      encoding: "utf8",
    });
    await close(jwks);
  }
}

function assertMatrix(matrix: Record<string, Observation>): void {
  const expectedStatuses: Record<string, number> = {
    health: 200,
    hostSpoof: 200,
    preflight: 204,
    preflightRejected: 403,
    originRejectedBeforeAuth: 403,
    authRefusal: 401,
    pureSuccess: 200,
    validationRefusal: 400,
    sizeRefusal: 413,
    mutationBoundary: 500,
    notFound: 404,
  };
  if (
    Object.keys(matrix).length !== Object.keys(expectedStatuses).length ||
    Object.entries(expectedStatuses).some(([name, status]) =>
      matrix[name]?.status !== status
    )
  ) {
    throw new Error("The API status matrix drifted.");
  }
  for (const [name, observation] of Object.entries(matrix)) {
    const headers = observation.headers;
    if (
      headers["cache-control"] !== "no-store" ||
      headers["content-security-policy"] !==
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" ||
      headers["referrer-policy"] !== "no-referrer" ||
      headers["x-content-type-options"] !== "nosniff" ||
      headers["x-frame-options"] !== "DENY" ||
      headers["access-control-allow-credentials"] !== null
    ) {
      throw new Error(`Fixed security headers drifted for ${name}.`);
    }
    if (
      name === "preflight"
        ? observation.bodyBytes !== 0 || headers["content-type"] !== null
        : headers["content-type"] !== "application/json; charset=utf-8"
    ) {
      throw new Error(`Response body contract drifted for ${name}.`);
    }
  }
  const corsCases = [
    "preflight",
    "preflightRejected",
    "authRefusal",
    "pureSuccess",
    "validationRefusal",
    "sizeRefusal",
    "mutationBoundary",
    "notFound",
  ];
  for (const name of corsCases) {
    if (
      matrix[name]?.headers["access-control-allow-origin"] !== ORIGIN ||
      matrix[name]?.headers.vary !== "Origin"
    ) {
      throw new Error(`Allowed-origin CORS drifted for ${name}.`);
    }
  }
  for (
    const name of ["health", "hostSpoof", "originRejectedBeforeAuth"]
  ) {
    if (
      matrix[name]?.headers["access-control-allow-origin"] !== null ||
      matrix[name]?.headers.vary !== null
    ) {
      throw new Error(`Disallowed CORS headers appeared for ${name}.`);
    }
  }
  const preflight = matrix.preflight?.headers;
  if (
    preflight?.["access-control-allow-methods"] !== "POST" ||
    preflight["access-control-allow-headers"] !==
      "Authorization, Content-Type"
  ) {
    throw new Error("The bounded preflight contract drifted.");
  }
  for (const [name, observation] of Object.entries(matrix)) {
    if (
      name !== "preflight" &&
      (observation.headers["access-control-allow-methods"] !== null ||
        observation.headers["access-control-allow-headers"] !== null)
    ) {
      throw new Error(`Preflight permission headers leaked to ${name}.`);
    }
  }
}

async function observe(url: string, init?: RequestInit): Promise<Observation> {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
  });
  const body = await response.arrayBuffer();
  return {
    status: response.status,
    bodyBytes: body.byteLength,
    headers: Object.fromEntries(
      HEADER_NAMES.map((name) => [name, response.headers.get(name)]),
    ),
  };
}

function createJwksServer(publicKey: KeyObject): Server {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  return createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" }],
    }));
  });
}

function fixtureToken(privateKey: KeyObject): string {
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    kid: KEY_ID,
    typ: "JWT",
  })).toString("base64url");
  const now = Math.floor(Date.now() / 1_000);
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    nbf: now - 5,
    exp: now + 300,
    tid: STUDENT_TENANT_ID,
    oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
    scp: REQUIRED_DELEGATED_SCOPE,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function waitForHealth(base: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Startup has a finite retry window.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API did not become ready:\n${run(["logs", container])}`);
}

function run(
  args: string[],
  stdio: "pipe" | "inherit" = "pipe",
): string {
  if (stdio === "inherit") {
    execFileSync("podman", args, { stdio: "inherit" });
    return "";
  }
  return execFileSync("podman", args, { encoding: "utf8" });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("Fixture server did not bind.");
  }
  return address.port;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
