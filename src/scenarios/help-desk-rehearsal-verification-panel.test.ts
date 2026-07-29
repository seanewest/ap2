import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  verifyHelpDeskEmailRehearsalOutput,
  type VerifiedHelpDeskEmailRehearsalSummary,
} from "../../scripts/verify-help-desk-email-rehearsal-output";
import {
  createHelpDeskRehearsalVerificationPanel,
  type HelpDeskRehearsalPanelClient,
  type HelpDeskRehearsalPanelFailure,
} from "./help-desk-rehearsal-verification-panel";

const SEND = fixture("scripts/fixtures/help-desk-email-rehearsal-output-send.json");
const RETAINED = fixture(
  "scripts/fixtures/help-desk-email-rehearsal-output-retained.json",
);
const CLEANED = fixture(
  "scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json",
);
const FIXTURES = [SEND, RETAINED, CLEANED] as const;
const SEND_SUMMARY = verifyHelpDeskEmailRehearsalOutput(SEND);

function fixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as
    Record<string, unknown>;
}

function client(
  verify: (
    input: Record<string, unknown>,
  ) => Promise<VerifiedHelpDeskEmailRehearsalSummary> =
    async () => SEND_SUMMARY,
  classifyError: (
    error: unknown,
  ) => HelpDeskRehearsalPanelFailure = () => "unavailable",
): HelpDeskRehearsalPanelClient<Record<string, unknown>> {
  return {
    parse: vi.fn((value) =>
      FIXTURES.some((fixtureValue) =>
          JSON.stringify(value) === JSON.stringify(fixtureValue)
        )
        ? value as Record<string, unknown>
        : undefined
    ),
    verify: vi.fn(verify),
    classifyError: vi.fn(classifyError),
  };
}

function render(verificationClient = client()): HTMLElement {
  const panel = createHelpDeskRehearsalVerificationPanel({
    client: verificationClient,
  });
  document.body.replaceChildren(panel);
  return panel;
}

function setInput(panel: HTMLElement, value: string): void {
  const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(panel: HTMLElement): void {
  panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("help-desk rehearsal verification panel", () => {
  it("starts empty and makes no request before explicit verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    expect(panel.textContent).toContain("No rehearsal output submitted");
    expect(panel.textContent).toContain(
      "Send acceptance does not prove Inbox visibility",
    );
    expect(panel.textContent).toContain(
      "post-cleanup absence cannot substitute for pre-cleanup learner observation",
    );
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(panel.querySelector("input[type='file']")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["invalid JSON", "{"],
    ["wrong label", JSON.stringify({ ...SEND, label: "LIVE" })],
    [
      "wrong branch",
      JSON.stringify({
        ...SEND,
        binding: {
          ...(SEND.binding as Record<string, unknown>),
          syntheticBranch: "email-delivered",
        },
      }),
    ],
    ["unknown field", JSON.stringify({ ...SEND, arbitrary: "value" })],
    [
      "UPN",
      JSON.stringify({
        ...SEND,
        arbitrary: ["operator", "example.invalid"].join("@"),
      }),
    ],
    [
      "path",
      JSON.stringify({
        ...SEND,
        arbitrary: ["", "private", "run"].join("/"),
      }),
    ],
    ["subject", JSON.stringify({ ...SEND, subject: "Private email text" })],
    ["marker", JSON.stringify({ ...SEND, marker: "ap2-help-desk-marker" })],
    ["token", JSON.stringify({ ...SEND, token: "secret-session-token" })],
    [
      "external proof",
      JSON.stringify({
        ...SEND,
        receipt: {
          ...(SEND.receipt as Record<string, unknown>),
          externalEvidence: { emailSend: "proven" },
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
      panel.querySelector(".help-desk-rehearsal-verification-output"),
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
    ["send accepted", SEND, "Send Accepted"],
    ["learner retained", RETAINED, "Learner Observed Retained"],
    ["learner cleaned", CLEANED, "Learner Observed Cleaned"],
  ])("renders only the fixed %s summary after submit", async (
    _name,
    fixtureValue,
    branchLabel,
  ) => {
    const summary = verifyHelpDeskEmailRehearsalOutput(fixtureValue);
    const verificationClient = client(async () => summary);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(fixtureValue));
    expect(verificationClient.verify).not.toHaveBeenCalled();
    submit(panel);
    await settle();
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).toContain(branchLabel);
    expect(panel.textContent).toContain("All Uninspected");
    expect(panel.textContent).not.toContain(summary.planDigestSha256);
    expect(panel.textContent).not.toContain(summary.fakeRunDigestSha256);
    expect(panel.textContent).not.toContain("journalEntries");
  });

  it("clears prior output and ignores a stale completion after input changes", async () => {
    let resolve!: (value: VerifiedHelpDeskEmailRehearsalSummary) => void;
    const pending = new Promise<VerifiedHelpDeskEmailRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const panel = render(client(async () => pending));
    setInput(panel, JSON.stringify(SEND));
    submit(panel);
    setInput(panel, JSON.stringify(RETAINED));
    resolve(SEND_SUMMARY);
    await settle();
    expect(panel.textContent).not.toContain("Network-free contract verified");
    expect(panel.textContent).toContain("pending response will be ignored");
  });

  it("exposes loading accessibly and suppresses duplicate submit", async () => {
    let resolve!: (value: VerifiedHelpDeskEmailRehearsalSummary) => void;
    const pending = new Promise<VerifiedHelpDeskEmailRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const verificationClient = client(async () => pending);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(SEND));
    submit(panel);
    submit(panel);
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(panel.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    resolve(SEND_SUMMARY);
    await settle();
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe("false");
  });

  it.each([
    ["session-expired", "operator session expired"],
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
    setInput(panel, JSON.stringify(SEND));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain(detail.message);
  });
});
