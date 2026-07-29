import { createHash } from "node:crypto";
import {
  parseScenarioManifest,
  ScenarioManifestError,
  type ScenarioManifest,
  type ScenarioOperation,
  type ScenarioOperationCapability,
  type ScenarioSemanticClaim,
} from "./scenario-manifest";
import { SCENARIO_MANIFESTS } from "./scenarios";

const PLAN_ROLES = [
  "evidenceProducer",
  "workloadActor",
  "learner",
  "detector",
  "responder",
  "cleanupOwner",
] as const;
const REQUEST_KEYS = [
  "scenarioId",
  "actorAliases",
  "now",
  "expiresAt",
  "maximumBudgetUsd",
  "selectedResponseId",
] as const;
const RAW_IDENTIFIER_TERMS =
  /(?:onmicrosoft|tenant|subscription|object-?id|message-?id|userprincipal|credential|certificate|access-?token|refresh-?token|session)/i;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_ALIAS = /^[a-z][a-z0-9-]{1,63}$/;
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export type ScenarioPlanRole = typeof PLAN_ROLES[number] | "system";

export type ScenarioPlanErrorCategory =
  | "ACTOR_BINDING_INVALID"
  | "BUDGET_EXCEEDED"
  | "CLEANUP_MISSING"
  | "EXPIRY_INVALID"
  | "INPUT_INVALID"
  | "INTERPRETATION_MISSING"
  | "MANIFEST_INVALID"
  | "RAW_IDENTIFIER_REJECTED"
  | "RESPONSE_NOT_ALLOWED"
  | "RETENTION_CONFLICT"
  | "ROLE_CONFLATION"
  | "SELF_TRIGGER_UNDECLARED"
  | "TERMINAL_PROOF_MISSING"
  | "UNKNOWN_SCENARIO";

export class ScenarioPlanError extends Error {
  readonly category: ScenarioPlanErrorCategory;

  constructor(category: ScenarioPlanErrorCategory) {
    super(category);
    this.category = category;
    this.name = "ScenarioPlanError";
  }
}

export interface ScenarioPlanningRequest {
  scenarioId: string;
  actorAliases: Partial<Record<Exclude<ScenarioPlanRole, "system">, string>>;
  now: string;
  expiresAt: string;
  maximumBudgetUsd: number;
  selectedResponseId?: string;
}

export interface ScenarioPlanStep {
  sequence: number;
  id: string;
  phase:
    | "preflight"
    | "producer-operation"
    | "authentic-evidence"
    | "learner-interpretation"
    | "optional-response"
    | "expiry"
    | "cleanup"
    | "retention"
    | "terminal-verification";
  owningRole: ScenarioPlanRole;
  actorAlias?: string;
  operationCategory:
    | ScenarioOperationCapability
    | `prerequisite.${ScenarioManifest["prerequisites"][number]["kind"]}`
    | "budget.validate"
    | "evidence.expect"
    | "expiry.enforce"
    | "learner.interpret"
    | "retention.inventory"
    | "roles.bind"
    | "terminal.verify";
  operationKey: string;
  execution:
    | "automated"
    | "declarative"
    | "human-only"
    | "pre-seeded-reference";
  humanOnlyGate: boolean;
  ambiguityBehavior:
    | "bounded-read-retry"
    | "fail-closed"
    | "not-applicable"
    | "stop-and-reconcile";
  recoveryBehavior:
    | "none"
    | "read-only-reconcile-no-replay"
    | "retry-within-read-budget"
    | "stop-on-mismatch";
  evidenceExpectation?: {
    artifactId: string;
    artifactKind: ScenarioManifest["evidence"]["artifacts"][number]["kind"];
    authenticity:
      ScenarioManifest["evidence"]["artifacts"][number]["authenticity"];
    evidenceMode: "planned" | "pre-seeded";
    learnerVisibility:
      ScenarioManifest["evidence"]["artifacts"][number]["learnerVisibility"];
    semanticClaims: readonly ScenarioSemanticClaim[];
  };
  retention?: {
    artifactId: string;
    disposition:
      ScenarioManifest["lifecycle"]["retainedArtifacts"][number]["disposition"];
    cleanupOperationKey?: string;
  };
}

