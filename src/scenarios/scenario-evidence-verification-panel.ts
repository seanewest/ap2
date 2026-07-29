import {
  parseScenarioEvidenceReceiptRequest,
  ScenarioEvidenceContractError,
} from "../api/scenario-evidence-verification-contract";
import { appendIdentity, createStatus } from "../ui/elements";
import { SERVER_SHUTTING_DOWN_MESSAGE } from "../api/server-shutdown";
import type {
  ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt";
import type {
  SafeVerifiedScenarioEvidenceReceipt,
} from "./scenario-evidence-verification";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "./scenario-surface-capability";

export const SCENARIO_RECEIPT_VERIFICATION_UI_CAPABILITY = {
  schemaVersion: 1,
  surface: "operator-receipt-verify-ui",
  scenarioScope: "canonical-registry",
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioSurfaceCapabilityDeclaration;

const MAX_RECEIPT_BYTES = 131_072;
const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{24,}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const URI_OR_PATH = /^(?:[a-z][a-z0-9+.-]*:\/\/|[a-z]:[\\/]|\\\\|\/|~\/)/i;
const PRIVATE_PATH = /(?:^|[\\/])(?:home|users|documents|desktop)(?:[\\/]|$)/i;
const MARKER = /^m1_[0-9a-f]{24}$/i;
const SENSITIVE_TERM =
  /(?:^|[._-])(?:token|session|secret|credential|certificate|password|cookie|bearer|api[-_]?key|private[-_]?key|proof[-_]?reference|tenant[-_]?id|object[-_]?id|message[-_]?id|resource[-_]?id|subscription[-_]?id|user[-_]?id|client[-_]?id)(?:$|[._-])/i;

export type ScenarioEvidenceVerificationFailure =
  | "request-too-large"
  | "response-too-large"
  | "server-shutting-down"
  | "session-expired"
  | "unauthorized"
  | "unavailable"
  | "verification-refused";

export interface ScenarioEvidenceVerificationPanelClient {
  verify(
    receipt: ScenarioEvidenceReceipt,
  ): Promise<SafeVerifiedScenarioEvidenceReceipt>;
  classifyError(error: unknown): ScenarioEvidenceVerificationFailure;
}

export interface ScenarioEvidenceVerificationPanelOptions {
  client: ScenarioEvidenceVerificationPanelClient;
}

export function createScenarioEvidenceVerificationPanel(
  options: ScenarioEvidenceVerificationPanelOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "scenario-evidence-verification";
  section.setAttribute(
    "aria-labelledby",
    "scenario-evidence-verification-heading",
  );

  const heading = document.createElement("h2");
  heading.id = "scenario-evidence-verification-heading";
  heading.textContent = "Receipt verification";
  const disclosure = createStatus(
    "Verification checks one sanitized receipt for internal consistency. It does not collect evidence, authorize or perform work, or prove that an external operation occurred.",
    "notice",
  );
  disclosure.id = "scenario-evidence-verification-disclosure";

  const form = document.createElement("form");
  form.className = "scenario-evidence-verification-form";
  form.noValidate = true;
  const field = document.createElement("label");
  field.textContent = "Sanitized receipt JSON";
  const guidance = document.createElement("span");
  guidance.id = "scenario-evidence-verification-guidance";
  guidance.className = "field-guidance";
  guidance.textContent =
    "One JSON object, at most 128 KiB. Raw identities, UPNs, paths, markers, credentials, session data, unknown fields, and arbitrary text are refused locally.";
  const input = document.createElement("textarea");
  input.name = "receipt";
  input.rows = 10;
  input.maxLength = MAX_RECEIPT_BYTES;
  input.required = true;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", guidance.id);
  field.append(guidance, input);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Verify receipt";

  const output = document.createElement("div");
  output.className = "scenario-evidence-verification-output";
  output.setAttribute("aria-live", "polite");
  output.tabIndex = -1;
  form.append(field, submit);
  section.append(heading, disclosure, form, output);

  let revision = 0;
  let loading = false;
  const show = (
    content: HTMLElement,
    focus = false,
  ): void => {
    output.replaceChildren(content);
    if (focus) {
      output.focus();
    }
  };
  show(createStatus(
    "No receipt submitted. Paste one sanitized receipt and select Verify receipt.",
  ));

  input.addEventListener("input", () => {
    revision += 1;
    show(createStatus(
      loading
        ? "Input changed. The pending response will be ignored; wait before verifying the revised receipt."
        : "Input changed. Select Verify receipt to check the revised receipt.",
    ));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    const parsed = parseReceiptInput(input.value);
    if (typeof parsed === "string") {
      show(createStatus(validationMessage(parsed), "error"), true);
      return;
    }

    const submittedRevision = revision;
    loading = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    show(createStatus("Verifying the sanitized receipt…"));
    void options.client.verify(parsed).then((result) => {
      if (revision !== submittedRevision) {
        return;
      }
      show(createVerificationResult(result), true);
    }).catch((error: unknown) => {
      if (revision !== submittedRevision) {
        return;
      }
      let failure: ScenarioEvidenceVerificationFailure = "unavailable";
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

export function parseReceiptInput(
  input: string,
): ScenarioEvidenceReceipt | "empty" | "invalid" | "too-large" | "unsafe" {
  if (input.trim().length === 0) {
    return "empty";
  }
  if (new TextEncoder().encode(input).byteLength > MAX_RECEIPT_BYTES) {
    return "too-large";
  }
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    return "invalid";
  }
  let receipt: ScenarioEvidenceReceipt;
  try {
    receipt = parseScenarioEvidenceReceiptRequest(value);
  } catch (error) {
    return error instanceof ScenarioEvidenceContractError &&
        error.code === "raw-identifier"
      ? "unsafe"
      : "invalid";
  }
  return hasUnsafeReceiptIdentifier(receipt) ? "unsafe" : receipt;
}

function hasUnsafeReceiptIdentifier(
  receipt: ScenarioEvidenceReceipt,
): boolean {
  const identifiers = [
    receipt.scenario.id,
    receipt.roles.evidenceProducer,
    receipt.roles.workloadActor,
    receipt.roles.learner,
    receipt.roles.detector,
    receipt.roles.responder,
    ...receipt.claims.flatMap((claim) => [
      claim.subject.id,
      claim.observation?.observerActorId,
      claim.observation?.operationKey,
    ]),
  ].filter((value): value is string => value !== undefined);
  return identifiers.some((value) =>
    EMAIL.test(value) ||
    GUID.test(value) ||
    LONG_HEX.test(value) ||
    URI_OR_PATH.test(value) ||
    PRIVATE_PATH.test(value) ||
    MARKER.test(value) ||
    SENSITIVE_TERM.test(value)
  );
}

function createVerificationResult(
  result: SafeVerifiedScenarioEvidenceReceipt,
): HTMLElement {
  const resultSection = document.createElement("section");
  resultSection.className = "scenario-evidence-verification-result";
  resultSection.setAttribute("aria-label", "Receipt verification result");
  const heading = document.createElement("h3");
  heading.textContent = "Normalized verification result";
  const summary = document.createElement("dl");
  summary.className = "scenario-evidence-verification-summary";
  appendIdentity(summary, "Scenario", result.scenarioId);
  appendIdentity(
    summary,
    "Manifest version",
    String(result.manifestSchemaVersion),
  );
  appendIdentity(
    summary,
    "Evidence producer alias",
    result.roles.evidenceProducer,
  );
  appendIdentity(summary, "Workload actor alias", result.roles.workloadActor);
  appendIdentity(summary, "Learner alias", result.roles.learner);
  appendIdentity(summary, "Detector alias", result.roles.detector ?? "None");
  appendIdentity(summary, "Responder alias", result.roles.responder ?? "None");

  const claimsHeading = document.createElement("h4");
  claimsHeading.textContent = "Deterministic claim states";
  const table = document.createElement("table");
  table.className = "scenario-evidence-verification-claims";
  const header = document.createElement("tr");
  for (const label of ["Category", "Assertion", "State"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const tableHead = document.createElement("thead");
  tableHead.append(header);
  const body = document.createElement("tbody");
  for (const claim of result.claims) {
    const row = document.createElement("tr");
    for (const value of [claim.category, claim.assertion, claim.state]) {
      const cell = document.createElement("td");
      cell.textContent = fixedLabel(value);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(tableHead, body);
  const tableWrap = document.createElement("div");
  tableWrap.className = "scenario-evidence-verification-table-wrap";
  tableWrap.append(table);

  const missingHeading = document.createElement("h4");
  missingHeading.textContent = "Missing coverage categories";
  const missing = document.createElement("p");
  const missingClaimIds = new Set(result.missingCoverage);
  const missingCategories = [...new Set(
    result.claims
      .filter(({ claimId }) => missingClaimIds.has(claimId))
      .map(({ category }) => fixedLabel(category)),
  )].sort();
  missing.textContent = missingCategories.length === 0
    ? "None."
    : `${missingCategories.join(", ")}.`;
  resultSection.append(
    heading,
    summary,
    claimsHeading,
    tableWrap,
    missingHeading,
    missing,
    createStatus(
      "This result verifies only the submitted receipt contract; it is not external evidence or execution proof.",
      "notice",
    ),
  );
  return resultSection;
}

function validationMessage(
  failure: "empty" | "invalid" | "too-large" | "unsafe",
): string {
  switch (failure) {
    case "empty":
      return "Receipt validation failed: paste one sanitized receipt before selecting Verify receipt.";
    case "invalid":
      return "Receipt validation failed: use only the exact bounded receipt JSON shape and fixed fields.";
    case "too-large":
      return "Receipt validation failed: the JSON document exceeds the 128 KiB input limit.";
    case "unsafe":
      return "Receipt validation failed: raw identity, path, marker, credential, session, or other sensitive identifier text is not accepted.";
  }
}

function failureMessage(
  failure: ScenarioEvidenceVerificationFailure,
): string {
  switch (failure) {
    case "session-expired":
      return "Receipt verification stopped because the operator session expired. Sign in again before retrying manually.";
    case "unauthorized":
      return "This signed-in operator is not authorized to verify receipts.";
    case "verification-refused":
      return "Receipt verification was refused because its claims do not satisfy the canonical scenario contract.";
    case "request-too-large":
      return "Receipt verification stopped at the safe request-size limit.";
    case "response-too-large":
      return "Receipt verification stopped at the safe response-size limit.";
    case "unavailable":
      return "Receipt verification is unavailable. No result was accepted; retry manually only after checking the input and session.";
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
