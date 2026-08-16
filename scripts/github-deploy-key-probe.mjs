#!/usr/bin/env node

import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const repository = "ap2-v2-lab/maintainer-control-proof";
const repositoryApi = `/repos/${repository}`;
const sshRepository = `git@github.com:${repository}.git`;
const branchPrefix = "ap2-write-deploy-key-probe-";

if (process.argv.slice(2).join(" ") !== "--execute") {
  throw new Error(
    `refusing mutation without --execute; this probe targets only ${repository}`,
  );
}

const tokenPath = process.env.AP2_GITHUB_TOKEN_FILE;
if (!tokenPath) {
  throw new Error("AP2_GITHUB_TOKEN_FILE must name an owner-only token file");
}
const tokenStat = lstatSync(tokenPath);
if (
  !tokenStat.isFile() ||
  tokenStat.isSymbolicLink() ||
  (tokenStat.mode & 0o077) !== 0
) {
  throw new Error(
    "AP2_GITHUB_TOKEN_FILE must be a non-symlink file with mode 0600 or stricter",
  );
}
const token = readFileSync(tokenPath, "utf8").trim();
if (!token || token.includes("\n")) {
  throw new Error("AP2_GITHUB_TOKEN_FILE must contain one nonempty line");
}

const headers = {
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};
const request = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok && response.status !== 404) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}`);
  }
  return { status: response.status, value };
};
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.quiet ? ["ignore", "ignore", "pipe"] : undefined,
  });
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const runDirectory = mkdtempSync(
  join(tmpdir(), "ap2-github-deploy-key-probe-"),
);
chmodSync(runDirectory, 0o700);
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const title = `AP2 disposable write deploy key ${stamp}`;
const branch = `${branchPrefix}${stamp.toLowerCase()}`;
const marker = `.ap2-write-deploy-key-probe-${stamp}.txt`;
const keyPath = join(runDirectory, "deploy-key");
const knownHostsPath = join(runDirectory, "known_hosts");
const clonePath = join(runDirectory, "repository");
const sshEnvironment = {
  GIT_SSH_COMMAND: [
    "ssh",
    "-i",
    keyPath,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
  ].join(" "),
};
const git = (args, quiet = false) =>
  run("git", args, { env: sshEnvironment, quiet });
let keyId = null;
let branchMayExist = false;
let operationError;

const removeBranchIfPresent = () => {
  if (!branchMayExist) return;
  const remoteLine = git([
    "-C",
    clonePath,
    "ls-remote",
    "origin",
    `refs/heads/${branch}`,
  ]).trim();
  if (remoteLine) {
    git(
      ["-C", clonePath, "push", "--quiet", "origin", "--delete", branch],
      true,
    );
  }
  branchMayExist = false;
};

const removeKeyIfPresent = async () => {
  if (keyId === null) return;
  const current = await request(`${repositoryApi}/keys/${keyId}`);
  if (current.status === 200) {
    const deleted = await request(`${repositoryApi}/keys/${keyId}`, {
      method: "DELETE",
    });
    if (deleted.status !== 204) {
      throw new Error(`deploy-key delete returned ${deleted.status}`);
    }
  } else if (current.status !== 404) {
    throw new Error(`deploy-key reconciliation returned ${current.status}`);
  }
  keyId = null;
};

try {
  const target = (await request(repositoryApi)).value;
  if (
    target?.full_name !== repository ||
    target?.default_branch !== "main"
  ) {
    throw new Error("target repository or protected default branch changed");
  }
  const beforeMainSha = (await request(`${repositoryApi}/commits/main`)).value
    ?.sha;
  const beforeKeys = (await request(`${repositoryApi}/keys`)).value;
  if (!Array.isArray(beforeKeys) || beforeKeys.length !== 0) {
    throw new Error("deploy-key baseline is not empty");
  }
  if (
    (await request(`${repositoryApi}/git/ref/heads/${branch}`)).status !== 404
  ) {
    throw new Error("temporary branch already exists");
  }

  run("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    title,
    "-f",
    keyPath,
  ]);
  const hostKeys = (await request("/meta")).value?.ssh_keys;
  if (!Array.isArray(hostKeys) || hostKeys.length === 0) {
    throw new Error("GitHub metadata returned no SSH host keys");
  }
  writeFileSync(
    knownHostsPath,
    `${hostKeys.map((key) => `github.com ${key}`).join("\n")}\n`,
    { mode: 0o600 },
  );

  let created;
  try {
    created = await request(`${repositoryApi}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        key: readFileSync(`${keyPath}.pub`, "utf8").trim(),
        read_only: false,
      }),
    });
  } catch (error) {
    // Never replay an ambiguous create; reconcile its exact unique title.
    const keys = (await request(`${repositoryApi}/keys`)).value;
    const matches = Array.isArray(keys)
      ? keys.filter((key) => key.title === title)
      : [];
    if (matches.length !== 1) throw error;
    created = { status: 201, value: matches[0] };
  }
  if (
    created.status !== 201 ||
    created.value?.read_only !== false ||
    created.value?.enabled !== true ||
    typeof created.value?.id !== "number"
  ) {
    throw new Error("deploy key was not created enabled and write-capable");
  }
  keyId = created.value.id;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      git(["clone", "--quiet", sshRepository, clonePath], true);
      break;
    } catch (error) {
      if (attempt === 6) throw error;
      rmSync(clonePath, { recursive: true, force: true });
      await sleep(5_000);
    }
  }
  git(["-C", clonePath, "switch", "--quiet", "-c", branch]);
  git(["-C", clonePath, "config", "user.name", "AP2 deploy-key probe"]);
  git([
    "-C",
    clonePath,
    "config",
    "user.email",
    "ap2-probe@invalid",
  ]);
  writeFileSync(
    join(clonePath, marker),
    `Disposable AP2 write-deploy-key marker ${stamp}\n`,
    { mode: 0o600 },
  );
  git(["-C", clonePath, "add", "--", marker]);
  git([
    "-C",
    clonePath,
    "commit",
    "--quiet",
    "-m",
    "AP2 disposable deploy-key probe",
  ]);
  const pushedSha = git(["-C", clonePath, "rev-parse", "HEAD"]).trim();

  // A failed push is ambiguous, so cleanup must reconcile this exact branch.
  branchMayExist = true;
  git(
    ["-C", clonePath, "push", "--quiet", "--set-upstream", "origin", branch],
    true,
  );
  const remoteLine = git([
    "-C",
    clonePath,
    "ls-remote",
    "origin",
    `refs/heads/${branch}`,
  ]).trim();
  const verifiedRemoteSha = remoteLine.split(/\s+/)[0] || "";
  if (verifiedRemoteSha !== pushedSha) {
    throw new Error("SSH ls-remote did not return the pushed commit");
  }

  let lastUsed = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const key = (await request(`${repositoryApi}/keys/${keyId}`)).value;
    lastUsed = typeof key?.last_used === "string" ? key.last_used : null;
    if (lastUsed) break;
    await sleep(5_000);
  }

  removeBranchIfPresent();
  await removeKeyIfPresent();

  const afterKeys = (await request(`${repositoryApi}/keys`)).value;
  const afterMainSha = (await request(`${repositoryApi}/commits/main`)).value
    ?.sha;
  const branchLookupAfter = (
    await request(`${repositoryApi}/git/ref/heads/${branch}`)
  ).status;
  if (
    !Array.isArray(afterKeys) ||
    afterKeys.length !== 0 ||
    afterMainSha !== beforeMainSha ||
    branchLookupAfter !== 404
  ) {
    throw new Error("remote cleanup or main-protection verification failed");
  }

  console.log(
    JSON.stringify(
      {
        repository,
        branch,
        beforeMainSha,
        pushedSha,
        verifiedRemoteSha,
        afterMainSha,
        deployKeyCountAfter: 0,
        branchLookupAfter,
        lastUsed,
      },
      null,
      2,
    ),
  );
} catch (error) {
  operationError = error;
  throw error;
} finally {
  const cleanupErrors = [];
  try {
    removeBranchIfPresent();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await removeKeyIfPresent();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    rmSync(runDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      operationError ? [operationError, ...cleanupErrors] : cleanupErrors,
      "deploy-key cleanup failed",
    );
  }
}
