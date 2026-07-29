import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const ISSUER = "https://container-fixture.example/help-desk-rehearsal/v2.0";
const AUDIENCE = "api://help-desk-rehearsal-container-fixture";
const KEY_ID = "help-desk-rehearsal-container-fixture-key";
const image = `ap2-help-desk-rehearsal:${process.pid}`;
const container = `ap2-help-desk-rehearsal-${process.pid}`;

async function main(): Promise<void> {
  const availability = spawnSync(
    "podman",
    ["info", "--format", "{{.Version.Version}}"],
    { encoding: "utf8" },
  );
  if (availability.status !== 0) {
    throw new Error("Podman is unavailable for the required container proof.");
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwksServer = createJwksServer(publicKey);
  const jwksPort = await listen(jwksServer);
  const apiPort = await reservePort();
  let containerCreated = false;
  try {
    runPodman(["build", "--format", "docker", "--tag", image, "."]);
    runPodman([
      "run", "--detach", "--name", container, "--read-only",
      "--cap-drop", "ALL", "--publish", `127.0.0.1:${apiPort}:3000`,
      "--env", `AUTH_ISSUER=${ISSUER}`,
      "--env", `AUTH_AUDIENCE=${AUDIENCE}`,
      "--env", `AUTH_JWKS_URL=http://host.containers.internal:${jwksPort}/jwks`,
      "--env", "AUTH_ALLOW_INSECURE_JWKS=true",
      image,
    ]);
    containerCreated = true;

    const baseUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealthy(baseUrl);
    const output = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json",
    ), "utf8"));
    const response = await fetch(
      `${baseUrl}/api/help-desk-email-rehearsal-verification`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fixtureToken(privateKey)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(output),
      },
    );
    if (response.status !== 200) {
      throw new Error(`Container verification returned HTTP ${response.status}.`);
    }
    const result = await response.json() as Record<string, unknown>;
    if (
      result.label !== "REHEARSAL_ONLY_VERIFIED" ||
      result.status !== "verified" ||
      result.scenarioId !== "help-desk-email-observation" ||
      result.syntheticBranch !== "learner-observed-cleaned" ||
      result.externalEvidence !== "all-uninspected" ||
      result.claimCount !== 15
    ) {
      throw new Error("Container returned an invalid verification summary.");
    }

    runPodman(["stop", "--time", "5", container]);
    const exitCode = runPodman([
      "inspect", "--format", "{{.State.ExitCode}}", container,
    ]);
    if (exitCode.trim() !== "0") {
      throw new Error(`Container exited with ${exitCode.trim()}.`);
    }
    runPodman(["rm", container]);
    containerCreated = false;
    console.log("Production container signed-auth help-desk proof passed");
  } finally {
    if (containerCreated) {
      spawnSync("podman", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], {
      encoding: "utf8",
    });
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
    response.end(JSON.stringify({
      keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" }],
    }));
  });
}

async function waitForHealthy(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The local container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Container did not become healthy:\n${runPodman([
    "logs", container,
  ])}`);
}

function fixtureToken(privateKey: KeyObject): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }),
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
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

function runPodman(args: string[]): string {
  return execFileSync("podman", args, { encoding: "utf8" });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("Fixture server did not bind a TCP port.");
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
