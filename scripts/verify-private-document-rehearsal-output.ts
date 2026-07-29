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

const MAX_OUTPUT_BYTES = 32 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const TOKEN_LIKE =
  /\b(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]+|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b/i;
const PRIVATE_PATH =
  /(?:[A-Za-z]:\\|\/(?:home|mnt|Users|tmp|var)\/|AppData|\\\\Users\\\\)/i;
const MARKER_LIKE =
  /\b(?:ap2doc-\d{8}T\d{6}Z-[a-f0-9]{6}|run-[a-z0-9]{2,})\b/i;
const PEM = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/;
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

export type PrivateDocumentRehearsalVerificationFailure =
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

export class PrivateDocumentRehearsalVerificationError extends Error {
  readonly category: PrivateDocumentRehearsalVerificationFailure;

  constructor(category: PrivateDocumentRehearsalVerificationFailure) {
    super(category);
    this.name = "PrivateDocumentRehearsalVerificationError";
    this.category = category;
  }
}

export interface VerifiedPrivateDocumentRehearsalSummary {
  schemaVersion: 1;
  label: "REHEARSAL_ONLY_VERIFIED";
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

export function verifyPrivateDocumentRehearsalOutput(
  value: unknown,
): VerifiedPrivateDocumentRehearsalSummary {
  const serialized = boundedSerialization(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) {
    throw failure("INPUT_OVERSIZED");
  }
  rejectUnsafeContent(value);

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
  if (
    output.schemaVersion !== 1 ||
    output.label !== "REHEARSAL_ONLY"
  ) {
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

  if (
    binding.scenarioId !== PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.id ||
    binding.manifestSchemaVersion !==
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.schemaVersion
  ) {
    throw failure("PLAN_BINDING");
  }
  if (
    typeof binding.planDigestSha256 !== "string" ||
    !SHA256.test(binding.planDigestSha256) ||
    binding.planDigestSha256 !== expectedBinding.planDigestSha256
  ) {
    throw failure("PLAN_BINDING");
  }
  if (
    output.status !== "completed" ||
    output.failure !== null ||
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
  if (
    Object.keys(externalEvidence).length !== EXTERNAL_CLAIMS.length ||
    EXTERNAL_CLAIMS.some((key) =>
      externalEvidence[key] !== "uninspected"
    )
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw failure("INPUT_SHAPE");
  }

  return deepFreeze({
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFIED",
    status: "verified",
    scenarioId: "private-document-evidence",
    manifestSchemaVersion: 2,
    planDigestSha256: expectedBinding.planDigestSha256,
    fakeRunDigestSha256: expectedBinding.fakeRunDigestSha256,
    syntheticBranch: branch,
    fakeContract: "ordered-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    externalEvidence: "all-uninspected",
    claimCount: expected.receipt!.candidateClaimCount,
  });
}

export function verifyPrivateDocumentRehearsalOutputText(
  text: string,
): VerifiedPrivateDocumentRehearsalSummary {
  if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
    throw failure("INPUT_OVERSIZED");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw failure("NON_CANONICAL_JSON");
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    throw failure("NON_CANONICAL_JSON");
  }
  return verifyPrivateDocumentRehearsalOutput(value);
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

function boundedSerialization(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw failure("INPUT_SHAPE");
  }
  if (serialized === undefined) throw failure("INPUT_SHAPE");
  return serialized;
}

function rejectUnsafeContent(value: unknown): void {
  if (typeof value === "string") {
    if (
      GUID.test(value) ||
      UPN.test(value) ||
      TOKEN_LIKE.test(value) ||
      PRIVATE_PATH.test(value) ||
      MARKER_LIKE.test(value) ||
      PEM.test(value)
    ) {
      throw failure("UNSAFE_CONTENT");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(rejectUnsafeContent);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      rejectUnsafeContent(key);
      rejectUnsafeContent(child);
    }
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(expectedKeys)
  ) {
    throw failure("INPUT_SHAPE");
  }
  return value as Record<string, unknown>;
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
