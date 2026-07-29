import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  verifyOauthApplicationReconRehearsalOutput,
} from "../../scripts/verify-oauth-application-recon-rehearsal-output";
import {
  parseOauthApplicationReconRehearsalVerificationRequest,
  type OauthApplicationReconRehearsalVerificationRequest,
  type VerifiedOauthApplicationReconRehearsalSummary,
} from "../api/oauth-application-recon-rehearsal-verification-contract";
import {
  createOauthApplicationReconRehearsalVerificationPanel,
  type OauthApplicationReconRehearsalPanelClient,
  type OauthApplicationReconRehearsalPanelFailure,
} from "./oauth-application-recon-rehearsal-verification-panel";

const OUTPUT = parseOauthApplicationReconRehearsalVerificationRequest(
  JSON.parse(readFileSync(resolve(
    "scripts/fixtures/oauth-application-recon-rehearsal-output.json",
  ), "utf8")) as unknown,
);
const SUMMARY = verifyOauthApplicationReconRehearsalOutput(OUTPUT);

function client(
  verify: (
    input: OauthApplicationReconRehearsalVerificationRequest,
  ) => Promise<VerifiedOauthApplicationReconRehearsalSummary> =
    async () => SUMMARY,
  classifyError: (
    error: unknown,
  ) => OauthApplicationReconRehearsalPanelFailure = () => "unavailable",
): OauthApplicationReconRehearsalPanelClient {
  return {
    parse: vi.fn((value) => {
      try {
        return parseOauthApplicationReconRehearsalVerificationRequest(value);
      } catch {
        return undefined;
      }
    }),
    verify: vi.fn(verify),
    classifyError: vi.fn(classifyError),
  };
}

function render(
  verificationClient = client(),
): HTMLElement {
  const panel = createOauthApplicationReconRehearsalVerificationPanel({
    client: verificationClient,
  });
  document.body.replaceChildren(panel);
  return panel;
}

