import { readTrackedPathsFromIndex } from "./windows-host-boundary.ts";

export const REPOSITORY_ARTIFACT_HYGIENE_LABEL =
  "REPOSITORY_ARTIFACT_HYGIENE" as const;

export const REPOSITORY_ARTIFACT_CATEGORIES = [
  "GENERATED_OUTPUT",
  "COVERAGE_OR_TEST_REPORT",
  "CACHE_OR_PACKAGE_RESIDUE",
  "LOCAL_ENVIRONMENT",
  "BROWSER_OR_SESSION_STATE",
  "CREDENTIAL_OR_CERTIFICATE",
  "CONTAINER_RESIDUE",
  "PROTECTED_WORKER_ARTIFACT",
  "TEMPORARY_ARTIFACT",
] as const;

export type RepositoryArtifactCategory =
  (typeof REPOSITORY_ARTIFACT_CATEGORIES)[number];

export type RepositoryArtifactFinding = Readonly<{
  file: string;
  category: RepositoryArtifactCategory;
}>;

export type RepositoryArtifactHygieneResult = Readonly<{
  schemaVersion: 1;
  label: typeof REPOSITORY_ARTIFACT_HYGIENE_LABEL;
  status: "pass" | "fail";
  trackedFiles: number;
  findings: readonly RepositoryArtifactFinding[];
}>;

const MAX_TRACKED_FILES = 4_096;
const MAX_FINDINGS = 128;

const GENERATED_DIRECTORIES = new Set([
  "build",
  "dist",
  "dist-api",
  "dist-calling-bot",
]);
const REPORT_DIRECTORIES = new Set([
  "coverage",
  "playwright-report",
  "test-results",
]);
const CACHE_DIRECTORIES = new Set([
  ".cache",
  ".npm",
  ".pnpm-store",
  ".turbo",
  ".vite",
  ".vitest",
  "node_modules",
]);
const SESSION_DIRECTORIES = new Set([".auth", ".playwright"]);
const PROTECTED_DIRECTORIES = new Set([
  ".captain",
  ".worker",
  "evidence",
  "private-evidence",
  "protected",
]);

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function hasDirectory(path: string, directories: ReadonlySet<string>): boolean {
  return path
    .split("/")
    .slice(0, -1)
    .some((part) => directories.has(part.toLowerCase()));
}

export function categoryForRepositoryArtifact(
  path: string,
): RepositoryArtifactCategory | undefined {
  const name = basename(path);
  const lowerName = name.toLowerCase();
  const suffix = extension(path);

  if (hasDirectory(path, GENERATED_DIRECTORIES)) {
    return "GENERATED_OUTPUT";
  }
  if (hasDirectory(path, REPORT_DIRECTORIES)) {
    return "COVERAGE_OR_TEST_REPORT";
  }
  if (
    hasDirectory(path, CACHE_DIRECTORIES) ||
    suffix === ".tgz"
  ) {
    return "CACHE_OR_PACKAGE_RESIDUE";
  }
  if (
    lowerName === ".npmrc" ||
    (lowerName.startsWith(".env") &&
      ![".env.example", ".env.sample", ".env.template"].includes(lowerName))
  ) {
    return "LOCAL_ENVIRONMENT";
  }
  if (
    hasDirectory(path, SESSION_DIRECTORIES) ||
    [
      "browser-session.json",
      "session-state.json",
      "storage-state.json",
    ].includes(lowerName)
  ) {
    return "BROWSER_OR_SESSION_STATE";
  }
  if (
    [".cer", ".crt", ".key", ".p12", ".pem", ".pfx"].includes(suffix) ||
    (suffix === ".json" &&
      /(?:^|[-_.])(?:credential|credentials|secret|secrets|token|tokens)(?:[-_.]|$)/u.test(
        lowerName,
      ))
  ) {
    return "CREDENTIAL_OR_CERTIFICATE";
  }
  if (
    [".cid", ".pid"].includes(suffix) ||
    lowerName === "docker-compose.override.yml" ||
    path.startsWith(".docker/tmp/")
  ) {
    return "CONTAINER_RESIDUE";
  }
  if (
    hasDirectory(path, PROTECTED_DIRECTORIES) ||
    /^(?:captain|worker)-/u.test(lowerName) ||
    /^(?:cleanup|run)-journal(?:[.-]|$)/u.test(lowerName)
  ) {
    return "PROTECTED_WORKER_ARTIFACT";
  }
  if (
    [".log", ".swp", ".temp", ".tmp", ".tsbuildinfo"].includes(suffix) ||
    lowerName === ".ds_store" ||
    lowerName.endsWith("~")
  ) {
    return "TEMPORARY_ARTIFACT";
  }
  return undefined;
}

export function scanRepositoryArtifactPaths(
  paths: readonly string[],
): RepositoryArtifactHygieneResult {
  if (paths.length > MAX_TRACKED_FILES) {
    throw new Error("REPOSITORY_ARTIFACT_HYGIENE_FILE_LIMIT");
  }
  const findings: RepositoryArtifactFinding[] = [];
  const sorted = [...new Set(paths)].sort((left, right) =>
    left.localeCompare(right),
  );

  for (const file of sorted) {
    const category = categoryForRepositoryArtifact(file);
    if (category) {
      findings.push({ file, category });
      if (findings.length > MAX_FINDINGS) {
        throw new Error("REPOSITORY_ARTIFACT_HYGIENE_FINDING_LIMIT");
      }
    }
  }

  return {
    schemaVersion: 1,
    label: REPOSITORY_ARTIFACT_HYGIENE_LABEL,
    status: findings.length === 0 ? "pass" : "fail",
    trackedFiles: sorted.length,
    findings,
  };
}

export function scanTrackedRepositoryArtifacts(
  root: string,
): RepositoryArtifactHygieneResult {
  return scanRepositoryArtifactPaths(
    readTrackedPathsFromIndex(root).map(({ path }) => path),
  );
}
