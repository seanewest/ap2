import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const ISSUER = "https://api-lifecycle.example/student/v2.0";
const AUDIENCE = "api://ap2-lifecycle-fixture";
const KEY_ID = "api-lifecycle-key";
const image = `ap2-api-lifecycle-test:${process.pid}`;
const primaryContainer = `ap2-api-lifecycle-term-${process.pid}`;
const interruptContainer = `ap2-api-lifecycle-int-${process.pid}`;
const failedContainer = `ap2-api-lifecycle-failed-${process.pid}`;
const listenerFailedContainer =
  `ap2-api-lifecycle-listener-failed-${process.pid}`;

async function main(): Promise<void> {
  const availability = spawnSync(
    "podman",
    ["info", "--format", "{{.Version.Version}}"],
    { encoding: "utf8" },
  );
  if (availability.status !== 0) {
    const detail = (
      availability.stderr ||
      availability.stdout ||
      "Podman is unavailable"
    ).trim();
    console.log(`Container lifecycle test skipped: ${detail}`);
    return;
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
  });
  const controlledJwks = createControlledJwksServer(publicKey);
  const jwksPort = await listen(controlledJwks.server);
  const timings: Record<string, number> = {};

  try {
    runPodman(["build", "--format", "docker", "--tag", image, "."], "inherit");

    const failedStartedAt = performance.now();
    runPodman(["run", "--detach", "--name", failedContainer, image]);
    const failedExit = waitForContainer(failedContainer);
    timings.startupFailureMs = elapsed(failedStartedAt);
    const failedLogs = containerLogs(failedContainer);
    if (
      failedExit === 0 ||
      !hasLifecycleEvent(failedLogs, {
        state: "startup-failed",
        reason: "configuration",
      }) ||
      failedLogs.includes("AUTH_ISSUER") ||
      failedLogs.includes("/app/")
    ) {
      throw new Error("Invalid configuration did not fail startup categorically");
    }
    runPodman(["rm", failedContainer]);

    const listenerFailedStartedAt = performance.now();
    runPodman([
      "run",
      "--detach",
      "--name",
      listenerFailedContainer,
      "--env",
      "HOST=invalid host fixture",
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
    const listenerFailedExit = waitForContainer(listenerFailedContainer);
    timings.listenerFailureMs = elapsed(listenerFailedStartedAt);
    const listenerFailedLogs = containerLogs(listenerFailedContainer);
    if (
      listenerFailedExit === 0 ||
      !hasLifecycleEvent(listenerFailedLogs, {
        state: "startup-failed",
        reason: "listener",
      }) ||
      listenerFailedLogs.includes("ENOTFOUND") ||
      listenerFailedLogs.includes("getaddrinfo") ||
      listenerFailedLogs.includes("/app/")
    ) {
      throw new Error("Invalid listener did not fail startup categorically");
    }
    runPodman(["rm", listenerFailedContainer]);

    const primaryPort = await reservePort();
    const primaryStartedAt = performance.now();
    startConfiguredContainer(primaryContainer, primaryPort, jwksPort);
    await waitForHealthy(primaryContainer, primaryPort);
    timings.readyMs = elapsed(primaryStartedAt);

    const token = fixtureToken(privateKey);
    const socket = connect(primaryPort, "127.0.0.1");
    socket.setEncoding("utf8");
    let received = "";
    socket.on("data", (chunk: string) => {
      received += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      [
        "GET /api/whoami HTTP/1.1",
        `Host: 127.0.0.1:${primaryPort}`,
        `Authorization: Bearer ${token}`,
        "Connection: keep-alive",
        "",
        "",
      ].join("\r\n"),
    );
    await withTimeout(
      controlledJwks.requested,
      5_000,
      "The in-flight pure request never reached token verification",
    );

    const termStartedAt = performance.now();
    runPodman(["kill", "--signal", "TERM", primaryContainer]);
    await waitForLog(
      primaryContainer,
      '"state":"draining","signal":"SIGTERM"',
    );
    await expectNotReady(primaryPort);
    socket.write(
      [
        "POST /api/simulated-email HTTP/1.1",
        `Host: 127.0.0.1:${primaryPort}`,
        `Authorization: Bearer ${token}`,
        "Content-Length: 0",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    controlledJwks.release();
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.once("end", resolve);
        socket.once("close", resolve);
        socket.once("error", reject);
      }),
      5_000,
      "The draining keep-alive connection did not close",
    );
    const primaryExit = waitForContainer(primaryContainer);
    timings.sigtermDrainMs = elapsed(termStartedAt);
    const primaryLogs = containerLogs(primaryContainer);
    if (
      primaryExit !== 0 ||
      !hasLifecycleEvent(primaryLogs, {
        state: "draining",
        signal: "SIGTERM",
      }) ||
      !hasLifecycleEvent(primaryLogs, {
        state: "stopped",
        reason: "drained",
      }) ||
      !hasJsonEvent(primaryLogs, {
        event: "api_request",
        routeOwner: "simulated-email-send",
        sideEffect: "bounded-mutation",
        status: 503,
        outcome: "shutdown-refused",
      })
    ) {
      throw new Error(`SIGTERM shutdown was not clean (exit ${primaryExit})`);
    }
    assertDrainedResponses(received);
    runPodman(["rm", primaryContainer]);

    const interruptPort = await reservePort();
    startConfiguredContainer(interruptContainer, interruptPort, jwksPort);
    await waitForHealthy(interruptContainer, interruptPort);
    const interruptStartedAt = performance.now();
    runPodman(["kill", "--signal", "INT", interruptContainer]);
    const interruptExit = waitForContainer(interruptContainer);
    timings.sigintExitMs = elapsed(interruptStartedAt);
    const interruptLogs = containerLogs(interruptContainer);
    if (
      interruptExit !== 0 ||
      !hasLifecycleEvent(interruptLogs, {
        state: "draining",
        signal: "SIGINT",
      }) ||
      !hasLifecycleEvent(interruptLogs, {
        state: "stopped",
        reason: "drained",
      })
    ) {
      throw new Error(`SIGINT shutdown was not clean (exit ${interruptExit})`);
    }
    runPodman(["rm", interruptContainer]);
  } finally {
    for (const name of [
      primaryContainer,
      interruptContainer,
      failedContainer,
      listenerFailedContainer,
    ]) {
      spawnSync("podman", ["rm", "--force", name], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], {
      encoding: "utf8",
    });
    await close(controlledJwks.server);
  }

  for (const name of [
    primaryContainer,
    interruptContainer,
    failedContainer,
    listenerFailedContainer,
  ]) {
    if (spawnSync("podman", ["container", "exists", name]).status === 0) {
      throw new Error(`Lifecycle test left container residue: ${name}`);
    }
  }
  if (spawnSync("podman", ["image", "exists", image]).status === 0) {
    throw new Error(`Lifecycle test left image residue: ${image}`);
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    label: "API_CONTAINER_LIFECYCLE",
    status: "pass",
    ...timings,
    inFlightPureRequest: "drained",
    shutdownAdmission: "refused",
    residue: "absent",
  }));
}

