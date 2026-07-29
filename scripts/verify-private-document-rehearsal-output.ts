import { createHash } from "node:crypto";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from
  "../src/scenarios/private-document-evidence.ts";
import {
  adaptPrivateDocumentLifecycleToReceipt,
  PrivateDocumentReceiptAdapterError,
  type PrivateDocumentLifecycleReceiptInput,
  type SanitizedPrivateDocumentJournalEntry,
} from "../src/scenarios/private-document-receipt-adapter.ts";
import {
  EvidenceReceiptError,
  verifyScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import {
  compilePrivateDocumentRehearsalPlan,
  type PrivateDocumentRehearsalResult,
  type PrivateDocumentSyntheticBranch,
} from "./private-document-rehearsal.ts";
import {
  bindRehearsalPlan,
  declareRehearsalEnvelope,
  exactRehearsalRecord,
  inspectBoundedRehearsalValue,
  parseCanonicalRehearsalJson,
  REHEARSAL_VERIFIED_LABEL,
  type SharedRehearsalInvariantFailure,
} from "../src/scenarios/rehearsal-envelope-invariants.ts";
import type {
  PrivateDocumentRehearsalVerificationFailure,
  VerifiedPrivateDocumentRehearsalSummary,
} from "../src/api/private-document-rehearsal-verification-contract.ts";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.ts";

export type {
  PrivateDocumentRehearsalVerificationFailure,
  VerifiedPrivateDocumentRehearsalSummary,
} from "../src/api/private-document-rehearsal-verification-contract.ts";

const MAX_OUTPUT_BYTES = 32 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const EXTERNAL_CLAIMS = [
  "producerStaging",
  "learnerVisibility",
  "learnerInterpretation",
  "auditOrDetection",
  "response",
  "cleanup",
  "retention",
] as const;
const CORRELATION = "run-contract";

export const PRIVATE_DOCUMENT_REHEARSAL_OFFLINE_VERIFIER_CAPABILITY = {
  schemaVersion: 1,
  surface: "offline-rehearsal-verifier",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["private-document-evidence"],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export class PrivateDocumentRehearsalVerificationError extends Error {
  readonly category: PrivateDocumentRehearsalVerificationFailure;

  constructor(category: PrivateDocumentRehearsalVerificationFailure) {
    super(category);
    this.name = "PrivateDocumentRehearsalVerificationError";
    this.category = category;
  }
}

export function verifyPrivateDocumentRehearsalOutput(
  value: unknown,
): VerifiedPrivateDocumentRehearsalSummary {
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
    "fakeRun",
    "receipt",
  ]);
  if (output.schemaVersion !== 1) {
    throw failure("INPUT_SHAPE");
  }
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
  const freshTerminal = exactRecord(
    fakeRun.freshTerminal,
    Object.keys(expected.fakeRun!.freshTerminal),
  );
  const receipt = exactRecord(output.receipt, Object.keys(expected.receipt!));
  const externalEvidence = exactRecord(
    receipt.externalEvidence,
    Object.keys(expected.receipt!.externalEvidence),
  );

  const planBinding = bindRehearsalPlan({
    scenarioId: binding.scenarioId,
    expectedScenarioId: PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.id,
    manifestSchemaVersion: binding.manifestSchemaVersion,
    expectedManifestSchemaVersion:
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.schemaVersion,
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
      fakeRun.learnerObservation,
      fakeRun.initialTerminalProducerAbsence,
      fakeRun.initialTerminalLearnerAbsence,
      freshTerminal.producerFolder,
      freshTerminal.producerItem,
      freshTerminal.producerPermission,
      freshTerminal.learnerAccess,
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
  if (
    JSON.stringify(stages) !== JSON.stringify(expected.stages)
  ) {
    throw failure("RUN_NONTERMINAL");
  }
  if (
    fakeRun.lifecycleStatus !== expected.fakeRun!.lifecycleStatus ||
    fakeRun.learnerObservation !==
      expected.fakeRun!.learnerObservation ||
    fakeRun.initialTerminalLearnerAbsence !==
      expected.fakeRun!.initialTerminalLearnerAbsence
  ) {
    throw failure("BRANCH_MISMATCH");
  }
  if (
    fakeRun.journalEntries !== 30 ||
    fakeRun.initialTerminalProducerAbsence !== "synthetic-absent" ||
    JSON.stringify(freshTerminal) !==
      JSON.stringify(expected.fakeRun!.freshTerminal)
  ) {
    throw failure("CLEANUP_GAP");
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
    receipt.candidateClaimCount !== expected.receipt!.candidateClaimCount
  ) {
    throw failure("RECEIPT_REFUSED");
  }
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw failure("INPUT_SHAPE");
  }

  return deepFreeze({
    schemaVersion: 1,
    label: REHEARSAL_VERIFIED_LABEL,
    status: "verified",
    scenarioId: "private-document-evidence",
    manifestSchemaVersion: 2,
    planDigestSha256: planBinding.value.planDigestSha256,
    fakeRunDigestSha256: expectedBinding.fakeRunDigestSha256,
    syntheticBranch: branch,
    fakeContract: "ordered-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    externalEvidence: declaration.value.externalEvidence,
    claimCount: expected.receipt!.candidateClaimCount,
  });
}

export function verifyPrivateDocumentRehearsalOutputText(
  text: string,
): VerifiedPrivateDocumentRehearsalSummary {
  const parsed = parseCanonicalRehearsalJson(text, MAX_OUTPUT_BYTES);
  if (!parsed.ok) throw sharedFailure(parsed.failure);
  return verifyPrivateDocumentRehearsalOutput(parsed.value);
}

function independentlyExpectedOutput(
  branch: PrivateDocumentSyntheticBranch,
): PrivateDocumentRehearsalResult {
  let plan;
  try {
    plan = compilePrivateDocumentRehearsalPlan();
  } catch {
    throw failure("PLAN_BINDING");
  }
  const lifecycle = reconstructedLifecycleInput(branch);
  let candidate;
  try {
    candidate = adaptPrivateDocumentLifecycleToReceipt(lifecycle);
  } catch (error) {
    if (error instanceof PrivateDocumentReceiptAdapterError) {
      throw failure("ADAPTER_REFUSED");
    }
    throw failure("ADAPTER_REFUSED");
  }
  try {
    verifyScenarioEvidenceReceipt(
      candidate,
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
    );
  } catch (error) {
    if (error instanceof EvidenceReceiptError) {
      throw failure("RECEIPT_REFUSED");
    }
    throw failure("RECEIPT_REFUSED");
  }
  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    binding: {
      scenarioId: "private-document-evidence",
      manifestSchemaVersion: 2,
      planDigestSha256: plan.digestSha256,
      fakeRunDigestSha256: sha256(lifecycle),
      syntheticBranch: branch,
    },
    stages: {
      plan: "compiled",
      fakeLifecycle: "completed",
      adapter: "accepted",
      receiptVerifier: "accepted",
    },
    fakeRun: {
      lifecycleStatus: branch === "learner-observation"
        ? "completed-cleaned"
        : "blocked-cleanup",
      journalEntries: 30,
      learnerObservation: branch === "learner-observation"
        ? "synthetic-proven"
        : "synthetic-not-proven",
      initialTerminalProducerAbsence: "synthetic-absent",
      initialTerminalLearnerAbsence: branch === "learner-observation"
        ? "synthetic-absent"
        : "synthetic-not-proven",
      freshTerminal: {
        rounds: 3,
        producerFolder: "synthetic-absent",
        producerItem: "synthetic-absent",
        producerPermission: "synthetic-absent",
        learnerAccess: "synthetic-absent",
      },
    },
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: candidate.claims.length,
      externalEvidence: {
        producerStaging: "uninspected",
        learnerVisibility: "uninspected",
        learnerInterpretation: "uninspected",
        auditOrDetection: "uninspected",
        response: "uninspected",
        cleanup: "uninspected",
        retention: "uninspected",
      },
    },
  };
}

