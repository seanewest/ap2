import { AVD_THREE_VM_SCENARIO } from "../src/scenarios/avd-three-vm.ts";
import {
  CANONICAL_RECEIPT_FIXTURES,
} from "../src/scenarios/scenario-evidence-receipt.fixtures.ts";
import {
  EvidenceReceiptError,
  verifyScenarioEvidenceReceipt,
  type ClaimCategory,
  type ScenarioEvidenceReceipt,
  type VerifiedScenarioEvidenceReceipt,
} from "../src/scenarios/scenario-evidence-receipt.ts";
import {
  ScenarioPlanError,
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "../src/scenarios/scenario-plan.ts";
import {
  compileAvdManifestRunnerPlan,
  type AvdManifestRunnerAdapterInput,
} from "./avd-three-vm-manifest-adapter.ts";
import {
  ThreeVmLabRunner,
  type EvidenceKind,
  type EvidenceObservation,
  type EvidenceRequest,
  type FrozenLabPlan,
  type JournalEntry,
  type MutationOutcome,
  type MutationRequest,
  type ReconciliationOutcome,
  type RunnerAdapters,
  type RunnerResult,
  type TemporaryRoleProof,
  type TemporaryRoleProofRequest,
} from "./avd-three-vm-runner.ts";

const LABEL = "REHEARSAL_ONLY";
const REQUEST_KEYS = [
  "schemaVersion",
  "label",
  "planRequest",
  "runner",
  "transport",
  "terminal",
] as const;
const EVIDENCE_KINDS = [
  "arm-completion",
  "avd-availability",
  "intune-compliance",
  "defender-onboarding",
  "private-probes",
  "learner-session",
] as const satisfies readonly EvidenceKind[];
const JOURNAL_TRANSITIONS = [
  "intent",
  "succeeded",
  "failed",
  "ambiguous",
  "reconciled",
  "reconciliation-blocked",
] as const;

type SyntheticEvidenceState =
  | EvidenceObservation["state"]
  | "missing";

export interface AvdThreeVmRehearsalRequest {
  schemaVersion: 1;
  label: typeof LABEL;
  planRequest: ScenarioPlanningRequest;
  runner: Readonly<{
    runMarker: string;
    readinessObservedAt: string;
    scopeAliases: AvdManifestRunnerAdapterInput["scopeAliases"];
    readiness: AvdManifestRunnerAdapterInput["readiness"];
    costBasis: AvdManifestRunnerAdapterInput["costBasis"];
  }>;
  transport: Readonly<{
    failedMutation: string | null;
    ambiguousMutation: string | null;
    reconciliation:
      | ReconciliationOutcome["status"]
      | "not-requested";
    evidence: Readonly<Record<EvidenceKind, SyntheticEvidenceState>>;
  }>;
  terminal: Readonly<{
    expiryVerified: boolean;
    markerAlreadyExists: boolean;
    cleanupReconciled: boolean;
    freshTokenRoleAbsence: boolean;
    retentionReconciled: boolean;
  }>;
}

export interface RehearsalPlanStage {
  status: "compiled";
  plan: ScenarioExecutionPlan;
}

export interface RehearsalRunnerPlanStage {
  status: "ready";
  planDigestSha256: string;
  runnerPlan: FrozenLabPlan;
}

export interface SafeJournalSummary {
  entries: number;
  duplicateWrites: 0;
  transitions: Readonly<Record<JournalEntry["transition"], number>>;
}

export interface RehearsalRunStage {
  status:
    | "completed"
    | "partial-failure-cleaned"
    | "unresolved";
  runnerStatus: RunnerResult["status"];
  mutationCount: number;
  duplicateWriteCount: 0;
  cleanup:
    | "ordered-complete"
    | "incomplete";
  freshTokenRoleAbsence:
    | "synthetic-supplied"
    | "synthetic-missing";
  journal: SafeJournalSummary;
}

export interface RehearsalObservationStage {
  status: "collected";
  provenance: "synthetic";
  evidence: Readonly<{
    proven: number;
    notObserved: number;
    failedOrMissing: number;
  }>;
  terminalInputs: Readonly<{
    cleanup: "synthetic-supplied" | "synthetic-missing";
    roleAbsence: "synthetic-supplied" | "synthetic-missing";
    retention: "synthetic-supplied" | "synthetic-missing";
  }>;
}

export interface RehearsalReceiptStage {
  status: "verified-incomplete";
  verified: true;
  binding: Readonly<{
    planDigestSha256: string;
    runStatus: RehearsalRunStage["status"];
    observationProvenance: "synthetic";
    cleanup: "synthetic-supplied" | "synthetic-missing";
    roleAbsence: "synthetic-supplied" | "synthetic-missing";
    retention: "synthetic-supplied" | "synthetic-missing";
  }>;
  claimCount: number;
  provenClaims: 0;
  uninspectedClaims: number;
  missingCoverage: Readonly<{
    operations: number;
    artifacts: number;
    learner: number;
    responses: number;
    cleanup: number;
    retention: number;
    terminalProof: number;
  }>;
}

export interface RehearsalPostRunReceiptInput {
  schemaVersion: 1;
  label: typeof LABEL;
  planDigestSha256: string;
  run: Readonly<{
    status: RehearsalRunStage["status"];
    cleanup: RehearsalRunStage["cleanup"];
    freshTokenRoleAbsence: RehearsalRunStage["freshTokenRoleAbsence"];
  }>;
  observations: RehearsalObservationStage;
  receipt: ScenarioEvidenceReceipt;
}

export type RehearsalFailure =
  | ScenarioPlanError["category"]
  | "ADAPTER_REFUSED"
  | "INPUT_SCHEMA"
  | "LEARNER_OVERCLAIM"
  | "PARTIAL_FAILURE_CLEANED"
  | "PLAN_DIGEST_DRIFT"
  | "RECEIPT_REFUSED"
  | "RUNNER_PLAN_DRIFT"
  | "RUN_UNRESOLVED";

export interface AvdThreeVmRehearsalResult {
  schemaVersion: 1;
  label: typeof LABEL;
  status:
    | "completed"
    | "partial-failure-cleaned"
    | "refused"
    | "unresolved";
  failure: RehearsalFailure | null;
  planDigestSha256: string | null;
  stages: Readonly<{
    plan: "compiled" | "refused";
    run:
      | RehearsalRunStage["status"]
      | "not-run";
    observation: "collected" | "not-run";
    receipt: "verified-incomplete" | "not-run" | "refused";
  }>;
  runnerJournal: SafeJournalSummary;
  observations: RehearsalObservationStage | null;
  receipt: RehearsalReceiptStage | null;
}

export function canonicalAvdThreeVmRehearsalRequest():
  AvdThreeVmRehearsalRequest {
  const expiry = Date.parse(AVD_THREE_VM_SCENARIO.lifecycle.expiresAt);
  const now = new Date(
    expiry -
      AVD_THREE_VM_SCENARIO.cost.conservativeDurationHours * 3_600_000,
  );
  const readinessObservedAt = new Date(now.getTime() - 10 * 60_000);
  const compactNow = now.toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".000Z", "Z");
  const aliases = {
    evidenceProducer: AVD_THREE_VM_SCENARIO.roles.evidenceProducer,
    workloadActor: AVD_THREE_VM_SCENARIO.roles.workloadActor,
    learner: AVD_THREE_VM_SCENARIO.roles.learner,
    responder: AVD_THREE_VM_SCENARIO.roles.responder!,
    cleanupOwner:
      AVD_THREE_VM_SCENARIO.lifecycle.cleanupOwnerActorId,
  };
  return {
    schemaVersion: 1,
    label: LABEL,
    planRequest: {
      scenarioId: AVD_THREE_VM_SCENARIO.id,
      actorAliases: aliases,
      now: now.toISOString(),
      expiresAt: AVD_THREE_VM_SCENARIO.lifecycle.expiresAt,
      maximumBudgetUsd: AVD_THREE_VM_SCENARIO.cost.laneMaximum,
    },
    runner: {
      runMarker: `ap2lab-${compactNow}-a1b2c3`,
      readinessObservedAt: readinessObservedAt.toISOString(),
      scopeAliases: {
        tenant: "student-tenant",
        subscription: "student-subscription",
      },
      readiness: {
        windowsImage:
          "MicrosoftWindowsDesktop:windows-11:win11-24h2-ent:1.2.3",
        linuxImage: "Canonical:ubuntu-24_04-lts:server:1.2.3",
        windowsSku: "Standard_D2s_v3",
        linuxSku: "Standard_F1als_v7",
        linuxVmCount: 2,
        availableWindowsVmCount: 1,
        availableLinuxVmCount: 2,
        vmPublicIpCount: 0,
        explicitOutbound: true,
        sharedNatGatewayCount: 1,
        sharedNatPublicIpCount: 1,
        temporaryPermissionsExact: true,
      },
      costBasis: {
        boundedDataGb: 20,
        diskOperationsPerDisk: 100_000,
      },
    },
    transport: {
      failedMutation: null,
      ambiguousMutation: null,
      reconciliation: "not-requested",
      evidence: {
        "arm-completion": "proven",
        "avd-availability": "proven",
        "intune-compliance": "proven",
        "defender-onboarding": "proven",
        "private-probes": "proven",
        "learner-session": "not-observed",
      },
    },
    terminal: {
      expiryVerified: true,
      markerAlreadyExists: false,
      cleanupReconciled: true,
      freshTokenRoleAbsence: true,
      retentionReconciled: true,
    },
  };
}

