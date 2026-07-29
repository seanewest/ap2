import { describe, expect, it, vi } from "vitest";
import {
  isBoundedRehearsalOutputRequest,
  type RehearsalOutputVerificationRequest,
} from "../api/rehearsal-output-verification-contract";
import {
  canonicalAvdThreeVmRehearsalOutput,
  verifyAvdThreeVmRehearsalOutput,
} from "../../scripts/verify-avd-three-vm-rehearsal-output";
import {
  createAvdRehearsalVerificationPanel,
  type AvdRehearsalVerificationFailure,
  type AvdRehearsalVerificationPanelClient,
  type SafeAvdRehearsalVerificationSummary,
} from "./avd-rehearsal-verification-panel";

const INPUT = canonicalAvdThreeVmRehearsalOutput();
const SUMMARY = verifyAvdThreeVmRehearsalOutput(INPUT);
const UNSAFE_UPN = ["user", "example.invalid"].join("@");
const UNSAFE_PATH = ["", "home", "operator", "run"].join("/");
const UNSAFE_TOKEN_LABEL = ["access", "token"].join("-");

function client(
  verify: (
    input: RehearsalOutputVerificationRequest,
  ) => Promise<SafeAvdRehearsalVerificationSummary> = async () => SUMMARY,
  classifyError: (
    error: unknown,
  ) => AvdRehearsalVerificationFailure = () => "unavailable",
): AvdRehearsalVerificationPanelClient<RehearsalOutputVerificationRequest> {
  return {
    parse: vi.fn((value) =>
      isBoundedRehearsalOutputRequest(value) ? value : undefined
    ),
    verify: vi.fn(verify),
    classifyError: vi.fn(classifyError),
  };
}

function render(
  verificationClient = client(),
): HTMLElement {
  const panel = createAvdRehearsalVerificationPanel({
    client: verificationClient,
  });
  document.body.replaceChildren(panel);
  return panel;
}

function input(panel: HTMLElement): HTMLTextAreaElement {
  return panel.querySelector("textarea[name='rehearsalOutput']")!;
}

function setInput(panel: HTMLElement, value: string): void {
  input(panel).value = value;
  input(panel).dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(panel: HTMLElement): void {
  panel.querySelector("form")!.dispatchEvent(
    new SubmitEvent("submit", { bubbles: true, cancelable: true }),
  );
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AVD rehearsal verification panel", () => {
  it("starts empty and makes no request before explicit verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    expect(panel.textContent).toContain("No rehearsal output submitted");
    expect(panel.textContent).toContain("network-free REHEARSAL_ONLY");
    expect(panel.textContent).toContain("proves no live Azure");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(
      [...panel.querySelectorAll("button")].map(({ textContent }) =>
        textContent
      ),
    ).toEqual(["Verify rehearsal output"]);
    expect(panel.querySelector("input[type='file']")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["invalid JSON", "{"],
    ["wrong label", JSON.stringify({ ...INPUT, label: "LIVE" })],
    ["unknown field", JSON.stringify({ ...INPUT, extra: "arbitrary" })],
    [
      "UPN",
      JSON.stringify({ ...INPUT, observations: { actor: UNSAFE_UPN } }),
    ],
    [
      "private path",
      JSON.stringify({ ...INPUT, observations: { path: UNSAFE_PATH } }),
    ],
    [
      "marker",
      JSON.stringify({ ...INPUT, observations: { marker: "ap2lab-private-run" } }),
    ],
    [
      "credential",
      JSON.stringify({
        ...INPUT,
        observations: { value: UNSAFE_TOKEN_LABEL },
      }),
    ],
    [
      "arbitrary label",
      JSON.stringify({ ...INPUT, status: "custom-completed" }),
    ],
  ])("refuses %s locally before the verification client", (_name, value) => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, value);
    submit(panel);
    expect(panel.textContent).toContain("Local validation failed");
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      panel.querySelector(".avd-rehearsal-verification-output"),
    );
  });

  it("enforces the UTF-8 size limit before parsing or verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, `"${"é".repeat(17_000)}"`);
    submit(panel);
    expect(panel.textContent).toContain("exceeds the 32 KiB input limit");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
  });

  it("renders only the fixed safe summary and no submitted details", async () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(INPUT));
    submit(panel);
    await settle();

    expect(verificationClient.parse).toHaveBeenCalledOnce();
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).toContain("Contract consistencyVerified");
    expect(panel.textContent).toContain("Fake runTerminal Complete");
    expect(panel.textContent).toContain("Observation sourceSynthetic Only");
    expect(panel.textContent).toContain("Receipt coverageAll Uninspected");
    expect(panel.textContent).toContain(
      `Synthetic claim count${SUMMARY.claimCount}`,
    );
    expect(panel.textContent).toContain(
      `Uninspected coverage count${SUMMARY.missingCoverageTotal}`,
    );
    expect(panel.textContent).not.toContain(SUMMARY.scenarioId);
    expect(panel.textContent).not.toContain(SUMMARY.planDigestSha256);
    expect(panel.textContent).not.toContain("runnerJournal");
    expect(panel.textContent).not.toContain("proofReference");
    expect(document.activeElement).toBe(
      panel.querySelector(".avd-rehearsal-verification-output"),
    );
  });

  it("clears completed output when the JSON changes", async () => {
    const panel = render();
    setInput(panel, JSON.stringify(INPUT));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("Network-free contract verified");
    input(panel).value += " ";
    input(panel).dispatchEvent(new Event("input", { bubbles: true }));
    expect(panel.textContent).toContain("Input changed");
    expect(panel.textContent).not.toContain("Network-free contract verified");
  });

  it("ignores stale completion after input changes and prevents overlap", async () => {
    let resolve!: (
      result: SafeAvdRehearsalVerificationSummary,
    ) => void;
    const pending = new Promise<SafeAvdRehearsalVerificationSummary>((done) => {
      resolve = done;
    });
    const verificationClient = client(() => pending);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(INPUT));
    submit(panel);
    submit(panel);
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      true,
    );
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    input(panel).value += " ";
    input(panel).dispatchEvent(new Event("input", { bubbles: true }));
    expect(panel.textContent).toContain("pending response will be ignored");
    submit(panel);
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    resolve(SUMMARY);
    await settle();
    expect(panel.textContent).not.toContain("Network-free contract verified");
    expect(panel.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it.each([
    ["session-expired", "operator session expired"],
    ["unauthorized", "not authorized"],
    ["verification-refused", "inconsistent or tampered"],
    ["request-too-large", "request-size limit"],
    ["response-too-large", "response-size limit"],
    ["unavailable", "verification is unavailable"],
  ] as const)("renders fixed %s failure without arbitrary details", async (
    failure,
    message,
  ) => {
    const panel = render(client(
      async () => {
        throw new Error("raw backend payload");
      },
      () => failure,
    ));
    setInput(panel, JSON.stringify(INPUT));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain("raw backend payload");
  });

  it("uses the fixed general failure if classification throws", async () => {
    const panel = render(client(
      async () => {
        throw new Error("raw backend payload");
      },
      () => {
        throw new Error("raw classifier payload");
      },
    ));
    setInput(panel, JSON.stringify(INPUT));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("verification is unavailable");
    expect(panel.textContent).not.toContain("raw");
  });
});
