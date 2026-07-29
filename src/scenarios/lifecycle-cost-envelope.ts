import { createHash } from "node:crypto";
import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";
import {
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "./scenario-plan";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_METERS = 64;
const MAX_USAGE_LINES = 128;
const MAX_PROVISIONING_WAVES = 16;
const MAX_PARALLEL_DURATIONS = 32;
const MAX_HOURS = 8_760;
const MAX_COUNT = 10_000;
const MAX_UNITS = 1_000_000_000;
const MAX_RATE_USD = 1_000_000;
const MAX_TOTAL_USD = 10_000_000;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const SAFE_SKU = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,95}$/;
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const REQUEST_KEYS = [
  "schemaVersion",
  "kind",
  "asOf",
  "region",
  "manifest",
  "plan",
  "rateCard",
  "learnerDurationHours",
  "provisioningWaves",
  "startupGraceHours",
  "cleanupGraceHours",
  "contingencyPercent",
  "suppliedCeilingUsd",
  "usageLines",
] as const;
const RATE_CARD_KEYS = [
  "schemaVersion",
  "kind",
  "currency",
  "region",
  "effectiveAt",
  "expiresAt",
  "meters",
] as const;
const METER_KEYS = [
  "id",
  "component",
  "category",
  "sku",
  "billingUnit",
  "rateUsdPerUnit",
  "billingIncrementUnits",
  "minimumBillableUnits",
] as const;
const WAVE_KEYS = ["id", "parallelDurationsHours"] as const;
const USAGE_KEYS = [
  "id",
  "resourceId",
  "meterId",
  "resourceCount",
  "basis",
  "unitsPerResource",
] as const;
const BILLABLE_RESOURCE_PROFILES = {
  "avd-personal-host": {
    count: 1,
    components: ["vm-compute", "os-disk", "disk-operations"],
  },
  "linux-auxiliary-pair": {
    count: 2,
    components: ["vm-compute", "os-disk", "disk-operations"],
  },
  "shared-nat-egress": {
    count: 1,
    components: [
      "nat-gateway",
      "public-ip",
      "nat-data",
      "internet-egress",
    ],
  },
} as const;
const METER_COMPONENTS = {
  "vm-compute": {
    category: "compute",
    billingUnit: "resource-hour",
  },
  "os-disk": {
    category: "disk-capacity",
    billingUnit: "resource-hour",
  },
  "disk-operations": {
    category: "disk-operations",
    billingUnit: "operation",
  },
  "nat-gateway": {
    category: "shared-service",
    billingUnit: "resource-hour",
  },
  "public-ip": {
    category: "shared-service",
    billingUnit: "resource-hour",
  },
  "nat-data": {
    category: "network",
    billingUnit: "gb",
  },
  "internet-egress": {
    category: "network",
    billingUnit: "gb",
  },
} as const;

export type LifecycleCostEnvelopeFailure =
  | "COST_OVERFLOW"
  | "COVERAGE_INCOMPLETE"
  | "EXPIRY_INVALID"
  | "INPUT_INVALID"
  | "MANIFEST_INVALID"
  | "PLAN_BINDING"
  | "RATE_CARD_INVALID"
  | "RATE_CARD_STALE";

export class LifecycleCostEnvelopeError extends Error {
  readonly category: LifecycleCostEnvelopeFailure;

  constructor(category: LifecycleCostEnvelopeFailure) {
    super(category);
    this.name = "LifecycleCostEnvelopeError";
    this.category = category;
  }
}

export interface LifecycleRateMeter {
  id: string;
  component: keyof typeof METER_COMPONENTS;
  category:
    | "compute"
    | "disk-capacity"
    | "disk-operations"
    | "network"
    | "shared-service";
  sku: string;
  billingUnit: "resource-hour" | "gb" | "operation";
  rateUsdPerUnit: number;
  billingIncrementUnits: number;
  minimumBillableUnits: number;
}

export interface LifecycleRateCard {
  schemaVersion: 1;
  kind: "supplied-lifecycle-rate-card";
  currency: "USD";
  region: string;
  effectiveAt: string;
  expiresAt: string;
  meters: readonly LifecycleRateMeter[];
}

