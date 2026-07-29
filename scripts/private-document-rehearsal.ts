import { createHash } from "node:crypto";
import {
  buildPrivateDocumentPlan,
  PRIVATE_DOCUMENT_FILES_READ_SCOPE,
  PRIVATE_DOCUMENT_FILES_READ_WRITE_SCOPE,
  PrivateDocumentEvidenceRunner,
  type PrivateDocumentClock,
  type PrivateDocumentJournal,
  type PrivateDocumentJournalEntry,
  type PrivateDocumentMutation,
  type PrivateDocumentMutationOutcome,
  type PrivateDocumentObservation,
  type PrivateDocumentRead,
  type PrivateDocumentReconciliation,
  type PrivateDocumentRunResult,
  type PrivateDocumentState,
  type PrivateDocumentTransport,
} from "../api/private-document-evidence.ts";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from
  "../src/scenarios/private-document-evidence.ts";
import {
  adaptPrivateDocumentLifecycleToReceipt,
  PrivateDocumentReceiptAdapterError,
  type PrivateDocumentLifecycleReceiptInput,
} from "../src/scenarios/private-document-receipt-adapter.ts";
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

const LABEL = "REHEARSAL_ONLY";
const SCENARIO_ID = "private-document-evidence";
export const PRIVATE_DOCUMENT_REHEARSAL_CAPABILITY = {
  schemaVersion: 1,
  surface: "rehearsal-only",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: [SCENARIO_ID],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;
const MANIFEST_SCHEMA_VERSION = 2;
const FAKE_CORRELATION = "run-contract";
const FAKE_MARKER = "ap2doc-20260831T225959Z-a1b2c3";
const REQUEST_KEYS = [
  "schemaVersion",
  "label",
  "scenarioId",
  "syntheticBranch",
] as const;
const EXTERNAL_CLAIM_KEYS = [
  "producerStaging",
  "learnerVisibility",
  "learnerInterpretation",
  "auditOrDetection",
  "response",
  "cleanup",
  "retention",
] as const;

export type PrivateDocumentSyntheticBranch =
  | "cleaned-canary"
  | "learner-observation";

export interface PrivateDocumentRehearsalRequest {
  schemaVersion: 1;
  label: typeof LABEL;
  scenarioId: typeof SCENARIO_ID;
  syntheticBranch: PrivateDocumentSyntheticBranch;
}

export interface PrivateDocumentFakeLifecycle {
  execute(branch: PrivateDocumentSyntheticBranch): Promise<unknown>;
}

export type PrivateDocumentRehearsalFailure =
  | ScenarioPlanError["category"]
  | "FAKE_OUTCOME_MISMATCH"
  | "INPUT_SCHEMA"
  | "LIFECYCLE_CLEANUP_GAP"
  | "LIFECYCLE_MARKER_MISMATCH"
  | "LIFECYCLE_NONTERMINAL"
  | "LIFECYCLE_OVERCLAIM"
  | "LIFECYCLE_SCENARIO_MISMATCH"
  | "LIFECYCLE_SEQUENCE"
  | "LIFECYCLE_SHAPE"
  | "LIFECYCLE_UNSAFE_INPUT"
  | "RECEIPT_REFUSED";

export interface PrivateDocumentRehearsalResult {
  schemaVersion: 1;
  label: typeof LABEL;
  status: "completed" | "refused";
  failure: PrivateDocumentRehearsalFailure | null;
  binding: Readonly<{
    scenarioId: typeof SCENARIO_ID;
    manifestSchemaVersion: typeof MANIFEST_SCHEMA_VERSION;
    planDigestSha256: string;
    fakeRunDigestSha256: string;
    syntheticBranch: PrivateDocumentSyntheticBranch;
  }> | null;
  stages: Readonly<{
    plan: "compiled" | "refused" | "not-run";
    fakeLifecycle: "completed" | "refused" | "not-run";
    adapter: "accepted" | "refused" | "not-run";
    receiptVerifier: "accepted" | "refused" | "not-run";
  }>;
  fakeRun: Readonly<{
    lifecycleStatus: "blocked-cleanup" | "completed-cleaned";
    journalEntries: 30;
    learnerObservation: "synthetic-not-proven" | "synthetic-proven";
    initialTerminalProducerAbsence: "synthetic-absent";
    initialTerminalLearnerAbsence:
      | "synthetic-absent"
      | "synthetic-not-proven";
    freshTerminal: Readonly<{
      rounds: 3;
      producerFolder: "synthetic-absent";
      producerItem: "synthetic-absent";
      producerPermission: "synthetic-absent";
      learnerAccess: "synthetic-absent";
    }>;
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

export function canonicalPrivateDocumentRehearsalRequest(
  syntheticBranch: PrivateDocumentSyntheticBranch = "cleaned-canary",
): PrivateDocumentRehearsalRequest {
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    syntheticBranch,
  };
}

export function canonicalPrivateDocumentPlanningRequest():
  ScenarioPlanningRequest {
  const expiresAt = PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.cost
        .conservativeDurationHours * 3_600_000,
  ).toISOString();
  return {
    scenarioId: SCENARIO_ID,
    actorAliases: {
      evidenceProducer: "orchestrator",
      workloadActor: "producer",
      learner: "learner",
      cleanupOwner: "producer",
    },
    now,
    expiresAt,
    maximumBudgetUsd:
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.cost.laneMaximum,
  };
}

export function compilePrivateDocumentRehearsalPlan():
  ScenarioExecutionPlan {
  const plan = compileScenarioExecutionPlan(
    canonicalPrivateDocumentPlanningRequest(),
  );
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.selectedResponseId !== null ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    !sameStrings(
      plan.terminalProof.cleanupOperationKeys,
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.lifecycle.cleanupOperationKeys,
    )
  ) {
    throw new RehearsalError("RECEIPT_REFUSED");
  }
  return plan;
}

