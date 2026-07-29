import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RehearsalOutputVerificationError,
  canonicalAvdThreeVmRehearsalOutput,
  verifyAvdThreeVmRehearsalOutput,
} from "../scripts/verify-avd-three-vm-rehearsal-output";
import {
  InMemoryRehearsalOutputVerificationService,
  RehearsalOutputVerificationSafeFailureError,
} from "./rehearsal-output-verification";

describe("in-memory rehearsal output verification service", () => {
  it("calls the PR #86 verifier and returns only its deterministic summary", () => {
    const output = canonicalAvdThreeVmRehearsalOutput();
    const service = new InMemoryRehearsalOutputVerificationService();

    expect(service.verify(output)).toEqual(
      verifyAvdThreeVmRehearsalOutput(output),
    );
  });

  it("fails closed before verification for an unsafe outer shape", () => {
    const service = new InMemoryRehearsalOutputVerificationService();
    const value = {
      ...canonicalAvdThreeVmRehearsalOutput(),
      upstreamPayload: "arbitrary",
    };

    expect(() => service.verify(value)).toThrow(
      new RehearsalOutputVerificationError("INPUT_SHAPE"),
    );
  });

  it("preserves verifier refusal categories and isolates unknown failures", () => {
    const refused = new InMemoryRehearsalOutputVerificationService(() => {
      throw new RehearsalOutputVerificationError("CLEANUP_GAP");
    });
    const isolated = new InMemoryRehearsalOutputVerificationService(() => {
      throw new Error("private exception detail");
    });
    const output = canonicalAvdThreeVmRehearsalOutput();

    expect(() => refused.verify(output)).toThrow(
      new RehearsalOutputVerificationError("CLEANUP_GAP"),
    );
    expect(() => isolated.verify(output)).toThrow(
      RehearsalOutputVerificationSafeFailureError,
    );
  });

  it("has no runner, transport, storage, retry, or telemetry path", () => {
    const source = readFileSync(
      join(process.cwd(), "api/rehearsal-output-verification.ts"),
      "utf8",
    );
    expect(source).not.toContain("runAvdThreeVmRehearsal");
    expect(source).not.toContain("executeRehearsalRunStage");
    expect(source).not.toContain("ThreeVmLabRunner");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\btelemetry/i);
    expect(source).not.toMatch(/\bretry/i);
  });
});
