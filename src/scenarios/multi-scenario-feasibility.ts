import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "./scenario-plan";
import { parseScenarioManifest } from "./scenario-manifest";
import { SCENARIO_MANIFESTS } from "./scenarios";

const REQUEST_KEYS = ["schemaVersion", "label", "session", "plans"] as const;
const SESSION_KEYS = [
  "startsAt",
  "requestedDurationMinutes",
  "aggregateBudgetCeilingUsd",
  "concurrencyLimit",
  "minimumExpiryMarginMinutes",
  "humanGatePolicy",
] as const;
const ITEM_KEYS = ["instanceAlias", "plan"] as const;
const MAX_PLANS = 16;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_DURATION_MINUTES = 7 * 24 * 60;
const MAX_BUDGET_CENTS = 100_000_000;
const SAFE_ALIAS = /^[a-z][a-z0-9-]{1,31}$/;
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DECIMAL_USD = /^(?:0|[1-9]\d{0,6})(?:\.(\d{1,2}))?$/;
const RAW_IDENTIFIER =
  /(?:@|\/|\\|onmicrosoft|tenant|subscription|object-?id|message-?id|credential|certificate|token|session|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23})/i;
const STRONG_RAW_IDENTIFIER =
  /(?:@|\/|\\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23}|-----BEGIN|eyJ[A-Za-z0-9_-]{20,})/i;

