import { createHash } from "node:crypto";
import {
  adaptPurviewOperationToReceipt,
  PurviewOperationReceiptAdapterError,
  type PurviewOperationReceiptAdapterInput,
} from "../src/scenarios/purview-operation-receipt-adapter.ts";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from
  "../src/scenarios/purview-audit-boundary.ts";
import {
  ALL_EXTERNAL_CLAIMS_UNINSPECTED,
  bindRehearsalPlan,
  declareRehearsalEnvelope,
  exactRehearsalRecord,
  inspectBoundedRehearsalValue,
  REHEARSAL_ONLY_LABEL,
  SYNTHETIC_ONLY_OBSERVATIONS,
  TERMINAL_COMPLETE,
} from "../src/scenarios/rehearsal-envelope-invariants.ts";
import {
  verifyCanonicalScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-verification.ts";
import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "../src/scenarios/scenario-plan.ts";

const LABEL = REHEARSAL_ONLY_LABEL;
const SCENARIO_ID = "purview-sharepoint-audit-boundary";
const MANIFEST_SCHEMA_VERSION = 2;
const MAX_REQUEST_BYTES = 4_096;
const MAX_SYNTHETIC_BYTES = 8_192;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_KEYS = [
  "schemaVersion",
  "label",
  "scenarioId",
  "planDigestSha256",
  "syntheticInputDigestSha256",
] as const;
const SYNTHETIC_KEYS = [
  "schemaVersion",
  "scenarioId",
  "terminalState",
  "sourcePages",
  "deduplication",
  "adapterInput",
] as const;
const PROVEN_CLAIMS = [
  "artifact-purview-query-boundary",
  "detector-independent",
  "producer-attribution",
  "surface-reachability",
  "operation-read-bounded-audit-status",
  "terminal-purview-surface",
] as const;
const EXTERNAL_CLAIMS = [
  "auditSearchSubmission",
  "auditSearchResultRead",
  "liveSharePointOperation",
  "operationAttribution",
  "content",
  "learnerVisibility",
  "learnerInterpretation",
  "response",
  "cleanup",
  "retention",
  "externalImpact",
] as const;

export interface PurviewAuditBoundaryRehearsalRequest {
  schemaVersion: 1;
  label: typeof LABEL;
  scenarioId: typeof SCENARIO_ID;
  planDigestSha256: string;
  syntheticInputDigestSha256: string;
}

export interface PurviewAuditBoundarySyntheticDetector {
  observe(): Promise<unknown>;
}

export type PurviewAuditBoundaryRehearsalFailure =
  | ScenarioPlanError["category"]
  | "ADAPTER_REFUSED"
  | "ENVELOPE_REFUSED"
  | "INPUT_SCHEMA"
  | "INPUT_UNSAFE"
  | "PLAN_BINDING"
  | "RECEIPT_OVERCLAIM"
  | "RECEIPT_REFUSED"
  | "SYNTHETIC_AMBIGUOUS"
  | "SYNTHETIC_BINDING"
  | "SYNTHETIC_CARDINALITY"
  | "SYNTHETIC_DIGEST"
  | "SYNTHETIC_NONTERMINAL"
  | "SYNTHETIC_ORDER"
  | "SYNTHETIC_OVERCLAIM"
  | "SYNTHETIC_SCENARIO_MISMATCH"
  | "SYNTHETIC_SHAPE"
  | "SYNTHETIC_UNSAFE";

export interface PurviewAuditBoundaryRehearsalResult {
  schemaVersion: 1;
  label: typeof LABEL;
  status: "completed" | "refused";
  failure: PurviewAuditBoundaryRehearsalFailure | null;
  binding: Readonly<{
    scenarioId: typeof SCENARIO_ID;
    manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
    planDigestSha256: string;
    syntheticInputDigestSha256: string;
    receiptDigestSha256: string;
    outputDigestSha256: string;
  }> | null;
  stages: Readonly<{
    plan: "compiled" | "refused" | "not-run";
    syntheticDetector: "completed" | "refused" | "not-run";
    adapter: "accepted" | "refused" | "not-run";
    syntheticBinding: "accepted" | "refused" | "not-run";
    receiptVerifier: "accepted" | "refused" | "not-run";
    envelope: "accepted" | "refused" | "not-run";
  }>;
  syntheticObservation: Readonly<{
    terminalState: "synthetic-deduplicated-operation-observation";
    sourcePages: "synthetic-two-pages-one-duplicate";
    deduplication: "synthetic-one-unique-match";
    adapterObservation: "synthetic-categorical-only";
  }> | null;
  receipt: Readonly<{
    adapterCandidateAccepted: true;
    verifierAccepted: true;
    candidateClaimCount: number;
    syntheticProvenClaimCount: number;
    duplicatePageClaimCount: 1;
    allUnsupportedClaims: "uninspected";
  }> | null;
  envelope: Readonly<{
    terminalState: typeof TERMINAL_COMPLETE;
    observationSource: typeof SYNTHETIC_ONLY_OBSERVATIONS;
    externalEvidence: typeof ALL_EXTERNAL_CLAIMS_UNINSPECTED;
    claims: Readonly<
      Record<typeof EXTERNAL_CLAIMS[number], "uninspected">
    >;
  }> | null;
}

interface SyntheticObservation {
  schemaVersion: 1;
  scenarioId: typeof SCENARIO_ID;
  terminalState: "synthetic-deduplicated-operation-observation";
  sourcePages: "synthetic-two-pages-one-duplicate";
  deduplication: "synthetic-one-unique-match";
  adapterInput: PurviewOperationReceiptAdapterInput;
}

export function canonicalPurviewAuditBoundaryPlanningRequest():
  ScenarioPlanningRequest {
  const expiresAt = PURVIEW_AUDIT_BOUNDARY_SCENARIO.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      PURVIEW_AUDIT_BOUNDARY_SCENARIO.cost.conservativeDurationHours *
        3_600_000,
  ).toISOString();
  return {
    scenarioId: SCENARIO_ID,
    actorAliases: {
      evidenceProducer: "harness",
      workloadActor: "producer",
      learner: "learner",
      detector: "detector",
      cleanupOwner: "harness",
    },
    now,
    expiresAt,
    maximumBudgetUsd: PURVIEW_AUDIT_BOUNDARY_SCENARIO.cost.laneMaximum,
  };
}