function input(panel: HTMLElement): HTMLTextAreaElement {
  return panel.querySelector(
    "textarea[name='oauthApplicationReconRehearsalOutput']",
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

describe("OAuth application-recon rehearsal verification panel", () => {
  it("starts manual-only and makes no request before deliberate Verify", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    expect(panel.textContent).toContain("No rehearsal output submitted");
    expect(panel.textContent).toContain("does not run reconnaissance");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(panel.querySelector("input[type='file']")).toBeNull();
    expect(panel.querySelector("textarea")?.getAttribute("autocomplete"))
      .toBe("off");
  });

  it("contains no execution, network, persistence, retry, polling, or scheduling path", () => {
    const source = readFileSync(
      resolve(
        "src/scenarios/oauth-application-recon-rehearsal-verification-panel.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain(
      "createDeterministicOauthApplicationReconFakeFourRead",
    );
    expect(source).not.toContain("runOauthApplicationReconRehearsal");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\blocalStorage\b|\bsessionStorage\b/);
    expect(source).not.toMatch(/\bsetInterval\b|\bsetTimeout\b/);
    expect(source).not.toMatch(/\.retry\s*\(|\bpoll(?:ing)?\s*\(/i);
    expect(source).not.toMatch(
      /acquireToken|GraphServiceClient|graph\.microsoft/i,
    );
  });

  it.each([
    ["empty", ""],
    ["invalid JSON", "{"],
    ["wrong label", JSON.stringify({ ...OUTPUT, label: "LIVE" })],
    [
      "wrong scenario",
      JSON.stringify({
        ...OUTPUT,
        binding: {
          ...(OUTPUT.binding as Record<string, unknown>),
          scenarioId: "other-scenario",
        },
      }),
    ],
    ["unknown field", JSON.stringify({ ...OUTPUT, extra: "arbitrary" })],
    [
      "UPN",
      JSON.stringify({
        ...OUTPUT,
        extra: ["person", "example.invalid"].join("@"),
      }),
    ],
    [
      "private path",
      JSON.stringify({
        ...OUTPUT,
        extra: ["", "home", "private", "result"].join("/"),
      }),
    ],
    [
      "marker",
      JSON.stringify({
        ...OUTPUT,
        extra: ["ap2lab", "private", "marker"].join("-"),
      }),
    ],
    [
      "token",
      JSON.stringify({
        ...OUTPUT,
        extra: ["access", "token"].join("-"),
      }),
    ],
  ])("refuses %s locally before authorization", (_name, value) => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, value);
    submit(panel);
    expect(panel.textContent).toContain("Local validation failed");
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      panel.querySelector(".oauth-recon-rehearsal-verification-output"),
    );
  });

  it("enforces the UTF-8 size limit before parsing or authorization", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, `"${"é".repeat(17_000)}"`);
    submit(panel);
    expect(panel.textContent).toContain("exceeds the 32 KiB");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
  });

  it("verifies once after submit and renders only the fixed safe summary", async () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(OUTPUT));
    expect(verificationClient.verify).not.toHaveBeenCalled();
    submit(panel);
    await settle();
    expect(verificationClient.parse).toHaveBeenCalledOnce();
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).toContain("Ordered Four Read Terminal Verified");
    expect(panel.textContent).toContain("All Uninspected");
    expect(panel.textContent).toContain(`Synthetic receipt claim count13`);
    expect(panel.textContent).not.toContain(SUMMARY.scenarioId);
    expect(panel.textContent).not.toContain(SUMMARY.planDigestSha256);
    expect(panel.textContent).not.toContain(SUMMARY.fakeResultDigestSha256);
    expect(panel.textContent).not.toContain(SUMMARY.outputDigestSha256);
    expect(panel.textContent).not.toContain("orderedReads");
  });

  it("clears prior results and ignores stale completion after edits", async () => {
    let resolve!: (
      value: VerifiedOauthApplicationReconRehearsalSummary,
    ) => void;
    const pending = new Promise<VerifiedOauthApplicationReconRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const verificationClient = client(async () => pending);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(OUTPUT));
    submit(panel);
    setInput(panel, `${JSON.stringify(OUTPUT)} `);
    expect(panel.textContent).toContain("pending response will be ignored");
    resolve(SUMMARY);
    await settle();
    expect(panel.textContent).not.toContain("Network-free contract verified");
  });

  it("exposes busy state and suppresses duplicate keyboard or pointer submit", async () => {
    let resolve!: (
      value: VerifiedOauthApplicationReconRehearsalSummary,
    ) => void;
    const pending = new Promise<VerifiedOauthApplicationReconRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const verificationClient = client(async () => pending);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(OUTPUT));
    const button = panel.querySelector<HTMLButtonElement>("button")!;
    expect(button.type).toBe("submit");
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    }));
    submit(panel);
    submit(panel);
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    resolve(SUMMARY);
    await settle();
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(
      panel.querySelector(".oauth-recon-rehearsal-verification-output"),
    );
  });

  it.each([
    ["session-expired", "operator session expired"],
    ["unauthorized", "not authorized"],
    ["verification-refused", "inconsistent or tampered"],
    ["request-too-large", "request-size limit"],
    ["response-too-large", "response-size limit"],
    ["unavailable", "verification is unavailable"],
  ] as const)("maps %s to a fixed safe state", async (failure, message) => {
    const detail = new Error("raw backend detail");
    const panel = render(client(
      async () => {
        throw detail;
      },
      () => failure,
    ));
    setInput(panel, JSON.stringify(OUTPUT));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain(detail.message);
  });

  it("keeps a fixed general failure if classification throws", async () => {
    const panel = render(client(
      async () => {
        throw new Error("raw backend detail");
      },
      () => {
        throw new Error("raw classifier detail");
      },
    ));
    setInput(panel, JSON.stringify(OUTPUT));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("verification is unavailable");
    expect(panel.textContent).not.toContain("raw");
  });

  it("has labeled keyboard/focus semantics and narrow/reduced-motion CSS", () => {
    const panel = render();
    const textarea = input(panel);
    const guidanceId = textarea.getAttribute("aria-describedby");
    expect(panel.getAttribute("aria-labelledby")).toBe(
      "oauth-recon-rehearsal-verification-heading",
    );
    expect(guidanceId).toBe("oauth-recon-rehearsal-verification-guidance");
    expect(panel.querySelector(`#${guidanceId}`)).not.toBeNull();
    expect(textarea.closest("label")).not.toBeNull();
    expect(
      panel.querySelector(".oauth-recon-rehearsal-verification-output")
        ?.getAttribute("aria-live"),
    ).toBe("polite");

    const css = readFileSync(resolve("src/styles.css"), "utf8");
    expect(css).toMatch(
      /@media \(max-width: 32rem\)[\s\S]*oauth-recon-rehearsal-verification-summary/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*oauth-recon-rehearsal-verification/,
    );
  });
});
