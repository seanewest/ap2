import { appendIdentity, createStatus } from "../ui/elements";
import type { LearnerEvidenceBriefing } from "./learner-evidence-briefing";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const LEARNER_EVIDENCE_BRIEFING_UI_CAPABILITY = {
  schemaVersion: 1,
  surface: "learner-evidence-briefing-ui",
  scenarioScope: "explicit-scenarios",
  scenarioIds: ["help-desk-email-observation"],
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export function createLearnerEvidenceBriefingRoute(
  briefing: LearnerEvidenceBriefing,
): HTMLElement {
  const main = document.createElement("main");
  main.className = "learner-evidence-briefing-route";
  main.setAttribute("aria-labelledby", "learner-evidence-briefing-heading");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "LEARNER EVIDENCE BRIEFING";
  const heading = document.createElement("h1");
  heading.id = "learner-evidence-briefing-heading";
  heading.textContent = briefing.scenario.title;
  const context = document.createElement("p");
  context.className = "introduction";
  context.textContent = briefing.scenario.context;

  const summary = document.createElement("dl");
  summary.className = "learner-evidence-briefing-summary";
  appendIdentity(summary, "Evidence type", briefing.evidence.type);
  appendIdentity(summary, "Evidence status", briefing.evidence.status);
  appendIdentity(
    summary,
    "Briefing prepared",
    briefing.evidence.briefingTime,
  );
  appendIdentity(
    summary,
    briefing.producer.roleLabel,
    briefing.producer.identityLabel,
  );
  appendIdentity(
    summary,
    briefing.learner.roleLabel,
    briefing.learner.identityLabel,
  );
  appendIdentity(summary, "Support reference", briefing.supportReference);

  const taskHeading = document.createElement("h2");
  taskHeading.textContent = "Observation task";
  const task = document.createElement("p");
  task.textContent = briefing.observationTask;
  const interpretationHeading = document.createElement("h2");
  interpretationHeading.textContent = "Expected interpretation";
  const interpretation = document.createElement("p");
  interpretation.textContent = briefing.expectedInterpretation;
  const actionsHeading = document.createElement("h2");
  actionsHeading.textContent = "Permitted learner actions";
  const actions = document.createElement("ul");
  for (const action of briefing.permittedActions) {
    const item = document.createElement("li");
    item.textContent = action.label;
    actions.append(item);
  }
  main.append(
    eyebrow,
    heading,
    context,
    summary,
    taskHeading,
    task,
    interpretationHeading,
    interpretation,
    actionsHeading,
    actions,
    createStatus(
      "This read-only briefing does not stage, regenerate, retry, reply to, forward, delete, or clean up evidence.",
      "notice",
    ),
  );
  return main;
}
