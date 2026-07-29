import { describe, expect, it, vi } from "vitest";
import { CANONICAL_RECEIPT_FIXTURES } from "./scenario-evidence-receipt.fixtures";
import {
  createScenarioEvidenceVerificationPanel,
  parseReceiptInput,
  type ScenarioEvidenceVerificationFailure,
  type ScenarioEvidenceVerificationPanelClient,
} from "./scenario-evidence-verification-panel";
import { verifyCanonicalScenarioEvidenceReceipt } from "./scenario-evidence-verification";
import type { SafeVerifiedScenarioEvidenceReceipt } from "./scenario-evidence-verification";
import type { ScenarioEvidenceReceipt } from "./scenario-evidence-receipt";

const RECEIPT = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;

function client(
  verify: (
    receipt: ScenarioEvidenceReceipt,
  ) => Promise<SafeVerifiedScenarioEvidenceReceipt> = async (receipt) =>
    verifyCanonicalScenarioEvidenceReceipt(receipt),
  classifyError: (
    error: unknown,
  ) => ScenarioEvidenceVerificationFailure = () => "unavailable",
): ScenarioEvidenceVerificationPanelClient {
  return {
    verify: vi.fn(verify),
    classifyError: vi.fn(classifyError),
  };
}

function render(
  verificationClient = client(),
): HTMLElement {
  const panel = createScenarioEvidenceVerificationPanel({
    client: verificationClient,
  });
  document.body.replaceChildren(panel);
  return panel;
}

