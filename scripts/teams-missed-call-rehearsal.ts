import { createHash } from "node:crypto";
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
  verifyScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "../src/scenarios/scenario-plan.ts";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.ts";
import {
  adaptTeamsMissedCallObservationToReceipt,
  canonicalTeamsMissedCallReceiptAdapterInput,
  TeamsMissedCallReceiptAdapterError,
  type TeamsMissedCallReceiptAdapterInput,
} from "../src/scenarios/teams-missed-call-receipt-adapter.ts";
import { TEAMS_MISSED_CALL_SCENARIO } from
  "../src/scenarios/teams-missed-call.ts";

const LABEL = REHEARSAL_ONLY_LABEL;
const SCENARIO_ID = "teams-missed-call-observation";
const MANIFEST_SCHEMA_VERSION = 2;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_FAKE_BYTES = 8 * 1024;
const REQUEST_KEYS = [
  "schemaVersion",
  "label",
  "scenarioId",
  "syntheticBranch",
] as const;
const EXTERNAL_CLAIM_KEYS = [
  "liveCall",
  "nativeMissedCallArtifact",
  "activityItem",
  "learnerVisibility",
  "learnerInterpretation",
  "response",
  "cleanup",
  "retention",
  "voicemail",
  "callback",
  "botPath",
  "externalIdentity",
  "externalProof",
] as const;

export const TEAMS_MISSED_CALL_REHEARSAL_CAPABILITY = {
  schemaVersion: 1,
  surface: "rehearsal-only",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: [SCENARIO_ID],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type TeamsMissedCallSyntheticBranch =
  | "stage-only"
  | "native-retained"
  | "reported-retained"
  | "native-cleaned";

export interface TeamsMissedCallRehearsalRequest {
  schemaVersion: 1;
  label: typeof LABEL;
  scenarioId: typeof SCENARIO_ID;
  syntheticBranch: TeamsMissedCallSyntheticBranch;
}

export interface TeamsMissedCallFakeLifecycle {
  execute(branch: TeamsMissedCallSyntheticBranch): Promise<unknown>;
}

export type TeamsMissedCallRehearsalFailure =
  | ScenarioPlanError["category"]
  | "ENVELOPE_REFUSED"
  | "FAKE_CLEANUP_GAP"
  | "FAKE_NONTERMINAL"
  | "FAKE_OBSERVATION_MISMATCH"
  | "FAKE_OUTCOME_MISMATCH"
  | "FAKE_ROLE_CONFLATION"
  | "FAKE_SCENARIO_MISMATCH"
  | "FAKE_SEMANTIC_OVERCLAIM"
  | "FAKE_SEQUENCE"
  | "FAKE_SHAPE"
  | "FAKE_UNSAFE_INPUT"
  | "INPUT_SCHEMA"
  | "INPUT_UNSAFE"
  | "PLAN_BINDING"
  | "RECEIPT_REFUSED";

export interface TeamsMissedCallRehearsalResult {
  schemaVersion: 1;
  label: typeof LABEL;
  status: "completed" | "refused";
  failure: TeamsMissedCallRehearsalFailure | null;
  binding: Readonly<{
    scenarioId: typeof SCENARIO_ID;
    manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
    planDigestSha256: string;
    fakeRunDigestSha256: string;
    syntheticBranch: TeamsMissedCallSyntheticBranch;
  }> | null;
  stages: Readonly<{
    plan: "compiled" | "refused" | "not-run";
    fakeLifecycle: "completed" | "refused" | "not-run";
    adapter: "accepted" | "refused" | "not-run";
    receiptVerifier: "accepted" | "refused" | "not-run";
    envelope: "accepted" | "refused" | "not-run";
  }>;
  fakeRun: Readonly<{
    stage: "synthetic-one-attempt-completed";
    nativeHistory:
      | "synthetic-uninspected"
      | "synthetic-one-missed-incoming";
    activity:
      | "synthetic-uninspected"
      | "synthetic-one-matching-notification";
    report: "synthetic-uninspected" | "synthetic-reported";
    retention: "synthetic-uninspected" | "synthetic-retained" |
      "synthetic-absent";
    terminalCleanup:
      | "synthetic-uninspected"
      | "synthetic-two-surface-absent";
  }> | null;
  receipt: Readonly<{
    adapterCandidateAccepted: true;
    verifierAccepted: true;
    candidateClaimCount: number;
    canonicalLearnerInterpretation: "uninspected";
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

export function canonicalTeamsMissedCallRehearsalRequest(
  syntheticBranch: TeamsMissedCallSyntheticBranch = "stage-only",
): TeamsMissedCallRehearsalRequest {
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    syntheticBranch,
  };
}

export function canonicalTeamsMissedCallPlanningRequest(
  syntheticBranch: TeamsMissedCallSyntheticBranch = "stage-only",
): ScenarioPlanningRequest {
  const expiresAt = TEAMS_MISSED_CALL_SCENARIO.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      TEAMS_MISSED_CALL_SCENARIO.cost.conservativeDurationHours * 3_600_000,
  ).toISOString();
  return {
    scenarioId: SCENARIO_ID,
    actorAliases: {
      evidenceProducer: "instructor",
      workloadActor: "caller",
      learner: "observer",
      cleanupOwner: "instructor",
    },
    now,
    expiresAt,
    maximumBudgetUsd: TEAMS_MISSED_CALL_SCENARIO.cost.laneMaximum,
    ...(syntheticBranch === "reported-retained"
      ? { selectedResponseId: "report-observation" }
      : {}),
  };
}

export function compileTeamsMissedCallRehearsalPlan(
  syntheticBranch: TeamsMissedCallSyntheticBranch = "stage-only",
): ScenarioExecutionPlan {
  const plan = compileScenarioExecutionPlan(
    canonicalTeamsMissedCallPlanningRequest(syntheticBranch),
  );
  const expectsReport = syntheticBranch === "reported-retained";
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.selectedResponseId !==
      (expectsReport ? "report-observation" : null) ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    !sameStrings(
      plan.terminalProof.cleanupOperationKeys,
      TEAMS_MISSED_CALL_SCENARIO.lifecycle.cleanupOperationKeys,
    )
  ) {
    throw new RehearsalError("PLAN_BINDING");
  }
  return plan;
}

