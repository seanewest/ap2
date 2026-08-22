import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/rachel-chain-evidence.mjs", "utf8");

describe("Rachel composed-chain native evidence", () => {
  it("uses exact Rachel, endpoint, GSA TLS, and run identities", () => {
    expect(source).toContain("1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9");
    expect(source).toContain("732767fb-a200-48bf-af95-817ed3906d76");
    expect(source).toContain("bd9e2402-728d-4539-a5f3-5ec8b130e03d");
    expect(source).toContain("25d2a7ac-6d20-490d-90b2-2f50304ca79c");
    expect(source).toContain("AP2-RACHEL-CHAIN-");
  });

  it("requires native endpoint, GSA, sign-in, and Authentication Methods evidence", () => {
    expect(source).toContain("DeviceProcessEvents");
    expect(source).toContain("DeviceNetworkEvents");
    expect(source).toContain("networkAccess/logs/traffic");
    expect(source).toContain("auditLogs/directoryAudits");
    expect(source).toContain("auditLogs/signIns");
    expect(source).toContain("authentication/methods");
    expect(source).toContain("deletionAudits");
    expect(source).toContain("company-access.html");
    expect(source).toContain("responseCode === 200");
  });

  it("writes sanitized evidence only under the protected runtime", () => {
    expect(source).toContain("resolveAp2RuntimeRoot");
    expect(source).toContain("mode: 0o600");
    expect(source).not.toMatch(/console\.log\([^\n]*(token|credential)/);
  });
});
