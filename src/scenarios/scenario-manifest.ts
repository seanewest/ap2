import { appendIdentity, createStatus } from "../ui/elements.ts";

const ACTOR_KINDS = [
  "application",
  "device",
  "human",
  "lab-harness",
  "orchestrator",
  "simulated-user",
] as const;
const AUTHENTICATION_TRANSPORTS = [
  "application-only",
  "delegated-user",
  "managed-identity",
  "operator-session",
  "teams-client",
] as const;
const PREREQUISITE_KINDS = [
  "evidence",
  "identity",
  "license",
  "network",
  "permission",
  "policy",
  "resource",
] as const;
const OPERATION_PHASES = [
  "setup",
  "evidence",
  "response",
  "cleanup",
] as const;
const OPERATION_EFFECTS = ["read", "mutation"] as const;
const OPERATION_CAPABILITIES = [
  "artifact.read-exact",
  "azure.resource-group.delete",
  "azure.three-vm.deploy",
  "evidence-window.close",
  "endpoint.offboard",
  "endpoint.onboard",
  "expiry.remove",
  "expiry.schedule",
  "help-desk-email.send",
  "identity.verify",
  "learner.inspect",
  "mail.delete-exact",
  "permission.grant",
  "permission.revoke",
  "purview.audit-query",
  "private-document.file-create",
  "private-document.file-delete",
  "private-document.folder-create",
  "private-document.folder-delete",
  "private-document.permission-create",
  "private-document.permission-delete",
  "sensitive-artifacts.prepare",
  "sensitive-artifacts.remove",
  "teams.audio-call.manual",
  "teams.call-history.read",
  "teams.history.cleanup",
] as const;
const RESOURCE_KINDS = [
  "azure-resource-group",
  "avd-personal-host",
  "endpoint-lifecycle",
  "ephemeral-sensitive-artifacts",
  "expiry-schedule",
  "linux-auxiliary-pair",
  "shared-nat-egress",
] as const;
const PERMISSION_KINDS = [
  "azure-role",
  "delegated-scope",
  "graph-app-role",
  "teams-policy",
] as const;
const ARTIFACT_KINDS = [
  "avd-topology",
  "cleanup-state",
  "endpoint-posture",
  "outlook-email",
  "private-document",
  "application-recon-summary",
  "purview-audit-summary",
  "private-network-topology",
  "teams-missed-call",
] as const;
const ARTIFACT_AUTHENTICITY = [
  "application-narrative",
  "platform-control-plane",
  "platform-native",
] as const;
const ARTIFACT_STATES = [
  "planned",
  "platform-accepted",
  "observed",
  "learner-completed",
] as const;
const LEARNER_VISIBILITY = ["not-proven", "observed"] as const;
const ARTIFACT_RETENTION = ["ephemeral", "retained"] as const;
const SEMANTIC_CLAIMS = [
  "avd-ready",
  "application-reconnaissance",
  "endpoint-managed",
  "endpoint-state-removed",
  "expiry-removed",
  "infrastructure-removed",
  "outlook-email",
  "private-three-vm-topology",
  "purview-surface-reachability",
  "permissions-revoked",
  "private-document-staged",
  "teams-missed-call",
  "teams-voicemail",
  "sensitive-artifacts-absent",
] as const;
const LEARNER_COMPLETION_STATES = [
  "not-run",
  "available",
  "completed",
] as const;
const RESPONSE_KINDS = [
  "investigate",
  "observe",
  "remediate",
  "report",
] as const;
const RETAINED_DISPOSITIONS = [
  "cleanup-later",
  "expire-automatically",
  "retain-audit-history",
] as const;

const MAX_ACTORS = 32;
const MAX_ITEMS = 64;
const MAX_TEXT = 2_000;

export type ScenarioActorKind = typeof ACTOR_KINDS[number];
export type ScenarioAuthenticationTransport =
  typeof AUTHENTICATION_TRANSPORTS[number];
export type ScenarioOperationPhase = typeof OPERATION_PHASES[number];
export type ScenarioOperationCapability =
  typeof OPERATION_CAPABILITIES[number];
export type ScenarioArtifactKind = typeof ARTIFACT_KINDS[number];
export type ScenarioSemanticClaim = typeof SEMANTIC_CLAIMS[number];

export interface ScenarioActor {
  id: string;
  label: string;
  kind: ScenarioActorKind;
  summary: string;
}

export interface ScenarioRoleAssignments {
  evidenceProducer: string;
  workloadActor: string;
  learner: string;
  detector?: string;
  responder?: string;
}

export type ScenarioRoleConflation =
  | "evidence-producer-learner"
  | "detector-workload-actor"
  | "detector-learner";

export function findScenarioRoleConflation(
  roles: ScenarioRoleAssignments,
  options: { allowSelfTriggeredLearner?: boolean } = {},
): ScenarioRoleConflation | undefined {
  if (
    roles.evidenceProducer === roles.learner &&
    options.allowSelfTriggeredLearner !== true
  ) {
    return "evidence-producer-learner";
  }
  if (
    roles.detector !== undefined &&
    roles.detector === roles.workloadActor
  ) {
    return "detector-workload-actor";
  }
  if (
    roles.detector !== undefined &&
    roles.detector === roles.learner
  ) {
    return "detector-learner";
  }
  return undefined;
}

export interface ScenarioAuthentication {
  actorId: string;
  transport: ScenarioAuthenticationTransport;
  summary: string;
}

export interface ScenarioApplicationPermissionRequirement {
  resourceApplicationId: string;
  applicationRoleId: string;
  name: string;
}

export interface ScenarioApplicationIdentityBoundary {
  producerActorId: string;
  detectorActorId: string;
  recoveryOwnerActorId: string;
  tenantBinding: "same-tenant";
  tokenAudience: string;
  producerPermissions: readonly ScenarioApplicationPermissionRequirement[];
  detectorPermissions: readonly ScenarioApplicationPermissionRequirement[];
  markerOperationKey: string;
  observationOperationKey: string;
  maximumObservationWindowMinutes: number;
  attribution:
    "exact-application-service-principal-marker-window";
}

export type ScenarioTrigger =
  | { kind: "staged" }
  | { kind: "self-triggered"; rationale: string };

export type ScenarioDetection =
  | { kind: "none" }
  | { kind: "independent" };

export interface ScenarioPrerequisite {
  id: string;
  kind: typeof PREREQUISITE_KINDS[number];
  summary: string;
  requiredState: string;
}

