import { describe, expect, it, vi } from "vitest";
import { SCENARIO_MANIFESTS } from "./scenarios";
import {
  createBatchFeasibilityPanel,
  type BatchFeasibilityPanelClient,
  type BatchFeasibilityPanelFailure,
} from "./batch-feasibility-panel";
import type {
  BatchFeasibilityRequest,
} from "../api/multi-scenario-feasibility-contract";
import type {
  MultiScenarioFeasibilityResult,
} from "./multi-scenario-feasibility";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const FEASIBLE: MultiScenarioFeasibilityResult = {
  schemaVersion: 1,
  label: "FEASIBILITY_ONLY",
  status: "feasible",
  planCount: 1,
  maximumConcurrency: 1,
  conservativeAggregateUsdCeiling: "25.00",
  requestedSessionDurationMinutes: 10,
  earliestExpiryMarginMinutes: 5,
  humanGateCount: 2,
  blockers: [],
};

function client(
  evaluate: (
    request: BatchFeasibilityRequest,
  ) => Promise<MultiScenarioFeasibilityResult> = async () => FEASIBLE,
  classifyError: (
    error: unknown,
  ) => BatchFeasibilityPanelFailure = () => "unavailable",
): BatchFeasibilityPanelClient {
  return {
    evaluate: vi.fn(evaluate),
    classifyError: vi.fn(classifyError),
  };
}

function render(
  evaluationClient = client(),
  registry: readonly unknown[] = SCENARIO_MANIFESTS,
): HTMLElement {
  const panel = createBatchFeasibilityPanel({
    registry,
    client: evaluationClient,
    now: () => NOW,
  });
  document.body.replaceChildren(panel);
  return panel;
}

function submit(panel: HTMLElement): void {
  panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
}

