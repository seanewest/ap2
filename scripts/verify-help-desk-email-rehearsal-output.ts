import { createHash } from "node:crypto";
import { HELP_DESK_EMAIL_SCENARIO } from
  "../src/scenarios/help-desk-email.ts";
import {
  adaptHelpDeskEmailOperationToReceipt,
  HelpDeskEmailReceiptAdapterError,
  type HelpDeskEmailReceiptAdapterInput,
} from "../src/scenarios/help-desk-email-receipt-adapter.ts";
import {
  bindRehearsalPlan,
  declareRehearsalEnvelope,
  exactRehearsalRecord,
  inspectBoundedRehearsalValue,
  parseCanonicalRehearsalJson,
  REHEARSAL_ONLY_LABEL,
  REHEARSAL_VERIFIED_LABEL,
  type SharedRehearsalInvariantFailure,
} from "../src/scenarios/rehearsal-envelope-invariants.ts";
import {
  EvidenceReceiptError,
  verifyScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import {
  compileHelpDeskEmailRehearsalPlan,
  type HelpDeskEmailRehearsalResult,
  type HelpDeskEmailSyntheticBranch,
} from "./help-desk-email-rehearsal.ts";

const MAX_OUTPUT_BYTES = 32 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const EXTERNAL_CLAIMS = [
  "emailSend",
  "inboxVisibility",
  "learnerInterpretation",
  "response",
  "cleanup",
  "retention",
  "auditOrDetection",
  "teamsCall",
  "voicemail",
] as const;

export type HelpDeskEmailRehearsalVerificationFailure =
  | "ADAPTER_REFUSED"
  | "BRANCH_MISMATCH"
  | "CLEANUP_GAP"
  | "EVIDENCE_OVERCLAIM"
  | "FAKE_CONTRACT_BINDING"
  | "INPUT_OVERSIZED"
  | "INPUT_SHAPE"
  | "NON_CANONICAL_JSON"
  | "PLAN_BINDING"
  | "RECEIPT_REFUSED"
  | "RUN_NONTERMINAL"
  | "UNSAFE_CONTENT";

export class HelpDeskEmailRehearsalVerificationError extends Error {
  readonly category: HelpDeskEmailRehearsalVerificationFailure;

  constructor(category: HelpDeskEmailRehearsalVerificationFailure) {
    super(category);
    this.name = "HelpDeskEmailRehearsalVerificationError";
    this.category = category;
  }
}

export interface VerifiedHelpDeskEmailRehearsalSummary {
  schemaVersion: 1;
  label: typeof REHEARSAL_VERIFIED_LABEL;
  status: "verified";
  scenarioId: "help-desk-email-observation";
  manifestSchemaVersion: 2;
  planDigestSha256: string;
  fakeRunDigestSha256: string;
  syntheticBranch: HelpDeskEmailSyntheticBranch;
  fakeContract: "one-shot-terminal-verified";
  adapter: "accepted";
  receiptVerifier: "accepted";
  envelope: "accepted";
  externalEvidence: "all-uninspected";
  claimCount: number;
}

export function verifyHelpDeskEmailRehearsalOutput(
  value: unknown,
): VerifiedHelpDeskEmailRehearsalSummary {
  const inputFailure = inspectBoundedRehearsalValue(
    value,
    MAX_OUTPUT_BYTES,
  );
  if (inputFailure) throw sharedFailure(inputFailure);

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
  const expectedFakeRun = expected.fakeRun!;
  const expectedReceipt = expected.receipt!;

  const stages = exactRecord(output.stages, Object.keys(expected.stages));
  const envelope = exactRecord(
    output.envelope,
    Object.keys(expected.envelope!),
  );
  const fakeRun = exactRecord(
    output.fakeRun,
    Object.keys(expectedFakeRun),
  );
  const receipt = exactRecord(
    output.receipt,
    Object.keys(expectedReceipt),
  );
  const externalEvidence = exactRecord(
    receipt.externalEvidence,
    Object.keys(expectedReceipt.externalEvidence),
  );

  const planBinding = bindRehearsalPlan({
    scenarioId: binding.scenarioId,
    expectedScenarioId: HELP_DESK_EMAIL_SCENARIO.id,
    manifestSchemaVersion: binding.manifestSchemaVersion,
    expectedManifestSchemaVersion: HELP_DESK_EMAIL_SCENARIO.schemaVersion,
    planDigestSha256: binding.planDigestSha256,
    expectedPlanDigestSha256: expectedBinding.planDigestSha256,
  });
  if (!planBinding.ok) throw sharedFailure(planBinding.failure);

  const externalStates = EXTERNAL_CLAIMS.map((key) =>
    externalEvidence[key]
  );
  const declaration = declareRehearsalEnvelope({
    label: output.label,
    status: output.status,
    failure: output.failure,
    syntheticValues: [
      fakeRun.send,
      fakeRun.learnerVisibility,
      fakeRun.learnerInterpretation,
      fakeRun.retention,
      fakeRun.cleanup,
      fakeRun.auditOrDetection,
      fakeRun.teamsCall,
      fakeRun.voicemail,
      fakeRun.terminalState,
    ],
    externalClaims: {
      total: externalStates.length,
      uninspected: externalStates.filter((state) =>
        state === "uninspected"
      ).length,
      nonUninspected: externalStates.filter((state) =>
        state !== "uninspected"
      ).length,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);

  if (JSON.stringify(stages) !== JSON.stringify(expected.stages)) {
    throw failure("RUN_NONTERMINAL");
  }
  if (
    fakeRun.learnerInterpretation !== "synthetic-uninspected" ||
    fakeRun.auditOrDetection !== "synthetic-uninspected" ||
    fakeRun.teamsCall !== "synthetic-uninspected" ||
    fakeRun.voicemail !== "synthetic-uninspected"
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }
  if (
    fakeRun.cleanup === "synthetic-cleaned" &&
    (
      fakeRun.learnerVisibility !== "synthetic-observed" ||
      fakeRun.retention !== "synthetic-absent"
    )
  ) {
    throw failure("CLEANUP_GAP");
  }
  if (
    fakeRun.learnerVisibility !== expectedFakeRun.learnerVisibility ||
    fakeRun.retention !== expectedFakeRun.retention ||
    fakeRun.cleanup !== expectedFakeRun.cleanup ||
    fakeRun.terminalState !== expectedFakeRun.terminalState
  ) {
    throw failure("BRANCH_MISMATCH");
  }
  if (
    fakeRun.operationAttempts !== 1 ||
    fakeRun.journalEntries !== 2 ||
    fakeRun.send !== "synthetic-accepted"
  ) {
    throw failure("FAKE_CONTRACT_BINDING");
  }
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
    receipt.candidateClaimCount !== expectedReceipt.candidateClaimCount
  ) {
    throw failure("RECEIPT_REFUSED");
  }
  if (
    JSON.stringify(envelope) !== JSON.stringify(expected.envelope)
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
    scenarioId: "help-desk-email-observation",
    manifestSchemaVersion: 2,
    planDigestSha256: planBinding.value.planDigestSha256,
    fakeRunDigestSha256: expectedBinding.fakeRunDigestSha256,
    syntheticBranch: branch,
    fakeContract: "one-shot-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    envelope: "accepted",
    externalEvidence: declaration.value.externalEvidence,
    claimCount: expectedReceipt.candidateClaimCount,
  });
}

export function verifyHelpDeskEmailRehearsalOutputText(
  text: string,
): VerifiedHelpDeskEmailRehearsalSummary {
  const parsed = parseCanonicalRehearsalJson(text, MAX_OUTPUT_BYTES);
  if (!parsed.ok) throw sharedFailure(parsed.failure);
  return verifyHelpDeskEmailRehearsalOutput(parsed.value);
}

function independentlyExpectedOutput(
  branch: HelpDeskEmailSyntheticBranch,
): HelpDeskEmailRehearsalResult {
  let plan;
  try {
    plan = compileHelpDeskEmailRehearsalPlan();
  } catch {
    throw failure("PLAN_BINDING");
  }

  const adapterInput = reconstructedAdapterInput(branch);
  let candidate;
  try {
    candidate = adaptHelpDeskEmailOperationToReceipt(adapterInput);
  } catch (error) {
    if (error instanceof HelpDeskEmailReceiptAdapterError) {
      throw failure("ADAPTER_REFUSED");
    }
    throw failure("ADAPTER_REFUSED");
  }
  try {
    verifyScenarioEvidenceReceipt(
      candidate,
      HELP_DESK_EMAIL_SCENARIO,
    );
  } catch (error) {
    if (error instanceof EvidenceReceiptError) {
      throw failure("RECEIPT_REFUSED");
    }
    throw failure("RECEIPT_REFUSED");
  }

  const fakeRun = reconstructedFakeRun(branch);
  const externalEvidence = Object.fromEntries(
    EXTERNAL_CLAIMS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIMS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: REHEARSAL_ONLY_LABEL,
    status: "completed",
    failure: null,
    syntheticValues: [
      fakeRun.send,
      fakeRun.learnerVisibility,
      fakeRun.learnerInterpretation,
      fakeRun.retention,
      fakeRun.cleanup,
      fakeRun.auditOrDetection,
      fakeRun.teamsCall,
      fakeRun.voicemail,
      fakeRun.terminalState,
    ],
    externalClaims: {
      total: EXTERNAL_CLAIMS.length,
      uninspected: EXTERNAL_CLAIMS.length,
      nonUninspected: 0,
    },
  });
  if (!declaration.ok) throw failure("EVIDENCE_OVERCLAIM");

  return {
    schemaVersion: 1,
    label: REHEARSAL_ONLY_LABEL,
    status: "completed",
    failure: null,
    binding: {
      scenarioId: "help-desk-email-observation",
      manifestSchemaVersion: 2,
      planDigestSha256: plan.digestSha256,
      fakeRunDigestSha256: sha256(adapterInput),
      syntheticBranch: branch,
    },
    stages: {
      plan: "compiled",
      fakeOperation: "completed",
      adapter: "accepted",
      fakeBinding: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
    },
    fakeRun,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: candidate.claims.length,
      externalEvidence,
    },
  };
}