export interface ScenarioOperation {
  key: string;
  phase: ScenarioOperationPhase;
  capability: ScenarioOperationCapability;
  effect: typeof OPERATION_EFFECTS[number];
  ownerActorId: string;
  summary: string;
  marker?: string;
  dependsOnOperationKeys?: readonly string[];
}

export interface ScenarioResource {
  id: string;
  kind: typeof RESOURCE_KINDS[number];
  summary: string;
  ownerActorId: string;
  createOperationKey: string;
  cleanupOperationKey: string;
  billable: boolean;
  expiresAt?: string;
}

interface ScenarioPermissionBase {
  id: string;
  kind: typeof PERMISSION_KINDS[number];
  name: string;
  actorId: string;
  scope: string;
  purpose: string;
}

export type ScenarioPermission =
  | ScenarioPermissionBase & {
      mode: "temporary";
      grantOperationKey: string;
      revocationOperationKey: string;
      revocationOwnerActorId: string;
    }
  | ScenarioPermissionBase & {
      mode: "retained";
      retentionRationale: string;
    };

export interface ScenarioEvidenceArtifact {
  id: string;
  kind: ScenarioArtifactKind;
  authenticity: typeof ARTIFACT_AUTHENTICITY[number];
  state: typeof ARTIFACT_STATES[number];
  learnerVisibility: typeof LEARNER_VISIBILITY[number];
  sourceOperationKey: string;
  claim: string;
  semanticClaims: readonly ScenarioSemanticClaim[];
  retention: typeof ARTIFACT_RETENTION[number];
  observation?: {
    operationKey: string;
    proofReference: string;
  };
}

export interface ScenarioLearnerContract {
  task: string;
  expectedInterpretation: string;
  completionState: typeof LEARNER_COMPLETION_STATES[number];
  evidenceArtifactIds: readonly string[];
}

export interface ScenarioResponseAction {
  id: string;
  kind: typeof RESPONSE_KINDS[number];
  ownerActorId: string;
  operationKey: string;
  summary: string;
}

export interface ScenarioRetainedArtifact {
  artifactId: string;
  custodianActorId: string;
  disposition: typeof RETAINED_DISPOSITIONS[number];
  rationale: string;
  cleanupOperationKey?: string;
}

export interface ScenarioManifest {
  schemaVersion: 2;
  id: string;
  title: string;
  summary: string;
  actors: readonly ScenarioActor[];
  roles: ScenarioRoleAssignments;
  authentication: readonly ScenarioAuthentication[];
  applicationIdentityBoundary?: ScenarioApplicationIdentityBoundary;
  trigger: ScenarioTrigger;
  detection?: ScenarioDetection;
  prerequisites: readonly ScenarioPrerequisite[];
  operations: readonly ScenarioOperation[];
  resources: readonly ScenarioResource[];
  permissions: readonly ScenarioPermission[];
  evidence: {
    staging: string;
    learnerReceives: string;
    artifacts: readonly ScenarioEvidenceArtifact[];
  };
  learner: ScenarioLearnerContract;
  responseActions: readonly ScenarioResponseAction[];
  lifecycle: {
    expiresAt: string;
    cleanupOwnerActorId: string;
    cleanupOperationKeys: readonly string[];
    retainedArtifacts: readonly ScenarioRetainedArtifact[];
  };
  cost: {
    currency: "USD";
    laneMaximum: number;
    conservativeDurationHours: number;
    assumption: string;
  };
}

export class ScenarioManifestError extends Error {
  constructor(message: string) {
    super(`Invalid scenario manifest: ${message}`);
    this.name = "ScenarioManifestError";
  }
}

