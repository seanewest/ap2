import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HttpAfterPartyApi,
  OauthApplicationReconRehearsalVerificationClientError,
} from "./client";
import type {
  OauthApplicationReconRehearsalVerificationRequest,
  VerifiedOauthApplicationReconRehearsalSummary,
} from "./oauth-application-recon-rehearsal-verification-contract";

describe("OAuth application-recon rehearsal verification typed client", () => {
  it("posts with the registry contract and binds the safe summary", async () => {
    const output = fixture();
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(expected(output), 200),
    );
    const client = new HttpAfterPartyApi("https://api.example.test", request);
    await expect(
      client.verifyOauthApplicationReconRehearsalOutput(
        "signed-token",
        output,
      ),
    ).resolves.toEqual(expected(output));
    expect(request).toHaveBeenCalledWith(
      "https://api.example.test/api/oauth-application-recon-rehearsal-verification",
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
        .verifyOauthApplicationReconRehearsalOutput(
          "signed-token",
          fixture(),
        ),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known exact refusal categories", async () => {
    const known = clientReturning(jsonResponse({
      error: "oauth_application_recon_rehearsal_refused",
      category: "PAGINATION_UNCERTAIN",
    }, 400));
    const expanded = clientReturning(jsonResponse({
      error: "oauth_application_recon_rehearsal_refused",
      category: "PAGINATION_UNCERTAIN",
      detail: "arbitrary",
    }, 400));
    await expect(
      known.verifyOauthApplicationReconRehearsalOutput(
        "signed-token",
        fixture(),
      ),
    ).rejects.toEqual(
      new OauthApplicationReconRehearsalVerificationClientError(
        "validation-refused",
        "PAGINATION_UNCERTAIN",
      ),
    );
    await expect(
      expanded.verifyOauthApplicationReconRehearsalOutput(
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
      "scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json",
    ), "utf8"));
    for (const value of [unsafe, crossFamily, null]) {
      await expect(client.verifyOauthApplicationReconRehearsalOutput(
        "signed-token",
        value as OauthApplicationReconRehearsalVerificationRequest,
      )).rejects.toMatchObject({ category: "validation-refused" });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["scenarioId", "other-scenario"],
    ["manifestSchemaVersion", 1],
    ["planDigestSha256", "0".repeat(64)],
    ["fakeResultDigestSha256", "0".repeat(64)],
    ["outputDigestSha256", "0".repeat(64)],
    ["fakeContract", "not-verified"],
    ["adapter", "refused"],
    ["receiptVerifier", "refused"],
    ["envelope", "refused"],
    ["externalEvidence", "proven"],
    ["claimCount", 12],
  ] as const)("rejects %s summary substitution", async (field, value) => {
    const output = fixture();
    await expect(clientReturning(jsonResponse({
      ...expected(output),
      [field]: value,
    }, 200)).verifyOauthApplicationReconRehearsalOutput(
      "signed-token",
      output,
    )).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("caps streamed response bytes and rejects arbitrary response shapes", async () => {
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
      .verifyOauthApplicationReconRehearsalOutput("signed-token", fixture()))
      .rejects.toMatchObject({ category: "response-too-large" });
    await expect(clientReturning(jsonResponse({
      ...expected(fixture()),
      extra: "arbitrary",
    }, 200)).verifyOauthApplicationReconRehearsalOutput(
      "signed-token",
      fixture(),
    )).rejects.toMatchObject({ category: "safe-failure" });
  });
});

function fixture(): OauthApplicationReconRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/oauth-application-recon-rehearsal-output.json",
  ), "utf8")) as OauthApplicationReconRehearsalVerificationRequest;
}

function expected(
  output: OauthApplicationReconRehearsalVerificationRequest,
): VerifiedOauthApplicationReconRehearsalSummary {
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: "oauth-application-reconnaissance",
    manifestSchemaVersion: 2,
    planDigestSha256: output.binding!.planDigestSha256,
    fakeResultDigestSha256: output.binding!.fakeResultDigestSha256,
    outputDigestSha256:
      "1d89edb8b710176d63026723b842d4e1e36f801b3abf058fb36dbc6617a5c9bc",
    fakeContract: "ordered-four-read-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    envelope: "accepted",
    externalEvidence: "all-uninspected",
    claimCount: output.receipt!.candidateClaimCount,
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
