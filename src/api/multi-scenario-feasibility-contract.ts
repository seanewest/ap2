import type { ScenarioPlanningRequest } from "../scenarios/scenario-plan";
import {
  FEASIBILITY_BLOCKERS,
  type MultiScenarioFeasibilityRequest,
  type MultiScenarioFeasibilityResult,
} from "../scenarios/multi-scenario-feasibility-contract.ts";

export const BATCH_FEASIBILITY_MAX_PLANS = 8;
export const BATCH_FEASIBILITY_MAX_REQUEST_BYTES = 65_536;
export const BATCH_FEASIBILITY_MAX_RESPONSE_BYTES = 4_096;

export interface BatchFeasibilityRequest {
  schemaVersion: 1;
  label: "SCENARIO_FEASIBILITY_COMPILE_REQUEST";
  session: MultiScenarioFeasibilityRequest["session"];
  plans: readonly Readonly<{
    instanceAlias: string;
    planRequest: ScenarioPlanningRequest;
  }>[];
}

export class BatchFeasibilityContractError extends Error {
  readonly category: "INPUT_INVALID" | "RAW_IDENTIFIER_REJECTED";

  constructor(category: "INPUT_INVALID" | "RAW_IDENTIFIER_REJECTED") {
    super("Batch feasibility request contract validation failed.");
    this.name = "BatchFeasibilityContractError";
    this.category = category;
  }
}

export function parseBatchFeasibilityEnvelope(
  value: unknown,
): BatchFeasibilityRequest {
  const request = record(value, [
    "schemaVersion",
    "label",
    "session",
    "plans",
  ]);
  if (
    request.schemaVersion !== 1 ||
    request.label !== "SCENARIO_FEASIBILITY_COMPILE_REQUEST"
  ) {
    fail();
  }
  const session = parseSession(request.session);
  if (
    !Array.isArray(request.plans) ||
    request.plans.length === 0 ||
    request.plans.length > BATCH_FEASIBILITY_MAX_PLANS
  ) {
    fail();
  }
  const plans = request.plans.map((value) => {
    const item = record(value, ["instanceAlias", "planRequest"]);
    const instanceAlias = alias(item.instanceAlias);
    if (!isRecord(item.planRequest)) fail();
    return {
      instanceAlias,
      planRequest: item.planRequest as unknown as ScenarioPlanningRequest,
    };
  });
  return {
    schemaVersion: 1,
    label: "SCENARIO_FEASIBILITY_COMPILE_REQUEST",
    session,
    plans,
  };
}

export function isBoundedBatchFeasibilityRequest(
  value: unknown,
  planRequestValidator: (value: unknown) => boolean,
): value is BatchFeasibilityRequest {
  try {
    const request = parseBatchFeasibilityEnvelope(value);
    return request.plans.every(({ planRequest }) =>
      planRequestValidator(planRequest)
    );
  } catch {
    return false;
  }
}

