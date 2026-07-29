import type { OperationTelemetrySnapshot } from "../../api/operation-telemetry-collector.ts";
import type { AvdManifestRunnerAdapterInput } from "../../scripts/avd-three-vm-manifest-adapter.ts";
import { compileAvdManifestRunnerPlan } from "../../scripts/avd-three-vm-manifest-adapter.ts";
import { canonicalAvdManifestDryRunInput } from "../../scripts/dry-run-avd-three-vm-manifest.ts";
import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm.ts";
import {
  adaptHelpDeskEmailOperationToReceipt,
  canonicalHelpDeskEmailReceiptAdapterInput,
  type HelpDeskEmailReceiptAdapterInput,
} from "./help-desk-email-receipt-adapter.ts";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email.ts";
import {
  adaptPrivateDocumentLifecycleToReceipt,
  type PrivateDocumentLifecycleReceiptInput,
} from "./private-document-receipt-adapter.ts";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from "./private-document-evidence.ts";
import {
  adaptOperationTelemetryToReceiptCandidates,
  type TelemetryReceiptAdapterContract,
} from "./operation-telemetry-receipt-adapter.ts";
import { CANONICAL_RECEIPT_FIXTURES } from "./scenario-evidence-receipt.fixtures.ts";
import {
  EvidenceReceiptError,
  type EvidenceReceiptClaim,
  type ScenarioEvidenceReceipt,
  type VerifiedScenarioEvidenceReceipt,
  verifyScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import {
  parseScenarioManifest,
  ScenarioManifestError,
  type ScenarioManifest,
} from "./scenario-manifest.ts";
import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioExecutionPlan,
  type ScenarioPlanRole,
} from "./scenario-plan.ts";
import { SCENARIO_MANIFESTS } from "./scenarios.ts";
import {
  adaptTeamsMissedCallObservationToReceipt,
  canonicalTeamsMissedCallReceiptAdapterInput,
  type TeamsMissedCallReceiptAdapterInput,
} from "./teams-missed-call-receipt-adapter.ts";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call.ts";

const MAX_SCENARIOS = 32;
const MAX_FAILURES = 64;
const SAFE_PUBLIC_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const RAW_VALUE =
  /(?:@|[\\/]|onmicrosoft|tenant-?id|subscription-?id|object-?id|message-?id|resource-?id|credential|certificate|access-?token|refresh-?token|session)/i;
const OUTPUT_ADAPTERS = [
  "avd-manifest",
  "help-desk-email",
  "operation-telemetry",
  "private-document",
  "teams-missed-call",
] as const;
const PUBLIC_SCENARIO_IDS = new Set(
  SCENARIO_MANIFESTS.map(({ id }) => id),
);

export type CompatibilityDriftCategory =
  | "AVD_ADAPTER_DRIFT"
  | "BOUNDS_DRIFT"
  | "CLEANUP_DRIFT"
  | "COST_DRIFT"
  | "EVIDENCE_DRIFT"
  | "EXPIRY_DRIFT"
  | "HELP_DESK_ADAPTER_DRIFT"
  | "LEARNER_DRIFT"
  | "OPERATION_DRIFT"
  | "PLAN_PHASE_DRIFT"
  | "RAW_IDENTIFIER_DRIFT"
  | "RECEIPT_COVERAGE_DRIFT"
  | "RECEIPT_OVERCLAIM_DRIFT"
  | "RECEIPT_VOCABULARY_DRIFT"
  | "REGISTRY_DRIFT"
  | "RESPONSE_DRIFT"
  | "RETENTION_DRIFT"
  | "ROLE_DRIFT"
  | "TEAMS_MISSED_CALL_ADAPTER_DRIFT"
  | "TELEMETRY_MAPPING_DRIFT";

export interface CompatibilityFailure {
  scenarioId: string;
  category: CompatibilityDriftCategory;
}

export interface ScenarioCompatibilityRow {
  scenarioId: string;
  roleCount: number;
  operationCount: number;
  artifactCount: number;
  responseCount: number;
  cleanupCount: number;
  retentionCount: number;
  planStepCount: number;
  planPhases: readonly string[];
  receiptClaimCount: number;
  receiptObservationSources: readonly string[];
  adapters: readonly (typeof OUTPUT_ADAPTERS)[number][];
}

export interface ScenarioCompatibilityMatrix {
  schemaVersion: 1;
  status: "compatible" | "drift";
  scenarios: readonly ScenarioCompatibilityRow[];
  failures: readonly CompatibilityFailure[];
}

interface ReceiptFixture {
  manifest: ScenarioManifest;
  receipt: ScenarioEvidenceReceipt;
}

interface PlanSet {
  base: ScenarioExecutionPlan;
  responses: ReadonlyMap<string, ScenarioExecutionPlan>;
}

