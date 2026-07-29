import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";
import { API_PROCESS_ADMISSION_LIMITS } from "../api/process-admission.ts";

const ISSUER = "https://api-backpressure.example/student/v2.0";
const AUDIENCE = "api://ap2-backpressure-fixture";
const KEY_ID = "api-backpressure-key";
const image = `ap2-api-backpressure-test:${process.pid}`;
const container = `ap2-api-backpressure-${process.pid}`;
const HEALTH_BURST = 32;
const AUTH_REFUSAL_BURST = 32;
const OVERSIZED_BURST = 8;
const MAX_BURST_LATENCY_MS = 5_000;
const MAX_PEAK_RSS_GROWTH_KIB = 64 * 1_024;
const MAX_CPU_TICK_GROWTH = 1_000;
const REQUEST_RECEIVE_TIMEOUT_MS = 15_000;

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
    console.log(`Container backpressure test skipped: ${detail}`);
    return;
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
  });
  const jwks = controlledJwks(publicKey);
  const jwksPort = await listen(jwks.server);
  const apiPort = await reservePort();
  let created = false;

  try {
    runPodman([
      "build",
      "--network",
      "none",
      "--format",
      "docker",
      "--tag",
      image,
      ".",
    ], "inherit");
    startContainer(apiPort, jwksPort);
    created = true;
    const baseUrl = `http://127.0.0.1:${apiPort}`;
    await waitForHealthy(baseUrl);
    const token = fixtureToken(privateKey);
    const baseline = processSample(container);

    const firstMutation = fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    await withTimeout(
      jwks.requested,
      3_000,
      "Mutation did not reach the controlled authentication boundary",
    );
    const mutationRefusal = await timedFetch(
      `${baseUrl}/api/simulated-email`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    await assertResponse(
      mutationRefusal.response,
      503,
      "process_capacity_exceeded",
    );
    jwks.release();
    const firstMutationResponse = await withTimeout(
      firstMutation,
      3_000,
      "Admitted mutation did not finish after authentication release",
    );
    await assertResponse(firstMutationResponse, 500, "internal_server_error");

    const health = await burst(
      HEALTH_BURST,
      () => fetch(`${baseUrl}/health`),
      200,
      "ok",
    );
    const authRefusal = await burst(
      AUTH_REFUSAL_BURST,
      () => fetch(`${baseUrl}/api/whoami`),
      401,
      "unauthorized",
    );
    const oversized = await burst(
      OVERSIZED_BURST,
      () => fetch(`${baseUrl}/api/scenario-plan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "x".repeat(8_193),
      }),
      413,
      "request_too_large",
    );

    const held = await Promise.all(
      Array.from(
        { length: API_PROCESS_ADMISSION_LIMITS.purePerRoute },
        () => openPartialJson(apiPort, token),
      ),
    );
    await delay(250);
    const pureRefusal = await timedFetch(`${baseUrl}/api/scenario-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    await assertResponse(
      pureRefusal.response,
      503,
      "process_capacity_exceeded",
    );
    const peak = processSample(container);
    held.forEach((socket) => socket.destroy());
    await delay(250);
    const released = await timedFetch(`${baseUrl}/api/scenario-plan`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (released.response.status !== 400) {
      throw new Error(
        `Released pure capacity returned ${released.response.status}`,
      );
    }

    const timedOut = await openPartialJson(apiPort, token);
    const timeoutResponse = await collectSocket(
      timedOut,
      REQUEST_RECEIVE_TIMEOUT_MS + 2_000,
      "Held request did not reach the fixed receive timeout",
    );
    if (!timeoutResponse.includes("HTTP/1.1 408")) {
      throw new Error("Held request did not receive fixed HTTP 408");
    }

    const after = processSample(container);
    const peakRssKiB = Math.max(peak.rssKiB, after.rssKiB);
    const peakRssGrowthKiB = Math.max(0, peakRssKiB - baseline.rssKiB);
    const settledRssGrowthKiB = Math.max(0, after.rssKiB - baseline.rssKiB);
    const cpuTickGrowth = Math.max(0, after.cpuTicks - baseline.cpuTicks);
    if (
      peakRssGrowthKiB > MAX_PEAK_RSS_GROWTH_KIB ||
      cpuTickGrowth > MAX_CPU_TICK_GROWTH
    ) {
      throw new Error("Bounded burst exceeded the fixed local resource ceiling");
    }

    const draining = await openPartialJson(apiPort, token);
    await delay(250);
    runPodman(["kill", "--signal", "TERM", container]);
    await waitForLog(
      container,
      '"state":"draining","signal":"SIGTERM"',
    );
    const shutdownResponse = await finishAndPipelineHealth(
      draining,
      apiPort,
    );
    if (
      !shutdownResponse.includes("HTTP/1.1 400") ||
      !shutdownResponse.includes("HTTP/1.1 503") ||
      !shutdownResponse.includes("server_shutting_down")
    ) {
      throw new Error("Shutdown did not drain admitted work and refuse follow-up");
    }
    const exitCode = waitForContainer(container);
    if (exitCode !== 0) {
      throw new Error(`Backpressure container exited ${exitCode}`);
    }
    runPodman(["rm", container]);
    created = false;

    console.log(JSON.stringify({
      schemaVersion: 1,
      label: "API_PROCESS_BACKPRESSURE",
      status: "pass",
      scope: "one-process-one-replica",
      ceilings: {
        control: API_PROCESS_ADMISSION_LIMITS.control,
        operatorTotal: API_PROCESS_ADMISSION_LIMITS.operatorTotal,
        purePerRoute: API_PROCESS_ADMISSION_LIMITS.purePerRoute,
        readOnlyExternalPerRoute:
          API_PROCESS_ADMISSION_LIMITS.readOnlyExternalPerRoute,
        boundedMutationPerRoute:
          API_PROCESS_ADMISSION_LIMITS.boundedMutationPerRoute,
        requestTimeoutMs: REQUEST_RECEIVE_TIMEOUT_MS,
      },
      matrix: {
        health: {
          requests: HEALTH_BURST,
          status: 200,
          maxLatencyMs: health,
        },
        authRefusal: {
          requests: AUTH_REFUSAL_BURST,
          status: 401,
          maxLatencyMs: authRefusal,
        },
        boundedMutation: {
          admitted: 1,
          refused: 1,
          refusalStatus: 503,
          queued: 0,
          retried: 0,
        },
        pure: {
          held: API_PROCESS_ADMISSION_LIMITS.purePerRoute,
          refused: 1,
          refusalStatus: 503,
          released: true,
          refusalLatencyMs: pureRefusal.elapsedMs,
        },
        oversized: {
          requests: OVERSIZED_BURST,
          status: 413,
          maxLatencyMs: oversized,
        },
        receiveTimeout: { status: 408 },
        shutdown: {
          admittedRequest: "drained",
          followUp: "refused",
          status: 503,
          exitCode,
        },
      },
      resources: {
        rssBaselineKiB: baseline.rssKiB,
        rssPeakKiB: peakRssKiB,
        rssSettledKiB: after.rssKiB,
        peakRssGrowthKiB,
        settledRssGrowthKiB,
        cpuTickGrowth,
      },
      residue: "absent",
    }));
  } finally {
    if (created) {
      spawnSync("podman", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], {
      encoding: "utf8",
    });
    await close(jwks.server);
  }

  if (spawnSync("podman", ["container", "exists", container]).status === 0) {
    throw new Error("Backpressure test left container residue");
  }
  if (spawnSync("podman", ["image", "exists", image]).status === 0) {
    throw new Error("Backpressure test left image residue");
  }
}

function startContainer(apiPort: number, jwksPort: number): void {
  runPodman([
    "run",
    "--detach",
    "--name",
    container,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "--pids-limit",
    "128",
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

function controlledJwks(publicKey: KeyObject): {
  server: Server;
  requested: Promise<void>;
  release(): void;
} {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  let requested!: () => void;
  let release!: () => void;
  const requestedPromise = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer(async (request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404).end();
      return;
    }
    requested();
    await gate;
    sendJwks(response, jwk);
  });
  return { server, requested: requestedPromise, release };
}

function sendJwks(response: ServerResponse, jwk: JsonWebKey): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    keys: [{ ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" }],
  }));
}

async function burst(
  count: number,
  request: () => Promise<Response>,
  expectedStatus: number,
  expectedErrorOrStatus: string,
): Promise<number> {
  const started = performance.now();
  const responses = await withTimeout(
    Promise.all(Array.from({ length: count }, request)),
    MAX_BURST_LATENCY_MS,
    "Bounded burst exceeded its latency ceiling",
  );
  const elapsedMs = elapsed(started);
  for (const response of responses) {
    if (response.status !== expectedStatus) {
      throw new Error(
        `Burst expected ${expectedStatus}, received ${response.status}`,
      );
    }
    const body = await response.json() as {
      error?: string;
      status?: string;
    };
    if (
      body.error !== expectedErrorOrStatus &&
      body.status !== expectedErrorOrStatus
    ) {
      throw new Error("Burst returned an unexpected categorical body");
    }
  }
  return elapsedMs;
}

async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; elapsedMs: number }> {
  const started = performance.now();
  const response = await withTimeout(
    fetch(url, init),
    MAX_BURST_LATENCY_MS,
    "Bounded request exceeded its latency ceiling",
  );
  return { response, elapsedMs: elapsed(started) };
}

async function assertResponse(
  response: Response,
  status: number,
  error: string,
): Promise<void> {
  if (response.status !== status) {
    throw new Error(`Expected ${status}, received ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { error?: string }).error !== error
  ) {
    throw new Error(`Expected categorical error ${error}`);
  }
}

async function openPartialJson(apiPort: number, token: string): Promise<Socket> {
  const socket = connect(apiPort, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    "POST /api/scenario-plan HTTP/1.1",
    `Host: 127.0.0.1:${apiPort}`,
    `Authorization: Bearer ${token}`,
    "Content-Type: application/json",
    "Content-Length: 2",
    "Connection: keep-alive",
    "",
    "{",
  ].join("\r\n"));
  return socket;
}

async function finishAndPipelineHealth(
  socket: Socket,
  apiPort: number,
): Promise<string> {
  const collected = collectSocket(
    socket,
    5_000,
    "Draining connection did not close",
  );
  socket.write([
    "}",
    "GET /health HTTP/1.1",
    `Host: 127.0.0.1:${apiPort}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  return collected;
}

async function collectSocket(
  socket: Socket,
  timeoutMs: number,
  message: string,
): Promise<string> {
  socket.setEncoding("utf8");
  let received = "";
  socket.on("data", (chunk: string) => {
    received += chunk;
  });
  await withTimeout(new Promise<void>((resolve, reject) => {
    socket.once("end", resolve);
    socket.once("close", resolve);
    socket.once("error", reject);
  }), timeoutMs, message);
  return received;
}

function processSample(name: string): { rssKiB: number; cpuTicks: number } {
  const pid = Number(runPodman([
    "inspect",
    "--format",
    "{{.State.Pid}}",
    name,
  ]).trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Container process ID was unavailable");
  }
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const rss = /^VmRSS:\s+([0-9]+)\s+kB$/m.exec(status);
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!rss || !Number.isFinite(userTicks) || !Number.isFinite(systemTicks)) {
    throw new Error("Container resource sample was malformed");
  }
  return {
    rssKiB: Number(rss[1]),
    cpuTicks: userTicks + systemTicks,
  };
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

async function waitForHealthy(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The bounded local container may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Container did not become healthy:\n${containerLogs(container)}`);
}

async function waitForLog(name: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (containerLogs(name).includes(text)) return;
    await delay(100);
  }
  throw new Error(`Container log did not contain ${text}`);
}

function waitForContainer(name: string): number {
  return Number(runPodman(["wait", name]).trim());
}

function containerLogs(name: string): string {
  return runPodman(["logs", name]);
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

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) =>
    server.listen(0, "0.0.0.0", resolve)
  );
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
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function elapsed(started: number): number {
  return Math.ceil(performance.now() - started);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
