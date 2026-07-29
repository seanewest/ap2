import { describe, expect, it } from "vitest";
import { createScenarioCatalog } from "./scenario-catalog";
import { SCENARIO_MANIFESTS } from "./scenarios";

function render(registry: readonly unknown[] = SCENARIO_MANIFESTS): HTMLElement {
  const catalog = createScenarioCatalog(registry);
  document.body.replaceChildren(catalog);
  return catalog;
}

describe("Scenario catalog", () => {
  it("renders one compact card per canonical validated scenario", () => {
    const catalog = render();
    const cards = [...catalog.querySelectorAll<HTMLElement>(
      ".scenario-catalog-card",
    )];
    expect(cards).toHaveLength(SCENARIO_MANIFESTS.length);
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual(
      SCENARIO_MANIFESTS.map(({ title }) => title),
    );
    expect(cards.map((card) =>
      card.querySelector(".scenario-catalog-purpose")?.textContent
    )).toEqual(SCENARIO_MANIFESTS.map(({ summary }) => summary));
  });

  it("shows fixed role, evidence, learner, lifecycle, cost, and limitation labels", () => {
    const catalog = render();
    const card = scenarioCard(
      catalog,
      "Application reconnaissance and audit observation",
    );
    card.querySelector("details")!.open = true;

    const labels = [...card.querySelectorAll("dt")].map(
      ({ textContent }) => textContent,
    );
    for (const label of [
      "Evidence producer",
      "Workload actor",
      "Learner",
      "Detector",
      "Responder",
      "Producer operation",
      "Learner observes",
      "Task",
      "Expected interpretation",
      "Trigger",
      "Setup",
      "Human-only gates",
      "Prerequisites",
      "Expires",
      "Cleanup owner",
      "Cleanup boundary",
      "Retention",
      "Maximum cost",
    ]) {
      expect(labels).toContain(label);
    }
    expect(card.textContent).toContain(
      "Reconnaissance workload application",
    );
    expect(card.textContent).toContain(
      "Independent audit observer application",
    );
    expect(card.textContent).toContain("Platform Control Plane");
    expect(card.textContent).toContain(
      "one sign-in summary does not prove every individual Graph read",
    );
  });

  it("renders help desk, AVD, Teams, application recon, and Purview boundaries honestly", () => {
    const catalog = render();
    for (const title of [
      "Kobe help-desk email for Cory",
      "Private three-VM AVD lab substrate",
      "Controlled Teams missed-call observation",
      "Application reconnaissance and audit observation",
      "Purview audit boundary",
    ]) {
      expect(catalog.textContent).toContain(title);
    }
    expect(catalog.textContent).toContain(
      "not a catalog scenario or execution receipt",
    );
    const avd = scenarioCard(catalog, "Private three-VM AVD lab substrate");
    expect(avd.textContent).toContain(
      "this canary did not prove a learner session or completed task",
    );
  });

  it("never renders canonical IDs, markers, proof references, or mutation controls", () => {
    const catalog = render();
    for (const manifest of SCENARIO_MANIFESTS) {
      expect(catalog.outerHTML).not.toContain(manifest.id);
      for (const operation of manifest.operations) {
        expect(catalog.textContent).not.toContain(operation.key);
        if (operation.marker) {
          expect(catalog.textContent).not.toContain(operation.marker);
        }
      }
      for (const artifact of manifest.evidence.artifacts) {
        expect(catalog.textContent).not.toContain(artifact.id);
        expect(catalog.textContent).not.toContain(
          artifact.observation?.proofReference ?? "not-present",
        );
      }
    }
    expect(catalog.querySelectorAll(
      "button, a, form, input, select, textarea, [data-action]",
    )).toHaveLength(0);
    expect(catalog.textContent).not.toMatch(
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    );
    expect(
      [...catalog.querySelectorAll("summary")].map(({ textContent }) =>
        textContent
      ),
    ).toEqual(
      Array.from(
        { length: SCENARIO_MANIFESTS.length },
        () => "View catalog details",
      ),
    );
  });

  it("fails closed without leaking validation details", () => {
    const catalog = render([{
      schemaVersion: 2,
      title: "raw invalid title",
      marker: "raw-private-marker",
    }]);
    expect(catalog.textContent).toContain(
      "Scenario catalog unavailable: canonical registry validation failed.",
    );
    expect(catalog.textContent).not.toContain("raw invalid title");
    expect(catalog.textContent).not.toContain("raw-private-marker");
    expect(catalog.querySelectorAll(".scenario-catalog-card")).toHaveLength(0);
    expect(catalog.querySelectorAll("details")).toHaveLength(0);
  });
});

function scenarioCard(catalog: HTMLElement, title: string): HTMLElement {
  const card = [...catalog.querySelectorAll<HTMLElement>(
    ".scenario-catalog-card",
  )].find((candidate) =>
    candidate.querySelector("h3")?.textContent === title
  );
  if (!card) {
    throw new Error(`Scenario card '${title}' is missing.`);
  }
  return card;
}
