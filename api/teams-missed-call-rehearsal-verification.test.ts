import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TeamsMissedCallRehearsalVerificationError,
  verifyTeamsMissedCallRehearsalOutput,
} from "../scripts/verify-teams-missed-call-rehearsal-output";
import {
  TEAMS_MISSED_CALL_REHEARSAL_VERIFICATION_FAILURES,
  type TeamsMissedCallRehearsalVerificationRequest,
} from "../src/api/teams-missed-call-rehearsal-verification-contract";
import {
  InMemoryTeamsMissedCallRehearsalVerificationService,
  TeamsMissedCallRehearsalVerificationSafeFailureError,
} from "./teams-missed-call-rehearsal-verification";

const BRANCHES = [
  "stage-only",
  "native-retained",
  "reported-retained",
  "native-cleaned",
] as const;

describe("in-memory Teams missed-call rehearsal verification service", () => {
  it.each(BRANCHES)(
    "verifies the independent %s fixture through PR #110 directly",
    (branch) => {
      const verifier = vi.fn(verifyTeamsMissedCallRehearsalOutput);
      const service =
        new InMemoryTeamsMissedCallRehearsalVerificationService(verifier);
      const request = fixture(branch);

      expect(service.verify(request)).toMatchObject({
        label: "REHEARSAL_ONLY_VERIFIED",
        scenarioId: "teams-missed-call-observation",
        planDigestSha256: request.binding!.planDigestSha256,
        fakeRunDigestSha256: request.binding!.fakeRunDigestSha256,
        syntheticBranch: branch,
        externalEvidence: "all-uninspected",
        canonicalLearnerInterpretation: "uninspected",
        claimCount: 14,
      });
      expect(verifier).toHaveBeenCalledOnce();
      expect(verifier).toHaveBeenCalledWith(request);
    },
  );

  it.each(TEAMS_MISSED_CALL_REHEARSAL_VERIFICATION_FAILURES)(
    "preserves only fixed %s verifier categories",
    (category) => {
      const service =
        new InMemoryTeamsMissedCallRehearsalVerificationService(() => {
          throw new TeamsMissedCallRehearsalVerificationError(category);
        });
      expect(() => service.verify(fixture())).toThrow(
        new TeamsMissedCallRehearsalVerificationError(category),
      );
    },
  );

  it("isolates arbitrary failures and summary substitution", () => {
    const arbitrary = new InMemoryTeamsMissedCallRehearsalVerificationService(
      () => {
        throw new Error("private detail");
      },
    );
    const substituted =
      new InMemoryTeamsMissedCallRehearsalVerificationService(
        (value) => ({
          ...verifyTeamsMissedCallRehearsalOutput(value),
          externalEvidence: "partially-proven" as "all-uninspected",
        }),
      );
    expect(() => arbitrary.verify(fixture())).toThrow(
      TeamsMissedCallRehearsalVerificationSafeFailureError,
    );
    expect(() => substituted.verify(fixture())).toThrow(
      TeamsMissedCallRehearsalVerificationSafeFailureError,
    );
  });

  it("has no fake, runner, network, persistence, retry, or telemetry path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "api/teams-missed-call-rehearsal-verification.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/runTeamsMissedCallRehearsal/);
    expect(source).not.toMatch(/createDeterministicTeamsMissedCall/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry\b/i);
    expect(source).not.toMatch(/\btelemetry\b/i);
    expect(source).not.toMatch(/\.execute\s*\(/);
  });
});

function fixture(
  branch: typeof BRANCHES[number] = "stage-only",
): TeamsMissedCallRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures",
    `teams-missed-call-rehearsal-output-${branch}.json`,
  ), "utf8")) as TeamsMissedCallRehearsalVerificationRequest;
}
