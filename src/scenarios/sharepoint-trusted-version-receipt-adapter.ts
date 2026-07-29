import { createHash } from "node:crypto";
import type {
  SharePointTrustedVersionLifecycleResult,
  TrustedVersionJournalEntry,
} from "../../api/sharepoint-trusted-version-lifecycle.ts";
import {
  SHAREPOINT_TRUSTED_VERSION_LIFECYCLE_SCENARIO,
} from "./sharepoint-trusted-version-lifecycle.ts";
import {
  verifyScenarioEvidenceReceipt,
  type EvidenceReceiptClaim,
  type EvidenceReceiptObservation,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";

const SCENARIO_ID = "sharepoint-trusted-version-lifecycle";
const HEX = /^[0-9a-f]{64}$/;
const TRUSTED_V1_DIGEST =
  "cdae891928cc374e3915058db6c6c9152a0a5105ae329cfca10fa26d692532af";
const CHANGED_V2_DIGEST =
  "94cd34f6b04b653c612bee9857c43d715f6d1bf7cf7dd45dccf069a46738cfb7";

export type TrustedVersionReceiptAdapterErrorCode =
  | "shape"
  | "unsafe-input"
  | "scenario-mismatch"
  | "sequence"
  | "cleanup-gap"
  | "overclaim";

export class TrustedVersionReceiptAdapterError extends Error {
  constructor(
    readonly code: TrustedVersionReceiptAdapterErrorCode,
    message: string,
  ) {
    super(`Invalid trusted-version receipt input [${code}]: ${message}`);
    this.name = "TrustedVersionReceiptAdapterError";
  }
}

export function adaptTrustedVersionLifecycleToReceipt(
  value: unknown,
): ScenarioEvidenceReceipt {
  const result = parseResult(value);
  validateJournal(result.journal);
  const receipt = buildReceipt(evidenceBindingDigest(result));
  verifyScenarioEvidenceReceipt(
    receipt,
    SHAREPOINT_TRUSTED_VERSION_LIFECYCLE_SCENARIO,
  );
  return deepFreeze(receipt);
}

function parseResult(value: unknown): SharePointTrustedVersionLifecycleResult {
  const result = record(value);
  exactKeys(result, [
    "schemaVersion",
    "kind",
    "status",
    "scenarioId",
    "producer",
    "cleanupOwner",
    "learnerVisibility",
    "detectorObservation",
    "learnerInterpretation",
    "response",
    "markerDigestSha256",
    "fileIdentityDigestSha256",
    "startedAt",
    "completedAt",
    "expiresAt",
    "versions",
    "journal",
    "journalDigestSha256",
    "terminal",
  ]);
  if (
    result.schemaVersion !== 1 ||
    result.kind !== "sharepoint-trusted-version-lifecycle-result" ||
    result.status !== "completed-cleaned" ||
    result.scenarioId !== SCENARIO_ID ||
    result.producer !== "sharepoint-producer-app" ||
    result.cleanupOwner !== "trusted-version-cleanup-owner"
  ) throw failure("scenario-mismatch", "result identity is not canonical.");
  if (
    result.learnerVisibility !== "uninspected" ||
    result.detectorObservation !== "uninspected" ||
    result.learnerInterpretation !== "uninspected" ||
    result.response !== "uninspected"
  ) throw failure("overclaim", "external learner, detector, or response claims are not permitted.");
  for (const name of [
    "markerDigestSha256",
    "fileIdentityDigestSha256",
    "journalDigestSha256",
  ] as const) digest(result[name], name);
  timestamp(result.startedAt, "startedAt");
  timestamp(result.completedAt, "completedAt");
  timestamp(result.expiresAt, "expiresAt");
  if (
    Date.parse(result.startedAt as string) >
      Date.parse(result.completedAt as string) ||
    Date.parse(result.completedAt as string) > Date.parse(result.expiresAt as string)
  ) {
    throw failure("shape", "lifecycle timestamps are reversed or exceed expiry.");
  }
  if (!Array.isArray(result.versions) || result.versions.length !== 2) {
    throw failure("shape", "exactly two ordered versions are required.");
  }
  const [changed, trusted] = result.versions.map((value) => record(value));
  exactKeys(changed!, ["ordinal", "platformVersionDigestSha256", "contentDigestSha256", "size", "lastModifiedAt"]);
  exactKeys(trusted!, ["ordinal", "platformVersionDigestSha256", "contentDigestSha256", "size", "lastModifiedAt"]);
  if (
    changed!.ordinal !== "changed-v2" || changed!.size !== 70 ||
    changed!.contentDigestSha256 !== CHANGED_V2_DIGEST ||
    trusted!.ordinal !== "trusted-v1" || trusted!.size !== 49 ||
    trusted!.contentDigestSha256 !== TRUSTED_V1_DIGEST
  ) throw failure("sequence", "version order or fixed sizes changed.");
  for (const row of [changed!, trusted!]) {
    digest(row.platformVersionDigestSha256, "platformVersionDigestSha256");
    digest(row.contentDigestSha256, "contentDigestSha256");
    timestamp(row.lastModifiedAt, "lastModifiedAt");
  }
  if (
    Date.parse(changed!.lastModifiedAt as string) <
      Date.parse(trusted!.lastModifiedAt as string)
  ) throw failure("sequence", "version timestamps contradict newest-first order.");
  if (!Array.isArray(result.journal)) throw failure("shape", "journal must be an array.");
  if (
    result.journalDigestSha256 !==
      createHash("sha256").update(JSON.stringify(result.journal)).digest("hex")
  ) throw failure("sequence", "journal digest does not bind the supplied journal.");
  const terminal = record(result.terminal);
  exactKeys(terminal, ["activeFile", "activeFolder", "recycleAndAuditHistory", "expiry"]);
  if (
    terminal.activeFile !== "absent" ||
    terminal.activeFolder !== "absent" ||
    terminal.recycleAndAuditHistory !== "ordinary-platform-history-retained" ||
    terminal.expiry !== "removed"
  ) throw failure("cleanup-gap", "terminal active absence and expiry removal are required.");
  return value as SharePointTrustedVersionLifecycleResult;
}

function validateJournal(journal: readonly TrustedVersionJournalEntry[]): void {
  const expected: ReadonlyArray<Omit<TrustedVersionJournalEntry, "sequence">> = [
    { operation: "expiry", transition: "prepared" },
    { operation: "folder-create", transition: "intent" },
    { operation: "folder-create", transition: "succeeded" },
    { operation: "file-create", transition: "intent" },
    { operation: "file-create", transition: "succeeded" },
    { operation: "file-create", transition: "reconciled" },
    { operation: "version-write", transition: "intent" },
    { operation: "version-write", transition: "succeeded" },
    { operation: "version-write", transition: "reconciled" },
    { operation: "version-read", transition: "observed" },
    { operation: "version-read", transition: "reconciled" },
    { operation: "file-delete", transition: "intent" },
    { operation: "file-delete", transition: "succeeded" },
    { operation: "folder-delete", transition: "intent" },
    { operation: "folder-delete", transition: "succeeded" },
    { operation: "expiry", transition: "removed" },
    { operation: "terminal-absence", transition: "observed" },
  ];
  if (
    journal.length !== expected.length ||
    journal.some((entry, index) =>
      entry.sequence !== index + 1 ||
      entry.operation !== expected[index]!.operation ||
      entry.transition !== expected[index]!.transition
    )
  ) throw failure("sequence", "journal is incomplete, duplicated, or reordered.");
}

function buildReceipt(
  evidenceBindingDigestSha256: string,
): ScenarioEvidenceReceipt {
  const manifest = SHAREPOINT_TRUSTED_VERSION_LIFECYCLE_SCENARIO;
  const producer = manifest.roles.workloadActor;
  const cleanup = manifest.lifecycle.cleanupOwnerActorId;
  const producerObservation = (
    operationKey: string,
  ): EvidenceReceiptObservation => ({
    source: "platform-control-plane",
    outcome: "operation-result",
    observerActorId: producer,
    operationKey,
  });
  const cleanupObservation = (
    operationKey: string,
  ): EvidenceReceiptObservation => ({
    source: "local-reconciliation",
    outcome: "exact-reconciliation",
    observerActorId: cleanup,
    operationKey,
  });
  const claims: EvidenceReceiptClaim[] = manifest.operations.map((operation) => ({
    id: `operation-${operation.key}`,
    category: "operation",
    subject: { kind: "operation", id: operation.key },
    assertion: "operation-completed",
    state: "proven",
    observation: operation.ownerActorId === producer
      ? producerObservation(operation.key)
      : cleanupObservation(operation.key),
  }));
  const versionObservation = producerObservation("read-exact-version-bytes");
  const terminalObservation = cleanupObservation("reconcile-trusted-version-absence");
  claims.push(
    {
      id: "artifact-trusted-version-history",
      category: "artifact",
      subject: { kind: "artifact", id: "trusted-version-history" },
      assertion: "artifact-authentic",
      state: "proven",
      artifact: {
        kind: "sharepoint-version-history",
        authenticity: "platform-native",
      },
      observation: versionObservation,
    },
    {
      id: "visibility-trusted-version-history",
      category: "learner-visibility",
      subject: { kind: "artifact", id: "trusted-version-history" },
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
    {
      id: "detector-independent",
      category: "independent-observation",
      subject: { kind: "scenario", id: SCENARIO_ID },
      assertion: "detector-independent",
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
      id: "retention-trusted-version-history",
      category: "retention",
      subject: { kind: "artifact", id: "trusted-version-history" },
      assertion: "retention-confirmed",
      state: "absent",
      observation: terminalObservation,
    },
    {
      id: "terminal-sharepoint-trusted-version-staged",
      category: "terminal-proof",
      subject: { kind: "artifact", id: "trusted-version-history" },
      assertion: "sharepoint-trusted-version-staged",
      state: "proven",
      observation: versionObservation,
    },
  );
  return {
    schemaVersion: 1,
    scenario: {
      id: SCENARIO_ID,
      manifestSchemaVersion: 2,
      evidenceBindingDigestSha256,
    },
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: producer,
      learner: manifest.roles.learner,
      detector: manifest.roles.detector,
    },
    claims,
  };
}

function evidenceBindingDigest(
  result: SharePointTrustedVersionLifecycleResult,
): string {
  return createHash("sha256").update(JSON.stringify({
    scenarioId: result.scenarioId,
    producer: result.producer,
    cleanupOwner: result.cleanupOwner,
    markerDigestSha256: result.markerDigestSha256,
    fileIdentityDigestSha256: result.fileIdentityDigestSha256,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    expiresAt: result.expiresAt,
    versions: result.versions,
    journalDigestSha256: result.journalDigestSha256,
    terminal: result.terminal,
  })).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw failure("shape", "expected an object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw failure("shape", "object fields do not match the adapter schema.");
  }
}

function digest(value: unknown, name: string): void {
  if (typeof value !== "string" || !HEX.test(value)) {
    throw failure("unsafe-input", `${name} must be a SHA-256 digest.`);
  }
}

function timestamp(value: unknown, name: string): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) throw failure("shape", `${name} must be a canonical timestamp.`);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function failure(
  code: TrustedVersionReceiptAdapterErrorCode,
  message: string,
): TrustedVersionReceiptAdapterError {
  return new TrustedVersionReceiptAdapterError(code, message);
}