export function createDeterministicTeamsMissedCallFakeLifecycle():
  TeamsMissedCallFakeLifecycle {
  return {
    async execute(
      branch: TeamsMissedCallSyntheticBranch,
    ): Promise<TeamsMissedCallReceiptAdapterInput> {
      return fakeInput(branch);
    },
  };
}

export async function runTeamsMissedCallRehearsal(
  value: unknown,
  lifecycle: TeamsMissedCallFakeLifecycle,
): Promise<TeamsMissedCallRehearsalResult> {
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

  let request: TeamsMissedCallRehearsalRequest;
  try {
    request = parseRequest(value);
  } catch {
    return refused("INPUT_SCHEMA", "plan");
  }

  let plan: ScenarioExecutionPlan;
  try {
    plan = compileTeamsMissedCallRehearsalPlan(request.syntheticBranch);
  } catch (error) {
    return refused(failureCategory(error, "PLAN_BINDING"), "plan");
  }

  const boundPlan = bindRehearsalPlan({
    scenarioId: plan.scenarioId,
    expectedScenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    expectedManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: plan.digestSha256,
    expectedPlanDigestSha256: plan.digestSha256,
  });
  if (!boundPlan.ok) return refused("PLAN_BINDING", "plan");

  let fakeValue: unknown;
  try {
    fakeValue = await lifecycle.execute(request.syntheticBranch);
  } catch {
    return refused("FAKE_NONTERMINAL", "fakeLifecycle");
  }
  const unsafeFake = inspectBoundedRehearsalValue(fakeValue, MAX_FAKE_BYTES);
  if (unsafeFake !== null) {
    return refused(
      unsafeFake === "UNSAFE_CONTENT"
        ? "FAKE_UNSAFE_INPUT"
        : "FAKE_SHAPE",
      "fakeLifecycle",
    );
  }

  let receipt;
  try {
    receipt = adaptTeamsMissedCallObservationToReceipt(fakeValue);
  } catch (error) {
    return refused(failureCategory(error, "FAKE_SHAPE"), "adapter");
  }

  const fakeRun = safeFakeBinding(fakeValue, request.syntheticBranch);
  if (fakeRun === null) {
    return refused("FAKE_OUTCOME_MISMATCH", "binding");
  }

  try {
    verifyScenarioEvidenceReceipt(receipt, TEAMS_MISSED_CALL_SCENARIO);
  } catch {
    return refused("RECEIPT_REFUSED", "receiptVerifier");
  }
  const interpretation = receipt.claims.find(
    ({ id }) => id === "learner-interpretation",
  );
  if (interpretation?.state !== "uninspected") {
    return refused("RECEIPT_REFUSED", "receiptVerifier");
  }

  const externalClaims = Object.fromEntries(
    EXTERNAL_CLAIM_KEYS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIM_KEYS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: LABEL,
    status: "completed",
    failure: null,
    syntheticValues: Object.values(fakeRun),
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
      fakeRunDigestSha256: digest(fakeValue),
      syntheticBranch: request.syntheticBranch,
    },
    stages: {
      plan: "compiled",
      fakeLifecycle: "completed",
      adapter: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    fakeRun,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: receipt.claims.length,
      canonicalLearnerInterpretation: "uninspected",
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
      claims: externalClaims,
    },
  } satisfies TeamsMissedCallRehearsalResult);
}

