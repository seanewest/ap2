import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baselinePolicyBodies } from "./entra-security-baseline.mjs";
import {
  APPLY_CONFIRMATION,
  comparePolicies,
  graphPatch,
  validateDesiredState,
} from "./student-tenant-desired-state.mjs";

const desired = () => JSON.parse(fs.readFileSync(
  path.join(process.cwd(), "infra/student-tenant-desired-state/conditional-access.json"),
  "utf8",
));

const live = () => baselinePolicyBodies("enabled").map((policy, index) => ({
  ...structuredClone(policy),
  id: desired().resources[index].properties.Id,
  conditions: {
    ...structuredClone(policy.conditions),
    userRiskLevels: [],
    signInRiskLevels: [],
    platforms: null,
    locations: null,
    devices: null,
  },
  sessionControls: null,
}));

describe("Student tenant desired state", () => {
  it("models exactly the three existing W73 identities", () => {
    const value = validateDesiredState(desired());
    expect(value.resources).toHaveLength(3);
    expect(new Set(value.resources.map((resource) => resource.properties.Id)).size).toBe(3);
    expect(comparePolicies(value, live()).map((result) => result.status)).toEqual([
      "matched", "matched", "matched",
    ]);
  });

  it("detects property drift without treating Graph normalization as drift", () => {
    const policies = live();
    policies[0].state = "disabled";
    const result = comparePolicies(desired(), policies);
    expect(result[0]).toMatchObject({ status: "drifted", changedProperties: ["State"] });
    expect(result.slice(1).map((entry) => entry.status)).toEqual(["matched", "matched"]);
  });

  it("refuses duplicate names and never generates POST or DELETE operations", () => {
    const policies = live();
    policies.push({ ...structuredClone(policies[0]), id: crypto.randomUUID() });
    expect(() => comparePolicies(desired(), policies)).toThrow(/ambiguous/);
    expect(APPLY_CONFIRMATION).toBe("PATCH-EXISTING-W73-POLICIES");
    expect(graphPatch(desired().resources[2].properties)).toMatchObject({
      state: "enabled",
      conditions: { authenticationFlows: { transferMethods: "deviceCodeFlow" } },
      grantControls: { builtInControls: ["block"] },
    });
  });
});
