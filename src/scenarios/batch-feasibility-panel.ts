import { appendIdentity, createStatus } from "../ui/elements";
import { isSafeScenarioPlanningRequest } from "../api/client";
import { SERVER_SHUTTING_DOWN_MESSAGE } from "../api/server-shutdown";
import { withApiSupportReference } from "../api/support-reference";
import {
  BATCH_FEASIBILITY_MAX_PLANS,
  isBoundedBatchFeasibilityRequest,
  isSafeBatchFeasibilityResult,
  type BatchFeasibilityRequest,
} from "../api/multi-scenario-feasibility-contract";
import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";
import type {
  FeasibilityBlocker,
  MultiScenarioFeasibilityResult,
} from "./multi-scenario-feasibility";
import type {
  ScenarioPlanningRequest,
  ScenarioPlanRole,
} from "./scenario-plan";

const MAX_BATCH_ITEMS = BATCH_FEASIBILITY_MAX_PLANS;
const MAX_AGGREGATE_BUDGET_USD = 1_000_000;
const MAX_DURATION_MINUTES = 7 * 24 * 60;
const SAFE_ALIAS = /^[a-z][a-z0-9-]{1,31}$/;
const USD = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;
const PLAN_ROLES = [
  "evidenceProducer",
  "workloadActor",
  "learner",
  "detector",
  "responder",
  "cleanupOwner",
] as const satisfies readonly Exclude<ScenarioPlanRole, "system">[];
export type BatchFeasibilityPanelFailure =
  | "planner-refused"
  | "request-too-large"
  | "response-too-large"
  | "server-shutting-down"
  | "session-expired"
  | "unauthorized"
  | "unavailable";

export interface BatchFeasibilityPanelClient {
  evaluate(
    request: BatchFeasibilityRequest,
  ): Promise<MultiScenarioFeasibilityResult>;
  classifyError(error: unknown): BatchFeasibilityPanelFailure;
}

export interface BatchFeasibilityPanelOptions {
  registry: readonly unknown[];
  client: BatchFeasibilityPanelClient;
  now?: () => Date;
}

