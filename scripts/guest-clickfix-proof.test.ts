import { describe, expect, it } from "vitest";

describe("guest-local ClickFix proof", () => {
  it("retains the corrected harmless command and guest-local interaction boundary", async () => {
    process.env.AP2_RUN_ID = "AP2-HOMER-CLICKFIX-20260820T000000Z";
    process.argv[2] = "state";
    const source = await import("node:fs").then((fs) => fs.readFileSync("scripts/guest-clickfix-proof.mjs", "utf8"));
    expect(source).toContain("Write-Host 'Hello World'");
    expect(source).toContain("eventIsTrusted:event.isTrusted");
    expect(source).toContain('await navigator.clipboard.writeText(command)');
    expect(source).toContain('await page.keyboard.press("Control+V")');
    expect(source).not.toContain("navigator.clipboard.readText");
    expect(source).toContain('await page.keyboard.press("Enter")');
    expect(source).toContain("PowerState/deallocated");
  });
});