export function compileRehearsalPlanStage(
  request: AvdThreeVmRehearsalRequest,
): RehearsalPlanStage {
  const plan = compileScenarioExecutionPlan(request.planRequest);
  if (plan.scenarioId !== AVD_THREE_VM_SCENARIO.id) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
  return { status: "compiled", plan };
}

export function compileRehearsalRunnerPlanStage(
  request: AvdThreeVmRehearsalRequest,
  planStage: RehearsalPlanStage,
): RehearsalRunnerPlanStage {
  const canonicalPlan = compileScenarioExecutionPlan(request.planRequest);
  if (
    planStage.plan.digestSha256 !== canonicalPlan.digestSha256 ||
    JSON.stringify(planStage.plan) !== JSON.stringify(canonicalPlan)
  ) {
    throw new RehearsalStageError("PLAN_DIGEST_DRIFT");
  }
  const actorAliases = canonicalPlan.actorAliases;
  const runnerPlan = compileAvdManifestRunnerPlan({
    manifest: AVD_THREE_VM_SCENARIO,
    actorAliases: {
      evidenceProducer: requiredAlias(
        actorAliases.evidenceProducer,
      ),
      workloadActor: requiredAlias(actorAliases.workloadActor),
      learner: requiredAlias(actorAliases.learner),
      responder: requiredAlias(actorAliases.responder),
    },
    scopeAliases: request.runner.scopeAliases,
    timing: {
      runMarker: request.runner.runMarker,
      plannedAt: canonicalPlan.generatedAt,
      readinessObservedAt: request.runner.readinessObservedAt,
      expiryUtc: canonicalPlan.expiresAt,
    },
    readiness: request.runner.readiness,
    costBasis: request.runner.costBasis,
  });
  const requestedOutcomes = [
    request.transport.failedMutation,
    request.transport.ambiguousMutation,
  ].filter((operationId): operationId is string => operationId !== null);
  if (
    runnerPlan.expiryUtc !== canonicalPlan.expiresAt ||
    runnerPlan.cost.laneCeilingUsd !== canonicalPlan.budget.plannedMaximum ||
    runnerPlan.learner !== actorAliases.learner ||
    !sameStrings(
      runnerPlan.temporaryRoles,
      AVD_THREE_VM_SCENARIO.permissions
        .filter((permission) => permission.mode === "temporary")
        .map((permission) => permission.name),
    ) ||
    !canonicalPlan.terminalProof.cleanupOperationKeys
      .map(cleanupRunnerOperation)
      .every((operationId) =>
        Object.hasOwn(runnerPlan.cleanupGraph, operationId)
      ) ||
    requestedOutcomes.some((operationId) =>
      !runnerPlan.mutations.some(
        (mutation) => mutation.operationId === operationId,
      )
    )
  ) {
    throw new RehearsalStageError("RUNNER_PLAN_DRIFT");
  }
  return {
    status: "ready",
    planDigestSha256: canonicalPlan.digestSha256,
    runnerPlan,
  };
}