export interface ScenarioExecutionPlan {
  schemaVersion: 1;
  kind: "scenario-execution-plan";
  scenarioId: string;
  generatedAt: string;
  expiresAt: string;
  actorAliases: Readonly<
    Partial<Record<Exclude<ScenarioPlanRole, "system">, string>>
  >;
  budget: {
    currency: "USD";
    plannedMaximum: number;
    suppliedCeiling: number;
  };
  selectedResponseId: string | null;
  steps: readonly ScenarioPlanStep[];
  terminalProof: {
    cleanupOperationKeys: readonly string[];
    evidenceArtifactIds: readonly string[];
    observationOperationKeys: readonly string[];
    retainedArtifactIds: readonly string[];
    requiredResult: "reconciled";
  };
  digestSha256: string;
}

export function compileScenarioExecutionPlan(
  value: unknown,
  catalog: readonly unknown[] = SCENARIO_MANIFESTS,
): ScenarioExecutionPlan {
  const request = parseScenarioPlanningRequest(value);
  const manifests = catalog.map(validatedManifest);
  if (new Set(manifests.map(({ id }) => id)).size !== manifests.length) {
    throw new ScenarioPlanError("MANIFEST_INVALID");
  }
  const manifest = manifests.find(({ id }) => id === request.scenarioId);
  if (manifest === undefined) {
    throw new ScenarioPlanError("UNKNOWN_SCENARIO");
  }

  const roleActors = assignedRoleActors(manifest);
  const actorAliases = validatedActorAliases(
    request.actorAliases,
    roleActors,
  );
  validateWindowAndBudget(request, manifest);
  validatePlanCompleteness(manifest);

  const selectedResponse = request.selectedResponseId === undefined
    ? undefined
    : manifest.responseActions.find((action) =>
      action.id === request.selectedResponseId
    );
  if (
    request.selectedResponseId !== undefined &&
    selectedResponse === undefined
  ) {
    throw new ScenarioPlanError("RESPONSE_NOT_ALLOWED");
  }

  const operationByKey = new Map(
    manifest.operations.map((operation) => [operation.key, operation]),
  );
  const preSeededArtifacts = manifest.evidence.artifacts.filter(
    ({ state }) => state === "observed" || state === "learner-completed",
  );
  const producerArtifacts = manifest.evidence.artifacts.filter(
    ({ kind }) => kind !== "cleanup-state",
  );
  const allProducerEvidencePreSeeded =
    producerArtifacts.length > 0 &&
    producerArtifacts.every(({ state }) =>
      state === "observed" || state === "learner-completed"
    );
  const preSeededSourceOperationKeys = new Set(
    preSeededArtifacts.map(({ sourceOperationKey }) => sourceOperationKey),
  );
  const cleanupObservationOperationKeys = new Set(
    manifest.evidence.artifacts.flatMap((artifact) =>
      artifact.kind === "cleanup-state"
        ? [artifact.sourceOperationKey]
        : []
    ),
  );
  const cleanupAlreadyObserved = allProducerEvidencePreSeeded &&
    manifest.evidence.artifacts.some(
      (artifact) =>
        artifact.kind === "cleanup-state" &&
        (artifact.state === "observed" ||
          artifact.state === "learner-completed"),
    );
  const steps: ScenarioPlanStep[] = [];
  const push = (
    step: Omit<ScenarioPlanStep, "sequence" | "id">,
  ): void => {
    const sequence = steps.length + 1;
    steps.push({
      sequence,
      id: `step-${String(sequence).padStart(3, "0")}`,
      ...step,
    });
  };

  push(metaStep("preflight", "roles.bind", "actor-bindings"));
  for (const prerequisite of manifest.prerequisites) {
    push({
      ...metaStep(
        "preflight",
        `prerequisite.${prerequisite.kind}`,
        prerequisite.id,
      ),
    });
  }
  push(metaStep("preflight", "budget.validate", "budget-ceiling"));

  for (const operation of manifest.operations) {
    if (operation.phase !== "setup" && operation.phase !== "evidence") {
      continue;
    }
    if (cleanupObservationOperationKeys.has(operation.key)) {
      continue;
    }
    const preSeededReference = operation.effect === "mutation" &&
      (
        allProducerEvidencePreSeeded ||
        preSeededSourceOperationKeys.has(operation.key)
      );
    push(operationStep(
      "producer-operation",
      operation,
      manifest,
      roleActors,
      actorAliases,
      preSeededReference,
    ));
  }

  for (const artifact of manifest.evidence.artifacts) {
    push({
      phase: "authentic-evidence",
      owningRole: "learner",
      actorAlias: actorAliases.learner,
      operationCategory: "evidence.expect",
      operationKey: artifact.id,
      execution: "declarative",
      humanOnlyGate: false,
      ambiguityBehavior: "fail-closed",
      recoveryBehavior: "stop-on-mismatch",
      evidenceExpectation: {
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        authenticity: artifact.authenticity,
        evidenceMode:
          artifact.state === "planned" || artifact.state === "platform-accepted"
            ? "planned"
            : "pre-seeded",
        learnerVisibility: artifact.learnerVisibility,
        semanticClaims: [...artifact.semanticClaims].sort(),
      },
    });
  }

  push({
    phase: "learner-interpretation",
    owningRole: "learner",
    actorAlias: actorAliases.learner,
    operationCategory: "learner.interpret",
    operationKey: "learner-contract",
    execution: "human-only",
    humanOnlyGate: true,
    ambiguityBehavior: "fail-closed",
    recoveryBehavior: "stop-on-mismatch",
  });

  if (selectedResponse) {
    const responseOperation = operationByKey.get(
      selectedResponse.operationKey,
    );
    if (!responseOperation) {
      throw new ScenarioPlanError("RESPONSE_NOT_ALLOWED");
    }
    push(operationStep(
      "optional-response",
      responseOperation,
      manifest,
      roleActors,
      actorAliases,
    ));
  }

  push({
    ...metaStep("expiry", "expiry.enforce", "expiry-window"),
    recoveryBehavior: "stop-on-mismatch",
  });

  for (const operationKey of manifest.lifecycle.cleanupOperationKeys) {
    const cleanupOperation = operationByKey.get(operationKey);
    if (!cleanupOperation) {
      throw new ScenarioPlanError("CLEANUP_MISSING");
    }
    push(operationStep(
      "cleanup",
      cleanupOperation,
      manifest,
      roleActors,
      actorAliases,
      cleanupAlreadyObserved && cleanupOperation.effect === "mutation",
    ));
  }

  for (const operationKey of cleanupObservationOperationKeys) {
    const observationOperation = operationByKey.get(operationKey);
    if (!observationOperation) {
      throw new ScenarioPlanError("TERMINAL_PROOF_MISSING");
    }
    push(operationStep(
      "cleanup",
      observationOperation,
      manifest,
      roleActors,
      actorAliases,
    ));
  }

  for (const retained of manifest.lifecycle.retainedArtifacts) {
    const owningRole = roleForActor(
      retained.custodianActorId,
      "retention",
      manifest,
      roleActors,
    );
    push({
      phase: "retention",
      owningRole,
      actorAlias: aliasFor(actorAliases, owningRole),
      operationCategory: "retention.inventory",
      operationKey: retained.artifactId,
      execution: "declarative",
      humanOnlyGate: false,
      ambiguityBehavior: "fail-closed",
      recoveryBehavior: "stop-on-mismatch",
      retention: {
        artifactId: retained.artifactId,
        disposition: retained.disposition,
        ...(retained.cleanupOperationKey === undefined
          ? {}
          : { cleanupOperationKey: retained.cleanupOperationKey }),
      },
    });
  }

  push(metaStep(
    "terminal-verification",
    "terminal.verify",
    "terminal-proof",
  ));

  const observationOperationKeys = manifest.evidence.artifacts
    .flatMap((artifact) =>
      artifact.observation ? [artifact.observation.operationKey] : []
    );
  const terminalProof = {
    cleanupOperationKeys: [...manifest.lifecycle.cleanupOperationKeys],
    evidenceArtifactIds: manifest.evidence.artifacts.map(({ id }) => id),
    observationOperationKeys,
    retainedArtifactIds: manifest.lifecycle.retainedArtifacts.map(
      ({ artifactId }) => artifactId,
    ),
    requiredResult: "reconciled" as const,
  };
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "scenario-execution-plan" as const,
    scenarioId: manifest.id,
    generatedAt: request.now,
    expiresAt: request.expiresAt,
    actorAliases,
    budget: {
      currency: "USD" as const,
      plannedMaximum: manifest.cost.laneMaximum,
      suppliedCeiling: request.maximumBudgetUsd,
    },
    selectedResponseId: selectedResponse?.id ?? null,
    steps,
    terminalProof,
  };
  return {
    ...unsigned,
    digestSha256: createHash("sha256")
      .update(canonicalJson(unsigned))
      .digest("hex"),
  };
}

