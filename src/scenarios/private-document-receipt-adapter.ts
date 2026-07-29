import type {
  PrivateDocumentJournalEntry,
  PrivateDocumentMutation,
  PrivateDocumentRead,
  PrivateDocumentRunResult,
} from "../../api/private-document-evidence.ts";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from "./private-document-evidence.ts";
import {
  verifyScenarioEvidenceReceipt,
  type EvidenceReceiptClaim,
  type EvidenceReceiptObservation,
  type ObservationOutcome,
  type ObservationSource,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";

const SCENARIO_ID = "private-document-evidence";
const MAX_EVENTS = 40;
const SAFE_CORRELATION = /^run-[a-z0-9]{1,32}$/;
const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATIONS = [
  "folder-create",
  "file-create",
  "direct-share-create",
  "learner-visibility",
  "direct-share-delete",
  "file-delete",
  "folder-delete",
  "terminal-producer-absence",
  "terminal-learner-absence",
] as const satisfies readonly (
  PrivateDocumentMutation | PrivateDocumentRead
)[];
const TRANSITIONS = [
  "intent",
  "succeeded",
  "failed",
  "ambiguous",
  "reconciled",
  "reconciliation-incomplete",
  "observed",
] as const satisfies readonly PrivateDocumentJournalEntry["transition"][];
const DETAILS = [
  "mutation-intent",
  "definite-success",
  "definite-failure",
  "requires-exact-read",
  "exact-desired-state",
  "exact-present-state",
  "exact-absent-state",
  "absence-awaiting-propagation",
  "read-incomplete",
  "learner-visible",
  "producer-absent",
  "learner-absent",
  "contract-failed",
] as const satisfies readonly PrivateDocumentJournalEntry["detail"][];

type LifecycleStatus = PrivateDocumentRunResult["status"];
type SanitizedJournalCore = Pick<
  PrivateDocumentJournalEntry,
  "operation" | "transition" | "detail"
>;

export interface SanitizedPrivateDocumentJournalEntry
  extends SanitizedJournalCore {
  sequence: number;
  correlation: string;
}

export type SanitizedPrivateDocumentResult =
  | {
      status: Extract<LifecycleStatus, "completed-cleaned">;
      learnerVisibility: "proven";
      learnerInterpretation: "not-claimed";
      auditOrDetection: "not-claimed";
    }
  | {
      status: Extract<LifecycleStatus, "blocked-cleanup">;
      failedOperation: "terminal-absence";
      learnerVisibility: "not-proven";
      learnerInterpretation: "not-claimed";
      auditOrDetection: "not-claimed";
    };

export interface PrivateDocumentTerminalEvidence {
  freshSessionRounds: 3;
  producerFolder: "absent";
  producerItem: "absent";
  producerPermission: "absent";
  learnerAccess: "absent";
}

export interface PrivateDocumentLifecycleReceiptInput {
  schemaVersion: 1;
  scenarioId: typeof SCENARIO_ID;
  correlation: string;
  result: SanitizedPrivateDocumentResult;
  journal: readonly SanitizedPrivateDocumentJournalEntry[];
  terminal: PrivateDocumentTerminalEvidence;
}

export type PrivateDocumentReceiptAdapterErrorCode =
  | "shape"
  | "unsafe-input"
  | "scenario-mismatch"
  | "marker-mismatch"
  | "sequence"
  | "nonterminal"
  | "cleanup-gap"
  | "overclaim";

export class PrivateDocumentReceiptAdapterError extends Error {
  readonly code: PrivateDocumentReceiptAdapterErrorCode;

  constructor(
    code: PrivateDocumentReceiptAdapterErrorCode,
    message: string,
  ) {
    super(`Invalid private-document receipt input [${code}]: ${message}`);
    this.name = "PrivateDocumentReceiptAdapterError";
    this.code = code;
  }
}

export function adaptPrivateDocumentLifecycleToReceipt(
  value: unknown,
): ScenarioEvidenceReceipt {
  const input = parseInput(value);
  validateLifecycle(input);
  const receipt = buildReceipt(input.result.learnerVisibility === "proven");
  verifyScenarioEvidenceReceipt(
    receipt,
    PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
  );
  return deepFreeze(receipt);
}

function parseInput(value: unknown): PrivateDocumentLifecycleReceiptInput {
  const input = record(value);
  exactKeys(input, [
    "schemaVersion",
    "scenarioId",
    "correlation",
    "result",
    "journal",
    "terminal",
  ]);
  if (input.schemaVersion !== 1) {
    throw failure("shape", "schemaVersion must be 1.");
  }
  if (input.scenarioId !== SCENARIO_ID) {
    throw failure("scenario-mismatch", "scenario ID is not canonical.");
  }
  const correlation = correlationAlias(input.correlation);
  if (
    !Array.isArray(input.journal) ||
    input.journal.length === 0 ||
    input.journal.length > MAX_EVENTS
  ) {
    throw failure("shape", "journal must contain 1 to 40 events.");
  }
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    correlation,
    result: parseResult(input.result),
    journal: input.journal.map(parseJournalEntry),
    terminal: parseTerminal(input.terminal),
  };
}

