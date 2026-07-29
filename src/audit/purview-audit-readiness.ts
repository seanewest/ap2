const APPLICATION_PERMISSION = {
  id: "91c64a47-a524-4fce-9bf3-3d569a344ecf",
  name: "AuditLogsQuery-SharePoint.Read.All",
  consent: "administrator" as const,
};

const ALLOWED_OPERATIONS = [
  "FileUploaded",
  "FileRecycled",
  "FileDeleted",
] as const;

const INPUT_KEYS = [
  "cloud",
  "auditTier",
  "unifiedAuditLogging",
  "authorizationMode",
  "grantedPermissionIds",
  "purviewAuditRole",
  "producerApplicationId",
  "detectorApplicationId",
  "marker",
  "operation",
  "filterStartDateTime",
  "filterEndDateTime",
] as const;

const BLOCKER_ORDER = [
  "invalid-input",
  "unsupported-cloud",
  "audit-license-unavailable",
  "audit-license-unknown",
  "audit-logging-disabled",
  "audit-logging-unknown",
  "missing-permission",
  "identity-conflation",
  "invalid-marker",
  "unsupported-operation",
  "invalid-time-window",
] as const;

export const PURVIEW_AUDIT_MAX_WINDOW_MINUTES = 30 as const;
export const PURVIEW_AUDIT_RESULT_PAGE_SIZE = 10 as const;
export const PURVIEW_AUDIT_MAX_RESULT_PAGES = 1 as const;

export type PurviewAuditReadinessBlocker = typeof BLOCKER_ORDER[number];

export interface PurviewAuditReadinessInput {
  cloud: "global";
  auditTier: "standard" | "premium" | "unavailable" | "unknown";
  unifiedAuditLogging: "enabled" | "disabled" | "unknown";
  authorizationMode: "application";
  grantedPermissionIds: readonly string[];
  purviewAuditRole:
    | "none"
    | "view-only-audit-logs"
    | "audit-logs"
    | "unknown";
  producerApplicationId: string;
  detectorApplicationId: string;
  marker: string;
  operation: typeof ALLOWED_OPERATIONS[number];
  filterStartDateTime: string;
  filterEndDateTime: string;
}

interface PurviewAuditReadinessBase {
  schemaVersion: 1;
  surface: "microsoft-graph-purview-audit-search-v1";
  workload: "SharePoint";
  proof: "readiness-only-search-not-submitted";
}

export interface PurviewAuditBlockedReadiness extends PurviewAuditReadinessBase {
  status: "blocked";
  blockers: readonly PurviewAuditReadinessBlocker[];
}

export interface PurviewAuditReadyPlan extends PurviewAuditReadinessBase {
  status: "ready";
  authorization: {
    mode: "application";
    permission: typeof APPLICATION_PERMISSION;
    purviewRoleRequirement: "not-applicable-to-application-only";
    producerObserverSeparation: "required";
  };
  query: {
    method: "POST";
    path: "/v1.0/security/auditLog/queries";
    body: {
      displayName: string;
      filterStartDateTime: string;
      filterEndDateTime: string;
      recordTypeFilters: readonly ["sharePointFileOperation"];
      serviceFilter: "SharePoint";
      operationFilters: readonly [typeof ALLOWED_OPERATIONS[number]];
      keywordFilter: string;
    };
    acceptanceMeaning: "search-job-accepted-not-evidence";
    ambiguousWriteReconciliation:
      "list-and-require-one-exact-display-name-before-any-new-post";
  };
  observation: {
    statusPath: "/v1.0/security/auditLog/queries/{query-id}";
    recordsPath:
      "/v1.0/security/auditLog/queries/{query-id}/records?$top=10";
    terminalSuccess: "succeeded";
    pageSize: 10;
    maximumPages: 1;
    maximumRecords: 10;
    nextLinkMeaning: "bounded-result-incomplete";
    throttling:
      "honor-retry-after-on-a-separate-read-attempt-never-replay-post";
    requiredRecordMatch: {
      recordType: "sharePointFileOperation";
      workload: "SharePoint";
      producerApplicationId: string;
      operation: typeof ALLOWED_OPERATIONS[number];
      marker: string;
      timeWindow: {
        start: string;
        end: string;
      };
      requireTargetType: true;
      requireCorrelation: true;
    };
  };
  retention: {
    searchJobHistory: "service-retained-no-graph-v1-delete-method";
    auditStandard: "180-days";
    ingestionLatency:
      "typically-60-to-90-minutes-with-no-guaranteed-upper-bound";
  };
}

export type PurviewAuditReadinessResult =
  | PurviewAuditBlockedReadiness
  | PurviewAuditReadyPlan;

