import { describe, expect, it } from "vitest";
import { BRANCHES, commandReceipt } from "./kobe-run-dialog-defender-proof.mjs";

describe("Kobe fixed Run-dialog proof", () => {
  it("retains the two exact approved commands", () => {
    expect(BRANCHES.A).toBe(
      "powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand VwByAGkAdABlAC0ASABvAHMAdAAgACcASABlAGwAbABvACAAVwBvAHIAbABkACcA",
    );
    expect(BRANCHES.B).toBe(
      'powershell.exe -w 1 -c "$f=\\"$HOME\\Desktop\\CLICKFIX-SIMULATION.txt\\";Set-Content $f \'SIMULATION ONLY\';Resolve-DnsName example.com;notepad $f"',
    );
  });

  it("independently exposes the corrected UTF-16LE source", () => {
    expect(commandReceipt("A")).toMatchObject({
      sha256: "055394DB9160D87BEDE49F3E0455049923A8CFF7C0A5A5C700F7E7508B569DB8",
      encodedBytes: 48,
      validUtf16LeLength: true,
      decodedUtf16Le: "Write-Host 'Hello World'",
      decodedMatchesExpected: true,
    });
  });
});
