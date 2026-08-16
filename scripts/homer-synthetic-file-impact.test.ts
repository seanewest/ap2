import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "scripts/homer-synthetic-file-impact.ps1.source"),
  "utf8",
);

const archivedRunId = "AP2-HOMER-RANSOM-BG-20260815T1112Z";
const specs = [
  ["Quarterly-Finance-Projection.txt", "Synthetic quarterly projection; no real financial data."],
  ["Employee-Onboarding-Checklist.txt", "Synthetic onboarding checklist; no real employee data."],
  ["Vendor-Renewal-Plan.txt", "Synthetic vendor renewal plan; no real vendor data."],
  ["Customer-Support-Handoff.txt", "Synthetic support handoff; no real customer data."],
  ["Product-Roadmap-Draft.txt", "Synthetic product roadmap; no real product data."],
  ["Executive-Meeting-Notes.txt", "Synthetic meeting notes; no real company data."],
] as const;

const archivedHashes = [
  ["D9E07B5C4B1BAC1DCFC7A762357391BD2C6D60EBB0472A7379C0EFA2C7DC16EB", "9CF85D8221DCDB9A523C3A6938E69A546F63DFB5620AFD8D6F9566F46382E66A"],
  ["286667BEDAFEE96F1B75CF064F9CED3E3764DB9A34EFE123FE25F03ACCC9F037", "2AB412F868F33C1D11DB55BEE0F40059CF604A4E804DA88BC4AEC999F4A36D4B"],
  ["8FAC707E44C67F570B59484F2F954904C0A6AEE13F64A0DD492790D6763976AF", "4D5034DEAF2FD50EA7BBB823D85DE64818258ED7F427CF6A6737018B1EF6684F"],
  ["9FE84F251F2F62E39F19E88C33BDDBE140C50461B0DC4C05A4CE166AA9B6030A", "243D9B2675B98DE6CE646B77BCE5B47582D1C60A175E073D5A085450C65578FA"],
  ["197E8F1323AFFFB75E2DD3D53B17F110793DF62044586FCCBD16323C23E3869B", "0778B30683312CA2661986E8B7D9DAFA74731CF644C24D8A69C091C47EDCDC76"],
  ["3A3EEFD277C11BDA6844606CA184C2044A8B151129814D9B0DC24EDF0F6C0B87", "9BFF21556815BC46E989E575EF3AAA85A5C6EAC49DD8EC883634D3B5426BD6F2"],
] as const;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function xor(bytes: Buffer): Buffer {
  return Buffer.from(bytes.map((byte) => byte ^ 0x5a));
}

describe("Homer synthetic file-impact source", () => {
  it("remains inert in the repository until deliberately staged as a guest .ps1", () => {
    expect(script).toContain("[CmdletBinding()]");
    expect(script).toContain("proves ap2timedhomer-vm deallocated with zero AVD sessions");
    expect(script).not.toContain("management.azure.com");
  });

  it("reproduces the archived W50 content, XOR, and marker-note hashes", () => {
    specs.forEach(([name, description], index) => {
      const original = Buffer.from(
        [
          "AP2 synthetic company document",
          `Run: ${archivedRunId}`,
          `Ordinal: ${index + 1}`,
          description,
          "",
        ].join("\r\n"),
        "utf8",
      );
      expect([sha256(original), sha256(xor(original))]).toEqual(
        archivedHashes[index],
      );
      expect(xor(xor(original))).toEqual(original);
      expect(script).toContain(`@('${name}', '${description}')`);
    });

    const note = Buffer.from(
      [
        "AP2 HARMLESS SIMULATION ONLY",
        `Run: ${archivedRunId}`,
        "Only the six synthetic files in this marked folder were reversibly transformed.",
        "No payment, contact, credential, or action is requested.",
        "",
      ].join("\r\n"),
      "utf8",
    );
    expect(sha256(note)).toBe(
      "79602915F95AC5DE3EC78F994DADAED82DF6BA184EA3631169F518DAD17F816A",
    );
  });

  it("keeps execution inside the exact Homer VM, identity, session, and path boundary", () => {
    for (const literal of [
      "AP2TIMEDHOMER",
      "AzureAD\\HomerSimpson",
      "S-1-12-1-1851057065-1159755345-1963209123-3396316752",
      "CloudAP",
      "C:\\Users\\HomerSimpson\\AppData\\Local",
      "C:\\Users\\HomerSimpson\\OneDrive",
      "S-1-16-8192",
      "ExpectedSessionId",
      "GetFullPath",
      "ReparsePoint",
      "State file contract mismatch",
      "same-session OneDrive process",
    ]) {
      expect(script).toContain(literal);
    }
    expect(script).not.toMatch(
      /management\.azure\.com|graph\.microsoft\.com|Defender|certificate\.pfx|passphrase|clientSecret/i,
    );
  });

  it("requires distinct prepare, impact, and cleanup gates with exact restoration checks", () => {
    for (const literal of [
      "prepare-in-progress",
      "original-ready",
      "impact-in-progress",
      "impact-ready",
      "Impact requires exact original-ready phase",
      "-bxor 0x5A",
      "Restoration hash mismatch",
      "Final restoration hash mismatch",
      "Marker note changed; cleanup refuses to delete it.",
      "syntheticRootAbsent = $true",
      "explicitly deallocate ap2timedhomer-vm",
    ]) {
      expect(script).toContain(literal);
    }
    expect(script).not.toContain("Remove-Item -LiteralPath $SyntheticRoot -Recurse");
    expect(script).not.toContain("Get-ChildItem $ExpectedOneDriveRoot");
  });
});
