import { createHash } from "node:crypto";
import type {
  HelpDeskScenarioOperation,
  HelpDeskScenarioResult,
} from "../api/help-desk-scenario.ts";
import { HELP_DESK_EMAIL_SCENARIO } from
  "../src/scenarios/help-desk-email.ts";
import {
  adaptHelpDeskEmailOperationToReceipt,
  HelpDeskEmailReceiptAdapterError,
  type HelpDeskEmailReceiptAdapterInput,
} from "../src/scenarios/help-desk-email-receipt-adapter.ts";
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

const LABEL = REHEARSAL_ONLY_LABEL;
const SCENARIO_ID = "help-desk-email-observation";
const MANIFEST_SCHEMA_VERSION = 2;
const MAX_REQUEST_BYTES = 4_096;
const MAX_OUTPUT_BYTES = 32_768;
const SYNTHETIC_SENDER =
  "synthetic-sender" as HelpDeskScenarioResult["sender"];
const SYNTHETIC_RECIPIENT =
  "synthetic-learner" as HelpDeskScenarioResult["recipient"];
const SYNTHETIC_SUBJECT =
  "synthetic-fixed-email" as HelpDeskScenarioResult["subject"];
const BRANCHES = [
  "send-accepted",
  "learner-observed-retained",
  "learner-observed-cleaned",
] as const;
const EXTERNAL_CLAIM_KEYS = [
  "emailSend",
  "inboxVisibility",
  "learnerInterpretation",
  "response",
  "cleanup",
  "retention",
  "auditOrDetection",
  "teamsCall",
  "voicemail",
] as const;

export const HELP_DESK_EMAIL_REHEARSAL_CAPABILITY = {
  schemaVersion: 1,
  surface: "rehearsal-only",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: [SCENARIO_ID],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type HelpDeskEmailSyntheticBranch = typeof BRANCHES[number];

export interface HelpDeskEmailRehearsalRequest {
  schemaVersion: 1;
  label: typeof LABEL;
  scenarioId: typeof SCENARIO_ID;
  syntheticBranch: HelpDeskEmailSyntheticBranch;
}

export interface HelpDeskEmailFakeLifecycle {
  execute(branch: HelpDeskEmailSyntheticBranch): Promise<unknown>;
}

export type HelpDeskEmailRehearsalFailure =
  | ScenarioPlanError["category"]
  | "ADAPTER_REFUSED"
  | "CLEANUP_GAP"
  | "ENVELOPE_REFUSED"
  | "EVIDENCE_OVERCLAIM"
  | "FAKE_NONTERMINAL"
  | "FAKE_OUTCOME_MISMATCH"
  | "FAKE_SEQUENCE"
  | "FAKE_UNSAFE_INPUT"
  | "INPUT_SCHEMA"
  | "PLAN_BINDING"
  | "RECEIPT_REFUSED"
  | "SYNTHETIC_BRANCH_MISMATCH";

export interface HelpDeskEmailRehearsalResult {
  schemaVersion: 1;
  label: typeof LABEL;
  status: "completed" | "refused";
  failure: HelpDeskEmailRehearsalFailure | null;
  binding: Readonly<{
    scenarioId: typeof SCENARIO_ID;
    manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
    planDigestSha256: string;
    fakeRunDigestSha256: string;
    syntheticBranch: HelpDeskEmailSyntheticBranch;
  }> | null;
  stages: Readonly<{
    plan: "compiled" | "refused" | "not-run";
    fakeOperation: "completed" | "refused" | "not-run";
    adapter: "accepted" | "refused" | "not-run";
    fakeBinding: "accepted" | "refused" | "not-run";
    receiptVerifier: "accepted" | "refused" | "not-run";
    envelope: "accepted" | "refused" | "not-run";
  }>;
  envelope: Readonly<{
    terminalState: typeof TERMINAL_COMPLETE;
    observationSource: typeof SYNTHETIC_ONLY_OBSERVATIONS;
    externalEvidence: typeof ALL_EXTERNAL_CLAIMS_UNINSPECTED;
  }> | null;
  fakeRun: Readonly<{
    operationAttempts: 1;
    journalEntries: 2;
    send: "synthetic-accepted";
    learnerVisibility:
      | "synthetic-uninspected"
      | "synthetic-observed";
    learnerInterpretation: "synthetic-uninspected";
    retention:
      | "synthetic-uninspected"
      | "synthetic-retained"
      | "synthetic-absent";
    cleanup:
      | "synthetic-uninspected"
      | "synthetic-cleaned";
    auditOrDetection: "synthetic-uninspected";
    teamsCall: "synthetic-uninspected";
    voicemail: "synthetic-uninspected";
    terminalState:
      | "synthetic-send-accepted"
      | "synthetic-learner-observed-retained"
      | "synthetic-learner-observed-cleaned";
  }> | null;
  receipt: Readonly<{
    adapterCandidateAccepted: true;
    verifierAccepted: true;
    candidateClaimCount: number;
    externalEvidence: Readonly<
      Record<typeof EXTERNAL_CLAIM_KEYS[number], "uninspected">
    >;
  }> | null;
}

export function canonicalHelpDeskEmailRehearsalRequest(
  syntheticBranch: HelpDeskEmailSyntheticBranch = "send-accepted",
): HelpDeskEmailRehearsalRequest {
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    syntheticBranch,
  };
}

