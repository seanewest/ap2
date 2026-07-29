import {
  RehearsalOutputVerificationError,
  verifyAvdThreeVmRehearsalOutput,
} from "../scripts/verify-avd-three-vm-rehearsal-output.js";
import {
  REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES,
  isVerifiedRehearsalOutputSummary,
  type RehearsalOutputVerificationRequest,
  type VerifiedRehearsalOutputSummary,
} from "../src/api/rehearsal-output-verification-contract.js";

export type RehearsalOutputVerifier = (
  value: unknown,
) => VerifiedRehearsalOutputSummary;

export interface RehearsalOutputVerificationService {
  verify(value: unknown): VerifiedRehearsalOutputSummary;
}

export class RehearsalOutputVerificationSafeFailureError extends Error {
  constructor() {
    super("Rehearsal output verification failed safely.");
    this.name = "RehearsalOutputVerificationSafeFailureError";
  }
}

export class RehearsalOutputVerificationResponseTooLargeError extends Error {
  constructor() {
    super("Rehearsal output verification response exceeded its safe bound.");
    this.name = "RehearsalOutputVerificationResponseTooLargeError";
  }
}

export class InMemoryRehearsalOutputVerificationService
  implements RehearsalOutputVerificationService {
  constructor(
    private readonly verifier: RehearsalOutputVerifier =
      verifyAvdThreeVmRehearsalOutput,
  ) {}

  verify(value: unknown): VerifiedRehearsalOutputSummary {
    let verified: VerifiedRehearsalOutputSummary;
    try {
      verified = this.verifier(value);
    } catch (error) {
      if (error instanceof RehearsalOutputVerificationError) {
        throw error;
      }
      throw new RehearsalOutputVerificationSafeFailureError();
    }
    const request = value as RehearsalOutputVerificationRequest;
    if (!isVerifiedRehearsalOutputSummary(verified, request)) {
      throw new RehearsalOutputVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES
    ) {
      throw new RehearsalOutputVerificationResponseTooLargeError();
    }
    return verified;
  }
}
