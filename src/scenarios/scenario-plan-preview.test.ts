import { describe, expect, it, vi } from "vitest";
import {
  createScenarioPlanPreview,
  createScenarioPlanPreviewController,
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
  callbacks: Pick<
    Parameters<typeof createScenarioPlanPreview>[0],
    "onPlanAccepted" | "onPlanInvalidated"
  > = {},
): HTMLElement {
  const preview = createScenarioPlanPreview({
    registry,
    client: previewClient,
    now: () => new Date(NOW),
    ...callbacks,
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
  it.each(SCENARIO_MANIFESTS.map((manifest, index) => [
    manifest.title,
    manifest,
    index,
  ] as const))(
    "selects %s by exact canonical version with safe local defaults and no request",
    (_title, manifest, index) => {
      const previewClient = client();
      const controller = createScenarioPlanPreviewController({
        registry: SCENARIO_MANIFESTS,
        client: previewClient,
        now: () => new Date(NOW),
      });
      document.body.replaceChildren(controller.element);

      expect(controller.selectScenario({
        scenarioId: manifest.id,
        schemaVersion: manifest.schemaVersion,
      })).toBe(true);
      const scenario = controller.element.querySelector<HTMLSelectElement>(
        "select[name='scenario']",
      )!;
      expect(scenario.value).toBe(String(index));
      expect(document.activeElement).toBe(scenario);
      expect(controller.element.textContent).toContain(
        `Selected ${manifest.title}, registry version ${manifest.schemaVersion}`,
      );
      expect(
        controller.element.querySelector<HTMLInputElement>(
          "input[name='maximumBudgetUsd']",
        )!.value,
      ).toBe(String(manifest.cost.laneMaximum));
      expect(
        controller.element.querySelector<HTMLInputElement>(
          "input[name='expiryHours']",
        )!.value,
      ).toBe(String(manifest.cost.conservativeDurationHours));
      expect(
        [...controller.element.querySelectorAll<HTMLInputElement>(
          "input[name^='alias-']",
        )].every(({ value }) => /^[a-z][a-z0-9-]{1,31}$/.test(value)),
      ).toBe(true);
      expect(previewClient.preview).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the catalog version does not resolve exactly", () => {
    const previewClient = client();
    const controller = createScenarioPlanPreviewController({
      registry: SCENARIO_MANIFESTS,
      client: previewClient,
    });
    document.body.replaceChildren(controller.element);
    expect(controller.selectScenario({
      scenarioId: "not-a-canonical-scenario",
      schemaVersion: SCENARIO_MANIFESTS[0].schemaVersion,
    })).toBe(false);
    expect(controller.element.textContent).toContain(
      "exact canonical scenario version could not be resolved",
    );
    expect(controller.element.textContent).not.toContain(
      "not-a-canonical-scenario",
    );
    expect(previewClient.preview).not.toHaveBeenCalled();
  });

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

  it("retains only an accepted plan and invalidates it before any input change or resubmission", async () => {
    const onPlanAccepted = vi.fn();
    const onPlanInvalidated = vi.fn();
    const preview = render(client(), SCENARIO_MANIFESTS, {
      onPlanAccepted,
      onPlanInvalidated,
    });
    const initialInvalidations = onPlanInvalidated.mock.calls.length;

    submit(preview);
    await settle();
    expect(onPlanAccepted).toHaveBeenCalledOnce();
    expect(onPlanInvalidated).toHaveBeenCalledTimes(initialInvalidations + 1);

    preview.querySelector<HTMLInputElement>(
      "input[name='alias-learner']",
    )!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onPlanInvalidated).toHaveBeenCalledTimes(initialInvalidations + 2);

    submit(preview);
    expect(onPlanInvalidated).toHaveBeenCalledTimes(initialInvalidations + 3);
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

  it.each(SCENARIO_MANIFESTS.map((manifest, index) => [
    manifest.title,
    index,
  ] as const))("previews the canonical %s contract", async (_title, index) => {
    const preview = render();
    const scenario = preview.querySelector<HTMLSelectElement>(
      "select[name='scenario']",
    )!;
    scenario.value = String(index);
    scenario.dispatchEvent(new Event("change", { bubbles: true }));
    submit(preview);
    await settle();
    expect(preview.textContent).toContain("Deterministic preview");
    expect(preview.textContent).not.toContain("preview is unavailable");
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
      "input[name='alias-learner']",
    )!;
    alias.value = "operator@example.invalid";
    submit(preview);
    expect(preview.textContent).toContain("raw identifiers are not accepted");
    expect(previewClient.preview).not.toHaveBeenCalled();
  });

  it("uses the canonical request parser to reject token-like aliases before the client", () => {
    const previewClient = client();
    const preview = render(previewClient);
    const alias = preview.querySelector<HTMLInputElement>(
      "input[name='alias-learner']",
    )!;
    alias.value = "access-token";
    submit(preview);
    expect(preview.textContent).toContain(
      "credential, token, session, and other raw-identifier terms",
    );
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
    expect(document.activeElement).toBe(
      preview.querySelector(".scenario-plan-preview-output"),
    );

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
    expect(document.activeElement).toBe(
      preview.querySelector(".scenario-plan-preview-output"),
    );
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
    expect(preview.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "true",
    );
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
    expect(preview.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(
      preview.querySelector(".scenario-plan-preview-output"),
    );
    expect(previewClient.preview).toHaveBeenCalledOnce();
    submit(preview);
    await settle();
    expect(previewClient.preview).toHaveBeenCalledTimes(2);
  });

  it("locally changes catalog selection during loading and ignores the stale response", async () => {
    let resolve!: (plan: ScenarioExecutionPlan) => void;
    const pending = new Promise<ScenarioExecutionPlan>((done) => {
      resolve = done;
    });
    const previewClient = client(() => pending);
    const controller = createScenarioPlanPreviewController({
      registry: SCENARIO_MANIFESTS,
      client: previewClient,
      now: () => new Date(NOW),
    });
    document.body.replaceChildren(controller.element);
    submit(controller.element);
    const request = vi.mocked(previewClient.preview).mock.calls[0]![0];

    const selected = SCENARIO_MANIFESTS[2];
    expect(controller.selectScenario({
      scenarioId: selected.id,
      schemaVersion: selected.schemaVersion,
    })).toBe(true);
    expect(controller.element.textContent).toContain(`Selected ${selected.title}`);
    expect(
      controller.element.querySelector<HTMLButtonElement>("button")!.disabled,
    ).toBe(false);
    expect(previewClient.preview).toHaveBeenCalledOnce();

    resolve(compileScenarioExecutionPlan(request));
    await settle();
    expect(controller.element.textContent).toContain(`Selected ${selected.title}`);
    expect(controller.element.textContent).not.toContain(
      "Deterministic preview",
    );
    expect(previewClient.preview).toHaveBeenCalledOnce();
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

  it("clears a completed preview when a catalog selection changes", async () => {
    const previewClient = client();
    const controller = createScenarioPlanPreviewController({
      registry: SCENARIO_MANIFESTS,
      client: previewClient,
      now: () => new Date(NOW),
    });
    document.body.replaceChildren(controller.element);
    submit(controller.element);
    await settle();
    expect(controller.element.textContent).toContain("Deterministic preview");

    const selected = SCENARIO_MANIFESTS[3];
    expect(controller.selectScenario({
      scenarioId: selected.id,
      schemaVersion: selected.schemaVersion,
    })).toBe(true);
    expect(controller.element.textContent).toContain(`Selected ${selected.title}`);
    expect(controller.element.textContent).not.toContain(
      "Deterministic preview",
    );
    expect(previewClient.preview).toHaveBeenCalledOnce();
  });

  it.each([
    ["unauthorized", "not authorized"],
    ["session-expired", "session expired"],
    ["server-shutting-down", "API is shutting down"],
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

  it("renders a validated support reference without rendering error detail", async () => {
    const supportReference = "r1_0123456789abcdef01234567";
    const preview = render(client(
      async () => {
        throw Object.assign(new Error("raw upstream protected detail"), {
          supportReference,
        });
      },
      () => "unavailable",
    ));
    submit(preview);
    await settle();
    expect(preview.textContent).toContain(
      `Support reference: ${supportReference}.`,
    );
    expect(preview.textContent).not.toContain("raw upstream");
    expect(preview.textContent).not.toContain("protected detail");
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
