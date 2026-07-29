import { describe, expect, it } from "vitest";
import {
  createLabCatalog,
  LEARNER_LAB_CATALOG,
} from "./lab-catalog";

const capabilities = new Set(["capability-one", "capability-two"]);

describe("learner lab catalog", () => {
  it("renders the honest empty state and minimum complete-lab shape", () => {
    const catalog = createLabCatalog(LEARNER_LAB_CATALOG, {
      knownCapabilityIds: capabilities,
    });
    expect(catalog.querySelector("h2")?.textContent).toBe("Lab catalog");
    expect(catalog.textContent).toContain(
      "No complete labs are published yet",
    );
    for (const requirement of [
      "coherent story and learning objective",
      "One human learner",
      "at least two distinct capability building blocks",
      "learner investigation prompt",
      "permitted learner actions and completion criteria",
    ]) {
      expect(catalog.textContent).toContain(requirement);
    }
    expect(catalog.querySelectorAll(".lab-catalog-card")).toHaveLength(0);
    expect(catalog.querySelectorAll(
      "button, a, form, input, select, textarea, [data-action]",
    )).toHaveLength(0);
    expect(catalog.textContent).not.toMatch(
      /workload actor|trigger|retention|cleanup owner|operation key|marker/i,
    );
  });

  it("fails closed without a partial card for an invalid published lab", () => {
    const catalog = createLabCatalog([{
      schemaVersion: 1,
      title: "Incomplete lab",
    }], {
      knownCapabilityIds: capabilities,
    });
    expect(catalog.textContent).toContain("Lab catalog unavailable");
    expect(catalog.textContent).not.toContain("Incomplete lab");
    expect(catalog.querySelectorAll(".lab-catalog-card")).toHaveLength(0);
  });
});
