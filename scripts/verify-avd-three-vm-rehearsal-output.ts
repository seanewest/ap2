import { AVD_THREE_VM_SCENARIO } from "../src/scenarios/avd-three-vm.ts";
import {
  buildRehearsalReceiptInput,
  canonicalAvdThreeVmRehearsalRequest,
  compileRehearsalPlanStage,
  compileRehearsalRunnerPlanStage,
  verifyRehearsalReceiptInput,
  type AvdThreeVmRehearsalResult,
  type RehearsalObservationStage,
  type RehearsalRunStage,
} from "./avd-three-vm-rehearsal.ts";

const MAX_OUTPUT_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const TOKEN_LIKE =
  /\b(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]+|access[_-]?token|client[_-]?secret|password)\b/i;
const PRIVATE_PATH =
  /(?:[A-Za-z]:\\|\/(?:home|mnt|Users|tmp|var)\/|AppData|\\\\Users\\\\)/i;
const MARKER_LIKE = /\bap2(?:lab)?-[a-z0-9][a-z0-9-]{7,}\b/i;
const PEM = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/;

export type RehearsalOutputVerificationFailure =
  | "CLEANUP_GAP"
  | "INPUT_OVERSIZED"
  | "INPUT_SHAPE"
  | "NON_CANONICAL_JSON"
  | "OBSERVATION_OVERCLAIM"
  | "PLAN_BINDING"
  | "RECEIPT_BINDING"
  | "RECEIPT_COVERAGE"
  | "RUN_NONTERMINAL"
  | "UNSAFE_CONTENT";

export class RehearsalOutputVerificationError extends Error {
  readonly category: RehearsalOutputVerificationFailure;

  constructor(category: RehearsalOutputVerificationFailure) {
    super(category);
    this.name = "RehearsalOutputVerificationError";
    this.category = category;
  }
}

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

export function canonicalAvdThreeVmRehearsalOutput():
  AvdThreeVmRehearsalResult {
  const request = canonicalAvdThreeVmRehearsalRequest();
  const planStage = compileRehearsalPlanStage(request);
  const runnerStage = compileRehearsalRunnerPlanStage(request, planStage);
  const mutationCount = runnerStage.runnerPlan.mutations.length;
  const cleanupCount = Object.keys(runnerStage.runnerPlan.cleanupGraph).length;
  // The canonical successful journal has one intent/result pair per planned
  // mutation, one roles-grant verification, and for every ordered cleanup
  // step a pre-mutation "state remains" read plus a post-mutation absence read.
  const journal = {
    entries: mutationCount * 2 + cleanupCount * 2 + 1,
    duplicateWrites: 0 as const,
    transitions: {
      intent: mutationCount,
      succeeded: mutationCount,
      failed: 0,
      ambiguous: 0,
      reconciled: cleanupCount + 1,
      "reconciliation-blocked": cleanupCount,
    },
  };
  const observations: RehearsalObservationStage = {
    status: "collected",
    provenance: "synthetic",
    evidence: {
      proven: 4,
      notObserved: 1,
      failedOrMissing: 0,
    },
    terminalInputs: {
      cleanup: "synthetic-supplied",
      roleAbsence: "synthetic-supplied",
      retention: "synthetic-supplied",
    },
  };
  const run: RehearsalRunStage = {
    status: "completed",
    runnerStatus: "completed",
    mutationCount,
    duplicateWriteCount: 0,
    cleanup: "ordered-complete",
    freshTokenRoleAbsence: "synthetic-supplied",
    journal,
  };
  const receiptInput = buildRehearsalReceiptInput(
    planStage.plan.digestSha256,
    run,
    observations,
  );
  const receipt = verifyRehearsalReceiptInput(
    receiptInput,
    planStage.plan.digestSha256,
    run,
    observations,
  );
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    planDigestSha256: planStage.plan.digestSha256,
    stages: {
      plan: "compiled",
      run: "completed",
      observation: "collected",
      receipt: "verified-incomplete",
    },
    runnerJournal: journal,
    observations,
    receipt,
  };
}

