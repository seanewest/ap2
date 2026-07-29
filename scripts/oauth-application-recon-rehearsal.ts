import { createHash } from "node:crypto";
import {
  adaptOauthApplicationReconToReceipt,
  canonicalOauthApplicationReconReceiptAdapterInput,
  OauthReconReceiptAdapterError,
  type OauthApplicationReconReceiptAdapterInput,
} from "../src/scenarios/oauth-application-recon-receipt-adapter.ts";
import { OAUTH_APPLICATION_RECON_SCENARIO } from
  "../src/scenarios/oauth-application-recon.ts";
import {
  ALL_EXTERNAL_CLAIMS_UNINSPECTED,
  bindRehearsalPlan,
  declareRehearsalEnvelope,
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
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.ts";

const LABEL = REHEARSAL_ONLY_LABEL;
const SCENARIO_ID = "oauth-application-reconnaissance";
const MANIFEST_SCHEMA_VERSION = 2;
const RUN_OPERATION = "run-bounded-recon-reads";
const MAX_REQUEST_BYTES = 4_096;
const MAX_FAKE_BYTES = 8_192;
const REQUEST_KEYS = [
  "schemaVersion",
  "label",
  "scenarioId",
  "planDigestSha256",
] as const;
const EXTERNAL_CLAIM_KEYS = [
  "tenantContents",
  "rawIdentities",
  "externalArtifact",
  "detectorAttribution",
  "auditCompleteness",
  "learnerVisibility",
  "learnerInterpretation",
  "permissionRestoration",
  "evidenceWindowClosure",
  "cleanup",
  "retention",
  "revocation",
  "externalImpact",
] as const;
const SYNTHETIC_READS = [
  "synthetic-directory-memberships-reachable",
  "synthetic-mailbox-folders-reachable",
  "synthetic-personal-drive-root-reachable",
  "synthetic-shared-drive-root-reachable",
] as const;
const SHA256 = /^[a-f0-9]{64}$/;

export const OAUTH_APPLICATION_RECON_REHEARSAL_CAPABILITY = {
  schemaVersion: 1,
  surface: "rehearsal-only",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: [SCENARIO_ID],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export interface OauthApplicationReconRehearsalRequest {
  schemaVersion: 1;
  label: typeof LABEL;
  scenarioId: typeof SCENARIO_ID;
  planDigestSha256: string;
}

export interface OauthApplicationReconFakeFourRead {
  execute(): Promise<unknown>;
}

export type OauthApplicationReconRehearsalFailure =
  | ScenarioPlanError["category"]
  | "ADAPTER_REFUSED"
  | "ENVELOPE_REFUSED"
  | "FAKE_ACTOR_MISMATCH"
  | "FAKE_AMBIGUOUS"
  | "FAKE_EXTERNAL_OVERCLAIM"
  | "FAKE_NONTERMINAL"
  | "FAKE_PAGINATION_UNCERTAIN"
  | "FAKE_SCENARIO_MISMATCH"
  | "FAKE_SEQUENCE"
  | "FAKE_SHAPE"
  | "FAKE_UNSAFE_INPUT"
  | "INPUT_SCHEMA"
  | "INPUT_UNSAFE"
  | "PLAN_BINDING"
  | "RECEIPT_OVERCLAIM"
  | "RECEIPT_REFUSED";

export interface OauthApplicationReconRehearsalResult {
  schemaVersion: 1;
  label: typeof LABEL;
  status: "completed" | "refused";
  failure: OauthApplicationReconRehearsalFailure | null;
  binding: Readonly<{
    scenarioId: typeof SCENARIO_ID;
    manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
    planDigestSha256: string;
    fakeResultDigestSha256: string;
  }> | null;
  stages: Readonly<{
    plan: "compiled" | "refused" | "not-run";
    fakeFourRead: "completed" | "refused" | "not-run";
    adapter: "accepted" | "refused" | "not-run";
    fakeBinding: "accepted" | "refused" | "not-run";
    receiptVerifier: "accepted" | "refused" | "not-run";
    envelope: "accepted" | "refused" | "not-run";
  }>;
  fakeRun: Readonly<{
    terminalState: "synthetic-four-read-completed";
    orderedReads: typeof SYNTHETIC_READS;
    collectionBoundary: "synthetic-complete-within-bound";
    evidenceBoundary: "synthetic-reachability-only";
    detector: "synthetic-uninspected";
    learner: "synthetic-uninspected";
    permissionRestoration: "synthetic-uninspected";
    cleanup: "synthetic-uninspected";
  }> | null;
  receipt: Readonly<{
    adapterCandidateAccepted: true;
    verifierAccepted: true;
    candidateClaimCount: number;
    syntheticReachability: "synthetic-four-read-reachability-only";
    allOtherClaims: "uninspected";
  }> | null;
  envelope: Readonly<{
    terminalState: typeof TERMINAL_COMPLETE;
    observationSource: typeof SYNTHETIC_ONLY_OBSERVATIONS;
    externalEvidence: typeof ALL_EXTERNAL_CLAIMS_UNINSPECTED;
    claims: Readonly<
      Record<typeof EXTERNAL_CLAIM_KEYS[number], "uninspected">
    >;
  }> | null;
}

export function canonicalOauthApplicationReconPlanningRequest():
  ScenarioPlanningRequest {
  const expiresAt = OAUTH_APPLICATION_RECON_SCENARIO.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      OAUTH_APPLICATION_RECON_SCENARIO.cost.conservativeDurationHours *
        3_600_000,
  ).toISOString();
  return {
    scenarioId: SCENARIO_ID,
    actorAliases: {
      evidenceProducer: "harness",
      workloadActor: "workload",
      learner: "learner",
      detector: "observer",
      cleanupOwner: "harness",
    },
    now,
    expiresAt,
    maximumBudgetUsd: OAUTH_APPLICATION_RECON_SCENARIO.cost.laneMaximum,
  };
}

export function compileOauthApplicationReconRehearsalPlan():
  ScenarioExecutionPlan {
  const plan = compileScenarioExecutionPlan(
    canonicalOauthApplicationReconPlanningRequest(),
  );
  const workloadStep = plan.steps.find(
    ({ operationKey }) => operationKey === RUN_OPERATION,
  );
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.selectedResponseId !== null ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    !sameStrings(plan.terminalProof.cleanupOperationKeys, [
      "close-evidence-window",
    ]) ||
    !sameStrings(plan.terminalProof.evidenceArtifactIds, [
      "application-recon-summary",
    ]) ||
    !sameStrings(plan.terminalProof.observationOperationKeys, [
      "observe-bounded-sign-in",
    ]) ||
    plan.terminalProof.retainedArtifactIds.length !== 0 ||
    workloadStep?.owningRole !== "workloadActor" ||
    workloadStep.actorAlias !== "workload" ||
    workloadStep.operationCategory !== "artifact.read-exact" ||
    workloadStep.execution !== "automated"
  ) {
    throw new RehearsalError("PLAN_BINDING");
  }
  return plan;
}

