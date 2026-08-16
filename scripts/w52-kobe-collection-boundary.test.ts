import fs from "node:fs";
import { describe, expect, it } from "vitest";

const controller = fs.readFileSync("scripts/w52-kobe-collection-boundary.mjs", "utf8");
const browser = fs.readFileSync("scripts/w52-kobe-youtrack-boundary.mjs", "utf8");

describe("archived W52 executable provenance", () => {
  it("keeps collection synthetic, exact, hashed, and identity guarded", () => {
    expect(controller).toContain("AP2 SYNTHETIC ONLY");
    expect(controller).toContain("realDataTouched=$false");
    expect(controller).toContain("AzureAD\\\\KobeWest");
    expect(controller).toContain("CloudAP");
    expect(controller).toContain("Medium Mandatory Level");
    expect(controller).toContain("Exact source inventory mismatch");
    expect(controller).toContain("Archive name/hash/size mismatch");
    expect(controller).toContain("Exact ZIP inventory mismatch");
  });

  it("keeps the authenticated YouTrack path at the proven no-egress boundary", () => {
    expect(browser).toContain("myapps.microsoft.com/signin/AP2%20YouTrack");
    expect(browser).toContain("/issue/DEMO-13");
    expect(browser).toContain("/issues");
    expect(browser).toContain("uploadAttempted: false");
    expect(browser).toContain("permissionChangeAttempted: false");
    expect(browser).toContain("exact no-egress receipt mismatch");
    expect(browser).toContain("outputDirectoryAbsent");
    expect(browser).not.toMatch(/setInputFiles|filechooser|multipart|attachments\/\?fields/i);
  });

  it("retains exact cleanup and VM/session fail-closed guards without embedded secrets", () => {
    expect(controller).toContain("Unsafe start precondition");
    expect(controller).toContain("Unexpected AVD sessions");
    expect(controller).toContain("PowerState/deallocated");
    expect(controller).toContain("Final VM/session safety check failed");
    expect(controller).toContain("survivingMarkedProcessCount=0");
    expect(`${controller}\n${browser}`).not.toMatch(/BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY|pfx-passphrase\.txt|ap2-runtime\/secrets/);
    expect(`${controller}\n${browser}`).not.toMatch(/child_process|spawnSync|execFile|\/mnt\/c\//i);
  });
});
