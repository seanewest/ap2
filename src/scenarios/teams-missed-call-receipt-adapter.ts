import {
  verifyScenarioEvidenceReceipt,
  type EvidenceReceiptClaim,
  type EvidenceReceiptObservation,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import type {
  ScenarioAdapterCapabilityDeclaration,
} from "./scenario-surface-capability.ts";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call.ts";

const SCENARIO_ID = "teams-missed-call-observation";
const STAGE_OPERATION = "stage-one-audio-call";
const READ_OPERATION = "read-cory-call-history";
const INTERPRET_OPERATION = "interpret-missed-call";
const CLEANUP_OPERATION = "clean-retained-call-history";
const RESPONSE_ACTION = "report-observation";
const ARTIFACT_ID = "cory-missed-call";
const MAX_INPUT_BYTES = 4_096;
const MAX_DEPTH = 6;
const MAX_VALUES = 80;
const FORBIDDEN_KEY =
  /^(?:user|tenant|call|session|message|activity)Id$|^(?:upn|timestamp|duration|screenshot|marker|token|path|clientState|browserState|payload|request|response|error|text)$/i;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PRIVATE_PATH = /(?:\/(?:home|Users|mnt\/[a-z])\/|[A-Z]:\\|\\\\)/i;
const TIMESTAMP =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/i;
const SECRET =
  /(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|-----BEGIN|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)/i;
const MARKER =
  /\b(?:ap2-[a-z0-9][a-z0-9-]{7,}|teams-missed-call-controlled-[a-z0-9-]+)\b/i;

export const TEAMS_MISSED_CALL_RECEIPT_ADAPTER_CAPABILITY = {
  schemaVersion: 1,
  adapter: "teams-missed-call",
  scenarioId: SCENARIO_ID,
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioAdapterCapabilityDeclaration;

export interface SanitizedTeamsCallStageResult {
  operation: typeof STAGE_OPERATION;
  outcome: "completed";
  attempt: "one";
  actorPath: "licensed-user";
  media: "audio-only";
  observerRole: "evidenceProducer";
}

export interface SanitizedTeamsCallStageJournalEntry {
  sequence: 1 | 2;
  operation: typeof STAGE_OPERATION;
  transition: "attempted" | "completed";
}

export type TeamsNativeObservation =
  | { state: "uninspected" }
  | {
      state: "observed";
      observerRole: "learner";
      operation: typeof READ_OPERATION;
      history: "one-missed-incoming";
      activity: "one-matching-notification";
      authenticity: "platform-native";
    };

export type TeamsInterpretationObservation =
  | { state: "uninspected" }
  | {
      state: "reported";
      observerRole: "learner";
      operation: typeof INTERPRET_OPERATION;
      responseAction: typeof RESPONSE_ACTION;
      conclusion: "missed-teams-call-without-voicemail";
    };

export type TeamsHistoryCleanupObservation =
  | { state: "uninspected" }
  | {
      state: "cleaned";
      mutationObserverRole: "evidenceProducer";
      mutationOperation: typeof CLEANUP_OPERATION;
      terminalObserverRole: "learner";
      terminalOperation: typeof READ_OPERATION;
      history: "absent";
      activity: "absent";
      retention: "absent";
    };

export interface TeamsMissedCallReceiptAdapterInput {
  schemaVersion: 1;
  scenarioId: typeof SCENARIO_ID;
  stage: SanitizedTeamsCallStageResult;
  journal: readonly SanitizedTeamsCallStageJournalEntry[];
  nativeObservation: TeamsNativeObservation;
  interpretation: TeamsInterpretationObservation;
  cleanup: TeamsHistoryCleanupObservation;
}

export function canonicalTeamsMissedCallReceiptAdapterInput():
  TeamsMissedCallReceiptAdapterInput {
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    stage: {
      operation: STAGE_OPERATION,
      outcome: "completed",
      attempt: "one",
      actorPath: "licensed-user",
      media: "audio-only",
      observerRole: "evidenceProducer",
    },
    journal: [
      {
        sequence: 1,
        operation: STAGE_OPERATION,
        transition: "attempted",
      },
      {
        sequence: 2,
        operation: STAGE_OPERATION,
        transition: "completed",
      },
    ],
    nativeObservation: { state: "uninspected" },
    interpretation: { state: "uninspected" },
    cleanup: { state: "uninspected" },
  };
}

export type TeamsMissedCallReceiptAdapterErrorCode =
  | "shape"
  | "unsafe-input"
  | "scenario-mismatch"
  | "sequence"
  | "stage-outcome"
  | "observation-mismatch"
  | "role-conflation"
  | "cleanup-gap"
  | "semantic-overclaim";

export class TeamsMissedCallReceiptAdapterError extends Error {
  readonly code: TeamsMissedCallReceiptAdapterErrorCode;

  constructor(code: TeamsMissedCallReceiptAdapterErrorCode, detail: string) {
    super(`Invalid Teams missed-call receipt input [${code}]: ${detail}`);
    this.name = "TeamsMissedCallReceiptAdapterError";
    this.code = code;
  }
}

export function adaptTeamsMissedCallObservationToReceipt(
  value: unknown,
): ScenarioEvidenceReceipt {
  rejectUnsafeInput(value);
  const input = parseInput(value);
  validateInput(input);
  const receipt = buildReceipt(input);
  verifyScenarioEvidenceReceipt(receipt, TEAMS_MISSED_CALL_SCENARIO);
  return deepFreeze(receipt);
}

function parseInput(value: unknown): TeamsMissedCallReceiptAdapterInput {
  const input = record(value);
  exactKeys(input, [
    "schemaVersion",
    "scenarioId",
    "stage",
    "journal",
    "nativeObservation",
    "interpretation",
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
    stage: parseStage(input.stage),
    journal: input.journal.map(parseJournalEntry),
    nativeObservation: parseNativeObservation(input.nativeObservation),
    interpretation: parseInterpretation(input.interpretation),
    cleanup: parseCleanup(input.cleanup),
  };
}

function parseStage(value: unknown): SanitizedTeamsCallStageResult {
  const stage = record(value);
  exactKeys(stage, [
    "operation",
    "outcome",
    "attempt",
    "actorPath",
    "media",
    "observerRole",
  ]);
  if (
    stage.operation !== STAGE_OPERATION ||
    stage.outcome !== "completed" ||
    stage.attempt !== "one" ||
    stage.actorPath !== "licensed-user" ||
    stage.media !== "audio-only" ||
    stage.observerRole !== "evidenceProducer"
  ) {
    if (
      ["ambiguous", "refused", "pre-identity", "failed", "incomplete"].includes(
        String(stage.outcome),
      )
    ) {
      throw failure(
        "stage-outcome",
        "only one completed licensed-user attempt can be adapted.",
      );
    }
    if (stage.actorPath === "graph-bot" || stage.actorPath === "bot") {
      throw failure(
        "role-conflation",
        "the blocked bot path is not the licensed-user staging path.",
      );
    }
    throw failure("observation-mismatch", "stage result is unsupported.");
  }
  return {
    operation: STAGE_OPERATION,
    outcome: "completed",
    attempt: "one",
    actorPath: "licensed-user",
    media: "audio-only",
    observerRole: "evidenceProducer",
  };
}

function parseJournalEntry(
  value: unknown,
  index: number,
): SanitizedTeamsCallStageJournalEntry {
  const entry = record(value);
  exactKeys(entry, ["sequence", "operation", "transition"]);
  const expectedSequence = index + 1;
  const expectedTransition = index === 0 ? "attempted" : "completed";
  if (
    entry.sequence !== expectedSequence ||
    entry.operation !== STAGE_OPERATION ||
    entry.transition !== expectedTransition
  ) {
    throw failure(
      "sequence",
      "journal is duplicated, reordered, mismatched, or incomplete.",
    );
  }
  return {
    sequence: expectedSequence as 1 | 2,
    operation: STAGE_OPERATION,
    transition: expectedTransition,
  };
}

function parseNativeObservation(value: unknown): TeamsNativeObservation {
  const observation = record(value);
  if (observation.state === "uninspected") {
    exactKeys(observation, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(observation, [
    "state",
    "observerRole",
    "operation",
    "history",
    "activity",
    "authenticity",
  ]);
  if (
    observation.state !== "observed" ||
    observation.observerRole !== "learner" ||
    observation.operation !== READ_OPERATION ||
    observation.history !== "one-missed-incoming" ||
    observation.activity !== "one-matching-notification" ||
    observation.authenticity !== "platform-native"
  ) {
    if (observation.observerRole === "evidenceProducer") {
      throw failure(
        "role-conflation",
        "the originator cannot supply Cory-side learner evidence.",
      );
    }
    throw failure(
      "observation-mismatch",
      "both exact native Cory-side surfaces are required.",
    );
  }
  return {
    state: "observed",
    observerRole: "learner",
    operation: READ_OPERATION,
    history: "one-missed-incoming",
    activity: "one-matching-notification",
    authenticity: "platform-native",
  };
}

function parseInterpretation(
  value: unknown,
): TeamsInterpretationObservation {
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
    "conclusion",
  ]);
  if (
    interpretation.state !== "reported" ||
    interpretation.observerRole !== "learner" ||
    interpretation.operation !== INTERPRET_OPERATION ||
    interpretation.responseAction !== RESPONSE_ACTION ||
    interpretation.conclusion !==
      "missed-teams-call-without-voicemail"
  ) {
    if (interpretation.observerRole === "evidenceProducer") {
      throw failure(
        "role-conflation",
        "the originator cannot supply learner interpretation.",
      );
    }
    throw failure(
      "semantic-overclaim",
      "interpretation must exclude voicemail and callback inference.",
    );
  }
  return {
    state: "reported",
    observerRole: "learner",
    operation: INTERPRET_OPERATION,
    responseAction: RESPONSE_ACTION,
    conclusion: "missed-teams-call-without-voicemail",
  };
}

function parseCleanup(value: unknown): TeamsHistoryCleanupObservation {
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
    "history",
    "activity",
    "retention",
  ]);
  if (
    cleanup.state !== "cleaned" ||
    cleanup.mutationObserverRole !== "evidenceProducer" ||
    cleanup.mutationOperation !== CLEANUP_OPERATION ||
    cleanup.terminalObserverRole !== "learner" ||
    cleanup.terminalOperation !== READ_OPERATION ||
    cleanup.history !== "absent" ||
    cleanup.activity !== "absent" ||
    cleanup.retention !== "absent"
  ) {
    if (
      cleanup.mutationObserverRole === "learner" ||
      cleanup.terminalObserverRole === "evidenceProducer"
    ) {
      throw failure(
        "role-conflation",
        "cleanup mutation and Cory-side terminal read are conflated.",
      );
    }
    throw failure(
      "cleanup-gap",
      "both native surfaces require a separate terminal absence read.",
    );
  }
  return {
    state: "cleaned",
    mutationObserverRole: "evidenceProducer",
    mutationOperation: CLEANUP_OPERATION,
    terminalObserverRole: "learner",
    terminalOperation: READ_OPERATION,
    history: "absent",
    activity: "absent",
    retention: "absent",
  };
}

