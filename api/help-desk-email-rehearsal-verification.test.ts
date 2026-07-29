import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HelpDeskEmailRehearsalVerificationError,
  verifyHelpDeskEmailRehearsalOutput,
} from "../scripts/verify-help-desk-email-rehearsal-output";
import {
  HELP_DESK_EMAIL_REHEARSAL_VERIFICATION_FAILURES,
  type HelpDeskEmailRehearsalVerificationRequest,
} from "../src/api/help-desk-email-rehearsal-verification-contract";
import {
  HelpDeskEmailRehearsalVerificationSafeFailureError,
  InMemoryHelpDeskEmailRehearsalVerificationService,
} from "./help-desk-email-rehearsal-verification";

describe("in-memory help-desk email rehearsal verification service", () => {
  it.each(["send", "retained", "cleaned"] as const)(
    "verifies the captured %s branch using PR #107 directly",
    (branch) => {
      const verifier = vi.fn(verifyHelpDeskEmailRehearsalOutput);
      const service = new InMemoryHelpDeskEmailRehearsalVerificationService(
        verifier,
      );
      const request = fixture(branch);
      expect(service.verify(request)).toMatchObject({
        label: "REHEARSAL_ONLY_VERIFIED",
        scenarioId: "help-desk-email-observation",
        planDigestSha256: request.binding!.planDigestSha256,
        fakeRunDigestSha256: request.binding!.fakeRunDigestSha256,
        syntheticBranch: request.binding!.syntheticBranch,
        externalEvidence: "all-uninspected",
      });
      expect(verifier).toHaveBeenCalledOnce();
      expect(verifier).toHaveBeenCalledWith(request);
    },
  );

  it.each(HELP_DESK_EMAIL_REHEARSAL_VERIFICATION_FAILURES)(
    "preserves the fixed %s verifier category",
    (category) => {
      const service = new InMemoryHelpDeskEmailRehearsalVerificationService(
        () => {
          throw new HelpDeskEmailRehearsalVerificationError(category);
        },
      );
      expect(() => service.verify(fixture())).toThrow(
        new HelpDeskEmailRehearsalVerificationError(category),
      );
    },
  );

  it("isolates arbitrary failures and substituted summaries", () => {
    const thrown = new InMemoryHelpDeskEmailRehearsalVerificationService(
      () => {
        throw new Error("private detail");
      },
    );
    const substituted = new InMemoryHelpDeskEmailRehearsalVerificationService(
      (value) => ({
        ...verifyHelpDeskEmailRehearsalOutput(value),
        externalEvidence: "proven" as "all-uninspected",
      }),
    );
    expect(() => thrown.verify(fixture())).toThrow(
      HelpDeskEmailRehearsalVerificationSafeFailureError,
    );
    expect(() => substituted.verify(fixture())).toThrow(
      HelpDeskEmailRehearsalVerificationSafeFailureError,
    );
  });

  it("contains no fake, send, transport, persistence, retry, or telemetry path", () => {
    const source = readFileSync(
      join(process.cwd(), "api/help-desk-email-rehearsal-verification.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createDeterministicHelpDeskEmailFakeLifecycle/);
    expect(source).not.toMatch(/DelegatedGraphHelpDeskScenarioOperation/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
    expect(source).not.toMatch(/\btelemetry/i);
  });
});

function fixture(
  branch: "send" | "retained" | "cleaned" = "send",
): HelpDeskEmailRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures",
    `help-desk-email-rehearsal-output-${branch}.json`,
  ), "utf8")) as HelpDeskEmailRehearsalVerificationRequest;
}
