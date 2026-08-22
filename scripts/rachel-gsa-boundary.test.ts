import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Rachel Global Secure Access methods", () => {
  it("keeps Windows interaction in ARM guest Run Command or the remote AVD canvas", () => {
    const standing = readFileSync("scripts/rachel-gsa-standing.mjs", "utf8");
    const edge = readFileSync("scripts/rachel-gsa-edge-proof.mjs", "utf8");

    expect(standing).toContain('commandId: "RunPowerShellScript"');
    expect(edge).toContain('commandId: "RunPowerShellScript"');
    expect(edge).toContain("https://client.wvd.microsoft.com/");
    expect(edge).toContain("page.keyboard");
    expect(edge).not.toContain("node:child_process");

    expect(standing.match(/execFileSync\(/gu)).toHaveLength(2);
    expect(standing.match(/execFileSync\("openssl"/gu)).toHaveLength(2);
    for (const source of [standing, edge]) {
      expect(source).not.toContain("/mnt/c");
      expect(source).not.toContain("wsl.exe");
      expect(source).not.toContain("pyautogui");
      expect(source).not.toContain("robotjs");
      expect(source).not.toContain("xdotool");
      expect(source).not.toContain("wmctrl");
      expect(source).not.toContain("navigator.clipboard");
    }
  });
});
