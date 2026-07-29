import {
  PrivateDocumentRehearsalVerificationError,
  verifyPrivateDocumentRehearsalOutput,
} from "../scripts/verify-private-document-rehearsal-output.js";
import {
  PRIVATE_DOCUMENT_REHEARSAL_MAX_RESPONSE_BYTES,
  PrivateDocumentRehearsalContractError,
  isVerifiedPrivateDocumentRehearsalSummary,
  parsePrivateDocumentRehearsalVerificationRequest,
  type PrivateDocumentRehearsalVerificationRequest,
  type VerifiedPrivateDocumentRehearsalSummary,
} from "../src/api/private-document-rehearsal-verification-contract.js";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-rehearsal-verification-api",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["private-document-evidence"],
  routeOwnerKey: "private-document-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type PrivateDocumentRehearsalVerifier = (
  value: unknown,
) => VerifiedPrivateDocumentRehearsalSummary;

export interface PrivateDocumentRehearsalVerificationService {
  verify(value: unknown): VerifiedPrivateDocumentRehearsalSummary;
}

export class PrivateDocumentRehearsalVerificationSafeFailureError
  extends Error {
  constructor() {
    super("Private-document rehearsal verification failed safely.");
    this.name = "PrivateDocumentRehearsalVerificationSafeFailureError";
  }
}

export class PrivateDocumentRehearsalVerificationResponseTooLargeError
  extends Error {
  constructor() {
    super("Private-document rehearsal response exceeded its safe bound.");
    this.name = "PrivateDocumentRehearsalVerificationResponseTooLargeError";
  }
}

export class InMemoryPrivateDocumentRehearsalVerificationService
  implements PrivateDocumentRehearsalVerificationService {
  private readonly verifier: PrivateDocumentRehearsalVerifier;

  constructor(
    verifier: PrivateDocumentRehearsalVerifier =
      verifyPrivateDocumentRehearsalOutput,
  ) {
    this.verifier = verifier;
  }

  verify(value: unknown): VerifiedPrivateDocumentRehearsalSummary {
    let request: PrivateDocumentRehearsalVerificationRequest;
    try {
      request = parsePrivateDocumentRehearsalVerificationRequest(value);
    } catch (error) {
      if (error instanceof PrivateDocumentRehearsalContractError) throw error;
      throw new PrivateDocumentRehearsalVerificationSafeFailureError();
    }

    let verified: VerifiedPrivateDocumentRehearsalSummary;
    try {
      verified = this.verifier(request);
    } catch (error) {
      if (error instanceof PrivateDocumentRehearsalVerificationError) {
        throw error;
      }
      throw new PrivateDocumentRehearsalVerificationSafeFailureError();
    }
    if (!isVerifiedPrivateDocumentRehearsalSummary(verified, request)) {
      throw new PrivateDocumentRehearsalVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      PRIVATE_DOCUMENT_REHEARSAL_MAX_RESPONSE_BYTES
    ) {
      throw new PrivateDocumentRehearsalVerificationResponseTooLargeError();
    }
    return verified;
  }
}
