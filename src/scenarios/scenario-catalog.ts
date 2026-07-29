import { appendIdentity, createStatus } from "../ui/elements";
import {
  parseScenarioManifest,
  type ScenarioActor,
  type ScenarioEvidenceArtifact,
  type ScenarioManifest,
} from "./scenario-manifest";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const SCENARIO_CATALOG_UI_CAPABILITY = {
  schemaVersion: 1,
  surface: "operator-catalog-ui",
  scenarioScope: "canonical-registry",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export interface ScenarioCatalogSelection {
  scenarioId: string;
  schemaVersion: ScenarioManifest["schemaVersion"];
}

export interface ScenarioCatalogOptions {
  onPlanPreview?: (selection: ScenarioCatalogSelection) => void;
}

export function createScenarioCatalog(
  registry: readonly unknown[],
  options: ScenarioCatalogOptions = {},
): HTMLElement {
  const section = document.createElement("section");
  section.className = "scenario-catalog";
  section.setAttribute("aria-labelledby", "scenario-catalog-heading");

  const heading = document.createElement("h2");
  heading.id = "scenario-catalog-heading";
  heading.textContent = "Scenario catalog";
  section.append(
    heading,
    createStatus(
      "Read-only descriptions from the validated registry. Viewing or expanding a scenario does not stage evidence or change any system.",
      "notice",
    ),
    createPurviewBoundary(),
  );

  try {
    const manifests = registry.map(parseScenarioManifest);
    if (manifests.length === 0) {
      throw new Error("The canonical registry is empty.");
    }
    const cards = document.createElement("div");
    cards.className = "scenario-catalog-cards";
    for (const [index, manifest] of manifests.entries()) {
      cards.append(
        createScenarioCard(manifest, index, options.onPlanPreview),
      );
    }
    section.append(cards);
  } catch {
    section.append(
      createStatus(
        "Scenario catalog unavailable: canonical registry validation failed. No scenario details or controls were rendered.",
        "error",
      ),
    );
  }
  return section;
}

function createPurviewBoundary(): HTMLElement {
  const boundary = document.createElement("aside");
  boundary.className = "scenario-catalog-boundary";
  boundary.setAttribute("aria-label", "Purview audit boundary");
  const heading = document.createElement("h3");
  heading.textContent = "Purview audit boundary";
  const text = document.createElement("p");
  text.textContent =
    "Purview audit correlation is a separate read-only capability contract, not a catalog scenario or execution receipt. The application-reconnaissance scenario below proves only its registry claims; it does not claim that one audit or sign-in record proves every workload read.";
  boundary.append(heading, text);
  return boundary;
}

function createScenarioCard(
  manifest: ScenarioManifest,
  index: number,
  onPlanPreview?: (selection: ScenarioCatalogSelection) => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "scenario-catalog-card";

  const heading = document.createElement("h3");
  heading.textContent = manifest.title;
  const purpose = document.createElement("p");
  purpose.className = "scenario-catalog-purpose";
  purpose.id = `scenario-catalog-purpose-${index + 1}`;
  purpose.textContent = manifest.summary;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "View catalog details";
  details.append(summary, createScenarioDetails(manifest));
  card.append(heading, purpose, details);
  if (onPlanPreview) {
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "scenario-catalog-plan-link secondary";
    preview.textContent = "Use in plan preview";
    preview.setAttribute(
      "aria-label",
      `Use ${manifest.title} in plan preview`,
    );
    preview.setAttribute("aria-describedby", purpose.id);
    preview.addEventListener("click", () => {
      onPlanPreview({
        scenarioId: manifest.id,
        schemaVersion: manifest.schemaVersion,
      });
    });
    card.append(preview);
  }
  return card;
}

function createScenarioDetails(manifest: ScenarioManifest): HTMLElement {
  const content = document.createElement("div");
  content.className = "scenario-catalog-details";
  const actorById = new Map(
    manifest.actors.map((actor) => [actor.id, actor]),
  );
  const actor = (actorId: string): ScenarioActor => {
    const match = actorById.get(actorId);
    if (!match) {
      throw new Error("Validated actor is unavailable.");
    }
    return match;
  };

  content.append(
    createRoleList(manifest, actor),
    createEvidenceSection(manifest),
    createLearnerSection(manifest),
    createResponseSection(manifest, actor),
    createBoundarySection(manifest, actor),
    createLifecycleSection(manifest, actor),
    createLimitationsSection(manifest),
  );
  return content;
}

function createRoleList(
  manifest: ScenarioManifest,
  actor: (id: string) => ScenarioActor,
): HTMLElement {
  const section = catalogSection("Role separation");
  const list = document.createElement("dl");
  list.className = "scenario-catalog-list";
  appendIdentity(
    list,
    "Evidence producer",
    actorSummary(actor(manifest.roles.evidenceProducer)),
  );
  appendIdentity(
    list,
    "Workload actor",
    actorSummary(actor(manifest.roles.workloadActor)),
  );
  appendIdentity(
    list,
    "Learner",
    actorSummary(actor(manifest.roles.learner)),
  );
  appendIdentity(
    list,
    "Detector",
    manifest.roles.detector
      ? actorSummary(actor(manifest.roles.detector))
      : "Not assigned; no independent detection claim.",
  );
  appendIdentity(
    list,
    "Responder",
    manifest.roles.responder
      ? actorSummary(actor(manifest.roles.responder))
      : "Not assigned.",
  );
  section.append(list);
  return section;
}

function createEvidenceSection(manifest: ScenarioManifest): HTMLElement {
  const section = catalogSection("Evidence");
  const summary = document.createElement("dl");
  summary.className = "scenario-catalog-list";
  appendIdentity(summary, "Producer operation", manifest.evidence.staging);
  appendIdentity(
    summary,
    "Learner observes",
    manifest.evidence.learnerReceives,
  );
  section.append(summary);

  const artifacts = document.createElement("ul");
  artifacts.className = "scenario-catalog-items";
  for (const artifact of manifest.evidence.artifacts) {
    const item = document.createElement("li");
    item.textContent = artifactSummary(artifact);
    artifacts.append(item);
  }
  section.append(artifacts);
  return section;
}

function createLearnerSection(manifest: ScenarioManifest): HTMLElement {
  const section = catalogSection("Learner interpretation");
  const list = document.createElement("dl");
  list.className = "scenario-catalog-list";
  appendIdentity(list, "Task", manifest.learner.task);
  appendIdentity(
    list,
    "Expected interpretation",
    manifest.learner.expectedInterpretation,
  );
  appendIdentity(
    list,
    "Completion",
    fixedLabel(manifest.learner.completionState),
  );
  section.append(list);
  return section;
}

function createResponseSection(
  manifest: ScenarioManifest,
  actor: (id: string) => ScenarioActor,
): HTMLElement {
  const section = catalogSection("Optional response");
  if (manifest.responseActions.length === 0) {
    section.append(createStatus("No response is assigned."));
    return section;
  }
  const list = document.createElement("ul");
  list.className = "scenario-catalog-items";
  for (const response of manifest.responseActions) {
    const item = document.createElement("li");
    item.textContent =
      `${fixedLabel(response.kind)} — ${response.summary} Owner: ${
        actor(response.ownerActorId).label
      }.`;
    list.append(item);
  }
  section.append(list);
  return section;
}

function createBoundarySection(
  manifest: ScenarioManifest,
  actor: (id: string) => ScenarioActor,
): HTMLElement {
  const section = catalogSection("Setup and human boundaries");
  const list = document.createElement("dl");
  list.className = "scenario-catalog-list";
  appendIdentity(
    list,
    "Trigger",
    manifest.trigger.kind === "staged"
      ? "A separate evidence producer stages the scenario."
      : `The learner stages it intentionally: ${manifest.trigger.rationale}`,
  );
  appendIdentity(
    list,
    "Setup",
    operationSummary(manifest, "setup"),
  );
  appendIdentity(
    list,
    "Human-only gates",
    manifest.actors
      .filter(({ kind }) => kind === "human")
      .map(actorSummary)
      .join(" ") + " These learner or operator steps are not automated.",
  );
  appendIdentity(
    list,
    "Prerequisites",
    manifest.prerequisites
      .map(({ summary, requiredState }) => `${summary} ${requiredState}`)
      .join(" "),
  );
  for (const authentication of manifest.authentication) {
    appendIdentity(
      list,
      `Authentication — ${actor(authentication.actorId).label}`,
      `${fixedLabel(authentication.transport)}. ${authentication.summary}`,
    );
  }
  section.append(list);
  return section;
}

function createLifecycleSection(
  manifest: ScenarioManifest,
  actor: (id: string) => ScenarioActor,
): HTMLElement {
  const section = catalogSection("Lifecycle, retention, and cost");
  const list = document.createElement("dl");
  list.className = "scenario-catalog-list";
  appendIdentity(list, "Expires", manifest.lifecycle.expiresAt);
  appendIdentity(
    list,
    "Cleanup owner",
    actorSummary(actor(manifest.lifecycle.cleanupOwnerActorId)),
  );
  appendIdentity(
    list,
    "Cleanup boundary",
    operationSummary(manifest, "cleanup"),
  );
  appendIdentity(
    list,
    "Retention",
    retentionSummary(manifest),
  );
  appendIdentity(
    list,
    "Maximum cost",
    `${manifest.cost.currency} ${manifest.cost.laneMaximum} across ${
      manifest.cost.conservativeDurationHours
    } conservative hours. ${manifest.cost.assumption}`,
  );
  section.append(list);
  return section;
}

function createLimitationsSection(manifest: ScenarioManifest): HTMLElement {
  const section = catalogSection("Current limitation");
  const limitations = document.createElement("ul");
  limitations.className = "scenario-catalog-items";
  const completion = document.createElement("li");
  completion.textContent =
    manifest.learner.completionState === "completed"
      ? "The registry records learner completion."
      : `Learner completion is ${
        fixedLabel(manifest.learner.completionState)
      }; this catalog does not claim a completed learner exercise.`;
  limitations.append(completion);

  const unproven = manifest.evidence.artifacts.filter(
    ({ learnerVisibility }) => learnerVisibility === "not-proven",
  );
  if (unproven.length > 0) {
    const item = document.createElement("li");
    item.textContent =
      `Learner visibility is not proven for: ${
        unproven.map(({ kind }) => artifactLabel(kind)).join(", ")
      }.`;
    limitations.append(item);
  }
  const interpretation = document.createElement("li");
  interpretation.textContent =
    `Interpretation boundary: ${manifest.learner.expectedInterpretation}`;
  limitations.append(interpretation);
  section.append(limitations);
  return section;
}

function catalogSection(title: string): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading);
  return section;
}