export function parseScenarioManifest(value: unknown): ScenarioManifest {
  const manifest = record(value, "manifest");
  if (manifest.schemaVersion !== 2) {
    throw new ScenarioManifestError("schemaVersion must be 2.");
  }

  const actors = boundedArray(manifest.actors, "actors", 1, MAX_ACTORS)
    .map((actor, index) => parseActor(actor, `actors[${index}]`));
  const actorIds = uniqueIds(actors, "actor");

  const rolesValue = record(manifest.roles, "roles");
  const roles: ScenarioRoleAssignments = {
    evidenceProducer: id(
      rolesValue.evidenceProducer,
      "roles.evidenceProducer",
    ),
    workloadActor: id(rolesValue.workloadActor, "roles.workloadActor"),
    learner: id(rolesValue.learner, "roles.learner"),
    ...(rolesValue.detector === undefined
      ? {}
      : { detector: id(rolesValue.detector, "roles.detector") }),
    ...(rolesValue.responder === undefined
      ? {}
      : { responder: id(rolesValue.responder, "roles.responder") }),
  };
  for (const [role, actorId] of Object.entries(roles)) {
    reference(actorIds, actorId, `roles.${role}`, "actor");
  }

  const trigger = parseTrigger(record(manifest.trigger, "trigger"));
  const selfConflated = roles.evidenceProducer === roles.learner;
  if (selfConflated && trigger.kind !== "self-triggered") {
    throw new ScenarioManifestError(
      "evidence producer and learner must differ unless trigger.kind is self-triggered.",
    );
  }
  if (!selfConflated && trigger.kind === "self-triggered") {
    throw new ScenarioManifestError(
      "self-triggered requires the evidence producer to be the learner.",
    );
  }

  const detection = parseDetection(manifest.detection);
  if (detection.kind === "independent" && !roles.detector) {
    throw new ScenarioManifestError(
      "roles.detector is required when detection.kind is independent.",
    );
  }
  if (detection.kind === "none" && roles.detector) {
    throw new ScenarioManifestError(
      "roles.detector requires detection.kind to be independent.",
    );
  }
  const conflation = findScenarioRoleConflation(roles, {
    allowSelfTriggeredLearner: trigger.kind === "self-triggered",
  });
  if (conflation === "detector-workload-actor") {
    throw new ScenarioManifestError(
      "independent detector and workload actor must differ.",
    );
  }
  if (conflation === "detector-learner") {
    throw new ScenarioManifestError(
      "independent detector and learner must differ.",
    );
  }

  const authentication = boundedArray(
    manifest.authentication,
    "authentication",
    0,
    MAX_ITEMS,
  ).map((item, index) => {
    const path = `authentication[${index}]`;
    const authenticationValue = record(item, path);
    const actorId = id(authenticationValue.actorId, `${path}.actorId`);
    reference(actorIds, actorId, `${path}.actorId`, "actor");
    return {
      actorId,
      transport: enumValue(
        authenticationValue.transport,
        AUTHENTICATION_TRANSPORTS,
        `${path}.transport`,
      ),
      summary: text(authenticationValue.summary, `${path}.summary`),
    };
  });
  const prerequisites = boundedArray(
    manifest.prerequisites,
    "prerequisites",
    1,
    MAX_ITEMS,
  ).map((item, index) => {
    const path = `prerequisites[${index}]`;
    const prerequisite = record(item, path);
    return {
      id: id(prerequisite.id, `${path}.id`),
      kind: enumValue(
        prerequisite.kind,
        PREREQUISITE_KINDS,
        `${path}.kind`,
      ),
      summary: text(prerequisite.summary, `${path}.summary`),
      requiredState: text(
        prerequisite.requiredState,
        `${path}.requiredState`,
      ),
    };
  });
  uniqueIds(prerequisites, "prerequisite");

  const operations = boundedArray(
    manifest.operations,
    "operations",
    1,
    MAX_ITEMS,
  ).map((item, index) => {
    const path = `operations[${index}]`;
    const operation = record(item, path);
    const ownerActorId = id(
      operation.ownerActorId,
      `${path}.ownerActorId`,
    );
    reference(actorIds, ownerActorId, `${path}.ownerActorId`, "actor");
    const effect = enumValue(
      operation.effect,
      OPERATION_EFFECTS,
      `${path}.effect`,
    );
    const marker = operation.marker === undefined
      ? undefined
      : text(operation.marker, `${path}.marker`);
    const dependsOnOperationKeys = operation.dependsOnOperationKeys ===
        undefined
      ? undefined
      : boundedArray(
        operation.dependsOnOperationKeys,
        `${path}.dependsOnOperationKeys`,
        1,
        MAX_ITEMS,
      ).map((value, dependencyIndex) =>
        id(
          value,
          `${path}.dependsOnOperationKeys[${dependencyIndex}]`,
        )
      );
    if (dependsOnOperationKeys !== undefined) {
      uniqueStrings(
        dependsOnOperationKeys,
        `${path}.dependsOnOperationKeys`,
      );
    }
    if (effect === "mutation" && marker === undefined) {
      throw new ScenarioManifestError(
        `${path}.marker is required for a mutating operation.`,
      );
    }
    return {
      key: id(operation.key, `${path}.key`),
      phase: enumValue(
        operation.phase,
        OPERATION_PHASES,
        `${path}.phase`,
      ),
      capability: enumValue(
        operation.capability,
        OPERATION_CAPABILITIES,
        `${path}.capability`,
      ),
      effect,
      ownerActorId,
      summary: text(operation.summary, `${path}.summary`),
      ...(marker === undefined ? {} : { marker }),
      ...(dependsOnOperationKeys === undefined
        ? {}
        : { dependsOnOperationKeys }),
    };
  });
  uniqueIds(
    operations.map((operation) => ({ id: operation.key })),
    "operation key",
  );
  const operationByKey = new Map(
    operations.map((operation) => [operation.key, operation]),
  );
  validateOperationDependencies(operations, operationByKey);
  const applicationIdentityBoundary =
    manifest.applicationIdentityBoundary === undefined
      ? undefined
      : parseApplicationIdentityBoundary(
        manifest.applicationIdentityBoundary,
        roles,
        actorIds,
        operationByKey,
      );

  const resources = boundedArray(
    manifest.resources,
    "resources",
    0,
    MAX_ITEMS,
  ).map((item, index) => {
    const path = `resources[${index}]`;
    const resource = record(item, path);
    const ownerActorId = id(resource.ownerActorId, `${path}.ownerActorId`);
    reference(actorIds, ownerActorId, `${path}.ownerActorId`, "actor");
    const createOperationKey = id(
      resource.createOperationKey,
      `${path}.createOperationKey`,
    );
    const cleanupOperationKey = id(
      resource.cleanupOperationKey,
      `${path}.cleanupOperationKey`,
    );
    const createOperation = requireOperation(
      operationByKey,
      createOperationKey,
      `${path}.createOperationKey`,
      "setup",
      "mutation",
    );
    const cleanupOperation = requireOperation(
      operationByKey,
      cleanupOperationKey,
      `${path}.cleanupOperationKey`,
      "cleanup",
      "mutation",
    );
    if (
      createOperation.ownerActorId !== ownerActorId ||
      cleanupOperation.ownerActorId !== ownerActorId
    ) {
      throw new ScenarioManifestError(
        `${path} owner must own its create and cleanup operations.`,
      );
    }
    if (createOperation.marker !== cleanupOperation.marker) {
      throw new ScenarioManifestError(
        `${path} create and cleanup operations must use the same marker.`,
      );
    }
    const billable = boolean(resource.billable, `${path}.billable`);
    const expiresAt = resource.expiresAt === undefined
      ? undefined
      : timestamp(resource.expiresAt, `${path}.expiresAt`);
    if (billable && expiresAt === undefined) {
      throw new ScenarioManifestError(
        `${path}.expiresAt is required for a billable resource.`,
      );
    }
    return {
      id: id(resource.id, `${path}.id`),
      kind: enumValue(resource.kind, RESOURCE_KINDS, `${path}.kind`),
      summary: text(resource.summary, `${path}.summary`),
      ownerActorId,
      createOperationKey,
      cleanupOperationKey,
      billable,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
  });
  uniqueIds(resources, "resource");

  const permissions = boundedArray(
    manifest.permissions,
    "permissions",
    0,
    MAX_ITEMS,
  ).map((item, index) =>
    parsePermission(
      item,
      `permissions[${index}]`,
      actorIds,
      operationByKey,
    )
  );
  uniqueIds(permissions, "permission");
  if (applicationIdentityBoundary !== undefined) {
    validateApplicationIdentityPermissionDeclarations(
      applicationIdentityBoundary,
      permissions,
    );
  }

  const evidenceValue = record(manifest.evidence, "evidence");
  const artifacts = boundedArray(
    evidenceValue.artifacts,
    "evidence.artifacts",
    1,
    MAX_ITEMS,
  ).map((item, index) =>
    parseArtifact(
      item,
      `evidence.artifacts[${index}]`,
      operationByKey,
    )
  );
  const artifactIds = uniqueIds(artifacts, "evidence artifact");
  const artifactById = new Map(
    artifacts.map((artifact) => [artifact.id, artifact]),
  );

  const learnerValue = record(manifest.learner, "learner");
  const learnerEvidenceIds = boundedArray(
    learnerValue.evidenceArtifactIds,
    "learner.evidenceArtifactIds",
    1,
    MAX_ITEMS,
  ).map((value, index) =>
    id(value, `learner.evidenceArtifactIds[${index}]`)
  );
  uniqueStrings(learnerEvidenceIds, "learner.evidenceArtifactIds");
  for (const [index, artifactId] of learnerEvidenceIds.entries()) {
    reference(
      artifactIds,
      artifactId,
      `learner.evidenceArtifactIds[${index}]`,
      "evidence artifact",
    );
  }
  const completionState = enumValue(
    learnerValue.completionState,
    LEARNER_COMPLETION_STATES,
    "learner.completionState",
  );
  validateLearnerEvidence(
    completionState,
    learnerEvidenceIds,
    artifactById,
  );
  const learner = {
    task: text(learnerValue.task, "learner.task"),
    expectedInterpretation: text(
      learnerValue.expectedInterpretation,
      "learner.expectedInterpretation",
    ),
    completionState,
    evidenceArtifactIds: learnerEvidenceIds,
  };

  const responseActions = boundedArray(
    manifest.responseActions,
    "responseActions",
    0,
    MAX_ITEMS,
  ).map((item, index) => {
    const path = `responseActions[${index}]`;
    const action = record(item, path);
    const ownerActorId = id(action.ownerActorId, `${path}.ownerActorId`);
    reference(actorIds, ownerActorId, `${path}.ownerActorId`, "actor");
    if (
      ownerActorId !== roles.learner &&
      ownerActorId !== roles.responder
    ) {
      throw new ScenarioManifestError(
        `${path}.ownerActorId must be the learner or assigned responder.`,
      );
    }
    const operationKey = id(action.operationKey, `${path}.operationKey`);
    const operation = requireOperation(
      operationByKey,
      operationKey,
      `${path}.operationKey`,
      "response",
    );
    if (operation.ownerActorId !== ownerActorId) {
      throw new ScenarioManifestError(
        `${path}.ownerActorId must own its response operation.`,
      );
    }
    return {
      id: id(action.id, `${path}.id`),
      kind: enumValue(action.kind, RESPONSE_KINDS, `${path}.kind`),
      ownerActorId,
      operationKey,
      summary: text(action.summary, `${path}.summary`),
    };
  });
  uniqueIds(responseActions, "response action");

  const lifecycleValue = record(manifest.lifecycle, "lifecycle");
  const cleanupOwnerActorId = id(
    lifecycleValue.cleanupOwnerActorId,
    "lifecycle.cleanupOwnerActorId",
  );
  reference(
    actorIds,
    cleanupOwnerActorId,
    "lifecycle.cleanupOwnerActorId",
    "actor",
  );
  const cleanupOperationKeys = boundedArray(
    lifecycleValue.cleanupOperationKeys,
    "lifecycle.cleanupOperationKeys",
    1,
    MAX_ITEMS,
  ).map((value, index) =>
    id(value, `lifecycle.cleanupOperationKeys[${index}]`)
  );
  uniqueStrings(
    cleanupOperationKeys,
    "lifecycle.cleanupOperationKeys",
  );
  const cleanupOperationKeySet = new Set(cleanupOperationKeys);
  for (const [index, operationKey] of cleanupOperationKeys.entries()) {
    const operation = requireOperation(
      operationByKey,
      operationKey,
      `lifecycle.cleanupOperationKeys[${index}]`,
      "cleanup",
      "mutation",
    );
    if (!operation.marker) {
      throw new ScenarioManifestError(
        `lifecycle cleanup operation '${operationKey}' must have a marker.`,
      );
    }
    if (operation.ownerActorId !== cleanupOwnerActorId) {
      throw new ScenarioManifestError(
        `lifecycle cleanup operation '${operationKey}' must be owned by lifecycle.cleanupOwnerActorId.`,
      );
    }
  }
  for (const operation of operations) {
    if (
      operation.phase === "cleanup" &&
      !cleanupOperationKeySet.has(operation.key)
    ) {
      throw new ScenarioManifestError(
        `cleanup operation '${operation.key}' must be declared in lifecycle.cleanupOperationKeys.`,
      );
    }
  }

  const retainedArtifacts = boundedArray(
    lifecycleValue.retainedArtifacts,
    "lifecycle.retainedArtifacts",
    0,
    MAX_ITEMS,
  ).map((item, index) =>
    parseRetainedArtifact(
      item,
      `lifecycle.retainedArtifacts[${index}]`,
      actorIds,
      artifactById,
      operationByKey,
    )
  );
  uniqueStrings(
    retainedArtifacts.map((artifact) => artifact.artifactId),
    "lifecycle.retainedArtifacts artifactId",
  );
  validateRetainedArtifacts(artifacts, retainedArtifacts);

  const costValue = record(manifest.cost, "cost");
  if (costValue.currency !== "USD") {
    throw new ScenarioManifestError("cost.currency must be USD.");
  }
  const laneMaximum = nonNegativeNumber(
    costValue.laneMaximum,
    "cost.laneMaximum",
  );
  const conservativeDurationHours = positiveNumber(
    costValue.conservativeDurationHours,
    "cost.conservativeDurationHours",
  );
  const lifecycleExpiresAt = timestamp(
    lifecycleValue.expiresAt,
    "lifecycle.expiresAt",
  );
  if (
    resources.some((resource) =>
      resource.expiresAt !== undefined &&
      Date.parse(resource.expiresAt) > Date.parse(lifecycleExpiresAt)
    )
  ) {
    throw new ScenarioManifestError(
      "billable resource expiry must not exceed lifecycle.expiresAt.",
    );
  }
  if (resources.some((resource) => resource.billable) && laneMaximum === 0) {
    throw new ScenarioManifestError(
      "cost.laneMaximum must be greater than zero when resources are billable.",
    );
  }
  validateLifecycleMarker(operations);
  validateBillableExpiryContract(
    resources,
    operationByKey,
    lifecycleExpiresAt,
  );

  return {
    schemaVersion: 2,
    id: id(manifest.id, "id"),
    title: text(manifest.title, "title"),
    summary: text(manifest.summary, "summary"),
    actors,
    roles,
    authentication,
    ...(applicationIdentityBoundary === undefined
      ? {}
      : { applicationIdentityBoundary }),
    trigger,
    detection,
    prerequisites,
    operations,
    resources,
    permissions,
    evidence: {
      staging: text(evidenceValue.staging, "evidence.staging"),
      learnerReceives: text(
        evidenceValue.learnerReceives,
        "evidence.learnerReceives",
      ),
      artifacts,
    },
    learner,
    responseActions,
    lifecycle: {
      expiresAt: lifecycleExpiresAt,
      cleanupOwnerActorId,
      cleanupOperationKeys,
      retainedArtifacts,
    },
    cost: {
      currency: "USD",
      laneMaximum,
      conservativeDurationHours,
      assumption: text(costValue.assumption, "cost.assumption"),
    },
  };
}

function validateLifecycleMarker(
  operations: readonly ScenarioOperation[],
): void {
  const markers = new Set(
    operations
      .filter(({ effect }) => effect === "mutation")
      .map(({ marker }) => marker),
  );
  if (markers.size !== 1 || markers.has(undefined)) {
    throw new ScenarioManifestError(
      "all mutating operations must share one lifecycle marker.",
    );
  }
}

function validateOperationDependencies(
  operations: readonly ScenarioOperation[],
  operationByKey: ReadonlyMap<string, ScenarioOperation>,
): void {
  for (const operation of operations) {
    for (const dependency of operation.dependsOnOperationKeys ?? []) {
      if (dependency === operation.key || !operationByKey.has(dependency)) {
        throw new ScenarioManifestError(
          `operation '${operation.key}' has an invalid dependency '${dependency}'.`,
        );
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (operationKey: string): void => {
    if (visiting.has(operationKey)) {
      throw new ScenarioManifestError(
        "operation dependencies must be acyclic.",
      );
    }
    if (visited.has(operationKey)) return;
    visiting.add(operationKey);
    for (
      const dependency of operationByKey.get(operationKey)
        ?.dependsOnOperationKeys ?? []
    ) {
      visit(dependency);
    }
    visiting.delete(operationKey);
    visited.add(operationKey);
  };
  operations.forEach(({ key }) => visit(key));
}

function validateBillableExpiryContract(
  resources: readonly ScenarioResource[],
  operations: ReadonlyMap<string, ScenarioOperation>,
  lifecycleExpiresAt: string,
): void {
  if (!resources.some(({ billable }) => billable)) return;
  const expiryResources = resources.filter(
    ({ kind }) => kind === "expiry-schedule",
  );
  if (expiryResources.length !== 1) {
    throw new ScenarioManifestError(
      "billable resources require one marker-bound expiry schedule.",
    );
  }
  const expiryResource = expiryResources[0]!;
  const create = operations.get(expiryResource.createOperationKey);
  const cleanup = operations.get(expiryResource.cleanupOperationKey);
  if (
    create?.phase !== "setup" ||
    create.capability !== "expiry.schedule" ||
    create.effect !== "mutation" ||
    cleanup?.phase !== "cleanup" ||
    cleanup.capability !== "expiry.remove" ||
    cleanup.effect !== "mutation" ||
    expiryResource.expiresAt !== lifecycleExpiresAt
  ) {
    throw new ScenarioManifestError(
      "billable expiry schedule must bind setup, cleanup, and lifecycle expiry.",
    );
  }
}

export function createScenarioPlan(value: unknown): HTMLElement {
  const manifest = parseScenarioManifest(value);
  const actorById = new Map(
    manifest.actors.map((actor) => [actor.id, actor]),
  );
  const actorLabel = (actorId: string): string =>
    actorById.get(actorId)?.label ??
      (() => {
        throw new ScenarioManifestError(`actor '${actorId}' is unavailable.`);
      })();

  const panel = document.createElement("section");
  panel.className = "api-access scenario-plan";
  panel.dataset.scenarioId = manifest.id;

  const heading = document.createElement("h2");
  heading.textContent = manifest.title;
  panel.append(
    heading,
    createStatus(
      "Scenario plan only: viewing this card does not stage tenant activity.",
      "notice",
    ),
    createStatus(manifest.summary),
  );

  const details = document.createElement("dl");
  details.className = "identity-list";
  appendIdentity(
    details,
    "Evidence producer",
    actorLabel(manifest.roles.evidenceProducer),
  );
  appendIdentity(
    details,
    "Workload actor",
    actorLabel(manifest.roles.workloadActor),
  );
  appendIdentity(
    details,
    "Learner / observer",
    actorLabel(manifest.roles.learner),
  );
  appendIdentity(
    details,
    "Detector / observer",
    manifest.detection?.kind === "independent" && manifest.roles.detector
      ? actorLabel(manifest.roles.detector)
      : "Not assigned; no independent detection claim",
  );
  appendIdentity(
    details,
    "Responder",
    manifest.roles.responder
      ? actorLabel(manifest.roles.responder)
      : "Not assigned",
  );
  appendIdentity(
    details,
    "Trigger model",
    manifest.trigger.kind === "staged"
      ? "Staged — the evidence producer and learner are separate"
      : `Self-triggered — ${manifest.trigger.rationale}`,
  );
  appendIdentity(details, "Who stages evidence", manifest.evidence.staging);
  appendIdentity(
    details,
    "What the learner receives",
    manifest.evidence.learnerReceives,
  );
  appendIdentity(details, "Learner task", manifest.learner.task);
  appendIdentity(
    details,
    "Expected interpretation",
    manifest.learner.expectedInterpretation,
  );
  appendIdentity(
    details,
    "Learner completion",
    manifest.learner.completionState,
  );
  appendIdentity(details, "Scenario expiry", manifest.lifecycle.expiresAt);
  appendIdentity(
    details,
    "Maximum cost",
    `${manifest.cost.currency} ${manifest.cost.laneMaximum}`,
  );
  for (const authentication of manifest.authentication) {
    appendIdentity(
      details,
      `Authentication — ${actorLabel(authentication.actorId)}`,
      authentication.summary,
    );
  }
  panel.append(details);
  return panel;
}

function parseActor(value: unknown, path: string): ScenarioActor {
  const actor = record(value, path);
  return {
    id: id(actor.id, `${path}.id`),
    label: text(actor.label, `${path}.label`),
    kind: enumValue(actor.kind, ACTOR_KINDS, `${path}.kind`),
    summary: text(actor.summary, `${path}.summary`),
  };
}

function parseTrigger(value: Record<string, unknown>): ScenarioTrigger {
  if (value.kind === "staged") {
    return { kind: "staged" };
  }
  if (value.kind === "self-triggered") {
    return {
      kind: "self-triggered",
      rationale: text(value.rationale, "trigger.rationale"),
    };
  }
  throw new ScenarioManifestError(
    "trigger.kind must be staged or self-triggered.",
  );
}

function parseDetection(value: unknown): ScenarioDetection {
  if (value === undefined) {
    return { kind: "none" };
  }
  const detection = record(value, "detection");
  if (detection.kind === "none" || detection.kind === "independent") {
    return { kind: detection.kind };
  }
  throw new ScenarioManifestError(
    "detection.kind must be none or independent.",
  );
}

function parseApplicationIdentityBoundary(
  value: unknown,
  roles: ScenarioRoleAssignments,
  actorIds: ReadonlySet<string>,
  operationByKey: ReadonlyMap<string, ScenarioOperation>,
): ScenarioApplicationIdentityBoundary {
  const boundary = record(value, "applicationIdentityBoundary");
  const producerActorId = id(
    boundary.producerActorId,
    "applicationIdentityBoundary.producerActorId",
  );
  const detectorActorId = id(
    boundary.detectorActorId,
    "applicationIdentityBoundary.detectorActorId",
  );
  const recoveryOwnerActorId = id(
    boundary.recoveryOwnerActorId,
    "applicationIdentityBoundary.recoveryOwnerActorId",
  );
  for (const [path, actorId] of [
    ["producerActorId", producerActorId],
    ["detectorActorId", detectorActorId],
    ["recoveryOwnerActorId", recoveryOwnerActorId],
  ] as const) {
    reference(
      actorIds,
      actorId,
      `applicationIdentityBoundary.${path}`,
      "actor",
    );
  }
  if (
    producerActorId !== roles.workloadActor ||
    detectorActorId !== roles.detector
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary must bind the exact workload and detector actors.",
    );
  }
  if (
    new Set([
      producerActorId,
      detectorActorId,
      recoveryOwnerActorId,
    ]).size !== 3
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary recovery, producer, and detector actors must differ.",
    );
  }
  if (
    boundary.tenantBinding !== "same-tenant" ||
    boundary.tokenAudience !== "https://graph.microsoft.com"
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary must use the fixed same-tenant Microsoft Graph audience.",
    );
  }
  const producerPermissions = parseApplicationPermissionRequirements(
    boundary.producerPermissions,
    "applicationIdentityBoundary.producerPermissions",
  );
  const detectorPermissions = parseApplicationPermissionRequirements(
    boundary.detectorPermissions,
    "applicationIdentityBoundary.detectorPermissions",
  );
  const producerRoleIds = new Set(
    producerPermissions.map(({ applicationRoleId }) => applicationRoleId),
  );
  if (
    detectorPermissions.some(({ applicationRoleId }) =>
      producerRoleIds.has(applicationRoleId)
    )
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary producer and detector permissions must not overlap.",
    );
  }
  const markerOperationKey = id(
    boundary.markerOperationKey,
    "applicationIdentityBoundary.markerOperationKey",
  );
  const markerOperation = operationByKey.get(markerOperationKey);
  if (markerOperation?.marker === undefined) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary marker operation must be marker-bound.",
    );
  }
  const observationOperationKey = id(
    boundary.observationOperationKey,
    "applicationIdentityBoundary.observationOperationKey",
  );
  const observationOperation = operationByKey.get(observationOperationKey);
  if (
    observationOperation?.ownerActorId !== detectorActorId ||
    observationOperation.effect !== "read"
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary observation must be a detector-owned read.",
    );
  }
  const maximumObservationWindowMinutes = positiveNumber(
    boundary.maximumObservationWindowMinutes,
    "applicationIdentityBoundary.maximumObservationWindowMinutes",
  );
  if (
    !Number.isSafeInteger(maximumObservationWindowMinutes) ||
    maximumObservationWindowMinutes > 60
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary observation window must be an integer from 1 to 60 minutes.",
    );
  }
  if (
    boundary.attribution !==
      "exact-application-service-principal-marker-window"
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary attribution contract is invalid.",
    );
  }
  return {
    producerActorId,
    detectorActorId,
    recoveryOwnerActorId,
    tenantBinding: "same-tenant",
    tokenAudience: "https://graph.microsoft.com",
    producerPermissions,
    detectorPermissions,
    markerOperationKey,
    observationOperationKey,
    maximumObservationWindowMinutes,
    attribution: "exact-application-service-principal-marker-window",
  };
}

