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
  PrivateDocumentRehearsalVerificationError,
  verifyPrivateDocumentRehearsalOutput,
  verifyPrivateDocumentRehearsalOutputText,
  type PrivateDocumentRehearsalVerificationFailure,
} from "./verify-private-document-rehearsal-output.ts";

const CLEANED_FIXTURE = join(
  process.cwd(),
  "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
);
const LEARNER_FIXTURE = join(
  process.cwd(),
  "scripts/fixtures/private-document-rehearsal-output-learner.json",
);
const CLI = "scripts/verify-private-document-rehearsal-output-cli.ts";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

type Fixture = Mutable<
  ReturnType<typeof fixture>
>;

function fixture(
  branch: "cleaned-canary" | "learner-observation" = "cleaned-canary",
) {
  return JSON.parse(readFileSync(
    branch === "cleaned-canary" ? CLEANED_FIXTURE : LEARNER_FIXTURE,
    "utf8",
  )) as {
    schemaVersion: number;
    label: string;
    status: string;
    failure: string | null;
    binding: {
      scenarioId: string;
      manifestSchemaVersion: number;
      planDigestSha256: string;
      fakeRunDigestSha256: string;
      syntheticBranch: string;
    };
    stages: {
      plan: string;
      fakeLifecycle: string;
      adapter: string;
      receiptVerifier: string;
    };
    fakeRun: {
      lifecycleStatus: string;
      journalEntries: number;
      learnerObservation: string;
      initialTerminalProducerAbsence: string;
      initialTerminalLearnerAbsence: string;
      freshTerminal: {
        rounds: number;
        producerFolder: string;
        producerItem: string;
        producerPermission: string;
        learnerAccess: string;
      };
    };
    receipt: {
      adapterCandidateAccepted: boolean;
      verifierAccepted: boolean;
      candidateClaimCount: number;
      externalEvidence: Record<string, string>;
    };
  };
}

function category(
  action: () => unknown,
): PrivateDocumentRehearsalVerificationFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      PrivateDocumentRehearsalVerificationError,
    );
    return (error as PrivateDocumentRehearsalVerificationError).category;
  }
  throw new Error("Expected verifier refusal.");
}

