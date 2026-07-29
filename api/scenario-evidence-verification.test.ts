// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  InMemoryScenarioEvidenceVerificationService,
  ScenarioEvidenceVerificationResponseTooLargeError,
} from "./scenario-evidence-verification.js";
import { CANONICAL_RECEIPT_FIXTURES } from "../src/scenarios/scenario-evidence-receipt.fixtures.js";
import {
  EvidenceReceiptError,
  type ScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.js";
import {
  verifyCanonicalScenarioEvidenceReceipt,
  type SafeVerifiedScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-verification.js";

const RECEIPT = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;

describe("in-memory scenario evidence verification service", () => {
  it("validates the receipt before invoking the verifier", () => {
    const verifier = vi.fn(verifyCanonicalScenarioEvidenceReceipt);
    const service = new InMemoryScenarioEvidenceVerificationService(verifier);

    expect(() => service.verify({ ...RECEIPT, extra: true })).toThrow(
      EvidenceReceiptError,
    );
    expect(verifier).not.toHaveBeenCalled();
  });

  it("refuses an oversized verifier result", () => {
    const baseline = verifyCanonicalScenarioEvidenceReceipt(RECEIPT);
    const oversized: SafeVerifiedScenarioEvidenceReceipt = {
      ...baseline,
      claims: Array.from(
        { length: 1_000 },
        (_, index) => ({
          ...baseline.claims[0]!,
          claimId: `claim-${index}`,
        }),
      ),
    };
    const service = new InMemoryScenarioEvidenceVerificationService(
      (_receipt: ScenarioEvidenceReceipt) => oversized,
    );

    expect(() => service.verify(RECEIPT)).toThrow(
      ScenarioEvidenceVerificationResponseTooLargeError,
    );
  });
});