export interface LifecycleCostUsageLine {
  id: string;
  resourceId: string;
  meterId: string;
  resourceCount: number;
  basis: "lifecycle-hours" | "fixed-units";
  unitsPerResource?: number;
}

export interface LifecycleCostEnvelopeRequest {
  schemaVersion: 1;
  kind: "lifecycle-cost-envelope-request";
  asOf: string;
  region: string;
  manifest: unknown;
  plan: unknown;
  rateCard: unknown;
  learnerDurationHours: number;
  provisioningWaves: readonly {
    id: string;
    parallelDurationsHours: readonly number[];
  }[];
  startupGraceHours: number;
  cleanupGraceHours: number;
  contingencyPercent: number;
  suppliedCeilingUsd: number;
  usageLines: readonly LifecycleCostUsageLine[];
}

export interface LifecycleCostEnvelope {
  schemaVersion: 1;
  label: "FORECAST_ONLY";
  status: "fits-ceiling" | "exceeds-ceiling";
  scenarioId: string;
  region: string;
  currency: "USD";
  asOf: string;
  planDigestSha256: string;
  rateCardDigestSha256: string;
  usageProfileDigestSha256: string;
  timing: Readonly<{
    learnerHours: number;
    provisioningWaveHours: readonly number[];
    totalProvisioningHours: number;
    startupGraceHours: number;
    cleanupGraceHours: number;
    conservativeLifecycleHours: number;
    planWindowHours: number;
  }>;
  cost: Readonly<{
    baseForecastUsd: number;
    contingencyPercent: number;
    contingencyUsd: number;
    conservativeForecastUsd: number;
    suppliedCeilingUsd: number;
  }>;
  classifications: Readonly<{
    forecast: "supplied-rate-conservative-bound";
    ceiling: "caller-supplied-limit";
    observedBill: "not-observed";
  }>;
  lines: readonly Readonly<{
    resourceKind: ScenarioManifest["resources"][number]["kind"];
    component: LifecycleRateMeter["component"];
    category: LifecycleRateMeter["category"];
    sku: string;
    billingUnit: LifecycleRateMeter["billingUnit"];
    resourceCount: number;
    rawUnitsPerResource: number;
    billableUnitsPerResource: number;
    extendedUsd: number;
  }>[];
}

interface ParsedRequest {
  asOf: string;
  region: string;
  manifest: ScenarioManifest;
  plan: ScenarioExecutionPlan;
  rateCard: LifecycleRateCard;
  learnerDurationHours: number;
  provisioningWaves: readonly {
    id: string;
    parallelDurationsHours: readonly number[];
  }[];
  startupGraceHours: number;
  cleanupGraceHours: number;
  contingencyPercent: number;
  suppliedCeilingUsd: number;
  usageLines: readonly LifecycleCostUsageLine[];
}

