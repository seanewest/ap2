// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("scenario surface inventory CLI", () => {
  it("prints the deterministic valid inventory without network access", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-scenario-surface-inventory.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      kind: "canonical-scenario-surface-inventory",
      status: "valid",
      failures: [],
    });
  });

  it("rejects arguments before importing or printing contract data", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-scenario-surface-inventory.ts", "unexpected"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      schemaVersion: 1,
      kind: "canonical-scenario-surface-inventory",
      status: "invalid",
      scenarios: [],
      failures: [{
        scenarioId: "unknown",
        surface: "inventory",
        code: "BOUNDS_EXCEEDED",
      }],
    });
  });
});
