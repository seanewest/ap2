import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES,
  PurviewAuditBoundaryRehearsalContractError,
  isBoundedPurviewAuditBoundaryRehearsalRequest,
  isVerifiedPurviewAuditBoundaryRehearsalSummary,
  parsePurviewAuditBoundaryRehearsalVerificationRequest,
} from "./purview-audit-boundary-rehearsal-verification-contract.ts";
import {
  verifyPurviewAuditBoundaryRehearsalOutput,
} from "../../scripts/verify-purview-audit-boundary-rehearsal-output.ts";

describe("Purview audit-boundary rehearsal verification transport contract", () => {
  it("accepts only the exact bounded PR #129 output shape", () => {
    const value = fixture();
    expect(parsePurviewAuditBoundaryRehearsalVerificationRequest(value))
      .toEqual(value);
    expect(isBoundedPurviewAuditBoundaryRehearsalRequest(value)).toBe(true);
  });

  it("accepts only the authoritative verifier's exact fixed summary", () => {
    const request = parsePurviewAuditBoundaryRehearsalVerificationRequest(
      fixture(),
    );
    const summary = verifyPurviewAuditBoundaryRehearsalOutput(request);
    expect(
      isVerifiedPurviewAuditBoundaryRehearsalSummary(summary, request),
    ).toBe(true);
    expect(
      isVerifiedPurviewAuditBoundaryRehearsalSummary(
        { ...summary, producerAttributionClaimCount: 2 },
        request,
      ),
    ).toBe(false);
  });

  it.each([
    ["wrong label", (value: Record<string, unknown>) => {
      value.label = "LIVE";
    }],
    ["cross scenario", (value: Record<string, unknown>) => {
      (value.binding as Record<string, unknown>).scenarioId =
        "other-scenario";
    }],
    ["duplicate cardinality", (value: Record<string, unknown>) => {
      (value.receipt as Record<string, unknown>).duplicatePageClaimCount = 17;
    }],
    ["unknown field", (value: Record<string, unknown>) => {
      value.detail = "arbitrary";
    }],
    ["missing field", (value: Record<string, unknown>) => {
      delete (value.stages as Record<string, unknown>).adapter;
    }],
    ["reordered field", (value: Record<string, unknown>) => {
      value.stages = Object.fromEntries(
        Object.entries(value.stages as Record<string, unknown>).reverse(),
      );
    }],
  ] as const)("refuses %s", (_name, mutate) => {
    const value = fixture();
    mutate(value);
    expect(() =>
      parsePurviewAuditBoundaryRehearsalVerificationRequest(value)
    ).toThrow(PurviewAuditBoundaryRehearsalContractError);
  });

  it("refuses raw identity-shaped and oversized values", () => {
    const unsafe = fixture();
    unsafe.detail = [
      "00000000",
      "0000",
      "4000",
      "8000",
      "000000000000",
    ].join("-");
    expect(() =>
      parsePurviewAuditBoundaryRehearsalVerificationRequest(unsafe)
    ).toThrow(expect.objectContaining({ category: "UNSAFE_CONTENT" }));

    expect(() =>
      parsePurviewAuditBoundaryRehearsalVerificationRequest({
        value: "x".repeat(
          PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES + 1,
        ),
      })
    ).toThrow(expect.objectContaining({ category: "INPUT_OVERSIZED" }));
  });
});

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/purview-audit-boundary-rehearsal-output.json",
  ), "utf8")) as Record<string, unknown>;
}
