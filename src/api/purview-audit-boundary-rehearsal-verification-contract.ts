import type {
  PurviewAuditBoundaryRehearsalResult,
} from "../../scripts/purview-audit-boundary-rehearsal";
import type {
  PurviewAuditBoundaryRehearsalVerificationFailure as OfflineVerificationFailure,
  VerifiedPurviewAuditBoundaryRehearsalSummary as OfflineVerifiedSummary,
} from "../../scripts/verify-purview-audit-boundary-rehearsal-output";
import {
  inspectBoundedRehearsalValue,
  REHEARSAL_ONLY_LABEL,
  REHEARSAL_VERIFIED_LABEL,
} from "../scenarios/rehearsal-envelope-invariants.ts";

export const PURVIEW_AUDIT_BOUNDARY_REHEARSAL_VERIFICATION_FAILURES = [
  "ADAPTER_REFUSED",
  "DEDUPLICATION_MISMATCH",
  "EVIDENCE_OVERCLAIM",
  "EXTERNAL_CLAIM_MISMATCH",
  "INPUT_BINDING",
  "INPUT_OVERSIZED",
  "INPUT_SHAPE",
  "NON_CANONICAL_JSON",
  "OBSERVATION_SEQUENCE",
  "OUTPUT_BINDING",
  "PLAN_BINDING",
  "RECEIPT_BINDING",
  "RECEIPT_REFUSED",
  "RUN_NONTERMINAL",
  "SYNTHETIC_MISMATCH",
  "UNSAFE_CONTENT",
] as const satisfies readonly OfflineVerificationFailure[];

export type PurviewAuditBoundaryRehearsalVerificationRequest =
  PurviewAuditBoundaryRehearsalResult;
export type PurviewAuditBoundaryRehearsalVerificationFailure =
  OfflineVerificationFailure;
export type VerifiedPurviewAuditBoundaryRehearsalSummary =
  OfflineVerifiedSummary;

export const PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES = 32_768;
export const PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_RESPONSE_BYTES = 4_096;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9-]{0,127}$/;
const CLAIM_KEYS = [
  "auditSearchSubmission",
  "auditSearchResultRead",
  "liveSharePointOperation",
  "operationAttribution",
  "content",
  "learnerVisibility",
  "learnerInterpretation",
  "response",
  "cleanup",
  "retention",
  "externalImpact",
] as const;

export class PurviewAuditBoundaryRehearsalContractError extends Error {
  readonly category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT";

  constructor(
    category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT",
  ) {
    super("Purview audit-boundary rehearsal contract validation failed.");
    this.name = "PurviewAuditBoundaryRehearsalContractError";
    this.category = category;
  }
}

