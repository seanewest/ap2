// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  InMemoryScenarioPlanService,
  ScenarioPlanResponseTooLargeError,
} from "./scenario-plan.js";
import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "../src/scenarios/scenario-plan.js";

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
} as const satisfies ScenarioPlanningRequest;

describe("in-memory scenario-plan service", () => {
  it("validates before invoking the compiler", () => {
    const compiler = vi.fn(() => compileScenarioExecutionPlan(REQUEST));
    const service = new InMemoryScenarioPlanService(compiler);

    expect(() => service.compile({ ...REQUEST, extra: true })).toThrowError(
      new ScenarioPlanError("INPUT_INVALID"),
    );
    expect(compiler).not.toHaveBeenCalled();
  });

  it("refuses an oversized compiler result", () => {
    const baseline = compileScenarioExecutionPlan(REQUEST);
    const oversized: ScenarioExecutionPlan = {
      ...baseline,
      steps: Array.from(
        { length: 1_000 },
        (_, index) => ({
          ...baseline.steps[0]!,
          sequence: index + 1,
          id: `step-${index}`,
        }),
      ),
    };
    const service = new InMemoryScenarioPlanService(() => oversized);

    expect(() => service.compile(REQUEST)).toThrow(
      ScenarioPlanResponseTooLargeError,
    );
  });
});
