import {
  InMemoryOperationTelemetryCollector,
  OPERATION_TELEMETRY_MAX_EVENTS,
  type OperationTelemetrySnapshot,
} from "../../api/operation-telemetry-collector.ts";
import {
  MAX_OPERATION_EVENTS_PER_RUN,
  OPERATION_KINDS,
  type OperationKind,
  type OperationReasonCategory,
  type OperationTelemetryEvent,
} from "../../api/operation-telemetry.ts";
import type {
  ClaimCategory,
  EvidenceReceiptClaim,
  ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import { findScenarioRoleConflation } from "./scenario-manifest.ts";

const CONTRACT_ROLES = [
  "evidenceProducer",
  "workloadActor",
  "learner",
  "detector",
  "responder",
] as const;
const OBSERVER_ROLES = [
  "evidenceProducer",
  "workloadActor",
  "learner",
  "detector",
  "responder",
] as const;
const BASE_PHASE_BY_OPERATION = {
  "calendar.create": "execution",
  "calendar.cancel": "cleanup",
} as const;
const MISSING_RECEIPT_COVERAGE = [
  "artifact",
  "independent-observation",
  "learner-visibility",
  "learner-interpretation",
  "response",
  "cleanup",
  "retention",
  "terminal-proof",
] as const satisfies readonly ClaimCategory[];
const SAFE_ALIAS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdapterRole = typeof OBSERVER_ROLES[number];
type BasePhase = "execution" | "cleanup";
type TerminalTelemetryEvent = OperationTelemetryEvent & {
  outcome: Exclude<OperationTelemetryEvent["outcome"], "started">;
};

export type TelemetryLifecycleOutcome =
  | "completed"
  | "refused"
  | "ambiguous"
  | "recovered"
  | "unresolved"
  | "uninspected";

export type TelemetryAdapterIssue =
  | "capacity-boundary"
  | "conflicting-recovery"
  | "duplicate-event"
  | "duplicate-terminal"
  | "invalid-transition"
  | "missing-events"
  | "missing-start"
  | "missing-terminal"
  | "mixed-correlation"
  | "non-provider-refusal"
  | "out-of-order"
  | "too-many-events"
  | "unmapped-event";

export interface TelemetryReceiptOperationMapping {
  operationKind: OperationKind;
  phase: BasePhase;
  manifestOperationKey: string;
  observerRole: AdapterRole;
}

export interface TelemetryReceiptAdapterContract {
  schemaVersion: 1;
  scenarioId: string;
  roles: ScenarioEvidenceReceipt["roles"];
  operations: readonly TelemetryReceiptOperationMapping[];
}

export interface TelemetryReceiptCandidate {
  operationKind: OperationKind;
  phase: BasePhase;
  manifestOperationKey: string;
  lifecycleOutcome: TelemetryLifecycleOutcome;
  reasonCategory: OperationReasonCategory;
  recoveryCategory:
    | "not-applicable"
    | "not-needed"
    | "reconciled"
    | "unresolved";
  claim: EvidenceReceiptClaim;
}

export interface TelemetryReceiptAdapterResult {
  schemaVersion: 1;
  scenarioId: string;
  status: "coherent" | "incomplete";
  candidates: readonly TelemetryReceiptCandidate[];
  missingReceiptCoverage: typeof MISSING_RECEIPT_COVERAGE;
  issues: readonly TelemetryAdapterIssue[];
}

export class TelemetryReceiptAdapterError extends Error {
  readonly code: "contract" | "snapshot";

  constructor(code: "contract" | "snapshot", message: string) {
    super(`Invalid telemetry receipt adapter ${code}: ${message}`);
    this.name = "TelemetryReceiptAdapterError";
    this.code = code;
  }
}

export function adaptOperationTelemetryToReceiptCandidates(
  snapshotValue: unknown,
  contractValue: unknown,
): TelemetryReceiptAdapterResult {
  const snapshot = validatedSnapshot(snapshotValue);
  const contract = parseContract(contractValue);
  const chronological = snapshot.order === "oldest"
    ? [...snapshot.events]
    : [...snapshot.events].reverse();
  const mappedKinds = new Set(
    contract.operations.map(({ operationKind }) => operationKind),
  );
  const globalIssues = new Set<TelemetryAdapterIssue>();

  if (snapshot.events.length === OPERATION_TELEMETRY_MAX_EVENTS) {
    globalIssues.add("capacity-boundary");
  }
  if (chronological.some((event) => !mappedKinds.has(event.operationKind))) {
    globalIssues.add("unmapped-event");
  }
  const mappedEvents = chronological.filter((event) =>
    mappedKinds.has(event.operationKind)
  );
  if (new Set(mappedEvents.map(({ markerHash }) => markerHash)).size > 1) {
    globalIssues.add("mixed-correlation");
  }

  const candidates = [...contract.operations]
    .sort((left, right) =>
      left.manifestOperationKey.localeCompare(right.manifestOperationKey)
    )
    .map((mapping) => {
      if (
        globalIssues.has("capacity-boundary") ||
        globalIssues.has("mixed-correlation")
      ) {
        return uninspectedCandidate(mapping);
      }
      return analyzeLifecycle(
        mapping,
        chronological.filter(
          ({ operationKind }) => operationKind === mapping.operationKind,
        ),
        contract.roles,
        globalIssues,
      );
    });
  const issues = [...globalIssues].sort();

  return Object.freeze({
    schemaVersion: 1,
    scenarioId: contract.scenarioId,
    status: issues.length === 0 ? "coherent" : "incomplete",
    candidates: Object.freeze(candidates),
    missingReceiptCoverage: MISSING_RECEIPT_COVERAGE,
    issues: Object.freeze(issues),
  });
}

function analyzeLifecycle(
  mapping: TelemetryReceiptOperationMapping,
  events: readonly Readonly<OperationTelemetryEvent>[],
  roles: ScenarioEvidenceReceipt["roles"],
  issues: Set<TelemetryAdapterIssue>,
): TelemetryReceiptCandidate {
  if (events.length === 0) {
    issues.add("missing-events");
    return uninspectedCandidate(mapping);
  }
  if (events.length > MAX_OPERATION_EVENTS_PER_RUN) {
    issues.add("too-many-events");
    return uninspectedCandidate(mapping);
  }
  if (new Set(events.map(({ markerHash }) => markerHash)).size !== 1) {
    issues.add("mixed-correlation");
    return uninspectedCandidate(mapping);
  }
  if (
    events.some((event) =>
      event.phase !== mapping.phase && event.phase !== "recovery"
    )
  ) {
    issues.add("invalid-transition");
    return uninspectedCandidate(mapping);
  }

  const baseStarts = events.filter((event) =>
    event.phase === mapping.phase && event.outcome === "started"
  );
  const baseTerminals = events.filter((event) =>
    event.phase === mapping.phase && event.outcome !== "started"
  );
  const recoveryStarts = events.filter((event) =>
    event.phase === "recovery" && event.outcome === "started"
  );
  const recoveryTerminals = events.filter((event) =>
    event.phase === "recovery" && event.outcome !== "started"
  );

  if (baseStarts.length === 0) {
    issues.add("missing-start");
    return uninspectedCandidate(mapping);
  }
  if (baseStarts.length > 1 || recoveryStarts.length > 1) {
    issues.add("duplicate-event");
    return uninspectedCandidate(mapping);
  }
  if (baseTerminals.length === 0) {
    issues.add("missing-terminal");
    return uninspectedCandidate(mapping);
  }
  if (baseTerminals.length > 1 || recoveryTerminals.length > 1) {
    issues.add("duplicate-terminal");
    return uninspectedCandidate(mapping);
  }
  if (recoveryStarts.length !== recoveryTerminals.length) {
    issues.add(
      recoveryStarts.length === 0 ? "missing-start" : "missing-terminal",
    );
    return uninspectedCandidate(mapping);
  }

  const expectedShape = recoveryStarts.length === 0
    ? [
      `${mapping.phase}:started`,
      `${mapping.phase}:terminal`,
    ]
    : [
      `${mapping.phase}:started`,
      "recovery:started",
      "recovery:terminal",
      `${mapping.phase}:terminal`,
    ];
  const actualShape = events.map((event) =>
    `${event.phase}:${event.outcome === "started" ? "started" : "terminal"}`
  );
  if (JSON.stringify(actualShape) !== JSON.stringify(expectedShape)) {
    issues.add("out-of-order");
    return uninspectedCandidate(mapping);
  }
  if (!validStart(baseStarts[0]!, false)) {
    issues.add("invalid-transition");
    return uninspectedCandidate(mapping);
  }

  const baseTerminal = baseTerminals[0]! as TerminalTelemetryEvent;
  if (recoveryStarts.length === 0) {
    if (!validBaseTerminal(baseTerminal, "not-needed")) {
      issues.add("invalid-transition");
      return uninspectedCandidate(mapping);
    }
    return terminalCandidate(
      mapping,
      roles,
      outcomeWithoutRecovery(baseTerminal),
      baseTerminal,
      issues,
    );
  }

  const recoveryStart = recoveryStarts[0]!;
  const recoveryTerminal = recoveryTerminals[0]! as TerminalTelemetryEvent;
  if (!validStart(recoveryStart, true)) {
    issues.add("invalid-transition");
    return uninspectedCandidate(mapping);
  }
  if (recoveryTerminal.outcome === "succeeded") {
    if (
      !validRecoveryTerminal(recoveryTerminal, "reconciled") ||
      !validBaseTerminal(baseTerminal, "reconciled")
    ) {
      issues.add("conflicting-recovery");
      return uninspectedCandidate(mapping);
    }
    const lifecycle = baseTerminal.outcome === "succeeded"
      ? "recovered"
      : baseTerminal.outcome;
    return terminalCandidate(mapping, roles, lifecycle, baseTerminal, issues);
  }
  if (
    !validRecoveryTerminal(recoveryTerminal, "unresolved") ||
    baseTerminal.outcome !== "refused" ||
    !validBaseTerminal(baseTerminal, "unresolved")
  ) {
    issues.add("conflicting-recovery");
    return uninspectedCandidate(mapping);
  }
  return terminalCandidate(
    mapping,
    roles,
    "unresolved",
    baseTerminal,
    issues,
  );
}

function validStart(
  event: Readonly<OperationTelemetryEvent>,
  recovery: boolean,
): boolean {
  return event.durationMs === 0 &&
    event.reason === "none" &&
    event.ambiguityState === "none" &&
    event.recoveryState === (recovery ? "in-progress" : "not-applicable") &&
    event.upstreamStatus === undefined;
}

function validBaseTerminal(
  event: Readonly<TerminalTelemetryEvent>,
  expectedRecovery: "not-needed" | "reconciled" | "unresolved",
): boolean {
  if (event.recoveryState !== expectedRecovery) {
    return false;
  }
  if (event.outcome === "succeeded") {
    return event.reason === "none" && event.ambiguityState === "none";
  }
  if (event.outcome === "refused") {
    return event.reason !== "none" &&
      event.ambiguityState === (
        expectedRecovery === "unresolved" ? "unresolved" : "none"
      );
  }
  return event.outcome === "ambiguous" &&
    event.reason !== "none" &&
    event.ambiguityState === (
      expectedRecovery === "unresolved" ? "unresolved" : "possible-mutation"
    );
}

function validRecoveryTerminal(
  event: Readonly<TerminalTelemetryEvent>,
  expectedRecovery: "reconciled" | "unresolved",
): boolean {
  if (event.recoveryState !== expectedRecovery) {
    return false;
  }
  return expectedRecovery === "reconciled"
    ? event.outcome === "succeeded" &&
      event.reason === "none" &&
      event.ambiguityState === "none"
    : (event.outcome === "refused" || event.outcome === "ambiguous") &&
      event.reason !== "none" &&
      event.ambiguityState === "unresolved";
}

function outcomeWithoutRecovery(
  event: Readonly<TerminalTelemetryEvent>,
): Exclude<TelemetryLifecycleOutcome, "recovered" | "unresolved" | "uninspected"> {
  return event.outcome === "succeeded" ? "completed" : event.outcome;
}

function terminalCandidate(
  mapping: TelemetryReceiptOperationMapping,
  roles: ScenarioEvidenceReceipt["roles"],
  lifecycleOutcome: Exclude<TelemetryLifecycleOutcome, "uninspected">,
  terminal: Readonly<TerminalTelemetryEvent>,
  issues: Set<TelemetryAdapterIssue>,
): TelemetryReceiptCandidate {
  const locallyRefused = lifecycleOutcome === "refused" &&
    terminal.reason !== "upstream-refusal";
  if (locallyRefused) {
    issues.add("non-provider-refusal");
  }
  const state = locallyRefused
    ? "uninspected"
    : lifecycleOutcome === "completed" ||
      lifecycleOutcome === "recovered"
    ? "proven"
    : lifecycleOutcome === "refused"
    ? "refused"
    : "ambiguous";
  const claim: EvidenceReceiptClaim = {
    id: `operation-${mapping.manifestOperationKey}`,
    category: "operation",
    subject: {
      kind: "operation",
      id: mapping.manifestOperationKey,
    },
    assertion: "operation-completed",
    state,
    ...(state === "uninspected"
      ? {}
      : {
        observation: {
          source: "provider-response" as const,
          outcome: state === "refused"
            ? "provider-refusal" as const
            : "operation-result" as const,
          observerActorId: roles[mapping.observerRole]!,
          operationKey: mapping.manifestOperationKey,
        },
      }),
  };
  return Object.freeze({
    operationKind: mapping.operationKind,
    phase: mapping.phase,
    manifestOperationKey: mapping.manifestOperationKey,
    lifecycleOutcome,
    reasonCategory: terminal.reason,
    recoveryCategory: lifecycleOutcome === "unresolved"
      ? "unresolved"
      : terminal.recoveryState === "reconciled"
      ? "reconciled"
      : "not-needed",
    claim: Object.freeze(claim),
  });
}

function uninspectedCandidate(
  mapping: TelemetryReceiptOperationMapping,
): TelemetryReceiptCandidate {
  const claim: EvidenceReceiptClaim = {
    id: `operation-${mapping.manifestOperationKey}`,
    category: "operation",
    subject: {
      kind: "operation",
      id: mapping.manifestOperationKey,
    },
    assertion: "operation-completed",
    state: "uninspected",
  };
  return Object.freeze({
    operationKind: mapping.operationKind,
    phase: mapping.phase,
    manifestOperationKey: mapping.manifestOperationKey,
    lifecycleOutcome: "uninspected",
    reasonCategory: "none",
    recoveryCategory: "not-applicable",
    claim: Object.freeze(claim),
  });
}

function validatedSnapshot(value: unknown): OperationTelemetrySnapshot {
  const snapshot = record(value, "snapshot");
  exactKeys(snapshot, ["schemaVersion", "order", "events"], "snapshot");
  if (
    snapshot.schemaVersion !== 1 ||
    (snapshot.order !== "oldest" && snapshot.order !== "newest") ||
    !Array.isArray(snapshot.events) ||
    snapshot.events.length > OPERATION_TELEMETRY_MAX_EVENTS
  ) {
    throw new TelemetryReceiptAdapterError(
      "snapshot",
      "snapshot shape or bound is invalid.",
    );
  }
  const validator = new InMemoryOperationTelemetryCollector({
    maxEvents: OPERATION_TELEMETRY_MAX_EVENTS,
    maxAgeMs: 1,
    maxResponseBytes: Number.MAX_SAFE_INTEGER,
    clock: () => 0,
  });
  try {
    for (const event of snapshot.events) {
      validator.record(event as OperationTelemetryEvent);
    }
  } catch {
    throw new TelemetryReceiptAdapterError(
      "snapshot",
      "snapshot contains an invalid telemetry event.",
    );
  }
  return snapshot as unknown as OperationTelemetrySnapshot;
}

function parseContract(value: unknown): TelemetryReceiptAdapterContract {
  const contract = record(value, "contract");
  exactKeys(
    contract,
    ["schemaVersion", "scenarioId", "roles", "operations"],
    "contract",
  );
  if (contract.schemaVersion !== 1 || !Array.isArray(contract.operations)) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "contract shape is invalid.",
    );
  }
  if (
    contract.operations.length === 0 ||
    contract.operations.length > OPERATION_KINDS.length
  ) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "operation mappings are not bounded.",
    );
  }
  const roles = parseRoles(contract.roles);
  const operations = contract.operations.map(parseMapping);
  if (operations.some(({ observerRole }) => roles[observerRole] === undefined)) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "operation observer role is not assigned.",
    );
  }
  if (
    new Set(operations.map(({ operationKind }) => operationKind)).size !==
      operations.length ||
    new Set(operations.map(({ manifestOperationKey }) => manifestOperationKey))
        .size !== operations.length
  ) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "operation mappings must be one-to-one.",
    );
  }
  return {
    schemaVersion: 1,
    scenarioId: alias(contract.scenarioId, "scenarioId"),
    roles,
    operations,
  };
}

