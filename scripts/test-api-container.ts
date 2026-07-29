import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const ISSUER = "https://container-fixture.example/student/v2.0";
const AUDIENCE = "api://ap2-container-fixture";
const KEY_ID = "container-fixture-key";
const UNSAFE_SENTINEL = "unsafe-private-marker@example.test";
const image = `ap2-api-container-test:${process.pid}`;
const container = `ap2-api-container-test-${process.pid}`;

async function main(): Promise<void> {
  const availability = spawnSync("podman", ["info", "--format", "{{.Version.Version}}"], {
    encoding: "utf8",
  });
  if (availability.status !== 0) {
    const detail = (availability.stderr || availability.stdout || "Podman is unavailable").trim();
    console.log(`Container test skipped: ${detail}`);
    return;
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwksServer = createJwksServer(publicKey);
  const jwksPort = await listen(jwksServer);
  const apiPort = await reservePort();
  let containerCreated = false;

  try {
    runPodman(["build", "--format", "docker", "--tag", image, "."], "inherit");
    verifyHeadlessChromium();
    runPodman([
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
      image,
    ]);
    containerCreated = true;

    const baseUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealthy(baseUrl);
    await expectStatus(`${baseUrl}/health`, undefined, 200);
    await expectStatus(`${baseUrl}/api/whoami`, undefined, 401);
    const delegatedProductToken = fixtureToken(privateKey, {
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
      scp: REQUIRED_DELEGATED_SCOPE,
    });
    const delegatedCbaToken = fixtureToken(privateKey, {
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
      scp: REQUIRED_DELEGATED_SCOPE,
    });
    const applicationToken = fixtureToken(privateKey, {
      tid: STUDENT_TENANT_ID,
      idtyp: "app",
      azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
      roles: [REQUIRED_APPLICATION_ROLE],
    });
    const wrongTenantToken = fixtureToken(privateKey, {
      tid: "another-tenant",
      oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
      scp: REQUIRED_DELEGATED_SCOPE,
    });
    const unknownUserToken = fixtureToken(privateKey, {
      tid: STUDENT_TENANT_ID,
      oid: "unknown-user",
      scp: REQUIRED_DELEGATED_SCOPE,
    });
    await expectStatus(
      `${baseUrl}/api/whoami`,
      delegatedProductToken,
      200,
      "delegated",
    );
    await expectStatus(
      `${baseUrl}/api/whoami`,
      delegatedCbaToken,
      200,
      "delegated",
    );
    await expectStatus(
      `${baseUrl}/api/whoami`,
      applicationToken,
      200,
      "app-only",
    );
    await expectStatus(
      `${baseUrl}/api/whoami`,
      wrongTenantToken,
      403,
    );
    await expectStatus(
      `${baseUrl}/api/whoami`,
      unknownUserToken,
      403,
    );
    await expectRequestStatus(`${baseUrl}/api/scenario-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${delegatedProductToken}`,
        "Content-Type": "text/plain",
      },
      body: UNSAFE_SENTINEL,
    }, 415);
    await expectRequestStatus(`${baseUrl}/api/scenario-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${delegatedProductToken}`,
        "Content-Type": "application/json",
      },
      body: `{${UNSAFE_SENTINEL}`,
    }, 400);
    await expectRequestStatus(`${baseUrl}/api/scenario-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${delegatedProductToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        value: `${UNSAFE_SENTINEL}${"x".repeat(8_192)}`,
      }),
    }, 413);
    await expectRequestStatus(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Origin: `https://${UNSAFE_SENTINEL}` },
    }, 403);

    runPodman(["stop", "--time", "5", container]);
    const exitCode = runPodman(["inspect", "--format", "{{.State.ExitCode}}", container]);
    const logs = runPodman(["logs", container]);
    if (
      exitCode.trim() !== "0" ||
      !logs.includes('"event":"api_lifecycle","state":"draining"') ||
      !logs.includes('"event":"api_lifecycle","state":"stopped"')
    ) {
      throw new Error(`Container did not shut down cleanly (exit ${exitCode.trim()})`);
    }
    verifyStructuredLogs(logs, [
      delegatedProductToken,
      delegatedCbaToken,
      applicationToken,
      wrongTenantToken,
      unknownUserToken,
    ]);
    runPodman(["rm", container]);
    containerCreated = false;
    console.log(
      "Container build, health/auth/validation/mutation-refusal telemetry, redaction, and clean shutdown passed",
    );
  } finally {
    if (containerCreated) {
      spawnSync("podman", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], { encoding: "utf8" });
    await close(jwksServer);
  }
}

function verifyHeadlessChromium(): void {
  const proof = [
    "import { chromium } from 'playwright';",
    "const browser = await chromium.launch({ headless: true });",
    "const context = await browser.newContext();",
    "const page = await context.newPage();",
    "await page.setContent('<title>AP2 browser proof</title>');",
    "if ((await page.title()) !== 'AP2 browser proof') process.exitCode = 1;",
    "await context.close();",
    "await browser.close();",
  ].join(" ");
  runPodman([
    "run",
    "--rm",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--tmpfs",
    "/tmp:rw,size=256m",
    image,
    "node",
    "--input-type=module",
    "--eval",
    proof,
  ]);
}

