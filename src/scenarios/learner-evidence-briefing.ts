import {
  isSafeScenarioExecutionPlan,
  isSafeScenarioPlanningRequest,
} from "../api/client";
import {
  API_SUPPORT_REFERENCE_PATTERN,
} from "../api/support-reference";
import {
  verifyScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt";
import {
  findScenarioRoleConflation,
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";
import type { ScenarioExecutionPlan } from "./scenario-plan";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email";

export const LEARNER_BRIEFING_SCENARIO_ID =
  "help-desk-email-observation";
export const LEARNER_BRIEFING_EXPECTED_ALIAS = "learner-cory";
export const LEARNER_BRIEFING_RESPONSE_ID =
  "report-help-desk-interpretation";

const INPUT_KEYS = [
  "schemaVersion",
  "plan",
  "receipt",
  "expectedLearnerAlias",
  "now",
] as const;
const SAFE_ALIAS = /^[a-z][a-z0-9-]{1,31}$/;
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_ACTIONS = 4;

export type LearnerEvidenceBriefingErrorCategory =
  | "ACTION_UNSUPPORTED"
  | "ACTOR_MISMATCH"
  | "EVIDENCE_MISSING"
  | "INPUT_INVALID"
  | "PLAN_INVALID"
  | "RECEIPT_INVALID"
  | "WINDOW_INVALID";

export class LearnerEvidenceBriefingError extends Error {
  readonly category: LearnerEvidenceBriefingErrorCategory;

  constructor(category: LearnerEvidenceBriefingErrorCategory) {
    super(category);
    this.name = "LearnerEvidenceBriefingError";
    this.category = category;
  }
}

export interface LearnerEvidenceBriefingRequest {
  readonly schemaVersion: 1;
  readonly plan: ScenarioExecutionPlan;
  readonly receipt: ScenarioEvidenceReceipt;
  readonly expectedLearnerAlias: string;
  readonly now: string;
}

export interface LearnerEvidenceBriefing {
  readonly schemaVersion: 1;
  readonly kind: "learner-evidence-briefing";
  readonly scenario: {
    readonly id: "help-desk-email-observation";
    readonly title: string;
    readonly context: string;
  };
  readonly evidence: {
    readonly type: "Outlook email";
    readonly status: "Observed";
    readonly briefingTime: string;
  };
  readonly producer: {
    readonly identityLabel: string;
    readonly roleLabel: "Evidence producer";
  };
  readonly learner: {
    readonly identityLabel: string;
    readonly roleLabel: "Learner";
  };
  readonly observationTask: string;
  readonly expectedInterpretation: string;
  readonly permittedActions: readonly Readonly<{
    id: "report-help-desk-interpretation";
    label: string;
  }>[];
  readonly supportReference: string;
}

export function buildLearnerEvidenceBriefing(
  value: unknown,
  manifestValue: unknown = HELP_DESK_EMAIL_SCENARIO,
): LearnerEvidenceBriefing {
  const input = parseInput(value);
  let manifest: ScenarioManifest;
  try {
    manifest = parseScenarioManifest(manifestValue);
  } catch {
    throw new LearnerEvidenceBriefingError("PLAN_INVALID");
  }
  validatePlan(input, manifest);
  const verified = verifyReceipt(input.receipt, manifest);
  validateEvidence(verified, input.receipt, manifest);

  const producer = actorById(manifest, manifest.roles.evidenceProducer);
  const learner = actorById(manifest, manifest.roles.learner);
  const artifact = manifest.evidence.artifacts.find(
    ({ id }) => id === "cory-help-desk-email",
  );
  const supportReference = artifact?.observation?.proofReference;
  if (
    supportReference === undefined ||
    !/^canonical:[a-z0-9][a-z0-9/-]{2,199}$/.test(supportReference) ||
    API_SUPPORT_REFERENCE_PATTERN.test(supportReference)
  ) {
    throw new LearnerEvidenceBriefingError("EVIDENCE_MISSING");
  }
  const permittedActions = manifest.responseActions
    .filter(({ ownerActorId }) => ownerActorId === manifest.roles.learner);
  if (
    permittedActions.length !== 1 ||
    permittedActions.length > MAX_ACTIONS ||
    permittedActions[0]?.id !== LEARNER_BRIEFING_RESPONSE_ID ||
    input.plan.selectedResponseId !== LEARNER_BRIEFING_RESPONSE_ID
  ) {
    throw new LearnerEvidenceBriefingError("ACTION_UNSUPPORTED");
  }

  return {
    schemaVersion: 1,
    kind: "learner-evidence-briefing",
    scenario: {
      id: LEARNER_BRIEFING_SCENARIO_ID,
      title: manifest.title,
      context: manifest.summary,
    },
    evidence: {
      type: "Outlook email",
      status: "Observed",
      briefingTime: input.plan.generatedAt,
    },
    producer: {
      identityLabel: producer.label,
      roleLabel: "Evidence producer",
    },
    learner: {
      identityLabel: learner.label,
      roleLabel: "Learner",
    },
    observationTask: manifest.learner.task,
    expectedInterpretation: manifest.learner.expectedInterpretation,
    permittedActions: [{
      id: LEARNER_BRIEFING_RESPONSE_ID,
      label: permittedActions[0].summary,
    }],
    supportReference,
  };
}

function parseInput(value: unknown): LearnerEvidenceBriefingRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, INPUT_KEYS) ||
    value.schemaVersion !== 1 ||
    typeof value.expectedLearnerAlias !== "string" ||
    !SAFE_ALIAS.test(value.expectedLearnerAlias) ||
    typeof value.now !== "string" ||
    !UTC_TIMESTAMP.test(value.now)
  ) {
    throw new LearnerEvidenceBriefingError("INPUT_INVALID");
  }
  return value as unknown as LearnerEvidenceBriefingRequest;
}

