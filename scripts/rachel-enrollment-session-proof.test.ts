import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Rachel enrollment-to-session proof", () => {
  it("keeps interaction inside the remote AVD canvas and preserves authentication boundaries", () => {
    const source = readFileSync(
      "scripts/rachel-enrollment-session-proof.mjs",
      "utf8",
    );

    expect(source).toContain("AP2 COMPANY ACCESS");
    expect(source).toContain("eventIsTrusted:event.isTrusted");
    expect(source).toContain("https://client.wvd.microsoft.com/");
    expect(source).toContain("https://seanewest.github.io/ap2/");
    expect(source).toContain("authenticationMethodsUnchanged");
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("/mnt/c");
    expect(source).not.toContain("navigator.clipboard.readText");
    expect(source).not.toContain("navigator.clipboard.writeText");
    expect(source).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/iu);
  });
});
