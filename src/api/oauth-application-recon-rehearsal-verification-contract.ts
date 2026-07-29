import type {
  OauthApplicationReconRehearsalResult,
} from "../../scripts/oauth-application-recon-rehearsal";
import type {
  OauthApplicationReconRehearsalVerificationFailure as OfflineVerificationFailure,
  VerifiedOauthApplicationReconRehearsalSummary as OfflineVerifiedSummary,
} from "../../scripts/verify-oauth-application-recon-rehearsal-output";
import {
  inspectBoundedRehearsalValue,
  REHEARSAL_ONLY_LABEL,
  REHEARSAL_VERIFIED_LABEL,
} from "../scenarios/rehearsal-envelope-invariants.ts";

export const OAUTH_APPLICATION_RECON_REHEARSAL_VERIFICATION_FAILURES = [
  "ADAPTER_REFUSED",
  "EVIDENCE_OVERCLAIM",
  "EXTERNAL_CLAIM_MISMATCH",
  "FAKE_CONTRACT_BINDING",
  "FAKE_SEQUENCE",
  "INPUT_OVERSIZED",
  "INPUT_SHAPE",
  "NON_CANONICAL_JSON",
  "OUTPUT_BINDING",
  "PAGINATION_UNCERTAIN",
  "PLAN_BINDING",
  "RECEIPT_REFUSED",
  "RUN_NONTERMINAL",
  "SYNTHETIC_MISMATCH",
  "UNSAFE_CONTENT",
] as const satisfies readonly OfflineVerificationFailure[];

export type OauthApplicationReconRehearsalVerificationRequest =
  OauthApplicationReconRehearsalResult;
export type OauthApplicationReconRehearsalVerificationFailure =
  OfflineVerificationFailure;
export type VerifiedOauthApplicationReconRehearsalSummary =
  OfflineVerifiedSummary;

export const OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES = 32_768;
export const OAUTH_APPLICATION_RECON_REHEARSAL_MAX_RESPONSE_BYTES = 4_096;
export const OAUTH_APPLICATION_RECON_REHEARSAL_OUTPUT_DIGEST_SHA256 =
  "5bff66e08b05f871c21c5491d85314e64add30ce89bfdab734e2b35182dc378b";

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;
const CLAIM_KEYS = [
  "tenantContents",
  "rawIdentities",
  "externalArtifact",
  "detectorAttribution",
  "auditCompleteness",
  "learnerVisibility",
  "learnerInterpretation",
  "permissionRestoration",
  "evidenceWindowClosure",
  "cleanup",
  "retention",
  "revocation",
  "externalImpact",
] as const;

export class OauthApplicationReconRehearsalContractError extends Error {
  readonly category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT";

  constructor(
    category: "INPUT_SHAPE" | "INPUT_OVERSIZED" | "UNSAFE_CONTENT",
  ) {
    super("OAuth application-recon rehearsal contract validation failed.");
    this.name = "OauthApplicationReconRehearsalContractError";
    this.category = category;
  }
}

export function parseOauthApplicationReconRehearsalVerificationRequest(
  value: unknown,
): OauthApplicationReconRehearsalVerificationRequest {
  const inspected = inspectBoundedRehearsalValue(
    value,
    OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES,
  );
  if (inspected === "INPUT_OVERSIZED" || inspected === "UNSAFE_CONTENT") {
    throw new OauthApplicationReconRehearsalContractError(inspected);
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
  if (
    output.schemaVersion !== 1 ||
    output.label !== REHEARSAL_ONLY_LABEL
  ) fail();
  safeCategory(output.status);
  if (output.failure !== null) safeCategory(output.failure);

  const binding = exactRecord(output.binding, [
    "scenarioId",
    "manifestSchemaVersion",
    "planDigestSha256",
    "fakeResultDigestSha256",
  ]);
  safeCategory(binding.scenarioId);
  boundedInteger(binding.manifestSchemaVersion, 1, 100);
  digest(binding.planDigestSha256);
  digest(binding.fakeResultDigestSha256);

  const stages = exactRecord(output.stages, [
    "plan",
    "fakeFourRead",
    "adapter",
    "fakeBinding",
    "receiptVerifier",
    "envelope",
  ]);
  Object.values(stages).forEach(safeCategory);

  const fakeRun = exactRecord(output.fakeRun, [
    "terminalState",
    "orderedReads",
    "collectionBoundary",
    "evidenceBoundary",
    "detector",
    "learner",
    "permissionRestoration",
    "cleanup",
  ]);
  safeCategory(fakeRun.terminalState);
  if (
    !Array.isArray(fakeRun.orderedReads) ||
    fakeRun.orderedReads.length < 1 ||
    fakeRun.orderedReads.length > 8
  ) fail();
  fakeRun.orderedReads.forEach(safeCategory);
  [
    fakeRun.collectionBoundary,
    fakeRun.evidenceBoundary,
    fakeRun.detector,
    fakeRun.learner,
    fakeRun.permissionRestoration,
    fakeRun.cleanup,
  ].forEach(safeCategory);

  const receipt = exactRecord(output.receipt, [
    "adapterCandidateAccepted",
    "verifierAccepted",
    "candidateClaimCount",
    "syntheticReachability",
    "allOtherClaims",
  ]);
  if (
    typeof receipt.adapterCandidateAccepted !== "boolean" ||
    typeof receipt.verifierAccepted !== "boolean"
  ) fail();
  boundedInteger(receipt.candidateClaimCount, 0, 256);
  safeCategory(receipt.syntheticReachability);
  safeCategory(receipt.allOtherClaims);

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
  return value as OauthApplicationReconRehearsalVerificationRequest;
}

export function isBoundedOauthApplicationReconRehearsalRequest(
  value: unknown,
): value is OauthApplicationReconRehearsalVerificationRequest {
  try {
    parseOauthApplicationReconRehearsalVerificationRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function isVerifiedOauthApplicationReconRehearsalSummary(
  value: unknown,
  request: OauthApplicationReconRehearsalVerificationRequest,
): value is VerifiedOauthApplicationReconRehearsalSummary {
  if (
    !isRecord(value) ||
    !isRecord(request.binding) ||
    !isRecord(request.receipt)
  ) return false;
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
      "fakeResultDigestSha256",
      "outputDigestSha256",
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
    value.scenarioId === "oauth-application-reconnaissance" &&
    value.manifestSchemaVersion === 2 &&
    value.planDigestSha256 === request.binding.planDigestSha256 &&
    value.fakeResultDigestSha256 === request.binding.fakeResultDigestSha256 &&
    value.outputDigestSha256 ===
      OAUTH_APPLICATION_RECON_REHEARSAL_OUTPUT_DIGEST_SHA256 &&
    value.fakeContract === "ordered-four-read-terminal-verified" &&
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
  throw new OauthApplicationReconRehearsalContractError("INPUT_SHAPE");
}
