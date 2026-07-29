import { describe, expect, it } from "vitest";
import { createScenarioCatalog } from "./scenario-catalog";
import { SCENARIO_MANIFESTS } from "./scenarios";

function render(
  registry: readonly unknown[] = SCENARIO_MANIFESTS,
): HTMLElement {
  const catalog = createScenarioCatalog(registry);
  document.body.replaceChildren(catalog);
  return catalog;
}

describe("Capability building-block catalog", () => {
  it("labels every validated entry as an ingredient rather than a lab", () => {
    const catalog = render();
    const cards = [...catalog.querySelectorAll<HTMLElement>(
      ".capability-catalog-card",
    )];
    expect(catalog.querySelector("h2")?.textContent).toBe(
      "Capability building blocks",
    );
    expect(catalog.textContent).toContain(
      "tested ingredients that can contribute evidence to a future lab",
    );
    expect(cards).toHaveLength(SCENARIO_MANIFESTS.length);
    for (const card of cards) {
      expect(card.textContent).toContain(
        "Capability building block — not a lab",
      );
      expect(card.textContent).toContain("Why this is not a lab");
    }
  });

  it("renders only plain learner, story-account, evidence, and proof-boundary fields", () => {
    const catalog = render();
    const teams = capabilityCard(
      catalog,
      "Controlled Teams missed-call observation",
    );
    teams.querySelector("details")!.open = true;
    const labels = [...teams.querySelectorAll("dt")].map(
      ({ textContent }) => textContent,
    );
    expect(labels).toEqual([
      "Human learner",
      "Evidence recipient or workspace",
      "Simulated story accounts",
      "Learner-facing evidence",
      "Evidence type",
      "Current proof boundary",
    ]);
    expect(teams.textContent).toContain(
      "fictional identities in the story, not the human learner",
    );
    expect(teams.textContent).toContain(
      "Not defined by this atomic building block",
    );
    expect(teams.textContent).toContain(
      "complete story, a connected multi-signal evidence chain",
    );
    expect(teams.textContent).not.toMatch(
      /workload actor|evidence producer|trigger|retention|cleanup|responder|operation key|authentication|maximum cost|expires/i,
    );
  });

  it("does not upgrade platform readiness or an observed artifact into a complete lab", () => {
    const catalog = render();
    const avd = capabilityCard(
      catalog,
      "Private three-VM AVD substrate",
    );
    avd.querySelector("details")!.open = true;
    expect(avd.textContent).toContain(
      "A learner-facing view is not proven for every artifact",
    );

    const teams = capabilityCard(
      catalog,
      "Controlled Teams missed-call observation",
    );
    teams.querySelector("details")!.open = true;
    expect(teams.textContent).toContain(
      "A learner-facing view has been observed for this atomic capability",
    );
    expect(teams.textContent).toContain(
      "still does not prove a complete lab",
    );
  });

  it("never renders orchestration identifiers, markers, references, or controls", () => {
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
      /marker|journal|protected|control-plane|proof reference|operation key/i,
    );
    expect(
      [...catalog.querySelectorAll("summary")].map(({ textContent }) =>
        textContent
      ),
    ).toEqual(
      Array.from(
        { length: SCENARIO_MANIFESTS.length },
        () => "See building-block details",
      ),
    );
  });

  it("fails closed without leaking invalid registry details", () => {
    const catalog = render([{
      schemaVersion: 2,
      title: "raw invalid title",
      marker: "raw-private-marker",
    }]);
    expect(catalog.textContent).toContain(
      "Capability catalog unavailable",
    );
    expect(catalog.textContent).not.toContain("raw invalid title");
    expect(catalog.textContent).not.toContain("raw-private-marker");
    expect(catalog.querySelectorAll(".capability-catalog-card")).toHaveLength(
      0,
    );
  });
});

function capabilityCard(catalog: HTMLElement, title: string): HTMLElement {
  const card = [...catalog.querySelectorAll<HTMLElement>(
    ".capability-catalog-card",
  )].find((candidate) =>
    candidate.querySelector("h3")?.textContent === title
  );
  if (!card) {
    throw new Error(`Capability card '${title}' is missing.`);
  }
  return card;
}
