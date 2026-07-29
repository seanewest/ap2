import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email.ts";
import {
  verifyScenarioEvidenceReceipt,
  type EvidenceReceiptClaim,
  type EvidenceReceiptObservation,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import type {
  ScenarioAdapterCapabilityDeclaration,
} from "./scenario-surface-capability.ts";

const SCENARIO_ID = "help-desk-email-observation";
const SEND_OPERATION = "send-help-desk-email";
const LEARNER_READ_OPERATION = "read-marker-after";
const INTERPRET_OPERATION = "interpret-help-desk-email";
const CLEANUP_OPERATION = "delete-retained-help-desk-email";
const RESPONSE_ACTION = "report-help-desk-interpretation";
const ARTIFACT_ID = "cory-help-desk-email";
const MAX_INPUT_BYTES = 4_096;
const MAX_DEPTH = 6;
const MAX_VALUES = 64;
const FORBIDDEN_KEY =
  /^(?:sender|recipient|subject|body|marker|tenant(?:Id)?|subscription(?:Id)?|user(?:Id)?|message(?:Id)?|object(?:Id)?|resource(?:Id)?|token|credential|certificate|path|timestamp|request|response|payload|run(?:Id)?)$/i;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PRIVATE_PATH = /(?:\/(?:home|Users|mnt\/[a-z])\/|[A-Z]:\\|\\\\)/i;
const TIMESTAMP =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/i;
const SECRET =
  /(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|-----BEGIN|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)/i;
const MARKER = /\bap2(?:lab)?-[a-z0-9][a-z0-9-]{7,}\b/i;

export const HELP_DESK_EMAIL_RECEIPT_ADAPTER_CAPABILITY = {
  schemaVersion: 1,
  adapter: "help-desk-email",
  scenarioId: SCENARIO_ID,
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioAdapterCapabilityDeclaration;

export interface SanitizedHelpDeskEmailOperationResult {
  operation: typeof SEND_OPERATION;
  outcome: "accepted";
  observerRole: "evidenceProducer";
  semanticBoundary: "email-only";
}

export interface SanitizedHelpDeskEmailJournalEntry {
  sequence: 1 | 2;
  operation: typeof SEND_OPERATION;
  transition: "attempted" | "accepted";
}

export type HelpDeskLearnerArtifactObservation =
  | { state: "uninspected" }
  | {
      state: "observed";
      observerRole: "learner";
      operation: typeof LEARNER_READ_OPERATION;
      artifact: "outlook-email";
    };

export type HelpDeskLearnerInterpretationObservation =
  | { state: "uninspected" }
  | {
      state: "observed";
      observerRole: "learner";
      operation: typeof INTERPRET_OPERATION;
      responseAction: typeof RESPONSE_ACTION;
    };

export interface HelpDeskLearnerObservations {
  artifact: HelpDeskLearnerArtifactObservation;
  interpretation: HelpDeskLearnerInterpretationObservation;
}

export type HelpDeskCleanupObservation =
  | { state: "uninspected" }
  | {
      state: "cleaned";
      mutationObserverRole: "evidenceProducer";
      mutationOperation: typeof CLEANUP_OPERATION;
      terminalObserverRole: "learner";
      terminalOperation: typeof LEARNER_READ_OPERATION;
      retention: "absent";
    };

export interface HelpDeskEmailReceiptAdapterInput {
  schemaVersion: 1;
  scenarioId: typeof SCENARIO_ID;
  result: SanitizedHelpDeskEmailOperationResult;
  journal: readonly SanitizedHelpDeskEmailJournalEntry[];
  learner: HelpDeskLearnerObservations;
  cleanup: HelpDeskCleanupObservation;
}

export function canonicalHelpDeskEmailReceiptAdapterInput():
  HelpDeskEmailReceiptAdapterInput {
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    result: {
      operation: SEND_OPERATION,
      outcome: "accepted",
      observerRole: "evidenceProducer",
      semanticBoundary: "email-only",
    },
    journal: [
      {
        sequence: 1,
        operation: SEND_OPERATION,
        transition: "attempted",
      },
      {
        sequence: 2,
        operation: SEND_OPERATION,
        transition: "accepted",
      },
    ],
    learner: {
      artifact: { state: "uninspected" },
      interpretation: { state: "uninspected" },
    },
    cleanup: { state: "uninspected" },
  };
}

export type HelpDeskEmailReceiptAdapterErrorCode =
  | "shape"
  | "unsafe-input"
  | "scenario-mismatch"
  | "sequence"
  | "operation-outcome"
  | "observation-mismatch"
  | "role-conflation"
  | "cleanup-gap"
  | "semantic-overclaim";

export class HelpDeskEmailReceiptAdapterError extends Error {
  readonly code: HelpDeskEmailReceiptAdapterErrorCode;

  constructor(code: HelpDeskEmailReceiptAdapterErrorCode, detail: string) {
    super(`Invalid help-desk receipt input [${code}]: ${detail}`);
    this.name = "HelpDeskEmailReceiptAdapterError";
    this.code = code;
  }
}

export function adaptHelpDeskEmailOperationToReceipt(
  value: unknown,
): ScenarioEvidenceReceipt {
  rejectUnsafeInput(value);
  const input = parseInput(value);
  validateInput(input);
  const receipt = buildReceipt(input);
  verifyScenarioEvidenceReceipt(receipt, HELP_DESK_EMAIL_SCENARIO);
  return deepFreeze(receipt);
}

function parseInput(value: unknown): HelpDeskEmailReceiptAdapterInput {
  const input = record(value);
  exactKeys(input, [
    "schemaVersion",
    "scenarioId",
    "result",
    "journal",
    "learner",
    "cleanup",
  ]);
  if (input.schemaVersion !== 1) {
    throw failure("shape", "schemaVersion must be 1.");
  }
  if (input.scenarioId !== SCENARIO_ID) {
    throw failure("scenario-mismatch", "scenario ID is not canonical.");
  }
  if (!Array.isArray(input.journal) || input.journal.length !== 2) {
    throw failure("sequence", "journal must contain exactly two events.");
  }
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    result: parseResult(input.result),
    journal: input.journal.map(parseJournalEntry),
    learner: parseLearner(input.learner),
    cleanup: parseCleanup(input.cleanup),
  };
}

