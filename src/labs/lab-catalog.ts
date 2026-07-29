import { appendIdentity, createStatus } from "../ui/elements";
import {
  parseLearnerLabDefinition,
  type LearnerLabDefinition,
} from "./learner-lab";

export const LEARNER_LAB_CATALOG: readonly LearnerLabDefinition[] =
  Object.freeze([]);

export interface LabCatalogOptions {
  readonly knownCapabilityIds: ReadonlySet<string>;
}

export function createLabCatalog(
  registry: readonly unknown[],
  options: LabCatalogOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "lab-catalog";
  section.setAttribute("aria-labelledby", "lab-catalog-heading");
  const heading = document.createElement("h2");
  heading.id = "lab-catalog-heading";
  heading.textContent = "Lab catalog";
  section.append(
    heading,
    createStatus(
      "Labs are complete learner experiences. Capability building blocks are tested ingredients, not labs by themselves.",
      "notice",
    ),
    createMinimumShape(),
  );

  try {
    const labs = registry.map((value) =>
      parseLearnerLabDefinition(value, options.knownCapabilityIds)
    );
    if (labs.length === 0) {
      section.append(createStatus(
        "No complete labs are published yet. AP2 will show a lab here only after its story, human learner, connected evidence chain, investigation task, permitted actions, and completion criteria are deliberately authored and validated.",
        "notice",
      ));
      return section;
    }
    const cards = document.createElement("div");
    cards.className = "lab-catalog-cards";
    for (const lab of labs) {
      cards.append(createLabCard(lab));
    }
    section.append(cards);
  } catch {
    section.append(createStatus(
      "Lab catalog unavailable: a published lab did not satisfy the complete learner-experience contract. No partial lab cards were rendered.",
      "error",
    ));
  }
  return section;
}

function createMinimumShape(): HTMLElement {
  const section = document.createElement("section");
  section.className = "lab-catalog-requirements";
  const heading = document.createElement("h3");
  heading.textContent = "What qualifies as a lab";
  const list = document.createElement("ul");
  for (const requirement of [
    "A coherent story and learning objective.",
    "One human learner, clearly separate from simulated people, applications, devices, evidence recipients, detectors, and responders in the story.",
    "A connected evidence chain using at least two distinct capability building blocks.",
    "A learner investigation prompt that explains what to observe and reason about.",
    "Explicit permitted learner actions and completion criteria.",
  ]) {
    const item = document.createElement("li");
    item.textContent = requirement;
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function createLabCard(lab: LearnerLabDefinition): HTMLElement {
  const article = document.createElement("article");
  article.className = "lab-catalog-card";
  const heading = document.createElement("h3");
  heading.textContent = lab.title;
  const summary = document.createElement("p");
  summary.textContent = lab.summary;
  const details = document.createElement("dl");
  appendIdentity(details, "Learning objective", lab.learningObjective);
  appendIdentity(
    details,
    "Human learner",
    `${lab.humanLearner.label} — ${lab.humanLearner.responsibility}`,
  );
  appendIdentity(details, "Investigation", lab.investigationPrompt);
  appendIdentity(
    details,
    "Evidence chain",
    `${lab.evidenceChain.length} connected capability building blocks.`,
  );
  appendIdentity(
    details,
    "Permitted actions",
    lab.permittedActions.join(" "),
  );
  appendIdentity(
    details,
    "Completion",
    lab.completionCriteria.join(" "),
  );
  article.append(heading, summary, details);
  return article;
}
