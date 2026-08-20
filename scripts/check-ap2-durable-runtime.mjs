import { createHash, X509Certificate } from "node:crypto";
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
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const MIGRATED_USER_ALIASES = ["cory", "homer", "kobe", "marge"];
const SIMULATED_USER_ALIASES = [...MIGRATED_USER_ALIASES, "rachel"];
const userFiles = (aliases) => aliases.flatMap((alias) => [
  `secrets/cba/users/${alias}/certificate.pem`,
  `secrets/cba/users/${alias}/certificate.pfx`,
  `secrets/cba/users/${alias}/private-key.pem`,
  `secrets/cba/users/${alias}/private-key-passphrase.txt`,
  `secrets/cba/users/${alias}/pfx-passphrase.txt`,
  `secrets/cba/users/${alias}/record.json`,
]);
const MIGRATED_REQUIRED_FILES = [
  "secrets/cba/issuer/ca-certificate.pem",
  "secrets/cba/issuer/ca-certificate.cer",
  "secrets/cba/issuer/ca-key.pem",
  "secrets/cba/issuer/ca-key-passphrase.txt",
  ...userFiles(MIGRATED_USER_ALIASES),
  "secrets/cba/operator/operator-certificate.pfx",
  "secrets/cba/operator/operator-pfx-passphrase.txt",
  "secrets/dev-graph/certificate.pem",
  "secrets/dev-graph/certificate.cer",
  "secrets/dev-graph/config.json",
  "secrets/dev-graph/credential.pem",
];
const REQUIRED_FILES = [
  ...MIGRATED_REQUIRED_FILES,
  ...userFiles(["rachel"]),
  "secrets/github/admin-ap2.metadata.json",
  "secrets/github/admin-ap2.token",
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

function certificateSki(path) {
  const output = openssl([
    "x509",
    "-in",
    path,
    "-noout",
    "-ext",
    "subjectKeyIdentifier",
  ]).toString("utf8");
  const lines = output.trim().split("\n");
  const ski = lines.at(-1)?.replaceAll(/[:\s]/g, "").toUpperCase();
  if (!ski || !/^[0-9A-F]{40}$/.test(ski)) fail(`certificate SKI unavailable for ${path}`);
  return ski;
}

function assertDerMatchesPem(pemPath, derPath) {
  const derived = openssl(["x509", "-in", pemPath, "-outform", "DER"]);
  if (!derived.equals(readFileSync(derPath))) fail(`${derPath} does not match its PEM certificate`);
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
    resolve(resolveAp2RuntimeRoot()),
  );
  const recordRuntimeRoot = resolve(
    process.env.AP2_RUNTIME_RECORD_ROOT ?? runtimeRoot,
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
  if (![1, 2].includes(inventory.schemaVersion) || !Array.isArray(inventory.files)) {
    fail("migration-inventory.json has an unsupported shape");
  }
  const entries = new Map(inventory.files.map((entry) => [entry.path, entry]));
  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = join(runtimeRoot, relativePath);
    assertPrivatePath(dirname(absolutePath), "directory");
    assertPrivatePath(absolutePath, "file");
  }
  const hashedFiles = inventory.schemaVersion === 2
    ? REQUIRED_FILES
    : MIGRATED_REQUIRED_FILES;
  if (
    inventory.schemaVersion === 2 &&
    inventory.destinationRoot !== recordRuntimeRoot
  ) {
    fail("migration inventory destinationRoot is not retargeted");
  }
  for (const relativePath of hashedFiles) {
    const absolutePath = join(runtimeRoot, relativePath);
    const entry = entries.get(relativePath);
    if (!entry) fail(`migration inventory is missing ${relativePath}`);
    const metadata = statSync(absolutePath);
    if (metadata.size !== entry.bytes || sha256(absolutePath) !== entry.sha256) {
      fail(`migration hash or size mismatch for ${relativePath}`);
    }
  }

  const issuer = join(runtimeRoot, "secrets/cba/issuer");
  openssl(["x509", "-in", join(issuer, "ca-certificate.pem"), "-checkend", "0", "-noout"]);
  assertDerMatchesPem(
    join(issuer, "ca-certificate.pem"),
    join(issuer, "ca-certificate.cer"),
  );
  if (
    publicKeyHashFromCertificate(join(issuer, "ca-certificate.pem")) !==
    publicKeyHashFromPrivateKey(
      join(issuer, "ca-key.pem"),
      join(issuer, "ca-key-passphrase.txt"),
    )
  ) {
    fail("issuer certificate and private key do not match");
  }

  const userSkis = new Set();
  for (const alias of SIMULATED_USER_ALIASES) {
    const directory = join(runtimeRoot, "secrets/cba/users", alias);
    const certificatePath = join(directory, "certificate.pem");
    openssl(["x509", "-in", certificatePath, "-checkend", "0", "-noout"]);
    openssl([
      "verify",
      "-CAfile",
      join(issuer, "ca-certificate.pem"),
      certificatePath,
    ]);
    if (
      publicKeyHashFromCertificate(certificatePath) !==
      publicKeyHashFromPrivateKey(
        join(directory, "private-key.pem"),
        join(directory, "private-key-passphrase.txt"),
      )
    ) {
      fail(`${alias} certificate and private key do not match`);
    }
    const pfxCertificate = openssl([
      "pkcs12",
      "-in",
      join(directory, "certificate.pfx"),
      "-passin",
      `file:${join(directory, "pfx-passphrase.txt")}`,
      "-clcerts",
      "-nokeys",
    ]);
    const certificate = new X509Certificate(readFileSync(certificatePath));
    const pfxLeaf = new X509Certificate(pfxCertificate);
    if (certificate.fingerprint256 !== pfxLeaf.fingerprint256) {
      fail(`${alias} PFX leaf does not match certificate.pem`);
    }
    const ski = certificateSki(certificatePath);
    if (userSkis.has(ski)) fail(`${alias} reuses another simulated-user SKI`);
    userSkis.add(ski);
    const record = JSON.parse(
      readFileSync(join(directory, "record.json"), "utf8"),
    );
    const expectedPaths = {
      certificatePath: join(
        recordRuntimeRoot,
        "secrets/cba/users",
        alias,
        "certificate.pem",
      ),
      privateKeyPath: join(
        recordRuntimeRoot,
        "secrets/cba/users",
        alias,
        "private-key.pem",
      ),
      privateKeyPassphrasePath: join(
        recordRuntimeRoot,
        "secrets/cba/users",
        alias,
        "private-key-passphrase.txt",
      ),
      pfxPath: join(
        recordRuntimeRoot,
        "secrets/cba/users",
        alias,
        "certificate.pfx",
      ),
      pfxPassphrasePath: join(
        recordRuntimeRoot,
        "secrets/cba/users",
        alias,
        "pfx-passphrase.txt",
      ),
    };
    for (const [name, expected] of Object.entries(expectedPaths)) {
      if (record[name] !== expected) fail(`${alias} record ${name} is not retargeted`);
    }
    if (
      record.certificateUserId !== `X509:<SKI>${ski}` ||
      record.certificateFingerprint256 !== certificate.fingerprint256 ||
      record.certificateValidFrom !== new Date(certificate.validFrom).toISOString() ||
      record.certificateValidTo !== new Date(certificate.validTo).toISOString()
    ) {
      fail(`${alias} record certificate metadata does not match the renewed leaf`);
    }
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
  assertDerMatchesPem(
    join(devGraph, "certificate.pem"),
    join(devGraph, "certificate.cer"),
  );
  const devConfig = JSON.parse(readFileSync(join(devGraph, "config.json"), "utf8"));
  if (
    devConfig.certificatePath !==
    join(recordRuntimeRoot, "secrets/dev-graph/credential.pem")
  ) {
    fail("Dev/Graph config certificatePath is not retargeted");
  }
  if (
    publicKeyHashFromCertificate(join(devGraph, "certificate.pem")) !==
    publicKeyHashFromPrivateKey(join(devGraph, "credential.pem"))
  ) {
    fail("Dev/Graph certificate and credential key do not match");
  }

  const github = join(runtimeRoot, "secrets/github");
  JSON.parse(readFileSync(join(github, "admin-ap2.metadata.json"), "utf8"));
  const githubToken = readFileSync(
    join(github, "admin-ap2.token"),
    "utf8",
  ).trim();
  if (!githubToken || githubToken.includes("\n")) {
    fail("GitHub automation token must contain one nonempty line");
  }

  const kobeDirectory = join(runtimeRoot, "secrets/cba/users/kobe");
  await browserAndFakeMicrophoneProof(
    runtimeRoot,
    readFileSync(join(kobeDirectory, "certificate.pfx")),
    readFileSync(join(kobeDirectory, "pfx-passphrase.txt"), "utf8").trim(),
  );
  console.log(
    `PASS files=${REQUIRED_FILES.length} inventory_hashes=${hashedFiles.length} keys=matched chains=verified skis=unique records=retargeted pfx=validated github=present browser=fresh-headless-chromium cba=${basename(kobeDirectory)} microphone=deterministic-wav network=loopback-only`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown readiness failure";
  console.error(`HOLD ${message}`);
  process.exitCode = 1;
}
