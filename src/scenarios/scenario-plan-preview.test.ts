import { describe, expect, it, vi } from "vitest";
import {
  createScenarioPlanPreview,
  type ScenarioPlanPreviewClient,
  type ScenarioPlanPreviewFailure,
} from "./scenario-plan-preview";
import {
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "./scenario-plan";
import { SCENARIO_MANIFESTS } from "./scenarios";

const NOW = new Date("2026-07-29T08:00:00Z");

function client(
  preview: (request: ScenarioPlanningRequest) => Promise<ScenarioExecutionPlan> =
    async (request) => compileScenarioExecutionPlan(request),
  classifyError: (error: unknown) => ScenarioPlanPreviewFailure =
    () => "unavailable",
): ScenarioPlanPreviewClient {
  return {
    preview: vi.fn(preview),
    classifyError: vi.fn(classifyError),
  };
}

function render(
  previewClient = client(),
  registry: readonly unknown[] = SCENARIO_MANIFESTS,
): HTMLElement {
  const preview = createScenarioPlanPreview({
    registry,
    client: previewClient,
    now: () => new Date(NOW),
  });
  document.body.replaceChildren(preview);
  return preview;
}

function submit(preview: HTMLElement): void {
  preview.querySelector("form")!.dispatchEvent(
    new SubmitEvent("submit", { bubbles: true, cancelable: true }),
  );
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Scenario plan preview", () => {
  it("starts empty, uses the canonical registry, and submits only manually", () => {
    const previewClient = client();
    const preview = render(previewClient);
    expect(
      [...preview.querySelectorAll("select[name='scenario'] option")].map(
        ({ textContent }) => textContent,
      ),
    ).toEqual(SCENARIO_MANIFESTS.map(({ title }) => title));
    expect(preview.textContent).toContain("No preview requested");
    expect(preview.textContent).toContain(
      "does not authorize, schedule, or perform work",
    );
    expect(previewClient.preview).not.toHaveBeenCalled();
    expect(
      [...preview.querySelectorAll("button")].map(({ textContent }) =>
        textContent
      ),
    ).toEqual(["Preview plan"]);
  });

  it("renders the deterministic safe plan without raw schema identifiers", async () => {
    const previewClient = client();
    const preview = render(previewClient);
    submit(preview);
    await settle();

    expect(previewClient.preview).toHaveBeenCalledOnce();
    expect(preview.textContent).toContain("Deterministic preview");
    expect(preview.textContent).toContain("Ordered phases and ownership");
    expect(preview.textContent).toContain("Learner task");
    expect(preview.textContent).toContain("Learner interpretation");
    expect(preview.textContent).toContain("Terminal proof");
    expect(preview.textContent).toContain("Categorical limitations");
    const request = vi.mocked(previewClient.preview).mock.calls[0]![0];
    const plan = compileScenarioExecutionPlan(request);
    expect(preview.textContent).toContain(plan.digestSha256.slice(0, 12));
    expect(preview.textContent).not.toContain(plan.digestSha256);
    expect(preview.textContent).not.toContain(plan.scenarioId);
    for (const step of plan.steps) {
      expect(preview.textContent).not.toContain(step.operationKey);
      expect(preview.textContent).not.toContain(step.id);
      if (step.evidenceExpectation) {
        expect(preview.textContent).not.toContain(
          step.evidenceExpectation.artifactId,
        );
      }
    }
  });

  it("renders only response choices declared by the selected manifest", () => {
    const preview = render();
    const responses = preview.querySelector<HTMLSelectElement>(
      "select[name='selectedResponse']",
    )!;
    expect([...responses.options].map(({ textContent }) => textContent)).toEqual([
      "No optional response",
      ...SCENARIO_MANIFESTS[0].responseActions.map(({ kind, summary }) =>
        `${kind.charAt(0).toUpperCase() + kind.slice(1)} — ${summary}`
      ),
    ]);
    expect([...responses.options].map(({ value }) => value)).toEqual(["", "0"]);
  });

  it("fails locally for unsafe aliases without calling the client", () => {
    const previewClient = client();
    const preview = render(previewClient);
    const alias = preview.querySelector<HTMLInputElement>(
      "input[name='alias-evidenceProducer']",
    )!;
    alias.value = "operator@example.invalid";
    submit(preview);
    expect(preview.textContent).toContain("raw identifiers are not accepted");
    expect(previewClient.preview).not.toHaveBeenCalled();
  });

  it("fails locally for under-budget, expired, and unsupported response input", () => {
    const previewClient = client();
    const preview = render(previewClient);
    const scenario = preview.querySelector<HTMLSelectElement>(
      "select[name='scenario']",
    )!;
    scenario.value = "2";
    scenario.dispatchEvent(new Event("change", { bubbles: true }));
    const budget = preview.querySelector<HTMLInputElement>(
      "input[name='maximumBudgetUsd']",
    )!;
    budget.value = "9";
    submit(preview);
    expect(preview.textContent).toContain("must cover the catalog maximum");

    budget.value = "10";
    const expiry = preview.querySelector<HTMLInputElement>(
      "input[name='expiryHours']",
    )!;
    expiry.value = "0";
    submit(preview);
    expect(preview.textContent).toContain("Expiry must be greater than zero");

    expiry.value = "1";
    const response = preview.querySelector<HTMLSelectElement>(
      "select[name='selectedResponse']",
    )!;
    const tampered = document.createElement("option");
    tampered.value = "999";
    response.append(tampered);
    response.value = "999";
    submit(preview);
    expect(preview.textContent).toContain("not supported");
    expect(previewClient.preview).not.toHaveBeenCalled();
  });

  it("disables controls while loading and allows only another manual preview", async () => {
    let resolve!: (plan: ScenarioExecutionPlan) => void;
    const pending = new Promise<ScenarioExecutionPlan>((done) => {
      resolve = done;
    });
    const previewClient = client(() => pending);
    const preview = render(previewClient);
    submit(preview);
    expect(preview.textContent).toContain(
      "Preparing the deterministic preview",
    );
    expect(
      preview.querySelector<HTMLButtonElement>("button")!.disabled,
    ).toBe(true);
    for (const control of preview.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input, select")) {
      expect(control.disabled).toBe(true);
    }
    const request = vi.mocked(previewClient.preview).mock.calls[0]![0];
    resolve(compileScenarioExecutionPlan(request));
    await settle();
    expect(preview.textContent).toContain("Deterministic preview");
    expect(
      preview.querySelector<HTMLButtonElement>("button")!.disabled,
    ).toBe(false);
    expect(previewClient.preview).toHaveBeenCalledOnce();
    submit(preview);
    await settle();
    expect(previewClient.preview).toHaveBeenCalledTimes(2);
  });

  it("clears a prior preview whenever scenario or input changes", async () => {
    const preview = render();
    submit(preview);
    await settle();
    expect(preview.textContent).toContain("Deterministic preview");
    const alias = preview.querySelector<HTMLInputElement>(
      "input[name='alias-learner']",
    )!;
    alias.value = "learner-new";
    alias.dispatchEvent(new Event("input", { bubbles: true }));
    expect(preview.textContent).toContain("No preview requested");
    expect(preview.textContent).not.toContain("Deterministic preview");

    const scenario = preview.querySelector<HTMLSelectElement>(
      "select[name='scenario']",
    )!;
    scenario.value = "2";
    scenario.dispatchEvent(new Event("change", { bubbles: true }));
    expect(preview.textContent).toContain("No preview requested");
  });

  it.each([
    ["unauthorized", "not authorized"],
    ["session-expired", "session expired"],
    ["compiler-refused", "planner refused"],
    ["response-too-large", "safe preview limit"],
    ["unavailable", "preview is unavailable"],
  ] as const)("shows the fixed %s failure without arbitrary errors", async (
    failure,
    expected,
  ) => {
    const preview = render(client(
      async () => {
        throw new Error("raw upstream body with protected data");
      },
      () => failure,
    ));
    submit(preview);
    await settle();
    expect(preview.textContent).toContain(expected);
    expect(preview.textContent).not.toContain("raw upstream");
    expect(preview.textContent).not.toContain("protected data");
  });

  it("rejects oversized and malformed client results safely", async () => {
    const request: ScenarioPlanningRequest = {
      scenarioId: SCENARIO_MANIFESTS[0].id,
      actorAliases: {
        evidenceProducer: "actor-1",
        workloadActor: "actor-2",
        learner: "actor-3",
        cleanupOwner: "actor-1",
      },
      now: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
      maximumBudgetUsd: 0,
    };
    const plan = compileScenarioExecutionPlan(request);
    const oversized = {
      ...plan,
      steps: Array.from({ length: 129 }, (_, index) => ({
        ...plan.steps[0]!,
        sequence: index + 1,
      })),
    };
    const preview = render(client(async () => oversized));
    submit(preview);
    await settle();
    expect(preview.textContent).toContain("safe preview limit");

    const malformed = render(client(async () => ({
      ...plan,
      digestSha256: "raw-secret-value",
    })));
    submit(malformed);
    await settle();
    expect(malformed.textContent).toContain("preview is unavailable");
    expect(malformed.textContent).not.toContain("raw-secret-value");
  });

  it("fails closed when the canonical registry is invalid", () => {
    const previewClient = client();
    const preview = render(previewClient, [{
      schemaVersion: 2,
      title: "raw invalid manifest",
    }]);
    expect(preview.textContent).toContain("registry validation failed");
    expect(preview.textContent).not.toContain("raw invalid manifest");
    expect(preview.querySelector("form")).toBeNull();
    expect(previewClient.preview).not.toHaveBeenCalled();
  });
});
