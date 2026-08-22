import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Rachel retained AVD execution seam", () => {
  it("gates the exact endpoint, guest desktop, user session, action, and no-power cleanup", () => {
    const source = readFileSync("scripts/rachel-retained-avd-execution.mjs", "utf8");

    expect(source).toContain("PowerState/deallocated");
    expect(source).toContain('hostStatus === "Available"');
    expect(source).toContain("exactActiveRachelSession");
    expect(source).toContain("remoteCanvas");
    expect(source).toContain("remoteKeyboardEnterCount: 1");
    expect(source).toContain("owned-session.json");
    expect(source).toContain("Rachel session is not owned by this run");
    expect(source).toContain("15 * 60 * 1000");
    expect(source).toContain("networkAccess/logs/traffic");
    expect(source).toContain('entry.initiatingProcessName === "msedge.exe"');
    expect(source).not.toContain("/runCommand?");
    expect(source).toContain("https://client.wvd.microsoft.com/");
    expect(source).toContain("vmPowerChanged: false");
    expect(source).not.toContain("/deallocate?");
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("navigator.clipboard");
    expect(source).not.toContain("/mnt/c");
  });
});
