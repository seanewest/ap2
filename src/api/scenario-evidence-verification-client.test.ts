import { describe, expect, it, vi } from "vitest";
import {
  HttpAfterPartyApi,
  ScenarioEvidenceVerificationClientError,
} from "./client";
import { CANONICAL_RECEIPT_FIXTURES } from "../scenarios/scenario-evidence-receipt.fixtures";
import { verifyCanonicalScenarioEvidenceReceipt } from "../scenarios/scenario-evidence-verification";

describe("scenario evidence verification typed client", () => {
  it.each(CANONICAL_RECEIPT_FIXTURES)(
    "posts and validates canonical $name",
    async ({ receipt }) => {
      const verified = verifyCanonicalScenarioEvidenceReceipt(receipt);
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(verified, 200),
      );
      const client = new HttpAfterPartyApi(
        "https://api.example.test",
        request,
      );

      await expect(
        client.verifyScenarioEvidenceReceipt("signed-token", receipt),
      ).resolves.toEqual(verified);
      expect(request).toHaveBeenCalledWith(
        "https://api.example.test/api/scenario-evidence-verification",
        expect.objectContaining({
          method: "POST",
          credentials: "omit",
          redirect: "error",
          headers: {
            Authorization: "Bearer signed-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(receipt),
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
    const client = clientReturning(
      jsonResponse({ error: "arbitrary upstream text" }, status),
    );

    await expect(
      client.verifyScenarioEvidenceReceipt(
        "signed-token",
        CANONICAL_RECEIPT_FIXTURES[0]!.receipt,
      ),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known categorical server refusals", async () => {
    const known = clientReturning(jsonResponse({
      error: "scenario_evidence_receipt_refused",
      category: "state-promotion",
    }, 400));
    const unknown = clientReturning(jsonResponse({
      error: "scenario_evidence_receipt_refused",
      category: "arbitrary-server-category",
    }, 400));
    const receipt = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;

    await expect(known.verifyScenarioEvidenceReceipt("signed-token", receipt))
      .rejects.toEqual(
        new ScenarioEvidenceVerificationClientError(
          "validation-refused",
          "state-promotion",
        ),
      );
    await expect(unknown.verifyScenarioEvidenceReceipt("signed-token", receipt))
      .rejects.toMatchObject({ category: "safe-failure" });
  });

  it("refuses non-canonical claim identifiers before fetch", async () => {
    const request = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", request);
    const receipt = structuredClone(CANONICAL_RECEIPT_FIXTURES[0]!.receipt);
    receipt.claims[0]!.id = "run-abc123";

    await expect(
      client.verifyScenarioEvidenceReceipt(
        "signed-token",
        receipt,
      ),
    ).rejects.toMatchObject({
      category: "validation-refused",
      refusalCategory: "raw-identifier",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("streams with a hard response cap", async () => {
    const oversized = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(70_000));
        controller.enqueue(new Uint8Array(70_000));
        controller.close();
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const client = clientReturning(oversized);

    await expect(
      client.verifyScenarioEvidenceReceipt(
        "signed-token",
        CANONICAL_RECEIPT_FIXTURES[0]!.receipt,
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it("validates roles by name and every normalized claim/category", async () => {
    const receipt = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;
    const verified = verifyCanonicalScenarioEvidenceReceipt(receipt);
    const reorderedRoles = {
      ...verified,
      roles: {
        learner: verified.roles.learner,
        workloadActor: verified.roles.workloadActor,
        evidenceProducer: verified.roles.evidenceProducer,
      },
    };
    await expect(
      clientReturning(jsonResponse(reorderedRoles, 200))
        .verifyScenarioEvidenceReceipt("signed-token", receipt),
    ).resolves.toEqual(verified);

    const altered = {
      ...verified,
      claims: verified.claims.map((claim, index) =>
        index === 0
          ? {
            ...claim,
            state: claim.state === "proven" ? "uninspected" : "proven",
          }
          : claim
      ),
    };
    await expect(
      clientReturning(jsonResponse(altered, 200))
        .verifyScenarioEvidenceReceipt("signed-token", receipt),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("maps the server response-size refusal and rejects wrong content type", async () => {
    const receipt = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;
    const tooLarge = clientReturning(jsonResponse({
      error: "scenario_evidence_receipt_response_too_large",
    }, 500));
    const wrongType = clientReturning(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }));

    await expect(
      tooLarge.verifyScenarioEvidenceReceipt("signed-token", receipt),
    ).rejects.toMatchObject({ category: "response-too-large" });
    await expect(
      wrongType.verifyScenarioEvidenceReceipt("signed-token", receipt),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });
});

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
