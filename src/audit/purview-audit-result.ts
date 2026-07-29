const RESULT_STATUSES = [
  "officially-supported",
  "live-proven",
  "observed-but-incomplete",
  "licensing-or-latency-blocked",
  "unsupported",
] as const;

const INCOMPLETE_REASONS = [
  "producer-application-absent",
  "correlation-absent",
  "target-absent",
  "no-matching-record",
] as const;

export type PurviewAuditResultStatus = typeof RESULT_STATUSES[number];
export type PurviewAuditIncompleteReason = typeof INCOMPLETE_REASONS[number];

export interface PurviewAuditValidationContext {
  workloadActor: string;
  detector: string;
  producerApplicationId: string;
  allowedOperations: readonly string[];
  targetMarker: string;
  filterStartDateTime: string;
  filterEndDateTime: string;
}

interface PurviewAuditResultBase {
  schemaVersion: 1;
  surface: "microsoft-graph-purview-audit-search-v1";
  scenario: "sharepoint-operation";
  evidenceProducer: string;
  workloadActor: string;
  detector: string;
  learner: string;
  officialContract: {
    applicationOnlySupported: true;
    minimumApplicationPermission: "AuditLogsQuery-SharePoint.Read.All";
    ingestionLatency:
      "typically-60-to-90-minutes-with-no-guaranteed-upper-bound";
  };
}

export interface PurviewOperationRecord {
  recordId: string;
  recordType: "sharePointFileOperation";
  workload: "SharePoint";
  operation: string;
  occurredAt: string;
  targetType: string;
  targetId: string;
  producerApplicationId: string;
  correlationId: string;
}

export type PurviewAuditCapabilityResult =
  | (PurviewAuditResultBase & {
    status: "officially-supported";
    detail: string;
  })
  | (PurviewAuditResultBase & {
    status: "live-proven";
    record: PurviewOperationRecord;
  })
  | (PurviewAuditResultBase & {
    status: "observed-but-incomplete";
    reason: PurviewAuditIncompleteReason;
    detail: string;
  })
  | (PurviewAuditResultBase & {
    status: "licensing-or-latency-blocked";
    detail: string;
  })
  | (PurviewAuditResultBase & {
    status: "unsupported";
    detail: string;
  });

export class PurviewAuditResultError extends Error {
  constructor(message: string) {
    super(`Invalid Purview audit result: ${message}`);
    this.name = "PurviewAuditResultError";
  }
}

export function parsePurviewAuditCapabilityResult(
  value: unknown,
  validation: PurviewAuditValidationContext,
): PurviewAuditCapabilityResult {
  const result = record(value, "result");
  if (result.schemaVersion !== 1) {
    throw new PurviewAuditResultError("schemaVersion must be 1.");
  }
  if (result.surface !== "microsoft-graph-purview-audit-search-v1") {
    throw new PurviewAuditResultError(
      "surface must be Microsoft Graph Purview Audit Search v1.",
    );
  }
  if (result.scenario !== "sharepoint-operation") {
    throw new PurviewAuditResultError(
      "scenario must be sharepoint-operation; sign-in evidence is insufficient.",
    );
  }

  const base: PurviewAuditResultBase = {
    schemaVersion: 1,
    surface: "microsoft-graph-purview-audit-search-v1",
    scenario: "sharepoint-operation",
    evidenceProducer: text(result.evidenceProducer, "evidenceProducer"),
    workloadActor: text(result.workloadActor, "workloadActor"),
    detector: text(result.detector, "detector"),
    learner: text(result.learner, "learner"),
    officialContract: parseOfficialContract(result.officialContract),
  };
  if (base.workloadActor === base.detector) {
    throw new PurviewAuditResultError(
      "detector and workloadActor must be distinct.",
    );
  }
  if (
    base.workloadActor !==
      text(validation.workloadActor, "validation.workloadActor") ||
    base.detector !== text(validation.detector, "validation.detector")
  ) {
    throw new PurviewAuditResultError(
      "result actors do not match the frozen validation context.",
    );
  }

  const status = enumValue(result.status, RESULT_STATUSES, "status");
  switch (status) {
    case "officially-supported":
      return { ...base, status, detail: text(result.detail, "detail") };
    case "live-proven":
      return {
        ...base,
        status,
        record: parseOperationRecord(result.record, validation),
      };
    case "observed-but-incomplete":
      return {
        ...base,
        status,
        reason: enumValue(result.reason, INCOMPLETE_REASONS, "reason"),
        detail: text(result.detail, "detail"),
      };
    case "licensing-or-latency-blocked":
    case "unsupported":
      return { ...base, status, detail: text(result.detail, "detail") };
  }
}