function actorSummary(actor: ScenarioActor): string {
  return `${actor.label} — ${actor.summary}`;
}

function artifactSummary(artifact: ScenarioEvidenceArtifact): string {
  return `${artifactLabel(artifact.kind)} — ${
    fixedLabel(artifact.authenticity)
  }; ${fixedLabel(artifact.state)}; learner visibility ${
    fixedLabel(artifact.learnerVisibility)
  }; ${fixedLabel(artifact.retention)}. ${artifact.claim}`;
}

function artifactLabel(kind: ScenarioEvidenceArtifact["kind"]): string {
  return fixedLabel(kind);
}

function operationSummary(
  manifest: ScenarioManifest,
  phase: "setup" | "cleanup",
): string {
  const operations = manifest.operations.filter(
    (operation) => operation.phase === phase,
  );
  return operations.length === 0
    ? `No separate ${phase} operation is declared.`
    : operations.map(({ summary }) => summary).join(" ");
}

function retentionSummary(manifest: ScenarioManifest): string {
  if (manifest.lifecycle.retainedArtifacts.length === 0) {
    return "No retained artifact is declared; evidence is process-local or ephemeral.";
  }
  return manifest.lifecycle.retainedArtifacts.map((retained) => {
    const artifact = manifest.evidence.artifacts.find(
      ({ id }) => id === retained.artifactId,
    );
    return `${artifact ? artifactLabel(artifact.kind) : "Validated artifact"}: ${
      fixedLabel(retained.disposition)
    }. ${retained.rationale}`;
  }).join(" ");
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
