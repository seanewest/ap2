import {
  EvidenceReceiptError,
  parseScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.js";
import {
  SCENARIO_EVIDENCE_RECEIPT_MANIFESTS,
  verifyCanonicalScenarioEvidenceReceipt,
  type SafeVerifiedScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-verification.js";
import { SCENARIO_MANIFESTS } from "../src/scenarios/scenarios.js";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const SCENARIO_RECEIPT_MAX_REQUEST_BYTES = 131_072;
export const SCENARIO_RECEIPT_MAX_RESPONSE_BYTES = 131_072;
const canonicalScenarioIds = new Set(
  SCENARIO_MANIFESTS.map(({ id }) => id),
);
export const SCENARIO_RECEIPT_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-receipt-api",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: SCENARIO_EVIDENCE_RECEIPT_MANIFESTS
    .map(({ id }) => id)
    .filter((id) => canonicalScenarioIds.has(id)),
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

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
  private readonly verifier: ScenarioEvidenceReceiptVerifier;

  constructor(
    verifier: ScenarioEvidenceReceiptVerifier =
      verifyCanonicalScenarioEvidenceReceipt,
  ) {
    this.verifier = verifier;
  }

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
