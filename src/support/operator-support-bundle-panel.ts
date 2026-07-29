import {
  OPERATOR_SUPPORT_BUNDLE_MAX_BYTES,
  type OperatorSupportBundle,
  type OperatorSupportBundleSession,
  serializeOperatorSupportBundle,
} from "./operator-support-bundle";
import { createStatus } from "../ui/elements";

export type OperatorSupportBundleExporter = (
  bundle: OperatorSupportBundle,
) => void;

export function createOperatorSupportBundlePanel(
  session: OperatorSupportBundleSession,
  exportBundle: OperatorSupportBundleExporter = downloadOperatorSupportBundle,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "operator-support-bundle";
  section.setAttribute("aria-labelledby", "operator-support-bundle-heading");
  const heading = document.createElement("h2");
  heading.id = "operator-support-bundle-heading";
  heading.textContent = "Failed-rehearsal support bundle";
  const disclosure = createStatus(
    "A manual export contains only fixed application/build labels, categorical failed-rehearsal status, timestamps, route categories, and valid server support references held in this page memory. It contains no submitted rehearsal, result, identity, evidence, or credential data and starts no request or retry.",
    "notice",
  );
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = "Download support bundle";
  const status = document.createElement("div");
  status.setAttribute("aria-live", "polite");
  status.append(createStatus(
    "No export has been requested. Only failures with a valid server support reference are eligible.",
  ));

  button.addEventListener("click", () => {
    const bundle = session.createBundle();
    if (bundle === undefined) {
      status.replaceChildren(createStatus(
        "No eligible failed rehearsal is available in this page session. No file was created.",
        "notice",
      ));
      return;
    }
    try {
      exportBundle(bundle);
      status.replaceChildren(createStatus(
        "The bounded support bundle was downloaded by explicit request. Review it before sharing through an approved support path.",
      ));
    } catch {
      status.replaceChildren(createStatus(
        "The support bundle could not be downloaded. No request or retry was started.",
        "error",
      ));
    }
  });

  section.append(heading, disclosure, button, status);
  return section;
}

export function downloadOperatorSupportBundle(
  bundle: OperatorSupportBundle,
): void {
  const serialized = serializeOperatorSupportBundle(bundle);
  if (
    new TextEncoder().encode(serialized).byteLength >
    OPERATOR_SUPPORT_BUNDLE_MAX_BYTES
  ) {
    throw new Error("Support bundle exceeded its fixed byte limit.");
  }
  const url = URL.createObjectURL(
    new Blob([serialized], { type: "application/json" }),
  );
  try {
    const anchor = document.createElement("a");
    anchor.download = "ap2-support-bundle.json";
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
