const LAB_KEYS = [
  "schemaVersion",
  "id",
  "title",
  "summary",
  "humanLearner",
  "storyActors",
  "learningObjective",
  "evidenceChain",
  "investigationPrompt",
  "permittedActions",
  "completionCriteria",
] as const;
const HUMAN_LEARNER_KEYS = ["label", "responsibility"] as const;
const STORY_ACTOR_KEYS = ["label", "kind", "role"] as const;
const EVIDENCE_STEP_KEYS = [
  "capabilityId",
  "learnerObservation",
  "whyItMatters",
] as const;
const STORY_ACTOR_KINDS = [
  "application",
  "device",
  "service",
  "simulated-person",
] as const;
const STORY_ACTOR_ROLES = [
  "detector",
  "evidence-recipient",
  "evidence-source",
  "responder",
] as const;
const SAFE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_TEXT = 500;
const MAX_ACTORS = 12;
const MIN_EVIDENCE_STEPS = 2;
const MAX_EVIDENCE_STEPS = 12;
const MAX_ACTIONS = 8;

export interface LearnerLabDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly humanLearner: {
    readonly label: string;
    readonly responsibility: string;
  };
  readonly storyActors: readonly {
    readonly label: string;
    readonly kind: typeof STORY_ACTOR_KINDS[number];
    readonly role: typeof STORY_ACTOR_ROLES[number];
  }[];
  readonly learningObjective: string;
  readonly evidenceChain: readonly {
    readonly capabilityId: string;
    readonly learnerObservation: string;
    readonly whyItMatters: string;
  }[];
  readonly investigationPrompt: string;
  readonly permittedActions: readonly string[];
  readonly completionCriteria: readonly string[];
}

export type LearnerLabValidationFailure =
  | "ACTOR_CONFLATION"
  | "CAPABILITY_DUPLICATE"
  | "CAPABILITY_UNKNOWN"
  | "EVIDENCE_CHAIN_INCOMPLETE"
  | "LAB_SHAPE_INVALID";

export class LearnerLabValidationError extends Error {
  readonly category: LearnerLabValidationFailure;

  constructor(category: LearnerLabValidationFailure) {
    super(category);
    this.name = "LearnerLabValidationError";
    this.category = category;
  }
}

export function parseLearnerLabDefinition(
  value: unknown,
  knownCapabilityIds: ReadonlySet<string>,
): LearnerLabDefinition {
  const lab = record(value, LAB_KEYS);
  if (
    lab.schemaVersion !== 1 ||
    !safeId(lab.id) ||
    !safeText(lab.title) ||
    !safeText(lab.summary) ||
    !safeText(lab.learningObjective) ||
    !safeText(lab.investigationPrompt)
  ) {
    throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
  }
  const humanLearner = record(lab.humanLearner, HUMAN_LEARNER_KEYS);
  if (
    !safeText(humanLearner.label) ||
    !safeText(humanLearner.responsibility)
  ) {
    throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
  }
  const storyActors = boundedArray(lab.storyActors, 1, MAX_ACTORS).map(
    (candidate) => {
      const actor = record(candidate, STORY_ACTOR_KEYS);
      if (
        !safeText(actor.label) ||
        !STORY_ACTOR_KINDS.includes(
          actor.kind as typeof STORY_ACTOR_KINDS[number],
        ) ||
        !STORY_ACTOR_ROLES.includes(
          actor.role as typeof STORY_ACTOR_ROLES[number],
        )
      ) {
        throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
      }
      return actor as unknown as LearnerLabDefinition["storyActors"][number];
    },
  );
  const normalizedLearner = humanLearner.label.trim().toLowerCase();
  if (
    storyActors.some(({ label }) =>
      label.trim().toLowerCase() === normalizedLearner
    )
  ) {
    throw new LearnerLabValidationError("ACTOR_CONFLATION");
  }

  const evidenceChain = boundedArray(
    lab.evidenceChain,
    MIN_EVIDENCE_STEPS,
    MAX_EVIDENCE_STEPS,
  ).map((candidate) => {
    const step = record(candidate, EVIDENCE_STEP_KEYS);
    if (
      !safeId(step.capabilityId) ||
      !safeText(step.learnerObservation) ||
      !safeText(step.whyItMatters)
    ) {
      throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
    }
    if (!knownCapabilityIds.has(step.capabilityId)) {
      throw new LearnerLabValidationError("CAPABILITY_UNKNOWN");
    }
    return step as unknown as LearnerLabDefinition["evidenceChain"][number];
  });
  if (
    new Set(evidenceChain.map(({ capabilityId }) => capabilityId)).size !==
      evidenceChain.length
  ) {
    throw new LearnerLabValidationError("CAPABILITY_DUPLICATE");
  }
  const permittedActions = textArray(lab.permittedActions);
  const completionCriteria = textArray(lab.completionCriteria);
  if (permittedActions.length === 0 || completionCriteria.length === 0) {
    throw new LearnerLabValidationError("EVIDENCE_CHAIN_INCOMPLETE");
  }
  return {
    schemaVersion: 1,
    id: lab.id,
    title: lab.title,
    summary: lab.summary,
    humanLearner: {
      label: humanLearner.label,
      responsibility: humanLearner.responsibility,
    },
    storyActors,
    learningObjective: lab.learningObjective,
    evidenceChain,
    investigationPrompt: lab.investigationPrompt,
    permittedActions,
    completionCriteria,
  };
}

function textArray(value: unknown): readonly string[] {
  const values = boundedArray(value, 0, MAX_ACTIONS);
  if (!values.every(safeText)) {
    throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
  }
  return values;
}

function boundedArray(
  value: unknown,
  minimum: number,
  maximum: number,
): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
  }
  return value;
}

function record<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): Record<Keys[number], unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new LearnerLabValidationError("LAB_SHAPE_INVALID");
  }
  return value as Record<Keys[number], unknown>;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value) && value.length <= 80;
}

function safeText(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_TEXT;
}