export function canonicalHelpDeskEmailPlanningRequest():
  ScenarioPlanningRequest {
  const expiresAt = HELP_DESK_EMAIL_SCENARIO.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      HELP_DESK_EMAIL_SCENARIO.cost.conservativeDurationHours * 3_600_000,
  ).toISOString();
  return {
    scenarioId: SCENARIO_ID,
    actorAliases: {
      evidenceProducer: "orchestrator",
      workloadActor: "sender",
      learner: "learner",
      cleanupOwner: "orchestrator",
    },
    now,
    expiresAt,
    maximumBudgetUsd: HELP_DESK_EMAIL_SCENARIO.cost.laneMaximum,
  };
}

export function compileHelpDeskEmailRehearsalPlan():
  ScenarioExecutionPlan {
  const plan = compileScenarioExecutionPlan(
    canonicalHelpDeskEmailPlanningRequest(),
  );
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.selectedResponseId !== null ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    !sameStrings(
      plan.terminalProof.cleanupOperationKeys,
      HELP_DESK_EMAIL_SCENARIO.lifecycle.cleanupOperationKeys,
    ) ||
    !sameStrings(
      plan.terminalProof.evidenceArtifactIds,
      HELP_DESK_EMAIL_SCENARIO.evidence.artifacts.map(({ id }) => id),
    )
  ) {
    throw new RehearsalError("PLAN_BINDING");
  }
  return plan;
}

export function createDeterministicHelpDeskEmailFakeLifecycle():
  HelpDeskEmailFakeLifecycle {
  return new DeterministicHelpDeskEmailFakeLifecycle(
    new DeterministicHelpDeskScenarioOperation(),
  );
}

export async function runHelpDeskEmailRehearsal(
  value: unknown,
  lifecycle: HelpDeskEmailFakeLifecycle,
): Promise<HelpDeskEmailRehearsalResult> {
  let request: HelpDeskEmailRehearsalRequest;
  try {
    request = parseRequest(value);
  } catch {
    return refused("INPUT_SCHEMA", "plan");
  }

  let plan: ScenarioExecutionPlan;
  try {
    plan = compileHelpDeskEmailRehearsalPlan();
  } catch (error) {
    return refused(failureCategory(error, "PLAN_BINDING"), "plan");
  }

  let fakeValue: unknown;
  try {
    fakeValue = await lifecycle.execute(request.syntheticBranch);
  } catch {
    return refused("FAKE_NONTERMINAL", "fakeOperation");
  }

  let receipt;
  try {
    receipt = adaptHelpDeskEmailOperationToReceipt(fakeValue);
  } catch (error) {
    return refused(adapterFailure(error), "adapter");
  }

  const fakeRun = safeFakeRun(fakeValue, request.syntheticBranch);
  if (fakeRun === null) {
    return refused("SYNTHETIC_BRANCH_MISMATCH", "fakeBinding");
  }

  try {
    verifyScenarioEvidenceReceipt(receipt, HELP_DESK_EMAIL_SCENARIO);
  } catch {
    return refused("RECEIPT_REFUSED", "receiptVerifier");
  }

  const planBinding = bindRehearsalPlan({
    scenarioId: plan.scenarioId,
    expectedScenarioId: SCENARIO_ID,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    expectedManifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    planDigestSha256: plan.digestSha256,
    expectedPlanDigestSha256: plan.digestSha256,
  });
  if (!planBinding.ok) {
    return refused("PLAN_BINDING", "envelope");
  }

  const externalEvidence = Object.fromEntries(
    EXTERNAL_CLAIM_KEYS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIM_KEYS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: LABEL,
    status: "completed",
    failure: null,
    syntheticValues: [
      fakeRun.send,
      fakeRun.learnerVisibility,
      fakeRun.learnerInterpretation,
      fakeRun.retention,
      fakeRun.cleanup,
      fakeRun.auditOrDetection,
      fakeRun.teamsCall,
      fakeRun.voicemail,
      fakeRun.terminalState,
    ],
    externalClaims: {
      total: EXTERNAL_CLAIM_KEYS.length,
      uninspected: EXTERNAL_CLAIM_KEYS.length,
      nonUninspected: 0,
    },
  });
  if (!declaration.ok) {
    return refused("ENVELOPE_REFUSED", "envelope");
  }

  const result = {
    schemaVersion: 1,
    label: LABEL,
    status: "completed",
    failure: null,
    binding: {
      scenarioId: SCENARIO_ID,
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      planDigestSha256: planBinding.value.planDigestSha256,
      fakeRunDigestSha256: digestFakeRun(fakeValue),
      syntheticBranch: request.syntheticBranch,
    },
    stages: {
      plan: "compiled",
      fakeOperation: "completed",
      adapter: "accepted",
      fakeBinding: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
    },
    fakeRun,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: receipt.claims.length,
      externalEvidence,
    },
  } satisfies HelpDeskEmailRehearsalResult;
  if (inspectBoundedRehearsalValue(result, MAX_OUTPUT_BYTES) !== null) {
    return refused("ENVELOPE_REFUSED", "envelope");
  }
  return deepFreeze(result);
}

