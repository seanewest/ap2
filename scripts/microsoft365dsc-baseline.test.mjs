import fs from "node:fs";
import { describe, expect, it } from "vitest";

const configuration = fs.readFileSync(
  "infra/microsoft365dsc/AP2StudentBaseline.ps1",
  "utf8",
);
const invocation = fs.readFileSync(
  "scripts/invoke-microsoft365dsc-baseline.ps1",
  "utf8",
);

describe("Microsoft365DSC Student baseline", () => {
  it("pins the proven module and models the selected portable resources", () => {
    expect(configuration).toContain("-ModuleVersion '1.26.715.1'");
    expect(configuration.match(/AADConditionalAccessPolicy\s+/g)).toHaveLength(3);
    expect(configuration).toContain("IntuneWindowsUpdateForBusinessRingUpdateProfileWindows10");
    expect(configuration).toContain("IntuneWindowsUpdateForBusinessFeatureUpdateProfileWindows10");
    expect(configuration).toContain("AADGroup RetainedManagedWindowsEndpoints");
  });

  it("uses names and logical assignment bindings rather than development object IDs", () => {
    expect(configuration).toContain("groupDisplayName                           = 'AP2 retained managed Windows endpoints'");
    expect(configuration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(configuration).not.toMatch(/^\s*Id\s*=/m);
  });

  it("retains the exact W73 and W76 semantics", () => {
    expect(configuration).toContain("BuiltInControls                          = @('mfa')");
    expect(configuration).toContain("ClientAppTypes                           = @('exchangeActiveSync', 'other')");
    expect(configuration).toContain("TransferMethods                          = 'deviceCodeFlow'");
    expect(configuration).toContain("QualityUpdatesDeferralPeriodInDays      = 3");
    expect(configuration).toContain("DeadlineForQualityUpdatesInDays         = 7");
    expect(configuration).toContain("FeatureUpdateVersion                              = 'Windows 11, version 24H2'");
    expect(configuration).toContain("InstallFeatureUpdatesOptional                     = $false");
  });

  it("keeps access tokens and generated MOFs outside Git and gates apply", () => {
    expect(configuration).toContain("AccessTokens");
    expect(invocation).toContain("AP2_M365DSC_TENANT_DOMAIN");
    expect(invocation).toContain("AP2_M365DSC_GRAPH_ACCESS_TOKEN");
    expect(invocation).toContain("Generated MOFs must stay outside the AP2 repository.");
    expect(invocation).toContain("APPLY-AP2-STUDENT-M365DSC-BASELINE");
    expect(invocation).toContain("if ($before)");
    expect(invocation).toContain("$convergenceExecuted = $false");
    expect(invocation).toContain("Remove-DscConfigurationDocument -Stage Current");
  });
});