function parseRoles(value: unknown): ScenarioEvidenceReceipt["roles"] {
  const roles = record(value, "roles");
  exactKeys(
    roles,
    CONTRACT_ROLES,
    "roles",
    ["detector", "responder"],
  );
  const parsed = {
    evidenceProducer: alias(roles.evidenceProducer, "evidenceProducer"),
    workloadActor: alias(roles.workloadActor, "workloadActor"),
    learner: alias(roles.learner, "learner"),
    ...(roles.detector === undefined
      ? {}
      : { detector: alias(roles.detector, "detector") }),
    ...(roles.responder === undefined
      ? {}
      : { responder: alias(roles.responder, "responder") }),
  };
  if (findScenarioRoleConflation(parsed) !== undefined) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "role aliases are conflated.",
    );
  }
  return parsed;
}

function parseMapping(
  value: unknown,
  index: number,
): TelemetryReceiptOperationMapping {
  const mapping = record(value, `operations[${index}]`);
  exactKeys(
    mapping,
    ["operationKind", "phase", "manifestOperationKey", "observerRole"],
    `operations[${index}]`,
  );
  if (
    !OPERATION_KINDS.includes(mapping.operationKind as OperationKind) ||
    !OBSERVER_ROLES.includes(mapping.observerRole as AdapterRole)
  ) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "operation mapping category is invalid.",
    );
  }
  const operationKind = mapping.operationKind as OperationKind;
  if (mapping.phase !== BASE_PHASE_BY_OPERATION[operationKind]) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      "operation mapping phase is invalid.",
    );
  }
  return {
    operationKind,
    phase: BASE_PHASE_BY_OPERATION[operationKind],
    manifestOperationKey: alias(
      mapping.manifestOperationKey,
      "manifestOperationKey",
    ),
    observerRole: mapping.observerRole as AdapterRole,
  };
}

function alias(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !SAFE_ALIAS.test(value) ||
    GUID.test(value)
  ) {
    throw new TelemetryReceiptAdapterError(
      "contract",
      `${field} must be a sanitized alias.`,
    );
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TelemetryReceiptAdapterError(
      field === "snapshot" ? "snapshot" : "contract",
      `${field} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(value).sort();
  const expected = allowed
    .filter((key) => !optional.includes(key) || value[key] !== undefined)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TelemetryReceiptAdapterError(
      field === "snapshot" ? "snapshot" : "contract",
      `${field} contains unexpected or missing fields.`,
    );
  }
}
