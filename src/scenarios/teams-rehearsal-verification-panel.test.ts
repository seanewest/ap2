import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  verifyTeamsMissedCallRehearsalOutput,
  type VerifiedTeamsMissedCallRehearsalSummary,
} from "../../scripts/verify-teams-missed-call-rehearsal-output";
import {
  createTeamsRehearsalVerificationPanel,
  type TeamsRehearsalPanelClient,
  type TeamsRehearsalPanelFailure,
} from "./teams-rehearsal-verification-panel";

const STAGE = fixture(
  "scripts/fixtures/teams-missed-call-rehearsal-output-stage-only.json",
);
const NATIVE = fixture(
  "scripts/fixtures/teams-missed-call-rehearsal-output-native-retained.json",
);
const REPORTED = fixture(
  "scripts/fixtures/teams-missed-call-rehearsal-output-reported-retained.json",
);
const CLEANED = fixture(
  "scripts/fixtures/teams-missed-call-rehearsal-output-native-cleaned.json",
);
const FIXTURES = [STAGE, NATIVE, REPORTED, CLEANED] as const;
const STAGE_SUMMARY = verifyTeamsMissedCallRehearsalOutput(STAGE);

function fixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as
    Record<string, unknown>;
}

function client(
  verify: (
    input: Record<string, unknown>,
  ) => Promise<VerifiedTeamsMissedCallRehearsalSummary> =
    async () => STAGE_SUMMARY,
  classifyError: (
    error: unknown,
  ) => TeamsRehearsalPanelFailure = () => "unavailable",
): TeamsRehearsalPanelClient<Record<string, unknown>> {
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
  const panel = createTeamsRehearsalVerificationPanel({
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

describe("Teams rehearsal verification panel", () => {
  it("starts empty with no execution control or pre-Verify request", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    expect(panel.textContent).toContain("No rehearsal output submitted");
    expect(panel.textContent).toContain("does not prove a call");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(panel.querySelector("input[type='file']")).toBeNull();
    expect([...panel.querySelectorAll("button")].map(({ textContent }) =>
      textContent
    )).toEqual(["Verify Teams rehearsal"]);
  });

  it.each([
    ["empty", ""],
    ["invalid JSON", "{"],
    ["wrong label", JSON.stringify({ ...STAGE, label: "LIVE" })],
    [
      "wrong branch",
      JSON.stringify({
        ...STAGE,
        binding: {
          ...(STAGE.binding as Record<string, unknown>),
          syntheticBranch: "live-call",
        },
      }),
    ],
    ["unknown field", JSON.stringify({ ...STAGE, arbitrary: "value" })],
    [
      "UPN",
      JSON.stringify({
        ...STAGE,
        arbitrary: ["operator", "example.invalid"].join("@"),
      }),
    ],
    [
      "path",
      JSON.stringify({
        ...STAGE,
        arbitrary: ["", "private", "run"].join("/"),
      }),
    ],
    ["marker", JSON.stringify({ ...STAGE, marker: "call-marker" })],
    ["token", JSON.stringify({ ...STAGE, token: "secret-session-token" })],
    [
      "external proof",
      JSON.stringify({
        ...STAGE,
        envelope: {
          ...(STAGE.envelope as Record<string, unknown>),
          externalEvidence: "proven",
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
      panel.querySelector(".teams-rehearsal-verification-output"),
    );
  });

  it("enforces UTF-8 size before parsing or verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, `"${"é".repeat(17_000)}"`);
    submit(panel);
    expect(panel.textContent).toContain("exceeds the 32 KiB");
    expect(verificationClient.parse).not.toHaveBeenCalled();
    expect(verificationClient.verify).not.toHaveBeenCalled();
  });

  it.each([
    ["stage only", STAGE, "Stage Only", "Uninspected"],
    ["native retained", NATIVE, "Native Retained", "Two Surface"],
    ["reported retained", REPORTED, "Reported Retained", "Reported"],
    ["native cleaned", CLEANED, "Native Cleaned", "Two Surface Absent"],
  ])("renders only the fixed %s summary", async (
    _name,
    fixtureValue,
    branchLabel,
    stateLabel,
  ) => {
    const summary = verifyTeamsMissedCallRehearsalOutput(fixtureValue);
    const panel = render(client(async () => summary));
    setInput(panel, JSON.stringify(fixtureValue));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).toContain(branchLabel);
    expect(panel.textContent).toContain(stateLabel);
    expect(panel.textContent).toContain("All Uninspected");
    expect(panel.textContent).not.toContain(summary.planDigestSha256);
    expect(panel.textContent).not.toContain(summary.fakeRunDigestSha256);
    expect(panel.textContent).not.toContain("nativeHistory");
  });

  it("ignores stale completion and blocks duplicate submission", async () => {
    let resolve!: (value: VerifiedTeamsMissedCallRehearsalSummary) => void;
    const pending = new Promise<VerifiedTeamsMissedCallRehearsalSummary>(
      (done) => {
        resolve = done;
      },
    );
    const verificationClient = client(async () => pending);
    const panel = render(verificationClient);
    setInput(panel, JSON.stringify(STAGE));
    submit(panel);
    submit(panel);
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    setInput(panel, JSON.stringify(NATIVE));
    resolve(STAGE_SUMMARY);
    await settle();
    expect(panel.textContent).not.toContain("Network-free contract verified");
    expect(panel.textContent).toContain("pending response will be ignored");
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
    const detail = new Error("raw backend detail");
    const panel = render(client(
      async () => {
        throw detail;
      },
      () => failure,
    ));
    setInput(panel, JSON.stringify(STAGE));
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain(detail.message);
  });
});
