import {
  PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES,
  type PurviewAuditBoundaryRehearsalVerificationRequest,
  type VerifiedPurviewAuditBoundaryRehearsalSummary,
} from "../api/purview-audit-boundary-rehearsal-verification-contract";
import { appendIdentity, createStatus } from "../ui/elements.ts";
import { SERVER_SHUTTING_DOWN_MESSAGE } from "../api/server-shutdown.ts";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability.ts";

export const PURVIEW_AUDIT_BOUNDARY_REHEARSAL_VERIFICATION_PANEL_CAPABILITY = {
  schemaVersion: 1,
  surface: "manual-rehearsal-verification-panel",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["purview-sharepoint-audit-boundary"],
  routeOwnerKey: "purview-audit-boundary-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type PurviewAuditBoundaryRehearsalPanelFailure =
  | "request-too-large"
  | "response-too-large"
  | "server-shutting-down"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface PurviewAuditBoundaryRehearsalPanelClient {
  parse(
    value: unknown,
  ): PurviewAuditBoundaryRehearsalVerificationRequest | undefined;
  verify(
    input: PurviewAuditBoundaryRehearsalVerificationRequest,
  ): Promise<VerifiedPurviewAuditBoundaryRehearsalSummary>;
  classifyError(
    error: unknown,
  ): PurviewAuditBoundaryRehearsalPanelFailure;
}

export interface PurviewAuditBoundaryRehearsalPanelOptions {
  client: PurviewAuditBoundaryRehearsalPanelClient;
}

export function createPurviewAuditBoundaryRehearsalVerificationPanel(
  options: PurviewAuditBoundaryRehearsalPanelOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "purview-rehearsal-verification";
  section.setAttribute(
    "aria-labelledby",
    "purview-rehearsal-verification-heading",
  );
  const heading = document.createElement("h2");
  heading.id = "purview-rehearsal-verification-heading";
  heading.textContent = "Purview audit-boundary rehearsal verification";
  section.append(
    heading,
    createStatus(
      "This manually verifies one network-free REHEARSAL_ONLY contract output. It does not submit or read an audit search, inspect a tenant, or prove an external operation, attribution, learner, response, cleanup, retention, content, or impact claim.",
      "notice",
    ),
  );

  const form = document.createElement("form");
  form.className = "purview-rehearsal-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent = "Sanitized Purview audit-boundary output JSON";
  const guidance = document.createElement("span");
  guidance.className = "field-guidance";
  guidance.id = "purview-rehearsal-verification-guidance";
  guidance.textContent =
    "One exact PR #129 envelope, at most 32 KiB. Raw identities, UPNs, paths, tenant, application, object, record, or resource identifiers, markers, credentials, authentication material, protected references, unknown fields, arbitrary text, and external-proof claims are refused locally.";
  const input = document.createElement("textarea");
  input.name = "purviewAuditBoundaryRehearsalOutput";
  input.rows = 10;
  input.maxLength = PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES;
  input.required = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", guidance.id);
  field.append(guidance, input);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Verify Purview rehearsal";
  const output = document.createElement("div");
  output.className = "purview-rehearsal-verification-output";
  output.setAttribute("aria-live", "polite");
  output.tabIndex = -1;
  form.append(field, submit);
  section.append(form, output);

  let revision = 0;
  let loading = false;
  const show = (content: HTMLElement, focus = false): void => {
    output.replaceChildren(content);
    if (focus) output.focus();
  };
  show(createStatus(
    "No rehearsal output submitted. Paste one sanitized envelope and select Verify Purview rehearsal.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised envelope."
        : "Input changed. Select Verify Purview rehearsal to check the revised envelope.",
    ));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loading) return;
    const parsed = parseInput(input.value, options.client.parse);
    if (typeof parsed === "string") {
      show(createStatus(localFailureMessage(parsed), "error"), true);
      return;
    }
    const submittedRevision = revision;
    loading = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    show(createStatus("Verifying the network-free Purview output…"));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) return;
      show(createResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) return;
      let failure: PurviewAuditBoundaryRehearsalPanelFailure = "unavailable";
      try {
        failure = options.client.classifyError(error);
      } catch {
        // Preserve the fixed general failure.
      }
      show(createStatus(failureMessage(failure), "error"), true);
    }).finally(() => {
      loading = false;
      submit.disabled = false;
      form.setAttribute("aria-busy", "false");
    });
  });
  return section;
}

