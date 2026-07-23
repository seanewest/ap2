import { execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  AFTER_PARTY_CLIENT_ID,
  DEVELOPMENT_AUTOMATION_CLIENT_ID as AUTOMATION_CLIENT_ID,
  REQUIRED_APPLICATION_ROLE,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const ISSUER = `https://login.microsoftonline.com/${STUDENT_TENANT_ID}/v2.0`;
const JWKS_URL =
  `https://login.microsoftonline.com/${STUDENT_TENANT_ID}` +
  "/discovery/v2.0/keys";
const image = `ap2-api-real-token-test:${process.pid}`;
const container = `ap2-api-real-token-test-${process.pid}`;

interface TokenClaims {
  iss?: unknown;
  aud?: unknown;
  tid?: unknown;
  azp?: unknown;
  idtyp?: unknown;
  roles?: unknown;
  ver?: unknown;
  azpacr?: unknown;
  scp?: unknown;
}

async function main(): Promise<void> {
  ensureIsolatedAzureConfig();
  const certificatePath = secureCertificatePath();
  assertRootlessPodman();
  loginWithCertificate(certificatePath);
  const token = acquireAndAssertToken();

  const apiPort = await reservePort();
  let containerCreated = false;
  try {
    runPodman(["build", "--format", "docker", "--tag", image, "."], "inherit");
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
      `AUTH_AUDIENCE=${AFTER_PARTY_CLIENT_ID}`,
      "--env",
      `AUTH_JWKS_URL=${JWKS_URL}`,
      image,
    ]);
    containerCreated = true;

    const baseUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealthy(baseUrl);
    const health = await fetch(`${baseUrl}/health`);
    if (health.status !== 200) {
      throw new Error(`Expected health status 200, received ${health.status}`);
    }

    const protectedResponse = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (protectedResponse.status !== 200) {
      throw new Error(
        `Expected protected status 200, received ${protectedResponse.status}`,
      );
    }
    const body = (await protectedResponse.json()) as {
      callerType?: unknown;
      clientId?: unknown;
      tenantId?: unknown;
    };
    if (
      body.callerType !== "app-only" ||
      body.clientId !== AUTOMATION_CLIENT_ID ||
      body.tenantId !== STUDENT_TENANT_ID
    ) {
      throw new Error("Protected endpoint returned an unexpected caller");
    }

    runPodman(["stop", "--time", "5", container]);
    const exitCode = runPodman([
      "inspect",
      "--format",
      "{{.State.ExitCode}}",
      container,
    ]).trim();
    const logs = runPodman(["logs", container]);
    if (exitCode !== "0" || !logs.includes("Received SIGTERM; shutting down")) {
      throw new Error(`Container did not shut down cleanly (exit ${exitCode})`);
    }
    runPodman(["rm", container]);
    containerCreated = false;
    console.log(
      "Real certificate token passed health, authorization, and clean shutdown",
    );
  } finally {
    if (containerCreated) {
      spawnSync("podman", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], {
      encoding: "utf8",
    });
  }
}

function loginWithCertificate(certificatePath: string): void {
  execFileSync(
    "az",
    [
      "login",
      "--service-principal",
      "--username",
      AUTOMATION_CLIENT_ID,
      "--tenant",
      STUDENT_TENANT_ID,
      "--certificate",
      certificatePath,
      "--allow-no-subscriptions",
      "--output",
      "none",
      "--only-show-errors",
    ],
    { env: process.env, stdio: "inherit" },
  );
}