export function createBatchFeasibilityPanel(
  options: BatchFeasibilityPanelOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "batch-feasibility";
  section.setAttribute("aria-labelledby", "batch-feasibility-heading");
  const heading = document.createElement("h2");
  heading.id = "batch-feasibility-heading";
  heading.textContent = "Scenario batch feasibility";
  section.append(
    heading,
    createStatus(
      "Feasibility is conservative planning arithmetic only. It does not schedule, reserve, price, authorize, or execute work and does not check quota, capacity, availability, or live prices.",
      "notice",
    ),
  );

  let manifests: readonly ScenarioManifest[];
  try {
    manifests = options.registry.map(parseScenarioManifest);
    if (manifests.length === 0) throw new Error("empty registry");
  } catch {
    section.append(createStatus(
      "Batch feasibility unavailable: canonical registry validation failed. No request can be submitted.",
      "error",
    ));
    return section;
  }

  const form = document.createElement("form");
  form.className = "batch-feasibility-form";
  form.noValidate = true;
  const batchFieldset = document.createElement("fieldset");
  const batchLegend = document.createElement("legend");
  batchLegend.textContent = "Canonical scenario batch";
  const rows = document.createElement("div");
  rows.className = "batch-feasibility-rows";
  const add = button("Add scenario", "secondary");
  add.dataset.action = "add-scenario";
  batchFieldset.append(batchLegend, rows, add);
  const session = createSessionControls();
  const submit = button("Evaluate feasibility", "primary");
  submit.type = "submit";
  const output = document.createElement("div");
  output.className = "batch-feasibility-output";
  output.setAttribute("aria-live", "polite");
  output.tabIndex = -1;
  form.append(batchFieldset, session, submit);
  section.append(form, output);

  let revision = 0;
  let loading = false;
  let nextRowId = 1;
  const clear = (message?: string): void => {
    revision += 1;
    output.replaceChildren(createStatus(
      message ??
        "Batch changed. Select Evaluate feasibility to assess the current local inputs.",
    ));
  };
  const changed = (): void => clear();
  const refreshRows = (): void => {
    const rowList = [...rows.querySelectorAll<HTMLElement>(
      ".batch-feasibility-row",
    )];
    for (const [index, row] of rowList.entries()) {
      row.querySelector<HTMLElement>(".batch-feasibility-row-number")!
        .textContent = `Scenario ${index + 1}`;
      const up = row.querySelector<HTMLButtonElement>(
        "[data-action='move-up']",
      )!;
      const down = row.querySelector<HTMLButtonElement>(
        "[data-action='move-down']",
      )!;
      const remove = row.querySelector<HTMLButtonElement>(
        "[data-action='remove']",
      )!;
      up.disabled = index === 0;
      down.disabled = index === rowList.length - 1;
      remove.disabled = rowList.length === 1;
      up.setAttribute("aria-label", `Move up scenario ${index + 1}`);
      down.setAttribute("aria-label", `Move down scenario ${index + 1}`);
      remove.setAttribute("aria-label", `Remove scenario ${index + 1}`);
    }
    add.disabled = rowList.length >= MAX_BATCH_ITEMS;
  };
  const addRow = (): void => {
    const row = createBatchRow(manifests, nextRowId++, changed);
    rows.append(row);
    refreshRows();
    clear();
  };
  add.addEventListener("click", addRow);
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);

  rows.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const row = target.closest<HTMLElement>(".batch-feasibility-row");
    if (!row) return;
    switch (target.dataset.action) {
      case "remove":
        row.remove();
        break;
      case "move-up":
        if (row.previousElementSibling) rows.insertBefore(
          row,
          row.previousElementSibling,
        );
        break;
      case "move-down":
        if (row.nextElementSibling) rows.insertBefore(
          row.nextElementSibling,
          row,
        );
        break;
      default:
        return;
    }
    refreshRows();
    clear();
    row.querySelector<HTMLElement>("select, input")?.focus();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loading) return;
    const request = buildRequest(
      form,
      manifests,
      options.now ?? (() => new Date()),
    );
    if (typeof request === "string") {
      output.replaceChildren(createStatus(request, "error"));
      output.focus();
      return;
    }
    const submittedRevision = revision;
    loading = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    output.replaceChildren(createStatus(
      "Evaluating the bounded batch without scheduling or execution…",
    ));
    void options.client.evaluate(request).then((result) => {
      if (revision !== submittedRevision) return;
      output.replaceChildren(
        isSafeBatchFeasibilityResult(result, request)
          ? createResult(result)
          : createStatus(failureMessage("unavailable"), "error"),
      );
      output.focus();
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) return;
      let failure: BatchFeasibilityPanelFailure = "unavailable";
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
      loading = false;
      submit.disabled = false;
      form.setAttribute("aria-busy", "false");
    });
  });

  addRow();
  clear(
    "No feasibility evaluation requested. Build a bounded batch and select Evaluate feasibility.",
  );
  return section;
}

function createBatchRow(
  manifests: readonly ScenarioManifest[],
  id: number,
  changed: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "batch-feasibility-row";
  const heading = document.createElement("h3");
  heading.className = "batch-feasibility-row-number";
  const scenarioField = document.createElement("label");
  scenarioField.textContent = "Canonical scenario";
  const scenario = document.createElement("select");
  scenario.name = "batchScenario";
  for (const [index, manifest] of manifests.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = manifest.title;
    scenario.append(option);
  }
  scenarioField.append(scenario);
  const aliasField = document.createElement("label");
  aliasField.textContent = "Local instance alias";
  const alias = document.createElement("input");
  alias.name = "batchAlias";
  alias.required = true;
  alias.minLength = 2;
  alias.maxLength = 32;
  alias.pattern = "[a-z][a-z0-9-]{1,31}";
  alias.autocomplete = "off";
  alias.spellcheck = false;
  alias.value = `scenario-${id}`;
  aliasField.append(alias);
  const actions = document.createElement("div");
  actions.className = "batch-feasibility-row-actions";
  for (const [action, label] of [
    ["move-up", "Move up"],
    ["move-down", "Move down"],
    ["remove", "Remove"],
  ] as const) {
    const control = button(label, "secondary");
    control.dataset.action = action;
    control.addEventListener("click", changed);
    actions.append(control);
  }
  row.append(heading, scenarioField, aliasField, actions);
  return row;
}

