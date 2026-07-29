import { appendIdentity, createStatus } from "../ui/elements";
import type {
  VerifiedPrivateDocumentRehearsalSummary,
} from "../../scripts/verify-private-document-rehearsal-output";

const MAX_REQUEST_BYTES = 32 * 1024;

export type SafePrivateDocumentRehearsalSummary =
  VerifiedPrivateDocumentRehearsalSummary;

export type PrivateDocumentRehearsalPanelFailure =
  | "request-too-large"
  | "response-too-large"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface PrivateDocumentRehearsalPanelClient<
  TInput extends object = object,
> {
  parse(value: unknown): TInput | undefined;
  verify(input: TInput): Promise<SafePrivateDocumentRehearsalSummary>;
  classifyError(error: unknown): PrivateDocumentRehearsalPanelFailure;
}

export interface PrivateDocumentRehearsalPanelOptions<
  TInput extends object = object,
> {
  client: PrivateDocumentRehearsalPanelClient<TInput>;
}

export function createPrivateDocumentRehearsalVerificationPanel<
  TInput extends object,
>(
  options: PrivateDocumentRehearsalPanelOptions<TInput>,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "private-document-rehearsal-verification";
  section.setAttribute(
    "aria-labelledby",
    "private-document-rehearsal-verification-heading",
  );
  const heading = document.createElement("h2");
  heading.id = "private-document-rehearsal-verification-heading";
  heading.textContent = "Private-document rehearsal verification";
  section.append(
    heading,
    createStatus(
      "This verifies one network-free REHEARSAL_ONLY contract output. Synthetic learner observation does not prove live learner visibility, and post-cleanup absence cannot substitute for pre-cleanup access.",
      "notice",
    ),
  );

  const form = document.createElement("form");
  form.className = "private-document-rehearsal-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent = "Sanitized private-document REHEARSAL_ONLY output JSON";
  const guidance = document.createElement("span");
  guidance.className = "field-guidance";
  guidance.id = "private-document-rehearsal-verification-guidance";
  guidance.textContent =
    "One exact PR #90 envelope, at most 32 KiB. Raw identities, UPNs, paths, permission or file markers, credentials, session data, unknown fields, arbitrary labels or text, and external-proof claims are refused locally.";
  const input = document.createElement("textarea");
  input.name = "privateDocumentRehearsalOutput";
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
  submit.textContent = "Verify private-document rehearsal";
  const output = document.createElement("div");
  output.className = "private-document-rehearsal-verification-output";
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
    "No rehearsal output submitted. Paste one sanitized envelope and select Verify private-document rehearsal.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised envelope."
        : "Input changed. Select Verify private-document rehearsal to check the revised envelope.",
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
    show(createStatus(
      "Verifying the network-free private-document rehearsal output…",
    ));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) return;
      show(createResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) return;
      let failure: PrivateDocumentRehearsalPanelFailure = "unavailable";
      try {
        failure = options.client.classifyError(error);
      } catch {
        // Keep the fixed general failure.
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
  if (branch !== "cleaned-canary" && branch !== "learner-observation") {
    return "branch";
  }
  try {
    return parse(value) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function createResult(
  result: SafePrivateDocumentRehearsalSummary,
): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className =
    "private-document-rehearsal-verification-result";
  resultSection.setAttribute(
    "aria-label",
    "Private-document rehearsal verification result",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Network-free contract verified";
  const summary = document.createElement("dl");
  summary.className =
    "private-document-rehearsal-verification-summary";
  appendIdentity(summary, "Contract consistency", fixedLabel(result.status));
  appendIdentity(
    summary,
    "Synthetic branch",
    fixedLabel(result.syntheticBranch),
  );
  appendIdentity(
    summary,
    "Terminal fake state",
    fixedLabel(result.fakeContract),
  );
  appendIdentity(
    summary,
    "Adapter contract",
    fixedLabel(result.adapter),
  );
  appendIdentity(
    summary,
    "Receipt verifier",
    fixedLabel(result.receiptVerifier),
  );
  appendIdentity(
    summary,
    "External claim coverage",
    fixedLabel(result.externalEvidence),
  );
  appendIdentity(
    summary,
    "Synthetic receipt claim count",
    String(result.claimCount),
  );
  resultSection.append(
    heading,
    summary,
    createStatus(
      "This result proves only contract consistency. Synthetic learner observation does not prove live learner visibility. Post-cleanup absence cannot substitute for pre-cleanup access, and every external claim remains uninspected.",
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
      return "Local validation failed: paste one sanitized private-document REHEARSAL_ONLY envelope before verifying.";
    case "invalid":
      return "Local validation failed: use only the exact bounded PR #90 envelope with fixed fields and safe values.";
    case "label":
      return "Local validation failed: the envelope must have the exact REHEARSAL_ONLY label.";
    case "branch":
      return "Local validation failed: the synthetic branch must be exactly cleaned-canary or learner-observation.";
    case "too-large":
      return "Local validation failed: the JSON document exceeds the 32 KiB input limit.";
  }
}

function failureMessage(
  failure: PrivateDocumentRehearsalPanelFailure,
): string {
  switch (failure) {
    case "session-expired":
      return "Private-document verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify private-document rehearsal outputs.";
    case "verification-refused":
      return "Private-document verification refused the envelope because its contract was inconsistent or tampered.";
    case "request-too-large":
      return "Private-document verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Private-document verification stopped at the safe response-size limit.";
    case "unavailable":
      return "Private-document verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
  }
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