export function parseScenarioPlanningRequest(
  value: unknown,
): ScenarioPlanningRequest {
  if (!isRecord(value)) {
    throw new ScenarioPlanError("INPUT_INVALID");
  }
  exactKeys(value, REQUEST_KEYS);
  const scenarioId = safeId(value.scenarioId);
  const actorAliases = parseAliases(value.actorAliases);
  const now = utc(value.now);
  const expiresAt = utc(value.expiresAt);
  const maximumBudgetUsd = value.maximumBudgetUsd;
  if (
    typeof maximumBudgetUsd !== "number" ||
    !Number.isFinite(maximumBudgetUsd) ||
    maximumBudgetUsd < 0 ||
    maximumBudgetUsd > 1_000_000
  ) {
    throw new ScenarioPlanError("INPUT_INVALID");
  }
  const selectedResponseId = value.selectedResponseId === undefined
    ? undefined
    : safeId(value.selectedResponseId);
  return {
    scenarioId,
    actorAliases,
    now,
    expiresAt,
    maximumBudgetUsd,
    ...(selectedResponseId === undefined ? {} : { selectedResponseId }),
  };
}

function parseAliases(
  value: unknown,
): ScenarioPlanningRequest["actorAliases"] {
  if (!isRecord(value)) {
    throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
  }
  const allowed = new Set<string>(PLAN_ROLES);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
    }
  }
  const aliases: ScenarioPlanningRequest["actorAliases"] = {};
  for (const role of PLAN_ROLES) {
    if (value[role] !== undefined) {
      aliases[role] = safeAlias(value[role]);
    }
  }
  return aliases;
}

