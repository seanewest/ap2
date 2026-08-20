import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  ClientCertificateCredential,
  DefaultAzureCredential,
} from "@azure/identity";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const DEFAULT_VAULT_URL = "https://kv-ap2-dev-central-6d8e.vault.azure.net";
const VAULT_SCOPE = "https://vault.azure.net/.default";
const ARM_SCOPE = "https://management.azure.com/.default";
const API_VERSION = "7.4";
const CONTENT_TYPE = "application/vnd.ap2.runtime-file+gzip+base64";
const PATH_TAG = "ap2-runtime-path";
const HASH_TAG = "sha256";

function fail(message) {
  throw new Error(message);
}

function privatePath(path, kind) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) fail(`${path} must not be a symbolic link`);
  if (kind === "file" && !metadata.isFile()) fail(`${path} must be a file`);
  if (kind === "directory" && !metadata.isDirectory()) fail(`${path} must be a directory`);
  if ((metadata.mode & 0o077) !== 0) fail(`${path} grants group or other access`);
  if (metadata.uid !== process.getuid?.()) fail(`${path} is not owned by the current agent`);
  return path;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function secretName(path) {
  return `runtime-${sha256(path)}`;
}

function standingFiles(runtimeRoot) {
  const paths = ["migration-inventory.json"];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) fail(`${path} must not be a symbolic link`);
      if (entry.isDirectory()) {
        privatePath(path, "directory");
        walk(path, relativePath);
      } else if (entry.isFile()) {
        privatePath(path, "file");
        paths.push(relativePath);
      } else {
        fail(`${path} is not a regular file or directory`);
      }
    }
  };
  privatePath(runtimeRoot, "directory");
  privatePath(join(runtimeRoot, "secrets"), "directory");
  privatePath(join(runtimeRoot, "migration-inventory.json"), "file");
  walk(join(runtimeRoot, "secrets"), "secrets");
  return paths.sort();
}

function vaultUrl() {
  const value = (process.env.AP2_DEVELOPMENT_VAULT_URL ?? DEFAULT_VAULT_URL).replace(/\/$/u, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("AP2_DEVELOPMENT_VAULT_URL must be an HTTPS origin");
  }
  return value;
}

function credential() {
  const configPath = process.env.AP2_ARM_CONFIG;
  if (!configPath || !existsSync(configPath)) return new DefaultAzureCredential();
  privatePath(realpathSync(configPath), "file");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    typeof config.tenantId !== "string" || typeof config.clientId !== "string" ||
    typeof config.certificatePath !== "string"
  ) fail("AP2_ARM_CONFIG has an unsupported shape");
  privatePath(realpathSync(config.certificatePath), "file");
  return new ClientCertificateCredential(config.tenantId, config.clientId, {
    certificatePath: config.certificatePath,
  });
}

