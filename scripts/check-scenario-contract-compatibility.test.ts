// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("scenario contract compatibility CLI", () => {
  it("runs directly under Node and reports the current categorical result", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-scenario-contract-compatibility.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    const output = JSON.parse(result.status === 0
      ? result.stdout
      : result.stderr);

    expect(output).toMatchObject({
      schemaVersion: 1,
      status: "compatible",
      failures: [],
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects arguments without loading or printing contract data", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-scenario-contract-compatibility.ts", "unexpected"],
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
      status: "drift",
      scenarios: [],
      failures: [{ scenarioId: "unknown", category: "BOUNDS_DRIFT" }],
    });
  });
});
