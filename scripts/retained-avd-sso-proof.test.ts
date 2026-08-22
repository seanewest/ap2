import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("retained AVD OS-backed SSO proof", () => {
  it("uses exact actors, a cookie-clean non-private Edge context, positive PRT gates, and no-power cleanup", () => {
    const source = readFileSync("scripts/retained-avd-sso-proof.mjs", "utf8");
    expect(source).toContain("rachel.green@corywest.onmicrosoft.com");
    expect(source).toContain("kobe@corywest.onmicrosoft.com");
    expect(source).toContain("enablerdsaadauth:i:1");
    expect(source).toContain("dsregcmd.exe /status");
    expect(source).toContain("AzureAdPrt");
    expect(source).toContain("WamDefaultSet");
    expect(source).toContain("Language.Parser]::ParseFile");
    expect(source).toContain("launcherReady=$true");
    expect(source).toContain('keyboard.press("Meta+R")');
    expect(source).toContain('keyboard.press("Enter")');
    expect(source).toContain("--user-data-dir=");
    expect(source).toContain("priorCookieStateAvailable=$false");
    expect(source).toContain("privateMode=$false");
    expect(source).toContain("outlook.office.com/mail/");
    expect(source).toContain("owned-session.json");
    expect(source).toContain("vmPowerChanged: false");
    expect(source).not.toContain("/deallocate?");
    expect(source).not.toContain("--inprivate");
    expect(source).not.toContain("navigator.clipboard");
  });
});
