import { execFileSync, spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { performance } from "node:perf_hooks";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";
import {
  createApiContainerProvenance,
} from "./api-container-provenance.ts";

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
    const hardening = verifyProductionImageContract();
    verifyHeadlessChromium();
    runPodman([
      "run",
      "--detach",
      "--name",
      container,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
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
    const bodyStartedAt = performance.now();
    const partialBodyResponse = await incompleteJsonRequest(
      apiPort,
      delegatedProductToken,
    );
    const bodyReceiveTimeoutMs = Math.round(performance.now() - bodyStartedAt);
    if (
      bodyReceiveTimeoutMs < 14_000 ||
      bodyReceiveTimeoutMs > 18_000 ||
      partialBodyResponse.includes("500 Internal Server Error") ||
      (
        partialBodyResponse.length > 0 &&
        !partialBodyResponse.includes("408 Request Timeout")
      )
    ) {
      throw new Error(
        `Incomplete body boundary was not categorical (${bodyReceiveTimeoutMs}ms)`,
      );
    }

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
      JSON.stringify({
        schemaVersion: 1,
        label: "API_CONTAINER_REQUEST_BOUNDARY",
        status: "pass",
        bodyReceiveTimeoutMs,
        terminalTelemetry: "exact",
        residue: "absent",
      }),
    );
    console.log(JSON.stringify({
      schemaVersion: 1,
      label: "API_CONTAINER_HARDENING",
      status: "pass",
      ...hardening,
    }));
  } finally {
    if (containerCreated) {
      spawnSync("podman", ["rm", "--force", container], { encoding: "utf8" });
    }
    spawnSync("podman", ["image", "rm", "--force", image], { encoding: "utf8" });
    await close(jwksServer);
  }
}