function createSessionControls(): HTMLElement {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Session bounds";
  fieldset.append(
    legend,
    numberField("Aggregate budget ceiling (USD)", "aggregateBudget", {
      min: "0",
      max: String(MAX_AGGREGATE_BUDGET_USD),
      step: "0.01",
      value: "100",
    }),
    numberField("Concurrency limit", "concurrencyLimit", {
      min: "1",
      max: String(MAX_BATCH_ITEMS),
      step: "1",
      value: "1",
    }),
    numberField("Session duration (minutes)", "durationMinutes", {
      min: "1",
      max: String(MAX_DURATION_MINUTES),
      step: "1",
      value: "10",
    }),
    numberField("Minimum expiry margin (minutes)", "expiryMarginMinutes", {
      min: "0",
      max: String(MAX_DURATION_MINUTES),
      step: "1",
      value: "5",
    }),
  );
  const policyField = document.createElement("label");
  policyField.textContent = "Human-gate policy";
  const policy = document.createElement("select");
  policy.name = "humanGatePolicy";
  for (const [value, text] of [
    ["allow", "Allow declared human-only gates"],
    ["refuse", "Treat any human-only gate as infeasible"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    policy.append(option);
  }
  policyField.append(policy);
  fieldset.append(policyField);
  return fieldset;
}

function buildRequest(
  form: HTMLFormElement,
  manifests: readonly ScenarioManifest[],
  now: () => Date,
): BatchFeasibilityRequest | string {
  const rowList = [...form.querySelectorAll<HTMLElement>(
    ".batch-feasibility-row",
  )];
  if (rowList.length === 0 || rowList.length > MAX_BATCH_ITEMS) {
    return `Choose between 1 and ${MAX_BATCH_ITEMS} canonical scenarios.`;
  }
  const startsAt = now();
  if (!Number.isFinite(startsAt.getTime())) {
    return "Local validation failed because the session clock is invalid.";
  }
  const duration = integer(form, "durationMinutes", 1, MAX_DURATION_MINUTES);
  const margin = integer(form, "expiryMarginMinutes", 0, MAX_DURATION_MINUTES);
  const concurrency = integer(form, "concurrencyLimit", 1, MAX_BATCH_ITEMS);
  if (duration === undefined || margin === undefined) {
    return "Duration and expiry margin must be bounded whole minutes.";
  }
  if (concurrency === undefined) {
    return `Concurrency must be a whole number from 1 through ${MAX_BATCH_ITEMS}.`;
  }
  const budgetValue = form.elements.namedItem("aggregateBudget");
  const budget = budgetValue instanceof HTMLInputElement
    ? budgetValue.value
    : "";
  if (
    !USD.test(budget) ||
    Number(budget) > MAX_AGGREGATE_BUDGET_USD
  ) {
    return "Aggregate budget must be a bounded USD amount with at most two decimal places.";
  }
  const policyValue = form.elements.namedItem("humanGatePolicy");
  const policy = policyValue instanceof HTMLSelectElement
    ? policyValue.value
    : "";
  if (policy !== "allow" && policy !== "refuse") {
    return "Choose one fixed human-gate policy.";
  }

  const aliases = new Set<string>();
  const plans: BatchFeasibilityRequest["plans"][number][] = [];
  const expiresAtMs = startsAt.getTime() + (duration + margin) * 60_000;
  for (const row of rowList) {
    const scenario = row.querySelector<HTMLSelectElement>(
      "select[name='batchScenario']",
    );
    const alias = row.querySelector<HTMLInputElement>(
      "input[name='batchAlias']",
    )?.value ?? "";
    const manifest = scenario
      ? manifests[Number(scenario.value)]
      : undefined;
    if (!manifest) {
      return "Every batch item must resolve to one canonical registry scenario.";
    }
    if (!SAFE_ALIAS.test(alias)) {
      return "Use distinct 2–32 character lowercase local aliases containing only letters, numbers, and hyphens.";
    }
    if (aliases.has(alias)) {
      return "Every scenario instance must use a distinct local alias.";
    }
    aliases.add(alias);
    if (
      duration + margin >
        manifest.cost.conservativeDurationHours * 60 ||
      expiresAtMs > Date.parse(manifest.lifecycle.expiresAt)
    ) {
      return "The requested session and expiry margin exceed at least one selected catalog scenario boundary.";
    }
    const planningRequest: ScenarioPlanningRequest = {
      scenarioId: manifest.id,
      actorAliases: derivedAliases(manifest, alias),
      now: startsAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      maximumBudgetUsd: manifest.cost.laneMaximum,
    };
    if (!isSafeScenarioPlanningRequest(planningRequest)) {
      return "Local validation refused an unsafe or noncanonical planning input.";
    }
    plans.push({ instanceAlias: alias, planRequest: planningRequest });
  }
  const request: BatchFeasibilityRequest = {
    schemaVersion: 1,
    label: "SCENARIO_FEASIBILITY_COMPILE_REQUEST",
    session: {
      startsAt: startsAt.toISOString(),
      requestedDurationMinutes: duration,
      aggregateBudgetCeilingUsd: normalizeUsd(budget),
      concurrencyLimit: concurrency,
      minimumExpiryMarginMinutes: margin,
      humanGatePolicy: policy,
    },
    plans,
  };
  return isBoundedBatchFeasibilityRequest(
      request,
      isSafeScenarioPlanningRequest,
    )
    ? request
    : "Local validation refused an unsafe or noncanonical batch request.";
}

function derivedAliases(
  manifest: ScenarioManifest,
  instanceAlias: string,
): ScenarioPlanningRequest["actorAliases"] {
  const roleActors: Record<
    Exclude<ScenarioPlanRole, "system">,
    string | undefined
  > = {
    evidenceProducer: manifest.roles.evidenceProducer,
    workloadActor: manifest.roles.workloadActor,
    learner: manifest.roles.learner,
    detector: manifest.roles.detector,
    responder: manifest.roles.responder,
    cleanupOwner: manifest.lifecycle.cleanupOwnerActorId,
  };
  const aliasByActor = new Map<string, string>();
  const aliases: ScenarioPlanningRequest["actorAliases"] = {};
  let sequence = 0;
  for (const role of PLAN_ROLES) {
    const actorId = roleActors[role];
    if (!actorId) continue;
    let alias = aliasByActor.get(actorId);
    if (!alias) {
      sequence += 1;
      alias = `${instanceAlias}-${sequence}`;
      aliasByActor.set(actorId, alias);
    }
    aliases[role] = alias;
  }
  return aliases;
}

function createResult(result: MultiScenarioFeasibilityResult): HTMLElement {
  const section = document.createElement("section");
  section.className = "batch-feasibility-result";
  section.setAttribute("aria-label", "Batch feasibility result");
  const heading = document.createElement("h3");
  heading.textContent = result.status === "feasible"
    ? "Batch is arithmetically feasible"
    : "Batch is arithmetically infeasible";
  const summary = document.createElement("dl");
  summary.className = "batch-feasibility-summary";
  appendIdentity(summary, "Plans", String(result.planCount));
  appendIdentity(
    summary,
    "Conservative aggregate ceiling",
    result.conservativeAggregateUsdCeiling === null
      ? "Unknown"
      : `USD ${result.conservativeAggregateUsdCeiling}`,
  );
  appendIdentity(
    summary,
    "Maximum concurrency",
    String(result.maximumConcurrency),
  );
  appendIdentity(
    summary,
    "Session duration",
    `${result.requestedSessionDurationMinutes} minutes`,
  );
  appendIdentity(
    summary,
    "Earliest expiry margin",
    result.earliestExpiryMarginMinutes === null
      ? "Unknown"
      : `${result.earliestExpiryMarginMinutes} minutes`,
  );
  appendIdentity(summary, "Human-only gates", String(result.humanGateCount));
  const blockerSection = document.createElement("section");
  const blockerHeading = document.createElement("h4");
  blockerHeading.textContent = "Categorical blockers";
  const blockers = document.createElement("ul");
  if (result.blockers.length === 0) {
    const item = document.createElement("li");
    item.textContent = "None in this deterministic calculation.";
    blockers.append(item);
  } else {
    for (const blocker of result.blockers) {
      const item = document.createElement("li");
      item.textContent = blockerLabel(blocker);
      blockers.append(item);
    }
  }
  blockerSection.append(blockerHeading, blockers);
  section.append(
    heading,
    summary,
    blockerSection,
    createStatus(
      "This result is not a schedule, reservation, availability or quota check, live price, authorization, execution, or proof of external work.",
      "notice",
    ),
  );
  return section;
}

function failureMessage(failure: BatchFeasibilityPanelFailure): string {
  switch (failure) {
    case "session-expired":
      return "Feasibility evaluation stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to evaluate scenario feasibility.";
    case "planner-refused":
      return "The feasibility planner refused the batch because a canonical plan or bound was invalid.";
    case "request-too-large":
      return "Feasibility evaluation stopped at the safe request-size limit.";
    case "response-too-large":
      return "Feasibility evaluation stopped at the safe response-size limit.";
    case "unavailable":
      return "Feasibility evaluation is unavailable. No result was accepted; retry manually only after checking the batch and session.";
    case "server-shutting-down":
      return SERVER_SHUTTING_DOWN_MESSAGE;
  }
}

function blockerLabel(blocker: FeasibilityBlocker): string {
  const labels: Record<FeasibilityBlocker, string> = {
    UNKNOWN_COST_OR_DURATION: "Unknown cost or duration",
    INDIVIDUAL_BUDGET_OVERRUN: "Individual budget overrun",
    INDIVIDUAL_EXPIRY_OVERRUN: "Individual expiry overrun",
    DUPLICATE_INSTANCE: "Duplicate scenario instance",
    AGGREGATE_BUDGET_OVERRUN: "Aggregate budget overrun",
    CONCURRENCY_OVERRUN: "Concurrency overrun",
    SESSION_DURATION_OVERRUN: "Session duration overrun",
    EXPIRY_MARGIN_INSUFFICIENT: "Expiry margin insufficient",
    HUMAN_GATE_NOT_ALLOWED: "Human-only gate not allowed",
  };
  return labels[blocker];
}

function integer(
  form: HTMLFormElement,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement) || !/^\d+$/.test(field.value)) {
    return undefined;
  }
  const value = Number(field.value);
  return boundedCount(value, minimum, maximum) ? value : undefined;
}

function boundedCount(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function normalizeUsd(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function numberField(
  label: string,
  name: string,
  values: Readonly<{
    min: string;
    max: string;
    step: string;
    value: string;
  }>,
): HTMLElement {
  const field = document.createElement("label");
  field.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.name = name;
  input.required = true;
  input.min = values.min;
  input.max = values.max;
  input.step = values.step;
  input.value = values.value;
  field.append(input);
  return field;
}

function button(label: string, className: string): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = label;
  return control;
}
