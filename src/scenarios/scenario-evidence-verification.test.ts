import { describe, expect, it } from "vitest";
import {
  CANONICAL_RECEIPT_FIXTURES,
  NEGATIVE_RECEIPT_FIXTURES,
} from "./scenario-evidence-receipt.fixtures";
import { EvidenceReceiptError } from "./scenario-evidence-receipt";
import { verifyCanonicalScenarioEvidenceReceipt } from "./scenario-evidence-verification";

describe("canonical scenario evidence verification", () => {
  it.each(CANONICAL_RECEIPT_FIXTURES)(
    "verifies $name deterministically and reports only uninspected coverage gaps",
    ({ receipt }) => {
      const first = verifyCanonicalScenarioEvidenceReceipt(receipt);
      const second = verifyCanonicalScenarioEvidenceReceipt(
        structuredClone(receipt),
      );

      expect(first).toEqual(second);
      expect(first.kind).toBe("verified-scenario-evidence-receipt");
      expect(first.missingCoverage).toEqual(
        first.claims
          .filter(({ state }) => state === "uninspected")
          .map(({ claimId }) => claimId),
      );
      expect(JSON.stringify(first)).not.toMatch(
        /operationKey|proofReference|upstreamPayload/i,
      );
    },
  );

  it.each(NEGATIVE_RECEIPT_FIXTURES)(
    "refuses evidence-strength promotion $name",
    ({ receipt, expectedCode }) => {
      expect(() => verifyCanonicalScenarioEvidenceReceipt(receipt))
        .toThrowError(expect.objectContaining({ code: expectedCode }));
    },
  );

  it("rejects claim IDs that carry marker or upstream identifier semantics", () => {
    const receipt = structuredClone(CANONICAL_RECEIPT_FIXTURES[0]!.receipt);
    receipt.claims[0]!.id = "marker-run-value";

    let caught: unknown;
    try {
      verifyCanonicalScenarioEvidenceReceipt(receipt);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EvidenceReceiptError);
    expect((caught as EvidenceReceiptError).code).toBe("raw-identifier");
  });
});