export function createDeterministicPrivateDocumentFakeLifecycle():
  PrivateDocumentFakeLifecycle {
  return {
    async execute(
      branch: PrivateDocumentSyntheticBranch,
    ): Promise<PrivateDocumentLifecycleReceiptInput> {
      const plan = buildFakeBackendPlan();
      const journalEntries: PrivateDocumentJournalEntry[] = [];
      const journal: PrivateDocumentJournal = {
        async append(entry) {
          journalEntries.push(structuredClone(entry));
        },
      };
      const clock = deterministicClock();
      const runner = new PrivateDocumentEvidenceRunner(
        plan,
        new DeterministicPrivateDocumentTransport(branch),
        journal,
        clock,
      );
      const result = await runner.run();
      return reduceFakeLifecycle(branch, result, journalEntries);
    },
  };
}

export async function runPrivateDocumentRehearsal(
  value: unknown,
  lifecycle: PrivateDocumentFakeLifecycle,
): Promise<PrivateDocumentRehearsalResult> {
  let request: PrivateDocumentRehearsalRequest;
  try {
    request = parseRequest(value);
  } catch {
    return refused("INPUT_SCHEMA", "plan");
  }

  let plan: ScenarioExecutionPlan;
  try {
    plan = compilePrivateDocumentRehearsalPlan();
  } catch (error) {
    return refused(failureCategory(error, "RECEIPT_REFUSED"), "plan");
  }

  let lifecycleValue: unknown;
  try {
    lifecycleValue = await lifecycle.execute(request.syntheticBranch);
  } catch {
    return refused(
      "LIFECYCLE_NONTERMINAL",
      "fakeLifecycle",
    );
  }

  let receipt;
  try {
    receipt = adaptPrivateDocumentLifecycleToReceipt(lifecycleValue);
  } catch (error) {
    return refused(
      failureCategory(error, "LIFECYCLE_SHAPE"),
      "adapter",
    );
  }

  const terminal = safeTerminalBinding(
    lifecycleValue,
    request.syntheticBranch,
  );
  if (terminal === null) {
    return refused(
      "FAKE_OUTCOME_MISMATCH",
      "binding",
    );
  }

  try {
    verifyScenarioEvidenceReceipt(
      receipt,
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
    );
  } catch {
    return refused(
      "RECEIPT_REFUSED",
      "receiptVerifier",
    );
  }

  return deepFreeze({
    schemaVersion: 1,
    label: LABEL,
    status: "completed",
    failure: null,
    binding: {
      scenarioId: SCENARIO_ID,
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      planDigestSha256: plan.digestSha256,
      fakeRunDigestSha256: digestFakeRun(lifecycleValue),
      syntheticBranch: request.syntheticBranch,
    },
    stages: {
      plan: "compiled",
      fakeLifecycle: "completed",
      adapter: "accepted",
      receiptVerifier: "accepted",
    },
    fakeRun: terminal,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: receipt.claims.length,
      externalEvidence: Object.fromEntries(
        EXTERNAL_CLAIM_KEYS.map((key) => [key, "uninspected"]),
      ) as Record<typeof EXTERNAL_CLAIM_KEYS[number], "uninspected">,
    },
  } satisfies PrivateDocumentRehearsalResult);
}

