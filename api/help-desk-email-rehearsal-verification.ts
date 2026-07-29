import {
  HelpDeskEmailRehearsalVerificationError,
  verifyHelpDeskEmailRehearsalOutput,
} from "../scripts/verify-help-desk-email-rehearsal-output.js";
import {
  HELP_DESK_EMAIL_REHEARSAL_MAX_RESPONSE_BYTES,
  HelpDeskEmailRehearsalContractError,
  isVerifiedHelpDeskEmailRehearsalSummary,
  parseHelpDeskEmailRehearsalVerificationRequest,
  type HelpDeskEmailRehearsalVerificationRequest,
  type VerifiedHelpDeskEmailRehearsalSummary,
} from "../src/api/help-desk-email-rehearsal-verification-contract.js";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const HELP_DESK_EMAIL_REHEARSAL_VERIFICATION_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-rehearsal-verification-api",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["help-desk-email-observation"],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type HelpDeskEmailRehearsalVerifier = (
  value: unknown,
) => VerifiedHelpDeskEmailRehearsalSummary;

export interface HelpDeskEmailRehearsalVerificationService {
  verify(value: unknown): VerifiedHelpDeskEmailRehearsalSummary;
}

export class HelpDeskEmailRehearsalVerificationSafeFailureError
  extends Error {
  constructor() {
    super("Help-desk email rehearsal verification failed safely.");
    this.name = "HelpDeskEmailRehearsalVerificationSafeFailureError";
  }
}

export class HelpDeskEmailRehearsalVerificationResponseTooLargeError
  extends Error {
  constructor() {
    super("Help-desk email rehearsal response exceeded its safe bound.");
    this.name = "HelpDeskEmailRehearsalVerificationResponseTooLargeError";
  }
}

export class InMemoryHelpDeskEmailRehearsalVerificationService
  implements HelpDeskEmailRehearsalVerificationService {
  private readonly verifier: HelpDeskEmailRehearsalVerifier;

  constructor(
    verifier: HelpDeskEmailRehearsalVerifier =
      verifyHelpDeskEmailRehearsalOutput,
  ) {
    this.verifier = verifier;
  }

  verify(value: unknown): VerifiedHelpDeskEmailRehearsalSummary {
    let request: HelpDeskEmailRehearsalVerificationRequest;
    try {
      request = parseHelpDeskEmailRehearsalVerificationRequest(value);
    } catch (error) {
      if (error instanceof HelpDeskEmailRehearsalContractError) throw error;
      throw new HelpDeskEmailRehearsalVerificationSafeFailureError();
    }

    let verified: VerifiedHelpDeskEmailRehearsalSummary;
    try {
      verified = this.verifier(request);
    } catch (error) {
      if (error instanceof HelpDeskEmailRehearsalVerificationError) throw error;
      throw new HelpDeskEmailRehearsalVerificationSafeFailureError();
    }
    if (!isVerifiedHelpDeskEmailRehearsalSummary(verified, request)) {
      throw new HelpDeskEmailRehearsalVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      HELP_DESK_EMAIL_REHEARSAL_MAX_RESPONSE_BYTES
    ) {
      throw new HelpDeskEmailRehearsalVerificationResponseTooLargeError();
    }
    return verified;
  }
}
