import { createHash } from "node:crypto";
import {
  adaptOauthApplicationReconToReceipt,
  OauthReconReceiptAdapterError,
  type OauthApplicationReconReceiptAdapterInput,
} from "../src/scenarios/oauth-application-recon-receipt-adapter.ts";
import { OAUTH_APPLICATION_RECON_SCENARIO } from
  "../src/scenarios/oauth-application-recon.ts";
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
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
} from "../src/scenarios/scenario-plan.ts";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.ts";
const MAX_OUTPUT_BYTES = 32 * 1024;
const SCENARIO_ID = "oauth-application-reconnaissance";
const RUN_OPERATION = "run-bounded-recon-reads";
const SHA256 = /^[a-f0-9]{64}$/;
const ORDERED_READS = [
  "synthetic-directory-memberships-reachable",
  "synthetic-mailbox-folders-reachable",
  "synthetic-personal-drive-root-reachable",
  "synthetic-shared-drive-root-reachable",
] as const;
const EXTERNAL_CLAIMS = [
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

export const OAUTH_APPLICATION_RECON_REHEARSAL_OFFLINE_VERIFIER_CAPABILITY = {
  schemaVersion: 1,
  surface: "offline-rehearsal-verifier",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: [SCENARIO_ID],
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type OauthApplicationReconRehearsalVerificationFailure =
  | SharedRehearsalInvariantFailure
  | "ADAPTER_REFUSED"
  | "EVIDENCE_OVERCLAIM"
  | "FAKE_CONTRACT_BINDING"
  | "FAKE_SEQUENCE"
  | "OUTPUT_BINDING"
  | "PAGINATION_UNCERTAIN"
  | "RECEIPT_REFUSED";

export interface VerifiedOauthApplicationReconRehearsalSummary {
  schemaVersion: 1;
  label: typeof REHEARSAL_VERIFIED_LABEL;
  status: "verified";
  scenarioId: typeof SCENARIO_ID;
  manifestSchemaVersion: 2;
  planDigestSha256: string;
  fakeResultDigestSha256: string;
  outputDigestSha256: string;
  fakeContract: "ordered-four-read-terminal-verified";
  adapter: "accepted";
  receiptVerifier: "accepted";
  envelope: "accepted";
  externalEvidence: "all-uninspected";
  claimCount: number;
}

export class OauthApplicationReconRehearsalVerificationError extends Error {
  readonly category: OauthApplicationReconRehearsalVerificationFailure;

  constructor(category: OauthApplicationReconRehearsalVerificationFailure) {
    super(category);
    this.name = "OauthApplicationReconRehearsalVerificationError";
    this.category = category;
  }
}

export function verifyOauthApplicationReconRehearsalOutput(
  value: unknown,
): VerifiedOauthApplicationReconRehearsalSummary {
  const inputFailure = inspectBoundedRehearsalValue(value, MAX_OUTPUT_BYTES);
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
    "fakeResultDigestSha256",
  ]);
  const expected = independentlyExpectedOutput();
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
    expectedManifestSchemaVersion: 2,
    planDigestSha256: binding.planDigestSha256,
    expectedPlanDigestSha256: expectedBinding.planDigestSha256,
  });
  if (!planBinding.ok) throw sharedFailure(planBinding.failure);

  const claimStates = EXTERNAL_CLAIMS.map((key) => claims[key]);
  const declaration = declareRehearsalEnvelope({
    label: output.label,
    status: output.status,
    failure: output.failure,
    syntheticValues: [
      fakeRun.terminalState,
      ...(Array.isArray(fakeRun.orderedReads) ? fakeRun.orderedReads : []),
      fakeRun.collectionBoundary,
      fakeRun.evidenceBoundary,
      fakeRun.detector,
      fakeRun.learner,
      fakeRun.permissionRestoration,
      fakeRun.cleanup,
    ],
    externalClaims: {
      total: claimStates.length,
      uninspected: claimStates.filter((state) => state === "uninspected").length,
      nonUninspected: claimStates.filter((state) => state !== "uninspected")
        .length,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);

  if (JSON.stringify(stages) !== JSON.stringify(expected.stages)) {
    throw failure("RUN_NONTERMINAL");
  }
  if (
    !Array.isArray(fakeRun.orderedReads) ||
    JSON.stringify(fakeRun.orderedReads) !== JSON.stringify(ORDERED_READS)
  ) {
    throw failure("FAKE_SEQUENCE");
  }
  if (fakeRun.collectionBoundary !== "synthetic-complete-within-bound") {
    throw failure("PAGINATION_UNCERTAIN");
  }
  if (fakeRun.terminalState !== "synthetic-four-read-completed") {
    throw failure("RUN_NONTERMINAL");
  }
  if (
    fakeRun.evidenceBoundary !== "synthetic-reachability-only" ||
    fakeRun.detector !== "synthetic-uninspected" ||
    fakeRun.learner !== "synthetic-uninspected" ||
    fakeRun.permissionRestoration !== "synthetic-uninspected" ||
    fakeRun.cleanup !== "synthetic-uninspected"
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }
  if (
    typeof binding.fakeResultDigestSha256 !== "string" ||
    !SHA256.test(binding.fakeResultDigestSha256) ||
    binding.fakeResultDigestSha256 !== expectedBinding.fakeResultDigestSha256
  ) {
    throw failure("FAKE_CONTRACT_BINDING");
  }
  if (
    receipt.adapterCandidateAccepted !== true ||
    receipt.verifierAccepted !== true ||
    receipt.candidateClaimCount !== expected.receipt!.candidateClaimCount ||
    receipt.syntheticReachability !==
      "synthetic-four-read-reachability-only" ||
    receipt.allOtherClaims !== "uninspected"
  ) {
    throw failure("RECEIPT_REFUSED");
  }
  if (
    envelope.terminalState !== "terminal-complete" ||
    envelope.observationSource !== "synthetic-only" ||
    envelope.externalEvidence !== "all-uninspected" ||
    claimStates.some((state) => state !== "uninspected")
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }
  if (JSON.stringify(output) !== JSON.stringify(expected)) {
    throw failure("OUTPUT_BINDING");
  }

  return deepFreeze({
    schemaVersion: 1,
    label: REHEARSAL_VERIFIED_LABEL,
    status: "verified",
    scenarioId: SCENARIO_ID,
    manifestSchemaVersion: 2,
    planDigestSha256: planBinding.value.planDigestSha256,
    fakeResultDigestSha256: expectedBinding.fakeResultDigestSha256,
    outputDigestSha256: sha256(expected),
    fakeContract: "ordered-four-read-terminal-verified",
    adapter: "accepted",
    receiptVerifier: "accepted",
    envelope: "accepted",
    externalEvidence: declaration.value.externalEvidence,
    claimCount: expected.receipt!.candidateClaimCount,
  });
}

export function verifyOauthApplicationReconRehearsalOutputText(
  text: string,
): VerifiedOauthApplicationReconRehearsalSummary {
  const parsed = parseCanonicalRehearsalJson(text, MAX_OUTPUT_BYTES);
  if (!parsed.ok) throw sharedFailure(parsed.failure);
  return verifyOauthApplicationReconRehearsalOutput(parsed.value);
}

function independentlyExpectedOutput() {
  const plan = independentlyCompilePlan();
  const adapterInput = reconstructedAdapterInput();
  let candidate;
  try {
    candidate = adaptOauthApplicationReconToReceipt(adapterInput);
  } catch (error) {
    if (error instanceof OauthReconReceiptAdapterError) {
      throw failure("ADAPTER_REFUSED");
    }
    throw failure("ADAPTER_REFUSED");
  }
  try {
    verifyScenarioEvidenceReceipt(
      candidate,
      OAUTH_APPLICATION_RECON_SCENARIO,
    );
  } catch (error) {
    if (error instanceof EvidenceReceiptError) {
      throw failure("RECEIPT_REFUSED");
    }
    throw failure("RECEIPT_REFUSED");
  }
  const proven = candidate.claims.filter(({ state }) => state === "proven");
  if (
    candidate.claims.length !== 13 ||
    proven.length !== 1 ||
    proven[0]?.id !== `operation-${RUN_OPERATION}` ||
    candidate.claims.some((claim) =>
      claim.id !== `operation-${RUN_OPERATION}` &&
      claim.state !== "uninspected"
    )
  ) {
    throw failure("EVIDENCE_OVERCLAIM");
  }

  const fakeRun = {
    terminalState: "synthetic-four-read-completed",
    orderedReads: ORDERED_READS,
    collectionBoundary: "synthetic-complete-within-bound",
    evidenceBoundary: "synthetic-reachability-only",
    detector: "synthetic-uninspected",
    learner: "synthetic-uninspected",
    permissionRestoration: "synthetic-uninspected",
    cleanup: "synthetic-uninspected",
  } as const;
  const claims = Object.fromEntries(
    EXTERNAL_CLAIMS.map((key) => [key, "uninspected"]),
  ) as Record<typeof EXTERNAL_CLAIMS[number], "uninspected">;
  const declaration = declareRehearsalEnvelope({
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    syntheticValues: [
      fakeRun.terminalState,
      ...fakeRun.orderedReads,
      fakeRun.collectionBoundary,
      fakeRun.evidenceBoundary,
      fakeRun.detector,
      fakeRun.learner,
      fakeRun.permissionRestoration,
      fakeRun.cleanup,
    ],
    externalClaims: {
      total: EXTERNAL_CLAIMS.length,
      uninspected: EXTERNAL_CLAIMS.length,
      nonUninspected: 0,
    },
  });
  if (!declaration.ok) throw sharedFailure(declaration.failure);

  return {
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "completed",
    failure: null,
    binding: {
      scenarioId: SCENARIO_ID,
      manifestSchemaVersion: 2,
      planDigestSha256: plan.digestSha256,
      fakeResultDigestSha256: sha256(adapterInput),
    },
    stages: {
      plan: "compiled",
      fakeFourRead: "completed",
      adapter: "accepted",
      fakeBinding: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
    },
    fakeRun,
    receipt: {
      adapterCandidateAccepted: true,
      verifierAccepted: true,
      candidateClaimCount: candidate.claims.length,
      syntheticReachability: "synthetic-four-read-reachability-only",
      allOtherClaims: "uninspected",
    },
    envelope: {
      terminalState: declaration.value.terminalState,
      observationSource: declaration.value.observationSource,
      externalEvidence: declaration.value.externalEvidence,
      claims,
    },
  };
}

function independentlyCompilePlan(): ScenarioExecutionPlan {
  const scenario = OAUTH_APPLICATION_RECON_SCENARIO;
  const expiresAt = scenario.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      scenario.cost.conservativeDurationHours * 3_600_000,
  ).toISOString();
  let plan: ScenarioExecutionPlan;
  try {
    plan = compileScenarioExecutionPlan({
      scenarioId: SCENARIO_ID,
      actorAliases: {
        evidenceProducer: "harness",
        workloadActor: "workload",
        learner: "learner",
        detector: "observer",
        cleanupOwner: "harness",
      },
      now,
      expiresAt,
      maximumBudgetUsd: scenario.cost.laneMaximum,
    });
  } catch {
    throw failure("PLAN_BINDING");
  }
  const workloadStep = plan.steps.find(
    ({ operationKey }) => operationKey === RUN_OPERATION,
  );
  if (
    plan.scenarioId !== SCENARIO_ID ||
    plan.budget.plannedMaximum !== 0 ||
    plan.budget.suppliedCeiling !== 0 ||
    plan.selectedResponseId !== null ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    JSON.stringify(plan.terminalProof.cleanupOperationKeys) !==
      JSON.stringify(["close-evidence-window"]) ||
    JSON.stringify(plan.terminalProof.evidenceArtifactIds) !==
      JSON.stringify(["application-recon-summary"]) ||
    JSON.stringify(plan.terminalProof.observationOperationKeys) !==
      JSON.stringify(["observe-bounded-sign-in"]) ||
    plan.terminalProof.retainedArtifactIds.length !== 0 ||
    workloadStep?.owningRole !== "workloadActor" ||
    workloadStep.actorAlias !== "workload" ||
    workloadStep.operationCategory !== "artifact.read-exact" ||
    workloadStep.execution !== "automated"
  ) {
    throw failure("PLAN_BINDING");
  }
  return plan;
}