export async function runAvdThreeVmRehearsal(
  value: unknown,
): Promise<AvdThreeVmRehearsalResult> {
  let request: AvdThreeVmRehearsalRequest;
  try {
    request = parseRequest(value);
  } catch (error) {
    return refusedResult(failureCategory(error, "INPUT_SCHEMA"), "plan");
  }

  let planStage: RehearsalPlanStage;
  try {
    planStage = compileRehearsalPlanStage(request);
  } catch (error) {
    return refusedResult(failureCategory(error, "INPUT_SCHEMA"), "plan");
  }

  let runnerPlanStage: RehearsalRunnerPlanStage;
  try {
    runnerPlanStage = compileRehearsalRunnerPlanStage(request, planStage);
  } catch (error) {
    return refusedResult(
      failureCategory(error, "ADAPTER_REFUSED"),
      "run",
      planStage.plan.digestSha256,
    );
  }

  let execution: InternalRunExecution;
  try {
    execution = await executeRunner(request, runnerPlanStage);
  } catch (error) {
    return refusedResult(
      failureCategory(error, "RUNNER_PLAN_DRIFT"),
      "run",
      planStage.plan.digestSha256,
    );
  }
  const observation = collectSyntheticObservations(request, execution);

  let receipt: RehearsalReceiptStage;
  try {
    const receiptInput = buildRehearsalReceiptInput(
      planStage.plan.digestSha256,
      execution.stage,
      observation,
    );
    receipt = verifyRehearsalReceiptInput(
      receiptInput,
      planStage.plan.digestSha256,
      execution.stage,
      observation,
    );
  } catch (error) {
    return {
      ...refusedResult(
        failureCategory(error, "RECEIPT_REFUSED"),
        "receipt",
        planStage.plan.digestSha256,
        execution.stage.journal,
      ),
      stages: {
        plan: "compiled",
        run: execution.stage.status,
        observation: observation.status,
        receipt: "refused",
      },
      observations: observation,
    };
  }

  const status = execution.stage.status;
  return {
    schemaVersion: 1,
    label: LABEL,
    status,
    failure: status === "partial-failure-cleaned"
      ? "PARTIAL_FAILURE_CLEANED"
      : status === "unresolved"
      ? "RUN_UNRESOLVED"
      : null,
    planDigestSha256: planStage.plan.digestSha256,
    stages: {
      plan: "compiled",
      run: status,
      observation: observation.status,
      receipt: receipt.status,
    },
    runnerJournal: execution.stage.journal,
    observations: observation,
    receipt,
  };
}

