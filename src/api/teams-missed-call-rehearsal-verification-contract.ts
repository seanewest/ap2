import type {
  TeamsMissedCallRehearsalResult,
  TeamsMissedCallSyntheticBranch,
} from "../../scripts/teams-missed-call-rehearsal";
import type {
  TeamsMissedCallRehearsalVerificationFailure,
  VerifiedTeamsMissedCallRehearsalSummary,
} from "../../scripts/verify-teams-missed-call-rehearsal-output";
import {
  inspectBoundedRehearsalValue,
  REHEARSAL_VERIFIED_LABEL,
} from "../scenarios/rehearsal-envelope-invariants.ts";

export const TEAMS_MISSED_CALL_REHEARSAL_VERIFICATION_FAILURES = [
  "ADAPTER_REFUSED",
  "BRANCH_MISMATCH",
  "CLEANUP_GAP",
  "EVIDENCE_OVERCLAIM",
  "EXTERNAL_CLAIM_MISMATCH",
  "FAKE_CONTRACT_BINDING",
  "INPUT_OVERSIZED",
  "INPUT_SHAPE",
  "NON_CANONICAL_JSON",
  "PLAN_BINDING",
  "RECEIPT_REFUSED",
  "REPORT_CLEANUP_COUPLING",
  "RUN_NONTERMINAL",
  "SYNTHETIC_MISMATCH",
  "TWO_SURFACE_GAP",
  "UNSAFE_CONTENT",
] as const satisfies readonly TeamsMissedCallRehearsalVerificationFailure[];

export type TeamsMissedCallRehearsalVerificationRequest =
  TeamsMissedCallRehearsalResult;

export type {
  TeamsMissedCallRehearsalVerificationFailure,
  VerifiedTeamsMissedCallRehearsalSummary,
};

export const TEAMS_MISSED_CALL_REHEARSAL_MAX_REQUEST_BYTES = 32_768;
export const TEAMS_MISSED_CALL_REHEARSAL_MAX_RESPONSE_BYTES = 4_096;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;
const BRANCHES = [
  "stage-only",
  "native-retained",
  "reported-retained",
  "native-cleaned",
] as const satisfies readonly TeamsMissedCallSyntheticBranch[];
const CLAIM_KEYS = [
  "liveCall",
  "nativeMissedCallArtifact",
  "activityItem",
  "learnerVisibility",
  "learnerInterpretation",
  "response",
  "cleanup",
  "retention",
  "voicemail",
  "callback",
  "botPath",
  "externalIdentity",
  "externalProof",
] as const;

export class TeamsMissedCallRehearsalContractError extends Error {
  readonly category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT";

  constructor(
    category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT",
  ) {
    super("Teams missed-call rehearsal contract validation failed.");
    this.name = "TeamsMissedCallRehearsalContractError";
    this.category = category;
  }
}

export function parseTeamsMissedCallRehearsalVerificationRequest(
  value: unknown,
): TeamsMissedCallRehearsalVerificationRequest {
  const inspected = inspectBoundedRehearsalValue(
    value,
    TEAMS_MISSED_CALL_REHEARSAL_MAX_REQUEST_BYTES,
  );
  if (inspected === "INPUT_OVERSIZED" || inspected === "UNSAFE_CONTENT") {
    throw new TeamsMissedCallRehearsalContractError(inspected);
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
    "envelope",
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
  if (
    binding.scenarioId !== "teams-missed-call-observation" ||
    binding.manifestSchemaVersion !== 2 ||
    !BRANCHES.includes(binding.syntheticBranch as TeamsMissedCallSyntheticBranch)
  ) {
    fail();
  }
  digest(binding.planDigestSha256);
  digest(binding.fakeRunDigestSha256);

  const stages = exactRecord(output.stages, [
    "plan",
    "fakeLifecycle",
    "adapter",
    "receiptVerifier",
    "envelope",
  ]);
  Object.values(stages).forEach(safeCategory);

  const fakeRun = exactRecord(output.fakeRun, [
    "stage",
    "nativeHistory",
    "activity",
    "report",
    "retention",
    "terminalCleanup",
  ]);
  Object.values(fakeRun).forEach(safeCategory);

  const receipt = exactRecord(output.receipt, [
    "adapterCandidateAccepted",
    "verifierAccepted",
    "candidateClaimCount",
    "canonicalLearnerInterpretation",
  ]);
  if (
    typeof receipt.adapterCandidateAccepted !== "boolean" ||
    typeof receipt.verifierAccepted !== "boolean"
  ) {
    fail();
  }
  boundedInteger(receipt.candidateClaimCount, 0, 64);
  safeCategory(receipt.canonicalLearnerInterpretation);

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

  return value as TeamsMissedCallRehearsalVerificationRequest;
}

export function isBoundedTeamsMissedCallRehearsalRequest(
  value: unknown,
): value is TeamsMissedCallRehearsalVerificationRequest {
  try {
    parseTeamsMissedCallRehearsalVerificationRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isVerifiedTeamsMissedCallRehearsalSummary(
  value: unknown,
  request: TeamsMissedCallRehearsalVerificationRequest,
): value is VerifiedTeamsMissedCallRehearsalSummary {
  if (
    !isRecord(value) ||
    !isRecord(request.binding) ||
    !isRecord(request.receipt)
  ) {
    return false;
  }
  const branch = request.binding.syntheticBranch;
  const expectedNative = branch === "stage-only"
    ? "uninspected"
    : "two-surface";
  const expectedReport = branch === "reported-retained"
    ? "reported"
    : "uninspected";
  const expectedCleanup = branch === "native-cleaned"
    ? "two-surface-absent"
    : "uninspected";
  const keys = [
    "schemaVersion",
    "label",
    "status",
    "scenarioId",
    "manifestSchemaVersion",
    "planDigestSha256",
    "fakeRunDigestSha256",
    "syntheticBranch",
    "fakeContract",
    "nativeObservation",
    "report",
    "cleanup",
    "adapter",
    "receiptVerifier",
    "externalEvidence",
    "canonicalLearnerInterpretation",
    "claimCount",
  ];
  return (
    exactKeys(value, keys) &&
    value.schemaVersion === 1 &&
    value.label === REHEARSAL_VERIFIED_LABEL &&
    value.status === "verified" &&
    value.scenarioId === "teams-missed-call-observation" &&
    value.manifestSchemaVersion === 2 &&
    value.planDigestSha256 === request.binding.planDigestSha256 &&
    value.fakeRunDigestSha256 === request.binding.fakeRunDigestSha256 &&
    value.syntheticBranch === branch &&
    value.fakeContract === "one-attempt-categorical-verified" &&
    value.nativeObservation === expectedNative &&
    value.report === expectedReport &&
    value.cleanup === expectedCleanup &&
    value.adapter === "accepted" &&
    value.receiptVerifier === "accepted" &&
    value.externalEvidence === "all-uninspected" &&
    value.canonicalLearnerInterpretation === "uninspected" &&
    value.claimCount === request.receipt.candidateClaimCount
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, keys)) fail();
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key, index) => key === keys[index])
  );
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
  throw new TeamsMissedCallRehearsalContractError("INPUT_SHAPE");
}
