import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HelpDeskEmailRehearsalVerificationClientError,
  HttpAfterPartyApi,
} from "./client";
import type {
  HelpDeskEmailRehearsalVerificationRequest,
  VerifiedHelpDeskEmailRehearsalSummary,
} from "./help-desk-email-rehearsal-verification-contract";

describe("help-desk email rehearsal verification typed client", () => {
  it.each(["send", "retained", "cleaned"] as const)(
    "posts and binds the captured %s summary",
    async (branch) => {
      const output = fixture(branch);
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(expected(output), 200),
      );
      const client = new HttpAfterPartyApi("https://api.example.test", request);
      await expect(
        client.verifyHelpDeskEmailRehearsalOutput("signed-token", output),
      ).resolves.toEqual(expected(output));
      expect(request).toHaveBeenCalledWith(
        "https://api.example.test/api/help-desk-email-rehearsal-verification",
        expect.objectContaining({
          method: "POST",
          credentials: "omit",
          redirect: "error",
          body: JSON.stringify(output),
        }),
      );
    },
  );

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [413, "request-too-large"],
    [500, "safe-failure"],
  ] as const)("maps HTTP %s to %s", async (status, category) => {
    await expect(
      clientReturning(jsonResponse({ detail: "arbitrary" }, status))
        .verifyHelpDeskEmailRehearsalOutput("signed-token", fixture()),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known exact refusal categories", async () => {
    const known = clientReturning(jsonResponse({
      error: "help_desk_email_rehearsal_refused",
      category: "CLEANUP_GAP",
    }, 400));
    const expanded = clientReturning(jsonResponse({
      error: "help_desk_email_rehearsal_refused",
      category: "CLEANUP_GAP",
      detail: "arbitrary",
    }, 400));
    await expect(
      known.verifyHelpDeskEmailRehearsalOutput("signed-token", fixture()),
    ).rejects.toEqual(new HelpDeskEmailRehearsalVerificationClientError(
      "validation-refused",
      "CLEANUP_GAP",
    ));
    await expect(
      expanded.verifyHelpDeskEmailRehearsalOutput("signed-token", fixture()),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects unsafe, unknown, cross-family, and malformed input before fetch", async () => {
    const request = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", request);
    const unsafe = structuredClone(fixture()) as unknown as Record<string, unknown>;
    unsafe.detail = ["person", "example.test"].join("@");
    const crossFamily = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
    ), "utf8"));
    for (const value of [unsafe, crossFamily, null]) {
      await expect(client.verifyHelpDeskEmailRehearsalOutput(
        "signed-token",
        value as HelpDeskEmailRehearsalVerificationRequest,
      )).rejects.toMatchObject({ category: "validation-refused" });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["scenarioId", "other-scenario"],
    ["manifestSchemaVersion", 1],
    ["planDigestSha256", "0".repeat(64)],
    ["fakeRunDigestSha256", "0".repeat(64)],
    ["syntheticBranch", "learner-observed-cleaned"],
    ["fakeContract", "not-verified"],
    ["adapter", "refused"],
    ["receiptVerifier", "refused"],
    ["envelope", "refused"],
    ["externalEvidence", "proven"],
    ["claimCount", 14],
  ] as const)("rejects %s summary substitution", async (field, value) => {
    const output = fixture();
    await expect(clientReturning(jsonResponse({
      ...expected(output),
      [field]: value,
    }, 200)).verifyHelpDeskEmailRehearsalOutput(
      "signed-token",
      output,
    )).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("caps response bytes and rejects arbitrary response shapes", async () => {
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
      .verifyHelpDeskEmailRehearsalOutput("signed-token", fixture()))
      .rejects.toMatchObject({ category: "response-too-large" });
    await expect(clientReturning(jsonResponse({
      ...expected(fixture()),
      fakeRun: {},
    }, 200)).verifyHelpDeskEmailRehearsalOutput("signed-token", fixture()))
      .rejects.toMatchObject({ category: "safe-failure" });
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

function expected(
  output: HelpDeskEmailRehearsalVerificationRequest,
): VerifiedHelpDeskEmailRehearsalSummary {
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: "help-desk-email-observation",
    manifestSchemaVersion: 2,
    planDigestSha256: output.binding!.planDigestSha256,
    fakeRunDigestSha256: output.binding!.fakeRunDigestSha256,
    syntheticBranch: output.binding!.syntheticBranch,
    fakeContract: "one-shot-terminal-verified",
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