describe("offline private-document rehearsal output verifier", () => {
  it.each([
    [
      "cleaned-canary",
      "blocked-cleanup",
      "d88bf6859c51aa38ff0c55121135b8971c8d3474bf0fa8f90bba3e2558c4846b",
    ],
    [
      "learner-observation",
      "completed-cleaned",
      "48706a34ad2f41d0028006626e33445ac751c2d9c1d6556751ec4e91083bd0d9",
    ],
  ] as const)(
    "accepts the independent captured %s fixture",
    (branch, lifecycleStatus, fakeDigest) => {
      const value = fixture(branch);
      expect(value.fakeRun.lifecycleStatus).toBe(lifecycleStatus);
      const summary = verifyPrivateDocumentRehearsalOutput(value);
      expect(summary).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        scenarioId: "private-document-evidence",
        manifestSchemaVersion: 2,
        planDigestSha256:
          "02ce5d2a5eb202b31424bc8b53abdc0cc0d9e1154978f31db19ad5bff8ff173a",
        fakeRunDigestSha256: fakeDigest,
        syntheticBranch: branch,
        fakeContract: "ordered-terminal-verified",
        adapter: "accepted",
        receiptVerifier: "accepted",
        externalEvidence: "all-uninspected",
        claimCount: 18,
      });
      expect(Object.isFrozen(summary)).toBe(true);
    },
  );

  it("verifies canonical fixture text deterministically", () => {
    for (const path of [CLEANED_FIXTURE, LEARNER_FIXTURE]) {
      const text = readFileSync(path, "utf8");
      expect(verifyPrivateDocumentRehearsalOutputText(text)).toEqual(
        verifyPrivateDocumentRehearsalOutputText(text),
      );
    }
  });

  it("contains no fake lifecycle, runner, network, retry, or persistence path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "scripts/verify-private-document-rehearsal-output.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain(
      "createDeterministicPrivateDocumentFakeLifecycle",
    );
    expect(source).not.toContain("runPrivateDocumentRehearsal");
    expect(source).not.toContain("PrivateDocumentEvidenceRunner");
    expect(source).not.toMatch(/\.execute\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
  });

  it("rejects missing, extra, and reordered envelope fields", () => {
    const missing = fixture() as Record<string, unknown>;
    delete missing.receipt;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture() as Record<string, unknown>;
    extra.detail = "safe";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const canonical = fixture() as Record<string, unknown>;
    const reordered = {
      label: canonical.label,
      schemaVersion: canonical.schemaVersion,
      ...Object.fromEntries(
        Object.entries(canonical).filter(
          ([key]) => !["label", "schemaVersion"].includes(key),
        ),
      ),
    };
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects missing, extra, and reordered nested fields", () => {
    const missing = fixture();
    delete (missing.binding as Partial<typeof missing.binding>)
      .fakeRunDigestSha256;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    (extra.fakeRun as Record<string, unknown>).detail = "safe";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const reordered = fixture();
    const evidence = reordered.receipt.externalEvidence;
    reordered.receipt.externalEvidence = {
      learnerVisibility: evidence.learnerVisibility!,
      producerStaging: evidence.producerStaging!,
      ...Object.fromEntries(
        Object.entries(evidence).filter(
          ([key]) =>
            !["learnerVisibility", "producerStaging"].includes(key),
        ),
      ),
    };
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects malformed, duplicate-key, compact, and oversized JSON", () => {
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutputText("{")
    )).toBe("NON_CANONICAL_JSON");

    const canonical = readFileSync(CLEANED_FIXTURE, "utf8");
    const duplicate = canonical.replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    );
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutputText(duplicate)
    )).toBe("NON_CANONICAL_JSON");

    expect(category(() =>
      verifyPrivateDocumentRehearsalOutputText(
        JSON.stringify(fixture()),
      )
    )).toBe("NON_CANONICAL_JSON");

    expect(category(() =>
      verifyPrivateDocumentRehearsalOutputText(
        `${" ".repeat(32 * 1024)}x`,
      )
    )).toBe("INPUT_OVERSIZED");

    const oversized = fixture() as Record<string, unknown>;
    oversized.detail = "x".repeat(32 * 1024);
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(oversized)
    )).toBe("INPUT_OVERSIZED");
  });

  it.each([
    ["11111111", "1111", "1111", "1111", "111111111111"].join("-"),
    ["person", "example.test"].join("@"),
    `/${["home", "example", "private.json"].join("/")}`,
    ["C:", "Users", "example", "secret.json"].join("\\"),
    ["ap2doc", "20260101T000000Z", "a1b2c3"].join("-"),
    ["run", "rawmarker"].join("-"),
    ["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" "),
    ["access", "token"].join("_"),
    ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "),
  ])("rejects unsafe content before shape: %s", (unsafe) => {
    const value = fixture() as Record<string, unknown>;
    value.detail = unsafe;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(value)
    )).toBe("UNSAFE_CONTENT");
  });

  it("rejects wrong scenario, version, label, and plan digest", () => {
    const label = fixture();
    label.label = "LIVE";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(label)
    )).toBe("INPUT_SHAPE");

    const scenario = fixture();
    scenario.binding.scenarioId = "other-scenario";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(scenario)
    )).toBe("PLAN_BINDING");

    const version = fixture();
    version.binding.manifestSchemaVersion = 1;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(version)
    )).toBe("PLAN_BINDING");

    for (const digest of ["0".repeat(64), "not-a-digest"]) {
      const plan = fixture();
      plan.binding.planDigestSha256 = digest;
      expect(category(() =>
        verifyPrivateDocumentRehearsalOutput(plan)
      )).toBe("PLAN_BINDING");
    }
  });

  it("rejects nonterminal result and every inconsistent stage", () => {
    const status = fixture();
    status.status = "refused";
    status.failure = "INPUT_SCHEMA";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(status)
    )).toBe("RUN_NONTERMINAL");

    for (const key of Object.keys(fixture().stages)) {
      const value = fixture();
      (value.stages as Record<string, string>)[key] = "refused";
      expect(category(() =>
        verifyPrivateDocumentRehearsalOutput(value)
      )).toBe("RUN_NONTERMINAL");
    }
  });

  it("rejects malformed, tampered, and cross-branch fake digests", () => {
    for (const digest of [
      "0".repeat(64),
      "not-a-digest",
      fixture("learner-observation").binding.fakeRunDigestSha256,
    ]) {
      const value = fixture();
      value.binding.fakeRunDigestSha256 = digest;
      expect(category(() =>
        verifyPrivateDocumentRehearsalOutput(value)
      )).toBe("FAKE_CONTRACT_BINDING");
    }
  });

  it("rejects branch mismatch and post-cleanup visibility substitution", () => {
    const selected = fixture();
    selected.binding.syntheticBranch = "learner-observation";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(selected)
    )).toBe("BRANCH_MISMATCH");

    const invalid = fixture();
    invalid.binding.syntheticBranch = "live";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(invalid)
    )).toBe("BRANCH_MISMATCH");

    const lifecycle = fixture();
    lifecycle.fakeRun.lifecycleStatus = "completed-cleaned";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(lifecycle)
    )).toBe("BRANCH_MISMATCH");

    const visibility = fixture();
    visibility.fakeRun.learnerObservation = "synthetic-proven";
    visibility.fakeRun.initialTerminalLearnerAbsence =
      "synthetic-absent";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(visibility)
    )).toBe("BRANCH_MISMATCH");
    expect(
      visibility.fakeRun.freshTerminal.learnerAccess,
    ).toBe("synthetic-absent");
  });

  it.each([
    ["journalEntries", 29],
    ["initialTerminalProducerAbsence", "synthetic-not-proven"],
  ] as const)("rejects cleanup gap %s", (field, changed) => {
    const value = fixture();
    (value.fakeRun as Record<string, unknown>)[field] = changed;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(value)
    )).toBe("CLEANUP_GAP");
  });

  it.each([
    ["rounds", 2],
    ["producerFolder", "synthetic-not-proven"],
    ["producerItem", "synthetic-not-proven"],
    ["producerPermission", "synthetic-not-proven"],
    ["learnerAccess", "synthetic-not-proven"],
  ] as const)("rejects terminal cleanup gap %s", (field, changed) => {
    const value = fixture();
    (value.fakeRun.freshTerminal as Record<string, unknown>)[field] =
      changed;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(value)
    )).toBe("CLEANUP_GAP");
  });

  it("rejects adapter, receipt, and claim-count drift", () => {
    const adapter = fixture();
    adapter.receipt.adapterCandidateAccepted = false;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(adapter)
    )).toBe("RECEIPT_REFUSED");

    const verifier = fixture();
    verifier.receipt.verifierAccepted = false;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(verifier)
    )).toBe("RECEIPT_REFUSED");

    const count = fixture();
    count.receipt.candidateClaimCount = 17;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(count)
    )).toBe("RECEIPT_REFUSED");
  });

  it.each([
    "producerStaging",
    "learnerVisibility",
    "learnerInterpretation",
    "auditOrDetection",
    "response",
    "cleanup",
    "retention",
  ])("rejects %s evidence promotion in both branches", (claim) => {
    for (
      const branch of [
        "cleaned-canary",
        "learner-observation",
      ] as const
    ) {
      const value = fixture(branch);
      value.receipt.externalEvidence[claim] = "proven";
      expect(category(() =>
        verifyPrivateDocumentRehearsalOutput(value)
      )).toBe("EVIDENCE_OVERCLAIM");
    }
  });

  it("rejects missing or extra external claim coverage", () => {
    const missing = fixture();
    delete missing.receipt.externalEvidence.response;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.receipt.externalEvidence.detection = "uninspected";
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects cyclic object input categorically", () => {
    const value = fixture() as Fixture & { self?: unknown };
    value.self = value;
    expect(category(() =>
      verifyPrivateDocumentRehearsalOutput(value)
    )).toBe("INPUT_SHAPE");
  });

  it("runs the one-file CLI with stable safe success and failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-pd-verify-"));
    const validPath = join(directory, "valid.json");
    const invalidPath = join(directory, "invalid.json");
    try {
      writeFileSync(
        validPath,
        readFileSync(CLEANED_FIXTURE, "utf8"),
        { mode: 0o600 },
      );
      writeFileSync(invalidPath, "{", { mode: 0o600 });
      const valid = spawnSync(
        process.execPath,
        [CLI, validPath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        externalEvidence: "all-uninspected",
      });
      expect(valid.stdout).not.toContain(validPath);

      const first = spawnSync(
        process.execPath,
        [CLI, invalidPath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      const second = spawnSync(
        process.execPath,
        [CLI, invalidPath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(first.status).toBe(2);
      expect(first.stderr).toBe(second.stderr);
      expect(JSON.parse(first.stderr)).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFICATION",
        status: "refused",
        failure: "NON_CANONICAL_JSON",
      });
      expect(first.stderr).not.toContain(invalidPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
