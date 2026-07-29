import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES,
  OauthApplicationReconRehearsalContractError,
  isVerifiedOauthApplicationReconRehearsalSummary,
  parseOauthApplicationReconRehearsalVerificationRequest,
  type OauthApplicationReconRehearsalVerificationRequest,
} from "./oauth-application-recon-rehearsal-verification-contract";
import {
  verifyOauthApplicationReconRehearsalOutput,
} from "../../scripts/verify-oauth-application-recon-rehearsal-output";

describe("OAuth application-recon rehearsal API contract", () => {
  it("accepts only the bounded sanitized canonical envelope", () => {
    const request = fixture();
    expect(
      parseOauthApplicationReconRehearsalVerificationRequest(request),
    ).toEqual(request);
    expect(
      isVerifiedOauthApplicationReconRehearsalSummary(
        verifyOauthApplicationReconRehearsalOutput(request),
        request,
      ),
    ).toBe(true);
  });

  it.each([
    ["identifier", ["00000000", "0000", "4000", "8000", "000000000000"].join("-")],
    ["upn", ["actor", "example.test"].join("@")],
    ["path", ["", "home", "fixture", "evidence"].join("/")],
    ["credential", `Bearer ${"x".repeat(32)}`],
    ["marker", `ap2lab-${"x".repeat(8)}`],
  ])("rejects raw %s content categorically", (_label, unsafe) => {
    const request = fixture();
    const fakeRun = (request as unknown as {
      fakeRun: Record<string, unknown>;
    }).fakeRun;
    fakeRun.detector = unsafe;
    expect(() =>
      parseOauthApplicationReconRehearsalVerificationRequest(request)
    ).toThrow(new OauthApplicationReconRehearsalContractError(
      "UNSAFE_CONTENT",
    ));
  });

  it("rejects unknown nested fields and oversized arrays", () => {
    const unknown = fixture() as unknown as {
      envelope: { claims: Record<string, unknown> };
    };
    unknown.envelope.claims.detail = "safe";
    expect(() =>
      parseOauthApplicationReconRehearsalVerificationRequest(unknown)
    ).toThrow(new OauthApplicationReconRehearsalContractError("INPUT_SHAPE"));

    const oversized = fixture();
    const fakeRun = (oversized as unknown as {
      fakeRun: Record<string, unknown>;
    }).fakeRun;
    fakeRun.orderedReads = Array.from(
      { length: 9 },
      () => "synthetic-read",
    );
    expect(() =>
      parseOauthApplicationReconRehearsalVerificationRequest(oversized)
    ).toThrow(new OauthApplicationReconRehearsalContractError("INPUT_SHAPE"));
  });

  it("rejects request bytes above the fixed route cap", () => {
    const request = fixture() as unknown as Record<string, unknown>;
    request.detail = "x".repeat(
      OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES,
    );
    expect(() =>
      parseOauthApplicationReconRehearsalVerificationRequest(request)
    ).toThrow(new OauthApplicationReconRehearsalContractError(
      "INPUT_OVERSIZED",
    ));
  });
});

function fixture(): OauthApplicationReconRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/oauth-application-recon-rehearsal-output.json",
  ), "utf8")) as OauthApplicationReconRehearsalVerificationRequest;
}