function startConfiguredContainer(
  name: string,
  apiPort: number,
  jwksPort: number,
): void {
  runPodman([
    "run",
    "--detach",
    "--name",
    name,
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
}

function createControlledJwksServer(publicKey: KeyObject): {
  server: Server;
  requested: Promise<void>;
  release(): void;
} {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  let markRequested!: () => void;
  let release!: () => void;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer(async (request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    markRequested();
    await gate;
    sendJwks(response, jwk);
  });
  return { server, requested, release };
}

function sendJwks(response: ServerResponse, jwk: JsonWebKey): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" }],
  }));
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

function assertDrainedResponses(received: string): void {
  const normalized = received.toLowerCase();
  const fixedHeaders = [
    "cache-control: no-store",
    "content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy: no-referrer",
    "x-content-type-options: nosniff",
    "x-frame-options: deny",
  ];
  const statuses = [...received.matchAll(/HTTP\/1\.1 (\d{3})/g)]
    .map((match) => Number(match[1]));
  if (
    statuses.length !== 2 ||
    statuses[0] !== 200 ||
    statuses[1] !== 503 ||
    !received.includes('"error":"server_shutting_down"') ||
    received.includes("simulated_email_not_configured") ||
    fixedHeaders.some((header) => count(normalized, header) !== 2)
  ) {
    throw new Error(
      `Shutdown admitted a pipelined mutation or lost the pure request: ${statuses.join(",")}`,
    );
  }
}

function count(value: string, expected: string): number {
  return value.split(expected).length - 1;
}

async function expectNotReady(port: number): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.ok) {
      throw new Error("Health remained ready after shutdown began");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Health remained ready after shutdown began"
    ) {
      throw error;
    }
  }
}

async function waitForHealthy(container: string, port: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        runPodman(["healthcheck", "run", container]);
        const health = runPodman([
          "inspect",
          "--format",
          "{{.State.Health.Status}}",
          container,
        ]).trim();
        if (health === "healthy") return;
      }
    } catch {
      // Startup has a finite retry window below.
    }
    await delay(250);
  }
  throw new Error(`Container did not become ready:\n${containerLogs(container)}`);
}

async function waitForLog(container: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (containerLogs(container).includes(expected)) return;
    await delay(25);
  }
  throw new Error(`Container never logged ${expected}`);
}

function waitForContainer(container: string): number {
  const result = spawnSync("podman", ["wait", container], {
    encoding: "utf8",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
      result.stderr.trim() ||
      `Container ${container} did not exit within the bounded wait`,
    );
  }
  const exitCode = Number(result.stdout.trim());
  if (!Number.isInteger(exitCode)) {
    throw new Error(`Container ${container} returned an invalid exit status`);
  }
  return exitCode;
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
    server.close((error) => error ? reject(error) : resolve());
  });
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

function containerLogs(container: string): string {
  const result = spawnSync("podman", ["logs", container], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `Could not read ${container} logs`)
        .trim(),
    );
  }
  return `${result.stdout}${result.stderr}`;
}

function hasLifecycleEvent(
  logs: string,
  expected: Readonly<Record<string, string>>,
): boolean {
  return hasJsonEvent(logs, {
    event: "api_lifecycle",
    ...expected,
  });
}

function hasJsonEvent(
  logs: string,
  expected: Readonly<Record<string, string | number>>,
): boolean {
  return logs.split("\n").some((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      return (
        value.schemaVersion === 1 &&
        Object.entries(expected).every(([key, item]) => value[key] === item)
      );
    } catch {
      return false;
    }
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), milliseconds).unref();
    }),
  ]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