async function vaultRequest(auth, path, options = {}) {
  const access = await auth.getToken(VAULT_SCOPE);
  if (!access?.token) fail("Key Vault token acquisition failed");
  const response = await fetch(`${vaultUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${access.token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const code = body?.error?.code ?? "unknown";
    fail(`Key Vault ${options.method ?? "GET"} failed with ${response.status} (${code})`);
  }
  return body;
}

async function listManagedSecrets(auth) {
  const values = [];
  let next = `/secrets?api-version=${API_VERSION}&maxresults=25`;
  while (next) {
    const page = next.startsWith("https:")
      ? await vaultRequest(auth, new URL(next).pathname + new URL(next).search)
      : await vaultRequest(auth, next);
    values.push(...page.value.filter((item) => item.tags?.[PATH_TAG]));
    next = page.nextLink ?? null;
  }
  return values;
}

async function upload() {
  const root = realpathSync(resolveAp2RuntimeRoot());
  const paths = standingFiles(root);
  const auth = credential();
  const current = new Map(
    (await listManagedSecrets(auth)).map((item) => [
      item.tags?.[PATH_TAG],
      item.tags?.[HASH_TAG],
    ]),
  );
  let written = 0;
  let unchanged = 0;
  for (const path of paths) {
    const value = readFileSync(join(root, path));
    const hash = sha256(value);
    if (current.get(path) === hash) {
      unchanged += 1;
      continue;
    }
    await vaultRequest(auth, `/secrets/${secretName(path)}?api-version=${API_VERSION}`, {
      method: "PUT",
      body: JSON.stringify({
        value: gzipSync(value, { level: 9 }).toString("base64"),
        contentType: CONTENT_TYPE,
        tags: {
          [PATH_TAG]: path,
          [HASH_TAG]: hash,
          encoding: "gzip+base64",
          purpose: "standing-development",
        },
        attributes: { enabled: true },
      }),
    });
    written += 1;
  }
  console.log(`PASS uploaded=${written} unchanged=${unchanged} total=${paths.length} vault=${new URL(vaultUrl()).hostname} local_runtime=unchanged`);
}

async function retrieve(auth) {
  const metadata = await listManagedSecrets(auth);
  const files = new Map();
  for (const item of metadata) {
    if (item.contentType !== CONTENT_TYPE) fail("Managed secret has an unexpected content type");
    const name = new URL(item.id).pathname.split("/")[2];
    const secret = await vaultRequest(auth, `/secrets/${name}?api-version=${API_VERSION}`);
    const path = secret.tags?.[PATH_TAG];
    if (typeof path !== "string" || isAbsolute(path) || path.split("/").includes("..")) {
      fail("Managed secret has an unsafe runtime path");
    }
    const value = gunzipSync(Buffer.from(secret.value, "base64"));
    if (sha256(value) !== secret.tags?.[HASH_TAG]) fail(`Hash mismatch for ${path}`);
    if (files.has(path)) fail(`Duplicate managed path ${path}`);
    files.set(path, value);
  }
  return files;
}

function prepareTarget(target) {
  const absolute = resolve(target);
  if (existsSync(absolute)) fail("Restore target must not already exist");
  mkdirSync(absolute, { mode: 0o700 });
  chmodSync(absolute, 0o700);
  return absolute;
}

function writeRuntime(target, files) {
  for (const [path, value] of files) {
    const destination = resolve(target, path);
    if (!destination.startsWith(`${target}${sep}`)) fail("Refusing path outside restore target");
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    for (let current = dirname(destination); current.startsWith(target); current = dirname(current)) {
      chmodSync(current, 0o700);
      if (current === target) break;
    }
    writeFileSync(destination, value, { mode: 0o600, flag: "wx" });
  }
  mkdirSync(join(target, "runs"), { mode: 0o700 });
}

async function restore(target) {
  if (!target || !isAbsolute(target)) fail("restore requires a new absolute target directory");
  const auth = credential();
  const files = await retrieve(auth);
  const destination = prepareTarget(target);
  writeRuntime(destination, files);
  console.log(`PASS restored=${files.size} target=${destination} mode=owner-only hashes=matched`);
}

async function prove() {
  const auth = credential();
  const files = await retrieve(auth);
  const configBytes = files.get("secrets/dev-graph/config.json");
  const pem = files.get("secrets/dev-graph/credential.pem");
  if (!configBytes || !pem) fail("Central snapshot lacks the Dev/Graph credential");
  const config = JSON.parse(configBytes.toString("utf8"));
  const temporary = `/tmp/ap2-development-vault-proof-${process.pid}`;
  const target = prepareTarget(temporary);
  try {
    const certificatePath = join(target, "credential.pem");
    writeFileSync(certificatePath, pem, { mode: 0o600, flag: "wx" });
    const centralCredential = new ClientCertificateCredential(
      config.tenantId,
      config.clientId,
      { certificatePath },
    );
    const access = await centralCredential.getToken(ARM_SCOPE);
    if (!access?.token) fail("Retrieved Dev/Graph certificate could not obtain an ARM token");
    const response = await fetch(
      `https://management.azure.com/subscriptions/${config.subscriptionId}?api-version=2022-12-01`,
      { headers: { Authorization: `Bearer ${access.token}` } },
    );
    const body = await response.json();
    if (!response.ok || body.state !== "Enabled") fail(`Retrieved credential ARM proof failed with ${response.status}`);
    console.log(`PASS retrieved=${files.size} hashes=matched use=ARM-subscription-read state=${body.state} local_runtime=unchanged`);
  } finally {
    const credentialPath = join(target, "credential.pem");
    if (existsSync(credentialPath)) {
      writeFileSync(credentialPath, Buffer.alloc(statSync(credentialPath).size), { flag: "r+" });
    }
    await import("node:fs/promises").then(({ rm }) => rm(target, { recursive: true }));
  }
}

const [command, argument] = process.argv.slice(2);
if (command === "upload") await upload();
else if (command === "restore") await restore(argument);
else if (command === "prove") await prove();
else fail("Usage: npm run development-vault -- <upload|prove|restore ABSOLUTE_NEW_DIRECTORY>");