function setValue(
  panel: HTMLElement,
  selector: string,
  value: string,
): void {
  const field = panel.querySelector<HTMLInputElement | HTMLSelectElement>(
    selector,
  )!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("scenario batch feasibility panel", () => {
  it("starts with one canonical row and performs no request before Evaluate", () => {
    const evaluationClient = client();
    const panel = render(evaluationClient);
    expect(panel.textContent).toContain("planning arithmetic only");
    expect(panel.textContent).toContain("No feasibility evaluation requested");
    expect(panel.querySelectorAll(".batch-feasibility-row")).toHaveLength(1);
    expect(evaluationClient.evaluate).not.toHaveBeenCalled();
    expect([...panel.querySelectorAll("button")].map(({ textContent }) =>
      textContent
    )).not.toContain("Run");
  });

  it("builds only canonical planning inputs and evaluates exactly once", async () => {
    const evaluationClient = client();
    const panel = render(evaluationClient);
    submit(panel);
    await settle();

    expect(evaluationClient.evaluate).toHaveBeenCalledOnce();
    const request = vi.mocked(evaluationClient.evaluate).mock.calls[0]![0];
    expect(request).toEqual(expect.objectContaining({
      schemaVersion: 1,
      label: "SCENARIO_FEASIBILITY_COMPILE_REQUEST",
    }));
    expect(request.session).toEqual({
      startsAt: NOW.toISOString(),
      requestedDurationMinutes: 10,
      aggregateBudgetCeilingUsd: "100.00",
      concurrencyLimit: 1,
      minimumExpiryMarginMinutes: 5,
      humanGatePolicy: "allow",
    });
    expect(request.plans).toHaveLength(1);
    expect(request.plans[0]!.instanceAlias).toBe("scenario-1");
    expect(request.plans[0]!.planRequest.scenarioId).toBe(
      SCENARIO_MANIFESTS[0]!.id,
    );
    expect(request.plans[0]!.planRequest.actorAliases).toEqual(
      expect.objectContaining({
        evidenceProducer: "scenario-1-1",
        workloadActor: "scenario-1-2",
      }),
    );
    expect(panel.textContent).toContain("arithmetically feasible");
    expect(panel.textContent).toContain("USD 25.00");
    expect(panel.textContent).not.toContain("scenario-1");
  });

  it("adds, reorders, and removes rows without evaluating", () => {
    const evaluationClient = client();
    const panel = render(evaluationClient);
    panel.querySelector<HTMLButtonElement>("[data-action='add-scenario']")!
      .click();
    expect(panel.querySelectorAll(".batch-feasibility-row")).toHaveLength(2);
    panel.querySelectorAll<HTMLButtonElement>("[data-action='move-up']")[1]!
      .click();
    expect(
      panel.querySelector<HTMLInputElement>(
        ".batch-feasibility-row input[name='batchAlias']",
      )!.value,
    ).toBe("scenario-2");
    expect(
      panel.querySelector<HTMLButtonElement>("[data-action='move-down']")
        ?.getAttribute("aria-label"),
    ).toBe("Move down scenario 1");
    panel.querySelector<HTMLButtonElement>("[data-action='remove']:not(:disabled)")!
      .click();
    expect(panel.querySelectorAll(".batch-feasibility-row")).toHaveLength(1);
    expect(evaluationClient.evaluate).not.toHaveBeenCalled();
  });

  it("caps the local batch at the authoritative eight-plan bound", () => {
    const panel = render();
    const add = panel.querySelector<HTMLButtonElement>(
      "[data-action='add-scenario']",
    )!;
    for (let index = 1; index < 8; index += 1) add.click();
    expect(panel.querySelectorAll(".batch-feasibility-row")).toHaveLength(8);
    expect(add.disabled).toBe(true);
    add.click();
    expect(panel.querySelectorAll(".batch-feasibility-row")).toHaveLength(8);
  });

  it("refuses duplicate and unsafe aliases before evaluation", () => {
    const evaluationClient = client();
    const panel = render(evaluationClient);
    panel.querySelector<HTMLButtonElement>("[data-action='add-scenario']")!
      .click();
    const aliases = panel.querySelectorAll<HTMLInputElement>(
      "input[name='batchAlias']",
    );
    aliases[1]!.value = aliases[0]!.value;
    submit(panel);
    expect(panel.textContent).toContain("distinct local alias");
    aliases[1]!.value = ["user", "example.invalid"].join("@");
    submit(panel);
    expect(panel.textContent).toContain("2–32 character lowercase");
    expect(evaluationClient.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ["budget", "input[name='aggregateBudget']", "100.001", "Aggregate budget"],
    ["concurrency", "input[name='concurrencyLimit']", "0", "Concurrency"],
    ["duration", "input[name='durationMinutes']", "1.5", "whole minutes"],
    ["margin", "input[name='expiryMarginMinutes']", "-1", "whole minutes"],
  ])("refuses invalid %s locally", (_name, selector, value, message) => {
    const evaluationClient = client();
    const panel = render(evaluationClient);
    setValue(panel, selector, value);
    submit(panel);
    expect(panel.textContent).toContain(message);
    expect(evaluationClient.evaluate).not.toHaveBeenCalled();
  });

  it("fails closed when registry validation fails", () => {
    const panel = render(client(), [{ schemaVersion: 2 }]);
    expect(panel.textContent).toContain("registry validation failed");
    expect(panel.querySelector("form")).toBeNull();
  });

  it("clears a prior result whenever the batch changes", async () => {
    const panel = render();
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("arithmetically feasible");
    setValue(panel, "input[name='aggregateBudget']", "80");
    expect(panel.textContent).not.toContain("arithmetically feasible");
    expect(panel.textContent).toContain("Batch changed");
  });

  it("ignores stale completion after input changes", async () => {
    let resolve!: (result: MultiScenarioFeasibilityResult) => void;
    const pending = new Promise<MultiScenarioFeasibilityResult>((done) => {
      resolve = done;
    });
    const panel = render(client(async () => pending));
    submit(panel);
    setValue(panel, "input[name='aggregateBudget']", "80");
    resolve(FEASIBLE);
    await settle();
    expect(panel.textContent).not.toContain("arithmetically feasible");
    expect(panel.textContent).toContain("Batch changed");
  });

  it("exposes loading accessibly and suppresses repeat submission", async () => {
    let resolve!: (result: MultiScenarioFeasibilityResult) => void;
    const pending = new Promise<MultiScenarioFeasibilityResult>((done) => {
      resolve = done;
    });
    const evaluationClient = client(async () => pending);
    const panel = render(evaluationClient);
    submit(panel);
    submit(panel);
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(
      panel.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled,
    ).toBe(true);
    expect(panel.textContent).toContain("Evaluating the bounded batch");
    expect(evaluationClient.evaluate).toHaveBeenCalledOnce();
    resolve(FEASIBLE);
    await settle();
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("renders only fixed safe infeasibility blockers", async () => {
    const panel = render(client(async () => ({
      ...FEASIBLE,
      status: "infeasible",
      blockers: [
        "AGGREGATE_BUDGET_OVERRUN",
        "HUMAN_GATE_NOT_ALLOWED",
      ],
    })));
    setValue(panel, "input[name='aggregateBudget']", "20");
    setValue(panel, "select[name='humanGatePolicy']", "refuse");
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("arithmetically infeasible");
    expect(panel.textContent).toContain("Aggregate budget overrun");
    expect(panel.textContent).toContain("Human-only gate not allowed");
    expect(panel.textContent).not.toContain("AGGREGATE_BUDGET_OVERRUN");
  });

  it("refuses malformed typed output without rendering arbitrary fields", async () => {
    const panel = render(client(async () => ({
      ...FEASIBLE,
      status: "infeasible",
      blockers: ["RAW_PRIVATE_DETAIL" as never],
    })));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("evaluation is unavailable");
    expect(panel.textContent).not.toContain("RAW_PRIVATE_DETAIL");
  });

  it("refuses inconsistent or unbounded typed summaries", async () => {
    const panel = render(client(async () => ({
      ...FEASIBLE,
      maximumConcurrency: 16,
      earliestExpiryMarginMinutes: 999_999,
    })));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("evaluation is unavailable");
  });

  it.each([
    ["session-expired", "operator session expired"],
    ["unauthorized", "not authorized"],
    ["planner-refused", "planner refused"],
    ["request-too-large", "request-size limit"],
    ["response-too-large", "response-size limit"],
    ["unavailable", "evaluation is unavailable"],
  ] as const)("maps %s to a fixed safe message", async (failure, message) => {
    const detail = new Error("raw private backend detail");
    const panel = render(client(
      async () => {
        throw detail;
      },
      () => failure,
    ));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain(detail.message);
  });
});
