import { describe, expect, it } from "vitest";
import {
  categoryForRepositoryArtifact,
  scanRepositoryArtifactPaths,
  scanTrackedRepositoryArtifacts,
  type RepositoryArtifactCategory,
} from "./repository-artifact-hygiene.ts";

const forbidden: readonly [string, RepositoryArtifactCategory][] = [
  ["dist/app.js", "GENERATED_OUTPUT"],
  ["coverage/index.html", "COVERAGE_OR_TEST_REPORT"],
  [".vite/cache.bin", "CACHE_OR_PACKAGE_RESIDUE"],
  ["node_modules/package/index.js", "CACHE_OR_PACKAGE_RESIDUE"],
  ["release.tgz", "CACHE_OR_PACKAGE_RESIDUE"],
  [".env.local", "LOCAL_ENVIRONMENT"],
  [".npmrc", "LOCAL_ENVIRONMENT"],
  [".auth/operator.json", "BROWSER_OR_SESSION_STATE"],
  ["storage-state.json", "BROWSER_OR_SESSION_STATE"],
  ["operator-token.json", "CREDENTIAL_OR_CERTIFICATE"],
  ["certificate.pfx", "CREDENTIAL_OR_CERTIFICATE"],
  ["container.cid", "CONTAINER_RESIDUE"],
  ["docker-compose.override.yml", "CONTAINER_RESIDUE"],
  ["protected/run.json", "PROTECTED_WORKER_ARTIFACT"],
  ["evidence/raw-observation.json", "PROTECTED_WORKER_ARTIFACT"],
  ["captain-local.mjs", "PROTECTED_WORKER_ARTIFACT"],
  ["worker-report.json", "PROTECTED_WORKER_ARTIFACT"],
  ["run-journal.json", "PROTECTED_WORKER_ARTIFACT"],
  ["debug.log", "TEMPORARY_ARTIFACT"],
  ["tsconfig.tsbuildinfo", "TEMPORARY_ARTIFACT"],
];

describe("repository artifact hygiene", () => {
  it("passes the current tracked repository", () => {
    expect(scanTrackedRepositoryArtifacts(process.cwd())).toMatchObject({
      schemaVersion: 1,
      label: "REPOSITORY_ARTIFACT_HYGIENE",
      status: "pass",
      findings: [],
    });
  });

  it.each(forbidden)("classifies %s", (path, category) => {
    expect(categoryForRepositoryArtifact(path)).toBe(category);
  });

  it("allows legitimate source, fixtures, and package metadata", () => {
    expect(
      scanRepositoryArtifactPaths([
        ".env.example",
        "Dockerfile",
        "api/token-verifier.ts",
        "package-lock.json",
        "scripts/fixtures/certificate-contract.json",
        "teams-calling-bot/journal.ts",
      ]),
    ).toMatchObject({ status: "pass", findings: [] });
  });

  it("is deterministic, de-duplicates paths, and reports no contents", () => {
    const paths = ["dist/private-value.js", ".env", "dist/private-value.js"];
    const forward = scanRepositoryArtifactPaths(paths);
    const reverse = scanRepositoryArtifactPaths([...paths].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.trackedFiles).toBe(2);
    expect(forward.findings).toEqual([
      { file: ".env", category: "LOCAL_ENVIRONMENT" },
      { file: "dist/private-value.js", category: "GENERATED_OUTPUT" },
    ]);
    expect(Object.keys(forward.findings[0] ?? {}).sort()).toEqual([
      "category",
      "file",
    ]);
  });

  it("bounds tracked paths and findings", () => {
    expect(() =>
      scanRepositoryArtifactPaths(
        Array.from({ length: 4_097 }, (_, index) => `src/${index}.ts`),
      ),
    ).toThrow("REPOSITORY_ARTIFACT_HYGIENE_FILE_LIMIT");
    expect(() =>
      scanRepositoryArtifactPaths(
        Array.from({ length: 129 }, (_, index) => `dist/${index}.js`),
      ),
    ).toThrow("REPOSITORY_ARTIFACT_HYGIENE_FINDING_LIMIT");
  });
});
