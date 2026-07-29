import {
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

export const SPA_BUNDLE_LIMITS = Object.freeze({
  maximumFileCount: 16,
  maximumJavaScriptChunkCount: 8,
  maximumSingleFileBytes: 512_000,
  maximumTotalBytes: 550_000,
  sourceMapsAllowed: false,
});

export const SPA_BUNDLE_FAILURES = [
  "ENTRY_MISSING",
  "FILE_COUNT_EXCEEDED",
  "JAVASCRIPT_CHUNK_COUNT_EXCEEDED",
  "SINGLE_FILE_BYTES_EXCEEDED",
  "SOURCE_MAP_PRESENT",
  "TOTAL_BYTES_EXCEEDED",
] as const;

export type SpaBundleFailure = typeof SPA_BUNDLE_FAILURES[number];

export interface SpaBundleFile {
  path: string;
  bytes: number;
}

export interface SpaBundleBudgetResult {
  schemaVersion: 1;
  label: "SPA_BUNDLE_BUDGET";
  status: "pass" | "fail";
  metrics: {
    fileCount: number;
    javaScriptChunkCount: number;
    cssAssetCount: number;
    otherAssetCount: number;
    sourceMapCount: number;
    largestFileBytes: number;
    totalBytes: number;
  };
  limits: typeof SPA_BUNDLE_LIMITS;
  failures: readonly SpaBundleFailure[];
}

export function evaluateSpaBundleBudget(
  files: readonly SpaBundleFile[],
): SpaBundleBudgetResult {
  const ordered = [...files].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const javaScriptChunkCount = ordered.filter(({ path }) =>
    path.endsWith(".js")
  ).length;
  const cssAssetCount = ordered.filter(({ path }) =>
    path.endsWith(".css")
  ).length;
  const sourceMapCount = ordered.filter(({ path }) =>
    path.endsWith(".map")
  ).length;
  const otherAssetCount = ordered.filter(({ path }) =>
    path.startsWith("assets/") &&
    !path.endsWith(".js") &&
    !path.endsWith(".css") &&
    !path.endsWith(".map")
  ).length;
  const totalBytes = ordered.reduce((sum, { bytes }) => sum + bytes, 0);
  const largestFileBytes = ordered.reduce(
    (largest, { bytes }) => Math.max(largest, bytes),
    0,
  );
  const failures: SpaBundleFailure[] = [];
  if (!ordered.some(({ path }) => path === "index.html")) {
    failures.push("ENTRY_MISSING");
  }
  if (ordered.length > SPA_BUNDLE_LIMITS.maximumFileCount) {
    failures.push("FILE_COUNT_EXCEEDED");
  }
  if (
    javaScriptChunkCount >
      SPA_BUNDLE_LIMITS.maximumJavaScriptChunkCount
  ) {
    failures.push("JAVASCRIPT_CHUNK_COUNT_EXCEEDED");
  }
  if (largestFileBytes > SPA_BUNDLE_LIMITS.maximumSingleFileBytes) {
    failures.push("SINGLE_FILE_BYTES_EXCEEDED");
  }
  if (!SPA_BUNDLE_LIMITS.sourceMapsAllowed && sourceMapCount > 0) {
    failures.push("SOURCE_MAP_PRESENT");
  }
  if (totalBytes > SPA_BUNDLE_LIMITS.maximumTotalBytes) {
    failures.push("TOTAL_BYTES_EXCEEDED");
  }
  return Object.freeze({
    schemaVersion: 1,
    label: "SPA_BUNDLE_BUDGET",
    status: failures.length === 0 ? "pass" : "fail",
    metrics: Object.freeze({
      fileCount: ordered.length,
      javaScriptChunkCount,
      cssAssetCount,
      otherAssetCount,
      sourceMapCount,
      largestFileBytes,
      totalBytes,
    }),
    limits: SPA_BUNDLE_LIMITS,
    failures: Object.freeze(failures),
  });
}

export function readSpaBundleFiles(root: string): readonly SpaBundleFile[] {
  const files: SpaBundleFile[] = [];
  walk(root, root, files);
  return Object.freeze(
    files
      .filter(({ path }) => !path.startsWith("gh-docs/"))
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
}

function walk(
  root: string,
  directory: string,
  files: SpaBundleFile[],
): void {
  for (
    const entry of readdirSync(directory, {
      encoding: "utf8",
      withFileTypes: true,
    })
  ) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(root, path, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new TypeError("SPA bundle contains a non-regular entry.");
    }
    files.push({
      path: relative(root, path).split(sep).join("/"),
      bytes: statSync(path).size,
    });
  }
}