function validatePlan(
  input: LearnerEvidenceBriefingRequest,
  manifest: ScenarioManifest,
): void {
  const plan = input.plan;
  const currentTime = Date.parse(input.now);
  const generatedAt = Date.parse(plan.generatedAt);
  const expiresAt = Date.parse(plan.expiresAt);
  if (
    manifest.id !== LEARNER_BRIEFING_SCENARIO_ID ||
    plan.scenarioId !== manifest.id ||
    !UTC_TIMESTAMP.test(plan.expiresAt) ||
    !Number.isFinite(currentTime) ||
    !Number.isFinite(generatedAt) ||
    !Number.isFinite(expiresAt) ||
    generatedAt > currentTime ||
    currentTime >= expiresAt ||
    plan.actorAliases.learner !== input.expectedLearnerAlias ||
    input.expectedLearnerAlias !== LEARNER_BRIEFING_EXPECTED_ALIAS
  ) {
    throw new LearnerEvidenceBriefingError("PLAN_INVALID");
  }
  const reconstructedRequest = {
    scenarioId: plan.scenarioId,
    actorAliases: plan.actorAliases,
    now: plan.generatedAt,
    expiresAt: plan.expiresAt,
    maximumBudgetUsd: plan.budget.suppliedCeiling,
    ...(plan.selectedResponseId === null
      ? {}
      : { selectedResponseId: plan.selectedResponseId }),
  };
  if (
    !isSafeScenarioPlanningRequest(reconstructedRequest) ||
    !isSafeScenarioExecutionPlan(plan, reconstructedRequest)
  ) {
    throw new LearnerEvidenceBriefingError("PLAN_INVALID");
  }
  const evidenceProducer = plan.actorAliases.evidenceProducer;
  const workloadActor = plan.actorAliases.workloadActor;
  const learner = plan.actorAliases.learner;
  if (
    evidenceProducer === undefined ||
    workloadActor === undefined ||
    learner === undefined ||
    evidenceProducer === learner ||
    workloadActor === learner ||
    findScenarioRoleConflation(manifest.roles) !== undefined
  ) {
    throw new LearnerEvidenceBriefingError("ACTOR_MISMATCH");
  }
  if (
    !plan.terminalProof.evidenceArtifactIds.includes(
      "cory-help-desk-email",
    ) ||
    !plan.steps.some((step) =>
      step.phase === "authentic-evidence" &&
      step.evidenceExpectation?.artifactId === "cory-help-desk-email" &&
      step.evidenceExpectation.artifactKind === "outlook-email" &&
      step.evidenceExpectation.authenticity === "platform-native" &&
      step.evidenceExpectation.learnerVisibility === "observed"
    ) ||
    !plan.steps.some((step) =>
      step.phase === "learner-interpretation" &&
      step.owningRole === "learner" &&
      step.actorAlias === LEARNER_BRIEFING_EXPECTED_ALIAS
    )
  ) {
    throw new LearnerEvidenceBriefingError("PLAN_INVALID");
  }
}