function parseApplicationPermissionRequirements(
  value: unknown,
  path: string,
): ScenarioApplicationPermissionRequirement[] {
  const rows = boundedArray(value, path, 1, 16).map((item, index) => {
    const row = record(item, `${path}[${index}]`);
    return {
      resourceApplicationId: uuid(
        row.resourceApplicationId,
        `${path}[${index}].resourceApplicationId`,
      ),
      applicationRoleId: uuid(
        row.applicationRoleId,
        `${path}[${index}].applicationRoleId`,
      ),
      name: text(row.name, `${path}[${index}].name`),
    };
  });
  const keys = rows.map(
    ({ resourceApplicationId, applicationRoleId }) =>
      `${resourceApplicationId}:${applicationRoleId}`,
  );
  uniqueStrings(keys, path);
  return rows;
}

function validateApplicationIdentityPermissionDeclarations(
  boundary: ScenarioApplicationIdentityBoundary,
  permissions: readonly ScenarioPermission[],
): void {
  const declared = permissions
    .filter(({ actorId }) =>
      actorId === boundary.producerActorId ||
      actorId === boundary.detectorActorId
    )
    .map(({ actorId, name }) => `${actorId}:${name}`)
    .sort();
  const required = [
    ...boundary.producerPermissions.map(({ name }) =>
      `${boundary.producerActorId}:${name}`
    ),
    ...boundary.detectorPermissions.map(({ name }) =>
      `${boundary.detectorActorId}:${name}`
    ),
  ].sort();
  if (
    declared.length !== required.length ||
    declared.some((value, index) => value !== required[index])
  ) {
    throw new ScenarioManifestError(
      "applicationIdentityBoundary permission requirements must exactly match manifest permissions.",
    );
  }
}

