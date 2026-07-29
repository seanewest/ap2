import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HttpAfterPartyApi,
  PurviewAuditBoundaryRehearsalVerificationClientError,
} from "./client.ts";
import type {
  PurviewAuditBoundaryRehearsalVerificationRequest,
  VerifiedPurviewAuditBoundaryRehearsalSummary,
} from "./purview-audit-boundary-rehearsal-verification-contract.ts";

describe("Purview audit-boundary rehearsal verification typed client", () => {
  it("posts with the authoritative route contract and binds the safe summary", async () => {
    const output = fixture();
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(expected(output), 200),
    );
    const client = new HttpAfterPartyApi("https://api.example.test", request);
    await expect(
      client.verifyPurviewAuditBoundaryRehearsalOutput(
        "signed-token",
        output,
      ),
    ).resolves.toEqual(expected(output));
    expect(request).toHaveBeenCalledWith(
      "https://api.example.test/api/purview-audit-boundary-rehearsal-verification",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        body: JSON.stringify(output),
      }),
    );
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [413, "request-too-large"],
    [500, "safe-failure"],
  ] as const)("maps HTTP %s to %s", async (status, category) => {
    await expect(
      clientReturning(jsonResponse({ detail: "arbitrary" }, status))
        .verifyPurviewAuditBoundaryRehearsalOutput(
          "signed-token",
          fixture(),
        ),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known exact refusal categories", async () => {
    const known = clientReturning(jsonResponse({
      error: "purview_audit_boundary_rehearsal_refused",
      category: "DEDUPLICATION_MISMATCH",
    }, 400));
    const expanded = clientReturning(jsonResponse({
      error: "purview_audit_boundary_rehearsal_refused",
      category: "DEDUPLICATION_MISMATCH",
      detail: "arbitrary",
    }, 400));
    await expect(
      known.verifyPurviewAuditBoundaryRehearsalOutput(
        "signed-token",
        fixture(),
      ),
    ).rejects.toEqual(
      new PurviewAuditBoundaryRehearsalVerificationClientError(
        "validation-refused",
        "DEDUPLICATION_MISMATCH",
      ),
    );
    await expect(
      expanded.verifyPurviewAuditBoundaryRehearsalOutput(
        "signed-token",
        fixture(),
      ),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects unsafe, unknown, cross-family, and malformed input before fetch", async () => {
    const request = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", request);
    const unsafe =
      structuredClone(fixture()) as unknown as Record<string, unknown>;
    unsafe.detail = ["person", "example.test"].join("@");
    const crossFamily = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/teams-missed-call-rehearsal-output-stage-only.json",
    ), "utf8"));
    for (const value of [unsafe, crossFamily, null]) {
      await expect(client.verifyPurviewAuditBoundaryRehearsalOutput(
        "signed-token",
        value as PurviewAuditBoundaryRehearsalVerificationRequest,
      )).rejects.toMatchObject({ category: "validation-refused" });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["scenarioId", "other-scenario"],
    ["manifestSchemaVersion", 1],
    ["planDigestSha256", "0".repeat(64)],
    ["syntheticInputDigestSha256", "0".repeat(64)],
    ["receiptDigestSha256", "0".repeat(64)],
    ["outputDigestSha256", "0".repeat(64)],
    ["syntheticContract", "not-verified"],
    ["adapter", "refused"],
    ["receiptVerifier", "refused"],
    ["envelope", "refused"],
    ["externalEvidence", "proven"],
    ["claimCount", 13],
    ["producerAttributionClaimCount", 2],
  ] as const)("rejects %s summary substitution", async (field, value) => {
    const output = fixture();
    await expect(clientReturning(jsonResponse({
      ...expected(output),
      [field]: value,
    }, 200)).verifyPurviewAuditBoundaryRehearsalOutput(
      "signed-token",
      output,
    )).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("caps streamed response bytes and rejects content type or arbitrary response shapes", async () => {
    const oversized = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000));
        controller.enqueue(new Uint8Array(3_000));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    await expect(clientReturning(oversized)
      .verifyPurviewAuditBoundaryRehearsalOutput("signed-token", fixture()))
      .rejects.toMatchObject({ category: "response-too-large" });
    await expect(clientReturning(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })).verifyPurviewAuditBoundaryRehearsalOutput(
      "signed-token",
      fixture(),
    )).rejects.toMatchObject({ category: "safe-failure" });
    await expect(clientReturning(jsonResponse({
      ...expected(fixture()),
      extra: "arbitrary",
    }, 200)).verifyPurviewAuditBoundaryRehearsalOutput(
      "signed-token",
      fixture(),
    )).rejects.toMatchObject({ category: "safe-failure" });
  });
});

function fixture(): PurviewAuditBoundaryRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/purview-audit-boundary-rehearsal-output.json",
  ), "utf8")) as PurviewAuditBoundaryRehearsalVerificationRequest;
}

function expected(
  output: PurviewAuditBoundaryRehearsalVerificationRequest,
): VerifiedPurviewAuditBoundaryRehearsalSummary {
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: "purview-sharepoint-audit-boundary",
    manifestSchemaVersion: 2,
    planDigestSha256: output.binding!.planDigestSha256,
    syntheticInputDigestSha256:
      output.binding!.syntheticInputDigestSha256,
    receiptDigestSha256: output.binding!.receiptDigestSha256,
    outputDigestSha256: output.binding!.outputDigestSha256,
    syntheticContract:
      "deduplicated-producer-attribution-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    envelope: "accepted",
    externalEvidence: "all-uninspected",
    claimCount: 14,
    producerAttributionClaimCount: 1,
  };
}

function clientReturning(response: Response): HttpAfterPartyApi {
  return new HttpAfterPartyApi(
    "https://api.example.test",
    vi.fn<typeof fetch>().mockResolvedValue(response),
  );
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
