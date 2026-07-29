import { describe, expect, it } from "vitest";
import {
  planPurviewAuditReadiness,
  PURVIEW_AUDIT_MAX_RESULT_PAGES,
  PURVIEW_AUDIT_MAX_WINDOW_MINUTES,
  PURVIEW_AUDIT_RESULT_PAGE_SIZE,
} from "./purview-audit-readiness";

const applicationPermissionId = "91c64a47-a524-4fce-9bf3-3d569a344ecf";
const broadPermissionId = "5e1e9171-754d-478c-812c-f1755a9a4c2d";

const ready = {
  cloud: "global",
  auditTier: "standard",
  unifiedAuditLogging: "enabled",
  authorizationMode: "application",
  grantedPermissionIds: [applicationPermissionId],
  purviewAuditRole: "none",
  producerApplicationId: "11111111-1111-4111-8111-111111111111",
  detectorApplicationId: "22222222-2222-4222-8222-222222222222",
  marker: "ap2-purview-marker-001",
  operation: "FileUploaded",
  filterStartDateTime: "2026-07-29T10:00:00.000Z",
  filterEndDateTime: "2026-07-29T10:15:00.000Z",
} as const;

describe("planPurviewAuditReadiness", () => {
  it("builds one bounded application-only SharePoint readiness plan", () => {
    expect(planPurviewAuditReadiness(ready)).toEqual({
      schemaVersion: 1,
      surface: "microsoft-graph-purview-audit-search-v1",
      workload: "SharePoint",
      proof: "readiness-only-search-not-submitted",
      status: "ready",
      authorization: {
        mode: "application",
        permission: {
          id: applicationPermissionId,
          name: "AuditLogsQuery-SharePoint.Read.All",
          consent: "administrator",
        },
        purviewRoleRequirement: "not-applicable-to-application-only",
        producerObserverSeparation: "required",
      },
      query: {
        method: "POST",
        path: "/v1.0/security/auditLog/queries",
        body: {
          displayName: "AP2 marker audit ap2-purview-marker-001",
          filterStartDateTime: ready.filterStartDateTime,
          filterEndDateTime: ready.filterEndDateTime,
          recordTypeFilters: ["sharePointFileOperation"],
          serviceFilter: "SharePoint",
          operationFilters: ["FileUploaded"],
          keywordFilter: ready.marker,
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
        pageSize: 10,
        maximumPages: 1,
        maximumRecords: 10,
        nextLinkMeaning: "bounded-result-incomplete",
        throttling:
          "honor-retry-after-on-a-separate-read-attempt-never-replay-post",
        requiredRecordMatch: {
          recordType: "sharePointFileOperation",
          workload: "SharePoint",
          producerApplicationId: ready.producerApplicationId,
          operation: "FileUploaded",
          marker: ready.marker,
          timeWindow: {
            start: ready.filterStartDateTime,
            end: ready.filterEndDateTime,
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
    });
    expect(PURVIEW_AUDIT_RESULT_PAGE_SIZE).toBe(10);
    expect(PURVIEW_AUDIT_MAX_RESULT_PAGES).toBe(1);
    expect(PURVIEW_AUDIT_MAX_WINDOW_MINUTES).toBe(30);
  });

  it.each([
    ["missing permission", { grantedPermissionIds: [] }, "missing-permission"],
    [
      "delegated transport",
      {
        authorizationMode: "delegated",
        grantedPermissionIds: [applicationPermissionId],
      },
      "invalid-input",
    ],
    [
      "coexisting broad audit permission",
      {
        grantedPermissionIds: [applicationPermissionId, broadPermissionId],
      },
      "missing-permission",
    ],
    [
      "conflated actors",
      { detectorApplicationId: ready.producerApplicationId },
      "identity-conflation",
    ],
    ["unknown availability", { auditTier: "unknown" }, "audit-license-unknown"],
    [
      "disabled ingestion",
      { unifiedAuditLogging: "disabled" },
      "audit-logging-disabled",
    ],
    ["unsupported cloud", { cloud: "us-government-l4" }, "unsupported-cloud"],
    ["unsafe marker", { marker: "https://tenant/file" }, "invalid-marker"],
    ["unknown operation", { operation: "FileAccessed" }, "unsupported-operation"],
    [
      "reversed window",
      {
        filterStartDateTime: ready.filterEndDateTime,
        filterEndDateTime: ready.filterStartDateTime,
      },
      "invalid-time-window",
    ],
    [
      "oversized window",
      { filterEndDateTime: "2026-07-29T10:31:00.000Z" },
      "invalid-time-window",
    ],
    [
      "zero window",
      { filterEndDateTime: ready.filterStartDateTime },
      "invalid-time-window",
    ],
    [
      "calendar-invalid start",
      { filterStartDateTime: "2026-02-31T10:00:00Z" },
      "invalid-time-window",
    ],
  ])("fails closed for %s", (_label, change, blocker) => {
    expect(planPurviewAuditReadiness({ ...ready, ...change })).toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining([blocker]),
      proof: "readiness-only-search-not-submitted",
    });
  });

  it.each([
    null,
    [],
    { ...ready, extra: true },
    {
      ...ready,
      grantedPermissionIds: [applicationPermissionId, applicationPermissionId],
    },
    { ...ready, producerApplicationId: "not-an-application-id" },
    {
      ...ready,
      authorizationMode: "application",
      purviewAuditRole: "audit-logs",
    },
  ])("rejects malformed or broadened input without returning a query", (value) => {
    const result = planPurviewAuditReadiness(value);

    expect(result.status).toBe("blocked");
    expect(result).not.toHaveProperty("query");
  });

  it("returns blockers in a deterministic categorical order", () => {
    expect(planPurviewAuditReadiness({
      ...ready,
      cloud: "unknown",
      auditTier: "unknown",
      unifiedAuditLogging: "unknown",
      grantedPermissionIds: [],
      detectorApplicationId: ready.producerApplicationId,
      marker: "unsafe marker",
      operation: "Unknown",
      filterEndDateTime: "not-a-time",
    })).toMatchObject({
      status: "blocked",
      blockers: [
        "unsupported-cloud",
        "audit-license-unknown",
        "audit-logging-unknown",
        "missing-permission",
        "identity-conflation",
        "invalid-marker",
        "unsupported-operation",
        "invalid-time-window",
      ],
    });
  });
});
