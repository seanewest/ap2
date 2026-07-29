import type {
  AvdThreeVmRehearsalResult,
} from "../../scripts/avd-three-vm-rehearsal";

export const REHEARSAL_OUTPUT_VERIFICATION_FAILURES = [
  "CLEANUP_GAP",
  "INPUT_OVERSIZED",
  "INPUT_SHAPE",
  "NON_CANONICAL_JSON",
  "OBSERVATION_OVERCLAIM",
  "PLAN_BINDING",
  "RECEIPT_BINDING",
  "RECEIPT_COVERAGE",
  "RUN_NONTERMINAL",
  "UNSAFE_CONTENT",
] as const;

export type RehearsalOutputVerificationFailure =
  (typeof REHEARSAL_OUTPUT_VERIFICATION_FAILURES)[number];

export type RehearsalOutputVerificationRequest =
  AvdThreeVmRehearsalResult;

export interface VerifiedRehearsalOutputSummary {
  schemaVersion: 1;
  label: "REHEARSAL_ONLY_VERIFIED";
  status: "verified";
  scenarioId: string;
  planDigestSha256: string;
  run: "terminal-complete";
  cleanup: "ordered-complete";
  observations: "synthetic-only";
  evidenceClaims: "all-uninspected";
  claimCount: number;
  missingCoverageTotal: number;
}

export const REHEARSAL_OUTPUT_MAX_REQUEST_BYTES = 32_768;
export const REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES = 4_096;

const SAFE_KEY = /^[a-z][A-Za-z0-9-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const TOKEN_LIKE =
  /\b(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]+|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential)\b/i;
const PRIVATE_PATH = /(?:[A-Za-z]:\\|\/|\\)/;
const MARKER_LIKE = /\bap2(?:lab)?-[a-z0-9][a-z0-9-]{7,}\b/i;
const PEM = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/;
const RAW_REFERENCE_KEY =
  /(?:tenant|subscription|object|message|resource|user|marker|proofReference|payload|token|credential|certificate|session)/i;

export function isBoundedRehearsalOutputRequest(
  value: unknown,
): value is RehearsalOutputVerificationRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== 9 ||
    ![
      "schemaVersion",
      "label",
      "status",
      "failure",
      "planDigestSha256",
      "stages",
      "runnerJournal",
      "observations",
      "receipt",
    ].every((key, index) => keys[index] === key) ||
    value.schemaVersion !== 1 ||
    value.label !== "REHEARSAL_ONLY"
  ) {
    return false;
  }
  return isBoundedSafeValue(value, 0) && isExactRehearsalShape(value);
}

export function isVerifiedRehearsalOutputSummary(
  value: unknown,
  request: RehearsalOutputVerificationRequest,
): value is VerifiedRehearsalOutputSummary {
  if (!isRecord(value)) return false;
  const expectedCounts = rehearsalReceiptCounts(request);
  if (!expectedCounts) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 11 &&
    [
      "schemaVersion",
      "label",
      "status",
      "scenarioId",
      "planDigestSha256",
      "run",
      "cleanup",
      "observations",
      "evidenceClaims",
      "claimCount",
      "missingCoverageTotal",
    ].every((key, index) => keys[index] === key) &&
    value.schemaVersion === 1 &&
    value.label === "REHEARSAL_ONLY_VERIFIED" &&
    value.status === "verified" &&
    value.scenarioId === "avd-three-vm-substrate" &&
    typeof value.planDigestSha256 === "string" &&
    SHA256.test(value.planDigestSha256) &&
    value.planDigestSha256 === request.planDigestSha256 &&
    value.run === "terminal-complete" &&
    value.cleanup === "ordered-complete" &&
    value.observations === "synthetic-only" &&
    value.evidenceClaims === "all-uninspected" &&
    value.claimCount === expectedCounts.claimCount &&
    value.missingCoverageTotal === expectedCounts.missingCoverageTotal
  );
}

function rehearsalReceiptCounts(
  request: RehearsalOutputVerificationRequest,
): { claimCount: number; missingCoverageTotal: number } | undefined {
  const receipt: unknown = request.receipt;
  if (!isRecord(receipt) || !isRecord(receipt.missingCoverage)) {
    return undefined;
  }
  const claimCount = receipt.claimCount;
  const uninspectedClaims = receipt.uninspectedClaims;
  const provenClaims = receipt.provenClaims;
  const missingKeys = Object.keys(receipt.missingCoverage);
  const missingCounts = Object.values(receipt.missingCoverage);
  if (
    !Number.isInteger(claimCount) ||
    Number(claimCount) <= 0 ||
    Number(claimCount) > 256 ||
    uninspectedClaims !== claimCount ||
    provenClaims !== 0 ||
    ![
      "operations",
      "artifacts",
      "learner",
      "responses",
      "cleanup",
      "retention",
      "terminalProof",
    ].every((key, index) => missingKeys[index] === key) ||
    missingKeys.length !== 7 ||
    missingCounts.some(
      (count) =>
        !Number.isInteger(count) || Number(count) < 0 || Number(count) > 256,
    )
  ) {
    return undefined;
  }
  const missingCoverageTotal = missingCounts.reduce<number>(
    (total, count) => total + Number(count),
    0,
  );
  if (missingCoverageTotal !== claimCount) return undefined;
  return {
    claimCount: Number(claimCount),
    missingCoverageTotal,
  };
}

