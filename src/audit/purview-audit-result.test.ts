import { describe, expect, it } from "vitest";
import {
  parsePurviewAuditCapabilityResult,
  PurviewAuditResultError,
} from "./purview-audit-result";

const base = {
  schemaVersion: 1,
  surface: "microsoft-graph-purview-audit-search-v1",
  scenario: "sharepoint-operation",
  evidenceProducer: "lab-harness",
  workloadActor: "workload-application",
  detector: "audit-observer-application",
  learner: "security-learner",
  officialContract: {
    applicationOnlySupported: true,
    minimumApplicationPermission: "AuditLogsQuery-SharePoint.Read.All",
    ingestionLatency:
      "typically-60-to-90-minutes-with-no-guaranteed-upper-bound",
  },
} as const;

const validation = {
  workloadActor: "workload-application",
  detector: "audit-observer-application",
  producerApplicationId: "producer-application",
  allowedOperations: ["FileUploaded", "FileRecycled", "FileDeleted"],
  targetMarker: "sanitized-marker",
  filterStartDateTime: "2026-07-24T10:37:30.000Z",
  filterEndDateTime: "2026-07-24T10:40:30.000Z",
} as const;

describe("parsePurviewAuditCapabilityResult", () => {
  it.each([
    "officially-supported",
    "licensing-or-latency-blocked",
    "unsupported",
  ] as const)("accepts %s without manufacturing a live record", (status) => {
    expect(
      parsePurviewAuditCapabilityResult({
        ...base,
        status,
        detail: "Bounded, decision-ready result.",
      }, validation).status,
    ).toBe(status);
  });

  it("accepts an explicit observed-but-incomplete result", () => {
    expect(
      parsePurviewAuditCapabilityResult({
        ...base,
        status: "observed-but-incomplete",
        reason: "producer-application-absent",
        detail: "The operation was present but lacked application identity.",
      }, validation),
    ).toMatchObject({
      status: "observed-but-incomplete",
      reason: "producer-application-absent",
    });
  });

  it("accepts live proof only with operation-level attribution", () => {
    expect(
      parsePurviewAuditCapabilityResult({
        ...base,
        status: "live-proven",
        record: {
          recordId: "audit-record",
          recordType: "sharePointFileOperation",
          workload: "SharePoint",
          operation: "FileRecycled",
          occurredAt: "2026-07-24T10:38:59.000Z",
          targetType: "File",
          targetId: "sanitized-marker",
          producerApplicationId: "producer-application",
          correlationId: "operation-correlation",
        },
      }, validation),
    ).toMatchObject({
      status: "live-proven",
      record: {
        operation: "FileRecycled",
        producerApplicationId: "producer-application",
      },
    });
  });

  it("fails closed when detector and workload actor are conflated", () => {
    expect(() =>
      parsePurviewAuditCapabilityResult({
        ...base,
        detector: base.workloadActor,
        status: "officially-supported",
        detail: "Invalid actor assignment.",
      }, validation)
    ).toThrowError(
      new PurviewAuditResultError(
        "detector and workloadActor must be distinct.",
      ),
    );
  });

  it("rejects a service-principal sign-in as operation-level proof", () => {
    expect(() =>
      parsePurviewAuditCapabilityResult({
        ...base,
        scenario: "service-principal-sign-in",
        status: "live-proven",
        record: {},
      }, validation)
    ).toThrow(/sign-in evidence is insufficient/);
  });

  it.each([
    ["producer application", { producerApplicationId: "" }],
    ["correlation", { correlationId: "" }],
    ["target", { targetId: "" }],
  ])("rejects live proof without %s", (_label, missing) => {
    expect(() =>
      parsePurviewAuditCapabilityResult({
        ...base,
        status: "live-proven",
        record: {
          recordId: "audit-record",
          recordType: "sharePointFileOperation",
          workload: "SharePoint",
          operation: "FileRecycled",
          occurredAt: "2026-07-24T10:38:59.000Z",
          targetType: "File",
          targetId: "sanitized-marker",
          producerApplicationId: "producer-application",
          correlationId: "operation-correlation",
          ...missing,
        },
      }, validation)
    ).toThrow(PurviewAuditResultError);
  });

  it("rejects a broad permission as the minimum supported contract", () => {
    expect(() =>
      parsePurviewAuditCapabilityResult({
        ...base,
        officialContract: {
          ...base.officialContract,
          minimumApplicationPermission: "AuditLogsQuery.Read.All",
        },
        status: "officially-supported",
        detail: "Overbroad.",
      }, validation)
    ).toThrow(/not SharePoint-only/);
  });

  it.each([
    [
      "producer",
      { producerApplicationId: "different-application" },
      /frozen producer/,
    ],
    ["operation", { operation: "FileAccessed" }, /frozen validation context/],
    ["marker", { targetId: "different-target" }, /frozen marker/],
    [
      "window",
      { occurredAt: "2026-07-24T10:41:00.000Z" },
      /frozen validation window/,
    ],
  ])("rejects live proof outside the frozen %s", (_label, changed, error) => {
    expect(() =>
      parsePurviewAuditCapabilityResult({
        ...base,
        status: "live-proven",
        record: {
          recordId: "audit-record",
          recordType: "sharePointFileOperation",
          workload: "SharePoint",
          operation: "FileRecycled",
          occurredAt: "2026-07-24T10:38:59.000Z",
          targetType: "File",
          targetId: "sanitized-marker",
          producerApplicationId: "producer-application",
          correlationId: "operation-correlation",
          ...changed,
        },
      }, validation)
    ).toThrow(error);
  });

  it("rejects result actors outside the frozen context", () => {
    expect(() =>
      parsePurviewAuditCapabilityResult({
        ...base,
        detector: "another-observer",
        status: "officially-supported",
        detail: "Mismatched actor.",
      }, validation)
    ).toThrow(/actors do not match/);
  });
});