class DeterministicPrivateDocumentTransport
  implements PrivateDocumentTransport {
  readonly #branch: PrivateDocumentSyntheticBranch;
  readonly #mutated = new Set<PrivateDocumentMutation>();

  constructor(branch: PrivateDocumentSyntheticBranch) {
    this.#branch = branch;
  }

  async mutate(
    operation: PrivateDocumentMutation,
    _plan: Parameters<PrivateDocumentTransport["mutate"]>[1],
    state: Readonly<PrivateDocumentState>,
  ): Promise<PrivateDocumentMutationOutcome> {
    if (this.#mutated.has(operation)) {
      return { status: "failed" };
    }
    this.#mutated.add(operation);
    return {
      status: "succeeded",
      state: nextFakeState(operation, state),
    };
  }

  async reconcile(
    operation: PrivateDocumentMutation,
    _plan: Parameters<PrivateDocumentTransport["reconcile"]>[1],
    state: Readonly<PrivateDocumentState>,
  ): Promise<PrivateDocumentReconciliation> {
    if (operation.endsWith("-delete")) {
      return this.#mutated.has(operation)
        ? { status: "desired", state: nextFakeState(operation, state) }
        : { status: "present", state };
    }
    return this.#mutated.has(operation)
      ? { status: "desired", state: nextFakeState(operation, state) }
      : { status: "absent", state };
  }

  async observe(
    read: PrivateDocumentRead,
    _plan: Parameters<PrivateDocumentTransport["observe"]>[1],
    _state: Readonly<PrivateDocumentState>,
  ): Promise<PrivateDocumentObservation> {
    if (read === "learner-visibility") {
      return this.#branch === "learner-observation"
        ? { status: "proven", summary: "learner-visible" }
        : { status: "failed", summary: "contract-failed" };
    }
    if (read === "terminal-producer-absence") {
      return { status: "absent", summary: "producer-absent" };
    }
    return this.#branch === "learner-observation"
      ? { status: "absent", summary: "learner-absent" }
      : { status: "failed", summary: "contract-failed" };
  }
}