function isBoundedSafeValue(value: unknown, depth: number): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
  }
  if (typeof value === "string") {
    return (
      value.length <= 128 &&
      !GUID.test(value) &&
      !UPN.test(value) &&
      !TOKEN_LIKE.test(value) &&
      !PRIVATE_PATH.test(value) &&
      !MARKER_LIKE.test(value) &&
      !PEM.test(value)
    );
  }
  if (Array.isArray(value)) {
    return (
      value.length <= 64 &&
      value.every((entry) => isBoundedSafeValue(entry, depth + 1))
    );
  }
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 16 &&
    entries.every(
      ([key, entry]) =>
        SAFE_KEY.test(key) &&
        !RAW_REFERENCE_KEY.test(key) &&
        isBoundedSafeValue(entry, depth + 1),
    )
  );
}

function isExactRehearsalShape(
  output: Record<string, unknown>,
): boolean {
  const stages = exactRecord(output.stages, [
    "plan",
    "run",
    "observation",
    "receipt",
  ]);
  const journal = exactRecord(output.runnerJournal, [
    "entries",
    "duplicateWrites",
    "transitions",
  ]);
  const transitions = journal &&
    exactRecord(journal.transitions, [
      "intent",
      "succeeded",
      "failed",
      "ambiguous",
      "reconciled",
      "reconciliation-blocked",
    ]);
  const observations = exactRecord(output.observations, [
    "status",
    "provenance",
    "evidence",
    "terminalInputs",
  ]);
  const evidence = observations &&
    exactRecord(observations.evidence, [
      "proven",
      "notObserved",
      "failedOrMissing",
    ]);
  const terminalInputs = observations &&
    exactRecord(observations.terminalInputs, [
      "cleanup",
      "roleAbsence",
      "retention",
    ]);
  const receipt = exactRecord(output.receipt, [
    "status",
    "verified",
    "binding",
    "claimCount",
    "provenClaims",
    "uninspectedClaims",
    "missingCoverage",
  ]);
  const binding = receipt &&
    exactRecord(receipt.binding, [
      "planDigestSha256",
      "runStatus",
      "observationProvenance",
      "cleanup",
      "roleAbsence",
      "retention",
    ]);
  const missingCoverage = receipt &&
    exactRecord(receipt.missingCoverage, [
      "operations",
      "artifacts",
      "learner",
      "responses",
      "cleanup",
      "retention",
      "terminalProof",
    ]);
  if (
    !stages ||
    !journal ||
    !transitions ||
    !observations ||
    !evidence ||
    !terminalInputs ||
    !receipt ||
    !binding ||
    !missingCoverage
  ) {
    return false;
  }
  return (
    output.status === "completed" &&
    output.failure === null &&
    typeof output.planDigestSha256 === "string" &&
    SHA256.test(output.planDigestSha256) &&
    stages.plan === "compiled" &&
    stages.run === "completed" &&
    stages.observation === "collected" &&
    stages.receipt === "verified-incomplete" &&
    countsAreBounded(journal, ["entries", "duplicateWrites"]) &&
    countsAreBounded(transitions, [
      "intent",
      "succeeded",
      "failed",
      "ambiguous",
      "reconciled",
      "reconciliation-blocked",
    ]) &&
    observations.status === "collected" &&
    observations.provenance === "synthetic" &&
    countsAreBounded(evidence, [
      "proven",
      "notObserved",
      "failedOrMissing",
    ]) &&
    terminalInputs.cleanup === "synthetic-supplied" &&
    terminalInputs.roleAbsence === "synthetic-supplied" &&
    terminalInputs.retention === "synthetic-supplied" &&
    receipt.status === "verified-incomplete" &&
    receipt.verified === true &&
    countsAreBounded(receipt, [
      "claimCount",
      "provenClaims",
      "uninspectedClaims",
    ]) &&
    countsAreBounded(missingCoverage, [
      "operations",
      "artifacts",
      "learner",
      "responses",
      "cleanup",
      "retention",
      "terminalProof",
    ]) &&
    binding.planDigestSha256 === output.planDigestSha256 &&
    binding.runStatus === "completed" &&
    binding.observationProvenance === "synthetic" &&
    binding.cleanup === "synthetic-supplied" &&
    binding.roleAbsence === "synthetic-supplied" &&
    binding.retention === "synthetic-supplied"
  );
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length &&
      expectedKeys.every((key, index) => keys[index] === key)
    ? value
    : undefined;
}

function countsAreBounded(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) =>
    Number.isSafeInteger(value[key]) &&
    Number(value[key]) >= 0 &&
    Number(value[key]) <= 10_000
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
