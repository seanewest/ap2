import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RehearsalOutputVerificationError,
  canonicalAvdThreeVmRehearsalOutput,
  verifyAvdThreeVmRehearsalOutput,
  verifyAvdThreeVmRehearsalOutputText,
  type RehearsalOutputVerificationFailure,
} from "./verify-avd-three-vm-rehearsal-output";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

function output(): Mutable<
  ReturnType<typeof canonicalAvdThreeVmRehearsalOutput>
> {
  return JSON.parse(fixtureText()) as Mutable<
    ReturnType<typeof canonicalAvdThreeVmRehearsalOutput>
  >;
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixtureText(): string {
  return readFileSync(
    join(
      process.cwd(),
      "scripts/fixtures/avd-three-vm-rehearsal-output.json",
    ),
    "utf8",
  );
}

function category(action: () => unknown): RehearsalOutputVerificationFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RehearsalOutputVerificationError);
    return (error as RehearsalOutputVerificationError).category;
  }
  throw new Error("Expected verification to fail.");
}

describe("offline three-VM rehearsal output verifier", () => {
  it("accepts the exact PR #83 envelope with a bounded safe summary", () => {
    expect(pretty(canonicalAvdThreeVmRehearsalOutput())).toBe(
      fixtureText(),
    );
    expect(verifyAvdThreeVmRehearsalOutput(output())).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      scenarioId: "avd-three-vm-substrate",
      planDigestSha256:
        "9ef8b6f8e4c5c033c58100ae21765e1cc17562355b1ebd751c1ddd8b81824664",
      run: "terminal-complete",
      cleanup: "ordered-complete",
      observations: "synthetic-only",
      evidenceClaims: "all-uninspected",
      claimCount: 39,
      missingCoverageTotal: 39,
    });
  });

  it("verifies the same canonical text deterministically", () => {
    const text = pretty(output());
    expect(verifyAvdThreeVmRehearsalOutputText(text)).toEqual(
      verifyAvdThreeVmRehearsalOutputText(text),
    );
  });

  it("contains no runner, network, retry, or persistence path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "scripts/verify-avd-three-vm-rehearsal-output.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("runAvdThreeVmRehearsal");
    expect(source).not.toContain("executeRehearsalRunStage");
    expect(source).not.toContain("ThreeVmLabRunner");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
  });

  it("rejects missing, extra, and reordered fields", () => {
    const missing = output() as Record<string, unknown>;
    delete missing.receipt;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(missing))).toBe(
      "INPUT_SHAPE",
    );

    const extra = output() as Record<string, unknown>;
    extra.detail = "safe";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(extra))).toBe(
      "INPUT_SHAPE",
    );

    const canonical = output() as Record<string, unknown>;
    const reordered = {
      label: canonical.label,
      schemaVersion: canonical.schemaVersion,
      ...Object.fromEntries(
        Object.entries(canonical).filter(
          ([key]) => !["label", "schemaVersion"].includes(key),
        ),
      ),
    };
    expect(category(() => verifyAvdThreeVmRehearsalOutput(reordered))).toBe(
      "INPUT_SHAPE",
    );
  });

  it("rejects malformed, duplicate-key, reordered, and oversized JSON text", () => {
    expect(
      category(() => verifyAvdThreeVmRehearsalOutputText("{")),
    ).toBe("NON_CANONICAL_JSON");

    const duplicate = pretty(output()).replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    );
    expect(
      category(() => verifyAvdThreeVmRehearsalOutputText(duplicate)),
    ).toBe("NON_CANONICAL_JSON");

    const compact = JSON.stringify(output());
    expect(
      category(() => verifyAvdThreeVmRehearsalOutputText(compact)),
    ).toBe("NON_CANONICAL_JSON");

    expect(
      category(() =>
        verifyAvdThreeVmRehearsalOutputText(
          `${" ".repeat(256 * 1024)}x`,
        )
      ),
    ).toBe("INPUT_OVERSIZED");
  });

  it("rejects the wrong rehearsal label and oversized object input", () => {
    const label = output();
    (label as { label: string }).label = "VERIFIED";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(label))).toBe(
      "INPUT_SHAPE",
    );

    const oversized = output() as Record<string, unknown>;
    oversized.detail = "x".repeat(256 * 1024);
    expect(category(() => verifyAvdThreeVmRehearsalOutput(oversized))).toBe(
      "INPUT_OVERSIZED",
    );
  });

  it.each([
    ["11111111", "1111", "1111", "1111", "111111111111"].join("-"),
    ["person", "example.test"].join("@"),
    `/${["home", "example", "private.json"].join("/")}`,
    ["C:", "Users", "example", "secret.json"].join("\\"),
    ["ap2lab", "20260101000000", "a1b2c3"].join("-"),
    ["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" "),
    ["access", "token"].join("_"),
    ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "),
  ])("rejects unsafe content before reporting shape: %s", (unsafe) => {
    const value = output() as Record<string, unknown>;
    value.detail = unsafe;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(value))).toBe(
      "UNSAFE_CONTENT",
    );
  });

  it("rejects a tampered or malformed plan digest", () => {
    const tampered = output();
    tampered.planDigestSha256 = "0".repeat(64);
    expect(category(() => verifyAvdThreeVmRehearsalOutput(tampered))).toBe(
      "PLAN_BINDING",
    );

    const malformed = output();
    malformed.planDigestSha256 = "not-a-digest";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(malformed))).toBe(
      "PLAN_BINDING",
    );
  });

  it("rejects nonterminal, failed, and inconsistent stage state", () => {
    const nonterminal = output();
    nonterminal.status = "unresolved";
    nonterminal.failure = "RUN_UNRESOLVED";
    nonterminal.stages.run = "unresolved";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(nonterminal))).toBe(
      "RUN_NONTERMINAL",
    );

    const stage = output();
    stage.stages.receipt = "refused";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(stage))).toBe(
      "RUN_NONTERMINAL",
    );
  });

  it("rejects cleanup gaps, duplicate execution, and transition reordering", () => {
    const gap = output();
    gap.runnerJournal.transitions.succeeded -= 1;
    gap.runnerJournal.entries -= 1;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(gap))).toBe(
      "CLEANUP_GAP",
    );

    const duplicate = output();
    (duplicate.runnerJournal as { duplicateWrites: number })
      .duplicateWrites = 1;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(duplicate))).toBe(
      "CLEANUP_GAP",
    );

    const reordered = output();
    const transitions = reordered.runnerJournal.transitions;
    reordered.runnerJournal.transitions = {
      succeeded: transitions.succeeded,
      intent: transitions.intent,
      failed: transitions.failed,
      ambiguous: transitions.ambiguous,
      reconciled: transitions.reconciled,
      "reconciliation-blocked":
        transitions["reconciliation-blocked"],
    } as typeof transitions;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(reordered))).toBe(
      "INPUT_SHAPE",
    );
  });

  it("rejects synthetic observation overclaims and missing terminal inputs", () => {
    const evidence = output();
    const evidenceCounts = evidence.observations!.evidence as {
      proven: number;
      notObserved: number;
    };
    evidenceCounts.proven = 5;
    evidenceCounts.notObserved = 0;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(evidence))).toBe(
      "OBSERVATION_OVERCLAIM",
    );

    const terminal = output();
    (terminal.observations!.terminalInputs as {
      cleanup: string;
    }).cleanup = "synthetic-missing";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(terminal))).toBe(
      "OBSERVATION_OVERCLAIM",
    );
  });

  it("rejects post-run binding drift and every receipt evidence promotion", () => {
    const binding = output();
    (binding.receipt!.binding as {
      runStatus: string;
    }).runStatus = "unresolved";
    expect(category(() => verifyAvdThreeVmRehearsalOutput(binding))).toBe(
      "RECEIPT_BINDING",
    );

    const promoted = output();
    (promoted.receipt as { provenClaims: number }).provenClaims = 1;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(promoted))).toBe(
      "OBSERVATION_OVERCLAIM",
    );
  });

  it("rejects receipt count and coverage drift", () => {
    const count = output();
    (count.receipt as { claimCount: number }).claimCount -= 1;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(count))).toBe(
      "OBSERVATION_OVERCLAIM",
    );

    const coverage = output();
    const missingCoverage = coverage.receipt!.missingCoverage as {
      cleanup: number;
    };
    missingCoverage.cleanup -= 1;
    expect(category(() => verifyAvdThreeVmRehearsalOutput(coverage))).toBe(
      "RECEIPT_COVERAGE",
    );
  });

  it("runs the explicit-file CLI without echoing input content or paths", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-output-verify-"));
    const validPath = join(directory, "valid.json");
    const invalidPath = join(directory, "invalid.json");
    try {
      writeFileSync(validPath, pretty(output()), { mode: 0o600 });
      writeFileSync(invalidPath, "{", { mode: 0o600 });
      const valid = spawnSync(
        process.execPath,
        [
          "scripts/verify-avd-three-vm-rehearsal-output-cli.ts",
          validPath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
      });
      expect(valid.stdout).not.toContain(validPath);

      const firstFailure = spawnSync(
        process.execPath,
        [
          "scripts/verify-avd-three-vm-rehearsal-output-cli.ts",
          invalidPath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const secondFailure = spawnSync(
        process.execPath,
        [
          "scripts/verify-avd-three-vm-rehearsal-output-cli.ts",
          invalidPath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(firstFailure.status).toBe(2);
      expect(firstFailure.stderr).toBe(secondFailure.stderr);
      expect(JSON.parse(firstFailure.stderr)).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFICATION",
        status: "refused",
        failure: "NON_CANONICAL_JSON",
      });
      expect(firstFailure.stderr).not.toContain(invalidPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
