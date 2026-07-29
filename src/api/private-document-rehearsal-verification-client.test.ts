import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  HttpAfterPartyApi,
  PrivateDocumentRehearsalVerificationClientError,
} from "./client";
import type {
  PrivateDocumentRehearsalVerificationRequest,
  VerifiedPrivateDocumentRehearsalSummary,
} from "./private-document-rehearsal-verification-contract";

describe("private-document rehearsal verification typed client", () => {
  it.each(["cleaned", "learner"] as const)(
    "posts and independently binds the captured %s summary",
    async (branch) => {
      const output = fixture(branch);
      const summary = expected(output);
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(summary, 200),
      );
      const client = new HttpAfterPartyApi(
        "https://api.example.test",
        request,
      );

      await expect(
        client.verifyPrivateDocumentRehearsalOutput("signed-token", output),
      ).resolves.toEqual(summary);
      expect(request).toHaveBeenCalledWith(
        "https://api.example.test/api/private-document-rehearsal-verification",
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
  ] as const)("maps HTTP %s to fixed category %s", async (status, category) => {
    await expect(
      clientReturning(jsonResponse({ detail: "arbitrary" }, status))
        .verifyPrivateDocumentRehearsalOutput("signed-token", fixture()),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known exact refusal categories and response-cap errors", async () => {
    const known = clientReturning(jsonResponse({
      error: "private_document_rehearsal_refused",
      category: "CLEANUP_GAP",
    }, 400));
    const unknown = clientReturning(jsonResponse({
      error: "private_document_rehearsal_refused",
      category: "PRIVATE_DETAIL",
    }, 400));
    const tooLarge = clientReturning(jsonResponse({
      error: "private_document_rehearsal_response_too_large",
    }, 500));

    await expect(
      known.verifyPrivateDocumentRehearsalOutput("signed-token", fixture()),
    ).rejects.toEqual(
      new PrivateDocumentRehearsalVerificationClientError(
        "validation-refused",
        "CLEANUP_GAP",
      ),
    );
    await expect(
      unknown.verifyPrivateDocumentRehearsalOutput("signed-token", fixture()),
    ).rejects.toMatchObject({ category: "safe-failure" });
    await expect(
      tooLarge.verifyPrivateDocumentRehearsalOutput(
        "signed-token",
        fixture(),
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it("rejects raw, unknown, cross-family, and malformed input before fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", fetcher);
    const raw = structuredClone(fixture()) as unknown as Record<string, unknown>;
    raw.detail = ["person", "example.test"].join("@");
    const extra = structuredClone(fixture()) as unknown as Record<string, unknown>;
    extra.payload = "arbitrary";
    const avd = JSON.parse(readFileSync(
      join(process.cwd(), "scripts/fixtures/avd-three-vm-rehearsal-output.json"),
      "utf8",
    ));

    for (const value of [raw, extra, avd, null]) {
      await expect(
        client.verifyPrivateDocumentRehearsalOutput(
          "signed-token",
          value as PrivateDocumentRehearsalVerificationRequest,
        ),
      ).rejects.toMatchObject({ category: "validation-refused" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams the response under a hard cap", async () => {
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
    await expect(
      clientReturning(oversized).verifyPrivateDocumentRehearsalOutput(
        "signed-token",
        fixture(),
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it.each([
    ["scenarioId", "other-scenario"],
    ["manifestSchemaVersion", 1],
    ["planDigestSha256", "0".repeat(64)],
    ["fakeRunDigestSha256", "0".repeat(64)],
    ["syntheticBranch", "learner-observation"],
    ["fakeContract", "not-verified"],
    ["adapter", "refused"],
    ["receiptVerifier", "refused"],
    ["externalEvidence", "proven"],
    ["claimCount", 17],
  ] as const)("rejects %s summary substitution", async (field, value) => {
    const output = fixture();
    const summary = { ...expected(output), [field]: value };
    await expect(
      clientReturning(jsonResponse(summary, 200))
        .verifyPrivateDocumentRehearsalOutput("signed-token", output),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects response echoes, expanded errors, wrong types, and bad JSON", async () => {
    const output = fixture();
    const cases = [
      jsonResponse({ ...expected(output), fakeRun: output.fakeRun }, 200),
      jsonResponse({
        error: "private_document_rehearsal_refused",
        category: "INPUT_SHAPE",
        detail: "arbitrary",
      }, 400),
      new Response(JSON.stringify(expected(output)), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    for (const response of cases) {
      await expect(
        clientReturning(response).verifyPrivateDocumentRehearsalOutput(
          "signed-token",
          output,
        ),
      ).rejects.toMatchObject({ category: "safe-failure" });
    }
  });

  it("loads directly in Node without fake lifecycle or verifier runtime imports", () => {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      "await import('./src/api/client.ts'); process.stdout.write('ok')",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("ok");
  });
});

function fixture(
  branch: "cleaned" | "learner" = "cleaned",
): PrivateDocumentRehearsalVerificationRequest {
  const name = branch === "cleaned"
    ? "private-document-rehearsal-output-cleaned.json"
    : "private-document-rehearsal-output-learner.json";
  return JSON.parse(
    readFileSync(join(process.cwd(), "scripts/fixtures", name), "utf8"),
  ) as PrivateDocumentRehearsalVerificationRequest;
}

function expected(
  output: PrivateDocumentRehearsalVerificationRequest,
): VerifiedPrivateDocumentRehearsalSummary {
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: "private-document-evidence",
    manifestSchemaVersion: 2,
    planDigestSha256: output.binding!.planDigestSha256,
    fakeRunDigestSha256: output.binding!.fakeRunDigestSha256,
    syntheticBranch: output.binding!.syntheticBranch,
    fakeContract: "ordered-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
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
