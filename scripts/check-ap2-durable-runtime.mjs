import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import {
  createDeterministicVoicemailWav,
  VOICEMAIL_WAV_SHA256,
} from "./create-deterministic-voicemail-wav.mjs";

const DEFAULT_RUNTIME_ROOT =
  "/var/lib/codex-agent-tools-replacement/worker/ap2-runtime";
const REQUIRED_FILES = [
  "secrets/cba/issuer/ca-certificate.pem",
  "secrets/cba/issuer/ca-certificate.cer",
  "secrets/cba/issuer/ca-key.pem",
  "secrets/cba/issuer/ca-key-passphrase.txt",
  ...["cory", "homer", "kobe", "marge"].flatMap((alias) => [
    `secrets/cba/users/${alias}/certificate.pem`,
    `secrets/cba/users/${alias}/certificate.pfx`,
    `secrets/cba/users/${alias}/private-key.pem`,
    `secrets/cba/users/${alias}/private-key-passphrase.txt`,
    `secrets/cba/users/${alias}/pfx-passphrase.txt`,
    `secrets/cba/users/${alias}/record.json`,
  ]),
  "secrets/cba/operator/operator-certificate.pfx",
  "secrets/cba/operator/operator-pfx-passphrase.txt",
  "secrets/dev-graph/certificate.pem",
  "secrets/dev-graph/certificate.cer",
  "secrets/dev-graph/config.json",
  "secrets/dev-graph/credential.pem",
];

function fail(message) {
  throw new Error(message);
}