export function compilePurviewAuditBoundaryRehearsalPlan():
  ScenarioExecutionPlan {
  const plan = compileScenarioExecutionPlan(
    canonicalPurviewAuditBoundaryPlanningRequest(),
    [PURVIEW_AUDIT_BOUNDARY_SCENARIO],
  );
  const readStep = plan.steps.find(
    ({ operationKey }) => operationKey === "read-bounded-audit-status",
  );
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.selectedResponseId !== null ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    !sameStrings(plan.terminalProof.cleanupOperationKeys, [
      "close-purview-evidence-window",
    ]) ||
    !sameStrings(plan.terminalProof.evidenceArtifactIds, [
      "purview-query-boundary",
    ]) ||
    !sameStrings(plan.terminalProof.observationOperationKeys, [
      "read-bounded-audit-status",
    ]) ||
    !sameStrings(plan.terminalProof.retainedArtifactIds, [
      "purview-query-boundary",
    ]) ||
    readStep?.owningRole !== "detector" ||
    readStep.actorAlias !== "detector" ||
    readStep.operationCategory !== "artifact.read-exact" ||
    readStep.execution !== "automated"
  ) {
    throw new RehearsalError("PLAN_BINDING");
  }
  return plan;
}

export function canonicalPurviewAuditBoundarySyntheticObservation():
  SyntheticObservation {
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    terminalState: "synthetic-deduplicated-operation-observation",
    sourcePages: "synthetic-two-pages-one-duplicate",
    deduplication: "synthetic-one-unique-match",
    adapterInput: {
      schemaVersion: 1,
      scenario: {
        id: SCENARIO_ID,
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      },
      roles: {
        evidenceProducer: "purview-lab-harness",
        workloadActor: "sharepoint-workload-app",
        learner: "security-learner",
        detector: "purview-detector-app",
      },
      result: {
        status: "live-proven",
        observationSource: "independent-detector",
        workload: "SharePoint",
        recordType: "sharePointFileOperation",
        operation: "FileUploaded",
        producerApplication: "matches-workload-actor",
        occurredAt: "inside-frozen-window",
        target: "marker-bearing",
        targetType: "present",
        correlation: "present",
        recordSet: "bounded-unpaged-deduplicated",
        uniqueMatches: "one-or-more",
      },
    },
  };
}

export function canonicalPurviewAuditBoundaryRehearsalRequest():
  PurviewAuditBoundaryRehearsalRequest {
  const plan = compilePurviewAuditBoundaryRehearsalPlan();
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    planDigestSha256: plan.digestSha256,
    syntheticInputDigestSha256: digest(
      canonicalPurviewAuditBoundarySyntheticObservation(),
    ),
  };
}

export function createDeterministicPurviewAuditBoundarySyntheticDetector():
  PurviewAuditBoundarySyntheticDetector {
  return {
    async observe(): Promise<SyntheticObservation> {
      return canonicalPurviewAuditBoundarySyntheticObservation();
    },
  };
}