function reconstructedAdapterInput(
  branch: HelpDeskEmailSyntheticBranch,
): HelpDeskEmailReceiptAdapterInput {
  const learnerObserved = branch !== "send-accepted";
  const cleaned = branch === "learner-observed-cleaned";
  return {
    schemaVersion: 1,
    scenarioId: "help-desk-email-observation",
    result: {
      operation: "send-help-desk-email",
      outcome: "accepted",
      observerRole: "evidenceProducer",
      semanticBoundary: "email-only",
    },
    journal: [
      {
        sequence: 1,
        operation: "send-help-desk-email",
        transition: "attempted",
      },
      {
        sequence: 2,
        operation: "send-help-desk-email",
        transition: "accepted",
      },
    ],
    learner: {
      artifact: learnerObserved
        ? {
          state: "observed",
          observerRole: "learner",
          operation: "read-marker-after",
          artifact: "outlook-email",
        }
        : { state: "uninspected" },
      interpretation: { state: "uninspected" },
    },
    cleanup: cleaned
      ? {
        state: "cleaned",
        mutationObserverRole: "evidenceProducer",
        mutationOperation: "delete-retained-help-desk-email",
        terminalObserverRole: "learner",
        terminalOperation: "read-marker-after",
        retention: "absent",
      }
      : { state: "uninspected" },
  };
}

