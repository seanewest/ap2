import { createHash } from "node:crypto";
import {
  adaptPurviewOperationToReceipt,
  PurviewOperationReceiptAdapterError,
  type PurviewOperationReceiptAdapterInput,
} from "../src/scenarios/purview-operation-receipt-adapter.ts";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from
  "../src/scenarios/purview-audit-boundary.ts";
import {
  bindRehearsalPlan,
  declareRehearsalEnvelope,
  exactRehearsalRecord,
  inspectBoundedRehearsalValue,
  parseCanonicalRehearsalJson,
  REHEARSAL_VERIFIED_LABEL,
  type SharedRehearsalInvariantFailure,
} from "../src/scenarios/rehearsal-envelope-invariants.ts";
import {
  EvidenceReceiptError,
  verifyScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import {
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
} from "../src/scenarios/scenario-plan.ts";
import type {
  PurviewAuditBoundaryRehearsalResult,
} from "./purview-audit-boundary-rehearsal.ts";

const MAX_OUTPUT_BYTES = 32 * 1024;
const SCENARIO_ID = "purview-sharepoint-audit-boundary";
const MANIFEST_SCHEMA_VERSION = 2;
const READ_OPERATION = "read-bounded-audit-status";
const SHA256 = /^[a-f0-9]{64}$/;
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

export type PurviewAuditBoundaryRehearsalVerificationFailure =
  | SharedRehearsalInvariantFailure
  | "ADAPTER_REFUSED"
  | "DEDUPLICATION_MISMATCH"
  | "EVIDENCE_OVERCLAIM"
  | "INPUT_BINDING"
  | "OBSERVATION_SEQUENCE"
  | "OUTPUT_BINDING"
  | "RECEIPT_BINDING"
  | "RECEIPT_REFUSED";

export interface VerifiedPurviewAuditBoundaryRehearsalSummary {
  schemaVersion: 1;
  label: typeof REHEARSAL_VERIFIED_LABEL;
  status: "verified";
  scenarioId: typeof SCENARIO_ID;
  manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  planDigestSha256: string;
  syntheticInputDigestSha256: string;
  receiptDigestSha256: string;
  outputDigestSha256: string;
  syntheticContract: "deduplicated-producer-attribution-terminal-verified";
  adapter: "accepted";
  receiptVerifier: "accepted";
  envelope: "accepted";
  externalEvidence: "all-uninspected";
  claimCount: 14;
  producerAttributionClaimCount: 1;
}

export class PurviewAuditBoundaryRehearsalVerificationError extends Error {
  readonly category: PurviewAuditBoundaryRehearsalVerificationFailure;

  constructor(category: PurviewAuditBoundaryRehearsalVerificationFailure) {
    super(category);
    this.name = "PurviewAuditBoundaryRehearsalVerificationError";
    this.category = category;
  }
}

export function verifyPurviewAuditBoundaryRehearsalOutput(
  value: unknown,
): VerifiedPurviewAuditBoundaryRehearsalSummary {
  const inputFailure = inspectBoundedRehearsalValue(value, MAX_OUTPUT_BYTES);
  if (inputFailure !== null) throw sharedFailure(inputFailure);

  const output = exactRecord(value, [
    "schemaVersion",
    "label",
    "status",
    "failure",
    "binding",
    "stages",
    "syntheticObservation",
    "receipt",
    "envelope",
  ]);
  if (output.schemaVersion !== 1) throw failure("INPUT_SHAPE");

  const expected = independentlyExpectedOutput();
  const expectedBinding = expected.binding;
  const binding = exactRecord(output.binding, [
    "scenarioId",
    "manifestSchemaVersion",
    "planDigestSha256",
    "syntheticInputDigestSha256",
    "receiptDigestSha256",
    "outputDigestSha256",
  ]);
  const stages = exactRecord(output.stages, Object.keys(expected.stages));
  const syntheticObservation = exactRecord(
    output.syntheticObservation,
    Object.keys(expected.syntheticObservation),
  );
  const receipt = exactRecord(output.receipt, Object.keys(expected.receipt));
  const envelope = exactRecord(output.envelope, Object.keys(expected.envelope));
  const claims = exactRecord(
    envelope.claims,
    Object.keys(expected.envelope.claims),
  );

  const planBinding = bindRehearsalPlan({
    scenarioId: binding.scenarioId,
    expectedScenarioId: SCENARIO_ID,
    manifestSchemaVersion: binding.manifestSchemaVersion,
    expectedManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: binding.planDigestSha256,
    expectedPlanDigestSha256: expectedBinding.planDigestSha256,
  });
  if (!planBinding.ok) throw sharedFailure(planBinding.failure);

  const claimStates = EXTERNAL_CLAIMS.map((key) => claims[key]);
  const declaration = declareRehearsalEnvelope({
    label: output.label,
    status: output.status,
    failure: output.failure,
    syntheticValues: [
      syntheticObservation.terminalState,
      syntheticObservation.sourcePages,
      syntheticObservation.deduplication,
      syntheticObservation.adapterObservation,
    ],
    externalClaims: {
      total: claimStates.length,
      uninspected: claimStates.filter((state) => state === "uninspected").length,
      nonUninspected: claimStates.filter((state) => state !== "uninspected")
        .length,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);

  if (JSON.stringify(stages) !== JSON.stringify(expected.stages)) {
    throw failure("RUN_NONTERMINAL");
  }
  if (
    syntheticObservation.terminalState !==
      "synthetic-deduplicated-operation-observation" ||
    syntheticObservation.sourcePages !==
      "synthetic-two-pages-one-duplicate"
  ) {
    throw failure("OBSERVATION_SEQUENCE");
  }
  if (
    syntheticObservation.deduplication !==
      "synthetic-one-unique-match" ||
    receipt.duplicatePageClaimCount !== 1 ||
    receipt.syntheticProvenClaimCount !== PROVEN_CLAIMS.length
  ) {
    throw failure("DEDUPLICATION_MISMATCH");
  }
  if (
    syntheticObservation.adapterObservation !==
      "synthetic-categorical-only" ||
    envelope.terminalState !== "terminal-complete" ||
    envelope.observationSource !== "synthetic-only" ||
    envelope.externalEvidence !== "all-uninspected" ||
    claimStates.some((state) => state !== "uninspected")
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }
  if (
    !validDigest(binding.syntheticInputDigestSha256) ||
    binding.syntheticInputDigestSha256 !==
      expectedBinding.syntheticInputDigestSha256
  ) {
    throw failure("INPUT_BINDING");
  }
  if (
    !validDigest(binding.receiptDigestSha256) ||
    binding.receiptDigestSha256 !== expectedBinding.receiptDigestSha256 ||
    receipt.adapterCandidateAccepted !== true ||
    receipt.verifierAccepted !== true ||
    receipt.candidateClaimCount !== 14 ||
    receipt.allUnsupportedClaims !== "uninspected"
  ) {
    throw failure("RECEIPT_BINDING");
  }
  if (
    !validDigest(binding.outputDigestSha256) ||
    binding.outputDigestSha256 !== expectedBinding.outputDigestSha256
  ) {
    throw failure("OUTPUT_BINDING");
  }
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw failure("OUTPUT_BINDING");
  }

  return deepFreeze({
    schemaVersion: 1,
    label: REHEARSAL_VERIFIED_LABEL,
    status: "verified",
    scenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: planBinding.value.planDigestSha256,
    syntheticInputDigestSha256: expectedBinding.syntheticInputDigestSha256,
    receiptDigestSha256: expectedBinding.receiptDigestSha256,
    outputDigestSha256: expectedBinding.outputDigestSha256,
    syntheticContract:
      "deduplicated-producer-attribution-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    envelope: "accepted",
    externalEvidence: declaration.value.externalEvidence,
    claimCount: 14,
    producerAttributionClaimCount: 1,
  });
}

export function verifyPurviewAuditBoundaryRehearsalOutputText(
  text: string,
): VerifiedPurviewAuditBoundaryRehearsalSummary {
  const parsed = parseCanonicalRehearsalJson(text, MAX_OUTPUT_BYTES);
  if (!parsed.ok) throw sharedFailure(parsed.failure);
  return verifyPurviewAuditBoundaryRehearsalOutput(parsed.value);
}

function independentlyExpectedOutput() {
  const plan = independentlyCompilePlan();
  const syntheticInput = reconstructedSyntheticInput();
  let candidate;
  try {
    candidate = adaptPurviewOperationToReceipt(syntheticInput.adapterInput);
  } catch (error) {
    if (error instanceof PurviewOperationReceiptAdapterError) {
      throw failure("ADAPTER_REFUSED");
    }
    throw failure("ADAPTER_REFUSED");
  }
  let verified;
  try {
    verified = verifyScenarioEvidenceReceipt(
      candidate,
      PURVIEW_AUDIT_BOUNDARY_SCENARIO,
    );
  } catch (error) {
    if (error instanceof EvidenceReceiptError) {
      throw failure("RECEIPT_REFUSED");
    }
    throw failure("RECEIPT_REFUSED");
  }

  const proven = verified.claims
    .filter(({ state }) => state === "proven")
    .map(({ claimId }) => claimId);
  if (
    verified.claims.length !== 14 ||
    JSON.stringify(proven) !== JSON.stringify(PROVEN_CLAIMS) ||
    verified.claims.filter(({ claimId }) => claimId === "producer-attribution")
      .length !== 1 ||
    verified.claims.some(({ claimId, state }) =>
      !PROVEN_CLAIMS.includes(claimId as typeof PROVEN_CLAIMS[number]) &&
      state !== "uninspected"
    )
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }

  const claims = Object.fromEntries(
    EXTERNAL_CLAIMS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIMS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    syntheticValues: [
      syntheticInput.terminalState,
      syntheticInput.sourcePages,
      syntheticInput.deduplication,
      "synthetic-categorical-only",
    ],
    externalClaims: {
      total: EXTERNAL_CLAIMS.length,
      uninspected: EXTERNAL_CLAIMS.length,
      nonUninspected: 0,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);

  const core = {
    stages: {
      plan: "compiled",
      syntheticDetector: "completed",
      adapter: "accepted",
      syntheticBinding: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    syntheticObservation: {
      terminalState: syntheticInput.terminalState,
      sourcePages: syntheticInput.sourcePages,
      deduplication: syntheticInput.deduplication,
      adapterObservation: "synthetic-categorical-only",
    },
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: candidate.claims.length,
      syntheticProvenClaimCount: proven.length,
      duplicatePageClaimCount: 1,
      allUnsupportedClaims: "uninspected",
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
      claims,
    },
  } as const;
  const bindingWithoutOutput = {
    scenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: plan.digestSha256,
    syntheticInputDigestSha256: sha256(syntheticInput),
    receiptDigestSha256: sha256(candidate),
  } as const;
  const outputDigestSha256 = sha256({
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    binding: bindingWithoutOutput,
    ...core,
  });

  const expected = {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    binding: { ...bindingWithoutOutput, outputDigestSha256 },
    ...core,
  } as const satisfies PurviewAuditBoundaryRehearsalResult;
  return expected;
}

function independentlyCompilePlan(): ScenarioExecutionPlan {
  const scenario = PURVIEW_AUDIT_BOUNDARY_SCENARIO;
  const expiresAt = scenario.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      scenario.cost.conservativeDurationHours * 3_600_000,
  ).toISOString();
  let plan: ScenarioExecutionPlan;
  try {
    plan = compileScenarioExecutionPlan({
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
      maximumBudgetUsd: scenario.cost.laneMaximum,
    }, [scenario]);
  } catch {
    throw failure("PLAN_BINDING");
  }
  const readStep = plan.steps.find(
    ({ operationKey }) => operationKey === READ_OPERATION,
  );
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.selectedResponseId !== null ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    JSON.stringify(plan.terminalProof.cleanupOperationKeys) !==
      JSON.stringify(["close-purview-evidence-window"]) ||
    JSON.stringify(plan.terminalProof.evidenceArtifactIds) !==
      JSON.stringify(["purview-query-boundary"]) ||
    JSON.stringify(plan.terminalProof.observationOperationKeys) !==
      JSON.stringify([READ_OPERATION]) ||
    JSON.stringify(plan.terminalProof.retainedArtifactIds) !==
      JSON.stringify(["purview-query-boundary"]) ||
    readStep?.owningRole !== "detector" ||
    readStep.actorAlias !== "detector" ||
    readStep.operationCategory !== "artifact.read-exact" ||
    readStep.execution !== "automated"
  ) {
    throw failure("PLAN_BINDING");
  }
  return plan;
}

function reconstructedSyntheticInput(): {
  schemaVersion: 1;
  scenarioId: typeof SCENARIO_ID;
  terminalState: "synthetic-deduplicated-operation-observation";
  sourcePages: "synthetic-two-pages-one-duplicate";
  deduplication: "synthetic-one-unique-match";
  adapterInput: PurviewOperationReceiptAdapterInput;
} {
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

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const record = exactRehearsalRecord(value, keys);
  if (record === null) throw failure("INPUT_SHAPE");
  return record;
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function sharedFailure(
  category: SharedRehearsalInvariantFailure,
): PurviewAuditBoundaryRehearsalVerificationError {
  return failure(category);
}

function failure(
  category: PurviewAuditBoundaryRehearsalVerificationFailure,
): PurviewAuditBoundaryRehearsalVerificationError {
  return new PurviewAuditBoundaryRehearsalVerificationError(category);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