export function compileLifecycleCostEnvelope(
  value: unknown,
): LifecycleCostEnvelope {
  const input = parseRequest(value);
  validateRateWindow(input);
  validatePlanAndCoverage(input);

  const provisioningWaveHours = input.provisioningWaves.map(
    ({ parallelDurationsHours }) => Math.max(...parallelDurationsHours),
  );
  const totalProvisioningHours = finiteSum(provisioningWaveHours);
  const conservativeLifecycleHours = finiteSum([
    input.learnerDurationHours,
    totalProvisioningHours,
    input.startupGraceHours,
    input.cleanupGraceHours,
  ]);
  const planWindowHours =
    (Date.parse(input.plan.expiresAt) - Date.parse(input.plan.generatedAt)) /
    3_600_000;
  if (
    conservativeLifecycleHours <= 0 ||
    conservativeLifecycleHours > planWindowHours
  ) {
    fail("EXPIRY_INVALID");
  }

  const meterById = new Map(
    input.rateCard.meters.map((meter) => [meter.id, meter]),
  );
  const resourceById = new Map(
    input.manifest.resources.map((resource) => [resource.id, resource]),
  );
  const lines = input.usageLines.map((usage) => {
    const meter = meterById.get(usage.meterId);
    if (!meter) fail("RATE_CARD_INVALID");
    const resource = resourceById.get(usage.resourceId);
    if (!resource) fail("COVERAGE_INCOMPLETE");
    const rawUnitsPerResource = usageUnits(
      usage,
      meter,
      conservativeLifecycleHours,
    );
    const billableUnitsPerResource = Math.max(
      meter.minimumBillableUnits,
      Math.ceil(rawUnitsPerResource / meter.billingIncrementUnits) *
        meter.billingIncrementUnits,
    );
    const extendedUsd = checkedMoney(
      billableUnitsPerResource *
        usage.resourceCount *
        meter.rateUsdPerUnit,
    );
    return {
      resourceKind: resource.kind,
      component: meter.component,
      category: meter.category,
      sku: meter.sku,
      billingUnit: meter.billingUnit,
      resourceCount: usage.resourceCount,
      rawUnitsPerResource: round(rawUnitsPerResource),
      billableUnitsPerResource: round(billableUnitsPerResource),
      extendedUsd,
    };
  });
  const baseForecastUsd = checkedMoney(
    lines.reduce((sum, line) => sum + line.extendedUsd, 0),
  );
  const conservativeForecastUsd = checkedMoney(
    baseForecastUsd * (1 + input.contingencyPercent / 100),
  );
  const contingencyUsd = round(
    conservativeForecastUsd - baseForecastUsd,
  );
  const rateCardDigestSha256 = digest(input.rateCard);
  const usageProfileDigestSha256 = digest({
    learnerDurationHours: input.learnerDurationHours,
    provisioningWaves: input.provisioningWaves,
    startupGraceHours: input.startupGraceHours,
    cleanupGraceHours: input.cleanupGraceHours,
    contingencyPercent: input.contingencyPercent,
    usageLines: input.usageLines,
  });

  return deepFreeze({
    schemaVersion: 1,
    label: "FORECAST_ONLY",
    status: conservativeForecastUsd <= input.suppliedCeilingUsd
      ? "fits-ceiling"
      : "exceeds-ceiling",
    scenarioId: input.manifest.id,
    region: input.region,
    currency: "USD",
    asOf: input.asOf,
    planDigestSha256: input.plan.digestSha256,
    rateCardDigestSha256,
    usageProfileDigestSha256,
    timing: {
      learnerHours: input.learnerDurationHours,
      provisioningWaveHours: provisioningWaveHours.map(round),
      totalProvisioningHours: round(totalProvisioningHours),
      startupGraceHours: input.startupGraceHours,
      cleanupGraceHours: input.cleanupGraceHours,
      conservativeLifecycleHours: round(conservativeLifecycleHours),
      planWindowHours: round(planWindowHours),
    },
    cost: {
      baseForecastUsd,
      contingencyPercent: input.contingencyPercent,
      contingencyUsd,
      conservativeForecastUsd,
      suppliedCeilingUsd: input.suppliedCeilingUsd,
    },
    classifications: {
      forecast: "supplied-rate-conservative-bound",
      ceiling: "caller-supplied-limit",
      observedBill: "not-observed",
    },
    lines,
  });
}

