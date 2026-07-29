import { appendIdentity, createStatus } from "../ui/elements";
import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const CAPABILITY_CATALOG_UI_CAPABILITY = {
  schemaVersion: 1,
  surface: "capability-catalog-ui",
  scenarioScope: "canonical-registry",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export interface ScenarioCatalogSelection {
  scenarioId: string;
  schemaVersion: ScenarioManifest["schemaVersion"];
}

interface CapabilityPresentation {
  readonly title: string;
  readonly summary: string;
  readonly learnerEvidence: string;
}

const CAPABILITY_PRESENTATIONS: Readonly<Record<string, CapabilityPresentation>> = {
  "teams-missed-call-observation": {
    title: "Controlled Teams missed-call observation",
    summary:
      "Contributes one authentic Teams missed-call observation produced through a separate fictional caller account.",
    learnerEvidence:
      "One missed incoming call entry and one matching Teams activity item in the evidence recipient's view.",
  },
  "help-desk-email-observation": {
    title: "Outlook help-desk email observation",
    summary:
      "Contributes one authentic Outlook message from a separate fictional help-desk account.",
    learnerEvidence:
      "One Outlook Inbox message from the fictional help-desk sender to the evidence recipient.",
  },
  "avd-three-vm-substrate": {
    title: "Private three-VM AVD substrate",
    summary:
      "Contributes a private Windows desktop and two auxiliary Linux nodes that a future lab could use.",
    learnerEvidence:
      "No learner-facing session was observed; only infrastructure and endpoint readiness were established.",
  },
  "oauth-application-reconnaissance": {
    title: "Application reconnaissance observation",
    summary:
      "Contributes a bounded, sanitized view of what one fictional application could inspect.",
    learnerEvidence:
      "Sanitized reachability counts and a sign-in summary without secrets or internal identifiers.",
  },
  "private-document-evidence": {
    title: "Private document staging",
    summary:
      "Contributes a private document and access relationship that a future investigation could use.",
    learnerEvidence:
      "Learner-visible access has not yet been observed, so this remains a staging capability rather than learner evidence.",
  },
};

export function createScenarioCatalog(
  registry: readonly unknown[],
): HTMLElement {
  const section = document.createElement("section");
  section.className = "scenario-catalog capability-catalog";
  section.setAttribute("aria-labelledby", "scenario-catalog-heading");

  const heading = document.createElement("h2");
  heading.id = "scenario-catalog-heading";
  heading.textContent = "Capability building blocks";
  section.append(
    heading,
    createStatus(
      "These are tested ingredients that can contribute evidence to a future lab. Each card is an atomic capability, not a complete learner lab.",
      "notice",
    ),
  );

  try {
    const manifests = registry.map(parseScenarioManifest);
    if (manifests.length === 0) {
      throw new Error("The canonical registry is empty.");
    }
    const cards = document.createElement("div");
    cards.className = "scenario-catalog-cards";
    for (const [index, manifest] of manifests.entries()) {
      cards.append(createCapabilityCard(manifest, index));
    }
    section.append(cards);
  } catch {
    section.append(
      createStatus(
        "Capability catalog unavailable: the validated building-block registry failed closed. No partial cards or controls were rendered.",
        "error",
      ),
    );
  }
  return section;
}

function createCapabilityCard(
  manifest: ScenarioManifest,
  index: number,
): HTMLElement {
  const presentation = CAPABILITY_PRESENTATIONS[manifest.id];
  if (presentation === undefined) {
    throw new Error("The validated capability lacks a learner presentation.");
  }
  const card = document.createElement("article");
  card.className = "scenario-catalog-card capability-catalog-card";

  const kind = document.createElement("p");
  kind.className = "capability-catalog-kind";
  kind.textContent = "Capability building block — not a lab";
  const heading = document.createElement("h3");
  heading.textContent = presentation.title;
  const purpose = document.createElement("p");
  purpose.className = "scenario-catalog-purpose";
  purpose.id = `scenario-catalog-purpose-${index + 1}`;
  purpose.textContent = presentation.summary;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "See building-block details";
  details.append(summary, createCapabilityDetails(manifest, presentation));
  card.append(kind, heading, purpose, details);
  return card;
}

function createCapabilityDetails(
  manifest: ScenarioManifest,
  presentation: CapabilityPresentation,
): HTMLElement {
  const content = document.createElement("div");
  content.className = "scenario-catalog-details";
  const learner = manifest.actors.find(({ id }) =>
    id === manifest.roles.learner
  );
  if (learner === undefined) {
    throw new Error("The validated capability lacks an evidence recipient.");
  }
  const storyAccounts = manifest.actors
    .filter(({ kind }) => kind === "simulated-user")
    .map(({ label }) => label);

  const people = catalogSection("People in a future learning experience");
  const peopleList = document.createElement("dl");
  peopleList.className = "scenario-catalog-list";
  appendIdentity(
    peopleList,
    "Human learner",
    "Not defined by this atomic building block. A complete lab must separately name the human learner and their responsibility.",
  );
  appendIdentity(
    peopleList,
    "Evidence recipient or workspace",
    `${learner.label}. This is where the building block expects observation or interpretation; it is not a complete human learner definition.`,
  );
  appendIdentity(
    peopleList,
    "Simulated story accounts",
    storyAccounts.length === 0
      ? "None are required by this building block."
      : `${storyAccounts.join(", ")}. These are fictional identities in the story, not the human learner.`,
  );
  people.append(peopleList);

  const evidence = catalogSection("What this building block can contribute");
  const evidenceList = document.createElement("dl");
  evidenceList.className = "scenario-catalog-list";
  appendIdentity(
    evidenceList,
    "Learner-facing evidence",
    presentation.learnerEvidence,
  );
  appendIdentity(
    evidenceList,
    "Evidence type",
    [...new Set(
      manifest.evidence.artifacts.map(({ kind }) => fixedLabel(kind)),
    )].join(", "),
  );
  appendIdentity(
    evidenceList,
    "Current proof boundary",
    proofBoundary(manifest),
  );
  evidence.append(evidenceList);

  const boundary = catalogSection("Why this is not a lab");
  boundary.append(createStatus(
    "This building block does not provide a complete story, a connected multi-signal evidence chain, a deliberate learner investigation, permitted decisions, and completion criteria.",
    "notice",
  ));
  content.append(people, evidence, boundary);
  return content;
}

function proofBoundary(manifest: ScenarioManifest): string {
  const artifacts = manifest.evidence.artifacts;
  const allObserved = artifacts.length > 0 &&
    artifacts.every(({ learnerVisibility }) => learnerVisibility === "observed");
  if (allObserved) {
    return "A learner-facing view has been observed for this atomic capability. That observation still does not prove a complete lab.";
  }
  return "A learner-facing view is not proven for every artifact in this building block. Platform acceptance or rehearsal readiness is not learner evidence.";
}

function catalogSection(title: string): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading);
  return section;
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
