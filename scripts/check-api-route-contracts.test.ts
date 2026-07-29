// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { API_ROUTE_OWNER_KEYS } from "../src/api/api-route-contract.ts";

describe("API route contract CLI", () => {
  it("prints a deterministic sanitized matrix without network access", () => {
    const first = run();
    const second = run();
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(second.stdout).toBe(first.stdout);
    expect(JSON.parse(first.stdout)).toMatchObject({
      schemaVersion: 1,
      label: "API_ROUTE_CONTRACT_INVENTORY",
      status: "valid",
      failures: [],
      routes: expect.arrayContaining(
        API_ROUTE_OWNER_KEYS.map((ownerKey) =>
          expect.objectContaining({ ownerKey })
        ),
      ),
    });
  });

  it("rejects arguments with one fixed categorical error", () => {
    const result = run(["unexpected"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      schemaVersion: 1,
      label: "API_ROUTE_CONTRACT_INVENTORY",
      status: "invalid",
      routes: [],
      failures: [{ ownerKey: "inventory", category: "INPUT_SHAPE" }],
    });
  });
});

function run(arguments_: string[] = []) {
  return spawnSync(
    process.execPath,
    ["scripts/check-api-route-contracts.ts", ...arguments_],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}
