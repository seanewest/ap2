import type { ScenarioExecutionPlan } from "./scenario-plan";

export const FEASIBILITY_BLOCKERS = [
  "UNKNOWN_COST_OR_DURATION",
  "INDIVIDUAL_BUDGET_OVERRUN",
  "INDIVIDUAL_EXPIRY_OVERRUN",
  "DUPLICATE_INSTANCE",
  "AGGREGATE_BUDGET_OVERRUN",
  "CONCURRENCY_OVERRUN",
  "SESSION_DURATION_OVERRUN",
  "EXPIRY_MARGIN_INSUFFICIENT",
  "HUMAN_GATE_NOT_ALLOWED",
] as const;

export type FeasibilityBlocker = typeof FEASIBILITY_BLOCKERS[number];

export const FEASIBILITY_INPUT_FAILURES = [
  "INPUT_INVALID",
  "INPUT_OVERSIZED",
  "PLAN_INVALID",
  "RAW_IDENTIFIER_REJECTED",
] as const;

export type FeasibilityInputFailure =
  (typeof FEASIBILITY_INPUT_FAILURES)[number];

export interface MultiScenarioFeasibilityRequest {
  schemaVersion: 1;
  label: "SCENARIO_FEASIBILITY_REQUEST";
  session: Readonly<{
    startsAt: string;
    requestedDurationMinutes: number;
    aggregateBudgetCeilingUsd: string;
    concurrencyLimit: number;
    minimumExpiryMarginMinutes: number;
    humanGatePolicy: "allow" | "refuse";
  }>;
  plans: readonly Readonly<{
    instanceAlias: string;
    plan: ScenarioExecutionPlan;
  }>[];
}

export interface MultiScenarioFeasibilityResult {
  schemaVersion: 1;
  label: "FEASIBILITY_ONLY";
  status: "feasible" | "infeasible";
  planCount: number;
  maximumConcurrency: number;
  conservativeAggregateUsdCeiling: string | null;
  requestedSessionDurationMinutes: number;
  earliestExpiryMarginMinutes: number | null;
  humanGateCount: number;
  blockers: readonly FeasibilityBlocker[];
}