function reconstructedAdapterInput():
  OauthApplicationReconReceiptAdapterInput {
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    result: {
      operation: RUN_OPERATION,
      outcome: "completed",
      actorRole: "workloadActor",
      transport: "application-only",
      completedSteps: "four",
      evidenceBoundary: "reachability-only",
    },
    journal: [
      {
        sequence: 1,
        step: "directory-memberships",
        outcome: "reachable",
        collection: "complete-within-bound",
      },
      {
        sequence: 2,
        step: "mailbox-folders",
        outcome: "reachable",
        collection: "complete-within-bound",
      },
      { sequence: 3, step: "personal-drive-root", outcome: "reachable" },
      { sequence: 4, step: "shared-drive-root", outcome: "reachable" },
    ],
    detector: { state: "uninspected" },
    learner: { state: "uninspected" },
    cleanup: { state: "uninspected" },
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const record = exactRehearsalRecord(value, keys);
  if (record === null) throw failure("INPUT_SHAPE");
  return record;
}

function sharedFailure(
  category: SharedRehearsalInvariantFailure,
): OauthApplicationReconRehearsalVerificationError {
  return failure(category);
}

function failure(
  category: OauthApplicationReconRehearsalVerificationFailure,
): OauthApplicationReconRehearsalVerificationError {
  return new OauthApplicationReconRehearsalVerificationError(category);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
