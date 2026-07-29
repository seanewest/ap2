import { appendIdentity, createStatus } from "../ui/elements";
import { SERVER_SHUTTING_DOWN_MESSAGE } from "../api/server-shutdown";
import { withApiSupportReference } from "../api/support-reference";
import {
  REHEARSAL_OUTPUT_MAX_REQUEST_BYTES,
  type RehearsalOutputVerificationRequest,
  type VerifiedRehearsalOutputSummary,
} from "../api/rehearsal-output-verification-contract";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const AVD_REHEARSAL_VERIFICATION_PANEL_CAPABILITY = {
  schemaVersion: 1,
  surface: "manual-rehearsal-verification-panel",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["avd-three-vm-substrate"],
  routeOwnerKey: "avd-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type SafeAvdRehearsalVerificationSummary =
  VerifiedRehearsalOutputSummary;

export type AvdRehearsalVerificationFailure =
  | "request-too-large"
  | "response-too-large"
  | "server-shutting-down"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface AvdRehearsalVerificationPanelClient<
  TInput extends object = RehearsalOutputVerificationRequest,
> {
  parse(value: unknown): TInput | undefined;
  verify(input: TInput): Promise<SafeAvdRehearsalVerificationSummary>;
  classifyError(error: unknown): AvdRehearsalVerificationFailure;
}

export interface AvdRehearsalVerificationPanelOptions<
  TInput extends object = RehearsalOutputVerificationRequest,
> {
  client: AvdRehearsalVerificationPanelClient<TInput>;
}

export function createAvdRehearsalVerificationPanel<TInput extends object>(
  options: AvdRehearsalVerificationPanelOptions<TInput>,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "avd-rehearsal-verification";
  section.setAttribute(
    "aria-labelledby",
    "avd-rehearsal-verification-heading",
  );
  const heading = document.createElement("h2");
  heading.id = "avd-rehearsal-verification-heading";
  heading.textContent = "AVD rehearsal verification";
  const disclosure = createStatus(
    "This verifies one network-free REHEARSAL_ONLY contract output. It proves no live Azure, endpoint, learner, cleanup, or external evidence activity.",
    "notice",
  );

  const form = document.createElement("form");
  form.className = "avd-rehearsal-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent = "Sanitized REHEARSAL_ONLY output JSON";
  const guidance = document.createElement("span");
  guidance.className = "field-guidance";
  guidance.id = "avd-rehearsal-verification-guidance";
  guidance.textContent =
    "One PR #83 JSON envelope, at most 32 KiB. Raw identities, UPNs, paths, markers, credentials, session data, unknown fields, and arbitrary labels or text are refused locally.";
  const input = document.createElement("textarea");
  input.name = "rehearsalOutput";
  input.rows = 10;
  input.maxLength = REHEARSAL_OUTPUT_MAX_REQUEST_BYTES;
  input.required = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", guidance.id);
  field.append(guidance, input);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Verify rehearsal output";
  const output = document.createElement("div");
  output.className = "avd-rehearsal-verification-output";
  output.setAttribute("aria-live", "polite");
  output.tabIndex = -1;
  form.append(field, submit);
  section.append(heading, disclosure, form, output);

  let revision = 0;
  let loading = false;
  const show = (content: HTMLElement, focus = false): void => {
    output.replaceChildren(content);
    if (focus) {
      output.focus();
    }
  };
  show(createStatus(
    "No rehearsal output submitted. Paste one sanitized envelope and select Verify rehearsal output.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised envelope."
        : "Input changed. Select Verify rehearsal output to check the revised envelope.",
    ));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    const parsed = parseInput(input.value, options.client.parse);
    if (typeof parsed === "string") {
      show(createStatus(localFailureMessage(parsed), "error"), true);
      return;
    }

    const submittedRevision = revision;
    loading = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    show(createStatus("Verifying the network-free rehearsal output…"));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) {
        return;
      }
      show(createResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) {
        return;
      }
      let failure: AvdRehearsalVerificationFailure = "unavailable";
      try {
        failure = options.client.classifyError(error);
      } catch {
        // Keep the fixed general failure.
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
): TInput | "empty" | "invalid" | "label" | "too-large" {
  if (text.trim().length === 0) {
    return "empty";
  }
  if (
    new TextEncoder().encode(text).byteLength >
    REHEARSAL_OUTPUT_MAX_REQUEST_BYTES
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
  try {
    return parse(value) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function createResult(
  result: SafeAvdRehearsalVerificationSummary,
): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className = "avd-rehearsal-verification-result";
  resultSection.setAttribute(
    "aria-label",
    "AVD rehearsal verification result",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Network-free contract verified";
  const summary = document.createElement("dl");
  summary.className = "avd-rehearsal-verification-summary";
  appendIdentity(summary, "Contract consistency", fixedLabel(result.status));
  appendIdentity(summary, "Fake run", fixedLabel(result.run));
  appendIdentity(summary, "Ordered cleanup", fixedLabel(result.cleanup));
  appendIdentity(
    summary,
    "Observation source",
    fixedLabel(result.observations),
  );
  appendIdentity(
    summary,
    "Receipt coverage",
    fixedLabel(result.evidenceClaims),
  );
  appendIdentity(summary, "Synthetic claim count", String(result.claimCount));
  appendIdentity(
    summary,
    "Uninspected coverage count",
    String(result.missingCoverageTotal),
  );
  resultSection.append(
    heading,
    summary,
    createStatus(
      "Contract verification is not execution proof. No live Azure resource, endpoint state, learner action, cleanup, or external evidence was checked.",
      "notice",
    ),
  );
  return resultSection;
}

function localFailureMessage(
  failure: "empty" | "invalid" | "label" | "too-large",
): string {
  switch (failure) {
    case "empty":
      return "Local validation failed: paste one sanitized REHEARSAL_ONLY envelope before verifying.";
    case "invalid":
      return "Local validation failed: use only the exact bounded PR #83 envelope with fixed fields and safe values.";
    case "label":
      return "Local validation failed: the envelope must have the exact REHEARSAL_ONLY label.";
    case "too-large":
      return "Local validation failed: the JSON document exceeds the 32 KiB input limit.";
  }
}

function failureMessage(
  failure: AvdRehearsalVerificationFailure,
): string {
  switch (failure) {
    case "session-expired":
      return "Rehearsal verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify rehearsal outputs.";
    case "verification-refused":
      return "Rehearsal verification refused the envelope because its contract was inconsistent or tampered.";
    case "request-too-large":
      return "Rehearsal verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Rehearsal verification stopped at the safe response-size limit.";
    case "unavailable":
      return "Rehearsal verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
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
