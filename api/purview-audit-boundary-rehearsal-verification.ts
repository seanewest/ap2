import {
  PurviewAuditBoundaryRehearsalVerificationError,
  verifyPurviewAuditBoundaryRehearsalOutput,
} from "../scripts/verify-purview-audit-boundary-rehearsal-output.js";
import {
  PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_RESPONSE_BYTES,
  PurviewAuditBoundaryRehearsalContractError,
  isVerifiedPurviewAuditBoundaryRehearsalSummary,
  parsePurviewAuditBoundaryRehearsalVerificationRequest,
  type PurviewAuditBoundaryRehearsalVerificationRequest,
  type VerifiedPurviewAuditBoundaryRehearsalSummary,
} from "../src/api/purview-audit-boundary-rehearsal-verification-contract.js";

export type PurviewAuditBoundaryRehearsalVerifier = (
  value: unknown,
) => VerifiedPurviewAuditBoundaryRehearsalSummary;

export interface PurviewAuditBoundaryRehearsalVerificationService {
  verify(value: unknown): VerifiedPurviewAuditBoundaryRehearsalSummary;
}

export class PurviewAuditBoundaryRehearsalVerificationSafeFailureError
  extends Error {
  constructor() {
    super("Purview audit-boundary rehearsal verification failed safely.");
    this.name = "PurviewAuditBoundaryRehearsalVerificationSafeFailureError";
  }
}

export class PurviewAuditBoundaryRehearsalVerificationResponseTooLargeError
  extends Error {
  constructor() {
    super("Purview audit-boundary response exceeded its safe bound.");
    this.name =
      "PurviewAuditBoundaryRehearsalVerificationResponseTooLargeError";
  }
}

export class InMemoryPurviewAuditBoundaryRehearsalVerificationService
  implements PurviewAuditBoundaryRehearsalVerificationService {
  private readonly verifier: PurviewAuditBoundaryRehearsalVerifier;

  constructor(
    verifier: PurviewAuditBoundaryRehearsalVerifier =
      verifyPurviewAuditBoundaryRehearsalOutput,
  ) {
    this.verifier = verifier;
  }

  verify(value: unknown): VerifiedPurviewAuditBoundaryRehearsalSummary {
    let request: PurviewAuditBoundaryRehearsalVerificationRequest;
    try {
      request =
        parsePurviewAuditBoundaryRehearsalVerificationRequest(value);
    } catch (error) {
      if (error instanceof PurviewAuditBoundaryRehearsalContractError) {
        throw error;
      }
      throw new PurviewAuditBoundaryRehearsalVerificationSafeFailureError();
    }

    let verified: VerifiedPurviewAuditBoundaryRehearsalSummary;
    try {
      verified = this.verifier(request);
    } catch (error) {
      if (error instanceof PurviewAuditBoundaryRehearsalVerificationError) {
        throw error;
      }
      throw new PurviewAuditBoundaryRehearsalVerificationSafeFailureError();
    }
    if (
      !isVerifiedPurviewAuditBoundaryRehearsalSummary(verified, request)
    ) {
      throw new PurviewAuditBoundaryRehearsalVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_RESPONSE_BYTES
    ) {
      throw new PurviewAuditBoundaryRehearsalVerificationResponseTooLargeError();
    }
    return verified;
  }
}
