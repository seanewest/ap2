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
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const REHEARSAL_OUTPUT_VERIFICATION_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-rehearsal-verification-api",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["avd-three-vm-substrate"],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

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
  private readonly verifier: RehearsalOutputVerifier;

  constructor(
    verifier: RehearsalOutputVerifier = verifyAvdThreeVmRehearsalOutput,
  ) {
    this.verifier = verifier;
  }

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
