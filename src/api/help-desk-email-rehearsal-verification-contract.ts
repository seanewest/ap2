import type {
  HelpDeskEmailRehearsalResult,
} from "../../scripts/help-desk-email-rehearsal";
import type {
  VerifiedHelpDeskEmailRehearsalSummary as OfflineVerifiedHelpDeskEmailRehearsalSummary,
} from "../../scripts/verify-help-desk-email-rehearsal-output";
import {
  inspectBoundedRehearsalValue,
  REHEARSAL_VERIFIED_LABEL,
} from "../scenarios/rehearsal-envelope-invariants.ts";

export const HELP_DESK_EMAIL_REHEARSAL_VERIFICATION_FAILURES = [
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

export type HelpDeskEmailRehearsalVerificationFailure =
  (typeof HELP_DESK_EMAIL_REHEARSAL_VERIFICATION_FAILURES)[number];

export type HelpDeskEmailRehearsalVerificationRequest =
  HelpDeskEmailRehearsalResult;

export type VerifiedHelpDeskEmailRehearsalSummary =
  OfflineVerifiedHelpDeskEmailRehearsalSummary;

export const HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES = 32_768;
export const HELP_DESK_EMAIL_REHEARSAL_MAX_RESPONSE_BYTES = 4_096;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;

export class HelpDeskEmailRehearsalContractError extends Error {
  readonly category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT";

  constructor(
    category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT",
  ) {
    super("Help-desk email rehearsal contract validation failed.");
    this.name = "HelpDeskEmailRehearsalContractError";
    this.category = category;
  }
}

export function parseHelpDeskEmailRehearsalVerificationRequest(
  value: unknown,
): HelpDeskEmailRehearsalVerificationRequest {
  const inspected = inspectBoundedRehearsalValue(
    value,
    HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES,
  );
  if (inspected === "INPUT_OVERSIZED" || inspected === "UNSAFE_CONTENT") {
    throw new HelpDeskEmailRehearsalContractError(inspected);
  }
  if (inspected !== null) fail();

  const output = exactRecord(value, [
    "schemaVersion",
    "label",
    "status",
    "failure",
    "binding",
    "stages",
    "envelope",
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
    "fakeOperation",
    "adapter",
    "fakeBinding",
    "receiptVerifier",
    "envelope",
  ]);
  Object.values(stages).forEach(safeCategory);

  const envelope = exactRecord(output.envelope, [
    "terminalState",
    "observationSource",
    "externalEvidence",
  ]);
  Object.values(envelope).forEach(safeCategory);

  const fakeRun = exactRecord(output.fakeRun, [
    "operationAttempts",
    "journalEntries",
    "send",
    "learnerVisibility",
    "learnerInterpretation",
    "retention",
    "cleanup",
    "auditOrDetection",
    "teamsCall",
    "voicemail",
    "terminalState",
  ]);
  boundedInteger(fakeRun.operationAttempts, 0, 1);
  boundedInteger(fakeRun.journalEntries, 0, 16);
  Object.entries(fakeRun)
    .filter(([key]) => key !== "operationAttempts" && key !== "journalEntries")
    .forEach(([, value]) => safeCategory(value));

  const receipt = exactRecord(output.receipt, [
    "adapterCandidateAccepted",
    "verifierAccepted",
    "candidateClaimCount",
    "externalEvidence",
  ]);
  if (
    typeof receipt.adapterCandidateAccepted !== "boolean" ||
    typeof receipt.verifierAccepted !== "boolean"
  ) fail();
  boundedInteger(receipt.candidateClaimCount, 0, 256);
  const external = exactRecord(receipt.externalEvidence, [
    "emailSend",
    "inboxVisibility",
    "learnerInterpretation",
    "response",
    "cleanup",
    "retention",
    "auditOrDetection",
    "teamsCall",
    "voicemail",
  ]);
  Object.values(external).forEach(safeCategory);
  return value as HelpDeskEmailRehearsalVerificationRequest;
}

export function isBoundedHelpDeskEmailRehearsalRequest(
  value: unknown,
): value is HelpDeskEmailRehearsalVerificationRequest {
  try {
    parseHelpDeskEmailRehearsalVerificationRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isVerifiedHelpDeskEmailRehearsalSummary(
  value: unknown,
  request: HelpDeskEmailRehearsalVerificationRequest,
): value is VerifiedHelpDeskEmailRehearsalSummary {
  if (!isRecord(value) || !isRecord(request.binding) || !isRecord(request.receipt)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 14 &&
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
      "envelope",
      "externalEvidence",
      "claimCount",
    ].every((key, index) => keys[index] === key) &&
    value.schemaVersion === 1 &&
    value.label === REHEARSAL_VERIFIED_LABEL &&
    value.status === "verified" &&
    value.scenarioId === "help-desk-email-observation" &&
    value.manifestSchemaVersion === 2 &&
    value.planDigestSha256 === request.binding.planDigestSha256 &&
    value.fakeRunDigestSha256 === request.binding.fakeRunDigestSha256 &&
    value.syntheticBranch === request.binding.syntheticBranch &&
    value.fakeContract === "one-shot-terminal-verified" &&
    value.adapter === "accepted" &&
    value.receiptVerifier === "accepted" &&
    value.envelope === "accepted" &&
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
  throw new HelpDeskEmailRehearsalContractError("INPUT_SHAPE");
}