export function planPurviewAuditReadiness(
  value: unknown,
): PurviewAuditReadinessResult {
  const base: PurviewAuditReadinessBase = {
    schemaVersion: 1,
    surface: "microsoft-graph-purview-audit-search-v1",
    workload: "SharePoint",
    proof: "readiness-only-search-not-submitted",
  };
  if (!isRecord(value)) {
    return { ...base, status: "blocked", blockers: ["invalid-input"] };
  }

  const blockers = new Set<PurviewAuditReadinessBlocker>();
  if (
    Object.keys(value).length !== INPUT_KEYS.length ||
    Object.keys(value).some((key) =>
      !INPUT_KEYS.includes(key as typeof INPUT_KEYS[number])
    )
  ) {
    blockers.add("invalid-input");
  }

  if (value.cloud !== "global") {
    blockers.add("unsupported-cloud");
  }

  if (value.auditTier === "unavailable") {
    blockers.add("audit-license-unavailable");
  } else if (value.auditTier !== "standard" && value.auditTier !== "premium") {
    blockers.add("audit-license-unknown");
  }

  if (value.unifiedAuditLogging === "disabled") {
    blockers.add("audit-logging-disabled");
  } else if (value.unifiedAuditLogging !== "enabled") {
    blockers.add("audit-logging-unknown");
  }

  if (value.authorizationMode !== "application") {
    blockers.add("invalid-input");
  }

  const grantedPermissionIds = parsePermissionIds(value.grantedPermissionIds);
  if (
    grantedPermissionIds === null ||
    grantedPermissionIds.length !== 1 ||
    grantedPermissionIds[0] !== APPLICATION_PERMISSION.id
  ) {
    blockers.add("missing-permission");
  }

  if (value.purviewAuditRole !== "none") {
    blockers.add("invalid-input");
  }

  const producerApplicationId = uuid(value.producerApplicationId);
  const detectorApplicationId = uuid(value.detectorApplicationId);
  if (producerApplicationId === null || detectorApplicationId === null) {
    blockers.add("invalid-input");
  } else if (producerApplicationId === detectorApplicationId) {
    blockers.add("identity-conflation");
  }

  const marker = safeMarker(value.marker);
  if (marker === null) {
    blockers.add("invalid-marker");
  }

  const operation = ALLOWED_OPERATIONS.includes(
      value.operation as typeof ALLOWED_OPERATIONS[number],
    )
    ? value.operation as typeof ALLOWED_OPERATIONS[number]
    : null;
  if (operation === null) {
    blockers.add("unsupported-operation");
  }

  const filterStartDateTime = utcDateTime(value.filterStartDateTime);
  const filterEndDateTime = utcDateTime(value.filterEndDateTime);
  if (
    filterStartDateTime === null ||
    filterEndDateTime === null ||
    Date.parse(filterEndDateTime) <= Date.parse(filterStartDateTime) ||
    Date.parse(filterEndDateTime) - Date.parse(filterStartDateTime) >
      PURVIEW_AUDIT_MAX_WINDOW_MINUTES * 60_000
  ) {
    blockers.add("invalid-time-window");
  }

  if (blockers.size > 0) {
    return {
      ...base,
      status: "blocked",
      blockers: BLOCKER_ORDER.filter((blocker) => blockers.has(blocker)),
    };
  }

  return {
    ...base,
    status: "ready",
    authorization: {
      mode: "application",
      permission: APPLICATION_PERMISSION,
      purviewRoleRequirement: "not-applicable-to-application-only",
      producerObserverSeparation: "required",
    },
    query: {
      method: "POST",
      path: "/v1.0/security/auditLog/queries",
      body: {
        displayName: `AP2 marker audit ${marker!}`,
        filterStartDateTime: filterStartDateTime!,
        filterEndDateTime: filterEndDateTime!,
        recordTypeFilters: ["sharePointFileOperation"],
        serviceFilter: "SharePoint",
        operationFilters: [operation!],
        keywordFilter: marker!,
      },
      acceptanceMeaning: "search-job-accepted-not-evidence",
      ambiguousWriteReconciliation:
        "list-and-require-one-exact-display-name-before-any-new-post",
    },
    observation: {
      statusPath: "/v1.0/security/auditLog/queries/{query-id}",
      recordsPath:
        "/v1.0/security/auditLog/queries/{query-id}/records?$top=10",
      terminalSuccess: "succeeded",
      pageSize: PURVIEW_AUDIT_RESULT_PAGE_SIZE,
      maximumPages: PURVIEW_AUDIT_MAX_RESULT_PAGES,
      maximumRecords: 10,
      nextLinkMeaning: "bounded-result-incomplete",
      throttling:
        "honor-retry-after-on-a-separate-read-attempt-never-replay-post",
      requiredRecordMatch: {
        recordType: "sharePointFileOperation",
        workload: "SharePoint",
        producerApplicationId: producerApplicationId!,
        operation: operation!,
        marker: marker!,
        timeWindow: {
          start: filterStartDateTime!,
          end: filterEndDateTime!,
        },
        requireTargetType: true,
        requireCorrelation: true,
      },
    },
    retention: {
      searchJobHistory: "service-retained-no-graph-v1-delete-method",
      auditStandard: "180-days",
      ingestionLatency:
        "typically-60-to-90-minutes-with-no-guaranteed-upper-bound",
    },
  };
}

function parsePermissionIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 8 ||
    value.some((entry) => uuid(entry) === null)
  ) {
    return null;
  }
  const permissionIds = value.map((entry) => uuid(entry)!);
  return new Set(permissionIds).size === permissionIds.length
    ? permissionIds
    : null;
}

function safeMarker(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9-]{11,95}$/.test(value)
  ) {
    return null;
  }
  return value;
}

function uuid(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    return null;
  }
  return value.toLowerCase();
}

function utcDateTime(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return null;
  }
  const canonical = new Date(Date.parse(value)).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