function parseInput(
  text: string,
  parse: (
    value: unknown,
  ) => PurviewAuditBoundaryRehearsalVerificationRequest | undefined,
): PurviewAuditBoundaryRehearsalVerificationRequest | "empty" | "invalid" | "label" |
  "scenario" | "too-large" {
  if (text.trim().length === 0) return "empty";
  if (
    new TextEncoder().encode(text).byteLength >
    PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES
  ) {
    return "too-large";
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return "invalid";
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).label !== "REHEARSAL_ONLY"
  ) {
    return "label";
  }
  const binding = (value as Record<string, unknown>).binding;
  const scenarioId = typeof binding === "object" &&
      binding !== null &&
      !Array.isArray(binding)
    ? (binding as Record<string, unknown>).scenarioId
    : undefined;
  if (scenarioId !== "purview-sharepoint-audit-boundary") return "scenario";
  try {
    return parse(value) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function createResult(
  result: VerifiedPurviewAuditBoundaryRehearsalSummary,
): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className = "purview-rehearsal-verification-result";
  resultSection.setAttribute(
    "aria-label",
    "Purview audit-boundary rehearsal verification result",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Network-free contract verified";
  const summary = document.createElement("dl");
  summary.className = "purview-rehearsal-verification-summary";
  appendIdentity(summary, "Contract consistency", fixedLabel(result.status));
  appendIdentity(
    summary,
    "Synthetic observation contract",
    fixedLabel(result.syntheticContract),
  );
  appendIdentity(summary, "Adapter contract", fixedLabel(result.adapter));
  appendIdentity(
    summary,
    "Receipt verifier",
    fixedLabel(result.receiptVerifier),
  );
  appendIdentity(summary, "Shared envelope", fixedLabel(result.envelope));
  appendIdentity(
    summary,
    "External claim coverage",
    fixedLabel(result.externalEvidence),
  );
  appendIdentity(summary, "Synthetic receipt claims", String(result.claimCount));
  appendIdentity(
    summary,
    "Deduplicated producer-attribution claims",
    String(result.producerAttributionClaimCount),
  );
  resultSection.append(
    heading,
    summary,
    createStatus(
      "This result proves only contract consistency. Duplicate synthetic pages remain one categorical producer-attribution claim; all audit-search, live-operation, external attribution, content, learner, response, cleanup, retention, and impact claims remain uninspected.",
      "notice",
    ),
  );
  return resultSection;
}

function localFailureMessage(
  failure: "empty" | "invalid" | "label" | "scenario" | "too-large",
): string {
  switch (failure) {
    case "empty":
      return "Local validation failed: paste one sanitized Purview audit-boundary REHEARSAL_ONLY envelope before verifying.";
    case "invalid":
      return "Local validation failed: use only the exact bounded PR #129 envelope with fixed fields and safe values.";
    case "label":
      return "Local validation failed: the envelope must have the exact REHEARSAL_ONLY label.";
    case "scenario":
      return "Local validation failed: the envelope must target only the canonical Purview audit-boundary scenario.";
    case "too-large":
      return "Local validation failed: the JSON document exceeds the 32 KiB input limit.";
  }
}

function failureMessage(
  failure: PurviewAuditBoundaryRehearsalPanelFailure,
): string {
  switch (failure) {
    case "session-expired":
      return "Purview rehearsal verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify Purview rehearsal outputs.";
    case "verification-refused":
      return "Purview rehearsal verification refused the envelope because its contract was inconsistent or tampered.";
    case "request-too-large":
      return "Purview rehearsal verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Purview rehearsal verification stopped at the safe response-size limit.";
    case "server-shutting-down":
      return SERVER_SHUTTING_DOWN_MESSAGE;
    case "unavailable":
      return "Purview rehearsal verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
  }
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
