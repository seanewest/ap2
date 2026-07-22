import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server } from "node:http";
const ISSUER = "https://container-fixture.example/student/v2.0";
const AUDIENCE = "api://ap2-container-fixture";
const KEY_ID = "container-fixture-key";
const STUDENT_TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const STUDENT_OPERATOR_OBJECT_ID = "ba97e987-da4c-43e1-ab79-3daa8014440e";
const DEVELOPMENT_AUTOMATION_CLIENT_ID = "7eb78f18-b49c-495c-a571-af03f06b58a9";
const image = `ap2-api-container-test:${process.pid}`;
const container = `ap2-api-container-test-${process.pid}`;

async function main(): Promise<void> {
  const availability = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
  });
  if (availability.status !== 0) {
    const detail = (availability.stderr || availability.stdout || "Docker is unavailable").trim();
    console.log(`Container test skipped: ${detail}`);
    return;
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwksServer = createJwksServer(publicKey);
  const jwksPort = await listen(jwksServer);
  const apiPort = await reservePort();
  let containerCreated = false;

  try {
    runDocker(["build", "--tag", image, "."], "inherit");
    runDocker([
      "run",
      "--detach",
      "--name",
      container,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--publish",
      `127.0.0.1:${apiPort}:3000`,
      "--env",
      `AUTH_ISSUER=${ISSUER}`,
      "--env",
      `AUTH_AUDIENCE=${AUDIENCE}`,
      "--env",
      `AUTH_JWKS_URL=http://host.docker.internal:${jwksPort}/jwks`,
      "--env",
      "AUTH_ALLOW_INSECURE_JWKS=true",
      image,
    ]);
    containerCreated = true;

    const baseUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealthy(baseUrl);
    await expectStatus(`${baseUrl}/health`, undefined, 200);
    await expectStatus(
      `${baseUrl}/api/whoami`,
      fixtureToken(privateKey, {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_OPERATOR_OBJECT_ID,
        scp: "access_as_user",
      }),
      200,
      "delegated",
    );
    await expectStatus(
      `${baseUrl}/api/whoami`,
      fixtureToken(privateKey, {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: ["Api.Access"],
      }),
      200,
      "app-only",
    );
    await expectStatus(
      `${baseUrl}/api/whoami`,
      fixtureToken(privateKey, {
        tid: "another-tenant",
        oid: STUDENT_OPERATOR_OBJECT_ID,
        scp: "access_as_user",
      }),
      403,
    );

    runDocker(["stop", "--time", "5", container]);
    const exitCode = runDocker(["inspect", "--format", "{{.State.ExitCode}}", container]);
    const logs = runDocker(["logs", container]);
    if (exitCode.trim() !== "0" || !logs.includes("Received SIGTERM; shutting down")) {
      throw new Error(`Container did not shut down cleanly (exit ${exitCode.trim()})`);
    }
    runDocker(["rm", container]);
    containerCreated = false;
    console.log("Container build, health, authorization, and clean shutdown passed");
  } finally {
    if (containerCreated) {
      spawnSync("docker", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("docker", ["image", "rm", "--force", image], { encoding: "utf8" });
    await close(jwksServer);
  }
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
      const health = runDocker(["inspect", "--format", "{{.State.Health.Status}}", container]);
      if (response.ok && health.trim() === "healthy") {
        return;
      }
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Container did not become healthy:\n${runDocker(["logs", container])}`);
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

function runDocker(args: string[], stdio: "pipe" | "inherit" = "pipe"): string {
  if (stdio === "inherit") {
    execFileSync("docker", args, { stdio: "inherit" });
    return "";
  }
  return execFileSync("docker", args, { encoding: "utf8" });
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
