import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  AzureNamedKeyCredential,
  TableServiceClient,
} from "@azure/data-tables";

const MAX_OUTPUT_BYTES = 4_096;
const accountName = `ap2${randomBytes(6).toString("hex")}`;
const accountKey = randomBytes(64).toString("base64");
const port = await reservePort();
const runDirectory = mkdtempSync(join(tmpdir(), "ap2-table-emulator-"));
const endpoint = `http://127.0.0.1:${port}`;
let emulator: ChildProcess | undefined;
let canaryComplete = false;

try {
  const emulatorExecutable = await resolveEmulatorExecutable();
  emulator = spawn(
    emulatorExecutable,
    [
      "--silent",
      "--location",
      runDirectory,
      "--tableHost",
      "127.0.0.1",
      "--tablePort",
      String(port),
      "--disableProductStyleUrl",
    ],
    {
      env: {
        ...process.env,
        AZURITE_ACCOUNTS: `${accountName}:${accountKey}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForEmulator(endpoint, accountName, accountKey, emulator);

  const [first, second] = await Promise.all([
    runWorker(endpoint, accountName, accountKey, "process-one"),
    runWorker(endpoint, accountName, accountKey, "process-two"),
  ]);
  const claims = [first, second];
  if (claims.filter((claim) => claim.kind === "dispatch").length !== 1) {
    refuse("EMULATOR_CONCURRENT_DISPATCH_REFUSED");
  }
  const loser = claims.find((claim) => claim.kind === "refused");
  if (
    !loser ||
    !["owned-by-another", "requires-reconciliation", "conditional-conflict"].includes(
      loser.reason ?? "",
    )
  ) {
    refuse("EMULATOR_CONCURRENT_REFUSAL_MISSING");
  }

  const fresh = await runWorker(
    endpoint,
    accountName,
    accountKey,
    "process-three",
  );
  if (
    fresh.kind !== "refused" ||
    fresh.reason !== "requires-reconciliation"
  ) {
    refuse("EMULATOR_FRESH_PROCESS_REPLAY_NOT_SUPPRESSED");
  }

  canaryComplete = true;
} finally {
  if (emulator && emulator.exitCode === null) {
    emulator.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => emulator?.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (emulator.exitCode === null) emulator.kill("SIGKILL");
  }
  rmSync(runDirectory, { recursive: true, force: true });
}
if (!canaryComplete) refuse("EMULATOR_CANARY_INCOMPLETE");
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  kind: "shared-operation-journal-emulator-canary",
  concurrentDispatches: 1,
  concurrentRefusals: 1,
  freshProcess: "requires-reconciliation",
  residue: "removed",
})}\n`);

interface WorkerResult {
  kind: "dispatch" | "refused" | "corrupt";
  reason?: string;
}

async function runWorker(
  workerEndpoint: string,
  workerAccountName: string,
  workerAccountKey: string,
  owner: string,
): Promise<WorkerResult> {
  const child = spawn(
    process.execPath,
    ["scripts/shared-operation-journal-emulator-worker.ts"],
    {
      env: {
        ...process.env,
        AP2_EMULATOR_ENDPOINT: workerEndpoint,
        AP2_EMULATOR_ACCOUNT_NAME: workerAccountName,
        AP2_EMULATOR_ACCOUNT_KEY: workerAccountKey,
        AP2_EMULATOR_OWNER: owner,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const { code, stdout } = await collect(child);
  if (code !== 0 || Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
    refuse("EMULATOR_WORKER_FAILED");
  }
  const parsed = JSON.parse(stdout) as WorkerResult;
  if (
    !["dispatch", "refused", "corrupt"].includes(parsed.kind) ||
    Object.keys(parsed).some((key) => !["kind", "reason"].includes(key))
  ) {
    refuse("EMULATOR_WORKER_OUTPUT_REFUSED");
  }
  return parsed;
}

async function waitForEmulator(
  emulatorEndpoint: string,
  emulatorAccountName: string,
  emulatorAccountKey: string,
  processHandle: ChildProcess,
): Promise<void> {
  const service = new TableServiceClient(
    `${emulatorEndpoint}/${emulatorAccountName}`,
    new AzureNamedKeyCredential(emulatorAccountName, emulatorAccountKey),
    { allowInsecureConnection: true },
  );
  let lastFailure = "unknown";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (processHandle.exitCode !== null) refuse("EMULATOR_EXITED");
    try {
      await service.createTable("ap2operations");
      return;
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        const candidate = error as { code?: unknown; statusCode?: unknown };
        lastFailure = `${error.constructor.name}:${String(candidate.code ?? "none")}:${String(candidate.statusCode ?? "none")}`;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`EMULATOR_START_TIMEOUT_${lastFailure}`);
}

async function collect(
  child: ChildProcess,
): Promise<{ code: number | null; stdout: string }> {
  let stdout = "";
  let stderrBytes = 0;
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
  });
  const code = await new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  return { code, stdout };
}

async function resolveEmulatorExecutable(): Promise<string> {
  const resolver = spawn(
    "npm",
    [
      "exec",
      "--yes",
      "--package=azurite@3.36.0",
      "--",
      "which",
      "azurite-table",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const { code, stdout } = await collect(resolver);
  const executable = stdout.trim();
  if (
    code !== 0 ||
    !executable.startsWith("/") ||
    !executable.endsWith("/node_modules/.bin/azurite-table") ||
    executable.includes("\n") ||
    Buffer.byteLength(executable) > 1_024
  ) {
    refuse("EMULATOR_EXECUTABLE_REFUSED");
  }
  return executable;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") refuse("EMULATOR_PORT_REFUSED");
  const selectedPort = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
  return selectedPort;
}

function refuse(code: string): never {
  throw new Error(code);
}
