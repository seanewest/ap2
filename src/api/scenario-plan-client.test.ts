import { describe, expect, it, vi } from "vitest";
import {
  HttpAfterPartyApi,
  ScenarioPlanClientError,
} from "./client";
import {
  compileScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "../scenarios/scenario-plan";
import { API_SUPPORT_REFERENCE_HEADER } from "./support-reference.ts";

const REQUEST = {
  scenarioId: "help-desk-email-observation",
  actorAliases: {
    evidenceProducer: "producer",
    workloadActor: "sender",
    learner: "learner",
    cleanupOwner: "producer",
  },
  now: "2026-07-29T06:00:00Z",
  expiresAt: "2026-07-29T06:15:00Z",
  maximumBudgetUsd: 0,
  selectedResponseId: "report-help-desk-interpretation",
} as const satisfies ScenarioPlanningRequest;

describe("scenario-plan typed client", () => {
  it("posts the exact bounded contract and returns a validated safe plan", async () => {
    const plan = compileScenarioExecutionPlan(REQUEST);
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(plan, 200),
    );
    const client = new HttpAfterPartyApi("https://api.example.test", request);

    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .resolves.toEqual(plan);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "https://api.example.test/api/scenario-plan",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer signed-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(REQUEST),
      }),
    );
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [413, "request-too-large"],
    [503, "server-shutting-down"],
    [500, "safe-failure"],
  ] as const)("maps HTTP %s to fixed category %s", async (status, category) => {
    const client = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          status === 503
            ? { error: "server_shutting_down" }
            : { error: "arbitrary upstream text" },
          status,
        ),
      ),
    );

    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toMatchObject({ category });
  });

  it("preserves categorical compiler refusal without returning request data", async () => {
    const client = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        error: "scenario_plan_refused",
        category: "BUDGET_EXCEEDED",
      }, 400)),
    );

    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toEqual(
        new ScenarioPlanClientError(
          "validation-refused",
          "BUDGET_EXCEEDED",
        ),
      );
  });

  it("maps an unknown refusal category to a general safe failure", async () => {
    const client = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        error: "scenario_plan_refused",
        category: "ARBITRARY_SERVER_CATEGORY",
      }, 400)),
    );

    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toMatchObject({ category: "safe-failure" });
  });

  it("binds only a valid server support reference to a response failure", async () => {
    const supportReference = "r1_0123456789abcdef01234567";
    const client = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
        { error: "safe_failure" },
        500,
        supportReference,
      )),
    );

    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toMatchObject({
        category: "safe-failure",
        supportReference,
      });
  });

  it("rejects unsafe inputs before fetch and malformed or oversized output", async () => {
    const request = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", request);

    await expect(client.compileScenarioPlan("signed-token", {
      ...REQUEST,
      actorAliases: {
        ...REQUEST.actorAliases,
        learner: ["learner", "example.test"].join("@"),
      },
    })).rejects.toMatchObject({ category: "validation-refused" });
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValueOnce(new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toMatchObject({ category: "safe-failure" });

    request.mockResolvedValueOnce(
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(40_000));
          controller.enqueue(new Uint8Array(40_000));
          controller.close();
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects success payloads that do not preserve the exact safe contract", async () => {
    const plan = compileScenarioExecutionPlan(REQUEST);
    const client = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        ...plan,
        scenarioId: "different-scenario",
      }, 200)),
    );

    await expect(client.compileScenarioPlan("signed-token", REQUEST))
      .rejects.toMatchObject({ category: "safe-failure" });
  });

  it("compares actor aliases by role and binds every step alias to its owner", async () => {
    const reordered = {
      ...REQUEST,
      actorAliases: {
        cleanupOwner: "producer",
        learner: "learner",
        workloadActor: "sender",
        evidenceProducer: "producer",
      },
    } satisfies ScenarioPlanningRequest;
    const plan = compileScenarioExecutionPlan(reordered);
    const validClient = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(plan, 200)),
    );
    await expect(validClient.compileScenarioPlan("signed-token", reordered))
      .resolves.toEqual(plan);

    const stepIndex = plan.steps.findIndex(
      ({ actorAlias }) => actorAlias !== undefined,
    );
    const mismatched = {
      ...plan,
      steps: plan.steps.map((step, index) =>
        index === stepIndex ? { ...step, actorAlias: "wrong-alias" } : step
      ),
    };
    const invalidClient = new HttpAfterPartyApi(
      "https://api.example.test",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mismatched, 200)),
    );
    await expect(invalidClient.compileScenarioPlan("signed-token", reordered))
      .rejects.toMatchObject({ category: "safe-failure" });
  });
});

function jsonResponse(
  value: unknown,
  status: number,
  supportReference?: string,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(supportReference === undefined
        ? {}
        : { [API_SUPPORT_REFERENCE_HEADER]: supportReference }),
    },
  });
}
