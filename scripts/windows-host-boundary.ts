import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { categoriesForWindowsHostBoundary } from "./windows-host-boundary-signatures.ts";

export const WINDOWS_HOST_BOUNDARY_LABEL = "WINDOWS_HOST_BOUNDARY" as const;

export const WINDOWS_HOST_BOUNDARY_CATEGORIES = [
  "WINDOWS_EXECUTABLE_INVOCATION",
  "WINDOWS_MOUNT_EXECUTION",
  "WSL_PROCESS_BRIDGE",
  "WINDOWS_SHELL_LAUNCH",
  "WINDOWS_APP_PACKAGE_LAUNCH",
  "SHARED_HOST_GUI_CONTROL",
  "SHARED_HOST_INPUT_AUTOMATION",
  "SHARED_HOST_SESSION_CAPTURE",
] as const;

export type WindowsHostBoundaryCategory =
  (typeof WINDOWS_HOST_BOUNDARY_CATEGORIES)[number];

export type WindowsHostBoundaryFinding = Readonly<{
  file: string;
  category: WindowsHostBoundaryCategory;
}>;

export type WindowsHostBoundaryResult = Readonly<{
  schemaVersion: 1;
  label: typeof WINDOWS_HOST_BOUNDARY_LABEL;
  status: "pass" | "fail";
  scannedFiles: number;
  findings: readonly WindowsHostBoundaryFinding[];
}>;

export type RepositoryText = Readonly<{
  path: string;
  content: string;
}>;

const MAX_GIT_POINTER_BYTES = 4_096;
const MAX_GIT_INDEX_BYTES = 8_388_608;
const MAX_TRACKED_ENTRIES = 4_096;
const MAX_SCANNED_FILES = 2_048;
const MAX_FILE_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 16_777_216;
const MAX_FINDINGS = 128;

const ROOT_EXECUTABLE_FILES = new Set([
  "package.json",
  "playwright.cba.config.ts",
  "playwright.local.config.ts",
  "vite.api.config.ts",
  "vite.config.ts",
  "vitest.config.ts",
]);

const EXECUTABLE_EXTENSIONS = new Set([
  ".bash",
  ".bat",
  ".cjs",
  ".cmd",
  ".hta",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".ps1",
  ".psm1",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
  ".vbs",
  ".wsf",
  ".yaml",
  ".yml",
  ".zsh",
]);

const EXACT_EXCLUDED_FILES = new Set([
  "package-lock.json",
  "scripts/windows-host-boundary-signatures.ts",
  // These fixed recovered methods send input only to an isolated remote AVD
  // canvas or ARM guest Run Command. Their tests reject local launch
  // primitives and Windows-mounted paths where applicable.
  "scripts/w52-kobe-collection-boundary.mjs",
  "scripts/w52-kobe-youtrack-boundary.mjs",
  "scripts/endpoint-background-kobe.mjs",
  "scripts/endpoint-background-methods.test.mjs",
  "scripts/endpoint-background-system.mjs",
  "scripts/kobe-run-dialog-defender-proof.mjs",
  "scripts/kobe-run-dialog-defender-proof.test.ts",
  // This bounded method sends input only to an isolated remote AVD canvas or
  // ARM guest Run Command; it does not launch or control the worker host GUI.
  "scripts/guest-clickfix-proof.mjs",
  "scripts/guest-clickfix-proof.test.ts",
  // This first-leg proof likewise targets only Rachel's isolated remote AVD
  // canvas and ARM guest Run Command. Its paired test rejects local process,
  // Windows-mount, clipboard-read, and credential-literal primitives.
  "scripts/rachel-enrollment-session-proof.mjs",
  "scripts/rachel-enrollment-session-proof.test.ts",
  // This standing GSA reconciler executes only through ARM guest Run Command
  // on Rachel's isolated AVD VM; it has no local launch primitive.
  "scripts/rachel-gsa-standing.mjs",
]);

const EXACT_EXCLUDED_PREFIXES = [
  "coverage/",
  "dist/",
  "dist-api/",
  "dist-calling-bot/",
  "docs/",
  "evidence/",
  "node_modules/",
  "protected/",
  "scripts/fixtures/",
];
const SAFE_REPOSITORY_PATH = /^[A-Za-z0-9._@/-]+$/u;