function fakeInput(
  branch: TeamsMissedCallSyntheticBranch,
): TeamsMissedCallReceiptAdapterInput {
  const input = structuredClone(
    canonicalTeamsMissedCallReceiptAdapterInput(),
  );
  if (branch !== "stage-only") {
    input.nativeObservation = {
      state: "observed",
      observerRole: "learner",
      operation: "read-cory-call-history",
      history: "one-missed-incoming",
      activity: "one-matching-notification",
      authenticity: "platform-native",
    };
  }
  if (branch === "reported-retained") {
    input.interpretation = {
      state: "reported",
      observerRole: "learner",
      operation: "interpret-missed-call",
      responseAction: "report-observation",
      conclusion: "missed-teams-call-without-voicemail",
    };
  }
  if (branch === "native-cleaned") {
    input.cleanup = {
      state: "cleaned",
      mutationObserverRole: "evidenceProducer",
      mutationOperation: "clean-retained-call-history",
      terminalObserverRole: "learner",
      terminalOperation: "read-cory-call-history",
      history: "absent",
      activity: "absent",
      retention: "absent",
    };
  }
  return input;
}

function safeFakeBinding(
  value: unknown,
  branch: TeamsMissedCallSyntheticBranch,
): TeamsMissedCallRehearsalResult["fakeRun"] {
  if (canonicalJson(value) !== canonicalJson(fakeInput(branch))) return null;
  return {
    stage: "synthetic-one-attempt-completed",
    nativeHistory: branch === "stage-only"
      ? "synthetic-uninspected"
      : "synthetic-one-missed-incoming",
    activity: branch === "stage-only"
      ? "synthetic-uninspected"
      : "synthetic-one-matching-notification",
    report: branch === "reported-retained"
      ? "synthetic-reported"
      : "synthetic-uninspected",
    retention: branch === "stage-only"
      ? "synthetic-uninspected"
      : branch === "native-cleaned"
      ? "synthetic-absent"
      : "synthetic-retained",
    terminalCleanup: branch === "native-cleaned"
      ? "synthetic-two-surface-absent"
      : "synthetic-uninspected",
  };
}

function parseRequest(value: unknown): TeamsMissedCallRehearsalRequest {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(REQUEST_KEYS) ||
    value.schemaVersion !== 1 ||
    value.label !== LABEL ||
    value.scenarioId !== SCENARIO_ID ||
    ![
      "stage-only",
      "native-retained",
      "reported-retained",
      "native-cleaned",
    ].includes(String(value.syntheticBranch))
  ) {
    throw new RehearsalError("INPUT_SCHEMA");
  }
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    syntheticBranch: value.syntheticBranch as TeamsMissedCallSyntheticBranch,
  };
}

function refused(
  failure: TeamsMissedCallRehearsalFailure,
  stage:
    | "plan"
    | "fakeLifecycle"
    | "adapter"
    | "binding"
    | "receiptVerifier"
    | "envelope",
): TeamsMissedCallRehearsalResult {
  const beforeFake = stage === "plan";
  const beforeAdapter = beforeFake || stage === "fakeLifecycle";
  const beforeVerifier = beforeAdapter || stage === "adapter" ||
    stage === "binding";
  const stages: TeamsMissedCallRehearsalResult["stages"] = {
    plan: stage === "plan" ? "refused" : "compiled",
    fakeLifecycle: beforeFake
      ? "not-run"
      : stage === "fakeLifecycle"
      ? "refused"
      : "completed",
    adapter: beforeAdapter
      ? "not-run"
      : stage === "adapter" || stage === "binding"
      ? "refused"
      : "accepted",
    receiptVerifier: beforeVerifier
      ? "not-run"
      : stage === "receiptVerifier"
      ? "refused"
      : "accepted",
    envelope: stage === "envelope"
      ? "refused"
      : "not-run",
  };
  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "refused",
    failure,
    binding: null,
    stages,
    fakeRun: null,
    receipt: null,
    envelope: null,
  });
}

function failureCategory(
  error: unknown,
  fallback: TeamsMissedCallRehearsalFailure,
): TeamsMissedCallRehearsalFailure {
  if (error instanceof ScenarioPlanError) return error.category;
  if (error instanceof TeamsMissedCallReceiptAdapterError) {
    const categories = {
      shape: "FAKE_SHAPE",
      "unsafe-input": "FAKE_UNSAFE_INPUT",
      "scenario-mismatch": "FAKE_SCENARIO_MISMATCH",
      sequence: "FAKE_SEQUENCE",
      "stage-outcome": "FAKE_NONTERMINAL",
      "observation-mismatch": "FAKE_OBSERVATION_MISMATCH",
      "role-conflation": "FAKE_ROLE_CONFLATION",
      "cleanup-gap": "FAKE_CLEANUP_GAP",
      "semantic-overclaim": "FAKE_SEMANTIC_OVERCLAIM",
    } as const;
    return categories[error.code];
  }
  if (error instanceof RehearsalError) return error.failure;
  return fallback;
}

class RehearsalError extends Error {
  readonly failure: TeamsMissedCallRehearsalFailure;

  constructor(failure: TeamsMissedCallRehearsalFailure) {
    super(failure);
    this.name = "TeamsMissedCallRehearsalError";
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
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
