import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  verifyPrivateDocumentRehearsalOutput,
  type VerifiedPrivateDocumentRehearsalSummary,
} from "../../scripts/verify-private-document-rehearsal-output";
import {
  createPrivateDocumentRehearsalVerificationPanel,
  type PrivateDocumentRehearsalPanelClient,
  type PrivateDocumentRehearsalPanelFailure,
} from "./private-document-rehearsal-verification-panel";

const CLEANED = fixture(
  "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
);
const LEARNER = fixture(
  "scripts/fixtures/private-document-rehearsal-output-learner.json",
);
const CLEANED_SUMMARY = verifyPrivateDocumentRehearsalOutput(CLEANED);
const LEARNER_SUMMARY = verifyPrivateDocumentRehearsalOutput(LEARNER);

function fixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as
    Record<string, unknown>;
}

function client(
  verify: (
    input: Record<string, unknown>,
  ) => Promise<VerifiedPrivateDocumentRehearsalSummary> =
    async () => CLEANED_SUMMARY,
  classifyError: (
    error: unknown,
  ) => PrivateDocumentRehearsalPanelFailure = () => "unavailable",
): PrivateDocumentRehearsalPanelClient<Record<string, unknown>> {
  return {
    parse: vi.fn((value) =>
      JSON.stringify(value) === JSON.stringify(CLEANED) ||
        JSON.stringify(value) === JSON.stringify(LEARNER)
        ? value as Record<string, unknown>
        : undefined
    ),
    verify: vi.fn(verify),
    classifyError: vi.fn(classifyError),
  };
}

function render(
  verificationClient = client(),
): HTMLElement {
  const panel = createPrivateDocumentRehearsalVerificationPanel({
    client: verificationClient,
  });
  document.body.replaceChildren(panel);
  return panel;
}

function input(panel: HTMLElement): HTMLTextAreaElement {
  return panel.querySelector(
    "textarea[name='privateDocumentRehearsalOutput']",
  )!;
}

function setInput(panel: HTMLElement, value: string): void {
  input(panel).value = value;
  input(panel).dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(panel: HTMLElement): void {
  panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("private-document rehearsal verification panel", () => {
  it("starts empty and makes no request before explicit verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    expect(panel.textContent).toContain("No rehearsal output submitted");
    expect(panel.textContent).toContain(
      "Synthetic learner observation does not prove live learner visibility",
    );
    expect(panel.textContent).toContain(
      "post-cleanup absence cannot substitute for pre-cleanup access",
    );
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(panel.querySelector("input[type='file']")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["invalid JSON", "{"],
    ["wrong label", JSON.stringify({ ...CLEANED, label: "LIVE" })],
    [
      "wrong branch",
      JSON.stringify({
        ...CLEANED,
        binding: {
          ...(CLEANED.binding as Record<string, unknown>),
          syntheticBranch: "external-observation",
        },
      }),
    ],
    ["unknown field", JSON.stringify({ ...CLEANED, extra: "arbitrary" })],
    [
      "UPN",
      JSON.stringify({
        ...CLEANED,
        extra: ["user", "example.invalid"].join("@"),
      }),
    ],
    [
      "path",
      JSON.stringify({
        ...CLEANED,
        extra: ["", "private", "run"].join("/"),
      }),
    ],
    [
      "marker",
      JSON.stringify({ ...CLEANED, extra: "ap2doc-private-marker" }),
    ],
    [
      "token",
      JSON.stringify({ ...CLEANED, extra: ["access", "token"].join("-") }),
    ],
    [
      "external proof",
      JSON.stringify({
        ...CLEANED,
        receipt: {
          ...(CLEANED.receipt as Record<string, unknown>),
          externalEvidence: {
            producerStaging: "proven",
          },
        },
      }),
    ],
  ])("refuses %s locally before verification", (_name, value) => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, value);
    submit(panel);
    expect(panel.textContent).toContain("Local validation failed");
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      panel.querySelector(
        ".private-document-rehearsal-verification-output",
      ),
    );
  });

  it("enforces the UTF-8 size limit before parsing or verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, `"${"é".repeat(17_000)}"`);
    submit(panel);
    expect(panel.textContent).toContain("exceeds the 32 KiB");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
  });

  it.each([
    ["cleaned canary", CLEANED, CLEANED_SUMMARY, "Cleaned Canary"],
    [
      "learner observation",
      LEARNER,
      LEARNER_SUMMARY,
      "Learner Observation",
    ],
  ])("verifies the %s branch only after submit", async (
    _name,
    fixtureValue,
    summary,
    label,
  ) => {
    const verificationClient = client(async () => summary);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(fixtureValue));
    expect(verificationClient.verify).not.toHaveBeenCalled();
    submit(panel);
    await settle();
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).toContain(label);
    expect(panel.textContent).toContain("All Uninspected");
    expect(panel.textContent).not.toContain(summary.planDigestSha256);
    expect(panel.textContent).not.toContain(summary.fakeRunDigestSha256);
    expect(panel.textContent).not.toContain("journalEntries");
  });

  it("clears prior output when input changes", async () => {
    const panel = render();
    setInput(panel, JSON.stringify(CLEANED));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("Network-free contract verified");
    setInput(panel, `${JSON.stringify(CLEANED)} `);
    expect(panel.textContent).not.toContain("Network-free contract verified");
    expect(panel.textContent).toContain("Input changed");
  });

  it("ignores stale completion after input changes", async () => {
    let resolve!: (
      value: VerifiedPrivateDocumentRehearsalSummary,
    ) => void;
    const pending = new Promise<VerifiedPrivateDocumentRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const panel = render(client(async () => pending));
    setInput(panel, JSON.stringify(CLEANED));
    submit(panel);
    setInput(panel, JSON.stringify(LEARNER));
    resolve(CLEANED_SUMMARY);
    await settle();
    expect(panel.textContent).not.toContain("Network-free contract verified");
    expect(panel.textContent).toContain("pending response will be ignored");
  });

  it("exposes loading accessibly and suppresses duplicate submit", async () => {
    let resolve!: (
      value: VerifiedPrivateDocumentRehearsalSummary,
    ) => void;
    const pending = new Promise<VerifiedPrivateDocumentRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const verificationClient = client(async () => pending);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(CLEANED));
    submit(panel);
    submit(panel);
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(panel.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    resolve(CLEANED_SUMMARY);
    await settle();
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it.each([
    ["session-expired", "operator session expired"],
    ["server-shutting-down", "API is shutting down"],
    ["unauthorized", "not authorized"],
    ["verification-refused", "inconsistent or tampered"],
    ["request-too-large", "request-size limit"],
    ["response-too-large", "response-size limit"],
    ["unavailable", "verification is unavailable"],
  ] as const)("maps %s to a fixed safe error", async (failure, message) => {
    const detail = new Error("raw private backend detail");
    const panel = render(client(
      async () => {
        throw detail;
      },
      () => failure,
    ));
    setInput(panel, JSON.stringify(CLEANED));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain(detail.message);
  });

  it("keeps a safe error if classification throws", async () => {
    const panel = render(client(
      async () => {
        throw new Error("raw private detail");
      },
      () => {
        throw new Error("raw classifier detail");
      },
    ));
    setInput(panel, JSON.stringify(CLEANED));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("verification is unavailable");
    expect(panel.textContent).not.toContain("raw");
  });
});
