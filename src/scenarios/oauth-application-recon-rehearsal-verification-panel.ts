import {
  OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES,
  type OauthApplicationReconRehearsalVerificationRequest,
  type VerifiedOauthApplicationReconRehearsalSummary,
} from "../api/oauth-application-recon-rehearsal-verification-contract";
import { appendIdentity, createStatus } from "../ui/elements";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const OAUTH_APPLICATION_RECON_REHEARSAL_VERIFICATION_PANEL_CAPABILITY = {
  schemaVersion: 1,
  surface: "manual-rehearsal-verification-panel",
  scenarioScope: "explicit-scenarios",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
  scenarioIds: ["oauth-application-reconnaissance"],
  routeOwnerKey: "oauth-application-recon-rehearsal-verify",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

export type SafeOauthApplicationReconRehearsalSummary =
  VerifiedOauthApplicationReconRehearsalSummary;

export type OauthApplicationReconRehearsalPanelFailure =
  | "request-too-large"
  | "response-too-large"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface OauthApplicationReconRehearsalPanelClient {
  parse(
    value: unknown,
  ): OauthApplicationReconRehearsalVerificationRequest | undefined;
  verify(
    input: OauthApplicationReconRehearsalVerificationRequest,
  ): Promise<SafeOauthApplicationReconRehearsalSummary>;
  classifyError(
    error: unknown,
  ): OauthApplicationReconRehearsalPanelFailure;
}

export interface OauthApplicationReconRehearsalPanelOptions {
  client: OauthApplicationReconRehearsalPanelClient;
}

export function createOauthApplicationReconRehearsalVerificationPanel(
  options: OauthApplicationReconRehearsalPanelOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "oauth-recon-rehearsal-verification";
  section.setAttribute(
    "aria-labelledby",
    "oauth-recon-rehearsal-verification-heading",
  );
  const heading = document.createElement("h2");
  heading.id = "oauth-recon-rehearsal-verification-heading";
  heading.textContent = "Application-reconnaissance rehearsal verification";
  section.append(
    heading,
    createStatus(
      "This manually verifies one network-free REHEARSAL_ONLY contract output. It does not run reconnaissance, inspect a tenant, or prove detector, learner, cleanup, retention, audit, or impact claims.",
      "notice",
    ),
  );

  const form = document.createElement("form");
  form.className = "oauth-recon-rehearsal-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent =
    "Sanitized application-reconnaissance REHEARSAL_ONLY output JSON";
  const guidance = document.createElement("span");
  guidance.className = "field-guidance";
  guidance.id = "oauth-recon-rehearsal-verification-guidance";
  guidance.textContent =
    "One exact PR #111 envelope, at most 32 KiB. Raw identities, UPNs, paths, tenant or object identifiers, markers, credentials, authentication material, unknown fields, arbitrary text, and external-proof claims are refused locally.";
  const input = document.createElement("textarea");
  input.name = "oauthApplicationReconRehearsalOutput";
  input.rows = 10;
  input.maxLength = OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES;
  input.required = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", guidance.id);
  field.append(guidance, input);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Verify application-reconnaissance rehearsal";
  const output = document.createElement("div");
  output.className = "oauth-recon-rehearsal-verification-output";
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
    "No rehearsal output submitted. Paste one sanitized envelope and select Verify application-reconnaissance rehearsal.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised envelope."
        : "Input changed. Select Verify application-reconnaissance rehearsal to check the revised envelope.",
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
      "Verifying the network-free application-reconnaissance output…",
    ));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) return;
      show(createResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) return;
      let failure: OauthApplicationReconRehearsalPanelFailure = "unavailable";
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

function parseInput(
  text: string,
  parse: (
    value: unknown,
  ) => OauthApplicationReconRehearsalVerificationRequest | undefined,
): OauthApplicationReconRehearsalVerificationRequest | "empty" | "invalid" |
  "label" | "scenario" | "too-large" {
  if (text.trim().length === 0) return "empty";
  if (
    new TextEncoder().encode(text).byteLength >
    OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES
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
  if (scenarioId !== "oauth-application-reconnaissance") return "scenario";
  try {
    return parse(value) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function createResult(
  result: SafeOauthApplicationReconRehearsalSummary,
): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className = "oauth-recon-rehearsal-verification-result";
  resultSection.setAttribute(
    "aria-label",
    "Application-reconnaissance rehearsal verification result",
  );
  const heading = document.createElement("h3");
  heading.textContent = "Network-free contract verified";
  const summary = document.createElement("dl");
  summary.className = "oauth-recon-rehearsal-verification-summary";
  appendIdentity(summary, "Contract consistency", fixedLabel(result.status));
  appendIdentity(
    summary,
    "Four-read fake contract",
    fixedLabel(result.fakeContract),
  );
  appendIdentity(summary, "Adapter contract", fixedLabel(result.adapter));
  appendIdentity(
    summary,
    "Receipt verifier",
    fixedLabel(result.receiptVerifier),
  );
  appendIdentity(
    summary,
    "Shared envelope",
    fixedLabel(result.envelope),
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
      "This result proves only contract consistency. All detector, learner, permission-restoration, evidence-window, cleanup, retention, revocation, interpretation, audit, tenant-content, and impact claims remain uninspected.",
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
      return "Local validation failed: paste one sanitized application-reconnaissance REHEARSAL_ONLY envelope before verifying.";
    case "invalid":
      return "Local validation failed: use only the exact bounded PR #111 envelope with fixed fields and safe values.";
    case "label":
      return "Local validation failed: the envelope must have the exact REHEARSAL_ONLY label.";
    case "scenario":
      return "Local validation failed: the envelope must target only the canonical application-reconnaissance scenario.";
    case "too-large":
      return "Local validation failed: the JSON document exceeds the 32 KiB input limit.";
  }
}

function failureMessage(
  failure: OauthApplicationReconRehearsalPanelFailure,
): string {
  switch (failure) {
    case "session-expired":
      return "Application-reconnaissance verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify application-reconnaissance rehearsal outputs.";
    case "verification-refused":
      return "Application-reconnaissance verification refused the envelope because its contract was inconsistent or tampered.";
    case "request-too-large":
      return "Application-reconnaissance verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Application-reconnaissance verification stopped at the safe response-size limit.";
    case "unavailable":
      return "Application-reconnaissance verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
  }
}

function fixedLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