export interface CompatibilityTelemetryBinding {
  scenarioId: string;
  snapshot: OperationTelemetrySnapshot;
  contract: TelemetryReceiptAdapterContract;
}

export interface CompatibilityCheckOptions {
  catalog?: readonly unknown[];
  receiptFixtures?: readonly ReceiptFixture[];
  planOverrides?: ReadonlyMap<string, PlanSet>;
  avdInput?: AvdManifestRunnerAdapterInput;
  helpDeskInput?: HelpDeskEmailReceiptAdapterInput;
  privateDocumentInput?: PrivateDocumentLifecycleReceiptInput;
  teamsMissedCallInput?: TeamsMissedCallReceiptAdapterInput;
  telemetryBindings?: readonly CompatibilityTelemetryBinding[];
}

class CompatibilityDrift extends Error {
  readonly category: CompatibilityDriftCategory;

  constructor(category: CompatibilityDriftCategory) {
    super(category);
    this.name = "CompatibilityDrift";
    this.category = category;
  }
}

export function checkScenarioContractCompatibility(
  options: CompatibilityCheckOptions = {},
): ScenarioCompatibilityMatrix {
  const failures: CompatibilityFailure[] = [];
  const rows: ScenarioCompatibilityRow[] = [];
  const catalog = options.catalog ?? SCENARIO_MANIFESTS;
  const fixtures = options.receiptFixtures ?? CANONICAL_RECEIPT_FIXTURES;
  const telemetryBindings = options.telemetryBindings ?? [];

  if (
    !Array.isArray(catalog) ||
    catalog.length === 0 ||
    catalog.length > MAX_SCENARIOS ||
    telemetryBindings.length > MAX_SCENARIOS
  ) {
    return matrix([], [{ scenarioId: "unknown", category: "BOUNDS_DRIFT" }]);
  }

  const manifests: ScenarioManifest[] = [];
  for (const value of catalog) {
    const hintedId = typeof value === "object" && value !== null &&
        !Array.isArray(value)
      ? (value as { id?: unknown }).id
      : undefined;
    if (typeof hintedId === "string" && !safePublicId(hintedId)) {
      addFailure(failures, "unknown", "RAW_IDENTIFIER_DRIFT");
      continue;
    }
    try {
      const manifest = parseScenarioManifest(value);
      const inputRoles = (value as { roles?: unknown }).roles;
      if (
        typeof inputRoles !== "object" ||
        inputRoles === null ||
        Array.isArray(inputRoles) ||
        !sameSet(Object.keys(inputRoles), Object.keys(manifest.roles))
      ) {
        addFailure(failures, manifest.id, "ROLE_DRIFT");
        continue;
      }
      if (!PUBLIC_SCENARIO_IDS.has(manifest.id)) {
        addFailure(failures, "unknown", "REGISTRY_DRIFT");
        continue;
      }
      manifests.push(manifest);
    } catch (error) {
      addFailure(failures, "unknown", classifyManifestError(error));
    }
  }
  const ids = manifests.map(({ id }) => id);
  if (
    ids.some((id) => !safePublicId(id)) ||
    new Set(ids).size !== ids.length
  ) {
    addFailure(
      failures,
      "unknown",
      ids.some((id) => !safePublicId(id))
        ? "RAW_IDENTIFIER_DRIFT"
        : "REGISTRY_DRIFT",
    );
  }

  for (const manifest of [...manifests].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const scenarioFailures: CompatibilityFailure[] = [];
    let plans: PlanSet | undefined;
    let vocabularyReceipt: ScenarioEvidenceReceipt | undefined;
    let verifiedReceipt: VerifiedScenarioEvidenceReceipt | undefined;
    const adapters: (typeof OUTPUT_ADAPTERS)[number][] = [];

    try {
      const candidatePlans = options.planOverrides?.get(manifest.id) ??
        compilePlans(manifest, catalog);
      validatePlanSet(manifest, candidatePlans);
      plans = candidatePlans;
    } catch (error) {
      addFailure(
        scenarioFailures,
        manifest.id,
        classifyPlanError(error),
      );
    }

    try {
      vocabularyReceipt = buildVocabularyReceipt(manifest);
      verifyScenarioEvidenceReceipt(vocabularyReceipt, manifest);
    } catch (error) {
      addFailure(
        scenarioFailures,
        manifest.id,
        error instanceof EvidenceReceiptError &&
            error.code === "raw-identifier"
          ? "RAW_IDENTIFIER_DRIFT"
          : "RECEIPT_VOCABULARY_DRIFT",
      );
    }

    const matchingFixtures = fixtures.filter(
      (fixture) => fixture.manifest.id === manifest.id,
    );
    if (
      manifest.id === PRIVATE_DOCUMENT_EVIDENCE_SCENARIO.id &&
      matchingFixtures.length === 0
    ) {
      try {
        matchingFixtures.push({
          manifest,
          receipt: adaptPrivateDocumentLifecycleToReceipt(
            options.privateDocumentInput ??
              canonicalPrivateDocumentReceiptInput(),
          ),
        });
        adapters.push("private-document");
      } catch {
        addFailure(
          scenarioFailures,
          manifest.id,
          "RECEIPT_COVERAGE_DRIFT",
        );
      }
    }
    if (matchingFixtures.length !== 1) {
      addFailure(
        scenarioFailures,
        manifest.id,
        "RECEIPT_COVERAGE_DRIFT",
      );
    } else {
      try {
        verifiedReceipt = verifyScenarioEvidenceReceipt(
          matchingFixtures[0]!.receipt,
          manifest,
        );
      } catch (error) {
        addFailure(
          scenarioFailures,
          manifest.id,
          classifyReceiptError(error),
        );
      }
    }

    if (manifest.id === AVD_THREE_VM_SCENARIO.id) {
      try {
        validateAvdAdapter(
          manifest,
          options.avdInput ?? canonicalAvdManifestDryRunInput(),
        );
        adapters.push("avd-manifest");
      } catch {
        addFailure(scenarioFailures, manifest.id, "AVD_ADAPTER_DRIFT");
      }
    }

    if (manifest.id === HELP_DESK_EMAIL_SCENARIO.id) {
      try {
        verifyScenarioEvidenceReceipt(
          adaptHelpDeskEmailOperationToReceipt(
            options.helpDeskInput ??
              canonicalHelpDeskEmailReceiptAdapterInput(),
          ),
          manifest,
        );
        adapters.push("help-desk-email");
      } catch {
        addFailure(
          scenarioFailures,
          manifest.id,
          "HELP_DESK_ADAPTER_DRIFT",
        );
      }
    }

    if (manifest.id === TEAMS_MISSED_CALL_SCENARIO.id) {
      try {
        verifyScenarioEvidenceReceipt(
          adaptTeamsMissedCallObservationToReceipt(
            options.teamsMissedCallInput ??
              canonicalTeamsMissedCallReceiptAdapterInput(),
          ),
          manifest,
        );
        adapters.push("teams-missed-call");
      } catch {
        addFailure(
          scenarioFailures,
          manifest.id,
          "TEAMS_MISSED_CALL_ADAPTER_DRIFT",
        );
      }
    }

    for (const binding of telemetryBindings.filter(
      ({ scenarioId }) => scenarioId === manifest.id,
    )) {
      try {
        validateTelemetryBinding(
          manifest,
          binding,
          vocabularyReceipt,
        );
        if (!adapters.includes("operation-telemetry")) {
          adapters.push("operation-telemetry");
        }
      } catch {
        addFailure(
          scenarioFailures,
          manifest.id,
          "TELEMETRY_MAPPING_DRIFT",
        );
      }
    }

    failures.push(...scenarioFailures);
    rows.push({
      scenarioId: manifest.id,
      roleCount: assignedRoleActors(manifest).size,
      operationCount: manifest.operations.length,
      artifactCount: manifest.evidence.artifacts.length,
      responseCount: manifest.responseActions.length,
      cleanupCount: manifest.lifecycle.cleanupOperationKeys.length,
      retentionCount: manifest.lifecycle.retainedArtifacts.length,
      planStepCount: plans?.base.steps.length ?? 0,
      planPhases: plans
        ? [...new Set(plans.base.steps.map(({ phase }) => phase))].sort()
        : [],
      receiptClaimCount: verifiedReceipt?.claims.length ?? 0,
      receiptObservationSources: verifiedReceipt
        ? [
          ...new Set(
            verifiedReceipt.claims
              .map(({ observationSource }) => observationSource)
              .filter((source) => source !== "none"),
          ),
        ].sort()
        : [],
      adapters: adapters.sort(),
    });
  }

  for (const binding of telemetryBindings) {
    if (!manifests.some(({ id }) => id === binding.scenarioId)) {
      addFailure(
        failures,
        safePublicId(binding.scenarioId) ? binding.scenarioId : "unknown",
        safePublicId(binding.scenarioId)
          ? "TELEMETRY_MAPPING_DRIFT"
          : "RAW_IDENTIFIER_DRIFT",
      );
    }
  }

  return matrix(rows, failures);
}

