import { describe, expect, it } from "vitest";
import { createPanelBoundary } from "./panel-boundary";

describe("operator panel render boundary", () => {
  it("returns an unaffected panel unchanged", () => {
    const panel = document.createElement("section");
    expect(createPanelBoundary("Example panel", () => panel)).toBe(panel);
  });

  it("contains a synchronous exception in a fixed accessible failure", () => {
    const panel = createPanelBoundary("Example panel", () => {
      throw new Error("raw injected detail");
    });
    document.body.replaceChildren(panel);

    expect(panel.getAttribute("aria-labelledby")).toBe(
      "panel-render-failure-example-panel",
    );
    expect(panel.textContent).toContain("Example panel unavailable");
    expect(panel.textContent).toContain("Other operator panels remain available");
    expect(panel.textContent).toContain(
      "No retry or additional request was started by this fallback",
    );
    expect(panel.textContent).not.toContain("raw injected detail");
    expect(panel.querySelector("button, a, form")).toBeNull();
  });
});