export async function runPurviewAuditBoundaryRehearsal(
  value: unknown,
  detector: PurviewAuditBoundarySyntheticDetector,
): Promise<PurviewAuditBoundaryRehearsalResult> {
  const requestSafety = inspectBoundedRehearsalValue(value, MAX_REQUEST_BYTES);
  if (requestSafety !== null) {
    return refused(
      requestSafety === "UNSAFE_CONTENT" ? "INPUT_UNSAFE" : "INPUT_SCHEMA",
      "plan",
    );
  }

  let request: PurviewAuditBoundaryRehearsalRequest;
  try {
    request = parseRequest(value);
  } catch {
    return refused("INPUT_SCHEMA", "plan");
  }

  let plan: ScenarioExecutionPlan;
  try {
    plan = compilePurviewAuditBoundaryRehearsalPlan();
  } catch (error) {
    return refused(failureCategory(error, "PLAN_BINDING"), "plan");
  }
  const planBinding = bindRehearsalPlan({
    scenarioId: plan.scenarioId,
    expectedScenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    expectedManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: request.planDigestSha256,
    expectedPlanDigestSha256: plan.digestSha256,
  });
  if (!planBinding.ok) return refused("PLAN_BINDING", "plan");

  let syntheticValue: unknown;
  try {
    syntheticValue = await detector.observe();
  } catch {
    return refused("SYNTHETIC_NONTERMINAL", "syntheticDetector");
  }
  const syntheticSafety = inspectBoundedRehearsalValue(
    syntheticValue,
    MAX_SYNTHETIC_BYTES,
  );
  if (syntheticSafety !== null) {
    return refused(
      syntheticSafety === "UNSAFE_CONTENT"
        ? "SYNTHETIC_UNSAFE"
        : "SYNTHETIC_SHAPE",
      "syntheticDetector",
    );
  }
  const syntheticFailure = validateSyntheticObservation(syntheticValue);
  if (syntheticFailure !== null) {
    return refused(syntheticFailure, "syntheticDetector");
  }
  const synthetic = syntheticValue as SyntheticObservation;

  let receipt;
  try {
    receipt = adaptPurviewOperationToReceipt(synthetic.adapterInput);
  } catch (error) {
    return refused(failureCategory(error, "ADAPTER_REFUSED"), "adapter");
  }
  if (digest(syntheticValue) !== request.syntheticInputDigestSha256) {
    return refused("SYNTHETIC_DIGEST", "syntheticBinding");
  }

  let verified;
  try {
    verified = verifyCanonicalScenarioEvidenceReceipt(receipt);
  } catch {
    return refused("RECEIPT_REFUSED", "receiptVerifier");
  }
  const proven = verified.claims
    .filter(({ state }) => state === "proven")
    .map(({ claimId }) => claimId);
  if (
    !sameStrings(proven, PROVEN_CLAIMS) ||
    verified.claims.filter(({ claimId }) =>
      claimId === "producer-attribution"
    ).length !== 1 ||
    verified.claims.some(({ claimId, state }) =>
      !PROVEN_CLAIMS.includes(claimId as typeof PROVEN_CLAIMS[number]) &&
      state !== "uninspected"
    )
  ) {
    return refused("RECEIPT_OVERCLAIM", "receiptVerifier");
  }

  const externalClaims = Object.fromEntries(
    EXTERNAL_CLAIMS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIMS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: LABEL,
    status: "completed",
    failure: null,
    syntheticValues: [
      synthetic.terminalState,
      synthetic.sourcePages,
      synthetic.deduplication,
      "synthetic-categorical-only",
    ],
    externalClaims: {
      total: EXTERNAL_CLAIMS.length,
      uninspected: EXTERNAL_CLAIMS.length,
      nonUninspected: 0,
    },
  });
  if (!declaration.ok) return refused("ENVELOPE_REFUSED", "envelope");

  const core = {
    stages: completedStages(),
    syntheticObservation: {
      terminalState: synthetic.terminalState,
      sourcePages: synthetic.sourcePages,
      deduplication: synthetic.deduplication,
      adapterObservation: "synthetic-categorical-only" as const,
    },
    receipt: {
      adapterCandidateAccepted: true as const,
      verifierAccepted: true as const,
      candidateClaimCount: verified.claims.length,
      syntheticProvenClaimCount: proven.length,
      duplicatePageClaimCount: 1 as const,
      allUnsupportedClaims: "uninspected" as const,
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
      claims: externalClaims,
    },
  };
  const bindingWithoutOutput = {
    scenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: planBinding.value.planDigestSha256,
    syntheticInputDigestSha256: digest(synthetic),
    receiptDigestSha256: digest(receipt),
  } as const;

  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "completed",
    failure: null,
    binding: {
      ...bindingWithoutOutput,
      outputDigestSha256: digest({
        schemaVersion: 1,
        label: LABEL,
        status: "completed",
        failure: null,
        binding: bindingWithoutOutput,
        ...core,
      }),
    },
    ...core,
  });
}