export function canonicalOauthApplicationReconRehearsalRequest():
  OauthApplicationReconRehearsalRequest {
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    planDigestSha256:
      compileOauthApplicationReconRehearsalPlan().digestSha256,
  };
}

export function createDeterministicOauthApplicationReconFakeFourRead():
  OauthApplicationReconFakeFourRead {
  return {
    async execute(): Promise<OauthApplicationReconReceiptAdapterInput> {
      return canonicalOauthApplicationReconReceiptAdapterInput();
    },
  };
}

export async function runOauthApplicationReconRehearsal(
  value: unknown,
  fake: OauthApplicationReconFakeFourRead,
): Promise<OauthApplicationReconRehearsalResult> {
  const unsafeRequest = inspectBoundedRehearsalValue(
    value,
    MAX_REQUEST_BYTES,
  );
  if (unsafeRequest !== null) {
    return refused(
      unsafeRequest === "UNSAFE_CONTENT" ? "INPUT_UNSAFE" : "INPUT_SCHEMA",
      "plan",
    );
  }

  let request: OauthApplicationReconRehearsalRequest;
  try {
    request = parseRequest(value);
  } catch {
    return refused("INPUT_SCHEMA", "plan");
  }

  let plan: ScenarioExecutionPlan;
  try {
    plan = compileOauthApplicationReconRehearsalPlan();
  } catch (error) {
    return refused(failureCategory(error, "PLAN_BINDING"), "plan");
  }
  const boundPlan = bindRehearsalPlan({
    scenarioId: plan.scenarioId,
    expectedScenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    expectedManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: request.planDigestSha256,
    expectedPlanDigestSha256: plan.digestSha256,
  });
  if (!boundPlan.ok) return refused("PLAN_BINDING", "plan");

  let fakeValue: unknown;
  try {
    fakeValue = await fake.execute();
  } catch {
    return refused("FAKE_NONTERMINAL", "fakeFourRead");
  }
  if (!isBoundedJson(fakeValue, MAX_FAKE_BYTES)) {
    return refused("FAKE_SHAPE", "fakeFourRead");
  }
  const terminalFailure = fakeTerminalFailure(fakeValue);
  if (terminalFailure !== null) {
    return refused(terminalFailure, "fakeFourRead");
  }

  let receipt;
  try {
    receipt = adaptOauthApplicationReconToReceipt(fakeValue);
  } catch (error) {
    return refused(failureCategory(error, "ADAPTER_REFUSED"), "adapter");
  }

  const fakeRun = safeFakeBinding(fakeValue);
  if (fakeRun === null) {
    return refused(
      hasExternalObservation(fakeValue)
        ? "FAKE_EXTERNAL_OVERCLAIM"
        : "ADAPTER_REFUSED",
      "fakeBinding",
    );
  }

  try {
    verifyCanonicalScenarioEvidenceReceipt(receipt);
  } catch {
    return refused("RECEIPT_REFUSED", "receiptVerifier");
  }
  const provenClaims = receipt.claims.filter(({ state }) => state === "proven");
  if (
    provenClaims.length !== 1 ||
    provenClaims[0]?.id !== `operation-${RUN_OPERATION}` ||
    receipt.claims.some((claim) =>
      claim.id !== `operation-${RUN_OPERATION}` &&
      claim.state !== "uninspected"
    )
  ) {
    return refused("RECEIPT_OVERCLAIM", "receiptVerifier");
  }

  const externalClaims = Object.fromEntries(
    EXTERNAL_CLAIM_KEYS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIM_KEYS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: LABEL,
    status: "completed",
    failure: null,
    syntheticValues: [
      fakeRun.terminalState,
      ...fakeRun.orderedReads,
      fakeRun.collectionBoundary,
      fakeRun.evidenceBoundary,
      fakeRun.detector,
      fakeRun.learner,
      fakeRun.permissionRestoration,
      fakeRun.cleanup,
    ],
    externalClaims: {
      total: EXTERNAL_CLAIM_KEYS.length,
      uninspected: EXTERNAL_CLAIM_KEYS.length,
      nonUninspected: 0,
    },
  });
  if (!declaration.ok) return refused("ENVELOPE_REFUSED", "envelope");

  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "completed",
    failure: null,
    binding: {
      scenarioId: SCENARIO_ID,
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      planDigestSha256: boundPlan.value.planDigestSha256,
      fakeResultDigestSha256: digest(fakeValue),
    },
    stages: {
      plan: "compiled",
      fakeFourRead: "completed",
      adapter: "accepted",
      fakeBinding: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    fakeRun,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: receipt.claims.length,
      syntheticReachability: "synthetic-four-read-reachability-only",
      allOtherClaims: "uninspected",
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
      claims: externalClaims,
    },
  });
}