function verifyReceipt(
  receipt: ScenarioEvidenceReceipt,
  manifest: ScenarioManifest,
) {
  try {
    return verifyScenarioEvidenceReceipt(receipt, manifest);
  } catch {
    throw new LearnerEvidenceBriefingError("RECEIPT_INVALID");
  }
}

function validateEvidence(
  verified: ReturnType<typeof verifyScenarioEvidenceReceipt>,
  receipt: ScenarioEvidenceReceipt,
  manifest: ScenarioManifest,
): void {
  if (
    verified.scenarioId !== LEARNER_BRIEFING_SCENARIO_ID ||
    receipt.roles.learner !== manifest.roles.learner ||
    receipt.roles.evidenceProducer !== manifest.roles.evidenceProducer ||
    receipt.roles.workloadActor !== manifest.roles.workloadActor
  ) {
    throw new LearnerEvidenceBriefingError("ACTOR_MISMATCH");
  }
  const required = new Map<string, {
    category: string;
    artifactKind: "outlook-email" | "none";
  }>([
    ["artifact-cory-help-desk-email", {
      category: "artifact",
      artifactKind: "outlook-email",
    }],
    ["visibility-cory-help-desk-email", {
      category: "learner-visibility",
      artifactKind: "none",
    }],
    ["terminal-outlook-email", {
      category: "terminal-proof",
      artifactKind: "none",
    }],
  ]);
  if (
    [...required].some(([claimId, expectation]) => {
      const claim = verified.claims.find((candidate) =>
        candidate.claimId === claimId
      );
      return claim === undefined ||
        claim.category !== expectation.category ||
        claim.state !== "proven" ||
        claim.observationSource !== "learner-view" ||
        claim.observerActor !== manifest.roles.learner ||
        claim.artifactKind !== expectation.artifactKind;
    })
  ) {
    throw new LearnerEvidenceBriefingError("EVIDENCE_MISSING");
  }
  if (
    !claimHasState(
      verified,
      "retention-cory-help-desk-email",
      "retention",
      "proven",
    ) ||
    !claimHasState(
      verified,
      "learner-interpretation",
      "learner-interpretation",
      "uninspected",
    ) ||
    !claimHasState(
      verified,
      `response-${LEARNER_BRIEFING_RESPONSE_ID}`,
      "response",
      "uninspected",
    ) ||
    !claimHasState(
      verified,
      "operation-interpret-help-desk-email",
      "operation",
      "uninspected",
    ) ||
    !claimHasState(
      verified,
      "cleanup-delete-retained-help-desk-email",
      "cleanup",
      "uninspected",
    ) ||
    !claimHasState(
      verified,
      "operation-delete-retained-help-desk-email",
      "operation",
      "uninspected",
    )
  ) {
    throw new LearnerEvidenceBriefingError("EVIDENCE_MISSING");
  }
}

function claimHasState(
  verified: ReturnType<typeof verifyScenarioEvidenceReceipt>,
  claimId: string,
  category: string,
  state: string,
): boolean {
  const claim = verified.claims.find((candidate) =>
    candidate.claimId === claimId
  );
  return claim?.category === category && claim.state === state;
}

function actorById(manifest: ScenarioManifest, actorId: string) {
  const actor = manifest.actors.find(({ id }) => id === actorId);
  if (actor === undefined) {
    throw new LearnerEvidenceBriefingError("ACTOR_MISMATCH");
  }
  return actor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());
}
