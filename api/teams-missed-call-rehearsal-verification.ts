import {
  TeamsMissedCallRehearsalVerificationError,
  verifyTeamsMissedCallRehearsalOutput,
} from "../scripts/verify-teams-missed-call-rehearsal-output.js";
import {
  TEAMS_MISSED_CALL_REHEARSAL_MAX_RESPONSE_BYTES,
  TeamsMissedCallRehearsalContractError,
  isVerifiedTeamsMissedCallRehearsalSummary,
  parseTeamsMissedCallRehearsalVerificationRequest,
  type TeamsMissedCallRehearsalVerificationRequest,
  type VerifiedTeamsMissedCallRehearsalSummary,
} from "../src/api/teams-missed-call-rehearsal-verification-contract.js";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.js";

export const TEAMS_MISSED_CALL_REHEARSAL_VERIFICATION_API_CAPABILITY = {
  schemaVersion: 1,
  surface: "authenticated-rehearsal-verification-api",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["teams-missed-call-observation"],
  routeOwnerKey: "teams-missed-call-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type TeamsMissedCallRehearsalVerifier = (
  value: unknown,
) => VerifiedTeamsMissedCallRehearsalSummary;

export interface TeamsMissedCallRehearsalVerificationService {
  verify(value: unknown): VerifiedTeamsMissedCallRehearsalSummary;
}

export class TeamsMissedCallRehearsalVerificationSafeFailureError
  extends Error {
  constructor() {
    super("Teams missed-call rehearsal verification failed safely.");
    this.name = "TeamsMissedCallRehearsalVerificationSafeFailureError";
  }
}

export class TeamsMissedCallRehearsalVerificationResponseTooLargeError
  extends Error {
  constructor() {
    super("Teams missed-call rehearsal response exceeded its safe bound.");
    this.name = "TeamsMissedCallRehearsalVerificationResponseTooLargeError";
  }
}

export class InMemoryTeamsMissedCallRehearsalVerificationService
  implements TeamsMissedCallRehearsalVerificationService {
  private readonly verifier: TeamsMissedCallRehearsalVerifier;

  constructor(
    verifier: TeamsMissedCallRehearsalVerifier =
      verifyTeamsMissedCallRehearsalOutput,
  ) {
    this.verifier = verifier;
  }

  verify(value: unknown): VerifiedTeamsMissedCallRehearsalSummary {
    let request: TeamsMissedCallRehearsalVerificationRequest;
    try {
      request = parseTeamsMissedCallRehearsalVerificationRequest(value);
    } catch (error) {
      if (error instanceof TeamsMissedCallRehearsalContractError) throw error;
      throw new TeamsMissedCallRehearsalVerificationSafeFailureError();
    }

    let verified: VerifiedTeamsMissedCallRehearsalSummary;
    try {
      verified = this.verifier(request);
    } catch (error) {
      if (error instanceof TeamsMissedCallRehearsalVerificationError) {
        throw error;
      }
      throw new TeamsMissedCallRehearsalVerificationSafeFailureError();
    }
    if (!isVerifiedTeamsMissedCallRehearsalSummary(verified, request)) {
      throw new TeamsMissedCallRehearsalVerificationSafeFailureError();
    }
    if (
      Buffer.byteLength(JSON.stringify(verified), "utf8") >
      TEAMS_MISSED_CALL_REHEARSAL_MAX_RESPONSE_BYTES
    ) {
      throw new TeamsMissedCallRehearsalVerificationResponseTooLargeError();
    }
    return verified;
  }
}
