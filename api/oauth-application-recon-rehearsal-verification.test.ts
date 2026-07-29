import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OauthApplicationReconRehearsalVerificationError,
  verifyOauthApplicationReconRehearsalOutput,
} from "../scripts/verify-oauth-application-recon-rehearsal-output";
import {
  OAUTH_APPLICATION_RECON_REHEARSAL_VERIFICATION_FAILURES,
  type OauthApplicationReconRehearsalVerificationRequest,
} from "../src/api/oauth-application-recon-rehearsal-verification-contract";
import {
  InMemoryOauthApplicationReconRehearsalVerificationService,
  OauthApplicationReconRehearsalVerificationSafeFailureError,
} from "./oauth-application-recon-rehearsal-verification";

describe("in-memory OAuth application-recon rehearsal verification service", () => {
  it("invokes the authoritative PR #115 verifier directly", () => {
    const verifier = vi.fn(verifyOauthApplicationReconRehearsalOutput);
    const service =
      new InMemoryOauthApplicationReconRehearsalVerificationService(verifier);
    const request = fixture();
    expect(service.verify(request)).toMatchObject({
      label: "REHEARSAL_ONLY_VERIFIED",
      scenarioId: "oauth-application-reconnaissance",
      planDigestSha256: request.binding!.planDigestSha256,
      fakeResultDigestSha256: request.binding!.fakeResultDigestSha256,
      externalEvidence: "all-uninspected",
      claimCount: 13,
    });
    expect(verifier).toHaveBeenCalledOnce();
    expect(verifier).toHaveBeenCalledWith(request);
  });

  it.each(OAUTH_APPLICATION_RECON_REHEARSAL_VERIFICATION_FAILURES)(
    "preserves the fixed %s verifier category",
    (category) => {
      const service =
        new InMemoryOauthApplicationReconRehearsalVerificationService(() => {
          throw new OauthApplicationReconRehearsalVerificationError(category);
        });
      expect(() => service.verify(fixture())).toThrow(
        new OauthApplicationReconRehearsalVerificationError(category),
      );
    },
  );

  it("isolates arbitrary failures and substituted summaries", () => {
    const thrown =
      new InMemoryOauthApplicationReconRehearsalVerificationService(() => {
        throw new Error("private detail");
      });
    const substituted =
      new InMemoryOauthApplicationReconRehearsalVerificationService(
        (value) => ({
          ...verifyOauthApplicationReconRehearsalOutput(value),
          externalEvidence: "proven" as "all-uninspected",
        }),
      );
    expect(() => thrown.verify(fixture())).toThrow(
      OauthApplicationReconRehearsalVerificationSafeFailureError,
    );
    expect(() => substituted.verify(fixture())).toThrow(
      OauthApplicationReconRehearsalVerificationSafeFailureError,
    );
  });

  it("contains no fake runner, OAuth, transport, persistence, retry, or telemetry path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "api/oauth-application-recon-rehearsal-verification.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/createDeterministicOauthApplication/);
    expect(source).not.toMatch(/runOauthApplicationReconRehearsal/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
    expect(source).not.toMatch(/\btelemetry/i);
    expect(source).not.toMatch(/acquireToken|GraphServiceClient/);
  });
});

function fixture(): OauthApplicationReconRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/oauth-application-recon-rehearsal-output.json",
  ), "utf8")) as OauthApplicationReconRehearsalVerificationRequest;
}