function validatedManifest(value: unknown): ScenarioManifest {
  try {
    return parseScenarioManifest(value);
  } catch (error) {
    if (!(error instanceof ScenarioManifestError)) {
      throw error;
    }
    const message = error.message;
    if (/producer and learner|self-triggered/.test(message)) {
      throw new ScenarioPlanError("SELF_TRIGGER_UNDECLARED");
    }
    if (/detector and (?:workload actor|learner)/.test(message)) {
      throw new ScenarioPlanError("ROLE_CONFLATION");
    }
    if (/cleanup|expiresAt|expiry/.test(message)) {
      throw new ScenarioPlanError(
        /cleanup/.test(message) ? "CLEANUP_MISSING" : "EXPIRY_INVALID",
      );
    }
    if (/retained|retention|disposition/.test(message)) {
      throw new ScenarioPlanError("RETENTION_CONFLICT");
    }
    if (/expectedInterpretation|learner\.task/.test(message)) {
      throw new ScenarioPlanError("INTERPRETATION_MISSING");
    }
    if (/evidence\.artifacts|semanticClaims/.test(message)) {
      throw new ScenarioPlanError("TERMINAL_PROOF_MISSING");
    }
    throw new ScenarioPlanError("MANIFEST_INVALID");
  }
}

function assignedRoleActors(
  manifest: ScenarioManifest,
): Record<Exclude<ScenarioPlanRole, "system">, string | undefined> {
  return {
    evidenceProducer: manifest.roles.evidenceProducer,
    workloadActor: manifest.roles.workloadActor,
    learner: manifest.roles.learner,
    detector: manifest.roles.detector,
    responder: manifest.roles.responder,
    cleanupOwner: manifest.lifecycle.cleanupOwnerActorId,
  };
}