function parseRequest(value: unknown): OauthApplicationReconRehearsalRequest {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(REQUEST_KEYS) ||
    value.schemaVersion !== 1 ||
    value.label !== LABEL ||
    value.scenarioId !== SCENARIO_ID ||
    typeof value.planDigestSha256 !== "string" ||
    !SHA256.test(value.planDigestSha256)
  ) {
    throw new RehearsalError("INPUT_SCHEMA");
  }
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    planDigestSha256: value.planDigestSha256,
  };
}

function fakeTerminalFailure(
  value: unknown,
): "FAKE_AMBIGUOUS" | "FAKE_NONTERMINAL" | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  if (value.result.outcome === "ambiguous") return "FAKE_AMBIGUOUS";
  return value.result.outcome === "completed" ? null : "FAKE_NONTERMINAL";
}

function hasExternalObservation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["detector", "learner", "cleanup"].some((key) =>
    isRecord(value[key]) && value[key].state !== "uninspected"
  );
}

function safeFakeBinding(
  value: unknown,
): OauthApplicationReconRehearsalResult["fakeRun"] {
  if (
    canonicalJson(value) !== canonicalJson(
      canonicalOauthApplicationReconReceiptAdapterInput(),
    )
  ) {
    return null;
  }
  return {
    terminalState: "synthetic-four-read-completed",
    orderedReads: SYNTHETIC_READS,
    collectionBoundary: "synthetic-complete-within-bound",
    evidenceBoundary: "synthetic-reachability-only",
    detector: "synthetic-uninspected",
    learner: "synthetic-uninspected",
    permissionRestoration: "synthetic-uninspected",
    cleanup: "synthetic-uninspected",
  };
}

