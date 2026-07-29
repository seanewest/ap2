// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MultiScenarioFeasibilityInputError,
  planMultiScenarioFeasibility,
  type FeasibilityInputFailure,
  type MultiScenarioFeasibilityRequest,
} from "./multi-scenario-feasibility";
import {
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "./scenario-plan";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

const HELP_DESK_REQUEST = {
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

const AVD_REQUEST = {
  scenarioId: "avd-three-vm-substrate",
  actorAliases: {
    evidenceProducer: "orchestrator",
    workloadActor: "endpoint",
    learner: "learner",
    responder: "orchestrator",
    cleanupOwner: "orchestrator",
  },
  now: "2026-07-29T06:00:00Z",
  expiresAt: "2026-07-29T11:00:00Z",
  maximumBudgetUsd: 10,
} as const satisfies ScenarioPlanningRequest;

function item(instanceAlias: string, plan: ScenarioExecutionPlan) {
  return { instanceAlias, plan };
}

function request(
  plans = [item(
    "email-one",
    compileScenarioExecutionPlan(HELP_DESK_REQUEST),
  )],
): Mutable<MultiScenarioFeasibilityRequest> {
  return {
    schemaVersion: 1,
    label: "SCENARIO_FEASIBILITY_REQUEST",
    session: {
      startsAt: "2026-07-29T06:00:00Z",
      requestedDurationMinutes: 10,
      aggregateBudgetCeilingUsd: "0.00",
      concurrencyLimit: plans.length,
      minimumExpiryMarginMinutes: 5,
      humanGatePolicy: "allow",
    },
    plans: structuredClone(plans),
  } as unknown as Mutable<MultiScenarioFeasibilityRequest>;
}

function failure(action: () => unknown): FeasibilityInputFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MultiScenarioFeasibilityInputError);
    return (error as MultiScenarioFeasibilityInputError).category;
  }
  throw new Error("Expected feasibility input to fail.");
}

