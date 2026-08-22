import { describe, expect, it } from "vitest";
import {
  BASELINE_POLICIES,
  assertExpectedPolicyShape,
  baselinePolicyBodies,
} from "./entra-security-baseline.mjs";

describe("Entra standing security baseline", () => {
  it("contains only broad MFA, legacy-auth block, and device-code block", () => {
    const policies = baselinePolicyBodies();
    expect(policies.map((policy) => policy.displayName)).toEqual([
      BASELINE_POLICIES.mfa,
      BASELINE_POLICIES.legacy,
      BASELINE_POLICIES.deviceCode,
    ]);
    for (const policy of policies) {
      expect(policy.state).toBe("enabledForReportingButNotEnforced");
      expect(policy.conditions.users).toMatchObject({ includeUsers: ["All"], excludeUsers: [] });
      expect(policy.conditions.applications).toMatchObject({
        includeApplications: ["All"],
        excludeApplications: [],
      });
      expect(policy.conditions).not.toHaveProperty("userRiskLevels");
      expect(policy.conditions).not.toHaveProperty("signInRiskLevels");
      expect(policy.conditions).not.toHaveProperty("platforms");
      expect(policy.conditions).not.toHaveProperty("locations");
      expect(policy.conditions).not.toHaveProperty("devices");
      expect(policy).not.toHaveProperty("sessionControls");
    }
    expect(policies[0].grantControls).toEqual({ operator: "OR", builtInControls: ["mfa"] });
    expect(policies[1].conditions.clientAppTypes).toEqual(["exchangeActiveSync", "other"]);
    expect(policies[1].grantControls.builtInControls).toEqual(["block"]);
    expect(policies[2].conditions.authenticationFlows).toEqual({ transferMethods: "deviceCodeFlow" });
    expect(policies[2].grantControls.builtInControls).toEqual(["block"]);
  });

  it("accepts Graph normalization without widening the baseline", () => {
    for (const expected of baselinePolicyBodies()) {
      const actual = structuredClone(expected);
      actual.id = crypto.randomUUID();
      actual.conditions.userRiskLevels = [];
      actual.conditions.signInRiskLevels = [];
      actual.conditions.platforms = null;
      actual.conditions.locations = null;
      actual.conditions.devices = null;
      actual.sessionControls = null;
      expect(() => assertExpectedPolicyShape(actual, expected, expected.state)).not.toThrow();
    }
  });
});