function assertPrivatePath(path, kind) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      fail(`${path} is absent`);
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) fail(`${path} must not be a symbolic link`);
  if (kind === "directory" && !metadata.isDirectory()) fail(`${path} must be a directory`);
  if (kind === "file" && !metadata.isFile()) fail(`${path} must be a regular file`);
  if ((metadata.mode & 0o077) !== 0) fail(`${path} grants group or other access`);
  if (metadata.uid !== process.getuid?.()) fail(`${path} is not owned by the durable worker`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function openssl(arguments_, input) {
  const result = spawnSync("openssl", arguments_, {
    input,
    encoding: null,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) fail(`OpenSSL validation failed for ${arguments_[0]}`);
  return result.stdout;
}

function publicKeyHashFromCertificate(path) {
  const publicKey = openssl(["x509", "-in", path, "-pubkey", "-noout"]);
  return createHash("sha256").update(publicKey).digest("hex");
}

function publicKeyHashFromPrivateKey(path, passphrasePath) {
  const arguments_ = ["pkey", "-in", path, "-pubout"];
  if (passphrasePath) arguments_.push("-passin", `file:${passphrasePath}`);
  return createHash("sha256").update(openssl(arguments_)).digest("hex");
}

async function browserAndFakeMicrophoneProof(
  runtimeRoot,
  pfx,
  passphrase,
) {
  const runDirectory = mkdtempSync(join(runtimeRoot, "runs/readiness-"));
  chmodSync(runDirectory, 0o700);
  const wavPath = join(runDirectory, "ap2-deterministic-voicemail.wav");
  createDeterministicVoicemailWav(wavPath);
  if (sha256(wavPath) !== VOICEMAIL_WAV_SHA256) {
    fail("deterministic WAV fingerprint mismatch");
  }

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>AP2 local microphone readiness</title>");
  });
  await new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveServer);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("loopback readiness server unavailable");
  const origin = `http://127.0.0.1:${address.port}`;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${wavPath}%noloop`,
      ],
    });
    const context = await browser.newContext({
      permissions: ["microphone"],
      ...(pfx && passphrase
        ? {
            clientCertificates: [
              {
                origin: "https://certauth.login.microsoftonline.com",
                pfx,
                passphrase,
              },
            ],
          }
        : {}),
    });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      const audioTrack = await page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
          return stream.getAudioTracks().length;
        } finally {
          for (const track of stream.getTracks()) track.stop();
        }
      });
      if (audioTrack !== 1) fail("Chromium did not expose the deterministic fake microphone");
    } finally {
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolveServer) => server.close(() => resolveServer()));
    rmSync(runDirectory, { recursive: true });
  }
}

async function main() {
  const browserOnly = process.argv.includes("--browser-only");
  const runtimeRoot = realpathSync(
    resolve(process.env.AP2_RUNTIME_ROOT ?? DEFAULT_RUNTIME_ROOT),
  );
  assertPrivatePath(runtimeRoot, "directory");
  assertPrivatePath(join(runtimeRoot, "secrets"), "directory");
  assertPrivatePath(join(runtimeRoot, "runs"), "directory");

  if (browserOnly) {
    await browserAndFakeMicrophoneProof(runtimeRoot);
    console.log("PASS browser=fresh-headless-chromium microphone=deterministic-wav network=loopback-only");
    return;
  }

  const inventoryPath = join(runtimeRoot, "migration-inventory.json");
  assertPrivatePath(inventoryPath, "file");
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.files)) {
    fail("migration-inventory.json has an unsupported shape");
  }
  const entries = new Map(inventory.files.map((entry) => [entry.path, entry]));
  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = join(runtimeRoot, relativePath);
    assertPrivatePath(dirname(absolutePath), "directory");
    assertPrivatePath(absolutePath, "file");
    const entry = entries.get(relativePath);
    if (!entry) fail(`migration inventory is missing ${relativePath}`);
    const metadata = statSync(absolutePath);
    if (metadata.size !== entry.bytes || sha256(absolutePath) !== entry.sha256) {
      fail(`migration hash or size mismatch for ${relativePath}`);
    }
  }

  const issuer = join(runtimeRoot, "secrets/cba/issuer");
  openssl(["x509", "-in", join(issuer, "ca-certificate.pem"), "-checkend", "0", "-noout"]);
  if (
    publicKeyHashFromCertificate(join(issuer, "ca-certificate.pem")) !==
    publicKeyHashFromPrivateKey(
      join(issuer, "ca-key.pem"),
      join(issuer, "ca-key-passphrase.txt"),
    )
  ) {
    fail("issuer certificate and private key do not match");
  }

  for (const alias of ["cory", "homer", "kobe", "marge"]) {
    const directory = join(runtimeRoot, "secrets/cba/users", alias);
    openssl(["x509", "-in", join(directory, "certificate.pem"), "-checkend", "0", "-noout"]);
    if (
      publicKeyHashFromCertificate(join(directory, "certificate.pem")) !==
      publicKeyHashFromPrivateKey(
        join(directory, "private-key.pem"),
        join(directory, "private-key-passphrase.txt"),
      )
    ) {
      fail(`${alias} certificate and private key do not match`);
    }
    openssl([
      "pkcs12",
      "-in",
      join(directory, "certificate.pfx"),
      "-passin",
      `file:${join(directory, "pfx-passphrase.txt")}`,
      "-noout",
    ]);
  }

  const operator = join(runtimeRoot, "secrets/cba/operator");
  const operatorCertificate = openssl([
    "pkcs12",
    "-in",
    join(operator, "operator-certificate.pfx"),
    "-passin",
    `file:${join(operator, "operator-pfx-passphrase.txt")}`,
    "-clcerts",
    "-nokeys",
  ]);
  openssl(["x509", "-checkend", "0", "-noout"], operatorCertificate);

  const devGraph = join(runtimeRoot, "secrets/dev-graph");
  openssl(["x509", "-in", join(devGraph, "certificate.pem"), "-checkend", "0", "-noout"]);
  if (
    publicKeyHashFromCertificate(join(devGraph, "certificate.pem")) !==
    publicKeyHashFromPrivateKey(join(devGraph, "credential.pem"))
  ) {
    fail("Dev/Graph certificate and credential key do not match");
  }

  const kobeDirectory = join(runtimeRoot, "secrets/cba/users/kobe");
  await browserAndFakeMicrophoneProof(
    runtimeRoot,
    readFileSync(join(kobeDirectory, "certificate.pfx")),
    readFileSync(join(kobeDirectory, "pfx-passphrase.txt"), "utf8").trim(),
  );
  console.log(
    `PASS files=${REQUIRED_FILES.length} hashes=verified keys=matched pfx=validated browser=fresh-headless-chromium cba=${basename(kobeDirectory)} microphone=deterministic-wav network=loopback-only`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown readiness failure";
  console.error(`HOLD ${message}`);
  process.exitCode = 1;
}