function reconstructedFakeRun(
  branch: HelpDeskEmailSyntheticBranch,
): NonNullable<HelpDeskEmailRehearsalResult["fakeRun"]> {
  const learnerObserved = branch !== "send-accepted";
  const cleaned = branch === "learner-observed-cleaned";
  return {
    operationAttempts: 1,
    journalEntries: 2,
    send: "synthetic-accepted",
    learnerVisibility: learnerObserved
      ? "synthetic-observed"
      : "synthetic-uninspected",
    learnerInterpretation: "synthetic-uninspected",
    retention: cleaned
      ? "synthetic-absent"
      : learnerObserved
      ? "synthetic-retained"
      : "synthetic-uninspected",
    cleanup: cleaned
      ? "synthetic-cleaned"
      : "synthetic-uninspected",
    auditOrDetection: "synthetic-uninspected",
    teamsCall: "synthetic-uninspected",
    voicemail: "synthetic-uninspected",
    terminalState: `synthetic-${branch}`,
  };
}

function parseBranch(value: unknown): HelpDeskEmailSyntheticBranch {
  if (
    value !== "send-accepted" &&
    value !== "learner-observed-retained" &&
    value !== "learner-observed-cleaned"
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
  category: HelpDeskEmailRehearsalVerificationFailure,
): HelpDeskEmailRehearsalVerificationError {
  return new HelpDeskEmailRehearsalVerificationError(category);
}

function sharedFailure(
  category: SharedRehearsalInvariantFailure,
): HelpDeskEmailRehearsalVerificationError {
  const mapped: HelpDeskEmailRehearsalVerificationFailure =
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