function buildFakeBackendPlan() {
  return buildPrivateDocumentPlan(
    {
      runMarker: FAKE_MARKER,
      tenantId: "synthetic-lab",
      producer: {
        alias: "kobe",
        tenantId: "synthetic-lab",
        objectId: "synthetic-producer",
      },
      learner: {
        alias: "cory",
        tenantId: "synthetic-lab",
        objectId: "synthetic-learner",
      },
      drive: {
        id: "synthetic-drive",
        driveType: "business",
        ownerObjectId: "synthetic-producer",
        hostname: "synthetic.sharepoint.com",
      },
      runFolderPathAbsent: true,
      producerScopes: [PRIVATE_DOCUMENT_FILES_READ_WRITE_SCOPE],
      learnerScopes: [PRIVATE_DOCUMENT_FILES_READ_SCOPE],
      cleanupOwnerAlias: "kobe",
      payloadCategory: "authorized-lab-document-review",
      retention: "ephemeral",
      share: {
        recipientObjectId: "synthetic-learner",
        roles: ["read"],
        requireSignIn: true,
        sendInvitation: false,
        allowLinks: false,
      },
      claims: {
        learnerVisibility: "metadata-or-content-read",
        learnerInterpretation: false,
        auditOrDetection: false,
      },
    },
    {
      expectedTenantId: "synthetic-lab",
      existingMarkers: new Set(),
    },
  );
}

function deterministicClock(): PrivateDocumentClock {
  const fixed = new Date("2026-08-31T22:59:59.000Z");
  return {
    now: () => new Date(fixed),
    wait: async () => undefined,
  };
}

function nextFakeState(
  operation: PrivateDocumentMutation,
  state: Readonly<PrivateDocumentState>,
): Readonly<PrivateDocumentState> {
  if (operation === "folder-create") {
    return {
      ...state,
      folderId: "synthetic-folder",
      folderETag: "synthetic-folder-etag",
    };
  }
  if (operation === "file-create") {
    return {
      ...state,
      itemId: "synthetic-item",
      itemETag: "synthetic-item-etag",
    };
  }
  if (operation === "direct-share-create") {
    return { ...state, permissionId: "synthetic-permission" };
  }
  if (operation === "direct-share-delete") {
    const { permissionId: _permissionId, ...remaining } = state;
    return remaining;
  }
  if (operation === "file-delete") {
    const {
      itemId: _itemId,
      itemETag: _itemETag,
      ...remaining
    } = state;
    return remaining;
  }
  const {
    folderId: _folderId,
    folderETag: _folderETag,
    ...remaining
  } = state;
  return remaining;
}

function reduceFakeLifecycle(
  branch: PrivateDocumentSyntheticBranch,
  result: PrivateDocumentRunResult,
  journal: readonly PrivateDocumentJournalEntry[],
): PrivateDocumentLifecycleReceiptInput {
  const sanitizedResult = branch === "learner-observation"
    ? {
      status: "completed-cleaned" as const,
      learnerVisibility: "proven" as const,
      learnerInterpretation: "not-claimed" as const,
      auditOrDetection: "not-claimed" as const,
    }
    : {
      status: "blocked-cleanup" as const,
      failedOperation: "terminal-absence" as const,
      learnerVisibility: "not-proven" as const,
      learnerInterpretation: "not-claimed" as const,
      auditOrDetection: "not-claimed" as const,
    };
  if (
    (branch === "learner-observation" &&
      result.status !== "completed-cleaned") ||
    (branch === "cleaned-canary" &&
      (
        result.status !== "blocked-cleanup" ||
        result.failedOperation !== "terminal-absence"
      ))
  ) {
    throw new RehearsalError("LIFECYCLE_NONTERMINAL");
  }
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    correlation: FAKE_CORRELATION,
    result: sanitizedResult,
    journal: journal.map((entry, index) => ({
      sequence: index + 1,
      correlation: FAKE_CORRELATION,
      operation: entry.operation,
      transition: entry.transition,
      detail: entry.detail,
    })),
    terminal: {
      freshSessionRounds: 3,
      producerFolder: "absent",
      producerItem: "absent",
      producerPermission: "absent",
      learnerAccess: "absent",
    },
  };
}

