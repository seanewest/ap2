import { describe, expect, it } from "vitest";
import {
  canonicalAvdThreeVmRehearsalOutput,
} from "../../scripts/verify-avd-three-vm-rehearsal-output";
import { isBoundedRehearsalOutputRequest } from "./rehearsal-output-verification-contract";

describe("browser rehearsal output request boundary", () => {
  it("accepts the exact canonical PR #83 envelope", () => {
    expect(
      isBoundedRehearsalOutputRequest(
        canonicalAvdThreeVmRehearsalOutput(),
      ),
    ).toBe(true);
  });

  it("rejects nested unknown fields and arbitrary fixed-field text", () => {
    const unknown = structuredClone(canonicalAvdThreeVmRehearsalOutput());
    (unknown.stages as Record<string, unknown>).extra = "compiled";
    expect(isBoundedRehearsalOutputRequest(unknown)).toBe(false);

    const arbitrary = structuredClone(canonicalAvdThreeVmRehearsalOutput());
    arbitrary.status = "custom-completed" as "completed";
    expect(isBoundedRehearsalOutputRequest(arbitrary)).toBe(false);
  });

  it("rejects raw sensitive strings before the client can authenticate", () => {
    const raw = structuredClone(canonicalAvdThreeVmRehearsalOutput());
    (raw.observations as NonNullable<typeof raw.observations>).provenance =
      ["operator", "example.invalid"].join("@") as "synthetic";
    expect(isBoundedRehearsalOutputRequest(raw)).toBe(false);
  });

  it("leaves bounded numeric tampering for categorical verification refusal", () => {
    const tampered = structuredClone(canonicalAvdThreeVmRehearsalOutput());
    tampered.runnerJournal.entries += 1;
    expect(isBoundedRehearsalOutputRequest(tampered)).toBe(true);
  });
});