export function buildRehearsalReceiptInput(
  planDigestSha256: string,
  run: RehearsalRunStage,
  observations: RehearsalObservationStage,
): RehearsalPostRunReceiptInput {
  const fixture = CANONICAL_RECEIPT_FIXTURES.find(
    (candidate) => candidate.name === "three-vm-avd",
  );
  if (!fixture) throw new RehearsalStageError("RECEIPT_REFUSED");
  return {
    schemaVersion: 1,
    label: LABEL,
    planDigestSha256,
    run: {
      status: run.status,
      cleanup: run.cleanup,
      freshTokenRoleAbsence: run.freshTokenRoleAbsence,
    },
    observations: structuredClone(observations),
    receipt: {
      ...structuredClone(fixture.receipt),
      claims: fixture.receipt.claims.map((claim) => {
        const copy = structuredClone(claim);
        copy.state = "uninspected";
        delete copy.observation;
        return copy;
      }),
    },
  };
}

export function verifyRehearsalReceiptInput(
  input: RehearsalPostRunReceiptInput,
  expectedPlanDigestSha256: string,
  expectedRun: RehearsalRunStage,
  expectedObservations: RehearsalObservationStage,
): RehearsalReceiptStage {
  const canonical = buildRehearsalReceiptInput(
    expectedPlanDigestSha256,
    expectedRun,
    expectedObservations,
  );
  if (JSON.stringify(input) !== JSON.stringify(canonical)) {
    throw new RehearsalStageError("RECEIPT_REFUSED");
  }
  const verified = verifyScenarioEvidenceReceipt(
    input.receipt,
    AVD_THREE_VM_SCENARIO,
  );
  if (verified.claims.some((claim) => claim.state !== "uninspected")) {
    throw new RehearsalStageError("RECEIPT_REFUSED");
  }
  const missingCoverage = receiptCoverage(verified);
  return {
    status: "verified-incomplete",
    verified: true,
    binding: {
      planDigestSha256: input.planDigestSha256,
      runStatus: input.run.status,
      observationProvenance: input.observations.provenance,
      cleanup: input.observations.terminalInputs.cleanup,
      roleAbsence: input.observations.terminalInputs.roleAbsence,
      retention: input.observations.terminalInputs.retention,
    },
    claimCount: verified.claims.length,
    provenClaims: 0,
    uninspectedClaims: verified.claims.length,
    missingCoverage,
  };
}