function parseRequest(value: unknown): ParsedRequest {
  assertBounded(value);
  const request = exactRecord(value, REQUEST_KEYS, "INPUT_INVALID");
  if (
    request.schemaVersion !== 1 ||
    request.kind !== "lifecycle-cost-envelope-request"
  ) {
    fail("INPUT_INVALID");
  }
  const asOf = timestamp(request.asOf, "INPUT_INVALID");
  const region = safeId(request.region, "INPUT_INVALID");
  let manifest: ScenarioManifest;
  try {
    manifest = parseScenarioManifest(request.manifest);
  } catch {
    fail("MANIFEST_INVALID");
  }
  if (canonicalJson(manifest) !== canonicalJson(request.manifest)) {
    fail("MANIFEST_INVALID");
  }
  const plan = boundPlan(request.plan, manifest);
  const rateCard = parseRateCard(request.rateCard);
  const learnerDurationHours = number(
    request.learnerDurationHours,
    0,
    MAX_HOURS,
    "INPUT_INVALID",
  );
  const startupGraceHours = number(
    request.startupGraceHours,
    0,
    MAX_HOURS,
    "INPUT_INVALID",
  );
  const cleanupGraceHours = number(
    request.cleanupGraceHours,
    0,
    MAX_HOURS,
    "INPUT_INVALID",
  );
  const contingencyPercent = number(
    request.contingencyPercent,
    0,
    100,
    "INPUT_INVALID",
  );
  const suppliedCeilingUsd = number(
    request.suppliedCeilingUsd,
    0,
    MAX_TOTAL_USD,
    "INPUT_INVALID",
  );
  if (
    suppliedCeilingUsd !== plan.budget.suppliedCeiling ||
    suppliedCeilingUsd < plan.budget.plannedMaximum
  ) {
    fail("PLAN_BINDING");
  }
  const provisioningValues = boundedArray(
    request.provisioningWaves,
    1,
    MAX_PROVISIONING_WAVES,
    "INPUT_INVALID",
  );
  const provisioningWaves = provisioningValues.map((value) => {
    const wave = exactRecord(value, WAVE_KEYS, "INPUT_INVALID");
    return {
      id: safeId(wave.id, "INPUT_INVALID"),
      parallelDurationsHours: boundedArray(
        wave.parallelDurationsHours,
        1,
        MAX_PARALLEL_DURATIONS,
        "INPUT_INVALID",
      ).map((duration) =>
        number(duration, Number.MIN_VALUE, MAX_HOURS, "INPUT_INVALID")
      ),
    };
  });
  unique(provisioningWaves.map(({ id }) => id), "INPUT_INVALID");

  const usageValues = boundedArray(
    request.usageLines,
    1,
    MAX_USAGE_LINES,
    "INPUT_INVALID",
  );
  const usageLines = usageValues.map(parseUsageLine);
  unique(usageLines.map(({ id }) => id), "INPUT_INVALID");

  return {
    asOf,
    region,
    manifest,
    plan,
    rateCard,
    learnerDurationHours,
    provisioningWaves,
    startupGraceHours,
    cleanupGraceHours,
    contingencyPercent,
    suppliedCeilingUsd,
    usageLines,
  };
}

function parseRateCard(value: unknown): LifecycleRateCard {
  const card = exactRecord(value, RATE_CARD_KEYS, "RATE_CARD_INVALID");
  if (
    card.schemaVersion !== 1 ||
    card.kind !== "supplied-lifecycle-rate-card" ||
    card.currency !== "USD"
  ) {
    fail("RATE_CARD_INVALID");
  }
  const meters = boundedArray(
    card.meters,
    1,
    MAX_METERS,
    "RATE_CARD_INVALID",
  ).map((value) => {
    const meter = exactRecord(value, METER_KEYS, "RATE_CARD_INVALID");
    if (
      typeof meter.component !== "string" ||
      !(meter.component in METER_COMPONENTS)
    ) {
      fail("RATE_CARD_INVALID");
    }
    const component = meter.component as keyof typeof METER_COMPONENTS;
    const componentContract = METER_COMPONENTS[component];
    if (
      meter.category !== componentContract.category ||
      meter.billingUnit !== componentContract.billingUnit
    ) fail("RATE_CARD_INVALID");
    if (typeof meter.sku !== "string" || !SAFE_SKU.test(meter.sku)) {
      fail("RATE_CARD_INVALID");
    }
    return {
      id: safeId(meter.id, "RATE_CARD_INVALID"),
      component,
      category: componentContract.category,
      sku: meter.sku,
      billingUnit: componentContract.billingUnit,
      rateUsdPerUnit: number(
        meter.rateUsdPerUnit,
        0,
        MAX_RATE_USD,
        "RATE_CARD_INVALID",
      ),
      billingIncrementUnits: number(
        meter.billingIncrementUnits,
        Number.MIN_VALUE,
        MAX_UNITS,
        "RATE_CARD_INVALID",
      ),
      minimumBillableUnits: number(
        meter.minimumBillableUnits,
        0,
        MAX_UNITS,
        "RATE_CARD_INVALID",
      ),
    } satisfies LifecycleRateMeter;
  });
  unique(meters.map(({ id }) => id), "RATE_CARD_INVALID");
  return {
    schemaVersion: 1,
    kind: "supplied-lifecycle-rate-card",
    currency: "USD",
    region: safeId(card.region, "RATE_CARD_INVALID"),
    effectiveAt: timestamp(card.effectiveAt, "RATE_CARD_INVALID"),
    expiresAt: timestamp(card.expiresAt, "RATE_CARD_INVALID"),
    meters,
  };
}

