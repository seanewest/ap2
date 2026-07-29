import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ScenarioPlanError,
  compileScenarioExecutionPlan,
} from "../src/scenarios/scenario-plan";
import {
  MultiScenarioFeasibilityInputError,
  planMultiScenarioFeasibility,
} from "../src/scenarios/multi-scenario-feasibility";
import {
  feasibleBatchRequest,
} from "../src/api/multi-scenario-feasibility.fixtures";
import {
  BatchFeasibilityRefusalError,
  BatchFeasibilitySafeFailureError,
  InMemoryMultiScenarioFeasibilityService,
} from "./multi-scenario-feasibility";

describe("in-memory multi-scenario feasibility service", () => {
  it("compiles every request before invoking PR #92 exactly once", () => {
    const compiler = vi.fn(compileScenarioExecutionPlan);
    const planner = vi.fn(planMultiScenarioFeasibility);
    const service = new InMemoryMultiScenarioFeasibilityService(
      compiler,
      planner,
    );
    const request = feasibleBatchRequest(true);

    expect(service.calculate(request)).toMatchObject({
      status: "feasible",
      planCount: 2,
      conservativeAggregateUsdCeiling: "10.00",
    });
    expect(compiler).toHaveBeenCalledTimes(2);
    expect(planner).toHaveBeenCalledOnce();
    expect(planner.mock.calls[0]![0]).toMatchObject({
      label: "SCENARIO_FEASIBILITY_REQUEST",
      plans: [
        { instanceAlias: "email-one" },
        { instanceAlias: "avd-one" },
      ],
    });
  });

  it("preserves compiler and planner refusal categories", () => {
    const compilerRefusal = new InMemoryMultiScenarioFeasibilityService(
      () => {
        throw new ScenarioPlanError("BUDGET_EXCEEDED");
      },
    );
    const plannerRefusal = new InMemoryMultiScenarioFeasibilityService(
      compileScenarioExecutionPlan,
      () => {
        throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
      },
    );

    expect(() => compilerRefusal.calculate(feasibleBatchRequest())).toThrow(
      new BatchFeasibilityRefusalError("BUDGET_EXCEEDED"),
    );
    expect(() => plannerRefusal.calculate(feasibleBatchRequest())).toThrow(
      new BatchFeasibilityRefusalError("PLAN_INVALID"),
    );
  });

  it("isolates arbitrary failures and invalid planner output", () => {
    const thrown = new InMemoryMultiScenarioFeasibilityService(() => {
      throw new Error("private exception detail");
    });
    const invalid = new InMemoryMultiScenarioFeasibilityService(
      compileScenarioExecutionPlan,
      (request) => ({
        ...planMultiScenarioFeasibility(request),
        planCount: 99,
      }),
    );

    expect(() => thrown.calculate(feasibleBatchRequest())).toThrow(
      BatchFeasibilitySafeFailureError,
    );
    expect(() => invalid.calculate(feasibleBatchRequest())).toThrow(
      BatchFeasibilitySafeFailureError,
    );
  });

  it.each([
    ["conservativeAggregateUsdCeiling", "0.00"],
    ["humanGateCount", 0],
    ["earliestExpiryMarginMinutes", 999],
  ] as const)(
    "rejects planner tampering of %s against the authoritative summary",
    (field, value) => {
      const service = new InMemoryMultiScenarioFeasibilityService(
        compileScenarioExecutionPlan,
        (request) => ({
          ...planMultiScenarioFeasibility(request),
          [field]: value,
        }),
      );

      expect(() => service.calculate(feasibleBatchRequest(true))).toThrow(
        BatchFeasibilitySafeFailureError,
      );
    },
  );

  it("has no executor, transport, reservation, storage, retry, or telemetry path", () => {
    const source = readFileSync(
      join(process.cwd(), "api/multi-scenario-feasibility.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
    expect(source).not.toMatch(/\breserv(?:e|ation)/i);
    expect(source).not.toMatch(/\btelemetry/i);
    expect(source).not.toMatch(/\bexecute|execution\b/i);
  });
});
