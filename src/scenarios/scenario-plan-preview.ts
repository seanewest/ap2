import { appendIdentity, createStatus } from "../ui/elements";
import { isSafeScenarioPlanningRequest } from "../api/client";
import { SERVER_SHUTTING_DOWN_MESSAGE } from "../api/server-shutdown";
import { withApiSupportReference } from "../api/support-reference";
import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";
import type {
  ScenarioExecutionPlan,
  ScenarioPlanningRequest,
  ScenarioPlanRole,
  ScenarioPlanStep,
} from "./scenario-plan";
import type { ScenarioCatalogSelection } from "./scenario-catalog";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const SCENARIO_PLAN_PREVIEW_UI_CAPABILITY = {
  schemaVersion: 1,
  surface: "operator-plan-preview-ui",
  scenarioScope: "canonical-registry",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

const INPUT_ROLES = [
  ["evidenceProducer", "Evidence producer"],
  ["workloadActor", "Workload actor"],
  ["learner", "Learner"],
  ["detector", "Detector"],
  ["responder", "Responder"],
  ["cleanupOwner", "Cleanup owner"],
] as const satisfies readonly [
  Exclude<ScenarioPlanRole, "system">,
  string,
][];
const SAFE_ALIAS = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_BUDGET_USD = 1_000;
const MAX_PLAN_BYTES = 64_000;
const MAX_PLAN_STEPS = 128;

export type ScenarioPlanPreviewFailure =
  | "compiler-refused"
  | "response-too-large"
  | "server-shutting-down"
  | "session-expired"
  | "unauthorized"
  | "unavailable";

export interface ScenarioPlanPreviewClient {
  preview(request: ScenarioPlanningRequest): Promise<ScenarioExecutionPlan>;
  classifyError(error: unknown): ScenarioPlanPreviewFailure;
}

export interface ScenarioPlanPreviewOptions {
  registry: readonly unknown[];
  client: ScenarioPlanPreviewClient;
  now?: () => Date;
}

export interface ScenarioPlanPreviewController {
  element: HTMLElement;
  selectScenario(selection: ScenarioCatalogSelection): boolean;
}

export function createScenarioPlanPreview(
  options: ScenarioPlanPreviewOptions,
): HTMLElement {
  return createScenarioPlanPreviewController(options).element;
}

export function createScenarioPlanPreviewController(
  options: ScenarioPlanPreviewOptions,
): ScenarioPlanPreviewController {
  const section = document.createElement("section");
  section.className = "scenario-plan-preview";
  section.setAttribute("aria-labelledby", "scenario-plan-preview-heading");

  const heading = document.createElement("h2");
  heading.id = "scenario-plan-preview-heading";
  heading.textContent = "Scenario plan preview";
  section.append(
    heading,
    createStatus(
      "Preview only. This does not authorize, schedule, or perform work, and it is not proof that any external operation occurred.",
      "notice",
    ),
  );

  let manifests: readonly ScenarioManifest[];
  try {
    manifests = options.registry.map(parseScenarioManifest);
    if (manifests.length === 0) {
      throw new Error("empty registry");
    }
  } catch {
    section.append(createStatus(
      "Plan preview unavailable: canonical registry validation failed. No request can be submitted.",
      "error",
    ));
    return {
      element: section,
      selectScenario: () => false,
    };
  }

  const form = document.createElement("form");
  form.className = "scenario-plan-preview-form";
  form.noValidate = true;
  const scenarioField = document.createElement("label");
  scenarioField.textContent = "Canonical scenario";
  const scenarioSelect = document.createElement("select");
  scenarioSelect.name = "scenario";
  for (const [index, manifest] of manifests.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = manifest.title;
    scenarioSelect.append(option);
  }
  scenarioField.append(scenarioSelect);

  const controls = document.createElement("div");
  controls.className = "scenario-plan-preview-controls";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Preview plan";
  const output = document.createElement("div");
  output.className = "scenario-plan-preview-output";
  output.setAttribute("aria-live", "polite");
  output.tabIndex = -1;
  form.append(scenarioField, controls, submit);
  section.append(form, output);

  let revision = 0;
  let loading = false;
  const clearOutput = (message?: string): void => {
    revision += 1;
    output.replaceChildren(createStatus(
      message ??
        "No preview requested. Complete the bounded fields and select Preview plan.",
    ));
  };
  const selectedManifest = (): ScenarioManifest =>
    manifests[Number(scenarioSelect.value)] ?? manifests[0]!;

  const rebuildControls = (): void => {
    controls.replaceChildren(...createInputControls(selectedManifest()));
    for (const input of controls.querySelectorAll("input, select")) {
      input.addEventListener("input", () => clearOutput());
      input.addEventListener("change", () => clearOutput());
    }
  };
  scenarioSelect.addEventListener("change", () => {
    rebuildControls();
    clearOutput();
  });

  const selectScenario = (
    selection: ScenarioCatalogSelection,
  ): boolean => {
    const matches = manifests
      .map((manifest, index) => ({ manifest, index }))
      .filter(({ manifest }) =>
        manifest.id === selection.scenarioId &&
        manifest.schemaVersion === selection.schemaVersion
      );
    if (matches.length !== 1) {
      if (loading) {
        loading = false;
        setLoading(form, submit, false);
      }
      clearOutput(
        "Catalog selection unavailable: the exact canonical scenario version could not be resolved.",
      );
      return false;
    }
    revision += 1;
    loading = false;
    scenarioSelect.value = String(matches[0]!.index);
    rebuildControls();
    setLoading(form, submit, false);
    output.replaceChildren(createStatus(
      `Selected ${matches[0]!.manifest.title}, registry version ${
        matches[0]!.manifest.schemaVersion
      }. Review the bounded fields and select Preview plan.`,
    ));
    scenarioSelect.focus();
    return true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    const manifest = selectedManifest();
    const request = buildRequest(form, manifest, options.now ?? (() => new Date()));
    if (typeof request === "string") {
      output.replaceChildren(createStatus(request, "error"));
      output.focus();
      return;
    }
    const submittedRevision = revision;
    setLoading(form, submit, true);
    loading = true;
    output.replaceChildren(createStatus(
      "Preparing the deterministic preview…",
    ));
    void options.client.preview(request).then((plan) => {
      if (revision !== submittedRevision) {
        return;
      }
      const failure = validatePlanForDisplay(plan, manifest);
      output.replaceChildren(
        failure
          ? createStatus(failureMessage(failure), "error")
          : createPlanResult(plan, manifest),
      );
      output.focus();
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) {
        return;
      }
      let failure: ScenarioPlanPreviewFailure = "unavailable";
      try {
        failure = options.client.classifyError(error);
      } catch {
        // Keep the fixed general failure.
      }
      output.replaceChildren(createStatus(
        withApiSupportReference(failureMessage(failure), error),
        "error",
      ));
      output.focus();
    }).finally(() => {
      if (revision === submittedRevision) {
        loading = false;
        setLoading(form, submit, false);
      }
    });
  });

  rebuildControls();
  clearOutput();
  return {
    element: section,
    selectScenario,
  };
}