function refused(
  failure: OauthApplicationReconRehearsalFailure,
  stage:
    | "plan"
    | "fakeFourRead"
    | "adapter"
    | "fakeBinding"
    | "receiptVerifier"
    | "envelope",
): OauthApplicationReconRehearsalResult {
  const planCompiled = stage !== "plan";
  const fakeCompleted = planCompiled && stage !== "fakeFourRead";
  const adapterAccepted = fakeCompleted && stage !== "adapter";
  const bindingAccepted = adapterAccepted && stage !== "fakeBinding";
  const verifierAccepted = bindingAccepted && stage !== "receiptVerifier";
  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "refused",
    failure,
    binding: null,
    stages: {
      plan: stage === "plan" ? "refused" : "compiled",
      fakeFourRead: !planCompiled
        ? "not-run"
        : stage === "fakeFourRead"
        ? "refused"
        : "completed",
      adapter: !fakeCompleted
        ? "not-run"
        : stage === "adapter"
        ? "refused"
        : "accepted",
      fakeBinding: !adapterAccepted
        ? "not-run"
        : stage === "fakeBinding"
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
    fakeRun: null,
    receipt: null,
    envelope: null,
  });
}

function failureCategory(
  error: unknown,
  fallback: OauthApplicationReconRehearsalFailure,
): OauthApplicationReconRehearsalFailure {
  if (error instanceof ScenarioPlanError) return error.category;
  if (error instanceof OauthReconReceiptAdapterError) {
    const categories = {
      shape: "FAKE_SHAPE",
      "unsafe-input": "FAKE_UNSAFE_INPUT",
      "scenario-mismatch": "FAKE_SCENARIO_MISMATCH",
      sequence: "FAKE_SEQUENCE",
      "workload-mismatch": "FAKE_NONTERMINAL",
      "pagination-uncertain": "FAKE_PAGINATION_UNCERTAIN",
      "actor-mismatch": "FAKE_ACTOR_MISMATCH",
      "detector-mismatch": "FAKE_EXTERNAL_OVERCLAIM",
      "stale-observation": "FAKE_EXTERNAL_OVERCLAIM",
      "learner-overclaim": "FAKE_EXTERNAL_OVERCLAIM",
      "cleanup-gap": "FAKE_EXTERNAL_OVERCLAIM",
      "semantic-overclaim": "FAKE_EXTERNAL_OVERCLAIM",
    } as const;
    return categories[error.code];
  }
  if (error instanceof RehearsalError) return error.failure;
  return fallback;
}

class RehearsalError extends Error {
  readonly failure: OauthApplicationReconRehearsalFailure;

  constructor(failure: OauthApplicationReconRehearsalFailure) {
    super(failure);
    this.name = "OauthApplicationReconRehearsalError";
    this.failure = failure;
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function isBoundedJson(value: unknown, maximumBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined &&
      new TextEncoder().encode(serialized).byteLength <= maximumBytes;
  } catch {
    return false;
  }
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
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