function parsePermission(
  value: unknown,
  path: string,
  actorIds: ReadonlySet<string>,
  operationByKey: ReadonlyMap<string, ScenarioOperation>,
): ScenarioPermission {
  const permission = record(value, path);
  const actorId = id(permission.actorId, `${path}.actorId`);
  reference(actorIds, actorId, `${path}.actorId`, "actor");
  const base: ScenarioPermissionBase = {
    id: id(permission.id, `${path}.id`),
    kind: enumValue(permission.kind, PERMISSION_KINDS, `${path}.kind`),
    name: text(permission.name, `${path}.name`),
    actorId,
    scope: text(permission.scope, `${path}.scope`),
    purpose: text(permission.purpose, `${path}.purpose`),
  };
  if (permission.mode === "temporary") {
    const grantOperationKey = id(
      permission.grantOperationKey,
      `${path}.grantOperationKey`,
    );
    const revocationOperationKey = id(
      permission.revocationOperationKey,
      `${path}.revocationOperationKey`,
    );
    const revocationOwnerActorId = id(
      permission.revocationOwnerActorId,
      `${path}.revocationOwnerActorId`,
    );
    reference(
      actorIds,
      revocationOwnerActorId,
      `${path}.revocationOwnerActorId`,
      "actor",
    );
    const grant = requireOperation(
      operationByKey,
      grantOperationKey,
      `${path}.grantOperationKey`,
      "setup",
      "mutation",
    );
    const revoke = requireOperation(
      operationByKey,
      revocationOperationKey,
      `${path}.revocationOperationKey`,
      "cleanup",
      "mutation",
    );
    if (revoke.ownerActorId !== revocationOwnerActorId) {
      throw new ScenarioManifestError(
        `${path}.revocationOwnerActorId must own the revocation operation.`,
      );
    }
    if (grant.ownerActorId !== actorId) {
      throw new ScenarioManifestError(
        `${path}.actorId must own the temporary permission grant operation.`,
      );
    }
    if (grant.marker !== revoke.marker) {
      throw new ScenarioManifestError(
        `${path} grant and revocation operations must use the same marker.`,
      );
    }
    return {
      ...base,
      mode: "temporary",
      grantOperationKey,
      revocationOperationKey,
      revocationOwnerActorId,
    };
  }
  if (permission.mode === "retained") {
    return {
      ...base,
      mode: "retained",
      retentionRationale: text(
        permission.retentionRationale,
        `${path}.retentionRationale`,
      ),
    };
  }
  throw new ScenarioManifestError(
    `${path}.mode must be temporary or retained.`,
  );
}

