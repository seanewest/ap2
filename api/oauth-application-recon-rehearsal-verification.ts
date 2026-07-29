import {
  OauthApplicationReconRehearsalVerificationError,
  verifyOauthApplicationReconRehearsalOutput,
} from "../scripts/verify-oauth-application-recon-rehearsal-output.js";
import {
  OAUTH_APPLICATION_RECON_REHEARSAL_MAX_RESPONSE_BYTES,
  OauthApplicationReconRehearsalContractError,
  isVerifiedOauthApplicationReconRehearsalSummary,
  parseOauthApplicationReconRehearsalVerificationRequest,
  type OauthApplicationReconRehearsalVerificationRequest,
  type VerifiedOauthApplicationReconRehearsalSummary,
} from "../src/api/oauth-application-recon-rehearsal-verification-contract.js";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const OAUTH_APPLICATION_RECON_REHEARSAL_VERIFICATION_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-rehearsal-verification-api",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["oauth-application-reconnaissance"],
  routeOwnerKey: "oauth-application-recon-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type OauthApplicationReconRehearsalVerifier = (
  value: unknown,
) => VerifiedOauthApplicationReconRehearsalSummary;

export interface OauthApplicationReconRehearsalVerificationService {
  verify(value: unknown): VerifiedOauthApplicationReconRehearsalSummary;
}

export class OauthApplicationReconRehearsalVerificationSafeFailureError
  extends Error {
  constructor() {
    super("OAuth application-recon rehearsal verification failed safely.");
    this.name = "OauthApplicationReconRehearsalVerificationSafeFailureError";
  }
}

export class OauthApplicationReconRehearsalVerificationResponseTooLargeError
  extends Error {
  constructor() {
    super("OAuth application-recon response exceeded its safe bound.");
    this.name =
      "OauthApplicationReconRehearsalVerificationResponseTooLargeError";
  }
}

export class InMemoryOauthApplicationReconRehearsalVerificationService
  implements OauthApplicationReconRehearsalVerificationService {
  private readonly verifier: OauthApplicationReconRehearsalVerifier;

  constructor(
    verifier: OauthApplicationReconRehearsalVerifier =
      verifyOauthApplicationReconRehearsalOutput,
  ) {
    this.verifier = verifier;
  }

  verify(value: unknown): VerifiedOauthApplicationReconRehearsalSummary {
    let request: OauthApplicationReconRehearsalVerificationRequest;
    try {
      request = parseOauthApplicationReconRehearsalVerificationRequest(value);
    } catch (error) {
      if (error instanceof OauthApplicationReconRehearsalContractError) {
        throw error;
      }
      throw new OauthApplicationReconRehearsalVerificationSafeFailureError();
    }

    let verified: VerifiedOauthApplicationReconRehearsalSummary;
    try {
      verified = this.verifier(request);
    } catch (error) {
      if (
        error instanceof OauthApplicationReconRehearsalVerificationError
      ) throw error;
      throw new OauthApplicationReconRehearsalVerificationSafeFailureError();
    }
    if (!isVerifiedOauthApplicationReconRehearsalSummary(verified, request)) {
      throw new OauthApplicationReconRehearsalVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      OAUTH_APPLICATION_RECON_REHEARSAL_MAX_RESPONSE_BYTES
    ) {
      throw new OauthApplicationReconRehearsalVerificationResponseTooLargeError();
    }
    return verified;
  }
}