export function parsePurviewAuditBoundaryRehearsalVerificationRequest(
  value: unknown,
): PurviewAuditBoundaryRehearsalVerificationRequest {
  const inspected = inspectBoundedRehearsalValue(
    value,
    PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES,
  );
  if (inspected === "INPUT_OVERSIZED" || inspected === "UNSAFE_CONTENT") {
    throw new PurviewAuditBoundaryRehearsalContractError(inspected);
  }
  if (inspected !== null) fail();

  const output = exactRecord(value, [
    "schemaVersion",
    "label",
    "status",
    "failure",
    "binding",
    "stages",
    "syntheticObservation",
    "receipt",
    "envelope",
  ]);
  if (
    output.schemaVersion !== 1 ||
    output.label !== REHEARSAL_ONLY_LABEL ||
    output.status !== "completed" ||
    output.failure !== null
  ) fail();

  const binding = exactRecord(output.binding, [
    "scenarioId",
    "manifestSchemaVersion",
    "planDigestSha256",
    "syntheticInputDigestSha256",
    "receiptDigestSha256",
    "outputDigestSha256",
  ]);
  if (binding.scenarioId !== "purview-sharepoint-audit-boundary") fail();
  boundedInteger(binding.manifestSchemaVersion, 1, 100);
  digest(binding.planDigestSha256);
  digest(binding.syntheticInputDigestSha256);
  digest(binding.receiptDigestSha256);
  digest(binding.outputDigestSha256);

  const stages = exactRecord(output.stages, [
    "plan",
    "syntheticDetector",
    "adapter",
    "syntheticBinding",
    "receiptVerifier",
    "envelope",
  ]);
  Object.values(stages).forEach(safeCategory);

  const synthetic = exactRecord(output.syntheticObservation, [
    "terminalState",
    "sourcePages",
    "deduplication",
    "adapterObservation",
  ]);
  Object.values(synthetic).forEach(safeCategory);

  const receipt = exactRecord(output.receipt, [
    "adapterCandidateAccepted",
    "verifierAccepted",
    "candidateClaimCount",
    "syntheticProvenClaimCount",
    "duplicatePageClaimCount",
    "allUnsupportedClaims",
  ]);
  if (
    typeof receipt.adapterCandidateAccepted !== "boolean" ||
    typeof receipt.verifierAccepted !== "boolean"
  ) fail();
  boundedInteger(receipt.candidateClaimCount, 0, 256);
  boundedInteger(receipt.syntheticProvenClaimCount, 0, 256);
  boundedInteger(receipt.duplicatePageClaimCount, 0, 16);
  safeCategory(receipt.allUnsupportedClaims);

  const envelope = exactRecord(output.envelope, [
    "terminalState",
    "observationSource",
    "externalEvidence",
    "claims",
  ]);
  safeCategory(envelope.terminalState);
  safeCategory(envelope.observationSource);
  safeCategory(envelope.externalEvidence);
  const claims = exactRecord(envelope.claims, CLAIM_KEYS);
  Object.values(claims).forEach(safeCategory);
  return value as PurviewAuditBoundaryRehearsalVerificationRequest;
}

export function isBoundedPurviewAuditBoundaryRehearsalRequest(
  value: unknown,
): value is PurviewAuditBoundaryRehearsalVerificationRequest {
  try {
    parsePurviewAuditBoundaryRehearsalVerificationRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isVerifiedPurviewAuditBoundaryRehearsalSummary(
  value: unknown,
  request: PurviewAuditBoundaryRehearsalVerificationRequest,
): value is VerifiedPurviewAuditBoundaryRehearsalSummary {
  if (!isRecord(value) || !isRecord(request.binding)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 16 &&
    [
      "schemaVersion",
      "label",
      "status",
      "scenarioId",
      "manifestSchemaVersion",
      "planDigestSha256",
      "syntheticInputDigestSha256",
      "receiptDigestSha256",
      "outputDigestSha256",
      "syntheticContract",
      "adapter",
      "receiptVerifier",
      "envelope",
      "externalEvidence",
      "claimCount",
      "producerAttributionClaimCount",
    ].every((key, index) => keys[index] === key) &&
    value.schemaVersion === 1 &&
    value.label === REHEARSAL_VERIFIED_LABEL &&
    value.status === "verified" &&
    value.scenarioId === "purview-sharepoint-audit-boundary" &&
    value.manifestSchemaVersion === 2 &&
    value.planDigestSha256 === request.binding.planDigestSha256 &&
    value.syntheticInputDigestSha256 ===
      request.binding.syntheticInputDigestSha256 &&
    value.receiptDigestSha256 === request.binding.receiptDigestSha256 &&
    value.outputDigestSha256 === request.binding.outputDigestSha256 &&
    value.syntheticContract ===
      "deduplicated-producer-attribution-terminal-verified" &&
    value.adapter === "accepted" &&
    value.receiptVerifier === "accepted" &&
    value.envelope === "accepted" &&
    value.externalEvidence === "all-uninspected" &&
    value.claimCount === 14 &&
    value.producerAttributionClaimCount === 1
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key, index) => key === keys[index])
  ) fail();
  return value;
}

function safeCategory(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_CATEGORY.test(value)) fail();
}

function digest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) fail();
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) fail();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new PurviewAuditBoundaryRehearsalContractError("INPUT_SHAPE");
}