function validateInput(input: TeamsMissedCallReceiptAdapterInput): void {
  if (
    input.stage.outcome !== "completed" ||
    input.journal[0]?.transition !== "attempted" ||
    input.journal[1]?.transition !== "completed"
  ) {
    throw failure(
      "stage-outcome",
      "result and journal do not prove one completed attempt.",
    );
  }
  if (
    input.interpretation.state === "reported" &&
    input.nativeObservation.state !== "observed"
  ) {
    throw failure(
      "semantic-overclaim",
      "interpretation cannot precede native learner observation.",
    );
  }
  if (
    input.cleanup.state === "cleaned" &&
    input.nativeObservation.state !== "observed"
  ) {
    throw failure(
      "cleanup-gap",
      "cleanup cannot precede native learner observation.",
    );
  }
}

function buildReceipt(
  input: TeamsMissedCallReceiptAdapterInput,
): ScenarioEvidenceReceipt {
  const manifest = TEAMS_MISSED_CALL_SCENARIO;
  const nativeObserved = input.nativeObservation.state === "observed";
  const interpreted = input.interpretation.state === "reported";
  const cleaned = input.cleanup.state === "cleaned";
  const stageObservation = observation(
    "provider-response",
    "human-assisted-artifact",
    manifest.roles.evidenceProducer,
    STAGE_OPERATION,
  );
  const nativeObservation = observation(
    "learner-view",
    "learner-inspection",
    manifest.roles.learner,
    READ_OPERATION,
  );
  const interpretationObservation = observation(
    "learner-view",
    "learner-inspection",
    manifest.roles.learner,
    INTERPRET_OPERATION,
  );
  const cleanupMutationObservation = observation(
    "provider-response",
    "operation-result",
    manifest.roles.evidenceProducer,
    CLEANUP_OPERATION,
  );
  const cleanupTerminalObservation = observation(
    "learner-view",
    "exact-reconciliation",
    manifest.roles.learner,
    READ_OPERATION,
  );
  const claims: EvidenceReceiptClaim[] = manifest.operations.map(
    (operation) => {
      if (operation.key === STAGE_OPERATION) {
        return operationClaim(operation.key, stageObservation);
      }
      if (operation.key === READ_OPERATION && nativeObserved) {
        return operationClaim(operation.key, nativeObservation);
      }
      if (operation.key === INTERPRET_OPERATION && interpreted) {
        return operationClaim(operation.key, interpretationObservation);
      }
      if (operation.key === CLEANUP_OPERATION && cleaned) {
        return operationClaim(operation.key, cleanupMutationObservation);
      }
      return operationClaim(operation.key);
    },
  );

  claims.push(
    nativeObserved
      ? {
        id: `artifact-${ARTIFACT_ID}`,
        category: "artifact",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "artifact-authentic",
        state: "proven",
        artifact: {
          kind: "teams-missed-call",
          authenticity: "platform-native",
        },
        observation: {
          ...nativeObservation,
          outcome: "human-assisted-artifact",
        },
      }
      : uninspectedArtifact(),
    nativeObserved
      ? {
        id: `visibility-${ARTIFACT_ID}`,
        category: "learner-visibility",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "learner-visible",
        state: "proven",
        observation: nativeObservation,
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
    interpreted
      ? {
        id: `response-${RESPONSE_ACTION}`,
        category: "response",
        subject: { kind: "response-action", id: RESPONSE_ACTION },
        assertion: "response-completed",
        state: "proven",
        observation: interpretationObservation,
      }
      : uninspectedClaim(
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
        observation: cleanupTerminalObservation,
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
        observation: cleanupTerminalObservation,
      }
      : nativeObserved
      ? {
        id: `retention-${ARTIFACT_ID}`,
        category: "retention",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "retention-confirmed",
        state: "proven",
        observation: {
          ...nativeObservation,
          outcome: "platform-event",
        },
      }
      : uninspectedClaim(
        `retention-${ARTIFACT_ID}`,
        "retention",
        "artifact",
        ARTIFACT_ID,
        "retention-confirmed",
      ),
    nativeObserved
      ? terminalClaim(
        "terminal-teams-missed-call",
        "teams-missed-call",
        "artifact",
        ARTIFACT_ID,
        {
          ...nativeObservation,
          outcome: "human-assisted-artifact",
        },
      )
      : terminalClaim(
        "terminal-teams-missed-call",
        "teams-missed-call",
        "artifact",
        ARTIFACT_ID,
      ),
    nativeObserved
      ? terminalClaim(
        "terminal-teams-call",
        "teams-call",
        "artifact",
        ARTIFACT_ID,
        {
          ...nativeObservation,
          outcome: "human-assisted-artifact",
        },
      )
      : terminalClaim(
        "terminal-teams-call",
        "teams-call",
        "artifact",
        ARTIFACT_ID,
      ),
    terminalClaim(
      "terminal-unattended-automation",
      "unattended-automation",
      "operation",
      STAGE_OPERATION,
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
  observed?: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    id: `operation-${operationKey}`,
    category: "operation",
    subject: { kind: "operation", id: operationKey },
    assertion: "operation-completed",
    state: observed === undefined ? "uninspected" : "proven",
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
      kind: "teams-missed-call",
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
  let encoded: string | undefined;
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
  code: TeamsMissedCallReceiptAdapterErrorCode,
  detail: string,
): TeamsMissedCallReceiptAdapterError {
  return new TeamsMissedCallReceiptAdapterError(code, detail);
}
