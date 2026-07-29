// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkApiDeploymentReplicaPlan,
} from "./api-single-replica-contract.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("API deployment single-replica plan", () => {
  it("returns only the fixed safe contract for an exact plan", () => {
    expect(checkApiDeploymentReplicaPlan({
      schemaVersion: 1,
      target: "ca-ap2-api",
      minReplicas: 1,
      maxReplicas: 1,
    })).toEqual({
      schemaVersion: 1,
      label: "API_SINGLE_REPLICA_CONTRACT",
      status: "valid",
      target: "ca-ap2-api",
      minReplicas: 1,
      maxReplicas: 1,
    });
  });

  it.each([
    ["two replicas", { schemaVersion: 1, target: "ca-ap2-api", minReplicas: 1, maxReplicas: 2 }],
    ["zero minimum", { schemaVersion: 1, target: "ca-ap2-api", minReplicas: 0, maxReplicas: 1 }],
    ["wrong target", { schemaVersion: 1, target: "other-api", minReplicas: 1, maxReplicas: 1 }],
    ["unknown field", { schemaVersion: 1, target: "ca-ap2-api", minReplicas: 1, maxReplicas: 1, ready: true }],
  ] as const)("refuses %s", (_name, plan) => {
    expect(() => checkApiDeploymentReplicaPlan(plan)).toThrow(
      "required single-replica shape",
    );
  });

  it("runs against the committed canonical plan and rejects drift", () => {
    const accepted = spawnSync(
      process.execPath,
      [
        "scripts/api-single-replica-contract.ts",
        "scripts/fixtures/api-single-replica-plan.json",
      ],
      { encoding: "utf8" },
    );
    expect(accepted.status).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      status: "valid",
      target: "ca-ap2-api",
      minReplicas: 1,
      maxReplicas: 1,
    });

    const directory = mkdtempSync(join(tmpdir(), "ap2-api-replicas-"));
    temporaryDirectories.push(directory);
    const planPath = join(directory, "drift.json");
    writeFileSync(planPath, JSON.stringify({
      schemaVersion: 1,
      target: "ca-ap2-api",
      minReplicas: 1,
      maxReplicas: 2,
    }));
    const refused = spawnSync(
      process.execPath,
      ["scripts/api-single-replica-contract.ts", planPath],
      { encoding: "utf8" },
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr.trim()).toBe("API replica plan refused.");
    expect(refused.stdout).toBe("");
  });
});