class DeterministicHelpDeskScenarioOperation
  implements HelpDeskScenarioOperation {
  #attempted = false;

  async send(): Promise<HelpDeskScenarioResult> {
    if (this.#attempted) {
      throw new Error("Synthetic operation was already attempted.");
    }
    this.#attempted = true;
    return {
      accepted: true,
      artifact: "outlook-email",
      sender: SYNTHETIC_SENDER,
      recipient: SYNTHETIC_RECIPIENT,
      subject: SYNTHETIC_SUBJECT,
      platformClaims: ["email"],
    };
  }
}

class DeterministicHelpDeskEmailFakeLifecycle
  implements HelpDeskEmailFakeLifecycle {
  readonly #operation: HelpDeskScenarioOperation;

  constructor(operation: HelpDeskScenarioOperation) {
    this.#operation = operation;
  }

  async execute(
    branch: HelpDeskEmailSyntheticBranch,
  ): Promise<HelpDeskEmailReceiptAdapterInput> {
    const result = await this.#operation.send();
    assertExactFakeOperationResult(result);
    return adapterInputForBranch(branch);
  }
}

function assertExactFakeOperationResult(
  result: HelpDeskScenarioResult,
): void {
  if (
    result.accepted !== true ||
    result.artifact !== "outlook-email" ||
    result.sender !== SYNTHETIC_SENDER ||
    result.recipient !== SYNTHETIC_RECIPIENT ||
    result.subject !== SYNTHETIC_SUBJECT ||
    result.platformClaims.length !== 1 ||
    result.platformClaims[0] !== "email"
  ) {
    throw new RehearsalError("FAKE_OUTCOME_MISMATCH");
  }
}

function adapterInputForBranch(
  branch: HelpDeskEmailSyntheticBranch,
): HelpDeskEmailReceiptAdapterInput {
  const learnerObserved = branch !== "send-accepted";
  const cleaned = branch === "learner-observed-cleaned";
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    result: {
      operation: "send-help-desk-email",
      outcome: "accepted",
      observerRole: "evidenceProducer",
      semanticBoundary: "email-only",
    },
    journal: [
      {
        sequence: 1,
        operation: "send-help-desk-email",
        transition: "attempted",
      },
      {
        sequence: 2,
        operation: "send-help-desk-email",
        transition: "accepted",
      },
    ],
    learner: {
      artifact: learnerObserved
        ? {
          state: "observed",
          observerRole: "learner",
          operation: "read-marker-after",
          artifact: "outlook-email",
        }
        : { state: "uninspected" },
      interpretation: { state: "uninspected" },
    },
    cleanup: cleaned
      ? {
        state: "cleaned",
        mutationObserverRole: "evidenceProducer",
        mutationOperation: "delete-retained-help-desk-email",
        terminalObserverRole: "learner",
        terminalOperation: "read-marker-after",
        retention: "absent",
      }
      : { state: "uninspected" },
  };
}

