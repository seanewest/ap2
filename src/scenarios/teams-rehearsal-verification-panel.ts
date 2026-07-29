import { appendIdentity, createStatus } from "../ui/elements";
import type {
  VerifiedTeamsMissedCallRehearsalSummary,
} from "../../scripts/verify-teams-missed-call-rehearsal-output";

const MAX_REQUEST_BYTES = 32 * 1024;

export type TeamsRehearsalPanelFailure =
  | "request-too-large"
  | "response-too-large"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface TeamsRehearsalPanelClient<TInput extends object = object> {
  parse(value: unknown): TInput | undefined;
  verify(input: TInput): Promise<VerifiedTeamsMissedCallRehearsalSummary>;
  classifyError(error: unknown): TeamsRehearsalPanelFailure;
}

export interface TeamsRehearsalPanelOptions<TInput extends object = object> {
  client: TeamsRehearsalPanelClient<TInput>;
}

export function createTeamsRehearsalVerificationPanel<TInput extends object>(
  options: TeamsRehearsalPanelOptions<TInput>,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "teams-rehearsal-verification";
  section.setAttribute(
    "aria-labelledby",
    "teams-rehearsal-verification-heading",
  );
  const heading = document.createElement("h2");
  heading.id = "teams-rehearsal-verification-heading";
  heading.textContent = "Teams missed-call rehearsal verification";
  section.append(
    heading,
    createStatus(
      "This verifies one network-free REHEARSAL_ONLY contract output. Synthetic staging does not prove a call, native Teams evidence, learner visibility or interpretation, cleanup, identity, or external proof.",
      "notice",
    ),
  );

  const form = document.createElement("form");
  form.className = "teams-rehearsal-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent = "Sanitized Teams REHEARSAL_ONLY output JSON";
  const guidance = document.createElement("span");
  guidance.className = "field-guidance";
  guidance.id = "teams-rehearsal-verification-guidance";
  guidance.textContent =
    "One exact PR #106 envelope, at most 32 KiB. Raw identities, UPNs, paths, call or permission markers, credentials, session data, unknown fields, arbitrary labels or text, and external-proof claims are refused locally.";
  const input = document.createElement("textarea");
  input.name = "teamsRehearsalOutput";
  input.rows = 10;
  input.maxLength = MAX_REQUEST_BYTES;
  input.required = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", guidance.id);
  field.append(guidance, input);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Verify Teams rehearsal";
  const output = document.createElement("div");
  output.className = "teams-rehearsal-verification-output";
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
    "No rehearsal output submitted. Paste one sanitized envelope and select Verify Teams rehearsal.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised envelope."
        : "Input changed. Select Verify Teams rehearsal to check the revised envelope.",
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
    show(createStatus("Verifying the network-free Teams rehearsal…"));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) return;
      show(createResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) return;
      let failure: TeamsRehearsalPanelFailure = "unavailable";
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

function parseInput<TInput extends object>(
  text: string,
  parse: (value: unknown) => TInput | undefined,
): TInput | "branch" | "empty" | "invalid" | "label" | "too-large" {
  if (text.trim().length === 0) return "empty";
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
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
    branch !== "stage-only" &&
    branch !== "native-retained" &&
    branch !== "reported-retained" &&
    branch !== "native-cleaned"
  ) {
    return "branch";
  }
  try {
    return parse(value) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function createResult(
  result: VerifiedTeamsMissedCallRehearsalSummary,
): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className = "teams-rehearsal-verification-result";
  resultSection.setAttribute(
    "aria-label",
    "Teams missed-call rehearsal verification result",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Network-free contract verified";
  const summary = document.createElement("dl");
  summary.className = "teams-rehearsal-verification-summary";
  appendIdentity(summary, "Contract consistency", fixedLabel(result.status));
  appendIdentity(summary, "Synthetic branch", fixedLabel(result.syntheticBranch));
  appendIdentity(summary, "Terminal fake state", fixedLabel(result.fakeContract));
  appendIdentity(summary, "Native observation", fixedLabel(result.nativeObservation));
  appendIdentity(summary, "Optional report", fixedLabel(result.report));
  appendIdentity(summary, "Cleanup", fixedLabel(result.cleanup));
  appendIdentity(summary, "Adapter contract", fixedLabel(result.adapter));
  appendIdentity(summary, "Receipt verifier", fixedLabel(result.receiptVerifier));
  appendIdentity(
    summary,
    "External claim coverage",
    fixedLabel(result.externalEvidence),
  );
  appendIdentity(
    summary,
    "Learner interpretation",
    fixedLabel(result.canonicalLearnerInterpretation),
  );
  appendIdentity(summary, "Synthetic receipt claim count", String(result.claimCount));
  resultSection.append(
    heading,
    summary,
    createStatus(
      "This result proves only contract consistency. It proves no call or native Teams evidence, and every external claim and canonical learner interpretation remains uninspected.",
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
      return "Local validation failed: paste one sanitized Teams REHEARSAL_ONLY envelope before verifying.";
    case "invalid":
      return "Local validation failed: use only the exact bounded PR #106 envelope with fixed fields and safe values.";
    case "label":
      return "Local validation failed: the envelope must have the exact REHEARSAL_ONLY label.";
    case "branch":
      return "Local validation failed: the synthetic branch must be exactly stage-only, native-retained, reported-retained, or native-cleaned.";
    case "too-large":
      return "Local validation failed: the JSON document exceeds the 32 KiB input limit.";
  }
}

function failureMessage(failure: TeamsRehearsalPanelFailure): string {
  switch (failure) {
    case "session-expired":
      return "Teams rehearsal verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify Teams rehearsal outputs.";
    case "verification-refused":
      return "Teams rehearsal verification refused the envelope because its contract was inconsistent or tampered.";
    case "request-too-large":
      return "Teams rehearsal verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Teams rehearsal verification stopped at the safe response-size limit.";
    case "unavailable":
      return "Teams rehearsal verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
  }
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