interface InternalRunExecution {
  stage: RehearsalRunStage;
  evidence: readonly EvidenceObservation[];
}

export async function executeRehearsalRunStage(
  request: AvdThreeVmRehearsalRequest,
  stage: RehearsalRunnerPlanStage,
): Promise<RehearsalRunStage> {
  return (await executeRunner(request, stage)).stage;
}

async function executeRunner(
  request: AvdThreeVmRehearsalRequest,
  stage: RehearsalRunnerPlanStage,
): Promise<InternalRunExecution> {
  const canonicalStage = compileRehearsalRunnerPlanStage(
    request,
    compileRehearsalPlanStage(request),
  );
  if (
    stage.planDigestSha256 !== canonicalStage.planDigestSha256 ||
    JSON.stringify(stage.runnerPlan) !==
      JSON.stringify(canonicalStage.runnerPlan)
  ) {
    throw new RehearsalStageError("RUNNER_PLAN_DRIFT");
  }
  const fake = new SyntheticRunnerAdapter(request);
  const entries: JournalEntry[] = [];
  const adapters: RunnerAdapters = {
    azure: fake,
    graph: fake,
    defender: fake,
    timer: fake,
    filesystem: fake,
    clock: { now: () => new Date(stage.runnerPlan.plannedAt) },
    journal: {
      append: async (entry) => {
        entries.push(entry);
      },
    },
  };
  const runner = new ThreeVmLabRunner(stage.runnerPlan, adapters);
  let result = await runner.run();
  if (
    (result.status === "blocked-ambiguous" ||
      result.status === "blocked-reconciliation") &&
    result.operationId &&
    request.transport.reconciliation !== "not-requested"
  ) {
    const reconciliation = await runner.reconcile(result.operationId);
    result = reconciliation.status === "ready-to-resume"
      ? await runner.run()
      : reconciliation;
  }
  const unresolved =
    result.status === "blocked-ambiguous" ||
    result.status === "blocked-reconciliation" ||
    result.status === "ready-to-resume";
  let duplicateWriteCount: 0 = 0;
  if (!unresolved) {
    const writes = fake.mutations.length;
    await runner.run();
    if (fake.mutations.length !== writes) {
      throw new RehearsalStageError("RUNNER_PLAN_DRIFT");
    }
    duplicateWriteCount = 0;
  }
  const status: RehearsalRunStage["status"] = unresolved
    ? "unresolved"
    : result.status === "cleaned-after-failure"
    ? "partial-failure-cleaned"
    : result.status === "failed"
    ? "unresolved"
    : "completed";
  const expectedCleanup = Object.keys(stage.runnerPlan.cleanupGraph);
  const actualCleanup = fake.mutations
    .map((mutation) => mutation.operationId)
    .filter((operationId) => expectedCleanup.includes(operationId));
  const cleanupComplete =
    result.status === "completed" ||
    result.status === "cleaned-after-failure";
  if (
    cleanupComplete &&
    JSON.stringify(actualCleanup) !== JSON.stringify(expectedCleanup)
  ) {
    throw new RehearsalStageError("RUNNER_PLAN_DRIFT");
  }
  return {
    stage: {
      status,
      runnerStatus: result.status,
      mutationCount: fake.mutations.length,
      duplicateWriteCount,
      cleanup: cleanupComplete ? "ordered-complete" : "incomplete",
      freshTokenRoleAbsence:
        fake.terminalRoleAbsenceProofs > 0
          ? "synthetic-supplied"
          : "synthetic-missing",
      journal: journalSummary(entries),
    },
    evidence: result.evidence,
  };
}