function parseResult(value: unknown): SanitizedPrivateDocumentResult {
  const result = record(value);
  if (result.status === "completed-cleaned") {
    exactKeys(result, [
      "status",
      "learnerVisibility",
      "learnerInterpretation",
      "auditOrDetection",
    ]);
    if (
      result.learnerVisibility !== "proven" ||
      result.learnerInterpretation !== "not-claimed" ||
      result.auditOrDetection !== "not-claimed"
    ) {
      throw failure("overclaim", "completed result claims are inconsistent.");
    }
    return {
      status: "completed-cleaned",
      learnerVisibility: "proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    };
  }
  if (result.status === "blocked-cleanup") {
    exactKeys(result, [
      "status",
      "failedOperation",
      "learnerVisibility",
      "learnerInterpretation",
      "auditOrDetection",
    ]);
    if (
      result.failedOperation !== "terminal-absence" ||
      result.learnerVisibility !== "not-proven" ||
      result.learnerInterpretation !== "not-claimed" ||
      result.auditOrDetection !== "not-claimed"
    ) {
      throw failure("overclaim", "blocked result claims are inconsistent.");
    }
    return {
      status: "blocked-cleanup",
      failedOperation: "terminal-absence",
      learnerVisibility: "not-proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    };
  }
  if (
    result.status === "cleaned-after-failure" ||
    result.status === "ambiguous" ||
    result.status === "failed" ||
    result.status === "incomplete"
  ) {
    throw failure("nonterminal", "lifecycle result is not accepted.");
  }
  throw failure("shape", "lifecycle result status is unsupported.");
}

function parseJournalEntry(
  value: unknown,
  index: number,
): SanitizedPrivateDocumentJournalEntry {
  const entry = record(value);
  exactKeys(entry, [
    "sequence",
    "correlation",
    "operation",
    "transition",
    "detail",
  ]);
  if (!Number.isSafeInteger(entry.sequence) || Number(entry.sequence) < 1) {
    throw failure("shape", "journal sequence must be a positive integer.");
  }
  if (
    typeof entry.operation !== "string" ||
    !OPERATIONS.includes(
      entry.operation as typeof OPERATIONS[number],
    ) ||
    typeof entry.transition !== "string" ||
    !TRANSITIONS.includes(
      entry.transition as typeof TRANSITIONS[number],
    ) ||
    typeof entry.detail !== "string" ||
    !DETAILS.includes(entry.detail as typeof DETAILS[number])
  ) {
    throw failure("shape", `journal event ${index} is unsupported.`);
  }
  return {
    sequence: Number(entry.sequence),
    correlation: correlationAlias(entry.correlation),
    operation: entry.operation as typeof OPERATIONS[number],
    transition: entry.transition as typeof TRANSITIONS[number],
    detail: entry.detail as typeof DETAILS[number],
  };
}

function parseTerminal(value: unknown): PrivateDocumentTerminalEvidence {
  const terminal = record(value);
  exactKeys(terminal, [
    "freshSessionRounds",
    "producerFolder",
    "producerItem",
    "producerPermission",
    "learnerAccess",
  ]);
  if (
    terminal.freshSessionRounds !== 3 ||
    terminal.producerFolder !== "absent" ||
    terminal.producerItem !== "absent" ||
    terminal.producerPermission !== "absent" ||
    terminal.learnerAccess !== "absent"
  ) {
    throw failure(
      "cleanup-gap",
      "three complete fresh-session absence rounds are required.",
    );
  }
  return {
    freshSessionRounds: 3,
    producerFolder: "absent",
    producerItem: "absent",
    producerPermission: "absent",
    learnerAccess: "absent",
  };
}

function validateLifecycle(input: PrivateDocumentLifecycleReceiptInput): void {
  if (
    input.journal.some((entry) =>
      entry.correlation !== input.correlation
    )
  ) {
    throw failure("marker-mismatch", "journal correlations differ.");
  }
  const sequences = input.journal.map((entry) => entry.sequence);
  if (
    new Set(sequences).size !== sequences.length ||
    sequences.some((sequence, index) => sequence !== index + 1)
  ) {
    throw failure("sequence", "journal order or uniqueness is invalid.");
  }
  if (
    input.journal.some((entry) =>
      entry.transition === "ambiguous" ||
      entry.transition === "failed" ||
      entry.detail === "definite-failure" ||
      entry.detail === "requires-exact-read" ||
      entry.detail === "read-incomplete"
    )
  ) {
    throw failure("nonterminal", "journal contains a nonterminal outcome.");
  }
  const learnerProven = input.result.learnerVisibility === "proven";
  const expected = expectedJournal(
    input.correlation,
    learnerProven,
    input.result.status === "completed-cleaned",
  );
  const actualCore = input.journal.map((entry) => ({
    sequence: entry.sequence,
    correlation: entry.correlation,
    operation: entry.operation,
    transition: entry.transition,
    detail: entry.detail,
  }));
  if (JSON.stringify(actualCore) !== JSON.stringify(expected)) {
    const hasLearnerVisible = input.journal.some((entry) =>
      entry.operation === "learner-visibility" &&
      entry.transition === "observed" &&
      entry.detail === "learner-visible"
    );
    if (hasLearnerVisible !== learnerProven) {
      throw failure(
        "overclaim",
        "learner result and exact observation disagree.",
      );
    }
    throw failure("sequence", "journal lifecycle is incomplete or reordered.");
  }
}

function expectedJournal(
  correlation: string,
  learnerProven: boolean,
  initialTerminalLearnerAbsent: boolean,
): SanitizedPrivateDocumentJournalEntry[] {
  const entries: SanitizedJournalCore[] = [];
  for (
    const operation of [
      "folder-create",
      "file-create",
      "direct-share-create",
    ] as const
  ) {
    entries.push(
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      {
        operation,
        transition: "reconciled",
        detail: "exact-desired-state",
      },
    );
  }
  entries.push({
    operation: "learner-visibility",
    transition: "observed",
    detail: learnerProven ? "learner-visible" : "contract-failed",
  });
  for (
    const operation of [
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ] as const
  ) {
    entries.push(
      {
        operation,
        transition: "reconciled",
        detail: "exact-present-state",
      },
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      {
        operation,
        transition: "reconciliation-incomplete",
        detail: "absence-awaiting-propagation",
      },
      {
        operation,
        transition: "reconciliation-incomplete",
        detail: "absence-awaiting-propagation",
      },
      {
        operation,
        transition: "reconciled",
        detail: "exact-desired-state",
      },
    );
  }
  entries.push(
    {
      operation: "terminal-producer-absence",
      transition: "observed",
      detail: "producer-absent",
    },
    {
      operation: "terminal-learner-absence",
      transition: "observed",
      detail: initialTerminalLearnerAbsent
        ? "learner-absent"
        : "contract-failed",
    },
  );
  return entries.map((entry, index) => ({
    sequence: index + 1,
    correlation,
    ...entry,
  }));
}

function buildReceipt(learnerProven: boolean): ScenarioEvidenceReceipt {
  const manifest = PRIVATE_DOCUMENT_EVIDENCE_SCENARIO;
  const producer = manifest.roles.workloadActor;
  const learner = manifest.roles.learner;
  const claims: EvidenceReceiptClaim[] = manifest.operations.map(
    (operation) => {
      if (operation.key === "inspect-private-document") {
        return uninspectedOperation(operation.key);
      }
      if (operation.key === "read-private-document-exact") {
        return learnerProven
          ? provenOperation(
            operation.key,
            observation(
              "learner-view",
              "learner-inspection",
              learner,
              operation.key,
            ),
          )
          : uninspectedOperation(operation.key);
      }
      if (operation.key === "reconcile-private-document-learner-access") {
        return provenOperation(
          operation.key,
          observation(
            "learner-view",
            "exact-reconciliation",
            learner,
            operation.key,
          ),
        );
      }
      return provenOperation(
        operation.key,
        observation(
          "local-reconciliation",
          "exact-reconciliation",
          producer,
          operation.key,
        ),
      );
    },
  );
  const stagingObservation = observation(
    "local-reconciliation",
    "exact-reconciliation",
    producer,
    "grant-direct-learner-read",
  );
  const terminalObservation = observation(
    "local-reconciliation",
    "exact-reconciliation",
    producer,
    "reconcile-private-document-cleanup",
  );
  claims.push(
    {
      id: "artifact-private-text-document",
      category: "artifact",
      subject: { kind: "artifact", id: "private-text-document" },
      assertion: "artifact-authentic",
      state: "proven",
      artifact: {
        kind: "private-document",
        authenticity: "platform-native",
      },
      observation: stagingObservation,
    },
    learnerProven
      ? {
        id: "visibility-private-text-document",
        category: "learner-visibility",
        subject: { kind: "artifact", id: "private-text-document" },
        assertion: "learner-visible",
        state: "proven",
        observation: observation(
          "learner-view",
          "learner-inspection",
          learner,
          "read-private-document-exact",
        ),
      }
      : {
        id: "visibility-private-text-document",
        category: "learner-visibility",
        subject: { kind: "artifact", id: "private-text-document" },
        assertion: "learner-visible",
        state: "uninspected",
      },
    {
      id: "learner-interpretation",
      category: "learner-interpretation",
      subject: { kind: "scenario", id: SCENARIO_ID },
      assertion: "learner-interpreted",
      state: "uninspected",
    },
  );
  for (const operationKey of manifest.lifecycle.cleanupOperationKeys) {
    claims.push({
      id: `cleanup-${operationKey}`,
      category: "cleanup",
      subject: { kind: "operation", id: operationKey },
      assertion: "cleanup-completed",
      state: "proven",
      observation: terminalObservation,
    });
  }
  claims.push(
    {
      id: "retention-private-text-document",
      category: "retention",
      subject: { kind: "artifact", id: "private-text-document" },
      assertion: "retention-confirmed",
      state: "absent",
      observation: terminalObservation,
    },
    {
      id: "terminal-private-document-staged",
      category: "terminal-proof",
      subject: { kind: "artifact", id: "private-text-document" },
      assertion: "private-document-staged",
      state: "proven",
      observation: stagingObservation,
    },
  );
  return {
    schemaVersion: 1,
    scenario: {
      id: SCENARIO_ID,
      manifestSchemaVersion: 2,
    },
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: producer,
      learner,
    },
    claims,
  };
}

function uninspectedOperation(operationKey: string): EvidenceReceiptClaim {
  return {
    id: `operation-${operationKey}`,
    category: "operation",
    subject: { kind: "operation", id: operationKey },
    assertion: "operation-completed",
    state: "uninspected",
  };
}

function provenOperation(
  operationKey: string,
  observed: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    ...uninspectedOperation(operationKey),
    state: "proven",
    observation: observed,
  };
}

function observation(
  source: ObservationSource,
  outcome: ObservationOutcome,
  observerActorId: string,
  operationKey: string,
): EvidenceReceiptObservation {
  return { source, outcome, observerActorId, operationKey };
}

function correlationAlias(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !SAFE_CORRELATION.test(value) ||
    GUID.test(value)
  ) {
    throw failure("unsafe-input", "correlation must be a sanitized alias.");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw failure("shape", "expected an object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...allowed].sort())
  ) {
    throw failure("shape", "object fields do not match the adapter schema.");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function failure(
  code: PrivateDocumentReceiptAdapterErrorCode,
  message: string,
): PrivateDocumentReceiptAdapterError {
  return new PrivateDocumentReceiptAdapterError(code, message);
}
