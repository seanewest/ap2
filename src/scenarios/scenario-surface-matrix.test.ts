import { describe, expect, it } from "vitest";
import {
  inventoryCanonicalScenarioSurfaces,
  type ScenarioSurfaceInventory,
} from "./scenario-surface-inventory";
import { createScenarioSurfaceMatrix } from "./scenario-surface-matrix";

function render(
  inventory = inventoryCanonicalScenarioSurfaces(),
): HTMLElement {
  const panel = createScenarioSurfaceMatrix(inventory);
  document.body.replaceChildren(panel);
  return panel;
}

describe("scenario surface availability matrix", () => {
  it("renders the exact authoritative five-family inventory without actions", () => {
    const inventory = inventoryCanonicalScenarioSurfaces();
    const panel = render(inventory);
    const rows = panel.querySelectorAll("tbody tr");

    expect(inventory.status).toBe("valid");
    expect(rows).toHaveLength(5);
    expect([...rows].map((row) =>
      row.querySelector("th code")?.textContent
    )).toEqual(inventory.scenarios.map(({ scenarioId }) => scenarioId));
    expect(panel.querySelectorAll("button, a, form, input, select, textarea"))
      .toHaveLength(0);
    expect(panel.textContent).toContain(
      "product-source surface availability only",
    );
    expect(panel.textContent).toContain("not external evidence");
    expect(panel.textContent).toContain(
      "Pending is distinct from missing",
    );
  });

  it("renders only the requested authoritative surface columns", () => {
    const panel = render();
    expect([...panel.querySelectorAll("thead th")].map(({ textContent }) =>
      textContent
    )).toEqual([
      "Scenario family",
      "Manifest / plan",
      "Adapter",
      "Rehearsal",
      "Offline verifier",
      "Authenticated verification API / client",
      "Manual panel",
      "Learner briefing",
    ]);
    expect(panel.querySelector("[data-surface='receipt']")).toBeNull();
    expect(panel.querySelector("[data-surface='capability-catalog-ui']")).toBeNull();
  });

  it("preserves implemented, missing, and not-applicable semantics", () => {
    const inventory = structuredClone(
      inventoryCanonicalScenarioSurfaces(),
    ) as ScenarioSurfaceInventory;
    const first = inventory.scenarios[0]!;
    (first.surfaces.adapter as { status: string; reason: string }) = {
      status: "not-applicable",
      reason: "no-applicable-adapter-declared",
    };
    const panel = render(inventory);

    expect(panel.textContent).toContain("Implemented");
    expect(panel.textContent).toContain("Missing — not a failure");
    expect(panel.textContent).toContain("Deliberately absent");
    expect(panel.textContent).not.toContain("Failed");
  });

  it("fails closed without a partial matrix when inventory is invalid", () => {
    const invalid: ScenarioSurfaceInventory = {
      ...inventoryCanonicalScenarioSurfaces(),
      status: "invalid",
      failures: [{
        scenarioId: "unknown",
        surface: "inventory",
        code: "REGISTRY_INVALID",
      }],
    };
    const panel = render(invalid);

    expect(panel.textContent).toContain("inventory validation failed");
    expect(panel.querySelector("table")).toBeNull();
    expect(panel.textContent).not.toContain("REGISTRY_INVALID");
  });

  it("uses semantic caption, column headings, and row headings", () => {
    const panel = render();
    expect(panel.querySelector("caption")?.textContent).toContain(
      "every canonical scenario family",
    );
    expect(panel.querySelectorAll("thead th[scope='col']")).toHaveLength(8);
    expect(panel.querySelectorAll("tbody th[scope='row']")).toHaveLength(5);
    expect(
      panel.querySelector(".scenario-surface-matrix-table-wrap")
        ?.getAttribute("tabindex"),
    ).toBe("0");
  });
});
