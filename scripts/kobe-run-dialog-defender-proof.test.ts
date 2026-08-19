import { describe, expect, it } from "vitest";
import { BRANCHES, commandReceipt } from "./kobe-run-dialog-defender-proof.mjs";

describe("Kobe fixed Run-dialog proof", () => {
  it("retains the two exact approved commands", () => {
    expect(BRANCHES.A).toBe(
      "powershell.exe -w 1 -e VwByAGkAdABlAC0ASABvAHMAdAAgACcASABlAGwAbABvACAAVwBvAHIAbABkJwAgAC0ARgBvAHIAZQBnAHIAbwB1AG4AZABDAG8AbABvAHIAIABHAHIAZQBlAG4A",
    );
    expect(BRANCHES.B).toBe(
      'powershell.exe -w 1 -c "$f=\\"$HOME\\Desktop\\CLICKFIX-SIMULATION.txt\\";Set-Content $f \'SIMULATION ONLY\';Resolve-DnsName example.com;notepad $f"',
    );
  });

  it("exposes rather than repairs the malformed encoded payload", () => {
    expect(commandReceipt("A")).toMatchObject({
      sha256: "473B1EC1043087823681F45B54096FA2C12428E2ACAEDCF70E8DF74E9204D3D5",
      encodedBytes: 93,
      validUtf16LeLength: false,
    });
  });
});
