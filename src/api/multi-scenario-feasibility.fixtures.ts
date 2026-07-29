import type { BatchFeasibilityRequest } from "./multi-scenario-feasibility-contract";
import type { ScenarioPlanningRequest } from "../scenarios/scenario-plan";

export const HELP_DESK_PLAN_REQUEST = {
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

export const AVD_PLAN_REQUEST = {
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

export function feasibleBatchRequest(
  many = false,
): BatchFeasibilityRequest {
  const plans: BatchFeasibilityRequest["plans"] = many
    ? [
      { instanceAlias: "email-one", planRequest: HELP_DESK_PLAN_REQUEST },
      { instanceAlias: "avd-one", planRequest: AVD_PLAN_REQUEST },
    ]
    : [
      { instanceAlias: "email-one", planRequest: HELP_DESK_PLAN_REQUEST },
    ];
  return {
    schemaVersion: 1,
    label: "SCENARIO_FEASIBILITY_COMPILE_REQUEST",
    session: {
      startsAt: "2026-07-29T06:00:00Z",
      requestedDurationMinutes: 10,
      aggregateBudgetCeilingUsd: many ? "10.00" : "0.00",
      concurrencyLimit: plans.length,
      minimumExpiryMarginMinutes: 5,
      humanGatePolicy: "allow",
    },
    plans,
  };
}
