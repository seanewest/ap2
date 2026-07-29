import {
  EvidenceReceiptError,
  parseScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.js";
import {
  verifyCanonicalScenarioEvidenceReceipt,
  type SafeVerifiedScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-verification.js";

export const SCENARIO_RECEIPT_MAX_REQUEST_BYTES = 131_072;
export const SCENARIO_RECEIPT_MAX_RESPONSE_BYTES = 131_072;

export type ScenarioEvidenceReceiptVerifier = (
  receipt: ScenarioEvidenceReceipt,
) => SafeVerifiedScenarioEvidenceReceipt;

export interface ScenarioEvidenceVerificationService {
  verify(value: unknown): SafeVerifiedScenarioEvidenceReceipt;
}

export class ScenarioEvidenceVerificationSafeFailureError extends Error {
  constructor() {
    super("Scenario evidence receipt verification failed safely.");
    this.name = "ScenarioEvidenceVerificationSafeFailureError";
  }
}

export class ScenarioEvidenceVerificationResponseTooLargeError extends Error {
  constructor() {
    super("Scenario evidence receipt response exceeded its safe bound.");
    this.name = "ScenarioEvidenceVerificationResponseTooLargeError";
  }
}

export class InMemoryScenarioEvidenceVerificationService
  implements ScenarioEvidenceVerificationService {
  constructor(
    private readonly verifier: ScenarioEvidenceReceiptVerifier =
      verifyCanonicalScenarioEvidenceReceipt,
  ) {}

  verify(value: unknown): SafeVerifiedScenarioEvidenceReceipt {
    const receipt = parseScenarioEvidenceReceipt(value);
    let verified: SafeVerifiedScenarioEvidenceReceipt;
    try {
      verified = this.verifier(receipt);
    } catch (error) {
      if (error instanceof EvidenceReceiptError) {
        throw error;
      }
      throw new ScenarioEvidenceVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      SCENARIO_RECEIPT_MAX_RESPONSE_BYTES
    ) {
      throw new ScenarioEvidenceVerificationResponseTooLargeError();
    }
    return verified;
  }
}
