import { describe, expect, it, vi } from "vitest";
import { createOperatorSupportBundleSession } from "./operator-support-bundle";
import { createOperatorSupportBundlePanel } from "./operator-support-bundle-panel";

describe("operator support bundle panel", () => {
  it("exports only after one explicit click and starts no request", () => {
    const session = createOperatorSupportBundleSession(
      () => new Date("2026-07-29T12:00:00.000Z"),
    );
    session.recordFailure({
      routeCategory: "private-document-rehearsal-verify",
      categoricalStatus: "verification-refused",
      error: supportReferencedError("r1_0123456789abcdef01234567"),
    });
    const exporter = vi.fn();
    const panel = createOperatorSupportBundlePanel(session, exporter);

    expect(exporter).not.toHaveBeenCalled();
    panel.querySelector<HTMLButtonElement>("button")!.click();
    expect(exporter).toHaveBeenCalledOnce();
    expect(exporter.mock.calls[0]?.[0].failures).toHaveLength(1);
    expect(JSON.stringify(exporter.mock.calls[0]?.[0])).not.toMatch(
      /credential|evidence|payload|requestBody|stack|upn/i,
    );
  });

  it("creates no file when no valid correlated failure exists", () => {
    const exporter = vi.fn();
    const panel = createOperatorSupportBundlePanel(
      createOperatorSupportBundleSession(),
      exporter,
    );
    panel.querySelector<HTMLButtonElement>("button")!.click();
    expect(exporter).not.toHaveBeenCalled();
    expect(panel.textContent).toContain("No file was created");
  });

  it("contains no browser persistence or request primitive", async () => {
    const source = await import("./operator-support-bundle-panel.ts?raw");
    expect(source.default).not.toMatch(
      /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcookie\b|\bfetch\s*\(/,
    );
  });
});

function supportReferencedError(supportReference: string): Error {
  const error = new Error("Safe categorical failure");
  Object.defineProperty(error, "supportReference", {
    configurable: false,
    enumerable: false,
    value: supportReference,
    writable: false,
  });
  return error;
}