const BLOCKER_ORDER = [
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

export type FeasibilityBlocker = typeof BLOCKER_ORDER[number];

export type FeasibilityInputFailure =
  | "INPUT_INVALID"
  | "INPUT_OVERSIZED"
  | "PLAN_INVALID"
  | "RAW_IDENTIFIER_REJECTED";

export class MultiScenarioFeasibilityInputError extends Error {
  readonly category: FeasibilityInputFailure;

  constructor(category: FeasibilityInputFailure) {
    super(category);
    this.name = "MultiScenarioFeasibilityInputError";
    this.category = category;
  }
}

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

interface ParsedSession {
  startsAt: string;
  startsAtMs: number;
  requestedDurationMinutes: number;
  aggregateBudgetCeilingCents: number;
  concurrencyLimit: number;
  minimumExpiryMarginMinutes: number;
  humanGatePolicy: "allow" | "refuse";
}

interface PlanAssessment {
  baseline: ScenarioExecutionPlan;
  plannedMaximumCents: number | null;
  generatedAtMs: number | null;
  expiresAtMs: number | null;
  blockers: readonly FeasibilityBlocker[];
}

export function planMultiScenarioFeasibility(
  value: unknown,
): MultiScenarioFeasibilityResult {
  assertBounded(value);
  const request = record(value, REQUEST_KEYS);
  if (
    request.schemaVersion !== 1 ||
    request.label !== "SCENARIO_FEASIBILITY_REQUEST"
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  const session = parseSession(request.session);
  if (
    !Array.isArray(request.plans) ||
    request.plans.length === 0 ||
    request.plans.length > MAX_PLANS
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }

  const aliases = new Set<string>();
  const blockers = new Set<FeasibilityBlocker>();
  const assessments: PlanAssessment[] = [];
  let humanGateCount = 0;
  for (const itemValue of request.plans) {
    const item = record(itemValue, ITEM_KEYS);
    const instanceAlias = safeAlias(item.instanceAlias);
    if (aliases.has(instanceAlias)) blockers.add("DUPLICATE_INSTANCE");
    aliases.add(instanceAlias);
    const assessment = assessPlan(item.plan);
    assessment.blockers.forEach((blocker) => blockers.add(blocker));
    assessments.push(assessment);
    humanGateCount += assessment.baseline.steps.filter(
      ({ humanOnlyGate }) => humanOnlyGate,
    ).length;
  }

  const knownCosts = assessments.map(({ plannedMaximumCents }) =>
    plannedMaximumCents
  );
  const aggregateCents = knownCosts.some((cost) => cost === null)
    ? null
    : knownCosts.reduce<number>(
      (sum, cost) => sum + (cost as number),
      0,
    );
  if (
    aggregateCents !== null &&
    aggregateCents > session.aggregateBudgetCeilingCents
  ) {
    blockers.add("AGGREGATE_BUDGET_OVERRUN");
  }
  if (request.plans.length > session.concurrencyLimit) {
    blockers.add("CONCURRENCY_OVERRUN");
  }

  const sessionEndMs = session.startsAtMs +
    session.requestedDurationMinutes * 60_000;
  const knownExpiries = assessments.map(({ expiresAtMs }) => expiresAtMs);
  let earliestExpiryMarginMinutes: number | null = null;
  if (knownExpiries.every((expiry): expiry is number => expiry !== null)) {
    earliestExpiryMarginMinutes = Math.floor(
      Math.min(...knownExpiries.map((expiry) => expiry - sessionEndMs)) /
        60_000,
    );
    if (earliestExpiryMarginMinutes < 0) {
      blockers.add("SESSION_DURATION_OVERRUN");
    } else if (
      earliestExpiryMarginMinutes < session.minimumExpiryMarginMinutes
    ) {
      blockers.add("EXPIRY_MARGIN_INSUFFICIENT");
    }
    if (
      assessments.some(({ generatedAtMs }) =>
        generatedAtMs !== null &&
        session.startsAtMs < generatedAtMs
      )
    ) {
      blockers.add("SESSION_DURATION_OVERRUN");
    }
  }
  if (session.humanGatePolicy === "refuse" && humanGateCount > 0) {
    blockers.add("HUMAN_GATE_NOT_ALLOWED");
  }

  const orderedBlockers = BLOCKER_ORDER.filter((blocker) =>
    blockers.has(blocker)
  );
  return {
    schemaVersion: 1,
    label: "FEASIBILITY_ONLY",
    status: orderedBlockers.length === 0 ? "feasible" : "infeasible",
    planCount: request.plans.length,
    maximumConcurrency: request.plans.length,
    conservativeAggregateUsdCeiling: aggregateCents === null
      ? null
      : formatUsd(aggregateCents),
    requestedSessionDurationMinutes:
      session.requestedDurationMinutes,
    earliestExpiryMarginMinutes,
    humanGateCount,
    blockers: orderedBlockers,
  };
}

function parseSession(value: unknown): ParsedSession {
  const session = record(value, SESSION_KEYS);
  const startsAt = timestamp(session.startsAt);
  const requestedDurationMinutes = boundedInteger(
    session.requestedDurationMinutes,
    1,
    MAX_DURATION_MINUTES,
  );
  const aggregateBudgetCeilingCents = decimalCents(
    session.aggregateBudgetCeilingUsd,
  );
  if (
    aggregateBudgetCeilingCents === null ||
    aggregateBudgetCeilingCents > MAX_BUDGET_CENTS
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  const concurrencyLimit = boundedInteger(
    session.concurrencyLimit,
    1,
    MAX_PLANS,
  );
  const minimumExpiryMarginMinutes = boundedInteger(
    session.minimumExpiryMarginMinutes,
    0,
    MAX_DURATION_MINUTES,
  );
  if (
    session.humanGatePolicy !== "allow" &&
    session.humanGatePolicy !== "refuse"
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  return {
    startsAt,
    startsAtMs: Date.parse(startsAt),
    requestedDurationMinutes,
    aggregateBudgetCeilingCents,
    concurrencyLimit,
    minimumExpiryMarginMinutes,
    humanGatePolicy: session.humanGatePolicy,
  };
}

function assessPlan(value: unknown): PlanAssessment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  rejectUnsafePlanStrings(candidate);
  const baseline = compileBaseline(candidate);
  if (!sameShape(candidate, baseline)) {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  const budget = candidate.budget as Record<string, unknown>;
  const plannedMaximumCents = decimalCents(budget.plannedMaximum);
  const suppliedCeilingCents = decimalCents(budget.suppliedCeiling);
  const canonicalPlannedMaximumCents = decimalCents(
    baseline.budget.plannedMaximum,
  );
  if (
    plannedMaximumCents !== null &&
    plannedMaximumCents !== canonicalPlannedMaximumCents
  ) {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  const generatedAtMs = parsedTimestamp(candidate.generatedAt);
  const expiresAtMs = parsedTimestamp(candidate.expiresAt);
  const blockers = new Set<FeasibilityBlocker>();
  if (
    plannedMaximumCents === null ||
    suppliedCeilingCents === null ||
    generatedAtMs === null ||
    expiresAtMs === null
  ) {
    blockers.add("UNKNOWN_COST_OR_DURATION");
  }
  if (
    plannedMaximumCents !== null &&
    suppliedCeilingCents !== null &&
    plannedMaximumCents > suppliedCeilingCents
  ) {
    blockers.add("INDIVIDUAL_BUDGET_OVERRUN");
  }
  if (
    generatedAtMs !== null &&
    expiresAtMs !== null &&
    (
      expiresAtMs <= generatedAtMs ||
      expiresAtMs > Date.parse(baseline.expiresAt) ||
      expiresAtMs - generatedAtMs >
        Date.parse(baseline.expiresAt) - Date.parse(baseline.generatedAt)
    )
  ) {
    blockers.add("INDIVIDUAL_EXPIRY_OVERRUN");
  }
  if (!canonicalEqual(planCore(candidate), planCore(baseline))) {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  if (blockers.size === 0) {
    const canonical = recompileCandidate(candidate);
    if (!canonicalEqual(candidate, canonical)) {
      throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
    }
  }
  return {
    baseline,
    plannedMaximumCents,
    generatedAtMs,
    expiresAtMs,
    blockers: BLOCKER_ORDER.filter((blocker) => blockers.has(blocker)),
  };
}

function compileBaseline(
  candidate: Record<string, unknown>,
): ScenarioExecutionPlan {
  const scenarioId = candidate.scenarioId;
  if (typeof scenarioId !== "string") {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  const manifestValue = SCENARIO_MANIFESTS.find(
    (manifest) => manifest.id === scenarioId,
  );
  if (!manifestValue) {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  const manifest = parseScenarioManifest(manifestValue);
  const expiryMs = Date.parse(manifest.lifecycle.expiresAt);
  const durationMs = manifest.cost.conservativeDurationHours * 3_600_000;
  return compilePlan({
    scenarioId,
    actorAliases: candidate.actorAliases as
      ScenarioPlanningRequest["actorAliases"],
    now: new Date(expiryMs - durationMs).toISOString(),
    expiresAt: manifest.lifecycle.expiresAt,
    maximumBudgetUsd: manifest.cost.laneMaximum,
    ...selectedResponse(candidate.selectedResponseId),
  });
}

function recompileCandidate(
  candidate: Record<string, unknown>,
): ScenarioExecutionPlan {
  const budget = candidate.budget as Record<string, unknown>;
  return compilePlan({
    scenarioId: candidate.scenarioId as string,
    actorAliases: candidate.actorAliases as
      ScenarioPlanningRequest["actorAliases"],
    now: candidate.generatedAt as string,
    expiresAt: candidate.expiresAt as string,
    maximumBudgetUsd: budget.suppliedCeiling as number,
    ...selectedResponse(candidate.selectedResponseId),
  });
}

function compilePlan(request: ScenarioPlanningRequest): ScenarioExecutionPlan {
  try {
    return compileScenarioExecutionPlan(request);
  } catch (error) {
    if (
      error instanceof ScenarioPlanError &&
      error.category === "RAW_IDENTIFIER_REJECTED"
    ) {
      throw new MultiScenarioFeasibilityInputError(
        "RAW_IDENTIFIER_REJECTED",
      );
    }
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
}

function selectedResponse(
  value: unknown,
): Pick<ScenarioPlanningRequest, "selectedResponseId"> | object {
  if (value === null) return {};
  if (typeof value !== "string") {
    throw new MultiScenarioFeasibilityInputError("PLAN_INVALID");
  }
  return { selectedResponseId: value };
}

function sameShape(value: unknown, baseline: unknown): boolean {
  if (Array.isArray(baseline)) {
    return Array.isArray(value) &&
      value.length === baseline.length &&
      value.every((item, index) => sameShape(item, baseline[index]));
  }
  if (baseline !== null && typeof baseline === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const valueKeys = Object.keys(value).sort();
    const baselineKeys = Object.keys(baseline).sort();
    return JSON.stringify(valueKeys) === JSON.stringify(baselineKeys) &&
      baselineKeys.every((key) =>
        sameShape(
          (value as Record<string, unknown>)[key],
          (baseline as Record<string, unknown>)[key],
        )
      );
  }
  return value === null ||
    ["string", "number", "boolean"].includes(typeof value);
}

function planCore(value: object): Record<string, unknown> {
  const core = structuredClone(value) as Record<string, unknown>;
  delete core.generatedAt;
  delete core.expiresAt;
  delete core.digestSha256;
  const budget = core.budget as Record<string, unknown>;
  delete budget.plannedMaximum;
  delete budget.suppliedCeiling;
  return core;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function rejectUnsafePlanStrings(value: unknown): void {
  if (typeof value === "string") {
    if (
      RAW_IDENTIFIER.test(value) ||
      STRONG_RAW_IDENTIFIER.test(value)
    ) {
      throw new MultiScenarioFeasibilityInputError(
        "RAW_IDENTIFIER_REJECTED",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectUnsafePlanStrings);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(rejectUnsafePlanStrings);
  }
}

function assertBounded(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  if (serialized === undefined) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) {
    throw new MultiScenarioFeasibilityInputError("INPUT_OVERSIZED");
  }
}

function record(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== expectedKeys.length ||
    !Object.keys(value).every((key) => expectedKeys.includes(key))
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  return value as Record<string, unknown>;
}

function safeAlias(value: unknown): string {
  if (
    typeof value === "string" &&
    RAW_IDENTIFIER.test(value)
  ) {
    throw new MultiScenarioFeasibilityInputError(
      "RAW_IDENTIFIER_REJECTED",
    );
  }
  if (typeof value !== "string" || !SAFE_ALIAS.test(value)) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  const canonical = value.includes(".")
    ? value
    : value.replace(/Z$/, ".000Z");
  if (new Date(value).toISOString() !== canonical) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  return value;
}

function parsedTimestamp(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  const canonical = value.includes(".")
    ? value
    : value.replace(/Z$/, ".000Z");
  if (new Date(value).toISOString() !== canonical) return null;
  return Date.parse(value);
}

function decimalCents(value: unknown): number | null {
  const text = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
    ? value
    : "";
  const match = DECIMAL_USD.exec(text);
  if (!match) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 +
    Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function formatUsd(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new MultiScenarioFeasibilityInputError("INPUT_INVALID");
  }
  return value;
}
