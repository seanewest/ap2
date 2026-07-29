import { createStatus } from "./elements";

export function createPanelBoundary(
  label: string,
  render: () => HTMLElement,
): HTMLElement {
  try {
    return render();
  } catch {
    return createPanelFailure(label);
  }
}

function createPanelFailure(label: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "panel-render-failure";
  const headingId = `panel-render-failure-${slug(label)}`;
  section.setAttribute("aria-labelledby", headingId);
  const heading = document.createElement("h2");
  heading.id = headingId;
  heading.textContent = `${label} unavailable`;
  section.append(
    heading,
    createStatus(
      "This panel could not be rendered. Other operator panels remain available. No retry or additional request was started by this fallback; correct the local data or application before reloading.",
      "error",
    ),
  );
  return section;
}

function slug(label: string): string {
  return label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(
    /(?:^-|-$)/g,
    "",
  );
}
