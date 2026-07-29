import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PurviewAuditBoundaryRehearsalVerificationError,
  verifyPurviewAuditBoundaryRehearsalOutput,
} from "../scripts/verify-purview-audit-boundary-rehearsal-output.ts";
import {
  PURVIEW_AUDIT_BOUNDARY_REHEARSAL_VERIFICATION_FAILURES,
  type PurviewAuditBoundaryRehearsalVerificationRequest,
} from "../src/api/purview-audit-boundary-rehearsal-verification-contract.ts";
import {
  InMemoryPurviewAuditBoundaryRehearsalVerificationService,
  PurviewAuditBoundaryRehearsalVerificationSafeFailureError,
} from "./purview-audit-boundary-rehearsal-verification.ts";

describe("in-memory Purview audit-boundary rehearsal verification service", () => {
  it("invokes the authoritative PR #131 verifier directly", () => {
    const verifier = vi.fn(verifyPurviewAuditBoundaryRehearsalOutput);
    const service =
      new InMemoryPurviewAuditBoundaryRehearsalVerificationService(verifier);
    const request = fixture();
    expect(service.verify(request)).toMatchObject({
      label: "REHEARSAL_ONLY_VERIFIED",
      scenarioId: "purview-sharepoint-audit-boundary",
      planDigestSha256: request.binding!.planDigestSha256,
      syntheticInputDigestSha256:
        request.binding!.syntheticInputDigestSha256,
      receiptDigestSha256: request.binding!.receiptDigestSha256,
      outputDigestSha256: request.binding!.outputDigestSha256,
      externalEvidence: "all-uninspected",
      claimCount: 14,
      producerAttributionClaimCount: 1,
    });
    expect(verifier).toHaveBeenCalledOnce();
    expect(verifier).toHaveBeenCalledWith(request);
  });

  it.each(PURVIEW_AUDIT_BOUNDARY_REHEARSAL_VERIFICATION_FAILURES)(
    "preserves the fixed %s verifier category",
    (category) => {
      const service =
        new InMemoryPurviewAuditBoundaryRehearsalVerificationService(() => {
          throw new PurviewAuditBoundaryRehearsalVerificationError(category);
        });
      expect(() => service.verify(fixture())).toThrow(
        new PurviewAuditBoundaryRehearsalVerificationError(category),
      );
    },
  );

  it("isolates arbitrary failures and substituted summaries", () => {
    const thrown =
      new InMemoryPurviewAuditBoundaryRehearsalVerificationService(() => {
        throw new Error("private detail");
      });
    const substituted =
      new InMemoryPurviewAuditBoundaryRehearsalVerificationService(
        (value) => ({
          ...verifyPurviewAuditBoundaryRehearsalOutput(value),
          externalEvidence: "proven" as "all-uninspected",
        }),
      );
    expect(() => thrown.verify(fixture())).toThrow(
      PurviewAuditBoundaryRehearsalVerificationSafeFailureError,
    );
    expect(() => substituted.verify(fixture())).toThrow(
      PurviewAuditBoundaryRehearsalVerificationSafeFailureError,
    );
  });

  it("contains no pipeline runner, audit, network, persistence, retry, or telemetry path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "api/purview-audit-boundary-rehearsal-verification.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/createDeterministicPurview/);
    expect(source).not.toMatch(/runPurviewAuditBoundaryRehearsal/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
    expect(source).not.toMatch(/\btelemetry/i);
    expect(source).not.toMatch(/acquireToken|GraphServiceClient|auditSearch/);
  });
});

function fixture(): PurviewAuditBoundaryRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/purview-audit-boundary-rehearsal-output.json",
  ), "utf8")) as PurviewAuditBoundaryRehearsalVerificationRequest;
}