function acquireAndAssertToken(): string {
  const account = JSON.parse(
    execFileSync(
      "az",
      ["account", "show", "--output", "json", "--only-show-errors"],
      { encoding: "utf8", env: process.env },
    ),
  ) as { tenantId?: unknown };
  if (account.tenantId !== STUDENT_TENANT_ID) {
    throw new Error("Isolated Azure account tenant assertion failed");
  }

  const response = JSON.parse(
    execFileSync(
      "az",
      [
        "account",
        "get-access-token",
        "--scope",
        `api://${AFTER_PARTY_CLIENT_ID}/.default`,
        "--output",
        "json",
        "--only-show-errors",
      ],
      { encoding: "utf8", env: process.env },
    ),
  ) as { accessToken?: unknown };
  if (typeof response.accessToken !== "string") {
    throw new Error("Azure CLI returned no API access token");
  }

  const claims = decodeClaims(response.accessToken);
  if (
    claims.iss !== ISSUER ||
    claims.aud !== AFTER_PARTY_CLIENT_ID ||
    claims.tid !== STUDENT_TENANT_ID ||
    claims.azp !== AUTOMATION_CLIENT_ID ||
    claims.idtyp !== "app" ||
    claims.ver !== "2.0" ||
    claims.azpacr !== "2" ||
    claims.scp !== undefined ||
    !Array.isArray(claims.roles) ||
    !claims.roles.includes(REQUIRED_APPLICATION_ROLE)
  ) {
    throw new Error("Real app-only token claims do not match the API policy");
  }

  console.log(
    JSON.stringify(
      {
        iss: claims.iss,
        aud: claims.aud,
        tid: claims.tid,
        azp: claims.azp,
        idtyp: claims.idtyp,
        roles: claims.roles,
        ver: claims.ver,
        azpacr: claims.azpacr,
      },
      null,
      2,
    ),
  );
  return response.accessToken;
}

function decodeClaims(token: string): TokenClaims {
  const payload = token.split(".")[1];
  if (!payload) {
    throw new Error("Azure CLI returned a non-JWT token");
  }
  const value: unknown = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Token claims are not a JSON object");
  }
  return value as TokenClaims;
}

function ensureIsolatedAzureConfig(): void {
  const configured = process.env.AZURE_CONFIG_DIR;
  if (!configured) {
    throw new Error("AZURE_CONFIG_DIR must point to an isolated CLI context");
  }
  if (
    realpathSync(configured) ===
    realpathSync(resolve(process.env.HOME ?? "", ".azure"))
  ) {
    throw new Error("Refusing to use the normal Azure CLI context");
  }
}

function secureCertificatePath(): string {
  const configured = process.env.AP2_AUTOMATION_CERTIFICATE_PATH;
  if (!configured) {
    throw new Error("AP2_AUTOMATION_CERTIFICATE_PATH is required");
  }
  const path = realpathSync(configured);
  if ((statSync(path).mode & 0o077) !== 0) {
    throw new Error(
      "Automation certificate must not be accessible by group or others",
    );
  }
  return path;
}

function assertRootlessPodman(): void {
  const info = JSON.parse(
    execFileSync("podman", ["info", "--format", "json"], {
      encoding: "utf8",
    }),
  ) as {
    host?: { security?: { rootless?: unknown } };
    store?: { graphDriverName?: unknown };
  };
  if (
    info.host?.security?.rootless !== true ||
    info.store?.graphDriverName !== "overlay"
  ) {
    throw new Error("Podman must use rootless overlay storage");
  }
}

async function waitForHealthy(baseUrl: string): Promise<void> {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      const health = runPodman([
        "inspect",
        "--format",
        "{{.State.Health.Status}}",
        container,
      ]).trim();
      if (response.ok && health === "healthy") {
        return;
      }
    } catch {
      // The bounded startup check retries while Podman starts the container.
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 500),
    );
  }
  throw new Error(
    `Container did not become healthy:\n${runPodman(["logs", container])}`,
  );
}

function runPodman(
  args: string[],
  stdio: "pipe" | "inherit" = "pipe",
): string {
  if (stdio === "inherit") {
    execFileSync("podman", args, { stdio: "inherit" });
    return "";
  }
  return execFileSync("podman", args, { encoding: "utf8" });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await listen(server);
  const address = server.address();
  if (typeof address !== "object" || !address) {
    throw new Error("Port reservation did not bind TCP");
  }
  const port = address.port;
  await close(server);
  return port;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
