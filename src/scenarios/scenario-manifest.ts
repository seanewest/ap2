import { appendIdentity, createStatus } from "../ui/elements";

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

export type ScenarioActorKind = typeof ACTOR_KINDS[number];
export type ScenarioAuthenticationTransport =
  typeof AUTHENTICATION_TRANSPORTS[number];

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

export interface ScenarioAuthentication {
  actorId: string;
  transport: ScenarioAuthenticationTransport;
  summary: string;
}

export type ScenarioTrigger =
  | { kind: "staged" }
  | { kind: "self-triggered"; rationale: string };

export type ScenarioDetection =
  | { kind: "none" }
  | { kind: "independent" };

export interface ScenarioManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  actors: readonly ScenarioActor[];
  roles: ScenarioRoleAssignments;
  authentication: readonly ScenarioAuthentication[];
  trigger: ScenarioTrigger;
  detection?: ScenarioDetection;
  evidence: {
    staging: string;
    learnerReceives: string;
    learnerTask: string;
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
  if (manifest.schemaVersion !== 1) {
    throw new ScenarioManifestError("schemaVersion must be 1.");
  }

  const actorsValue = array(manifest.actors, "actors");
  if (actorsValue.length === 0) {
    throw new ScenarioManifestError("actors must not be empty.");
  }
  const actors = actorsValue.map((actor, index) =>
    parseActor(actor, `actors[${index}]`)
  );
  const actorIds = new Set<string>();
  for (const actor of actors) {
    if (actorIds.has(actor.id)) {
      throw new ScenarioManifestError(`actor id '${actor.id}' is duplicated.`);
    }
    actorIds.add(actor.id);
  }

  const rolesValue = record(manifest.roles, "roles");
  const roles: ScenarioRoleAssignments = {
    evidenceProducer: text(
      rolesValue.evidenceProducer,
      "roles.evidenceProducer",
    ),
    workloadActor: text(rolesValue.workloadActor, "roles.workloadActor"),
    learner: text(rolesValue.learner, "roles.learner"),
    ...(rolesValue.detector === undefined
      ? {}
      : { detector: text(rolesValue.detector, "roles.detector") }),
    ...(rolesValue.responder === undefined
      ? {}
      : { responder: text(rolesValue.responder, "roles.responder") }),
  };
  for (const [role, actorId] of Object.entries(roles)) {
    if (!actorIds.has(actorId)) {
      throw new ScenarioManifestError(
        `roles.${role} references unknown actor '${actorId}'.`,
      );
    }
  }

  const triggerValue = record(manifest.trigger, "trigger");
  const trigger = parseTrigger(triggerValue);
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
  if (
    detection.kind === "independent" &&
    roles.detector === roles.workloadActor
  ) {
    throw new ScenarioManifestError(
      "independent detector and workload actor must differ.",
    );
  }
  if (detection.kind === "none" && roles.detector) {
    throw new ScenarioManifestError(
      "roles.detector requires detection.kind to be independent.",
    );
  }

  const authentication = array(
    manifest.authentication,
    "authentication",
  ).map((item, index) => {
    const authenticationValue = record(
      item,
      `authentication[${index}]`,
    );
    const actorId = text(
      authenticationValue.actorId,
      `authentication[${index}].actorId`,
    );
    if (!actorIds.has(actorId)) {
      throw new ScenarioManifestError(
        `authentication[${index}] references unknown actor '${actorId}'.`,
      );
    }
    return {
      actorId,
      transport: enumValue(
        authenticationValue.transport,
        AUTHENTICATION_TRANSPORTS,
        `authentication[${index}].transport`,
      ),
      summary: text(
        authenticationValue.summary,
        `authentication[${index}].summary`,
      ),
    };
  });

  const evidenceValue = record(manifest.evidence, "evidence");
  return {
    schemaVersion: 1,
    id: text(manifest.id, "id"),
    title: text(manifest.title, "title"),
    summary: text(manifest.summary, "summary"),
    actors,
    roles,
    authentication,
    trigger,
    detection,
    evidence: {
      staging: text(evidenceValue.staging, "evidence.staging"),
      learnerReceives: text(
        evidenceValue.learnerReceives,
        "evidence.learnerReceives",
      ),
      learnerTask: text(evidenceValue.learnerTask, "evidence.learnerTask"),
    },
  };
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

  const roles = document.createElement("dl");
  roles.className = "identity-list";
  appendIdentity(
    roles,
    "Evidence producer",
    actorLabel(manifest.roles.evidenceProducer),
  );
  appendIdentity(
    roles,
    "Workload actor",
    actorLabel(manifest.roles.workloadActor),
  );
  appendIdentity(
    roles,
    "Learner / observer",
    actorLabel(manifest.roles.learner),
  );
  appendIdentity(
    roles,
    "Detector / observer",
    manifest.detection?.kind === "independent" && manifest.roles.detector
      ? actorLabel(manifest.roles.detector)
      : "Not assigned; no independent detection claim",
  );
  appendIdentity(
    roles,
    "Responder",
    manifest.roles.responder
      ? actorLabel(manifest.roles.responder)
      : "Not assigned for this observation-only scenario",
  );
  appendIdentity(
    roles,
    "Trigger model",
    manifest.trigger.kind === "staged"
      ? "Staged — the evidence producer and learner are separate"
      : `Self-triggered — ${manifest.trigger.rationale}`,
  );
  appendIdentity(roles, "Who stages evidence", manifest.evidence.staging);
  appendIdentity(
    roles,
    "What the learner receives",
    manifest.evidence.learnerReceives,
  );
  appendIdentity(roles, "Learner task", manifest.evidence.learnerTask);
  for (const authentication of manifest.authentication) {
    appendIdentity(
      roles,
      `Authentication — ${actorLabel(authentication.actorId)}`,
      authentication.summary,
    );
  }
  panel.append(roles);
  return panel;
}

function parseActor(value: unknown, path: string): ScenarioActor {
  const actor = record(value, path);
  return {
    id: text(actor.id, `${path}.id`),
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

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScenarioManifestError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ScenarioManifestError(`${path} must be an array.`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScenarioManifestError(`${path} must be a non-empty string.`);
  }
  return value;
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