export function verifyAvdThreeVmRehearsalOutput(
  value: unknown,
): VerifiedRehearsalOutputSummary {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }
  if (serialized === undefined) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) {
    throw new RehearsalOutputVerificationError("INPUT_OVERSIZED");
  }
  rejectUnsafeStrings(value);
  let expected: AvdThreeVmRehearsalResult;
  try {
    expected = canonicalAvdThreeVmRehearsalOutput();
  } catch {
    throw new RehearsalOutputVerificationError("PLAN_BINDING");
  }
  const output = recordLike(value, expected);
  if (
    output.schemaVersion !== 1 ||
    output.label !== "REHEARSAL_ONLY"
  ) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }

  const stages = recordLike(output.stages, expected.stages);
  const journal = recordLike(
    output.runnerJournal,
    expected.runnerJournal,
  );
  recordLike(
    journal.transitions,
    expected.runnerJournal.transitions,
  );
  const observations = recordLike(
    output.observations,
    expected.observations,
  );
  recordLike(
    observations.evidence,
    expected.observations?.evidence,
  );
  recordLike(
    observations.terminalInputs,
    expected.observations?.terminalInputs,
  );
  const receipt = recordLike(output.receipt, expected.receipt);
  recordLike(receipt.binding, expected.receipt?.binding);
  recordLike(
    receipt.missingCoverage,
    expected.receipt?.missingCoverage,
  );

  if (
    typeof output.planDigestSha256 !== "string" ||
    !SHA256.test(output.planDigestSha256) ||
    output.planDigestSha256 !== expected.planDigestSha256
  ) {
    throw new RehearsalOutputVerificationError("PLAN_BINDING");
  }
  if (
    output.status !== "completed" ||
    output.failure !== null ||
    JSON.stringify(stages) !== JSON.stringify(expected.stages)
  ) {
    throw new RehearsalOutputVerificationError("RUN_NONTERMINAL");
  }
  if (JSON.stringify(journal) !== JSON.stringify(expected.runnerJournal)) {
    throw new RehearsalOutputVerificationError("CLEANUP_GAP");
  }
  if (
    JSON.stringify(observations) !==
      JSON.stringify(expected.observations)
  ) {
    throw new RehearsalOutputVerificationError(
      "OBSERVATION_OVERCLAIM",
    );
  }
  const receiptBinding = (receipt as Record<string, unknown>).binding;
  if (
    JSON.stringify(receiptBinding) !==
      JSON.stringify(expected.receipt?.binding)
  ) {
    throw new RehearsalOutputVerificationError("RECEIPT_BINDING");
  }
  if (
    receipt.provenClaims !== 0 ||
    receipt.claimCount !== receipt.uninspectedClaims
  ) {
    throw new RehearsalOutputVerificationError(
      "OBSERVATION_OVERCLAIM",
    );
  }
  if (JSON.stringify(receipt) !== JSON.stringify(expected.receipt)) {
    throw new RehearsalOutputVerificationError("RECEIPT_COVERAGE");
  }
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }

  const verifiedReceipt = expected.receipt!;
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: AVD_THREE_VM_SCENARIO.id,
    planDigestSha256: expected.planDigestSha256!,
    run: "terminal-complete",
    cleanup: "ordered-complete",
    observations: "synthetic-only",
    evidenceClaims: "all-uninspected",
    claimCount: verifiedReceipt.claimCount,
    missingCoverageTotal: Object.values(
      verifiedReceipt.missingCoverage,
    ).reduce((sum, count) => sum + count, 0),
  };
}

export function verifyAvdThreeVmRehearsalOutputText(
  text: string,
): VerifiedRehearsalOutputSummary {
  if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
    throw new RehearsalOutputVerificationError("INPUT_OVERSIZED");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RehearsalOutputVerificationError("NON_CANONICAL_JSON");
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    throw new RehearsalOutputVerificationError("NON_CANONICAL_JSON");
  }
  return verifyAvdThreeVmRehearsalOutput(value);
}

function rejectUnsafeStrings(value: unknown): void {
  if (typeof value === "string") {
    if (
      GUID.test(value) ||
      UPN.test(value) ||
      TOKEN_LIKE.test(value) ||
      PRIVATE_PATH.test(value) ||
      MARKER_LIKE.test(value) ||
      PEM.test(value)
    ) {
      throw new RehearsalOutputVerificationError("UNSAFE_CONTENT");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectUnsafeStrings);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(rejectUnsafeStrings);
  }
}

function recordLike(
  value: unknown,
  expected: unknown,
): Record<string, unknown> {
  const keys = objectKeys(expected);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key, index) => key === keys[index])
  ) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }
  return value as Record<string, unknown>;
}

function objectKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }
  return Object.keys(value);
}