function parseResult(value: unknown): SanitizedHelpDeskEmailOperationResult {
  const result = record(value);
  exactKeys(result, [
    "operation",
    "outcome",
    "observerRole",
    "semanticBoundary",
  ]);
  if (
    result.operation !== SEND_OPERATION ||
    result.outcome !== "accepted" ||
    result.observerRole !== "evidenceProducer" ||
    result.semanticBoundary !== "email-only"
  ) {
    if (
      ["ambiguous", "failed", "incomplete", "refused"].includes(
        String(result.outcome),
      )
    ) {
      throw failure(
        "operation-outcome",
        "only an accepted one-shot result can be adapted.",
      );
    }
    throw failure("observation-mismatch", "operation result is unsupported.");
  }
  return {
    operation: SEND_OPERATION,
    outcome: "accepted",
    observerRole: "evidenceProducer",
    semanticBoundary: "email-only",
  };
}

function parseJournalEntry(
  value: unknown,
  index: number,
): SanitizedHelpDeskEmailJournalEntry {
  const entry = record(value);
  exactKeys(entry, ["sequence", "operation", "transition"]);
  const expectedSequence = index + 1;
  const expectedTransition = index === 0 ? "attempted" : "accepted";
  if (
    entry.sequence !== expectedSequence ||
    entry.operation !== SEND_OPERATION ||
    entry.transition !== expectedTransition
  ) {
    throw failure(
      "sequence",
      "journal is duplicated, reordered, mismatched, or incomplete.",
    );
  }
  return {
    sequence: expectedSequence as 1 | 2,
    operation: SEND_OPERATION,
    transition: expectedTransition,
  };
}