function safeFakeRun(
  value: unknown,
  branch: HelpDeskEmailSyntheticBranch,
): NonNullable<HelpDeskEmailRehearsalResult["fakeRun"]> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as HelpDeskEmailReceiptAdapterInput;
  const learnerObserved = input.learner?.artifact?.state === "observed";
  const interpretationUninspected =
    input.learner?.interpretation?.state === "uninspected";
  const cleaned = input.cleanup?.state === "cleaned";
  const expectedLearner = branch !== "send-accepted";
  const expectedCleaned = branch === "learner-observed-cleaned";
  if (
    learnerObserved !== expectedLearner ||
    cleaned !== expectedCleaned ||
    !interpretationUninspected
  ) {
    return null;
  }
  return {
    operationAttempts: 1,
    journalEntries: 2,
    send: "synthetic-accepted",
    learnerVisibility: learnerObserved
      ? "synthetic-observed"
      : "synthetic-uninspected",
    learnerInterpretation: "synthetic-uninspected",
    retention: cleaned
      ? "synthetic-absent"
      : learnerObserved
      ? "synthetic-retained"
      : "synthetic-uninspected",
    cleanup: cleaned
      ? "synthetic-cleaned"
      : "synthetic-uninspected",
    auditOrDetection: "synthetic-uninspected",
    teamsCall: "synthetic-uninspected",
    voicemail: "synthetic-uninspected",
    terminalState: `synthetic-${branch}`,
  };
}

function parseRequest(value: unknown): HelpDeskEmailRehearsalRequest {
  if (inspectBoundedRehearsalValue(value, MAX_REQUEST_BYTES) !== null) {
    throw new RehearsalError("INPUT_SCHEMA");
  }
  const request = exactRehearsalRecord(value, [
    "schemaVersion",
    "label",
    "scenarioId",
    "syntheticBranch",
  ]);
  if (
    request === null ||
    request.schemaVersion !== 1 ||
    request.label !== LABEL ||
    request.scenarioId !== SCENARIO_ID ||
    typeof request.syntheticBranch !== "string" ||
    !BRANCHES.includes(
      request.syntheticBranch as HelpDeskEmailSyntheticBranch,
    )
  ) {
    throw new RehearsalError("INPUT_SCHEMA");
  }
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    syntheticBranch:
      request.syntheticBranch as HelpDeskEmailSyntheticBranch,
  };
}

function adapterFailure(error: unknown): HelpDeskEmailRehearsalFailure {
  if (!(error instanceof HelpDeskEmailReceiptAdapterError)) {
    return "ADAPTER_REFUSED";
  }
  switch (error.code) {
    case "unsafe-input":
      return "FAKE_UNSAFE_INPUT";
    case "sequence":
      return "FAKE_SEQUENCE";
    case "cleanup-gap":
      return "CLEANUP_GAP";
    case "semantic-overclaim":
      return "EVIDENCE_OVERCLAIM";
    case "operation-outcome":
    case "observation-mismatch":
    case "scenario-mismatch":
    case "role-conflation":
      return "FAKE_OUTCOME_MISMATCH";
    default:
      return "ADAPTER_REFUSED";
  }
}

function digestFakeRun(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function refused(
  failure: HelpDeskEmailRehearsalFailure,
  stage:
    | "plan"
    | "fakeOperation"
    | "adapter"
    | "fakeBinding"
    | "receiptVerifier"
    | "envelope",
): HelpDeskEmailRehearsalResult {
  const order = [
    "plan",
    "fakeOperation",
    "adapter",
    "fakeBinding",
    "receiptVerifier",
    "envelope",
  ] as const;
  const failedIndex = order.indexOf(stage);
  const completed = (candidate: typeof order[number]): boolean =>
    order.indexOf(candidate) < failedIndex;
  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "refused",
    failure,
    binding: null,
    stages: {
      plan: stage === "plan"
        ? "refused"
        : completed("plan") ? "compiled" : "not-run",
      fakeOperation: stage === "fakeOperation"
        ? "refused"
        : completed("fakeOperation") ? "completed" : "not-run",
      adapter: stage === "adapter"
        ? "refused"
        : completed("adapter") ? "accepted" : "not-run",
      fakeBinding: stage === "fakeBinding"
        ? "refused"
        : completed("fakeBinding") ? "accepted" : "not-run",
      receiptVerifier: stage === "receiptVerifier"
        ? "refused"
        : completed("receiptVerifier") ? "accepted" : "not-run",
      envelope: stage === "envelope"
        ? "refused"
        : completed("envelope") ? "accepted" : "not-run",
    },
    envelope: null,
    fakeRun: null,
    receipt: null,
  });
}

function failureCategory(
  error: unknown,
  fallback: HelpDeskEmailRehearsalFailure,
): HelpDeskEmailRehearsalFailure {
  if (error instanceof ScenarioPlanError) return error.category;
  if (error instanceof RehearsalError) return error.failure;
  return fallback;
}

class RehearsalError extends Error {
  readonly failure: HelpDeskEmailRehearsalFailure;

  constructor(failure: HelpDeskEmailRehearsalFailure) {
    super(failure);
    this.failure = failure;
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return JSON.stringify([...left].sort()) ===
    JSON.stringify([...right].sort());
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