function verifyProductionImageContract(): Record<string, unknown> {
  const expectedProvenance = createApiContainerProvenance(process.cwd());
  const expectedProvenanceSummary = {
    baseImage: expectedProvenance.baseImage.reference,
    buildInputsDigest: expectedProvenance.buildInputs.digest,
    lockfileDigest: expectedProvenance.lockfile.digest,
    productionComponentCount: expectedProvenance.productionComponents.count,
    productionComponentsDigest:
      expectedProvenance.productionComponents.digest,
  };
  const metadata = JSON.parse(
    runPodman(["image", "inspect", image]),
  ) as Array<{
    Config?: Record<string, unknown> & {
      User?: string;
      WorkingDir?: string;
      Entrypoint?: string[] | null;
      ExposedPorts?: Record<string, unknown>;
    };
    Healthcheck?: { Test?: string[] };
    RootFS?: { Layers?: string[] };
  }>;
  const inspected = metadata[0];
  const startup = inspected?.Config
    ? Reflect.get(inspected.Config, String.fromCharCode(67, 109, 100))
    : undefined;
  const exposedPorts = Object.keys(inspected?.Config?.ExposedPorts ?? {}).sort();
  if (
    inspected?.Config?.User !== "pwuser" ||
    inspected.Config.WorkingDir !== "/app" ||
    inspected.Config.Entrypoint != null ||
    JSON.stringify(startup) !== JSON.stringify(["node", "dist-api/index.js"]) ||
    JSON.stringify(exposedPorts) !== JSON.stringify(["3000/tcp"]) ||
    inspected.Healthcheck?.Test?.length !== 2 ||
    !inspected.Healthcheck.Test[1]?.includes("http://127.0.0.1:3000/health")
  ) {
    throw new Error("Production image metadata does not match the bounded runtime contract");
  }

  const proof = [
    "import { createHash } from 'node:crypto';",
    "import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';",
    "const fail = (reason) => { throw new Error(reason); };",
    "if (process.getuid() !== 1001 || process.getgid() !== 1001) fail('runtime identity');",
    "const app = readdirSync('/app').sort();",
    "if (JSON.stringify(app) !== JSON.stringify(['container-provenance.json','dist-api','node_modules'])) fail('app contents');",
    "const dist = readdirSync('/app/dist-api').sort();",
    "if (JSON.stringify(dist) !== JSON.stringify(['index.js'])) fail('bundle contents');",
    "const dev = ['@playwright/test','@types/node','jsdom','marked','typescript','vite','vitest'];",
    "if (dev.some((name) => existsSync(`/app/node_modules/${name}`))) fail('dev dependency');",
    "if (existsSync('/app/.npm') || existsSync('/app/node_modules/.cache') || existsSync('/home/pwuser/.npm')) fail('cache');",
    "let readOnly = false;",
    "try { writeFileSync('/app/runtime-write-proof', 'x', { flag: 'wx' }); } catch (error) { readOnly = error?.code === 'EROFS'; }",
    "if (!readOnly) fail('writable root');",
    "const status = Object.fromEntries(readFileSync('/proc/self/status','utf8').split('\\n').filter((line) => /^(?:CapEff|NoNewPrivs|Seccomp):/.test(line)).map((line) => line.split(/:\\s*/,2)));",
    "if (status.CapEff !== '0000000000000000' || status.NoNewPrivs !== '1' || status.Seccomp !== '2') fail('process security');",
    "const provenanceText = readFileSync('/app/container-provenance.json','utf8');",
    "const provenance = JSON.parse(provenanceText);",
    "if (provenance.schemaVersion !== 1 || provenance.kind !== 'ap2-api-container-provenance') fail('provenance schema');",
    "const bundle = readFileSync('/app/dist-api/index.js');",
    "const bundleDigest = createHash('sha256').update(bundle).digest('hex');",
    "const artifactDigest = createHash('sha256').update(`dist-api/index.js\\0${bundle.byteLength}\\0${bundleDigest}\\n`).digest('hex');",
    "if (provenance.buildArtifacts.classification !== 'bound-build-output' || provenance.buildArtifacts.count !== 1 || provenance.buildArtifacts.digest !== artifactDigest || JSON.stringify(provenance.buildArtifacts.files) !== JSON.stringify([{bytes:bundle.byteLength,digest:bundleDigest,path:'dist-api/index.js'}])) fail('build artifact provenance');",
    "console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),appEntries:app,distEntries:dist,devDependencies:'absent',caches:'absent',rootFilesystem:'read-only',effectiveCapabilities:'none',noNewPrivileges:true,seccomp:'filter',provenance:{baseImage:provenance.baseImage.reference,buildArtifactCount:provenance.buildArtifacts.count,buildArtifactsDigest:provenance.buildArtifacts.digest,buildInputsDigest:provenance.buildInputs.digest,documentDigest:createHash('sha256').update(provenanceText).digest('hex'),lockfileDigest:provenance.lockfile.digest,productionComponentCount:provenance.productionComponents.count,productionComponentsDigest:provenance.productionComponents.digest}}));",
  ].join(" ");
  const runtime = JSON.parse(runPodman([
    "run",
    "--rm",
    "--no-healthcheck",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    image,
    "node",
    "--input-type=module",
    "--eval",
    proof,
  ])) as Record<string, unknown>;
  const runtimeProvenance = runtime.provenance as Record<string, unknown>;
  if (
    Object.entries(expectedProvenanceSummary).some(
      ([key, value]) => runtimeProvenance[key] !== value,
    )
  ) {
    throw new Error("Production image provenance does not match repository inputs");
  }
  return {
    imageUser: inspected.Config.User,
    workingDirectory: inspected.Config.WorkingDir,
    exposedPort: "3000/tcp",
    entrypoint: "none",
    command: "node dist-api/index.js",
    healthCommand: "configured",
    layerCount: inspected.RootFS?.Layers?.length ?? 0,
    ...runtime,
  };
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
    "--security-opt",
    "no-new-privileges",
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
  expectSignature(requests, "scenario-plan-compile", "pure", 499, 1);
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

async function incompleteJsonRequest(
  port: number,
  token: string,
): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  let received = "";
  socket.on("data", (chunk: string) => {
    received += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    "POST /api/scenario-plan HTTP/1.1",
    `Host: 127.0.0.1:${port}`,
    `Authorization: Bearer ${token}`,
    "Content-Type: application/json",
    "Content-Length: 16",
    "Connection: close",
    "",
    "{",
  ].join("\r\n"));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Incomplete body exceeded its hard outer timeout"));
    }, 20_000);
    timeout.unref();
    const finish = (): void => {
      clearTimeout(timeout);
      resolve();
    };
    socket.once("end", finish);
    socket.once("close", finish);
    socket.once("error", reject);
  });
  return received;
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