function parseLearner(value: unknown): HelpDeskLearnerObservations {
  const learner = record(value);
  exactKeys(learner, ["artifact", "interpretation"]);
  return {
    artifact: parseLearnerArtifact(learner.artifact),
    interpretation: parseLearnerInterpretation(learner.interpretation),
  };
}

function parseLearnerArtifact(
  value: unknown,
): HelpDeskLearnerArtifactObservation {
  const artifact = record(value);
  if (artifact.state === "uninspected") {
    exactKeys(artifact, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(artifact, [
    "state",
    "observerRole",
    "operation",
    "artifact",
  ]);
  if (
    artifact.state !== "observed" ||
    artifact.observerRole !== "learner" ||
    artifact.operation !== LEARNER_READ_OPERATION ||
    artifact.artifact !== "outlook-email"
  ) {
    if (artifact.observerRole === "evidenceProducer") {
      throw failure(
        "role-conflation",
        "the evidence producer cannot supply learner visibility.",
      );
    }
    throw failure(
      "observation-mismatch",
      "learner artifact observation is not canonical.",
    );
  }
  return {
    state: "observed",
    observerRole: "learner",
    operation: LEARNER_READ_OPERATION,
    artifact: "outlook-email",
  };
}

function parseLearnerInterpretation(
  value: unknown,
): HelpDeskLearnerInterpretationObservation {
  const interpretation = record(value);
  if (interpretation.state === "uninspected") {
    exactKeys(interpretation, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(interpretation, [
    "state",
    "observerRole",
    "operation",
    "responseAction",
  ]);
  if (
    interpretation.state !== "observed" ||
    interpretation.observerRole !== "learner" ||
    interpretation.operation !== INTERPRET_OPERATION ||
    interpretation.responseAction !== RESPONSE_ACTION
  ) {
    if (interpretation.observerRole === "evidenceProducer") {
      throw failure(
        "role-conflation",
        "the evidence producer cannot supply learner interpretation.",
      );
    }
    throw failure(
      "observation-mismatch",
      "learner interpretation observation is not canonical.",
    );
  }
  return {
    state: "observed",
    observerRole: "learner",
    operation: INTERPRET_OPERATION,
    responseAction: RESPONSE_ACTION,
  };
}

function parseCleanup(value: unknown): HelpDeskCleanupObservation {
  const cleanup = record(value);
  if (cleanup.state === "uninspected") {
    exactKeys(cleanup, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(cleanup, [
    "state",
    "mutationObserverRole",
    "mutationOperation",
    "terminalObserverRole",
    "terminalOperation",
    "retention",
  ]);
  if (
    cleanup.state !== "cleaned" ||
    cleanup.mutationObserverRole !== "evidenceProducer" ||
    cleanup.mutationOperation !== CLEANUP_OPERATION ||
    cleanup.terminalObserverRole !== "learner" ||
    cleanup.terminalOperation !== LEARNER_READ_OPERATION ||
    cleanup.retention !== "absent"
  ) {
    if (
      cleanup.mutationObserverRole === "learner" ||
      cleanup.terminalObserverRole === "evidenceProducer"
    ) {
      throw failure(
        "role-conflation",
        "cleanup mutation and terminal learner observation are conflated.",
      );
    }
    throw failure(
      "cleanup-gap",
      "cleanup lacks its exact mutation and terminal observation.",
    );
  }
  return {
    state: "cleaned",
    mutationObserverRole: "evidenceProducer",
    mutationOperation: CLEANUP_OPERATION,
    terminalObserverRole: "learner",
    terminalOperation: LEARNER_READ_OPERATION,
    retention: "absent",
  };
}

function validateInput(input: HelpDeskEmailReceiptAdapterInput): void {
  if (
    input.result.outcome !== "accepted" ||
    input.journal[0]?.transition !== "attempted" ||
    input.journal[1]?.transition !== "accepted"
  ) {
    throw failure(
      "operation-outcome",
      "result and journal do not prove one accepted operation.",
    );
  }
  if (input.learner.interpretation.state === "observed") {
    if (input.learner.artifact.state !== "observed") {
      throw failure(
        "semantic-overclaim",
        "interpretation cannot precede learner artifact inspection.",
      );
    }
    throw failure(
      "semantic-overclaim",
      "the canonical manifest does not mark interpretation completed.",
    );
  }
  if (
    input.cleanup.state === "cleaned" &&
    input.learner.artifact.state !== "observed"
  ) {
    throw failure(
      "cleanup-gap",
      "cleanup cannot target an unobserved canonical artifact.",
    );
  }
}

function buildReceipt(
  input: HelpDeskEmailReceiptAdapterInput,
): ScenarioEvidenceReceipt {
  const manifest = HELP_DESK_EMAIL_SCENARIO;
  const learnerObserved = input.learner.artifact.state === "observed";
  const cleaned = input.cleanup.state === "cleaned";
  const sendObservation = observation(
    "provider-response",
    "operation-result",
    manifest.roles.evidenceProducer,
    SEND_OPERATION,
  );
  const learnerObservation = observation(
    "learner-view",
    "learner-inspection",
    manifest.roles.learner,
    LEARNER_READ_OPERATION,
  );
  const cleanupMutationObservation = observation(
    "provider-response",
    "operation-result",
    manifest.roles.evidenceProducer,
    CLEANUP_OPERATION,
  );
  const terminalCleanupObservation = observation(
    "learner-view",
    "exact-reconciliation",
    manifest.roles.learner,
    LEARNER_READ_OPERATION,
  );
  const claims: EvidenceReceiptClaim[] = manifest.operations.map(
    (operation) => {
      if (operation.key === SEND_OPERATION) {
        return operationClaim(operation.key, "proven", sendObservation);
      }
      if (operation.key === LEARNER_READ_OPERATION && learnerObserved) {
        return operationClaim(operation.key, "proven", learnerObservation);
      }
      if (operation.key === CLEANUP_OPERATION && cleaned) {
        return operationClaim(
          operation.key,
          "proven",
          cleanupMutationObservation,
        );
      }
      return operationClaim(operation.key, "uninspected");
    },
  );

  claims.push(
    learnerObserved
      ? {
        id: `artifact-${ARTIFACT_ID}`,
        category: "artifact",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "artifact-authentic",
        state: "proven",
        artifact: {
          kind: "outlook-email",
          authenticity: "platform-native",
        },
        observation: learnerObservation,
      }
      : uninspectedArtifact(),
    learnerObserved
      ? {
        id: `visibility-${ARTIFACT_ID}`,
        category: "learner-visibility",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "learner-visible",
        state: "proven",
        observation: learnerObservation,
      }
      : uninspectedClaim(
        `visibility-${ARTIFACT_ID}`,
        "learner-visibility",
        "artifact",
        ARTIFACT_ID,
        "learner-visible",
      ),
    uninspectedClaim(
      "learner-interpretation",
      "learner-interpretation",
      "scenario",
      SCENARIO_ID,
      "learner-interpreted",
    ),
    uninspectedClaim(
      `response-${RESPONSE_ACTION}`,
      "response",
      "response-action",
      RESPONSE_ACTION,
      "response-completed",
    ),
    cleaned
      ? {
        id: `cleanup-${CLEANUP_OPERATION}`,
        category: "cleanup",
        subject: { kind: "operation", id: CLEANUP_OPERATION },
        assertion: "cleanup-completed",
        state: "proven",
        observation: terminalCleanupObservation,
      }
      : uninspectedClaim(
        `cleanup-${CLEANUP_OPERATION}`,
        "cleanup",
        "operation",
        CLEANUP_OPERATION,
        "cleanup-completed",
      ),
    cleaned
      ? {
        id: `retention-${ARTIFACT_ID}`,
        category: "retention",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "retention-confirmed",
        state: "absent",
        observation: terminalCleanupObservation,
      }
      : learnerObserved
      ? {
        id: `retention-${ARTIFACT_ID}`,
        category: "retention",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "retention-confirmed",
        state: "proven",
        observation: learnerObservation,
      }
      : uninspectedClaim(
        `retention-${ARTIFACT_ID}`,
        "retention",
        "artifact",
        ARTIFACT_ID,
        "retention-confirmed",
      ),
    learnerObserved
      ? terminalClaim(
        "terminal-outlook-email",
        "outlook-email",
        "artifact",
        ARTIFACT_ID,
        learnerObservation,
      )
      : terminalClaim(
        "terminal-outlook-email",
        "outlook-email",
        "artifact",
        ARTIFACT_ID,
      ),
    terminalClaim(
      "terminal-teams-call",
      "teams-call",
      "scenario",
      SCENARIO_ID,
    ),
    terminalClaim(
      "terminal-teams-voicemail",
      "teams-voicemail",
      "scenario",
      SCENARIO_ID,
    ),
  );

  return {
    schemaVersion: 1,
    scenario: { id: SCENARIO_ID, manifestSchemaVersion: 2 },
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: manifest.roles.workloadActor,
      learner: manifest.roles.learner,
    },
    claims,
  };
}

function operationClaim(
  operationKey: string,
  state: "proven" | "uninspected",
  observed?: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    id: `operation-${operationKey}`,
    category: "operation",
    subject: { kind: "operation", id: operationKey },
    assertion: "operation-completed",
    state,
    ...(observed === undefined ? {} : { observation: observed }),
  };
}

function uninspectedArtifact(): EvidenceReceiptClaim {
  return {
    ...uninspectedClaim(
      `artifact-${ARTIFACT_ID}`,
      "artifact",
      "artifact",
      ARTIFACT_ID,
      "artifact-authentic",
    ),
    artifact: {
      kind: "outlook-email",
      authenticity: "platform-native",
    },
  };
}

function uninspectedClaim(
  id: string,
  category: EvidenceReceiptClaim["category"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  assertion: EvidenceReceiptClaim["assertion"],
): EvidenceReceiptClaim {
  return {
    id,
    category,
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state: "uninspected",
  };
}

function terminalClaim(
  id: string,
  assertion: EvidenceReceiptClaim["assertion"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  observed?: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    id,
    category: "terminal-proof",
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state: observed === undefined ? "uninspected" : "proven",
    ...(observed === undefined ? {} : { observation: observed }),
  };
}

function observation(
  source: EvidenceReceiptObservation["source"],
  outcome: EvidenceReceiptObservation["outcome"],
  observerActorId: string,
  operationKey: string,
): EvidenceReceiptObservation {
  return { source, outcome, observerActorId, operationKey };
}

function rejectUnsafeInput(value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw failure("unsafe-input", "input must be bounded JSON.");
  }
  if (encoded === undefined || encoded.length > MAX_INPUT_BYTES) {
    throw failure("unsafe-input", "input exceeds the safe bound.");
  }
  let count = 0;
  const visit = (candidate: unknown, depth: number): void => {
    count += 1;
    if (count > MAX_VALUES || depth > MAX_DEPTH) {
      throw failure("unsafe-input", "input exceeds structural bounds.");
    }
    if (typeof candidate === "string") {
      if (
        candidate.length > 100 ||
        GUID.test(candidate) ||
        UPN.test(candidate) ||
        PRIVATE_PATH.test(candidate) ||
        TIMESTAMP.test(candidate) ||
        SECRET.test(candidate) ||
        MARKER.test(candidate)
      ) {
        throw failure("unsafe-input", "raw or sensitive values are forbidden.");
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (candidate !== null && typeof candidate === "object") {
      for (const [key, child] of Object.entries(candidate)) {
        if (FORBIDDEN_KEY.test(key)) {
          throw failure("unsafe-input", "raw evidence fields are forbidden.");
        }
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
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
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function failure(
  code: HelpDeskEmailReceiptAdapterErrorCode,
  detail: string,
): HelpDeskEmailReceiptAdapterError {
  return new HelpDeskEmailReceiptAdapterError(code, detail);
}