function createInputControls(manifest: ScenarioManifest): HTMLElement[] {
  const roleActors = assignedRoleActors(manifest);
  const aliasByActor = new Map<string, string>();
  let aliasSequence = 0;
  const roleFields = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Sanitized role aliases";
  roleFields.append(legend);
  for (const [role, label] of INPUT_ROLES) {
    const actorId = roleActors[role];
    if (!actorId) {
      continue;
    }
    let alias = aliasByActor.get(actorId);
    if (!alias) {
      aliasSequence += 1;
      alias = `actor-${aliasSequence}`;
      aliasByActor.set(actorId, alias);
    }
    const field = document.createElement("label");
    field.textContent = `${label} alias`;
    const input = document.createElement("input");
    input.name = `alias-${role}`;
    input.value = alias;
    input.required = true;
    input.minLength = 2;
    input.maxLength = 32;
    input.pattern = "[a-z][a-z0-9-]{1,31}";
    input.autocomplete = "off";
    input.spellcheck = false;
    field.append(input);
    roleFields.append(field);
  }

  const bounds = document.createElement("fieldset");
  const boundsLegend = document.createElement("legend");
  boundsLegend.textContent = "Budget and expiry";
  const budget = document.createElement("input");
  budget.name = "maximumBudgetUsd";
  budget.type = "number";
  budget.required = true;
  budget.min = "0";
  budget.max = String(MAX_BUDGET_USD);
  budget.step = "0.01";
  budget.value = String(manifest.cost.laneMaximum);
  const budgetField = document.createElement("label");
  budgetField.textContent = "Maximum budget (USD)";
  budgetField.append(budget);

  const expiry = document.createElement("input");
  expiry.name = "expiryHours";
  expiry.type = "number";
  expiry.required = true;
  expiry.min = "0.25";
  expiry.max = String(manifest.cost.conservativeDurationHours);
  expiry.step = "0.25";
  expiry.value = String(manifest.cost.conservativeDurationHours);
  const expiryField = document.createElement("label");
  expiryField.textContent =
    `Expiry window (hours, maximum ${manifest.cost.conservativeDurationHours})`;
  expiryField.append(expiry);
  bounds.append(boundsLegend, budgetField, expiryField);

  const responseField = document.createElement("label");
  responseField.textContent = "Optional response";
  const response = document.createElement("select");
  response.name = "selectedResponse";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No optional response";
  response.append(none);
  for (const [index, action] of manifest.responseActions.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${fixedLabel(action.kind)} — ${action.summary}`;
    response.append(option);
  }
  responseField.append(response);
  return [roleFields, bounds, responseField];
}

function buildRequest(
  form: HTMLFormElement,
  manifest: ScenarioManifest,
  now: () => Date,
): ScenarioPlanningRequest | string {
  const data = new FormData(form);
  const roleActors = assignedRoleActors(manifest);
  const aliasByActor = new Map<string, string>();
  const actorAliases: ScenarioPlanningRequest["actorAliases"] = {};
  for (const [role] of INPUT_ROLES) {
    const actorId = roleActors[role];
    if (!actorId) {
      continue;
    }
    const alias = data.get(`alias-${role}`);
    if (typeof alias !== "string" || !SAFE_ALIAS.test(alias)) {
      return "Use 2–32 lowercase ASCII letters, numbers, or hyphens for every alias; raw identifiers are not accepted.";
    }
    const prior = aliasByActor.get(actorId);
    if (prior !== undefined && prior !== alias) {
      return "Roles assigned to the same canonical actor must use the same sanitized alias.";
    }
    if ([...aliasByActor.entries()].some(
      ([otherActor, otherAlias]) => otherActor !== actorId && otherAlias === alias,
    )) {
      return "Distinct canonical actors must use distinct sanitized aliases.";
    }
    aliasByActor.set(actorId, alias);
    actorAliases[role] = alias;
  }

  const maximumBudgetUsd = Number(data.get("maximumBudgetUsd"));
  if (
    !Number.isFinite(maximumBudgetUsd) ||
    maximumBudgetUsd < manifest.cost.laneMaximum ||
    maximumBudgetUsd > MAX_BUDGET_USD
  ) {
    return `Budget must cover the catalog maximum of USD ${manifest.cost.laneMaximum} and cannot exceed USD ${MAX_BUDGET_USD}.`;
  }
  const expiryHours = Number(data.get("expiryHours"));
  if (
    !Number.isFinite(expiryHours) ||
    expiryHours <= 0 ||
    expiryHours > manifest.cost.conservativeDurationHours
  ) {
    return `Expiry must be greater than zero and no more than ${manifest.cost.conservativeDurationHours} hours.`;
  }
  const generatedAt = now();
  if (!Number.isFinite(generatedAt.getTime())) {
    return "Plan preview is unavailable because the local time boundary is invalid.";
  }
  const expiresAt = new Date(
    generatedAt.getTime() + expiryHours * 3_600_000,
  );
  if (expiresAt.getTime() > Date.parse(manifest.lifecycle.expiresAt)) {
    return "The requested window extends beyond the scenario expiry boundary.";
  }

  const responseIndex = data.get("selectedResponse");
  let selectedResponseId: string | undefined;
  if (responseIndex !== "") {
    const index = typeof responseIndex === "string"
      ? Number(responseIndex)
      : Number.NaN;
    const action = Number.isInteger(index)
      ? manifest.responseActions[index]
      : undefined;
    if (!action) {
      return "The selected response is not supported by this scenario.";
    }
    selectedResponseId = action.id;
  }
  const request = {
    scenarioId: manifest.id,
    actorAliases,
    now: generatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maximumBudgetUsd,
    ...(selectedResponseId ? { selectedResponseId } : {}),
  };
  return isSafeScenarioPlanningRequest(request)
    ? request
    : "Aliases must be opaque and sanitized; identity, tenant, credential, token, session, and other raw-identifier terms are not accepted.";
}

function createPlanResult(
  plan: ScenarioExecutionPlan,
  manifest: ScenarioManifest,
): HTMLElement {
  const result = document.createElement("section");
  result.className = "scenario-plan-preview-result";
  result.setAttribute("aria-label", "Plan preview result");
  const heading = document.createElement("h3");
  heading.textContent = "Deterministic preview";
  const summary = document.createElement("dl");
  summary.className = "scenario-plan-preview-summary";
  appendIdentity(summary, "Scenario", manifest.title);
  appendIdentity(
    summary,
    "Budget",
    `USD ${plan.budget.plannedMaximum} planned; USD ${plan.budget.suppliedCeiling} ceiling`,
  );
  appendIdentity(summary, "Expires", plan.expiresAt);
  appendIdentity(summary, "Plan digest", plan.digestSha256.slice(0, 12));
  appendIdentity(summary, "Learner task", manifest.learner.task);
  appendIdentity(
    summary,
    "Learner interpretation",
    manifest.learner.expectedInterpretation,
  );
  const selectedResponse = plan.selectedResponseId === null
    ? undefined
    : manifest.responseActions.find(({ id }) => id === plan.selectedResponseId);
  appendIdentity(
    summary,
    "Optional response",
    selectedResponse
      ? `${fixedLabel(selectedResponse.kind)} — ${selectedResponse.summary}`
      : "No optional response selected.",
  );
  result.append(heading, summary, createPlanSteps(plan.steps));

  const terminal = document.createElement("dl");
  terminal.className = "scenario-plan-preview-summary";
  appendIdentity(
    terminal,
    "Terminal proof",
    `${fixedLabel(plan.terminalProof.requiredResult)}; ${
      plan.terminalProof.cleanupOperationKeys.length
    } cleanup check(s), ${
      plan.terminalProof.evidenceArtifactIds.length
    } evidence check(s), ${
      plan.terminalProof.observationOperationKeys.length
    } observation check(s), and ${
      plan.terminalProof.retainedArtifactIds.length
    } retained artifact check(s).`,
  );
  result.append(catalogSubsection("Terminal verification", terminal));

  const limitations = document.createElement("ul");
  limitations.className = "scenario-plan-preview-limitations";
  limitations.append(
    listItem("Execution — this preview performs and authorizes nothing."),
    listItem(
      `Human gates — ${
        plan.steps.filter(({ humanOnlyGate }) => humanOnlyGate).length
      } step(s) still require a person.`,
    ),
    listItem(
      "Ambiguity — mutation-shaped steps stop for read-only reconciliation and are never automatically replayed.",
    ),
    listItem(
      `Learner state — ${fixedLabel(manifest.learner.completionState)}; the preview is not completion evidence.`,
    ),
  );
  result.append(catalogSubsection("Categorical limitations", limitations));
  return result;
}

function createPlanSteps(steps: readonly ScenarioPlanStep[]): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = "Ordered phases and ownership";
  const list = document.createElement("ol");
  list.className = "scenario-plan-preview-steps";
  for (const step of steps) {
    const item = document.createElement("li");
    const title = document.createElement("h5");
    title.textContent = `${fixedLabel(step.phase)} — ${
      fixedLabel(step.owningRole)
    }`;
    const details = document.createElement("dl");
    details.className = "scenario-plan-preview-step";
    appendIdentity(details, "Execution", fixedLabel(step.execution));
    appendIdentity(
      details,
      "Human-only gate",
      step.humanOnlyGate ? "Required" : "No",
    );
    appendIdentity(
      details,
      "Ambiguity",
      fixedLabel(step.ambiguityBehavior),
    );
    appendIdentity(
      details,
      "Recovery",
      fixedLabel(step.recoveryBehavior),
    );
    if (step.evidenceExpectation) {
      appendIdentity(
        details,
        "Evidence expectation",
        `${fixedLabel(step.evidenceExpectation.artifactKind)}; ${
          fixedLabel(step.evidenceExpectation.authenticity)
        }; ${fixedLabel(step.evidenceExpectation.evidenceMode)}; learner visibility ${
          fixedLabel(step.evidenceExpectation.learnerVisibility)
        }.`,
      );
    }
    if (step.retention) {
      appendIdentity(
        details,
        "Retention",
        fixedLabel(step.retention.disposition),
      );
    }
    item.append(title, details);
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function validatePlanForDisplay(
  plan: ScenarioExecutionPlan,
  manifest: ScenarioManifest,
): ScenarioPlanPreviewFailure | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(plan);
  } catch {
    return "unavailable";
  }
  if (serialized.length > MAX_PLAN_BYTES || plan.steps.length > MAX_PLAN_STEPS) {
    return "response-too-large";
  }
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== "scenario-execution-plan" ||
    plan.scenarioId !== manifest.id ||
    !/^[0-9a-f]{64}$/.test(plan.digestSha256) ||
    !Number.isFinite(plan.budget.plannedMaximum) ||
    !Number.isFinite(plan.budget.suppliedCeiling) ||
    plan.budget.plannedMaximum < 0 ||
    plan.budget.plannedMaximum > plan.budget.suppliedCeiling ||
    plan.budget.suppliedCeiling > MAX_BUDGET_USD ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      plan.expiresAt,
    ) ||
    (
      plan.selectedResponseId !== null &&
      !manifest.responseActions.some(({ id }) => id === plan.selectedResponseId)
    ) ||
    plan.terminalProof.requiredResult !== "reconciled" ||
    plan.steps.some((step, index) => step.sequence !== index + 1)
  ) {
    return "unavailable";
  }
  return undefined;
}

function failureMessage(failure: ScenarioPlanPreviewFailure): string {
  switch (failure) {
    case "unauthorized":
      return "Plan preview was refused because this operator is not authorized.";
    case "session-expired":
      return "The operator session expired. Sign in again before requesting another preview.";
    case "compiler-refused":
      return "The planner refused this bounded request. Review the scenario inputs; no work was performed.";
    case "response-too-large":
      return "The planner response exceeded the safe preview limit and was not displayed.";
    case "unavailable":
      return "Plan preview is unavailable. No work was performed; try again only with a new manual request.";
    case "server-shutting-down":
      return SERVER_SHUTTING_DOWN_MESSAGE;
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

function setLoading(
  form: HTMLFormElement,
  submit: HTMLButtonElement,
  loading: boolean,
): void {
  form.setAttribute("aria-busy", String(loading));
  submit.disabled = loading;
  for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "input, select",
  )) {
    control.disabled = loading;
  }
}

function catalogSubsection(title: string, content: HTMLElement): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading, content);
  return section;
}

function listItem(text: string): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function fixedLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[.-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