function input(panel: HTMLElement): HTMLTextAreaElement {
  return panel.querySelector("textarea[name='receipt']")!;
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

describe("Scenario evidence verification panel", () => {
  it.each(CANONICAL_RECEIPT_FIXTURES)(
    "accepts the authoritative bounded $name receipt shape locally",
    ({ receipt }) => {
      expect(parseReceiptInput(JSON.stringify(receipt))).toEqual(receipt);
    },
  );

  it("starts empty and makes no request before explicit verification", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    expect(panel.textContent).toContain("No receipt submitted");
    expect(panel.textContent).toContain(
      "does not collect evidence, authorize or perform work",
    );
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(
      [...panel.querySelectorAll("button")].map(({ textContent }) =>
        textContent
      ),
    ).toEqual(["Verify receipt"]);
    expect(panel.querySelector("input[type='file']")).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["invalid JSON", "{"],
    [
      "unknown field",
      JSON.stringify({
        ...RECEIPT,
        arbitraryText: "not-accepted",
      }),
    ],
    [
      "UPN",
      changedReceipt((receipt) => {
        receipt.roles.learner = "learner@example.invalid";
      }),
    ],
    [
      "GUID",
      changedReceipt((receipt) => {
        receipt.roles.learner = "01234567-89ab-cdef-0123-456789abcdef";
      }),
    ],
    [
      "private path",
      changedReceipt((receipt) => {
        receipt.roles.learner = "/home/operator/receipt";
      }),
    ],
    [
      "marker",
      changedReceipt((receipt) => {
        receipt.roles.learner = "m1_0123456789abcdef01234567";
      }),
    ],
    [
      "token term",
      changedReceipt((receipt) => {
        receipt.roles.learner = "access-token";
      }),
    ],
    [
      "proof reference",
      JSON.stringify({
        ...RECEIPT,
        proofReference: "private-proof",
      }),
    ],
  ])("refuses %s locally before authentication or the client", (_name, value) => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, value);
    submit(panel);
    expect(panel.textContent).toContain("Receipt validation failed");
    expect(verificationClient.verify).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      panel.querySelector(".scenario-evidence-verification-output"),
    );
  });

  it("enforces the UTF-8 size bound before the client", () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    setInput(panel, `"${"é".repeat(70_000)}"`);
    submit(panel);
    expect(panel.textContent).toContain("exceeds the 128 KiB input limit");
    expect(verificationClient.verify).not.toHaveBeenCalled();
  });

  it("renders only normalized safe fields and missing coverage categories", async () => {
    const verificationClient = client();
    const panel = render(verificationClient);
    const receipt = RECEIPT;
    setInput(panel, JSON.stringify(receipt));
    submit(panel);
    await settle();

    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.textContent).toContain("Normalized verification result");
    expect(panel.textContent).toContain(receipt.scenario.id);
    expect(panel.textContent).toContain("Manifest version2");
    expect(panel.textContent).toContain("Deterministic claim states");
    expect(panel.textContent).toContain("Missing coverage categories");
    expect(panel.textContent).toContain("Learner Visibility");
    expect(panel.textContent).not.toContain(receipt.claims[0]!.id);
    expect(panel.textContent).not.toContain(receipt.claims[0]!.subject.id);
    expect(panel.textContent).not.toContain("proofReference");
    expect(panel.textContent).toContain("not external evidence or execution proof");
    expect(document.activeElement).toBe(
      panel.querySelector(".scenario-evidence-verification-output"),
    );
  });

  it("clears completed output when input changes", async () => {
    const panel = render();
    setInput(
      panel,
      JSON.stringify(RECEIPT),
    );
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("Normalized verification result");
    input(panel).value += " ";
    input(panel).dispatchEvent(new Event("input", { bubbles: true }));
    expect(panel.textContent).toContain("Input changed");
    expect(panel.textContent).not.toContain("Normalized verification result");
  });

  it("ignores stale completion after input changes and prevents overlap", async () => {
    let resolve!: (result: SafeVerifiedScenarioEvidenceReceipt) => void;
    const pending = new Promise<SafeVerifiedScenarioEvidenceReceipt>((done) => {
      resolve = done;
    });
    const verificationClient = client(() => pending);
    const panel = render(verificationClient);
    const receipt = RECEIPT;
    setInput(panel, JSON.stringify(receipt));
    submit(panel);
    submit(panel);
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    expect(panel.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      true,
    );

    input(panel).value += " ";
    input(panel).dispatchEvent(new Event("input", { bubbles: true }));
    expect(panel.textContent).toContain("pending response will be ignored");
    submit(panel);
    expect(verificationClient.verify).toHaveBeenCalledOnce();
    resolve(verifyCanonicalScenarioEvidenceReceipt(receipt));
    await settle();
    expect(panel.textContent).not.toContain("Normalized verification result");
    expect(panel.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
  });

  it.each([
    ["session-expired", "operator session expired"],
    ["unauthorized", "not authorized"],
    ["verification-refused", "claims do not satisfy"],
    ["request-too-large", "request-size limit"],
    ["response-too-large", "response-size limit"],
    ["unavailable", "verification is unavailable"],
  ] as const)("renders the fixed %s state without arbitrary error text", async (
    failure,
    message,
  ) => {
    const panel = render(client(
      async () => {
        throw new Error("raw backend payload");
      },
      () => failure,
    ));
    setInput(
      panel,
      JSON.stringify(RECEIPT),
    );
    submit(panel);
    await settle();
    expect(panel.textContent).toContain(message);
    expect(panel.textContent).not.toContain("raw backend payload");
  });

  it("uses a fixed general failure if error classification throws", async () => {
    const panel = render(client(
      async () => {
        throw new Error("raw backend payload");
      },
      () => {
        throw new Error("raw classifier payload");
      },
    ));
    setInput(
      panel,
      JSON.stringify(RECEIPT),
    );
    submit(panel);
    await settle();
    expect(panel.textContent).toContain("verification is unavailable");
    expect(panel.textContent).not.toContain("raw");
  });
});

function changedReceipt(
  change: (receipt: ScenarioEvidenceReceipt) => void,
): string {
  const receipt = structuredClone(RECEIPT);
  change(receipt);
  return JSON.stringify(receipt);
}