function parseRequest(value: unknown): PurviewAuditBoundaryRehearsalRequest {
  const record = exactRehearsalRecord(value, REQUEST_KEYS);
  if (
    record === null ||
    record.schemaVersion !== 1 ||
    record.label !== LABEL ||
    record.scenarioId !== SCENARIO_ID ||
    typeof record.planDigestSha256 !== "string" ||
    !SHA256.test(record.planDigestSha256) ||
    typeof record.syntheticInputDigestSha256 !== "string" ||
    !SHA256.test(record.syntheticInputDigestSha256)
  ) {
    throw new RehearsalError("INPUT_SCHEMA");
  }
  return value as PurviewAuditBoundaryRehearsalRequest;
}

function validateSyntheticObservation(
  value: unknown,
): PurviewAuditBoundaryRehearsalFailure | null {
  const record = exactRehearsalRecord(value, SYNTHETIC_KEYS);
  if (record === null || record.schemaVersion !== 1) return "SYNTHETIC_SHAPE";
  if (record.scenarioId !== SCENARIO_ID) {
    return "SYNTHETIC_SCENARIO_MISMATCH";
  }
  if (record.terminalState === "synthetic-ambiguous") {
    return "SYNTHETIC_AMBIGUOUS";
  }
  if (
    record.terminalState !== "synthetic-deduplicated-operation-observation"
  ) {
    return "SYNTHETIC_NONTERMINAL";
  }
  if (record.sourcePages !== "synthetic-two-pages-one-duplicate") {
    return record.sourcePages === "synthetic-pages-reordered"
      ? "SYNTHETIC_ORDER"
      : "SYNTHETIC_CARDINALITY";
  }
  if (record.deduplication !== "synthetic-one-unique-match") {
    return "SYNTHETIC_CARDINALITY";
  }
  return null;
}

function refused(
  failure: PurviewAuditBoundaryRehearsalFailure,
  stage:
    | "plan"
    | "syntheticDetector"
    | "adapter"
    | "syntheticBinding"
    | "receiptVerifier"
    | "envelope",
): PurviewAuditBoundaryRehearsalResult {
  const planCompiled = stage !== "plan";
  const syntheticCompleted = planCompiled && stage !== "syntheticDetector";
  const adapterAccepted = syntheticCompleted && stage !== "adapter";
  const bindingAccepted = adapterAccepted && stage !== "syntheticBinding";
  const verifierAccepted = bindingAccepted && stage !== "receiptVerifier";
  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "refused",
    failure,
    binding: null,
    stages: {
      plan: stage === "plan" ? "refused" : "compiled",
      syntheticDetector: !planCompiled
        ? "not-run"
        : stage === "syntheticDetector"
        ? "refused"
        : "completed",
      adapter: !syntheticCompleted
        ? "not-run"
        : stage === "adapter"
        ? "refused"
        : "accepted",
      syntheticBinding: !adapterAccepted
        ? "not-run"
        : stage === "syntheticBinding"
        ? "refused"
        : "accepted",
      receiptVerifier: !bindingAccepted
        ? "not-run"
        : stage === "receiptVerifier"
        ? "refused"
        : "accepted",
      envelope: stage === "envelope"
        ? "refused"
        : verifierAccepted
        ? "not-run"
        : "not-run",
    },
    syntheticObservation: null,
    receipt: null,
    envelope: null,
  });
}

function completedStages(): PurviewAuditBoundaryRehearsalResult["stages"] {
  return {
    plan: "compiled",
    syntheticDetector: "completed",
    adapter: "accepted",
    syntheticBinding: "accepted",
    receiptVerifier: "accepted",
    envelope: "accepted",
  };
}

function failureCategory(
  error: unknown,
  fallback: PurviewAuditBoundaryRehearsalFailure,
): PurviewAuditBoundaryRehearsalFailure {
  if (error instanceof ScenarioPlanError) return error.category;
  if (error instanceof PurviewOperationReceiptAdapterError) {
    const categories = {
      shape: "SYNTHETIC_SHAPE",
      "scenario-mismatch": "SYNTHETIC_SCENARIO_MISMATCH",
      "role-conflation": "SYNTHETIC_BINDING",
      "observation-mismatch": "SYNTHETIC_BINDING",
      "semantic-overclaim": "SYNTHETIC_OVERCLAIM",
    } as const;
    return categories[error.code];
  }
  if (error instanceof RehearsalError) return error.failure;
  return fallback;
}

class RehearsalError extends Error {
  readonly failure: PurviewAuditBoundaryRehearsalFailure;

  constructor(failure: PurviewAuditBoundaryRehearsalFailure) {
    super(failure);
    this.name = "PurviewAuditBoundaryRehearsalError";
    this.failure = failure;
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null &&
    !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