describe("multi-scenario feasibility planner", () => {
  it("accepts one canonical plan without scheduling or availability claims", () => {
    expect(planMultiScenarioFeasibility(request())).toEqual({
      schemaVersion: 1,
      label: "FEASIBILITY_ONLY",
      status: "feasible",
      planCount: 1,
      maximumConcurrency: 1,
      conservativeAggregateUsdCeiling: "0.00",
      requestedSessionDurationMinutes: 10,
      earliestExpiryMarginMinutes: 5,
      humanGateCount: 1,
      blockers: [],
    });
  });

  it("sums several canonical plans conservatively and deterministically", () => {
    const input = request([
      item(
        "email-one",
        compileScenarioExecutionPlan(HELP_DESK_REQUEST),
      ),
      item(
        "avd-one",
        compileScenarioExecutionPlan(AVD_REQUEST),
      ),
    ]);
    input.session.aggregateBudgetCeilingUsd = "10.00";
    const first = planMultiScenarioFeasibility(input);
    const second = planMultiScenarioFeasibility(structuredClone(input));
    const reversed = structuredClone(input);
    reversed.plans.reverse();

    expect(first).toEqual(second);
    expect(first).toEqual(planMultiScenarioFeasibility(reversed));
    expect(first).toMatchObject({
      status: "feasible",
      planCount: 2,
      maximumConcurrency: 2,
      conservativeAggregateUsdCeiling: "10.00",
      earliestExpiryMarginMinutes: 5,
      humanGateCount: 2,
      blockers: [],
    });
  });

  it("allows duplicate scenarios only with distinct safe instance aliases", () => {
    const plan = compileScenarioExecutionPlan(AVD_REQUEST);
    const distinct = request([
      item("avd-one", plan),
      item("avd-two", plan),
    ]);
    distinct.session.aggregateBudgetCeilingUsd = "20.00";
    expect(planMultiScenarioFeasibility(distinct).status).toBe("feasible");

    distinct.plans[1]!.instanceAlias = "avd-one";
    expect(planMultiScenarioFeasibility(distinct)).toMatchObject({
      status: "infeasible",
      blockers: ["DUPLICATE_INSTANCE"],
    });
  });

  it("uses integer cents and refuses rounding beyond the fixed scale", () => {
    const exact = request([
      item("avd-one", compileScenarioExecutionPlan(AVD_REQUEST)),
      item("avd-two", compileScenarioExecutionPlan(AVD_REQUEST)),
    ]);
    exact.session.aggregateBudgetCeilingUsd = "20.00";
    expect(
      planMultiScenarioFeasibility(exact)
        .conservativeAggregateUsdCeiling,
    ).toBe("20.00");

    exact.session.aggregateBudgetCeilingUsd = "19.999";
    expect(failure(() => planMultiScenarioFeasibility(exact))).toBe(
      "INPUT_INVALID",
    );
  });

  it("detects an aggregate-only budget overrun without discounting", () => {
    const plan = compileScenarioExecutionPlan(AVD_REQUEST);
    const input = request([
      item("avd-one", plan),
      item("avd-two", plan),
    ]);
    input.session.aggregateBudgetCeilingUsd = "19.99";
    expect(planMultiScenarioFeasibility(input)).toMatchObject({
      status: "infeasible",
      conservativeAggregateUsdCeiling: "20.00",
      blockers: ["AGGREGATE_BUDGET_OVERRUN"],
    });
  });

  it("refuses a concurrency overrun without constructing a schedule", () => {
    const input = request([
      item(
        "email-one",
        compileScenarioExecutionPlan(HELP_DESK_REQUEST),
      ),
      item(
        "avd-one",
        compileScenarioExecutionPlan(AVD_REQUEST),
      ),
    ]);
    input.session.aggregateBudgetCeilingUsd = "10.00";
    input.session.concurrencyLimit = 1;
    expect(planMultiScenarioFeasibility(input)).toMatchObject({
      status: "infeasible",
      maximumConcurrency: 2,
      blockers: ["CONCURRENCY_OVERRUN"],
    });
  });

  it("reports individual budget and expiry contract overruns", () => {
    const budget = request([
      item("avd-one", compileScenarioExecutionPlan(AVD_REQUEST)),
    ]);
    budget.session.aggregateBudgetCeilingUsd = "10.00";
    (budget.plans[0]!.plan.budget as {
      suppliedCeiling: number;
    }).suppliedCeiling = 9;
    expect(planMultiScenarioFeasibility(budget)).toMatchObject({
      status: "infeasible",
      blockers: ["INDIVIDUAL_BUDGET_OVERRUN"],
    });

    const expiry = request();
    (expiry.plans[0]!.plan as {
      expiresAt: string;
    }).expiresAt = expiry.plans[0]!.plan.generatedAt;
    expect(planMultiScenarioFeasibility(expiry)).toMatchObject({
      status: "infeasible",
      blockers: [
        "INDIVIDUAL_EXPIRY_OVERRUN",
        "SESSION_DURATION_OVERRUN",
      ],
    });

    const overlong = request();
    (overlong.plans[0]!.plan as {
      expiresAt: string;
    }).expiresAt = "2026-07-29T07:01:00Z";
    expect(planMultiScenarioFeasibility(overlong)).toMatchObject({
      status: "infeasible",
      blockers: ["INDIVIDUAL_EXPIRY_OVERRUN"],
    });
  });

  it("refuses session duration and expiry-margin overruns separately", () => {
    const duration = request();
    duration.session.requestedDurationMinutes = 16;
    duration.session.minimumExpiryMarginMinutes = 0;
    expect(planMultiScenarioFeasibility(duration)).toMatchObject({
      status: "infeasible",
      earliestExpiryMarginMinutes: -1,
      blockers: ["SESSION_DURATION_OVERRUN"],
    });

    const margin = request();
    margin.session.requestedDurationMinutes = 10;
    margin.session.minimumExpiryMarginMinutes = 6;
    expect(planMultiScenarioFeasibility(margin)).toMatchObject({
      status: "infeasible",
      earliestExpiryMarginMinutes: 5,
      blockers: ["EXPIRY_MARGIN_INSUFFICIENT"],
    });
  });

  it("counts human gates and enforces the session policy", () => {
    const input = request();
    input.session.humanGatePolicy = "refuse";
    expect(planMultiScenarioFeasibility(input)).toMatchObject({
      status: "infeasible",
      humanGateCount: 1,
      blockers: ["HUMAN_GATE_NOT_ALLOWED"],
    });
  });

  it("treats unknown cost or duration as infeasible", () => {
    const cost = request() as unknown as Record<string, unknown>;
    const costPlans = cost.plans as Array<{
      plan: { budget: { plannedMaximum: unknown } };
    }>;
    costPlans[0]!.plan.budget.plannedMaximum = null;
    expect(planMultiScenarioFeasibility(cost)).toMatchObject({
      status: "infeasible",
      conservativeAggregateUsdCeiling: null,
      blockers: ["UNKNOWN_COST_OR_DURATION"],
    });

    const duration = request() as unknown as Record<string, unknown>;
    const durationPlans = duration.plans as Array<{
      plan: { expiresAt: unknown };
    }>;
    durationPlans[0]!.plan.expiresAt = null;
    expect(planMultiScenarioFeasibility(duration)).toMatchObject({
      status: "infeasible",
      earliestExpiryMarginMinutes: null,
      blockers: ["UNKNOWN_COST_OR_DURATION"],
    });
  });

  it("rejects unknown fields and noncanonical plan drift", () => {
    const top = request() as unknown as Record<string, unknown>;
    top.execute = false;
    expect(failure(() => planMultiScenarioFeasibility(top))).toBe(
      "INPUT_INVALID",
    );

    const session = request() as unknown as Record<string, unknown>;
    (session.session as Record<string, unknown>).reserve = false;
    expect(failure(() => planMultiScenarioFeasibility(session))).toBe(
      "INPUT_INVALID",
    );

    const itemInput = request() as unknown as Record<string, unknown>;
    const itemPlans = itemInput.plans as Array<Record<string, unknown>>;
    itemPlans[0]!.worker = "none";
    expect(failure(() => planMultiScenarioFeasibility(itemInput))).toBe(
      "INPUT_INVALID",
    );

    const plan = request() as unknown as Record<string, unknown>;
    const plans = plan.plans as Array<{
      plan: Record<string, unknown>;
    }>;
    plans[0]!.plan.extra = "safe";
    expect(failure(() => planMultiScenarioFeasibility(plan))).toBe(
      "PLAN_INVALID",
    );

    const digest = request();
    (digest.plans[0]!.plan as {
      digestSha256: string;
    }).digestSha256 = "0".repeat(64);
    expect(failure(() => planMultiScenarioFeasibility(digest))).toBe(
      "PLAN_INVALID",
    );
  });

  it("rejects unrelated or discounted drift on an infeasible plan", () => {
    const unsafe = request([
      item("avd-one", compileScenarioExecutionPlan(AVD_REQUEST)),
    ]) as unknown as Record<string, unknown>;
    const unsafePlan = (unsafe.plans as Array<{
      plan: {
        budget: { plannedMaximum: unknown };
        expiresAt: unknown;
        generatedAt: unknown;
        steps: Array<{ actorAlias?: string }>;
      };
    }>)[0]!.plan;
    unsafePlan.budget.plannedMaximum = 0;
    unsafePlan.expiresAt = unsafePlan.generatedAt;
    unsafePlan.steps.find(({ actorAlias }) => actorAlias !== undefined)!
      .actorAlias = ["person", "example.test"].join("@");
    expect(failure(() => planMultiScenarioFeasibility(unsafe))).toBe(
      "RAW_IDENTIFIER_REJECTED",
    );

    const discounted = request([
      item("avd-one", compileScenarioExecutionPlan(AVD_REQUEST)),
    ]);
    (discounted.plans[0]!.plan.budget as {
      plannedMaximum: number;
    }).plannedMaximum = 0;
    (discounted.plans[0]!.plan as {
      expiresAt: string;
    }).expiresAt = discounted.plans[0]!.plan.generatedAt;
    expect(failure(() => planMultiScenarioFeasibility(discounted))).toBe(
      "PLAN_INVALID",
    );

    const excludedRaw = request() as unknown as Record<string, unknown>;
    const excludedPlan = (excludedRaw.plans as Array<{
      plan: { generatedAt: unknown };
    }>)[0]!.plan;
    excludedPlan.generatedAt = ["access", "token", "secret"].join("-");
    expect(failure(() => planMultiScenarioFeasibility(excludedRaw))).toBe(
      "RAW_IDENTIFIER_REJECTED",
    );
  });

  it("accepts semantically identical plans with reordered object keys", () => {
    const input = request();
    const plan = input.plans[0]!.plan;
    input.plans[0]!.plan = {
      digestSha256: plan.digestSha256,
      terminalProof: plan.terminalProof,
      steps: plan.steps,
      selectedResponseId: plan.selectedResponseId,
      budget: {
        suppliedCeiling: plan.budget.suppliedCeiling,
        plannedMaximum: plan.budget.plannedMaximum,
        currency: plan.budget.currency,
      },
      actorAliases: plan.actorAliases,
      expiresAt: plan.expiresAt,
      generatedAt: plan.generatedAt,
      scenarioId: plan.scenarioId,
      kind: plan.kind,
      schemaVersion: plan.schemaVersion,
    } as typeof plan;
    expect(planMultiScenarioFeasibility(input).status).toBe("feasible");
  });

  it("rejects unsafe aliases without echoing them", () => {
    const input = request();
    input.plans[0]!.instanceAlias = ["person", "example.test"].join("@");
    expect(failure(() => planMultiScenarioFeasibility(input))).toBe(
      "RAW_IDENTIFIER_REJECTED",
    );
  });

  it("rejects malformed, empty, excessive, and oversized input", () => {
    expect(failure(() => planMultiScenarioFeasibility(null))).toBe(
      "INPUT_INVALID",
    );
    const empty = request();
    empty.plans = [];
    expect(failure(() => planMultiScenarioFeasibility(empty))).toBe(
      "INPUT_INVALID",
    );
    const excessive = request();
    excessive.plans = Array.from(
      { length: 17 },
      (_value, index) =>
        item(
          `email-${index}`,
          compileScenarioExecutionPlan(HELP_DESK_REQUEST),
        ),
    ) as unknown as typeof excessive.plans;
    expect(failure(() => planMultiScenarioFeasibility(excessive))).toBe(
      "INPUT_INVALID",
    );
    const oversized = request() as unknown as Record<string, unknown>;
    oversized.extra = "x".repeat(1024 * 1024);
    expect(failure(() => planMultiScenarioFeasibility(oversized))).toBe(
      "INPUT_OVERSIZED",
    );
  });

  it("has no executor, scheduler, network, retry, or persistence path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/scenarios/multi-scenario-feasibility.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
    expect(source).not.toMatch(/\bschedul(?:e|er|ing)\b/i);
    expect(source).not.toMatch(/\bexecute|execution\b/i);
    expect(source).not.toMatch(/\bworker\b/i);
  });

  it("evaluates one explicit JSON file with stable CLI outcomes", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-feasibility-"));
    const feasiblePath = join(directory, "feasible.json");
    const blockedPath = join(directory, "blocked.json");
    const malformedPath = join(directory, "malformed.json");
    const oversizedPath = join(directory, "oversized.json");
    try {
      const feasible = request();
      const blocked = request();
      blocked.session.humanGatePolicy = "refuse";
      writeFileSync(feasiblePath, JSON.stringify(feasible), { mode: 0o600 });
      writeFileSync(blockedPath, JSON.stringify(blocked), { mode: 0o600 });
      writeFileSync(malformedPath, "{", { mode: 0o600 });
      writeFileSync(oversizedPath, " ".repeat(1024 * 1024 + 1), {
        mode: 0o600,
      });

      const run = (path: string) =>
        spawnSync(
          process.execPath,
          ["scripts/plan-multi-scenario-feasibility.ts", path],
          { cwd: process.cwd(), encoding: "utf8" },
        );
      const feasibleRun = run(feasiblePath);
      expect(feasibleRun.status).toBe(0);
      expect(JSON.parse(feasibleRun.stdout)).toMatchObject({
        label: "FEASIBILITY_ONLY",
        status: "feasible",
      });
      expect(feasibleRun.stdout).not.toContain(feasiblePath);

      const blockedRun = run(blockedPath);
      expect(blockedRun.status).toBe(3);
      expect(JSON.parse(blockedRun.stdout)).toMatchObject({
        status: "infeasible",
        blockers: ["HUMAN_GATE_NOT_ALLOWED"],
      });

      const malformedRun = run(malformedPath);
      expect(malformedRun.status).toBe(2);
      expect(JSON.parse(malformedRun.stderr)).toEqual({
        schemaVersion: 1,
        label: "FEASIBILITY_ONLY",
        status: "refused",
        failure: "INPUT_INVALID",
      });
      expect(malformedRun.stderr).not.toContain(malformedPath);

      const oversizedRun = run(oversizedPath);
      expect(oversizedRun.status).toBe(2);
      expect(JSON.parse(oversizedRun.stderr)).toMatchObject({
        status: "refused",
        failure: "INPUT_OVERSIZED",
      });
      expect(oversizedRun.stderr).not.toContain(oversizedPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