function parseUsageLine(value: unknown): LifecycleCostUsageLine {
  const usage = recordWithOptional(
    value,
    USAGE_KEYS.filter((key) => key !== "unitsPerResource"),
    ["unitsPerResource"],
    "INPUT_INVALID",
  );
  if (
    usage.basis !== "lifecycle-hours" &&
    usage.basis !== "fixed-units"
  ) {
    fail("INPUT_INVALID");
  }
  const unitsPerResource = usage.unitsPerResource === undefined
    ? undefined
    : number(
      usage.unitsPerResource,
      0,
      MAX_UNITS,
      "INPUT_INVALID",
    );
  if (
    (usage.basis === "fixed-units" && unitsPerResource === undefined) ||
    (usage.basis !== "fixed-units" && unitsPerResource !== undefined)
  ) {
    fail("INPUT_INVALID");
  }
  return {
    id: safeId(usage.id, "INPUT_INVALID"),
    resourceId: safeId(usage.resourceId, "INPUT_INVALID"),
    meterId: safeId(usage.meterId, "INPUT_INVALID"),
    resourceCount: integer(
      usage.resourceCount,
      1,
      MAX_COUNT,
      "INPUT_INVALID",
    ),
    basis: usage.basis,
    ...(unitsPerResource === undefined ? {} : { unitsPerResource }),
  };
}

function boundPlan(
  value: unknown,
  manifest: ScenarioManifest,
): ScenarioExecutionPlan {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("PLAN_BINDING");
  }
  const plan = value as Partial<ScenarioExecutionPlan>;
  if (
    typeof plan.scenarioId !== "string" ||
    plan.actorAliases === undefined ||
    typeof plan.generatedAt !== "string" ||
    typeof plan.expiresAt !== "string" ||
    typeof plan.budget?.suppliedCeiling !== "number" ||
    plan.selectedResponseId !== null &&
    typeof plan.selectedResponseId !== "string"
  ) {
    fail("PLAN_BINDING");
  }
  let baseline: ScenarioExecutionPlan;
  try {
    baseline = compileScenarioExecutionPlan(
      {
        scenarioId: plan.scenarioId,
        actorAliases: plan.actorAliases,
        now: plan.generatedAt,
        expiresAt: plan.expiresAt,
        maximumBudgetUsd: plan.budget?.suppliedCeiling,
        ...(plan.selectedResponseId === null
          ? {}
          : { selectedResponseId: plan.selectedResponseId }),
      } satisfies ScenarioPlanningRequest,
      [manifest],
    );
  } catch {
    fail("PLAN_BINDING");
  }
  if (canonicalJson(value) !== canonicalJson(baseline)) {
    fail("PLAN_BINDING");
  }
  return baseline;
}

function validateRateWindow(input: ParsedRequest): void {
  if (input.region !== input.rateCard.region) fail("RATE_CARD_INVALID");
  const effective = Date.parse(input.rateCard.effectiveAt);
  const rateExpiry = Date.parse(input.rateCard.expiresAt);
  const asOf = Date.parse(input.asOf);
  if (
    input.asOf !== input.plan.generatedAt ||
    effective > asOf ||
    rateExpiry < Date.parse(input.plan.expiresAt) ||
    rateExpiry <= effective
  ) {
    fail("RATE_CARD_STALE");
  }
}

