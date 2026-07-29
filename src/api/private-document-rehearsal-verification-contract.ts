import type {
  PrivateDocumentRehearsalResult,
  PrivateDocumentSyntheticBranch,
} from "../../scripts/private-document-rehearsal";
import {
  inspectBoundedRehearsalValue,
  REHEARSAL_VERIFIED_LABEL,
} from "../scenarios/rehearsal-envelope-invariants.ts";

export const PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_FAILURES = [
  "ADAPTER_REFUSED",
  "BRANCH_MISMATCH",
  "CLEANUP_GAP",
  "EVIDENCE_OVERCLAIM",
  "FAKE_CONTRACT_BINDING",
  "INPUT_OVERSIZED",
  "INPUT_SHAPE",
  "NON_CANONICAL_JSON",
  "PLAN_BINDING",
  "RECEIPT_REFUSED",
  "RUN_NONTERMINAL",
  "UNSAFE_CONTENT",
] as const;

export type PrivateDocumentRehearsalVerificationFailure =
  (typeof PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_FAILURES)[number];

export type PrivateDocumentRehearsalVerificationRequest =
  PrivateDocumentRehearsalResult;

export interface VerifiedPrivateDocumentRehearsalSummary {
  schemaVersion: 1;
  label: typeof REHEARSAL_VERIFIED_LABEL;
  status: "verified";
  scenarioId: "private-document-evidence";
  manifestSchemaVersion: 2;
  planDigestSha256: string;
  fakeRunDigestSha256: string;
  syntheticBranch: PrivateDocumentSyntheticBranch;
  fakeContract: "ordered-terminal-verified";
  adapter: "accepted";
  receiptVerifier: "accepted";
  externalEvidence: "all-uninspected";
  claimCount: number;
}

export const PRIVATE_DOCUMENT_REHEARSAL_MAX_REQUEST_BYTES = 32_768;
export const PRIVATE_DOCUMENT_REHEARSAL_MAX_RESPONSE_BYTES = 4_096;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;

export class PrivateDocumentRehearsalContractError extends Error {
  readonly category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT";

  constructor(
    category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT",
  ) {
    super("Private-document rehearsal contract validation failed.");
    this.name = "PrivateDocumentRehearsalContractError";
    this.category = category;
  }
}

export function parsePrivateDocumentRehearsalVerificationRequest(
  value: unknown,
): PrivateDocumentRehearsalVerificationRequest {
  const inspected = inspectBoundedRehearsalValue(
    value,
    PRIVATE_DOCUMENT_REHEARSAL_MAX_REQUEST_BYTES,
  );
  if (inspected === "INPUT_OVERSIZED" || inspected === "UNSAFE_CONTENT") {
    throw new PrivateDocumentRehearsalContractError(inspected);
  }
  if (inspected !== null) fail();

  const output = exactRecord(value, [
    "schemaVersion",
    "label",
    "status",
    "failure",
    "binding",
    "stages",
    "fakeRun",
    "receipt",
  ]);
  if (output.schemaVersion !== 1 || output.label !== "REHEARSAL_ONLY") fail();
  safeCategory(output.status);
  if (output.failure !== null) safeCategory(output.failure);

  const binding = exactRecord(output.binding, [
    "scenarioId",
    "manifestSchemaVersion",
    "planDigestSha256",
    "fakeRunDigestSha256",
    "syntheticBranch",
  ]);
  safeCategory(binding.scenarioId);
  boundedInteger(binding.manifestSchemaVersion, 1, 100);
  digest(binding.planDigestSha256);
  digest(binding.fakeRunDigestSha256);
  safeCategory(binding.syntheticBranch);

  const stages = exactRecord(output.stages, [
    "plan",
    "fakeLifecycle",
    "adapter",
    "receiptVerifier",
  ]);
  Object.values(stages).forEach(safeCategory);

  const fakeRun = exactRecord(output.fakeRun, [
    "lifecycleStatus",
    "journalEntries",
    "learnerObservation",
    "initialTerminalProducerAbsence",
    "initialTerminalLearnerAbsence",
    "freshTerminal",
  ]);
  safeCategory(fakeRun.lifecycleStatus);
  boundedInteger(fakeRun.journalEntries, 0, 256);
  safeCategory(fakeRun.learnerObservation);
  safeCategory(fakeRun.initialTerminalProducerAbsence);
  safeCategory(fakeRun.initialTerminalLearnerAbsence);
  const terminal = exactRecord(fakeRun.freshTerminal, [
    "rounds",
    "producerFolder",
    "producerItem",
    "producerPermission",
    "learnerAccess",
  ]);
  boundedInteger(terminal.rounds, 0, 16);
  safeCategory(terminal.producerFolder);
  safeCategory(terminal.producerItem);
  safeCategory(terminal.producerPermission);
  safeCategory(terminal.learnerAccess);

  const receipt = exactRecord(output.receipt, [
    "adapterCandidateAccepted",
    "verifierAccepted",
    "candidateClaimCount",
    "externalEvidence",
  ]);
  if (
    typeof receipt.adapterCandidateAccepted !== "boolean" ||
    typeof receipt.verifierAccepted !== "boolean"
  ) {
    fail();
  }
  boundedInteger(receipt.candidateClaimCount, 0, 256);
  const external = exactRecord(receipt.externalEvidence, [
    "producerStaging",
    "learnerVisibility",
    "learnerInterpretation",
    "auditOrDetection",
    "response",
    "cleanup",
    "retention",
  ]);
  Object.values(external).forEach(safeCategory);
  return value as PrivateDocumentRehearsalVerificationRequest;
}

export function isBoundedPrivateDocumentRehearsalRequest(
  value: unknown,
): value is PrivateDocumentRehearsalVerificationRequest {
  try {
    parsePrivateDocumentRehearsalVerificationRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isVerifiedPrivateDocumentRehearsalSummary(
  value: unknown,
  request: PrivateDocumentRehearsalVerificationRequest,
): value is VerifiedPrivateDocumentRehearsalSummary {
  if (!isRecord(value) || !isRecord(request.binding) || !isRecord(request.receipt)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 13 &&
    [
      "schemaVersion",
      "label",
      "status",
      "scenarioId",
      "manifestSchemaVersion",
      "planDigestSha256",
      "fakeRunDigestSha256",
      "syntheticBranch",
      "fakeContract",
      "adapter",
      "receiptVerifier",
      "externalEvidence",
      "claimCount",
    ].every((key, index) => keys[index] === key) &&
    value.schemaVersion === 1 &&
    value.label === REHEARSAL_VERIFIED_LABEL &&
    value.status === "verified" &&
    value.scenarioId === "private-document-evidence" &&
    value.manifestSchemaVersion === 2 &&
    value.planDigestSha256 === request.binding.planDigestSha256 &&
    value.fakeRunDigestSha256 === request.binding.fakeRunDigestSha256 &&
    value.syntheticBranch === request.binding.syntheticBranch &&
    value.fakeContract === "ordered-terminal-verified" &&
    value.adapter === "accepted" &&
    value.receiptVerifier === "accepted" &&
    value.externalEvidence === "all-uninspected" &&
    value.claimCount === request.receipt.candidateClaimCount
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
  ) {
    fail();
  }
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
  ) {
    fail();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(): never {
  throw new PrivateDocumentRehearsalContractError("INPUT_SHAPE");
}