function parseArtifact(
  value: unknown,
  path: string,
  operationByKey: ReadonlyMap<string, ScenarioOperation>,
): ScenarioEvidenceArtifact {
  const artifact = record(value, path);
  const kind = enumValue(artifact.kind, ARTIFACT_KINDS, `${path}.kind`);
  const state = enumValue(artifact.state, ARTIFACT_STATES, `${path}.state`);
  const learnerVisibility = enumValue(
    artifact.learnerVisibility,
    LEARNER_VISIBILITY,
    `${path}.learnerVisibility`,
  );
  if (
    learnerVisibility === "observed" &&
    state !== "observed" &&
    state !== "learner-completed"
  ) {
    throw new ScenarioManifestError(
      `${path} cannot claim learner visibility from planned or platform-accepted evidence.`,
    );
  }
  const sourceOperationKey = id(
    artifact.sourceOperationKey,
    `${path}.sourceOperationKey`,
  );
  requireOperation(
    operationByKey,
    sourceOperationKey,
    `${path}.sourceOperationKey`,
    "evidence",
  );
  const observation = artifact.observation === undefined
    ? undefined
    : record(artifact.observation, `${path}.observation`);
  if (state === "observed" || state === "learner-completed") {
    if (observation === undefined) {
      throw new ScenarioManifestError(
        `${path}.observation must be an object for observed evidence.`,
      );
    }
    const observationOperationKey = id(
      observation.operationKey,
      `${path}.observation.operationKey`,
    );
    requireOperation(
      operationByKey,
      observationOperationKey,
      `${path}.observation.operationKey`,
      "evidence",
      "read",
    );
  } else if (observation !== undefined) {
    throw new ScenarioManifestError(
      `${path}.observation is only allowed for observed or learner-completed evidence.`,
    );
  }
  const semanticClaims = boundedArray(
    artifact.semanticClaims,
    `${path}.semanticClaims`,
    1,
    8,
  ).map((claim, index) =>
    enumValue(
      claim,
      SEMANTIC_CLAIMS,
      `${path}.semanticClaims[${index}]`,
    )
  );
  uniqueStrings(semanticClaims, `${path}.semanticClaims`);
  validateSemanticClaims(kind, semanticClaims, path);
  return {
    id: id(artifact.id, `${path}.id`),
    kind,
    authenticity: enumValue(
      artifact.authenticity,
      ARTIFACT_AUTHENTICITY,
      `${path}.authenticity`,
    ),
    state,
    learnerVisibility,
    sourceOperationKey,
    claim: text(artifact.claim, `${path}.claim`),
    semanticClaims,
    retention: enumValue(
      artifact.retention,
      ARTIFACT_RETENTION,
      `${path}.retention`,
    ),
    ...(observation === undefined
      ? {}
      : {
        observation: {
          operationKey: id(
            observation.operationKey,
            `${path}.observation.operationKey`,
          ),
          proofReference: proofReference(
            observation.proofReference,
            `${path}.observation.proofReference`,
          ),
        },
      }),
  };
}

