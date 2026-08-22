import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("managed Global Secure Access baseline", () => {
  const baseline = readFileSync("scripts/global-secure-access-baseline.mjs", "utf8");
  const installer = readFileSync("scripts/global-secure-access-client-install.ps1", "utf8");
  const endpoint = readFileSync("scripts/global-secure-access-endpoint-observe.mjs", "utf8");
  const rachel = readFileSync("scripts/rachel-gsa-standing.mjs", "utf8");

  it("uses exact managed device and direct-member user scopes", () => {
    expect(baseline).toContain('const DEVICE_GROUP_NAME = "AP2 retained managed Windows endpoints"');
    expect(baseline).toContain('const USER_GROUP_NAME = "AP2 retained managed Windows users"');
    expect(baseline).toContain('principalType !== "Group"');
    expect(baseline).toContain('intent: "required"');
    expect(baseline).toContain('runAsAccount: "system"');
    expect(baseline).toContain('operator: "greaterThanOrEqual"');
    expect(baseline).toContain("consecutiveAbsentReads === 5");
  });

  it("hides only the profile launch surface and retains the Rachel-only TLS path", () => {
    expect(baseline).toContain('tags.add("HideApp")');
    expect(rachel).toContain('const RETAINED_GSA_USER_GROUP_NAME = "AP2 retained managed Windows users"');
    expect(rachel).toContain('const INSPECTION_CA_POLICY_NAME = "AP2 Rachel TLS inspection assignment"');
    expect(rachel).not.toContain('new Set(["inspect", "inspection", "tls-reconcile", "assign", "install"');
  });

  it("keeps endpoint delivery and observation bounded", () => {
    expect(installer).toContain('-ArgumentList "/quiet"');
    expect(installer).toContain("exit 3010");
    expect(endpoint).toContain('powerChanged: false');
    expect(endpoint).not.toContain("/deallocate?");
    expect(endpoint).not.toContain("/stop?");
  });
});