export function formatScenarioCompatibilityMatrix(
  result: ScenarioCompatibilityMatrix,
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function compilePlans(
  manifest: ScenarioManifest,
  catalog: readonly unknown[],
): PlanSet {
  const actorAliases = planAliases(manifest);
  const expiry = Date.parse(manifest.lifecycle.expiresAt);
  const now = new Date(
    expiry - manifest.cost.conservativeDurationHours * 3_600_000,
  ).toISOString();
  const baseRequest = {
    scenarioId: manifest.id,
    actorAliases,
    now,
    expiresAt: manifest.lifecycle.expiresAt,
    maximumBudgetUsd: manifest.cost.laneMaximum,
  };
  const base = compileScenarioExecutionPlan(baseRequest, catalog);
  const responses = new Map<string, ScenarioExecutionPlan>();
  for (const response of manifest.responseActions) {
    responses.set(
      response.id,
      compileScenarioExecutionPlan(
        { ...baseRequest, selectedResponseId: response.id },
        catalog,
      ),
    );
  }
  return { base, responses };
}

function planAliases(
  manifest: ScenarioManifest,
): Record<string, string> {
  const aliasByActor = new Map(
    manifest.actors.map((actor, index) => [
      actor.id,
      `actor-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const aliases: Record<string, string> = {};
  for (const [role, actorId] of roleEntries(manifest)) {
    aliases[role] = aliasByActor.get(actorId)!;
  }
  return aliases;
}

function validatePlanSet(
  manifest: ScenarioManifest,
  plans: PlanSet,
): void {
  validatePlanRoot(manifest, plans.base);
  for (const plan of [plans.base, ...plans.responses.values()]) {
    if (
      plan.steps.some(
        ({ phase, operationKey }) =>
          (
            phase === "producer-operation" ||
            phase === "optional-response" ||
            phase === "cleanup"
          ) &&
          !manifest.operations.some(({ key }) => key === operationKey),
      )
    ) {
      throw new CompatibilityDrift("OPERATION_DRIFT");
    }
  }
  if (plans.responses.size !== manifest.responseActions.length) {
    throw new CompatibilityDrift("RESPONSE_DRIFT");
  }
  const cleanupObservationKeys = new Set(
    manifest.evidence.artifacts.flatMap((artifact) =>
      artifact.kind === "cleanup-state"
        ? [artifact.sourceOperationKey]
        : []
    ),
  );
  for (const operation of manifest.operations) {
    const responseActions = manifest.responseActions.filter(
      ({ operationKey }) => operationKey === operation.key,
    );
    if (
      operation.phase === "response" &&
      responseActions.length === 0 &&
      operation.capability === "learner.inspect" &&
      operation.ownerActorId === manifest.roles.learner
    ) {
      continue;
    }
    const plansToInspect = operation.phase === "response"
      ? responseActions
        .map(({ id }) => plans.responses.get(id))
      : [plans.base];
    if (
      plansToInspect.length === 0 ||
      plansToInspect.some((plan) => plan === undefined)
    ) {
      throw new CompatibilityDrift(
        operation.phase === "response"
          ? "RESPONSE_DRIFT"
          : "OPERATION_DRIFT",
      );
    }
    const expectedPhase = operation.phase === "cleanup" ||
        cleanupObservationKeys.has(operation.key)
      ? "cleanup"
      : operation.phase === "response"
      ? "optional-response"
      : "producer-operation";
    for (const plan of plansToInspect as ScenarioExecutionPlan[]) {
      const matching = plan.steps.filter(
        (step) =>
          step.operationKey === operation.key &&
          step.operationCategory === operation.capability &&
          step.phase === expectedPhase,
      );
      if (matching.length !== 1) {
        const wrongPhase = plan.steps.some(
          (step) =>
            step.operationKey === operation.key &&
            step.operationCategory === operation.capability,
        );
        throw new CompatibilityDrift(
          wrongPhase ? "PLAN_PHASE_DRIFT" : "OPERATION_DRIFT",
        );
      }
      if (
        !stepOwnerMatches(manifest, plan, operation.ownerActorId, matching[0]!)
      ) {
        throw new CompatibilityDrift(
          expectedPhase === "optional-response"
            ? "RESPONSE_DRIFT"
            : "ROLE_DRIFT",
        );
      }
    }
  }

  const evidenceSteps = plans.base.steps.filter(
    ({ phase }) => phase === "authentic-evidence",
  );
  if (
    evidenceSteps.length !== manifest.evidence.artifacts.length ||
    manifest.evidence.artifacts.some((artifact) => {
      const step = evidenceSteps.find(
        ({ operationKey }) => operationKey === artifact.id,
      );
      return step?.evidenceExpectation === undefined ||
        step.evidenceExpectation.artifactKind !== artifact.kind ||
        step.evidenceExpectation.authenticity !== artifact.authenticity ||
        step.evidenceExpectation.learnerVisibility !==
          artifact.learnerVisibility ||
        !sameSet(
          step.evidenceExpectation.semanticClaims,
          artifact.semanticClaims,
        );
    })
  ) {
    throw new CompatibilityDrift("EVIDENCE_DRIFT");
  }

  const learnerSteps = plans.base.steps.filter(
    ({ phase }) => phase === "learner-interpretation",
  );
  if (
    learnerSteps.length !== 1 ||
    learnerSteps[0]!.owningRole !== "learner" ||
    learnerSteps[0]!.actorAlias !== plans.base.actorAliases.learner
  ) {
    throw new CompatibilityDrift("LEARNER_DRIFT");
  }

  for (const response of manifest.responseActions) {
    const responsePlan = plans.responses.get(response.id)!;
    if (
      responsePlan.selectedResponseId !== response.id ||
      responsePlan.steps.filter(
          ({ phase, operationKey }) =>
            phase === "optional-response" &&
            operationKey === response.operationKey,
        ).length !== 1
    ) {
      throw new CompatibilityDrift("RESPONSE_DRIFT");
    }
  }

  const cleanupSteps = plans.base.steps.filter(
    ({ phase }) => phase === "cleanup",
  );
  if (
    !sameSet(
      plans.base.terminalProof.cleanupOperationKeys,
      manifest.lifecycle.cleanupOperationKeys,
    ) ||
    manifest.lifecycle.cleanupOperationKeys.some((key) =>
      cleanupSteps.filter(({ operationKey }) => operationKey === key).length !==
        1
    )
  ) {
    throw new CompatibilityDrift("CLEANUP_DRIFT");
  }

  const retentionSteps = plans.base.steps.filter(
    ({ phase }) => phase === "retention",
  );
  if (
    retentionSteps.length !== manifest.lifecycle.retainedArtifacts.length ||
    manifest.lifecycle.retainedArtifacts.some((retained) => {
      const step = retentionSteps.find(
        ({ operationKey }) => operationKey === retained.artifactId,
      );
      return step?.retention?.disposition !== retained.disposition ||
        step.retention.cleanupOperationKey !== retained.cleanupOperationKey;
    })
  ) {
    throw new CompatibilityDrift("RETENTION_DRIFT");
  }
}

function validatePlanRoot(
  manifest: ScenarioManifest,
  plan: ScenarioExecutionPlan,
): void {
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== "scenario-execution-plan" ||
    plan.scenarioId !== manifest.id ||
    plan.steps.length === 0 ||
    plan.steps.some(({ phase }) => !safePublicId(phase)) ||
    plan.steps.some((step, index) => step.sequence !== index + 1)
  ) {
    throw new CompatibilityDrift("PLAN_PHASE_DRIFT");
  }
  if (plan.expiresAt !== manifest.lifecycle.expiresAt) {
    throw new CompatibilityDrift("EXPIRY_DRIFT");
  }
  if (
    plan.budget.currency !== manifest.cost.currency ||
    plan.budget.plannedMaximum !== manifest.cost.laneMaximum
  ) {
    throw new CompatibilityDrift("COST_DRIFT");
  }
  if (
    !sameSet(
      plan.terminalProof.evidenceArtifactIds,
      manifest.evidence.artifacts.map(({ id }) => id),
    ) ||
    !sameSet(
      plan.terminalProof.observationOperationKeys,
      manifest.evidence.artifacts.flatMap((artifact) =>
        artifact.observation ? [artifact.observation.operationKey] : []
      ),
    ) ||
    !sameSet(
      plan.terminalProof.retainedArtifactIds,
      manifest.lifecycle.retainedArtifacts.map(({ artifactId }) => artifactId),
    ) ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    plan.steps.filter(({ phase }) => phase === "terminal-verification").length !==
      1
  ) {
    throw new CompatibilityDrift("PLAN_PHASE_DRIFT");
  }
  validatePlanAliases(manifest, plan);
}

function validatePlanAliases(
  manifest: ScenarioManifest,
  plan: ScenarioExecutionPlan,
): void {
  const actorAlias = new Map<string, string>();
  const aliasActor = new Map<string, string>();
  const expectedRoles = roleEntries(manifest);
  for (const [role, actorId] of expectedRoles) {
    const alias = plan.actorAliases[role];
    if (
      alias === undefined ||
      !safePublicId(alias) ||
      RAW_VALUE.test(alias) ||
      GUID.test(alias)
    ) {
      throw new CompatibilityDrift("RAW_IDENTIFIER_DRIFT");
    }
    const existingAlias = actorAlias.get(actorId);
    const existingActor = aliasActor.get(alias);
    if (
      (existingAlias !== undefined && existingAlias !== alias) ||
      (existingActor !== undefined && existingActor !== actorId)
    ) {
      throw new CompatibilityDrift("ROLE_DRIFT");
    }
    actorAlias.set(actorId, alias);
    aliasActor.set(alias, actorId);
  }
  if (
    Object.keys(plan.actorAliases).length !==
      new Set(expectedRoles.map(([role]) => role)).size
  ) {
    throw new CompatibilityDrift("ROLE_DRIFT");
  }
}

function stepOwnerMatches(
  manifest: ScenarioManifest,
  plan: ScenarioExecutionPlan,
  actorId: string,
  step: ScenarioExecutionPlan["steps"][number],
): boolean {
  return roleEntries(manifest).some(
    ([role, assignedActor]) =>
      assignedActor === actorId &&
      step.owningRole === role &&
      step.actorAlias === plan.actorAliases[role],
  );
}

function buildVocabularyReceipt(
  manifest: ScenarioManifest,
): ScenarioEvidenceReceipt {
  const claims: EvidenceReceiptClaim[] = [
    ...manifest.operations.map((operation) =>
      uninspectedClaim(
        `operation-${operation.key}`,
        "operation",
        "operation",
        operation.key,
        "operation-completed",
      )
    ),
    ...manifest.evidence.artifacts.map((artifact) => ({
      ...uninspectedClaim(
        `artifact-${artifact.id}`,
        "artifact",
        "artifact",
        artifact.id,
        "artifact-authentic",
      ),
      artifact: {
        kind: artifact.kind,
        authenticity: artifact.authenticity,
      },
    })),
    ...manifest.learner.evidenceArtifactIds.map((artifactId) =>
      uninspectedClaim(
        `visibility-${artifactId}`,
        "learner-visibility",
        "artifact",
        artifactId,
        "learner-visible",
      )
    ),
    uninspectedClaim(
      "learner-interpretation",
      "learner-interpretation",
      "scenario",
      manifest.id,
      "learner-interpreted",
    ),
    ...manifest.responseActions.map((response) =>
      uninspectedClaim(
        `response-${response.id}`,
        "response",
        "response-action",
        response.id,
        "response-completed",
      )
    ),
    ...manifest.lifecycle.cleanupOperationKeys.map((operationKey) =>
      uninspectedClaim(
        `cleanup-${operationKey}`,
        "cleanup",
        "operation",
        operationKey,
        "cleanup-completed",
      )
    ),
    ...manifest.evidence.artifacts.map((artifact) =>
      uninspectedClaim(
        `retention-${artifact.id}`,
        "retention",
        "artifact",
        artifact.id,
        "retention-confirmed",
      )
    ),
    ...(manifest.detection?.kind === "independent"
      ? [
        uninspectedClaim(
          "detector-independent",
          "independent-observation",
          "scenario",
          manifest.id,
          "detector-independent",
        ),
      ]
      : []),
    ...manifest.evidence.artifacts.flatMap((artifact) =>
      artifact.semanticClaims.map((assertion) =>
        uninspectedClaim(
          `terminal-${artifact.id}-${assertion}`,
          "terminal-proof",
          "artifact",
          artifact.id,
          assertion as EvidenceReceiptClaim["assertion"],
        )
      )
    ),
  ];
  return {
    schemaVersion: 1,
    scenario: { id: manifest.id, manifestSchemaVersion: 2 },
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: manifest.roles.workloadActor,
      learner: manifest.roles.learner,
      ...(manifest.roles.detector === undefined
        ? {}
        : { detector: manifest.roles.detector }),
      ...(manifest.roles.responder === undefined
        ? {}
        : { responder: manifest.roles.responder }),
    },
    claims,
  };
}

function uninspectedClaim(
  id: string,
  category: EvidenceReceiptClaim["category"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  assertion: EvidenceReceiptClaim["assertion"],
): EvidenceReceiptClaim {
  return {
    id,
    category,
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state: "uninspected",
  };
}

function validateAvdAdapter(
  manifest: ScenarioManifest,
  configured: AvdManifestRunnerAdapterInput,
): void {
  const input = structuredClone(configured);
  (input as { manifest: unknown }).manifest = manifest;
  const plan = compileAvdManifestRunnerPlan(input);
  if (
    plan.expiryUtc !== manifest.lifecycle.expiresAt ||
    plan.cost.laneCeilingUsd !== manifest.cost.laneMaximum ||
    plan.cost.billedHours !== manifest.cost.conservativeDurationHours ||
    plan.learnerSessionClaimed
  ) {
    throw new CompatibilityDrift("AVD_ADAPTER_DRIFT");
  }
}

function canonicalPrivateDocumentReceiptInput():
  PrivateDocumentLifecycleReceiptInput {
  const correlation = "run-compatibility";
  const entries: Array<
    Omit<
      PrivateDocumentLifecycleReceiptInput["journal"][number],
      "sequence" | "correlation"
    >
  > = [];
  for (
    const operation of [
      "folder-create",
      "file-create",
      "direct-share-create",
    ] as const
  ) {
    entries.push(
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      { operation, transition: "reconciled", detail: "exact-desired-state" },
    );
  }
  entries.push({
    operation: "learner-visibility",
    transition: "observed",
    detail: "contract-failed",
  });
  for (
    const operation of [
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ] as const
  ) {
    entries.push(
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
      { operation, transition: "reconciled", detail: "exact-desired-state" },
    );
  }
  entries.push(
    {
      operation: "terminal-producer-absence",
      transition: "observed",
      detail: "producer-absent",
    },
    {
      operation: "terminal-learner-absence",
      transition: "observed",
      detail: "contract-failed",
    },
  );
  return {
    schemaVersion: 1,
    scenarioId: "private-document-evidence",
    correlation,
    result: {
      status: "blocked-cleanup",
      failedOperation: "terminal-absence",
      learnerVisibility: "not-proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    },
    journal: entries.map((entry, index) => ({
      sequence: index + 1,
      correlation,
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

function validateTelemetryBinding(
  manifest: ScenarioManifest,
  binding: CompatibilityTelemetryBinding,
  vocabularyReceipt: ScenarioEvidenceReceipt | undefined,
): void {
  if (
    binding.contract.scenarioId !== manifest.id ||
    vocabularyReceipt === undefined ||
    binding.contract.roles.evidenceProducer !==
      manifest.roles.evidenceProducer ||
    binding.contract.roles.workloadActor !== manifest.roles.workloadActor ||
    binding.contract.roles.learner !== manifest.roles.learner ||
    binding.contract.roles.detector !== manifest.roles.detector ||
    binding.contract.roles.responder !== manifest.roles.responder
  ) {
    throw new CompatibilityDrift("TELEMETRY_MAPPING_DRIFT");
  }
  for (const mapping of binding.contract.operations) {
    const operation = manifest.operations.find(
      ({ key }) => key === mapping.manifestOperationKey,
    );
    const expectedActor = binding.contract.roles[mapping.observerRole];
    if (
      operation === undefined ||
      expectedActor === undefined ||
      operation.ownerActorId !== expectedActor ||
      (
        mapping.phase === "cleanup" &&
        operation.phase !== "cleanup"
      ) ||
      (
        mapping.phase === "execution" &&
        operation.phase !== "setup" &&
        operation.phase !== "evidence"
      )
    ) {
      throw new CompatibilityDrift("TELEMETRY_MAPPING_DRIFT");
    }
  }
  const adapted = adaptOperationTelemetryToReceiptCandidates(
    binding.snapshot,
    binding.contract,
  );
  if (
    adapted.status !== "coherent" ||
    adapted.candidates.some(
      ({ claim }) =>
        claim.category !== "operation" ||
        claim.state === "absent" ||
        claim.state === "licensing-or-latency-blocked",
    ) ||
    !sameSet(adapted.missingReceiptCoverage, [
      "artifact",
      "independent-observation",
      "learner-visibility",
      "learner-interpretation",
      "response",
      "cleanup",
      "retention",
      "terminal-proof",
    ])
  ) {
    throw new CompatibilityDrift("TELEMETRY_MAPPING_DRIFT");
  }
  const candidateById = new Map(
    adapted.candidates.map(({ claim }) => [claim.id, claim]),
  );
  const composed = {
    ...vocabularyReceipt,
    claims: vocabularyReceipt.claims.map((claim) =>
      candidateById.get(claim.id) ?? claim
    ),
  };
  verifyScenarioEvidenceReceipt(composed, manifest);
  if (
    composed.claims.some(
      (claim) =>
        claim.category !== "operation" && claim.state !== "uninspected",
    )
  ) {
    throw new CompatibilityDrift("TELEMETRY_MAPPING_DRIFT");
  }
}

function roleEntries(
  manifest: ScenarioManifest,
): Array<[Exclude<ScenarioPlanRole, "system">, string]> {
  return [
    ["evidenceProducer", manifest.roles.evidenceProducer],
    ["workloadActor", manifest.roles.workloadActor],
    ["learner", manifest.roles.learner],
    ...(manifest.roles.detector === undefined
      ? []
      : [[
        "detector",
        manifest.roles.detector,
      ] as [Exclude<ScenarioPlanRole, "system">, string]]),
    ...(manifest.roles.responder === undefined
      ? []
      : [[
        "responder",
        manifest.roles.responder,
      ] as [Exclude<ScenarioPlanRole, "system">, string]]),
    ["cleanupOwner", manifest.lifecycle.cleanupOwnerActorId],
  ];
}

function assignedRoleActors(manifest: ScenarioManifest): Set<string> {
  return new Set(roleEntries(manifest).map(([, actorId]) => actorId));
}

function classifyManifestError(error: unknown): CompatibilityDriftCategory {
  if (!(error instanceof ScenarioManifestError)) {
    return "REGISTRY_DRIFT";
  }
  const message = error.message;
  if (/learner\.|evidenceArtifactIds|expectedInterpretation/i.test(message)) {
    return "LEARNER_DRIFT";
  }
  if (
    /roles|role assignment|producer and learner|detector and workload|actor role/i
      .test(message)
  ) return "ROLE_DRIFT";
  if (/response/i.test(message)) {
    return "RESPONSE_DRIFT";
  }
  if (/retention|retained|disposition/i.test(message)) {
    return "RETENTION_DRIFT";
  }
  if (/cleanup/i.test(message)) {
    return "CLEANUP_DRIFT";
  }
  if (/operation|capability|owner/i.test(message)) {
    return "OPERATION_DRIFT";
  }
  if (/evidence|artifact|semantic/i.test(message)) {
    return "EVIDENCE_DRIFT";
  }
  if (/cost|currency|laneMaximum|duration/i.test(message)) {
    return "COST_DRIFT";
  }
  if (/expiry|expiresAt/i.test(message)) {
    return "EXPIRY_DRIFT";
  }
  if (/identifier|UPN|GUID|path|alias/i.test(message)) {
    return "RAW_IDENTIFIER_DRIFT";
  }
  return "REGISTRY_DRIFT";
}

function classifyPlanError(error: unknown): CompatibilityDriftCategory {
  if (error instanceof CompatibilityDrift) {
    return error.category;
  }
  if (error instanceof ScenarioPlanError) {
    const mapping: Partial<
      Record<ScenarioPlanError["category"], CompatibilityDriftCategory>
    > = {
      ACTOR_BINDING_INVALID: "ROLE_DRIFT",
      BUDGET_EXCEEDED: "COST_DRIFT",
      CLEANUP_MISSING: "CLEANUP_DRIFT",
      EXPIRY_INVALID: "EXPIRY_DRIFT",
      INTERPRETATION_MISSING: "LEARNER_DRIFT",
      RAW_IDENTIFIER_REJECTED: "RAW_IDENTIFIER_DRIFT",
      RESPONSE_NOT_ALLOWED: "RESPONSE_DRIFT",
      RETENTION_CONFLICT: "RETENTION_DRIFT",
      ROLE_CONFLATION: "ROLE_DRIFT",
      SELF_TRIGGER_UNDECLARED: "ROLE_DRIFT",
      TERMINAL_PROOF_MISSING: "EVIDENCE_DRIFT",
    };
    return mapping[error.category] ?? "PLAN_PHASE_DRIFT";
  }
  return "PLAN_PHASE_DRIFT";
}

function classifyReceiptError(error: unknown): CompatibilityDriftCategory {
  if (error instanceof CompatibilityDrift) {
    return error.category;
  }
  if (!(error instanceof EvidenceReceiptError)) {
    return "RECEIPT_COVERAGE_DRIFT";
  }
  if (error.code === "raw-identifier") return "RAW_IDENTIFIER_DRIFT";
  if (error.code === "role-conflation" || error.code === "role-mismatch") {
    return "ROLE_DRIFT";
  }
  if (
    error.code === "state-promotion" ||
    error.code === "unsupported-visibility" ||
    error.code === "ungrounded-claim"
  ) {
    return "RECEIPT_OVERCLAIM_DRIFT";
  }
  if (error.code === "invalid-observation") return "OPERATION_DRIFT";
  if (error.code === "shape") return "RECEIPT_VOCABULARY_DRIFT";
  if (error.code === "cleanup-gap") return "CLEANUP_DRIFT";
  return "RECEIPT_COVERAGE_DRIFT";
}

function matrix(
  rows: readonly ScenarioCompatibilityRow[],
  configuredFailures: readonly CompatibilityFailure[],
): ScenarioCompatibilityMatrix {
  const failures = [...configuredFailures]
    .filter((failure, index, values) =>
      values.findIndex((candidate) =>
        candidate.scenarioId === failure.scenarioId &&
        candidate.category === failure.category
      ) === index
    )
    .sort((left, right) =>
      left.scenarioId.localeCompare(right.scenarioId) ||
      left.category.localeCompare(right.category)
    )
    .slice(0, MAX_FAILURES);
  return Object.freeze({
    schemaVersion: 1,
    status: failures.length === 0 ? "compatible" : "drift",
    scenarios: Object.freeze(
      [...rows].sort((left, right) =>
        left.scenarioId.localeCompare(right.scenarioId)
      ),
    ),
    failures: Object.freeze(failures),
  });
}

function addFailure(
  failures: CompatibilityFailure[],
  scenarioId: string,
  category: CompatibilityDriftCategory,
): void {
  if (failures.length < MAX_FAILURES) {
    failures.push({
      scenarioId: PUBLIC_SCENARIO_IDS.has(scenarioId)
        ? scenarioId
        : "unknown",
      category,
    });
  }
}

function sameSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function safePublicId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 128 &&
    SAFE_PUBLIC_ID.test(value) &&
    !GUID.test(value) &&
    !RAW_VALUE.test(value);
}