function parseRetainedArtifact(
  value: unknown,
  path: string,
  actorIds: ReadonlySet<string>,
  artifactById: ReadonlyMap<string, ScenarioEvidenceArtifact>,
  operationByKey: ReadonlyMap<string, ScenarioOperation>,
): ScenarioRetainedArtifact {
  const retained = record(value, path);
  const artifactId = id(retained.artifactId, `${path}.artifactId`);
  const artifact = artifactById.get(artifactId);
  if (!artifact) {
    throw new ScenarioManifestError(
      `${path}.artifactId references unknown evidence artifact '${artifactId}'.`,
    );
  }
  if (artifact.retention !== "retained") {
    throw new ScenarioManifestError(
      `${path}.artifactId must reference an artifact marked retained.`,
    );
  }
  const custodianActorId = id(
    retained.custodianActorId,
    `${path}.custodianActorId`,
  );
  reference(
    actorIds,
    custodianActorId,
    `${path}.custodianActorId`,
    "actor",
  );
  const disposition = enumValue(
    retained.disposition,
    RETAINED_DISPOSITIONS,
    `${path}.disposition`,
  );
  const cleanupOperationKey = retained.cleanupOperationKey === undefined
    ? undefined
    : id(retained.cleanupOperationKey, `${path}.cleanupOperationKey`);
  if (disposition === "cleanup-later" && cleanupOperationKey === undefined) {
    throw new ScenarioManifestError(
      `${path}.cleanupOperationKey is required for cleanup-later disposition.`,
    );
  }
  if (cleanupOperationKey !== undefined) {
    const cleanupOperation = requireOperation(
      operationByKey,
      cleanupOperationKey,
      `${path}.cleanupOperationKey`,
      "cleanup",
      "mutation",
    );
    if (cleanupOperation.ownerActorId !== custodianActorId) {
      throw new ScenarioManifestError(
        `${path}.custodianActorId must own the retained-artifact cleanup operation.`,
      );
    }
    if (disposition === "cleanup-later") {
      const sourceOperation = requireOperation(
        operationByKey,
        artifact.sourceOperationKey,
        `${path}.artifactId source operation`,
        "evidence",
        "mutation",
      );
      if (sourceOperation.marker !== cleanupOperation.marker) {
        throw new ScenarioManifestError(
          `${path} source and cleanup operations must use the same marker.`,
        );
      }
    }
  }
  return {
    artifactId,
    custodianActorId,
    disposition,
    rationale: text(retained.rationale, `${path}.rationale`),
    ...(cleanupOperationKey === undefined ? {} : { cleanupOperationKey }),
  };
}

