// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateSpaBundleBudget,
  SPA_BUNDLE_LIMITS,
  type SpaBundleFile,
} from "./spa-bundle-budget.ts";

const baseline: readonly SpaBundleFile[] = [
  { path: "assets/index.js", bytes: 445_626 },
  { path: "assets/index.css", bytes: 10_134 },
  { path: "index.html", bytes: 534 },
];

describe("SPA bundle budget", () => {
  it("accepts the measured production shape with bounded headroom", () => {
    expect(evaluateSpaBundleBudget(baseline)).toEqual({
      schemaVersion: 1,
      label: "SPA_BUNDLE_BUDGET",
      status: "pass",
      metrics: {
        fileCount: 3,
        javaScriptChunkCount: 1,
        cssAssetCount: 1,
        otherAssetCount: 0,
        sourceMapCount: 0,
        largestFileBytes: 445_626,
        totalBytes: 456_294,
      },
      limits: SPA_BUNDLE_LIMITS,
      failures: [],
    });
  });

  it("fails on genuine size, source-map, and duplicate-chunk regressions", () => {
    const oversized = baseline.map((file) =>
      file.path.endsWith(".js")
        ? { ...file, bytes: SPA_BUNDLE_LIMITS.maximumSingleFileBytes + 1 }
        : file
    );
    expect(evaluateSpaBundleBudget(oversized).failures).toEqual([
      "SINGLE_FILE_BYTES_EXCEEDED",
    ]);

    expect(evaluateSpaBundleBudget([
      ...baseline,
      { path: "assets/index.js.map", bytes: 1 },
    ]).failures).toEqual(["SOURCE_MAP_PRESENT"]);

    const chunks = Array.from({
      length: SPA_BUNDLE_LIMITS.maximumJavaScriptChunkCount + 1,
    }, (_, index) => ({
      path: `assets/chunk-${index}.js`,
      bytes: 1,
    }));
    expect(evaluateSpaBundleBudget([
      { path: "index.html", bytes: 1 },
      ...chunks,
    ]).failures).toEqual(["JAVASCRIPT_CHUNK_COUNT_EXCEEDED"]);
  });

  it("fails on total growth, excess assets, and a missing entry", () => {
    expect(evaluateSpaBundleBudget([
      { path: "index.html", bytes: 1 },
      { path: "assets/app.js", bytes: 300_000 },
      { path: "assets/image.bin", bytes: 300_000 },
    ]).failures).toEqual(["TOTAL_BYTES_EXCEEDED"]);

    const files = Array.from({
      length: SPA_BUNDLE_LIMITS.maximumFileCount + 1,
    }, (_, index) => ({
      path: index === 0 ? "index.html" : `assets/file-${index}.bin`,
      bytes: 1,
    }));
    expect(evaluateSpaBundleBudget(files).failures).toEqual([
      "FILE_COUNT_EXCEEDED",
    ]);
    expect(evaluateSpaBundleBudget([]).failures).toEqual(["ENTRY_MISSING"]);
  });

  it("is wired into the established production build after Vite", () => {
    const packageJson = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["check:spa-bundle"]).toBe(
      "node scripts/check-spa-bundle-budget.ts",
    );
    expect(packageJson.scripts.build).toContain(
      "vite build && npm run check:spa-bundle && node scripts/build-docs.ts",
    );
  });
});