function safeTerminalBinding(
  value: unknown,
  branch: PrivateDocumentSyntheticBranch,
): PrivateDocumentRehearsalResult["fakeRun"] {
  if (!isRecord(value) || !isRecord(value.result) ||
    !Array.isArray(value.journal) || value.journal.length !== 30) {
    return null;
  }
  const lifecycleStatus = value.result.status;
  if (
    branch === "cleaned-canary" &&
    (
      lifecycleStatus !== "blocked-cleanup" ||
      value.result.failedOperation !== "terminal-absence" ||
      value.result.learnerVisibility !== "not-proven"
    )
  ) {
    return null;
  }
  if (
    branch === "learner-observation" &&
    (
      lifecycleStatus !== "completed-cleaned" ||
      value.result.learnerVisibility !== "proven"
    )
  ) {
    return null;
  }
  return {
    lifecycleStatus: branch === "learner-observation"
      ? "completed-cleaned"
      : "blocked-cleanup",
    journalEntries: 30,
    learnerObservation: branch === "learner-observation"
      ? "synthetic-proven"
      : "synthetic-not-proven",
    initialTerminalProducerAbsence: "synthetic-absent",
    initialTerminalLearnerAbsence: branch === "learner-observation"
      ? "synthetic-absent"
      : "synthetic-not-proven",
    freshTerminal: {
      rounds: 3,
      producerFolder: "synthetic-absent",
      producerItem: "synthetic-absent",
      producerPermission: "synthetic-absent",
      learnerAccess: "synthetic-absent",
    },
  };
}

function parseRequest(value: unknown): PrivateDocumentRehearsalRequest {
  if (!isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...REQUEST_KEYS].sort()) ||
    value.schemaVersion !== 1 ||
    value.label !== LABEL ||
    value.scenarioId !== SCENARIO_ID ||
    (
      value.syntheticBranch !== "cleaned-canary" &&
      value.syntheticBranch !== "learner-observation"
    )) {
    throw new RehearsalError("INPUT_SCHEMA");
  }
  return {
    schemaVersion: 1,
    label: LABEL,
    scenarioId: SCENARIO_ID,
    syntheticBranch: value.syntheticBranch,
  };
}

function digestFakeRun(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex");
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

function refused(
  failure: PrivateDocumentRehearsalFailure,
  stage:
    | "plan"
    | "fakeLifecycle"
    | "adapter"
    | "binding"
    | "receiptVerifier",
): PrivateDocumentRehearsalResult {
  const stages: PrivateDocumentRehearsalResult["stages"] = {
    plan: stage === "plan" ? "refused" : "compiled",
    fakeLifecycle: stage === "plan"
      ? "not-run"
      : stage === "fakeLifecycle"
      ? "refused"
      : "completed",
    adapter: stage === "plan" || stage === "fakeLifecycle"
      ? "not-run"
      : stage === "adapter"
      ? "refused"
      : "accepted",
    receiptVerifier: stage === "receiptVerifier"
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
  });
}

function failureCategory(
  error: unknown,
  fallback: PrivateDocumentRehearsalFailure,
): PrivateDocumentRehearsalFailure {
  if (error instanceof ScenarioPlanError) return error.category;
  if (error instanceof PrivateDocumentReceiptAdapterError) {
    const categories = {
      shape: "LIFECYCLE_SHAPE",
      "unsafe-input": "LIFECYCLE_UNSAFE_INPUT",
      "scenario-mismatch": "LIFECYCLE_SCENARIO_MISMATCH",
      "marker-mismatch": "LIFECYCLE_MARKER_MISMATCH",
      sequence: "LIFECYCLE_SEQUENCE",
      nonterminal: "LIFECYCLE_NONTERMINAL",
      "cleanup-gap": "LIFECYCLE_CLEANUP_GAP",
      overclaim: "LIFECYCLE_OVERCLAIM",
    } as const;
    return categories[error.code];
  }
  if (error instanceof RehearsalError) return error.failure;
  return fallback;
}

class RehearsalError extends Error {
  readonly failure: PrivateDocumentRehearsalFailure;

  constructor(failure: PrivateDocumentRehearsalFailure) {
    super(failure);
    this.name = "PrivateDocumentRehearsalError";
    this.failure = failure;
  }
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
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