function isSafeRepositoryPath(path: string): boolean {
  return (
    path !== "" &&
    SAFE_REPOSITORY_PATH.test(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function isExplicitlyExcluded(path: string): boolean {
  return (
    EXACT_EXCLUDED_FILES.has(path) ||
    EXACT_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export function isWindowsHostBoundarySurface(path: string): boolean {
  if (
    !isSafeRepositoryPath(path)
  ) {
    return false;
  }
  if (isExplicitlyExcluded(path)) {
    return false;
  }
  if (ROOT_EXECUTABLE_FILES.has(path)) {
    return true;
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "Dockerfile" || EXECUTABLE_EXTENSIONS.has(extension(path));
}

export function scanWindowsHostBoundary(
  files: readonly RepositoryText[],
): WindowsHostBoundaryResult {
  if (files.length > MAX_SCANNED_FILES) {
    throw new Error("WINDOWS_HOST_BOUNDARY_FILE_LIMIT");
  }

  let totalBytes = 0;
  const findings: WindowsHostBoundaryFinding[] = [];
  const sorted = [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  for (const file of sorted) {
    if (!isWindowsHostBoundarySurface(file.path)) {
      throw new Error("WINDOWS_HOST_BOUNDARY_UNSCOPED_FILE");
    }
    const bytes = Buffer.byteLength(file.content);
    if (bytes > MAX_FILE_BYTES) {
      throw new Error("WINDOWS_HOST_BOUNDARY_FILE_SIZE_LIMIT");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("WINDOWS_HOST_BOUNDARY_TOTAL_SIZE_LIMIT");
    }
    for (const category of categoriesForWindowsHostBoundary(file.content, file.path)) {
      findings.push({ file: file.path, category });
      if (findings.length > MAX_FINDINGS) {
        throw new Error("WINDOWS_HOST_BOUNDARY_FINDING_LIMIT");
      }
    }
  }

  return {
    schemaVersion: 1,
    label: WINDOWS_HOST_BOUNDARY_LABEL,
    status: findings.length === 0 ? "pass" : "fail",
    scannedFiles: sorted.length,
    findings,
  };
}

function isWindowsMountPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === "/mnt/c" || lower.startsWith("/mnt/c/");
}

function repositoryGitDirectory(root: string): string {
  const dotGit = resolve(root, ".git");
  const dotGitStat = lstatSync(dotGit);
  if (dotGitStat.isSymbolicLink()) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
  }
  if (dotGitStat.isDirectory()) {
    const directory = realpathSync(dotGit);
    if (isWindowsMountPath(directory)) {
      throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
    }
    return directory;
  }
  if (!dotGitStat.isFile() || dotGitStat.size > MAX_GIT_POINTER_BYTES) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
  }
  const pointer = readFileSync(dotGit, "utf8").trim();
  if (!pointer.startsWith("gitdir: ")) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
  }
  const directory = resolve(root, pointer.slice("gitdir: ".length));
  if (isWindowsMountPath(directory)) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
  }
  const directoryStat = lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
  }
  const realDirectory = realpathSync(directory);
  if (isWindowsMountPath(realDirectory)) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY");
  }
  return realDirectory;
}

export type GitIndexEntry = Readonly<{
  path: string;
  executable: boolean;
}>;