class SyntheticRunnerAdapter {
  readonly mutations: MutationRequest[] = [];
  terminalRoleAbsenceProofs = 0;
  readonly #request: AvdThreeVmRehearsalRequest;

  constructor(request: AvdThreeVmRehearsalRequest) {
    this.#request = request;
  }

  async mutate(
    request: Readonly<MutationRequest>,
  ): Promise<MutationOutcome> {
    this.mutations.push({ ...request });
    if (request.operationId === this.#request.transport.failedMutation) {
      return { status: "failed", reason: "synthetic-failure" };
    }
    if (request.operationId === this.#request.transport.ambiguousMutation) {
      return { status: "ambiguous", reason: "synthetic-ambiguity" };
    }
    return request.operationId === "roles-grant"
      ? {
          status: "succeeded",
          references: ["assignment-one", "assignment-two"],
        }
      : { status: "succeeded" };
  }

  async reconcile(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    if (request.operationId === this.#request.transport.ambiguousMutation) {
      const status = this.#request.transport.reconciliation;
      return status === "not-requested"
        ? { status: "incomplete", reason: "synthetic-read-missing" }
        : status === "desired-state"
        ? { status }
        : { status, reason: "synthetic-read" };
    }
    const mutated = this.mutations.some(
      (mutation) => mutation.operationId === request.operationId,
    );
    if (!mutated) {
      return { status: "wrong-state", reason: "synthetic-state-remains" };
    }
    if (
      request.desiredState === "absent" &&
      !this.#request.terminal.cleanupReconciled
    ) {
      return { status: "incomplete", reason: "synthetic-cleanup-missing" };
    }
    return { status: "desired-state" };
  }

  async verifyTemporaryRolesWithFreshToken(
    request: Readonly<TemporaryRoleProofRequest>,
  ): Promise<TemporaryRoleProof> {
    const revoked = this.mutations.some(
      (mutation) => mutation.operationId === "roles-revoke",
    );
    const absent = request.expectedState === "absent" &&
      revoked &&
      this.#request.terminal.freshTokenRoleAbsence;
    if (absent) this.terminalRoleAbsenceProofs += 1;
    return {
      status: absent || request.expectedState === "present"
        ? "desired-state"
        : "incomplete",
      completeUnpagedRead: true,
      freshTokenRoleCount: absent ? 0 : 2,
      matchingAssignmentIds: absent
        ? []
        : ["assignment-one", "assignment-two"],
      freshToken: absent ||
        request.expectedState === "present",
      tenantExact: true,
      actorExact: true,
      audienceExact: true,
    };
  }