function validatedActorAliases(
  aliases: ScenarioPlanningRequest["actorAliases"],
  roleActors: ReturnType<typeof assignedRoleActors>,
): ScenarioExecutionPlan["actorAliases"] {
  const actorAlias = new Map<string, string>();
  const aliasActor = new Map<string, string>();
  const output: ScenarioPlanningRequest["actorAliases"] = {};
  for (const role of PLAN_ROLES) {
    const actorId = roleActors[role];
    const alias = aliases[role];
    if (actorId === undefined) {
      if (alias !== undefined) {
        throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
      }
      continue;
    }
    if (alias === undefined) {
      throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
    }
    const previousAlias = actorAlias.get(actorId);
    if (previousAlias !== undefined && previousAlias !== alias) {
      throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
    }
    const previousActor = aliasActor.get(alias);
    if (previousActor !== undefined && previousActor !== actorId) {
      throw new ScenarioPlanError("ROLE_CONFLATION");
    }
    actorAlias.set(actorId, alias);
    aliasActor.set(alias, actorId);
    output[role] = alias;
  }
  return output;
}

function validateWindowAndBudget(
  request: ScenarioPlanningRequest,
  manifest: ScenarioManifest,
): void {
  const now = Date.parse(request.now);
  const expiry = Date.parse(request.expiresAt);
  const manifestExpiry = Date.parse(manifest.lifecycle.expiresAt);
  const durationHours = (expiry - now) / 3_600_000;
  if (
    expiry <= now ||
    expiry > manifestExpiry ||
    durationHours > manifest.cost.conservativeDurationHours
  ) {
    throw new ScenarioPlanError("EXPIRY_INVALID");
  }
  if (manifest.cost.laneMaximum > request.maximumBudgetUsd) {
    throw new ScenarioPlanError("BUDGET_EXCEEDED");
  }
}

function validatePlanCompleteness(manifest: ScenarioManifest): void {
  if (
    manifest.evidence.artifacts.length === 0 ||
    manifest.learner.evidenceArtifactIds.length === 0
  ) {
    throw new ScenarioPlanError("TERMINAL_PROOF_MISSING");
  }
  if (
    manifest.learner.task.trim() === "" ||
    manifest.learner.expectedInterpretation.trim() === ""
  ) {
    throw new ScenarioPlanError("INTERPRETATION_MISSING");
  }
  if (manifest.lifecycle.cleanupOperationKeys.length === 0) {
    throw new ScenarioPlanError("CLEANUP_MISSING");
  }
  const cleanupKeys = new Set(manifest.lifecycle.cleanupOperationKeys);
  for (const retained of manifest.lifecycle.retainedArtifacts) {
    if (
      retained.disposition === "cleanup-later" &&
      (
        retained.cleanupOperationKey === undefined ||
        !cleanupKeys.has(retained.cleanupOperationKey)
      )
    ) {
      throw new ScenarioPlanError("RETENTION_CONFLICT");
    }
    if (
      retained.disposition !== "cleanup-later" &&
      retained.cleanupOperationKey !== undefined
    ) {
      throw new ScenarioPlanError("RETENTION_CONFLICT");
    }
  }
  if (
    manifest.evidence.artifacts.some((artifact) =>
      (artifact.state === "observed" ||
        artifact.state === "learner-completed") &&
      artifact.observation === undefined
    )
  ) {
    throw new ScenarioPlanError("TERMINAL_PROOF_MISSING");
  }
  if (
    manifest.evidence.artifacts.some((artifact) =>
      artifact.kind === "cleanup-state" &&
      artifact.observation !== undefined &&
      artifact.observation.operationKey !== artifact.sourceOperationKey
    )
  ) {
    throw new ScenarioPlanError("TERMINAL_PROOF_MISSING");
  }
}