function reconstructedLifecycleInput(
  branch: PrivateDocumentSyntheticBranch,
): PrivateDocumentLifecycleReceiptInput {
  const learnerProven = branch === "learner-observation";
  const journal: Array<
    Omit<SanitizedPrivateDocumentJournalEntry, "sequence" | "correlation">
  > = [];
  for (
    const operation of [
      "folder-create",
      "file-create",
      "direct-share-create",
    ] as const
  ) {
    journal.push(
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      {
        operation,
        transition: "reconciled",
        detail: "exact-desired-state",
      },
    );
  }
  journal.push({
    operation: "learner-visibility",
    transition: "observed",
    detail: learnerProven ? "learner-visible" : "contract-failed",
  });
  for (
    const operation of [
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ] as const
  ) {
    journal.push(
      {
        operation,
        transition: "reconciled",
        detail: "exact-present-state",
      },
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      {
        operation,
        transition: "reconciliation-incomplete",
        detail: "absence-awaiting-propagation",
      },
      {
        operation,
        transition: "reconciliation-incomplete",
        detail: "absence-awaiting-propagation",
      },
      {
        operation,
        transition: "reconciled",
        detail: "exact-desired-state",
      },
    );
  }
  journal.push(
    {
      operation: "terminal-producer-absence",
      transition: "observed",
      detail: "producer-absent",
    },
    {
      operation: "terminal-learner-absence",
      transition: "observed",
      detail: learnerProven ? "learner-absent" : "contract-failed",
    },
  );
  return {
    schemaVersion: 1,
    scenarioId: "private-document-evidence",
    correlation: CORRELATION,
    result: learnerProven
      ? {
        status: "completed-cleaned",
        learnerVisibility: "proven",
        learnerInterpretation: "not-claimed",
        auditOrDetection: "not-claimed",
      }
      : {
        status: "blocked-cleanup",
        failedOperation: "terminal-absence",
        learnerVisibility: "not-proven",
        learnerInterpretation: "not-claimed",
        auditOrDetection: "not-claimed",
      },
    journal: journal.map((entry, index) => ({
      sequence: index + 1,
      correlation: CORRELATION,
      ...entry,
    })),
    terminal: {
      freshSessionRounds: 3,
      producerFolder: "absent",
      producerItem: "absent",
      producerPermission: "absent",
      learnerAccess: "absent",
    },
  };
}

function parseBranch(value: unknown): PrivateDocumentSyntheticBranch {
  if (
    value !== "cleaned-canary" &&
    value !== "learner-observation"
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
  if (record === null) {
    throw failure("INPUT_SHAPE");
  }
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
  category: PrivateDocumentRehearsalVerificationFailure,
): PrivateDocumentRehearsalVerificationError {
  return new PrivateDocumentRehearsalVerificationError(category);
}

function sharedFailure(
  category: SharedRehearsalInvariantFailure,
): PrivateDocumentRehearsalVerificationError {
  const mapped: PrivateDocumentRehearsalVerificationFailure =
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