function createJwksServer(publicKey: KeyObject): Server {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  return createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" }] }));
  });
}

async function waitForHealthy(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        runPodman(["healthcheck", "run", container]);
        const health = runPodman([
          "inspect",
          "--format",
          "{{.State.Health.Status}}",
          container,
        ]);
        if (health.trim() === "healthy") {
          return;
        }
      }
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Container did not become healthy:\n${runPodman(["logs", container])}`);
}

async function expectStatus(
  url: string,
  token: string | undefined,
  expectedStatus: number,
  expectedCallerType?: string,
): Promise<void> {
  const response = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus} from ${url}, received ${response.status}`);
  }
  if (expectedCallerType) {
    const body = (await response.json()) as { callerType?: string };
    if (body.callerType !== expectedCallerType) {
      throw new Error(`Expected ${expectedCallerType} caller, received ${body.callerType ?? "none"}`);
    }
  }
}

async function expectRequestStatus(
  url: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<void> {
  const response = await fetch(url, init);
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus} from ${url}, received ${response.status}`);
  }
}

function verifyStructuredLogs(logs: string, tokens: readonly string[]): void {
  const records = logs
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new Error("Production container emitted a non-JSON log record");
      }
    });
  const requests = records.filter(({ event }) => event === "api_request");
  const lifecycle = records.filter(({ event }) => event === "api_lifecycle");
  if (requests.length < 11) {
    throw new Error(`Expected at least 11 request records, received ${requests.length}`);
  }
  const correlationIds = new Set<string>();
  for (const record of requests) {
    const keys = Object.keys(record).sort();
    const expectedKeys = [
      "authorization",
      "correlationId",
      "durationMs",
      "event",
      "outcome",
      "routeOwner",
      "schemaVersion",
      "sideEffect",
      "status",
    ];
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      throw new Error("Request telemetry emitted keys outside its fixed schema");
    }
    if (
      record.schemaVersion !== 1 ||
      typeof record.correlationId !== "string" ||
      !/^r1_[0-9a-f]{24}$/.test(record.correlationId) ||
      typeof record.durationMs !== "number" ||
      record.durationMs < 0 ||
      record.durationMs > 60_000
    ) {
      throw new Error("Request telemetry emitted an invalid bounded value");
    }
    if (correlationIds.has(record.correlationId)) {
      throw new Error("Request telemetry reused a correlation identifier");
    }
    correlationIds.add(record.correlationId);
  }
  expectSignature(requests, "whoami", "pure", 200, 3);
  expectSignature(requests, "whoami", "pure", 401, 1);
  expectSignature(requests, "whoami", "pure", 403, 2);
  expectSignature(requests, "scenario-plan-compile", "pure", 415, 1);
  expectSignature(requests, "scenario-plan-compile", "pure", 400, 1);
  expectSignature(requests, "scenario-plan-compile", "pure", 413, 1);
  expectSignature(requests, "simulated-email-send", "bounded-mutation", 403, 1);
  if (!requests.some(({ routeOwner, status }) => routeOwner === "health" && status === 200)) {
    throw new Error("Health request telemetry was not emitted");
  }
  for (const expected of [
    { state: "ready" },
    { state: "draining", signal: "SIGTERM" },
    { state: "stopped", reason: "drained" },
  ]) {
    if (!lifecycle.some((record) =>
      Object.entries(expected).every(([key, value]) => record[key] === value)
    )) {
      throw new Error(`Missing lifecycle telemetry state ${expected.state}`);
    }
  }
  for (const unsafe of [
    UNSAFE_SENTINEL,
    ...tokens,
    STUDENT_TENANT_ID,
    STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
    STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  ]) {
    if (logs.includes(unsafe)) {
      throw new Error("Production telemetry exposed an unsafe request value");
    }
  }
}

function expectSignature(
  records: readonly Record<string, unknown>[],
  routeOwner: string,
  sideEffect: string,
  status: number,
  expectedCount: number,
): void {
  const actual = records.filter((record) =>
    record.routeOwner === routeOwner &&
    record.sideEffect === sideEffect &&
    record.status === status
  ).length;
  if (actual !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} ${routeOwner}/${sideEffect}/${status} records, received ${actual}`,
    );
  }
}

function fixtureToken(privateKey: KeyObject, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" })).toString(
    "base64url",
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ iss: ISSUER, aud: AUDIENCE, nbf: now - 5, exp: now + 300, ...claims }),
  ).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString(
    "base64url",
  );
  return `${header}.${payload}.${signature}`;
}

function runPodman(args: string[], stdio: "pipe" | "inherit" = "pipe"): string {
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
    throw new Error("Fixture server did not bind a TCP port");
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
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
