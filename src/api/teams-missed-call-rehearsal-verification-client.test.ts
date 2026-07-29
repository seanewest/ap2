import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HttpAfterPartyApi,
  TeamsMissedCallRehearsalVerificationClientError,
} from "./client";
import type {
  TeamsMissedCallRehearsalVerificationRequest,
  VerifiedTeamsMissedCallRehearsalSummary,
} from "./teams-missed-call-rehearsal-verification-contract";

const BRANCHES = [
  "stage-only",
  "native-retained",
  "reported-retained",
  "native-cleaned",
] as const;

describe("Teams missed-call rehearsal verification typed client", () => {
  it.each(BRANCHES)(
    "posts and independently binds the %s summary",
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
        client.verifyTeamsMissedCallRehearsalOutput(
          "signed-token",
          output,
        ),
      ).resolves.toEqual(summary);
      expect(request).toHaveBeenCalledWith(
        "https://api.example.test/api/teams-missed-call-rehearsal-verification",
        {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          headers: {
            Authorization: "Bearer signed-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(output),
        },
      );
    },
  );

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [413, "request-too-large"],
    [503, "server-shutting-down"],
    [500, "safe-failure"],
  ] as const)("maps HTTP %s to fixed category %s", async (status, category) => {
    await expect(
      clientReturning(jsonResponse(
        status === 503
          ? { error: "server_shutting_down" }
          : { detail: "arbitrary" },
        status,
      ))
        .verifyTeamsMissedCallRehearsalOutput("signed-token", fixture()),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only exact refusal and response-cap errors", async () => {
    const known = clientReturning(jsonResponse({
      error: "teams_missed_call_rehearsal_refused",
      category: "TWO_SURFACE_GAP",
    }, 400));
    const unknown = clientReturning(jsonResponse({
      error: "teams_missed_call_rehearsal_refused",
      category: "PRIVATE_DETAIL",
    }, 400));
    const expanded = clientReturning(jsonResponse({
      error: "teams_missed_call_rehearsal_refused",
      category: "INPUT_SHAPE",
      detail: "arbitrary",
    }, 400));
    const tooLarge = clientReturning(jsonResponse({
      error: "teams_missed_call_rehearsal_response_too_large",
    }, 500));

    await expect(
      known.verifyTeamsMissedCallRehearsalOutput("signed-token", fixture()),
    ).rejects.toEqual(
      new TeamsMissedCallRehearsalVerificationClientError(
        "validation-refused",
        "TWO_SURFACE_GAP",
      ),
    );
    for (const client of [unknown, expanded]) {
      await expect(
        client.verifyTeamsMissedCallRehearsalOutput(
          "signed-token",
          fixture(),
        ),
      ).rejects.toMatchObject({ category: "safe-failure" });
    }
    await expect(
      tooLarge.verifyTeamsMissedCallRehearsalOutput(
        "signed-token",
        fixture(),
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it("rejects raw, unknown, cross-family, and malformed input before fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", fetcher);
    const raw = fixture() as unknown as Record<string, unknown>;
    raw.detail = ["person", "example.test"].join("@");
    const extra = fixture() as unknown as Record<string, unknown>;
    extra.payload = "arbitrary";
    const privateDocument = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
    ), "utf8"));

    for (const value of [raw, extra, privateDocument, null]) {
      await expect(
        client.verifyTeamsMissedCallRehearsalOutput(
          "signed-token",
          value as TeamsMissedCallRehearsalVerificationRequest,
        ),
      ).rejects.toMatchObject({ category: "validation-refused" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams response bytes under a hard cap", async () => {
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
      clientReturning(oversized).verifyTeamsMissedCallRehearsalOutput(
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
    ["syntheticBranch", "native-cleaned"],
    ["fakeContract", "not-verified"],
    ["nativeObservation", "proven"],
    ["report", "proven"],
    ["cleanup", "proven"],
    ["adapter", "refused"],
    ["receiptVerifier", "refused"],
    ["externalEvidence", "proven"],
    ["canonicalLearnerInterpretation", "proven"],
    ["claimCount", 13],
  ] as const)("rejects %s summary substitution", async (field, value) => {
    const output = fixture();
    const summary = { ...expected(output), [field]: value };
    await expect(
      clientReturning(jsonResponse(summary, 200))
        .verifyTeamsMissedCallRehearsalOutput("signed-token", output),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects response echoes, wrong content type, bad JSON, and arbitrary errors", async () => {
    const output = fixture();
    const cases = [
      jsonResponse({ ...expected(output), fakeRun: output.fakeRun }, 200),
      new Response(JSON.stringify(expected(output)), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      jsonResponse({ error: "arbitrary", detail: "private" }, 400),
    ];
    for (const response of cases) {
      await expect(
        clientReturning(response).verifyTeamsMissedCallRehearsalOutput(
          "signed-token",
          output,
        ),
      ).rejects.toMatchObject({ category: "safe-failure" });
    }
  });

  it("loads browser-safe client code without verifier or Node runtime imports", () => {
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
  branch: typeof BRANCHES[number] = "stage-only",
): TeamsMissedCallRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures",
    `teams-missed-call-rehearsal-output-${branch}.json`,
  ), "utf8")) as TeamsMissedCallRehearsalVerificationRequest;
}

function expected(
  output: TeamsMissedCallRehearsalVerificationRequest,
): VerifiedTeamsMissedCallRehearsalSummary {
  const branch = output.binding!.syntheticBranch;
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: "teams-missed-call-observation",
    manifestSchemaVersion: 2,
    planDigestSha256: output.binding!.planDigestSha256,
    fakeRunDigestSha256: output.binding!.fakeRunDigestSha256,
    syntheticBranch: branch,
    fakeContract: "one-attempt-categorical-verified",
    nativeObservation: branch === "stage-only"
      ? "uninspected"
      : "two-surface",
    report: branch === "reported-retained"
      ? "reported"
      : "uninspected",
    cleanup: branch === "native-cleaned"
      ? "two-surface-absent"
      : "uninspected",
    adapter: "accepted",
    receiptVerifier: "accepted",
    externalEvidence: "all-uninspected",
    canonicalLearnerInterpretation: "uninspected",
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