  async observe(
    request: Readonly<EvidenceRequest>,
  ): Promise<EvidenceObservation> {
    const supplied = this.#request.transport.evidence[request.kind];
    const state = supplied === "missing" ? "failed" : supplied;
    return {
      kind: request.kind,
      state,
      observedAt: this.#request.planRequest.now,
      summary: state === "proven"
        ? "contract-satisfied"
        : state === "not-observed"
        ? "not-observed"
        : "contract-failed",
    };
  }

  async verifyExpiry(): Promise<boolean> {
    return this.#request.terminal.expiryVerified;
  }

  async markerExists(): Promise<boolean> {
    return this.#request.terminal.markerAlreadyExists;
  }
}

function collectSyntheticObservations(
  request: AvdThreeVmRehearsalRequest,
  execution: InternalRunExecution,
): RehearsalObservationStage {
  return {
    status: "collected",
    provenance: "synthetic",
    evidence: {
      proven: execution.evidence.filter((item) => item.state === "proven")
        .length,
      notObserved: execution.evidence.filter(
        (item) => item.state === "not-observed",
      ).length,
      failedOrMissing: execution.evidence.filter(
        (item) => item.state === "failed",
      ).length,
    },
    terminalInputs: {
      cleanup: request.terminal.cleanupReconciled
        ? "synthetic-supplied"
        : "synthetic-missing",
      roleAbsence: request.terminal.freshTokenRoleAbsence
        ? "synthetic-supplied"
        : "synthetic-missing",
      retention: request.terminal.retentionReconciled
        ? "synthetic-supplied"
        : "synthetic-missing",
    },
  };
}

function parseRequest(value: unknown): AvdThreeVmRehearsalRequest {
  const request = record(value);
  exactKeys(request, REQUEST_KEYS);
  if (request.schemaVersion !== 1 || request.label !== LABEL) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
  const runner = record(request.runner);
  exactKeys(runner, [
    "runMarker",
    "readinessObservedAt",
    "scopeAliases",
    "readiness",
    "costBasis",
  ]);
  const transport = record(request.transport);
  exactKeys(transport, [
    "failedMutation",
    "ambiguousMutation",
    "reconciliation",
    "evidence",
  ]);
  const terminal = record(request.terminal);
  exactKeys(terminal, [
    "expiryVerified",
    "markerAlreadyExists",
    "cleanupReconciled",
    "freshTokenRoleAbsence",
    "retentionReconciled",
  ]);
  const evidence = record(transport.evidence);
  exactKeys(evidence, EVIDENCE_KINDS);
  const evidenceStates = Object.fromEntries(
    EVIDENCE_KINDS.map((kind) => {
      const state = evidence[kind];
      if (
        !["proven", "not-observed", "failed", "missing"].includes(
          String(state),
        )
      ) {
        throw new RehearsalStageError("INPUT_SCHEMA");
      }
      return [kind, state as SyntheticEvidenceState];
    }),
  ) as Record<EvidenceKind, SyntheticEvidenceState>;
  if (evidenceStates["learner-session"] === "proven") {
    throw new RehearsalStageError("LEARNER_OVERCLAIM");
  }
  const failedMutation = nullableString(transport.failedMutation);
  const ambiguousMutation = nullableString(transport.ambiguousMutation);
  if (
    failedMutation !== null &&
    ambiguousMutation !== null
  ) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
  const reconciliation = transport.reconciliation;
  if (
    ![
      "desired-state",
      "wrong-state",
      "incomplete",
      "not-requested",
    ].includes(String(reconciliation))
  ) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
  for (const value of Object.values(terminal)) {
    if (typeof value !== "boolean") {
      throw new RehearsalStageError("INPUT_SCHEMA");
    }
  }
  return {
    schemaVersion: 1,
    label: LABEL,
    planRequest: request.planRequest as ScenarioPlanningRequest,
    runner: {
      runMarker: stringValue(runner.runMarker),
      readinessObservedAt: stringValue(runner.readinessObservedAt),
      scopeAliases:
        runner.scopeAliases as AvdManifestRunnerAdapterInput["scopeAliases"],
      readiness:
        runner.readiness as AvdManifestRunnerAdapterInput["readiness"],
      costBasis:
        runner.costBasis as AvdManifestRunnerAdapterInput["costBasis"],
    },
    transport: {
      failedMutation,
      ambiguousMutation,
      reconciliation: reconciliation as
        AvdThreeVmRehearsalRequest["transport"]["reconciliation"],
      evidence: evidenceStates,
    },
    terminal: terminal as unknown as
      AvdThreeVmRehearsalRequest["terminal"],
  };
}