function validatePlanAndCoverage(input: ParsedRequest): void {
  const billable = input.manifest.resources.filter(({ billable }) => billable);
  if (billable.length === 0) fail("COVERAGE_INCOMPLETE");
  const billableIds = new Set(billable.map(({ id }) => id));
  const meterById = new Map(
    input.rateCard.meters.map((meter) => [meter.id, meter]),
  );
  if (
    input.usageLines.some(({ resourceId }) => !billableIds.has(resourceId)) ||
    [...billableIds].some((resourceId) =>
      !input.usageLines.some((line) => line.resourceId === resourceId)
    )
  ) {
    fail("COVERAGE_INCOMPLETE");
  }
  const referencedMeterIds = new Set(
    input.usageLines.map(({ meterId }) => meterId),
  );
  if (
    input.rateCard.meters.some(({ id }) => !referencedMeterIds.has(id))
  ) {
    fail("COVERAGE_INCOMPLETE");
  }
  for (const resource of billable) {
    const profile = BILLABLE_RESOURCE_PROFILES[
      resource.kind as keyof typeof BILLABLE_RESOURCE_PROFILES
    ];
    if (!profile) fail("COVERAGE_INCOMPLETE");
    const lines = input.usageLines.filter(
      ({ resourceId }) => resourceId === resource.id,
    );
    if (lines.some(({ resourceCount }) => resourceCount !== profile.count)) {
      fail("COVERAGE_INCOMPLETE");
    }
    const components = new Set(
      lines.map(({ meterId }) => {
        const meter = meterById.get(meterId);
        if (!meter) fail("RATE_CARD_INVALID");
        return meter.component;
      }),
    );
    if (
      components.size !== profile.components.length ||
      profile.components.some((component) => !components.has(component))
    ) {
      fail("COVERAGE_INCOMPLETE");
    }
  }
  const expiryIndex = input.plan.steps.findIndex(
    ({ operationCategory, execution }) =>
      operationCategory === "expiry.schedule" &&
      execution === "automated",
  );
  if (expiryIndex < 0) fail("EXPIRY_INVALID");
  for (const resource of billable) {
    const createIndex = input.plan.steps.findIndex(
      ({ operationKey, execution }) =>
        operationKey === resource.createOperationKey &&
        execution === "automated",
    );
    if (createIndex <= expiryIndex) fail("EXPIRY_INVALID");
  }
}

function usageUnits(
  usage: LifecycleCostUsageLine,
  meter: LifecycleRateMeter,
  lifecycleHours: number,
): number {
  if (usage.basis === "lifecycle-hours") {
    if (meter.billingUnit !== "resource-hour") fail("RATE_CARD_INVALID");
    return lifecycleHours;
  }
  if (meter.billingUnit === "resource-hour") fail("RATE_CARD_INVALID");
  return usage.unitsPerResource!;
}

function checkedMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_TOTAL_USD) {
    fail("COST_OVERFLOW");
  }
  return Math.ceil(value * 1e8) / 1e8;
}

function finiteSum(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total > MAX_HOURS) {
    fail("COST_OVERFLOW");
  }
  return total;
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) =>
        `${JSON.stringify(key)}:${canonicalJson(child)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  category: LifecycleCostEnvelopeFailure,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(category);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(category);
  return value as Record<string, unknown>;
}

function recordWithOptional(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  category: LifecycleCostEnvelopeFailure,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(category);
  }
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !actual.includes(key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    fail(category);
  }
  return value as Record<string, unknown>;
}

function boundedArray(
  value: unknown,
  minimum: number,
  maximum: number,
  category: LifecycleCostEnvelopeFailure,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    fail(category);
  }
  return value;
}

function safeId(
  value: unknown,
  category: LifecycleCostEnvelopeFailure,
): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(category);
  return value;
}

function timestamp(
  value: unknown,
  category: LifecycleCostEnvelopeFailure,
): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  const canonical = Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : "";
  const normalizedInput = typeof value === "string" &&
      !value.includes(".")
    ? value.replace(/Z$/, ".000Z")
    : value;
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP.test(value) ||
    !Number.isFinite(parsed) ||
    normalizedInput !== canonical
  ) {
    fail(category);
  }
  return value;
}

function number(
  value: unknown,
  minimum: number,
  maximum: number,
  category: LifecycleCostEnvelopeFailure,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(category);
  }
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  category: LifecycleCostEnvelopeFailure,
): number {
  const result = number(value, minimum, maximum, category);
  if (!Number.isInteger(result)) fail(category);
  return result;
}

function unique(
  values: readonly string[],
  category: LifecycleCostEnvelopeFailure,
): void {
  if (new Set(values).size !== values.length) fail(category);
}

function assertBounded(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("INPUT_INVALID");
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES
  ) {
    fail("INPUT_INVALID");
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(category: LifecycleCostEnvelopeFailure): never {
  throw new LifecycleCostEnvelopeError(category);
}