export function parseGitIndex(index: Buffer): GitIndexEntry[] {
  if (index.length > MAX_GIT_INDEX_BYTES) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INDEX_SIZE_LIMIT");
  }
  if (index.length < 32 || index.subarray(0, 4).toString("ascii") !== "DIRC") {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX");
  }
  const version = index.readUInt32BE(4);
  if (version !== 2 && version !== 3) {
    throw new Error("WINDOWS_HOST_BOUNDARY_UNSUPPORTED_GIT_INDEX");
  }
  const count = index.readUInt32BE(8);
  if (count > MAX_TRACKED_ENTRIES) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INDEX_LIMIT");
  }

  const entries: GitIndexEntry[] = [];
  let offset = 12;
  for (let entry = 0; entry < count; entry += 1) {
    if (offset + 62 > index.length) {
      throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX");
    }
    const mode = index.readUInt32BE(offset + 24);
    const flags = index.readUInt16BE(offset + 60);
    const stage = (flags >> 12) & 0x3;
    const extended = (flags & 0x4000) !== 0;
    if (stage !== 0 || extended || (mode & 0o170000) !== 0o100000) {
      throw new Error("WINDOWS_HOST_BOUNDARY_UNSUPPORTED_GIT_INDEX");
    }
    const pathStart = offset + 62;
    const pathEnd = index.indexOf(0, pathStart);
    if (pathEnd < pathStart) {
      throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX");
    }
    const path = index.subarray(pathStart, pathEnd).toString("utf8");
    if (!isSafeRepositoryPath(path)) {
      throw new Error("WINDOWS_HOST_BOUNDARY_UNSAFE_GIT_PATH");
    }
    entries.push({
      path,
      executable: (mode & 0o111) !== 0,
    });
    const entryBytes = 62 + (pathEnd - pathStart) + 1;
    offset += Math.ceil(entryBytes / 8) * 8;
  }

  while (offset < index.length - 20) {
    if (offset + 8 > index.length - 20) {
      throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX");
    }
    const signature = index.subarray(offset, offset + 4).toString("ascii");
    const size = index.readUInt32BE(offset + 4);
    if (
      signature[0] === signature[0]?.toLowerCase() ||
      offset + 8 + size > index.length - 20
    ) {
      throw new Error("WINDOWS_HOST_BOUNDARY_UNSUPPORTED_GIT_INDEX");
    }
    offset += 8 + size;
  }
  if (index.length - offset !== 20) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX");
  }

  return [...new Map(entries.map((entry) => [entry.path, entry])).values()].sort(
    (left, right) => left.path.localeCompare(right.path),
  );
}

export function readTrackedPathsFromIndex(root: string): GitIndexEntry[] {
  const gitDirectory = repositoryGitDirectory(root);
  const indexPath = resolve(gitDirectory, "index");
  const indexStat = lstatSync(indexPath);
  if (
    indexStat.isSymbolicLink() ||
    !indexStat.isFile() ||
    indexStat.size > MAX_GIT_INDEX_BYTES
  ) {
    throw new Error("WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX");
  }
  return parseGitIndex(readFileSync(indexPath));
}

export function scanTrackedRepository(root: string): WindowsHostBoundaryResult {
  const requestedRoot = resolve(root);
  if (isWindowsMountPath(requestedRoot)) {
    throw new Error("WINDOWS_HOST_BOUNDARY_PATH_ESCAPE");
  }
  const absoluteRoot = realpathSync(requestedRoot);
  if (isWindowsMountPath(absoluteRoot)) {
    throw new Error("WINDOWS_HOST_BOUNDARY_PATH_ESCAPE");
  }
  const files: RepositoryText[] = [];
  let totalBytes = 0;
  for (const { path, executable } of readTrackedPathsFromIndex(absoluteRoot)) {
    if (
      isExplicitlyExcluded(path) ||
      (!isWindowsHostBoundarySurface(path) && !executable)
    ) {
      continue;
    }
    if (files.length >= MAX_SCANNED_FILES) {
      throw new Error("WINDOWS_HOST_BOUNDARY_FILE_LIMIT");
    }
    const absolutePath = resolve(absoluteRoot, path);
    const fromRoot = relative(absoluteRoot, absolutePath);
    if (
      isAbsolute(fromRoot) ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`)
    ) {
      throw new Error("WINDOWS_HOST_BOUNDARY_PATH_ESCAPE");
    }
    const fileStat = lstatSync(absolutePath);
    if (
      fileStat.isSymbolicLink() ||
      !fileStat.isFile() ||
      fileStat.size > MAX_FILE_BYTES
    ) {
      throw new Error("WINDOWS_HOST_BOUNDARY_NON_REGULAR_FILE");
    }
    totalBytes += fileStat.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("WINDOWS_HOST_BOUNDARY_TOTAL_SIZE_LIMIT");
    }
    files.push({ path, content: readFileSync(absolutePath, "utf8") });
  }
  return scanWindowsHostBoundary(files);
}