function validateSemanticClaims(
  kind: ScenarioArtifactKind,
  claims: readonly ScenarioSemanticClaim[],
  path: string,
): void {
  const allowed: Record<
    ScenarioArtifactKind,
    readonly ScenarioSemanticClaim[]
  > = {
    "application-recon-summary": ["application-reconnaissance"],
    "purview-audit-summary": ["purview-surface-reachability"],
    "outlook-email": ["outlook-email"],
    "private-document": ["private-document-staged"],
    "teams-missed-call": ["teams-missed-call"],
    "avd-topology": ["avd-ready"],
    "endpoint-posture": ["endpoint-managed"],
    "private-network-topology": ["private-three-vm-topology"],
    "cleanup-state": [
      "endpoint-state-removed",
      "expiry-removed",
      "infrastructure-removed",
      "permissions-revoked",
      "sensitive-artifacts-absent",
    ],
  };
  const unsupported = claims.find((claim) => !allowed[kind].includes(claim));
  if (unsupported) {
    throw new ScenarioManifestError(
      `${path}.semanticClaims includes unsupported '${unsupported}' for ${kind}.`,
    );
  }
}

function validateLearnerEvidence(
  completionState: ScenarioLearnerContract["completionState"],
  artifactIds: readonly string[],
  artifactById: ReadonlyMap<string, ScenarioEvidenceArtifact>,
): void {
  const artifacts = artifactIds.map((artifactId) => artifactById.get(artifactId)!);
  if (
    completionState === "available" &&
    artifacts.some((artifact) =>
      artifact.state !== "observed" &&
      artifact.state !== "learner-completed" ||
      artifact.learnerVisibility !== "observed"
    )
  ) {
    throw new ScenarioManifestError(
      "learner completionState available requires observed learner-visible evidence.",
    );
  }
  if (
    completionState === "completed" &&
    artifacts.some((artifact) =>
      artifact.state !== "learner-completed" ||
      artifact.learnerVisibility !== "observed"
    )
  ) {
    throw new ScenarioManifestError(
      "learner completionState completed requires learner-completed visible evidence.",
    );
  }
}

function validateRetainedArtifacts(
  artifacts: readonly ScenarioEvidenceArtifact[],
  retainedArtifacts: readonly ScenarioRetainedArtifact[],
): void {
  const inventoried = new Set(
    retainedArtifacts.map((artifact) => artifact.artifactId),
  );
  for (const artifact of artifacts) {
    if (artifact.retention === "retained" && !inventoried.has(artifact.id)) {
      throw new ScenarioManifestError(
        `retained evidence artifact '${artifact.id}' requires a lifecycle inventory entry.`,
      );
    }
    if (artifact.retention !== "retained" && inventoried.has(artifact.id)) {
      throw new ScenarioManifestError(
        `ephemeral evidence artifact '${artifact.id}' must not be inventoried as retained.`,
      );
    }
  }
}

function requireOperation(
  operations: ReadonlyMap<string, ScenarioOperation>,
  operationKey: string,
  path: string,
  phase: ScenarioOperationPhase,
  effect?: ScenarioOperation["effect"],
): ScenarioOperation {
  const operation = operations.get(operationKey);
  if (!operation) {
    throw new ScenarioManifestError(
      `${path} references unknown operation '${operationKey}'.`,
    );
  }
  if (operation.phase !== phase || (effect && operation.effect !== effect)) {
    throw new ScenarioManifestError(
      `${path} must reference a ${phase}${effect ? ` ${effect}` : ""} operation.`,
    );
  }
  return operation;
}

function uniqueIds(
  values: readonly { id: string }[],
  kind: string,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new ScenarioManifestError(`${kind} id '${value.id}' is duplicated.`);
    }
    ids.add(value.id);
  }
  return ids;
}

function uniqueStrings(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new ScenarioManifestError(`${path} must contain unique values.`);
  }
}

function reference(
  values: ReadonlySet<string>,
  value: string,
  path: string,
  kind: string,
): void {
  if (!values.has(value)) {
    throw new ScenarioManifestError(
      `${path} references unknown ${kind} '${value}'.`,
    );
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioManifestError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new ScenarioManifestError(`${path} must be an array.`);
  }
  if (value.length < minimum || value.length > maximum) {
    throw new ScenarioManifestError(
      `${path} must contain ${minimum}-${maximum} items.`,
    );
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_TEXT
  ) {
    throw new ScenarioManifestError(
      `${path} must be a non-empty string of at most ${MAX_TEXT} characters.`,
    );
  }
  return value;
}

function proofReference(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^canonical:[a-z0-9][a-z0-9/-]{2,199}$/.test(parsed)) {
    throw new ScenarioManifestError(
      `${path} must be a sanitized canonical evidence reference.`,
    );
  }
  return parsed;
}

function id(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(parsed)) {
    throw new ScenarioManifestError(
      `${path} must be a lowercase stable identifier.`,
    );
  }
  return parsed;
}

function uuid(value: unknown, path: string): string {
  const parsed = text(value, path).toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      .test(parsed)
  ) {
    throw new ScenarioManifestError(`${path} must be a canonical UUID.`);
  }
  return parsed;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ScenarioManifestError(
      `${path} must be one of: ${values.join(", ")}.`,
    );
  }
  return value as Values[number];
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ScenarioManifestError(`${path} must be a boolean.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new ScenarioManifestError(
      `${path} must be a finite non-negative number.`,
    );
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path);
  if (parsed <= 0) {
    throw new ScenarioManifestError(`${path} must be greater than zero.`);
  }
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) ||
    !Number.isFinite(Date.parse(parsed))
  ) {
    throw new ScenarioManifestError(`${path} must be an ISO UTC timestamp.`);
  }
  return parsed;
}
