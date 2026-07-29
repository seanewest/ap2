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
import {
  type RehearsalOutputVerificationFailure,
  type VerifiedRehearsalOutputSummary,
} from "../src/api/rehearsal-output-verification-contract.ts";
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
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.ts";

const MAX_OUTPUT_BYTES = 256 * 1024;

export const AVD_REHEARSAL_OFFLINE_VERIFIER_CAPABILITY = {
  schemaVersion: 1,
  surface: "offline-rehearsal-verifier",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["avd-three-vm-substrate"],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type { RehearsalOutputVerificationFailure };

export class RehearsalOutputVerificationError extends Error {
  readonly category: RehearsalOutputVerificationFailure;

  constructor(category: RehearsalOutputVerificationFailure) {
    super(category);
    this.name = "RehearsalOutputVerificationError";
    this.category = category;
  }
}

export type { VerifiedRehearsalOutputSummary };

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
    label: REHEARSAL_ONLY_LABEL,
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
  const inputFailure = inspectBoundedRehearsalValue(
    value,
    MAX_OUTPUT_BYTES,
  );
  if (inputFailure) throw sharedFailure(inputFailure);
  let expected: AvdThreeVmRehearsalResult;
  try {
    expected = canonicalAvdThreeVmRehearsalOutput();
  } catch {
    throw new RehearsalOutputVerificationError("PLAN_BINDING");
  }
  const output = recordLike(value, expected);
  if (output.schemaVersion !== 1) {
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

  const binding = bindRehearsalPlan({
    scenarioId: AVD_THREE_VM_SCENARIO.id,
    expectedScenarioId: AVD_THREE_VM_SCENARIO.id,
    manifestSchemaVersion: AVD_THREE_VM_SCENARIO.schemaVersion,
    expectedManifestSchemaVersion: AVD_THREE_VM_SCENARIO.schemaVersion,
    planDigestSha256: output.planDigestSha256,
    expectedPlanDigestSha256: expected.planDigestSha256!,
  });
  if (!binding.ok) throw sharedFailure(binding.failure);
  const declaration = declareRehearsalEnvelope({
    label: output.label,
    status: output.status,
    failure: output.failure,
    syntheticValues: [
      observations.provenance,
      ...Object.values(
        observations.terminalInputs as Record<string, unknown>,
      ),
      expected.receipt?.binding.observationProvenance,
      expected.receipt?.binding.cleanup,
      expected.receipt?.binding.roleAbsence,
      expected.receipt?.binding.retention,
    ],
    externalClaims: {
      total: receipt.claimCount,
      uninspected: receipt.uninspectedClaims,
      nonUninspected: receipt.provenClaims,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);
  if (
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
    label: REHEARSAL_VERIFIED_LABEL,
    status: "verified",
    scenarioId: binding.value.scenarioId,
    planDigestSha256: binding.value.planDigestSha256,
    run: declaration.value.terminalState,
    cleanup: "ordered-complete",
    observations: declaration.value.observationSource,
    evidenceClaims: declaration.value.externalEvidence,
    claimCount: verifiedReceipt.claimCount,
    missingCoverageTotal: Object.values(
      verifiedReceipt.missingCoverage,
    ).reduce((sum, count) => sum + count, 0),
  };
}

export function verifyAvdThreeVmRehearsalOutputText(
  text: string,
): VerifiedRehearsalOutputSummary {
  const parsed = parseCanonicalRehearsalJson(text, MAX_OUTPUT_BYTES);
  if (!parsed.ok) throw sharedFailure(parsed.failure);
  return verifyAvdThreeVmRehearsalOutput(parsed.value);
}

function recordLike(
  value: unknown,
  expected: unknown,
): Record<string, unknown> {
  const keys = objectKeys(expected);
  const record = exactRehearsalRecord(value, keys);
  if (record === null) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }
  return record;
}

function objectKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RehearsalOutputVerificationError("INPUT_SHAPE");
  }
  return Object.keys(value);
}

function sharedFailure(
  category: SharedRehearsalInvariantFailure,
): RehearsalOutputVerificationError {
  const mapped: RehearsalOutputVerificationFailure =
    category === "SYNTHETIC_MISMATCH" ||
      category === "EXTERNAL_CLAIM_MISMATCH"
      ? "OBSERVATION_OVERCLAIM"
      : category;
  return new RehearsalOutputVerificationError(mapped);
}