export function isSafeBatchFeasibilityResult(
  value: unknown,
  request: BatchFeasibilityRequest,
  authoritativeResult?: MultiScenarioFeasibilityResult,
): value is MultiScenarioFeasibilityResult {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== 10 ||
    ![
      "schemaVersion",
      "label",
      "status",
      "planCount",
      "maximumConcurrency",
      "conservativeAggregateUsdCeiling",
      "requestedSessionDurationMinutes",
      "earliestExpiryMarginMinutes",
      "humanGateCount",
      "blockers",
    ].every((key, index) => keys[index] === key) ||
    value.schemaVersion !== 1 ||
    value.label !== "FEASIBILITY_ONLY" ||
    value.planCount !== request.plans.length ||
    value.maximumConcurrency !== request.plans.length ||
    value.requestedSessionDurationMinutes !==
      request.session.requestedDurationMinutes ||
    !Number.isInteger(value.humanGateCount) ||
    Number(value.humanGateCount) < 0 ||
    Number(value.humanGateCount) > request.plans.length * 256 ||
    !Array.isArray(value.blockers) ||
    value.blockers.length > FEASIBILITY_BLOCKERS.length
  ) {
    return false;
  }
  if (
    authoritativeResult !== undefined &&
    JSON.stringify(value) !== JSON.stringify(authoritativeResult)
  ) {
    return false;
  }
  const blockers = value.blockers;
  if (
    blockers.some(
      (blocker, index) =>
        !FEASIBILITY_BLOCKERS.includes(
          blocker as (typeof FEASIBILITY_BLOCKERS)[number],
        ) ||
        FEASIBILITY_BLOCKERS.indexOf(
          blocker as (typeof FEASIBILITY_BLOCKERS)[number],
        ) <=
          (index === 0
            ? -1
            : FEASIBILITY_BLOCKERS.indexOf(
              blockers[index - 1] as (typeof FEASIBILITY_BLOCKERS)[number],
            )),
    ) ||
    blockers.some((blocker) =>
      [
        "UNKNOWN_COST_OR_DURATION",
        "INDIVIDUAL_BUDGET_OVERRUN",
        "INDIVIDUAL_EXPIRY_OVERRUN",
      ].includes(String(blocker))
    ) ||
    (value.status !== "feasible" && value.status !== "infeasible") ||
    (value.status === "feasible") !== (blockers.length === 0)
  ) {
    return false;
  }
  const aggregate = decimalCents(value.conservativeAggregateUsdCeiling);
  if (aggregate === undefined) return false;
  const ceiling = decimalCents(request.session.aggregateBudgetCeilingUsd);
  if (
    ceiling === undefined ||
    ceiling === null ||
    aggregate === null ||
    blockers.includes("AGGREGATE_BUDGET_OVERRUN") !==
      (aggregate > ceiling)
  ) {
    return false;
  }
  if (
    blockers.includes("DUPLICATE_INSTANCE") !== hasDuplicateAliases(request) ||
    blockers.includes("CONCURRENCY_OVERRUN") !==
      (request.plans.length > request.session.concurrencyLimit)
  ) {
    return false;
  }
  const expiryMargin = value.earliestExpiryMarginMinutes;
  if (
    !Number.isSafeInteger(expiryMargin) ||
    Number(expiryMargin) < -1_000_000 ||
    Number(expiryMargin) > 1_000_000 ||
    (Number(expiryMargin) < 0 &&
      !blockers.includes("SESSION_DURATION_OVERRUN")) ||
    (Number(expiryMargin) >= 0 &&
      Number(expiryMargin) < request.session.minimumExpiryMarginMinutes) !==
      blockers.includes("EXPIRY_MARGIN_INSUFFICIENT")
  ) {
    return false;
  }
  return blockers.includes("HUMAN_GATE_NOT_ALLOWED") ===
    (
      request.session.humanGatePolicy === "refuse" &&
      Number(value.humanGateCount) > 0
    );
}

function parseSession(
  value: unknown,
): MultiScenarioFeasibilityRequest["session"] {
  const session = record(value, [
    "startsAt",
    "requestedDurationMinutes",
    "aggregateBudgetCeilingUsd",
    "concurrencyLimit",
    "minimumExpiryMarginMinutes",
    "humanGatePolicy",
  ]);
  if (
    !utc(session.startsAt) ||
    !integer(session.requestedDurationMinutes, 1, 10_080) ||
    decimalCents(session.aggregateBudgetCeilingUsd) === undefined ||
    !integer(session.concurrencyLimit, 1, BATCH_FEASIBILITY_MAX_PLANS) ||
    !integer(session.minimumExpiryMarginMinutes, 0, 10_080) ||
    (session.humanGatePolicy !== "allow" &&
      session.humanGatePolicy !== "refuse")
  ) {
    fail();
  }
  return session as unknown as MultiScenarioFeasibilityRequest["session"];
}

function alias(value: unknown): string {
  if (
    typeof value === "string" &&
    (value.includes("@") ||
      value.includes("/") ||
      value.includes("\\") ||
      RAW_IDENTIFIER.test(value))
  ) {
    throw new BatchFeasibilityContractError("RAW_IDENTIFIER_REJECTED");
  }
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(value)) {
    fail();
  }
  return value;
}

function hasDuplicateAliases(request: BatchFeasibilityRequest): boolean {
  const aliases = request.plans.map(({ instanceAlias }) => instanceAlias);
  return new Set(aliases).size !== aliases.length;
}

function decimalCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,6})(?:\.\d{2})$/.test(value)
  ) {
    return undefined;
  }
  const [whole, fraction] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) && cents <= 100_000_000
    ? cents
    : undefined;
}

function utc(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return false;
  }
  return new Date(value).toISOString() ===
    (value.includes(".") ? value : value.replace(/Z$/, ".000Z"));
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  ) {
    fail();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new BatchFeasibilityContractError("INPUT_INVALID");
}

const RAW_IDENTIFIER =
  /(?:onmicrosoft|tenant|subscription|object-?id|message-?id|resource-?id|credential|certificate|token|marker|proof|session|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23})/i;