function operationStep(
  phase: ScenarioPlanStep["phase"],
  operation: ScenarioOperation,
  manifest: ScenarioManifest,
  roleActors: ReturnType<typeof assignedRoleActors>,
  aliases: ScenarioExecutionPlan["actorAliases"],
  preSeededReference = false,
): Omit<ScenarioPlanStep, "sequence" | "id"> {
  const owningRole = roleForActor(
    operation.ownerActorId,
    phase,
    manifest,
    roleActors,
  );
  const humanOnly = operation.capability === "teams.audio-call.manual" ||
    operation.capability === "learner.inspect";
  return {
    phase,
    owningRole,
    actorAlias: aliasFor(aliases, owningRole),
    operationCategory: operation.capability,
    operationKey: operation.key,
    execution: preSeededReference
      ? "pre-seeded-reference"
      : humanOnly
      ? "human-only"
      : "automated",
    humanOnlyGate: !preSeededReference && humanOnly,
    ambiguityBehavior: preSeededReference
      ? "not-applicable"
      : operation.effect === "mutation"
      ? "stop-and-reconcile"
      : "bounded-read-retry",
    recoveryBehavior: preSeededReference
      ? "none"
      : operation.effect === "mutation"
      ? "read-only-reconcile-no-replay"
      : "retry-within-read-budget",
  };
}

function roleForActor(
  actorId: string,
  phase: ScenarioPlanStep["phase"],
  manifest: ScenarioManifest,
  roleActors: ReturnType<typeof assignedRoleActors>,
): Exclude<ScenarioPlanRole, "system"> {
  if (phase === "cleanup" && actorId === roleActors.cleanupOwner) {
    return "cleanupOwner";
  }
  if (phase === "retention" && actorId === roleActors.cleanupOwner) {
    return "cleanupOwner";
  }
  if (phase === "optional-response") {
    if (actorId === roleActors.responder) {
      return "responder";
    }
    if (actorId === roleActors.learner) {
      return "learner";
    }
  }
  if (actorId === roleActors.workloadActor) {
    return "workloadActor";
  }
  if (actorId === roleActors.detector) {
    return "detector";
  }
  if (actorId === roleActors.evidenceProducer) {
    return "evidenceProducer";
  }
  if (actorId === roleActors.learner) {
    return "learner";
  }
  if (actorId === roleActors.responder) {
    return "responder";
  }
  if (actorId === manifest.lifecycle.cleanupOwnerActorId) {
    return "cleanupOwner";
  }
  throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
}

function aliasFor(
  aliases: ScenarioExecutionPlan["actorAliases"],
  role: Exclude<ScenarioPlanRole, "system">,
): string {
  const alias = aliases[role];
  if (!alias) {
    throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
  }
  return alias;
}

function metaStep(
  phase: ScenarioPlanStep["phase"],
  operationCategory: ScenarioPlanStep["operationCategory"],
  operationKey: string,
): Omit<ScenarioPlanStep, "sequence" | "id"> {
  return {
    phase,
    owningRole: "system",
    operationCategory,
    operationKey,
    execution: "declarative",
    humanOnlyGate: false,
    ambiguityBehavior: "not-applicable",
    recoveryBehavior: "none",
  };
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const allowed = new Set(expected);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ScenarioPlanError("INPUT_INVALID");
  }
}

function safeId(value: unknown): string {
  if (typeof value === "string" && looksRaw(value)) {
    throw new ScenarioPlanError("RAW_IDENTIFIER_REJECTED");
  }
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new ScenarioPlanError("INPUT_INVALID");
  }
  return value;
}

function safeAlias(value: unknown): string {
  if (typeof value === "string" && looksRaw(value)) {
    throw new ScenarioPlanError("RAW_IDENTIFIER_REJECTED");
  }
  if (typeof value !== "string" || !SAFE_ALIAS.test(value)) {
    throw new ScenarioPlanError("ACTOR_BINDING_INVALID");
  }
  return value;
}

function looksRaw(value: string): boolean {
  return value.includes("@") ||
    value.includes("/") ||
    value.includes("\\") ||
    UUID.test(value) ||
    RAW_IDENTIFIER_TERMS.test(value);
}

function utc(value: unknown): string {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new ScenarioPlanError("INPUT_INVALID");
  }
  const canonical = value.includes(".")
    ? value
    : value.replace(/Z$/, ".000Z");
  if (new Date(value).toISOString() !== canonical) {
    throw new ScenarioPlanError("INPUT_INVALID");
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
