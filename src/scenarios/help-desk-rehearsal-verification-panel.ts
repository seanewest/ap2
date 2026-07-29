import { appendIdentity, createStatus } from "../ui/elements";
import { SERVER_SHUTTING_DOWN_MESSAGE } from "../api/server-shutdown";
import { withApiSupportReference } from "../api/support-reference";
import {
  HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES,
  type HelpDeskEmailRehearsalVerificationRequest,
  type VerifiedHelpDeskEmailRehearsalSummary,
} from "../api/help-desk-email-rehearsal-verification-contract";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const HELP_DESK_REHEARSAL_VERIFICATION_PANEL_CAPABILITY = {
  schemaVersion: 1,
  surface: "manual-rehearsal-verification-panel",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["help-desk-email-observation"],
  routeOwnerKey: "help-desk-email-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type SafeHelpDeskRehearsalSummary =
  VerifiedHelpDeskEmailRehearsalSummary;

export type HelpDeskRehearsalPanelFailure =
  | "request-too-large"
  | "response-too-large"
  | "server-shutting-down"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface HelpDeskRehearsalPanelClient<
  TInput extends object = HelpDeskEmailRehearsalVerificationRequest,
> {
  parse(value: unknown): TInput | undefined;
  verify(input: TInput): Promise<SafeHelpDeskRehearsalSummary>;
  classifyError(error: unknown): HelpDeskRehearsalPanelFailure;
}

export interface HelpDeskRehearsalPanelOptions<
  TInput extends object = HelpDeskEmailRehearsalVerificationRequest,
> {
  client: HelpDeskRehearsalPanelClient<TInput>;
}

export function createHelpDeskRehearsalVerificationPanel<
  TInput extends object,
>(
  options: HelpDeskRehearsalPanelOptions<TInput>,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "help-desk-rehearsal-verification";
  section.setAttribute(
    "aria-labelledby",
    "help-desk-rehearsal-verification-heading",
  );
  const heading = document.createElement("h2");
  heading.id = "help-desk-rehearsal-verification-heading";
  heading.textContent = "Help-desk email rehearsal verification";
  section.append(
    heading,
    createStatus(
      "This verifies one network-free REHEARSAL_ONLY contract output. Send acceptance does not prove Inbox visibility, and post-cleanup absence cannot substitute for pre-cleanup learner observation. Every external claim remains uninspected.",
      "notice",
    ),
  );

  const form = document.createElement("form");
  form.className = "help-desk-rehearsal-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent = "Sanitized help-desk REHEARSAL_ONLY output JSON";
  const guidance = document.createElement("span");
  guidance.className = "field-guidance";
  guidance.id = "help-desk-rehearsal-verification-guidance";
  guidance.textContent =
    "One exact PR #103 envelope, at most 32 KiB. Raw identities, UPNs, paths, email subject or body text, markers, credentials, session data, unknown fields, arbitrary labels or text, and external-proof claims are refused locally.";
  const input = document.createElement("textarea");
  input.name = "helpDeskRehearsalOutput";
  input.rows = 10;
  input.maxLength = HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES;
  input.required = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", guidance.id);
  field.append(guidance, input);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Verify help-desk rehearsal";
  const output = document.createElement("div");
  output.className = "help-desk-rehearsal-verification-output";
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
    "No rehearsal output submitted. Paste one sanitized envelope and select Verify help-desk rehearsal.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised envelope."
        : "Input changed. Select Verify help-desk rehearsal to check the revised envelope.",
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
    show(createStatus("Verifying the network-free help-desk rehearsal…"));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) return;
      show(createResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) return;
      let failure: HelpDeskRehearsalPanelFailure = "unavailable";
      try {
        failure = options.client.classifyError(error);
      } catch {
        // Preserve the fixed general failure.
      }
      show(createStatus(
        withApiSupportReference(failureMessage(failure), error),
        "error",
      ), true);
    }).finally(() => {
      loading = false;
      submit.disabled = false;
      form.setAttribute("aria-busy", "false");
    });
  });
  return section;
}

function parseInput<TInput extends object>(
  text: string,
  parse: (value: unknown) => TInput | undefined,
): TInput | "branch" | "empty" | "invalid" | "label" | "too-large" {
  if (text.trim().length === 0) return "empty";
  if (
    new TextEncoder().encode(text).byteLength >
    HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES
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
  const branch = typeof binding === "object" &&
      binding !== null &&
      !Array.isArray(binding)
    ? (binding as Record<string, unknown>).syntheticBranch
    : undefined;
  if (
    branch !== "send-accepted" &&
    branch !== "learner-observed-retained" &&
    branch !== "learner-observed-cleaned"
  ) {
    return "branch";
  }
  try {
    return parse(value) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function createResult(result: SafeHelpDeskRehearsalSummary): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className = "help-desk-rehearsal-verification-result";
  resultSection.setAttribute(
    "aria-label",
    "Help-desk email rehearsal verification result",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Network-free contract verified";
  const summary = document.createElement("dl");
  summary.className = "help-desk-rehearsal-verification-summary";
  appendIdentity(summary, "Contract consistency", fixedLabel(result.status));
  appendIdentity(summary, "Synthetic branch", fixedLabel(result.syntheticBranch));
  appendIdentity(summary, "Terminal fake state", fixedLabel(result.fakeContract));
  appendIdentity(summary, "Adapter contract", fixedLabel(result.adapter));
  appendIdentity(summary, "Receipt verifier", fixedLabel(result.receiptVerifier));
  appendIdentity(summary, "Envelope contract", fixedLabel(result.envelope));
  appendIdentity(
    summary,
    "External claim coverage",
    fixedLabel(result.externalEvidence),
  );
  appendIdentity(summary, "Synthetic receipt claim count", String(result.claimCount));
  resultSection.append(
    heading,
    summary,
    createStatus(
      "This result proves only contract consistency. Send acceptance does not prove Inbox visibility. Post-cleanup absence cannot replace pre-cleanup learner observation, and every external claim remains uninspected.",
      "notice",
    ),
  );
  return resultSection;
}

function localFailureMessage(
  failure: "branch" | "empty" | "invalid" | "label" | "too-large",
): string {
  switch (failure) {
    case "empty":
      return "Local validation failed: paste one sanitized help-desk REHEARSAL_ONLY envelope before verifying.";
    case "invalid":
      return "Local validation failed: use only the exact bounded PR #103 envelope with fixed fields and safe values.";
    case "label":
      return "Local validation failed: the envelope must have the exact REHEARSAL_ONLY label.";
    case "branch":
      return "Local validation failed: the synthetic branch must be exactly send-accepted, learner-observed-retained, or learner-observed-cleaned.";
    case "too-large":
      return "Local validation failed: the JSON document exceeds the 32 KiB input limit.";
  }
}

function failureMessage(failure: HelpDeskRehearsalPanelFailure): string {
  switch (failure) {
    case "session-expired":
      return "Help-desk verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify help-desk rehearsal outputs.";
    case "verification-refused":
      return "Help-desk verification refused the envelope because its contract was inconsistent or tampered.";
    case "request-too-large":
      return "Help-desk verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Help-desk verification stopped at the safe response-size limit.";
    case "unavailable":
      return "Help-desk verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
    case "server-shutting-down":
      return SERVER_SHUTTING_DOWN_MESSAGE;
  }
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