function parseOfficialContract(value: unknown):
  PurviewAuditResultBase["officialContract"] {
  const contract = record(value, "officialContract");
  if (contract.applicationOnlySupported !== true) {
    throw new PurviewAuditResultError(
      "officialContract.applicationOnlySupported must be true.",
    );
  }
  if (
    contract.minimumApplicationPermission !==
      "AuditLogsQuery-SharePoint.Read.All"
  ) {
    throw new PurviewAuditResultError(
      "officialContract.minimumApplicationPermission is not SharePoint-only.",
    );
  }
  if (
    contract.ingestionLatency !==
      "typically-60-to-90-minutes-with-no-guaranteed-upper-bound"
  ) {
    throw new PurviewAuditResultError(
      "officialContract.ingestionLatency is not the supported boundary.",
    );
  }
  return {
    applicationOnlySupported: true,
    minimumApplicationPermission: "AuditLogsQuery-SharePoint.Read.All",
    ingestionLatency:
      "typically-60-to-90-minutes-with-no-guaranteed-upper-bound",
  };
}

function parseOperationRecord(
  value: unknown,
  validation: PurviewAuditValidationContext,
): PurviewOperationRecord {
  const item = record(value, "record");
  if (item.recordType !== "sharePointFileOperation") {
    throw new PurviewAuditResultError(
      "record.recordType must be sharePointFileOperation.",
    );
  }
  if (item.workload !== "SharePoint") {
    throw new PurviewAuditResultError("record.workload must be SharePoint.");
  }
  const operationRecord: PurviewOperationRecord = {
    recordId: text(item.recordId, "record.recordId"),
    recordType: "sharePointFileOperation",
    workload: "SharePoint",
    operation: text(item.operation, "record.operation"),
    occurredAt: isoDateTime(item.occurredAt, "record.occurredAt"),
    targetType: text(item.targetType, "record.targetType"),
    targetId: text(item.targetId, "record.targetId"),
    producerApplicationId: text(
      item.producerApplicationId,
      "record.producerApplicationId",
    ),
    correlationId: text(item.correlationId, "record.correlationId"),
  };
  const allowedOperations = validation.allowedOperations.map(
    (operation, index) =>
      text(operation, `validation.allowedOperations[${index}]`),
  );
  if (
    allowedOperations.length === 0 ||
    !allowedOperations.includes(operationRecord.operation)
  ) {
    throw new PurviewAuditResultError(
      "record.operation is outside the frozen validation context.",
    );
  }
  if (
    operationRecord.producerApplicationId !==
      text(
        validation.producerApplicationId,
        "validation.producerApplicationId",
      )
  ) {
    throw new PurviewAuditResultError(
      "record.producerApplicationId does not match the frozen producer.",
    );
  }
  if (
    !operationRecord.targetId.includes(
      text(validation.targetMarker, "validation.targetMarker"),
    )
  ) {
    throw new PurviewAuditResultError(
      "record.targetId does not contain the frozen marker.",
    );
  }
  const start = Date.parse(
    isoDateTime(
      validation.filterStartDateTime,
      "validation.filterStartDateTime",
    ),
  );
  const end = Date.parse(
    isoDateTime(
      validation.filterEndDateTime,
      "validation.filterEndDateTime",
    ),
  );
  const occurredAt = Date.parse(operationRecord.occurredAt);
  if (start > end || occurredAt < start || occurredAt > end) {
    throw new PurviewAuditResultError(
      "record.occurredAt is outside the frozen validation window.",
    );
  }
  return operationRecord;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PurviewAuditResultError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PurviewAuditResultError(`${field} must be non-empty text.`);
  }
  return value.trim();
}

function isoDateTime(value: unknown, field: string): string {
  const parsed = text(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) ||
    Number.isNaN(Date.parse(parsed))
  ) {
    throw new PurviewAuditResultError(
      `${field} must be an ISO 8601 UTC timestamp.`,
    );
  }
  return parsed;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new PurviewAuditResultError(
      `${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}