function receiptCoverage(
  verified: VerifiedScenarioEvidenceReceipt,
): RehearsalReceiptStage["missingCoverage"] {
  const count = (categories: readonly ClaimCategory[]) =>
    verified.claims.filter(
      (claim) =>
        categories.includes(claim.category) &&
        claim.state === "uninspected",
    ).length;
  return {
    operations: count(["operation"]),
    artifacts: count(["artifact"]),
    learner: count(["learner-visibility", "learner-interpretation"]),
    responses: count(["response"]),
    cleanup: count(["cleanup"]),
    retention: count(["retention"]),
    terminalProof: count(["terminal-proof"]),
  };
}

function journalSummary(
  entries: readonly JournalEntry[],
): SafeJournalSummary {
  const transitions = Object.fromEntries(
    JOURNAL_TRANSITIONS.map((transition) => [
      transition,
      entries.filter((entry) => entry.transition === transition).length,
    ]),
  ) as Record<JournalEntry["transition"], number>;
  return { entries: entries.length, duplicateWrites: 0, transitions };
}

function refusedResult(
  failure: RehearsalFailure,
  stage: "plan" | "run" | "receipt",
  digest: string | null = null,
  journal: SafeJournalSummary = emptyJournal(),
): AvdThreeVmRehearsalResult {
  return {
    schemaVersion: 1,
    label: LABEL,
    status: "refused",
    failure,
    planDigestSha256: digest,
    stages: {
      plan: stage === "plan" ? "refused" : "compiled",
      run: "not-run",
      observation: "not-run",
      receipt: stage === "receipt" ? "refused" : "not-run",
    },
    runnerJournal: journal,
    observations: null,
    receipt: null,
  };
}

function emptyJournal(): SafeJournalSummary {
  return {
    entries: 0,
    duplicateWrites: 0,
    transitions: Object.fromEntries(
      JOURNAL_TRANSITIONS.map((transition) => [transition, 0]),
    ) as Record<JournalEntry["transition"], number>,
  };
}

function failureCategory(
  error: unknown,
  fallback: RehearsalFailure,
): RehearsalFailure {
  if (error instanceof ScenarioPlanError) return error.category;
  if (error instanceof RehearsalStageError) return error.category;
  if (error instanceof EvidenceReceiptError) return "RECEIPT_REFUSED";
  return fallback;
}

function cleanupRunnerOperation(operationKey: string): string {
  const mapping: Readonly<Record<string, string>> = {
    "offboard-windows-endpoint": "defender-offboard",
    "delete-three-vm-resource-group": "azure-cleanup",
    "revoke-temporary-endpoint-roles": "roles-revoke",
    "remove-expiry-cleanup": "expiry-remove",
    "remove-ephemeral-run-material": "sensitive-remove",
  };
  const operation = mapping[operationKey];
  if (!operation) throw new RehearsalStageError("RUNNER_PLAN_DRIFT");
  return operation;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    [...left].sort().every((value, index) =>
      value === [...right].sort()[index]
    );
}

function requiredAlias(value: string | undefined): string {
  if (!value) throw new RehearsalStageError("INPUT_SCHEMA");
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new RehearsalStageError("INPUT_SCHEMA");
  }
  return value;
}

class RehearsalStageError extends Error {
  readonly category: RehearsalFailure;

  constructor(category: RehearsalFailure) {
    super(category);
    this.category = category;
    this.name = "RehearsalStageError";
  }
}
