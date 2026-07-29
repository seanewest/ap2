import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  BatchFeasibilityClientError,
  HttpAfterPartyApi,
} from "./client";
import {
  feasibleBatchRequest,
} from "./multi-scenario-feasibility.fixtures";
import {
  compileScenarioExecutionPlan,
} from "../scenarios/scenario-plan";
import {
  planMultiScenarioFeasibility,
} from "../scenarios/multi-scenario-feasibility";
import type {
  BatchFeasibilityRequest,
} from "./multi-scenario-feasibility-contract";

describe("multi-scenario feasibility typed client", () => {
  it.each([false, true])(
    "posts and validates the exact safe result (many=%s)",
    async (many) => {
      const batch = feasibleBatchRequest(many);
      const result = calculate(batch);
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(result, 200),
      );
      const client = new HttpAfterPartyApi(
        "https://api.example.test",
        request,
      );

      await expect(
        client.calculateMultiScenarioFeasibility("signed-token", batch),
      ).resolves.toEqual(result);
      expect(request).toHaveBeenCalledWith(
        "https://api.example.test/api/multi-scenario-feasibility",
        expect.objectContaining({
          method: "POST",
          credentials: "omit",
          redirect: "error",
          headers: {
            Authorization: "Bearer signed-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(batch),
        }),
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
    const client = clientReturning(
      jsonResponse(
        status === 503
          ? { error: "server_shutting_down" }
          : { error: "arbitrary private text" },
        status,
      ),
    );
    await expect(
      client.calculateMultiScenarioFeasibility(
        "signed-token",
        feasibleBatchRequest(),
      ),
    ).rejects.toMatchObject({ category });
  });

  it("preserves only known compiler and planner refusal categories", async () => {
    const compiler = clientReturning(jsonResponse({
      error: "batch_feasibility_refused",
      category: "BUDGET_EXCEEDED",
    }, 400));
    const planner = clientReturning(jsonResponse({
      error: "batch_feasibility_refused",
      category: "PLAN_INVALID",
    }, 400));
    const unknown = clientReturning(jsonResponse({
      error: "batch_feasibility_refused",
      category: "ARBITRARY_SERVER_CATEGORY",
    }, 400));
    const request = feasibleBatchRequest();

    await expect(
      compiler.calculateMultiScenarioFeasibility("signed-token", request),
    ).rejects.toEqual(
      new BatchFeasibilityClientError(
        "validation-refused",
        "BUDGET_EXCEEDED",
      ),
    );
    await expect(
      planner.calculateMultiScenarioFeasibility("signed-token", request),
    ).rejects.toEqual(
      new BatchFeasibilityClientError("validation-refused", "PLAN_INVALID"),
    );
    await expect(
      unknown.calculateMultiScenarioFeasibility("signed-token", request),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("rejects raw, unknown, and unbounded requests before fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new HttpAfterPartyApi("https://api.example.test", fetcher);
    const raw = structuredClone(feasibleBatchRequest());
    raw.plans[0]!.planRequest.actorAliases.learner =
      ["learner", "example.test"].join("@");
    const extra = {
      ...feasibleBatchRequest(),
      payload: "arbitrary",
    };
    const duration = structuredClone(feasibleBatchRequest());
    (duration.session as { requestedDurationMinutes: number })
      .requestedDurationMinutes = Number.MAX_SAFE_INTEGER;

    for (const request of [raw, extra, duration]) {
      await expect(
        client.calculateMultiScenarioFeasibility(
          "signed-token",
          request,
        ),
      ).rejects.toMatchObject({ category: "validation-refused" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams under a hard response cap", async () => {
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
      clientReturning(oversized).calculateMultiScenarioFeasibility(
        "signed-token",
        feasibleBatchRequest(),
      ),
    ).rejects.toMatchObject({ category: "response-too-large" });
  });

  it("rejects result tampering, raw echoes, wrong content type, and bad JSON", async () => {
    const batch = feasibleBatchRequest();
    const result = calculate(batch);
    const cases = [
      jsonResponse({ ...result, planCount: 2 }, 200),
      jsonResponse({
        ...result,
        status: "infeasible",
        blockers: ["CONCURRENCY_OVERRUN"],
      }, 200),
      jsonResponse({ ...result, planRequest: batch.plans[0]!.planRequest }, 200),
      new Response(JSON.stringify(result), {
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
        clientReturning(response).calculateMultiScenarioFeasibility(
          "signed-token",
          batch,
        ),
      ).rejects.toMatchObject({ category: "safe-failure" });
    }
  });

  it("maps the server response cap and rejects expanded error shapes", async () => {
    const request = feasibleBatchRequest();
    const tooLarge = clientReturning(jsonResponse({
      error: "batch_feasibility_response_too_large",
    }, 500));
    const expanded = clientReturning(jsonResponse({
      error: "batch_feasibility_refused",
      category: "PLAN_INVALID",
      detail: "arbitrary",
    }, 400));

    await expect(
      tooLarge.calculateMultiScenarioFeasibility("signed-token", request),
    ).rejects.toMatchObject({ category: "response-too-large" });
    await expect(
      expanded.calculateMultiScenarioFeasibility("signed-token", request),
    ).rejects.toMatchObject({ category: "safe-failure" });
  });

  it("loads directly in Node without compiler or planner runtime imports", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "await import('./src/api/client.ts'); process.stdout.write('ok')",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("ok");
  });
});

function calculate(request: BatchFeasibilityRequest) {
  return planMultiScenarioFeasibility({
    schemaVersion: 1,
    label: "SCENARIO_FEASIBILITY_REQUEST",
    session: request.session,
    plans: request.plans.map(({ instanceAlias, planRequest }) => ({
      instanceAlias,
      plan: compileScenarioExecutionPlan(planRequest),
    })),
  });
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
