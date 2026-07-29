import { createHash } from "node:crypto";
import {
  bindRehearsalPlan,
  declareRehearsalEnvelope,
  exactRehearsalRecord,
  inspectBoundedRehearsalValue,
  parseCanonicalRehearsalJson,
  REHEARSAL_VERIFIED_LABEL,
  type SharedRehearsalInvariantFailure,
} from "../src/scenarios/rehearsal-envelope-invariants.ts";
import {
  EvidenceReceiptError,
  verifyScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import {
  adaptTeamsMissedCallObservationToReceipt,
  canonicalTeamsMissedCallReceiptAdapterInput,
  TeamsMissedCallReceiptAdapterError,
  type TeamsMissedCallReceiptAdapterInput,
} from "../src/scenarios/teams-missed-call-receipt-adapter.ts";
import { TEAMS_MISSED_CALL_SCENARIO } from
  "../src/scenarios/teams-missed-call.ts";
import {
  compileTeamsMissedCallRehearsalPlan,
  TEAMS_MISSED_CALL_REHEARSAL_EXTERNAL_CLAIMS,
  type TeamsMissedCallRehearsalResult,
  type TeamsMissedCallSyntheticBranch,
} from "./teams-missed-call-rehearsal.ts";

const MAX_OUTPUT_BYTES = 32 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SCENARIO_ID = "teams-missed-call-observation";
export type TeamsMissedCallRehearsalVerificationFailure =
  | SharedRehearsalInvariantFailure
  | "ADAPTER_REFUSED"
  | "BRANCH_MISMATCH"
  | "CLEANUP_GAP"
  | "EVIDENCE_OVERCLAIM"
  | "FAKE_CONTRACT_BINDING"
  | "RECEIPT_REFUSED"
  | "REPORT_CLEANUP_COUPLING"
  | "TWO_SURFACE_GAP";

export interface VerifiedTeamsMissedCallRehearsalSummary {
  schemaVersion: 1;
  label: typeof REHEARSAL_VERIFIED_LABEL;
  status: "verified";
  scenarioId: typeof SCENARIO_ID;
  manifestSchemaVersion: 2;
  planDigestSha256: string;
  fakeRunDigestSha256: string;
  syntheticBranch: TeamsMissedCallSyntheticBranch;
  fakeContract: "one-attempt-categorical-verified";
  nativeObservation: "uninspected" | "two-surface";
  report: "uninspected" | "reported";
  cleanup: "uninspected" | "two-surface-absent";
  adapter: "accepted";
  receiptVerifier: "accepted";
  externalEvidence: "all-uninspected";
  canonicalLearnerInterpretation: "uninspected";
  claimCount: number;
}

export class TeamsMissedCallRehearsalVerificationError extends Error {
  readonly category: TeamsMissedCallRehearsalVerificationFailure;

  constructor(category: TeamsMissedCallRehearsalVerificationFailure) {
    super(category);
    this.name = "TeamsMissedCallRehearsalVerificationError";
    this.category = category;
  }
}

export function verifyTeamsMissedCallRehearsalOutput(
  value: unknown,
): VerifiedTeamsMissedCallRehearsalSummary {
  const inputFailure = inspectBoundedRehearsalValue(
    value,
    MAX_OUTPUT_BYTES,
  );
  if (inputFailure !== null) throw sharedFailure(inputFailure);

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
  if (output.schemaVersion !== 1) throw failure("INPUT_SHAPE");

  const binding = exactRecord(output.binding, [
    "scenarioId",
    "manifestSchemaVersion",
    "planDigestSha256",
    "fakeRunDigestSha256",
    "syntheticBranch",
  ]);
  const branch = parseBranch(binding.syntheticBranch);
  const expected = independentlyExpectedOutput(branch);
  const expectedBinding = expected.binding!;

  const stages = exactRecord(output.stages, Object.keys(expected.stages));
  const fakeRun = exactRecord(output.fakeRun, Object.keys(expected.fakeRun!));
  const receipt = exactRecord(output.receipt, Object.keys(expected.receipt!));
  const envelope = exactRecord(
    output.envelope,
    Object.keys(expected.envelope!),
  );
  const claims = exactRecord(
    envelope.claims,
    Object.keys(expected.envelope!.claims),
  );

  const planBinding = bindRehearsalPlan({
    scenarioId: binding.scenarioId,
    expectedScenarioId: SCENARIO_ID,
    manifestSchemaVersion: binding.manifestSchemaVersion,
    expectedManifestSchemaVersion:
      TEAMS_MISSED_CALL_SCENARIO.schemaVersion,
    planDigestSha256: binding.planDigestSha256,
    expectedPlanDigestSha256: expectedBinding.planDigestSha256,
  });
  if (!planBinding.ok) throw sharedFailure(planBinding.failure);

  const claimStates = TEAMS_MISSED_CALL_REHEARSAL_EXTERNAL_CLAIMS.map(
    (key) => claims[key],
  );
  const declaration = declareRehearsalEnvelope({
    label: output.label,
    status: output.status,
    failure: output.failure,
    syntheticValues: Object.values(fakeRun),
    externalClaims: {
      total: claimStates.length,
      uninspected: claimStates.filter((state) =>
        state === "uninspected"
      ).length,
      nonUninspected: claimStates.filter((state) =>
        state !== "uninspected"
      ).length,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);

  if (JSON.stringify(stages) !== JSON.stringify(expected.stages)) {
    throw failure("RUN_NONTERMINAL");
  }
  verifyTwoSurfaceContract(fakeRun);
  verifyReportAndCleanupContract(fakeRun, branch);
  if (
    typeof binding.fakeRunDigestSha256 !== "string" ||
    !SHA256.test(binding.fakeRunDigestSha256) ||
    binding.fakeRunDigestSha256 !== expectedBinding.fakeRunDigestSha256
  ) {
    throw failure("FAKE_CONTRACT_BINDING");
  }
  if (
    receipt.adapterCandidateAccepted !== true ||
    receipt.verifierAccepted !== true ||
    receipt.candidateClaimCount !== expected.receipt!.candidateClaimCount ||
    receipt.canonicalLearnerInterpretation !== "uninspected"
  ) {
    throw failure("RECEIPT_REFUSED");
  }
  if (
    envelope.terminalState !== expected.envelope!.terminalState ||
    envelope.observationSource !== expected.envelope!.observationSource ||
    envelope.externalEvidence !== expected.envelope!.externalEvidence ||
    claimStates.some((state) => state !== "uninspected")
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw failure("INPUT_SHAPE");
  }

  return deepFreeze({
    schemaVersion: 1,
    label: REHEARSAL_VERIFIED_LABEL,
    status: "verified",
    scenarioId: SCENARIO_ID,
    manifestSchemaVersion: 2,
    planDigestSha256: planBinding.value.planDigestSha256,
    fakeRunDigestSha256: expectedBinding.fakeRunDigestSha256,
    syntheticBranch: branch,
    fakeContract: "one-attempt-categorical-verified",
    nativeObservation: branch === "stage-only"
      ? "uninspected"
      : "two-surface",
    report: branch === "reported-retained"
      ? "reported"
      : "uninspected",
    cleanup: branch === "native-cleaned"
      ? "two-surface-absent"
      : "uninspected",
    adapter: "accepted",
    receiptVerifier: "accepted",
    externalEvidence: declaration.value.externalEvidence,
    canonicalLearnerInterpretation: "uninspected",
    claimCount: expected.receipt!.candidateClaimCount,
  });
}

export function verifyTeamsMissedCallRehearsalOutputText(
  text: string,
): VerifiedTeamsMissedCallRehearsalSummary {
  const parsed = parseCanonicalRehearsalJson(text, MAX_OUTPUT_BYTES);
  if (!parsed.ok) throw sharedFailure(parsed.failure);
  return verifyTeamsMissedCallRehearsalOutput(parsed.value);
}

function independentlyExpectedOutput(
  branch: TeamsMissedCallSyntheticBranch,
): TeamsMissedCallRehearsalResult {
  let plan;
  try {
    plan = compileTeamsMissedCallRehearsalPlan(branch);
  } catch {
    throw failure("PLAN_BINDING");
  }

  const adapterInput = reconstructedAdapterInput(branch);
  let candidate;
  try {
    candidate = adaptTeamsMissedCallObservationToReceipt(adapterInput);
  } catch (error) {
    if (error instanceof TeamsMissedCallReceiptAdapterError) {
      throw failure("ADAPTER_REFUSED");
    }
    throw failure("ADAPTER_REFUSED");
  }
  try {
    verifyScenarioEvidenceReceipt(candidate, TEAMS_MISSED_CALL_SCENARIO);
  } catch (error) {
    if (error instanceof EvidenceReceiptError) {
      throw failure("RECEIPT_REFUSED");
    }
    throw failure("RECEIPT_REFUSED");
  }
  const interpretation = candidate.claims.find(
    ({ id }) => id === "learner-interpretation",
  );
  if (interpretation?.state !== "uninspected") {
    throw failure("EVIDENCE_OVERCLAIM");
  }

  const fakeRun = reconstructedFakeRun(branch);
  const claims = Object.fromEntries(
    TEAMS_MISSED_CALL_REHEARSAL_EXTERNAL_CLAIMS.map((key) => [
      key,
      "uninspected",
    ]),
  ) as Record<
    typeof TEAMS_MISSED_CALL_REHEARSAL_EXTERNAL_CLAIMS[number],
    "uninspected"
  >;
  const envelope = declareRehearsalEnvelope({
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    syntheticValues: Object.values(fakeRun),
    externalClaims: {
      total: TEAMS_MISSED_CALL_REHEARSAL_EXTERNAL_CLAIMS.length,
      uninspected: TEAMS_MISSED_CALL_REHEARSAL_EXTERNAL_CLAIMS.length,
      nonUninspected: 0,
    },
  });
  if (!envelope.ok) throw sharedFailure(envelope.failure);

  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    binding: {
      scenarioId: SCENARIO_ID,
      manifestSchemaVersion: 2,
      planDigestSha256: plan.digestSha256,
      fakeRunDigestSha256: sha256(adapterInput),
      syntheticBranch: branch,
    },
    stages: {
      plan: "compiled",
      fakeLifecycle: "completed",
      adapter: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    fakeRun,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: candidate.claims.length,
      canonicalLearnerInterpretation: "uninspected",
    },
    envelope: {
      terminalState: envelope.value.terminalState,
      observationSource: envelope.value.observationSource,
      externalEvidence: envelope.value.externalEvidence,
      claims,
    },
  };
}

function reconstructedAdapterInput(
  branch: TeamsMissedCallSyntheticBranch,
): TeamsMissedCallReceiptAdapterInput {
  const input = structuredClone(
    canonicalTeamsMissedCallReceiptAdapterInput(),
  );
  if (branch !== "stage-only") {
    input.nativeObservation = {
      state: "observed",
      observerRole: "learner",
      operation: "read-cory-call-history",
      history: "one-missed-incoming",
      activity: "one-matching-notification",
      authenticity: "platform-native",
    };
  }
  if (branch === "reported-retained") {
    input.interpretation = {
      state: "reported",
      observerRole: "learner",
      operation: "interpret-missed-call",
      responseAction: "report-observation",
      conclusion: "missed-teams-call-without-voicemail",
    };
  }
  if (branch === "native-cleaned") {
    input.cleanup = {
      state: "cleaned",
      mutationObserverRole: "evidenceProducer",
      mutationOperation: "clean-retained-call-history",
      terminalObserverRole: "learner",
      terminalOperation: "read-cory-call-history",
      history: "absent",
      activity: "absent",
      retention: "absent",
    };
  }
  return input;
}

function reconstructedFakeRun(
  branch: TeamsMissedCallSyntheticBranch,
): NonNullable<TeamsMissedCallRehearsalResult["fakeRun"]> {
  return {
    stage: "synthetic-one-attempt-completed",
    nativeHistory: branch === "stage-only"
      ? "synthetic-uninspected"
      : "synthetic-one-missed-incoming",
    activity: branch === "stage-only"
      ? "synthetic-uninspected"
      : "synthetic-one-matching-notification",
    report: branch === "reported-retained"
      ? "synthetic-reported"
      : "synthetic-uninspected",
    retention: branch === "stage-only"
      ? "synthetic-uninspected"
      : branch === "native-cleaned"
      ? "synthetic-absent"
      : "synthetic-retained",
    terminalCleanup: branch === "native-cleaned"
      ? "synthetic-two-surface-absent"
      : "synthetic-uninspected",
  };
}

function verifyTwoSurfaceContract(fakeRun: Record<string, unknown>): void {
  const historyObserved =
    fakeRun.nativeHistory === "synthetic-one-missed-incoming";
  const activityObserved =
    fakeRun.activity === "synthetic-one-matching-notification";
  const historyUninspected =
    fakeRun.nativeHistory === "synthetic-uninspected";
  const activityUninspected =
    fakeRun.activity === "synthetic-uninspected";
  if (
    (!historyObserved || !activityObserved) &&
    (!historyUninspected || !activityUninspected)
  ) {
    throw failure("TWO_SURFACE_GAP");
  }
}

function verifyReportAndCleanupContract(
  fakeRun: Record<string, unknown>,
  branch: TeamsMissedCallSyntheticBranch,
): void {
  const reported = fakeRun.report === "synthetic-reported";
  const cleaned =
    fakeRun.terminalCleanup === "synthetic-two-surface-absent";
  if (
    reported !== (branch === "reported-retained") ||
    (reported && cleaned)
  ) {
    throw failure("REPORT_CLEANUP_COUPLING");
  }
  if (
    cleaned !== (branch === "native-cleaned") ||
    (cleaned && fakeRun.retention !== "synthetic-absent")
  ) {
    throw failure("CLEANUP_GAP");
  }
}

function parseBranch(value: unknown): TeamsMissedCallSyntheticBranch {
  if (
    value !== "stage-only" &&
    value !== "native-retained" &&
    value !== "reported-retained" &&
    value !== "native-cleaned"
  ) {
    throw failure("BRANCH_MISMATCH");
  }
  return value;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  const record = exactRehearsalRecord(value, expectedKeys);
  if (record === null) throw failure("INPUT_SHAPE");
  return record;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function failure(
  category: TeamsMissedCallRehearsalVerificationFailure,
): TeamsMissedCallRehearsalVerificationError {
  return new TeamsMissedCallRehearsalVerificationError(category);
}

function sharedFailure(
  category: SharedRehearsalInvariantFailure,
): TeamsMissedCallRehearsalVerificationError {
  const mapped: TeamsMissedCallRehearsalVerificationFailure =
    category === "SYNTHETIC_MISMATCH" ||
      category === "EXTERNAL_CLAIM_MISMATCH"
      ? "EVIDENCE_OVERCLAIM"
      : category;
  return failure(mapped);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
