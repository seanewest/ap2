import {
  type EvidenceReceiptClaim,
  type EvidenceReceiptObservation,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from "./purview-audit-boundary.ts";

const SCENARIO_ID = "purview-sharepoint-audit-boundary";
const READ_OPERATION = "read-bounded-audit-status";
const ARTIFACT_ID = "purview-query-boundary";
const ALLOWED_OPERATIONS = [
  "FileUploaded",
  "FileRecycled",
  "FileDeleted",
] as const;

export type PurviewOperationReceiptAdapterErrorCode =
  | "shape"
  | "scenario-mismatch"
  | "role-conflation"
  | "observation-mismatch"
  | "semantic-overclaim";

export interface PurviewOperationReceiptAdapterInput {
  schemaVersion: 1;
  scenario: {
    id: typeof SCENARIO_ID;
    manifestSchemaVersion: 2;
  };
  roles: {
    evidenceProducer: "purview-lab-harness";
    workloadActor: "sharepoint-workload-app";
    learner: "security-learner";
    detector: "purview-detector-app";
  };
  result: {
    status: "live-proven";
    observationSource: "independent-detector";
    workload: "SharePoint";
    recordType: "sharePointFileOperation";
    operation: typeof ALLOWED_OPERATIONS[number];
    producerApplication: "matches-workload-actor";
    occurredAt: "inside-frozen-window";
    target: "marker-bearing";
    targetType: "present";
    correlation: "present";
    recordSet: "bounded-unpaged-deduplicated";
    uniqueMatches: "one-or-more";
  };
}

export class PurviewOperationReceiptAdapterError extends Error {
  readonly code: PurviewOperationReceiptAdapterErrorCode;

  constructor(code: PurviewOperationReceiptAdapterErrorCode) {
    super(`Purview operation receipt adaptation failed: ${code}`);
    this.name = "PurviewOperationReceiptAdapterError";
    this.code = code;
  }
}

export function adaptPurviewOperationToReceipt(
  value: unknown,
): ScenarioEvidenceReceipt {
  const input = parseInput(value);
  const manifest = PURVIEW_AUDIT_BOUNDARY_SCENARIO;
  const observation: EvidenceReceiptObservation = {
    source: "independent-detector",
    outcome: "record-match",
    observerActorId: manifest.roles.detector!,
    operationKey: READ_OPERATION,
  };
  const claims: EvidenceReceiptClaim[] = manifest.operations.map(
    (operation) =>
      operation.key === READ_OPERATION
        ? claim(
          `operation-${operation.key}`,
          "operation",
          "operation",
          operation.key,
          "operation-completed",
          "proven",
          observation,
        )
        : claim(
          `operation-${operation.key}`,
          "operation",
          "operation",
          operation.key,
          "operation-completed",
          "uninspected",
        ),
  );

  for (const artifact of manifest.evidence.artifacts) {
    claims.push(
      claim(
        `artifact-${artifact.id}`,
        "artifact",
        "artifact",
        artifact.id,
        "artifact-authentic",
        "proven",
        observation,
        {
          kind: artifact.kind,
          authenticity: artifact.authenticity,
        },
      ),
      claim(
        `visibility-${artifact.id}`,
        "learner-visibility",
        "artifact",
        artifact.id,
        "learner-visible",
        "uninspected",
      ),
      claim(
        `retention-${artifact.id}`,
        "retention",
        "artifact",
        artifact.id,
        "retention-confirmed",
        "uninspected",
      ),
    );
  }

  claims.push(
    claim(
      "learner-interpretation",
      "learner-interpretation",
      "scenario",
      SCENARIO_ID,
      "learner-interpreted",
      "uninspected",
    ),
    ...manifest.responseActions.map((action) =>
      claim(
        `response-${action.id}`,
        "response",
        "response-action",
        action.id,
        "response-completed",
        "uninspected",
      )
    ),
    ...manifest.lifecycle.cleanupOperationKeys.map((operationKey) =>
      claim(
        `cleanup-${operationKey}`,
        "cleanup",
        "operation",
        operationKey,
        "cleanup-completed",
        "uninspected",
      )
    ),
    independentClaim(
      "detector-independent",
      "detector-independent",
      observation,
    ),
    independentClaim(
      "surface-reachability",
      "surface-reachability",
      observation,
    ),
    independentClaim(
      "producer-attribution",
      "producer-attribution",
      observation,
    ),
    claim(
      "terminal-purview-surface",
      "terminal-proof",
      "artifact",
      ARTIFACT_ID,
      "purview-surface-reachability",
      "proven",
      observation,
    ),
  );

  return {
    schemaVersion: 1,
    scenario: input.scenario,
    roles: input.roles,
    claims,
  };
}

function parseInput(value: unknown): PurviewOperationReceiptAdapterInput {
  const input = exactRecord(value, [
    "schemaVersion",
    "scenario",
    "roles",
    "result",
  ]);
  if (input.schemaVersion !== 1) throw failure("shape");
  const scenario = exactRecord(input.scenario, [
    "id",
    "manifestSchemaVersion",
  ]);
  if (
    scenario.id !== SCENARIO_ID ||
    scenario.manifestSchemaVersion !== 2
  ) {
    throw failure("scenario-mismatch");
  }
  const roles = exactRecord(input.roles, [
    "evidenceProducer",
    "workloadActor",
    "learner",
    "detector",
  ]);
  if (roles.workloadActor === roles.detector) {
    throw failure("role-conflation");
  }
  const manifestRoles = PURVIEW_AUDIT_BOUNDARY_SCENARIO.roles;
  if (
    roles.evidenceProducer !== manifestRoles.evidenceProducer ||
    roles.workloadActor !== manifestRoles.workloadActor ||
    roles.learner !== manifestRoles.learner ||
    roles.detector !== manifestRoles.detector
  ) {
    throw failure("observation-mismatch");
  }
  const result = exactRecord(input.result, [
    "status",
    "observationSource",
    "workload",
    "recordType",
    "operation",
    "producerApplication",
    "occurredAt",
    "target",
    "targetType",
    "correlation",
    "recordSet",
    "uniqueMatches",
  ]);
  if (result.status !== "live-proven") {
    throw failure("semantic-overclaim");
  }
  if (
    result.observationSource !== "independent-detector" ||
    result.workload !== "SharePoint" ||
    result.recordType !== "sharePointFileOperation" ||
    !ALLOWED_OPERATIONS.includes(
      result.operation as typeof ALLOWED_OPERATIONS[number],
    ) ||
    result.producerApplication !== "matches-workload-actor" ||
    result.occurredAt !== "inside-frozen-window" ||
    result.target !== "marker-bearing" ||
    result.targetType !== "present" ||
    result.correlation !== "present" ||
    result.recordSet !== "bounded-unpaged-deduplicated" ||
    result.uniqueMatches !== "one-or-more"
  ) {
    throw failure("observation-mismatch");
  }
  return value as PurviewOperationReceiptAdapterInput;
}

function claim(
  id: string,
  category: EvidenceReceiptClaim["category"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  assertion: EvidenceReceiptClaim["assertion"],
  state: "proven" | "uninspected",
  observation?: EvidenceReceiptObservation,
  artifact?: EvidenceReceiptClaim["artifact"],
): EvidenceReceiptClaim {
  return {
    id,
    category,
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state,
    ...(observation === undefined ? {} : { observation }),
    ...(artifact === undefined ? {} : { artifact }),
  };
}

function independentClaim(
  id: "detector-independent" | "surface-reachability" | "producer-attribution",
  assertion:
    | "detector-independent"
    | "surface-reachability"
    | "producer-attribution",
  observation: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return claim(
    id,
    "independent-observation",
    "scenario",
    SCENARIO_ID,
    assertion,
    "proven",
    observation,
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw failure("shape");
  }
  return value as Record<string, unknown>;
}

function failure(
  code: PurviewOperationReceiptAdapterErrorCode,
): PurviewOperationReceiptAdapterError {
  return new PurviewOperationReceiptAdapterError(code);
}
