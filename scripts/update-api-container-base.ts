import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pinnedApiContainerBaseReference,
  resolveApiContainerBase,
  serializeApiContainerBaseLock,
  type ApiContainerBaseLock,
} from "./api-container-base.ts";

interface PackageManifest {
  dependencies?: Record<string, string>;
}

export async function updateApiContainerBase(
  repositoryRoot: string,
  resolver: (tag: string) => Promise<ApiContainerBaseLock> =
    resolveApiContainerBase,
): Promise<Record<string, unknown>> {
  const packagePath = join(repositoryRoot, "package.json");
  const dockerfilePath = join(repositoryRoot, "Dockerfile");
  const lockPath = join(repositoryRoot, "container-base-lock.json");
  const packageManifest = JSON.parse(
    readFileSync(packagePath, "utf8"),
  ) as PackageManifest;
  const version = packageManifest.dependencies?.playwright;
  if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("API_CONTAINER_BASE_UPDATE_PLAYWRIGHT_VERSION");
  }
  const tag = `v${version}-noble`;
  const lock = await resolver(tag);
  const reference = pinnedApiContainerBaseReference(lock);
  const currentDockerfile = readFileSync(dockerfilePath, "utf8");
  const fromLines = currentDockerfile.match(/^FROM\b.*$/gmu) ?? [];
  if (
    fromLines.length !== 2 ||
    !/^FROM --platform=linux\/amd64 mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble(?:@sha256:[0-9a-f]{64})? AS build$/u
      .test(fromLines[0]!) ||
    !/^FROM --platform=linux\/amd64 mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble(?:@sha256:[0-9a-f]{64})?$/u
      .test(fromLines[1]!)
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_DOCKERFILE");
  }
  const nextDockerfile = currentDockerfile
    .replace(fromLines[0]!, `FROM --platform=linux/amd64 ${reference} AS build`)
    .replace(fromLines[1]!, `FROM --platform=linux/amd64 ${reference}`);
  const nextLock = serializeApiContainerBaseLock(lock);
  const changed =
    nextDockerfile !== currentDockerfile ||
    !existsSync(lockPath) ||
    readFileSync(lockPath, "utf8") !== nextLock;
  if (!changed) {
    return updateSummary(lock, "unchanged");
  }
  const lockTemporary = `${lockPath}.tmp`;
  const dockerfileTemporary = `${dockerfilePath}.tmp`;
  writeFileSync(lockTemporary, nextLock, {
    encoding: "utf8",
    mode: 0o644,
  });
  writeFileSync(dockerfileTemporary, nextDockerfile, {
    encoding: "utf8",
    mode: 0o644,
  });
  renameSync(lockTemporary, lockPath);
  renameSync(dockerfileTemporary, dockerfilePath);
  return updateSummary(lock, "updated");
}

function updateSummary(
  lock: ApiContainerBaseLock,
  status: "unchanged" | "updated",
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    label: "API_CONTAINER_BASE_UPDATE",
    status,
    tag: lock.tag,
    indexDigest: lock.indexDigest,
    manifestDigest: lock.manifestDigest,
    platform: "linux/amd64",
  };
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new Error("API_CONTAINER_BASE_UPDATE_ARGUMENTS");
  }
  const repositoryRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  console.log(JSON.stringify(await updateApiContainerBase(repositoryRoot)));
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const category = error instanceof Error && /^API_CONTAINER_BASE_/u.test(
      error.message,
    )
      ? error.message
      : "API_CONTAINER_BASE_UPDATE_FAILED";
    console.error(JSON.stringify({
      schemaVersion: 1,
      label: "API_CONTAINER_BASE_UPDATE",
      status: "failed",
      category,
    }));
    process.exitCode = 1;
  });
}
