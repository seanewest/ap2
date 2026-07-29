// @vitest-environment node

import { createHash } from "node:crypto";
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
  HelpDeskEmailRehearsalVerificationError,
  verifyHelpDeskEmailRehearsalOutput,
  verifyHelpDeskEmailRehearsalOutputText,
  type HelpDeskEmailRehearsalVerificationFailure,
} from "./verify-help-desk-email-rehearsal-output.ts";

const FIXTURES = {
  "send-accepted": {
    path: join(
      process.cwd(),
      "scripts/fixtures/help-desk-email-rehearsal-output-send.json",
    ),
    fileSha256:
      "cbeabdfd4f37b399ba448f54b0f38175ec2f8aafff5696ba60aa4cbc6bcf5411",
    fakeDigest:
      "34d0aa39655ffd01a0b3fa0856f3d8ee69d45b1d891b97961af54cb1eaa38f5f",
  },
  "learner-observed-retained": {
    path: join(
      process.cwd(),
      "scripts/fixtures/help-desk-email-rehearsal-output-retained.json",
    ),
    fileSha256:
      "94104aaf0c7331a335ab6c6e1e42894d1aa825652ca882b4d074365379468652",
    fakeDigest:
      "8316e05680f3c823f7e09dace15ac6c5812d4c6b0b175fcfa46c0cd3425e3297",
  },
  "learner-observed-cleaned": {
    path: join(
      process.cwd(),
      "scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json",
    ),
    fileSha256:
      "49b355ead05b7f430f5d3618d1666342aa0753489660690434e5f9b6013b57fb",
    fakeDigest:
      "7c1a6f4e62a0aee173646bef5cb5625400f89a807e8768b97e26f4ca0289499e",
  },
} as const;
const CLI = "scripts/verify-help-desk-email-rehearsal-output-cli.ts";

type Branch = keyof typeof FIXTURES;

interface Fixture {
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
  stages: Record<string, string>;
  envelope: {
    terminalState: string;
    observationSource: string;
    externalEvidence: string;
  };
  fakeRun: {
    operationAttempts: number;
    journalEntries: number;
    send: string;
    learnerVisibility: string;
    learnerInterpretation: string;
    retention: string;
    cleanup: string;
    auditOrDetection: string;
    teamsCall: string;
    voicemail: string;
    terminalState: string;
  };
  receipt: {
    adapterCandidateAccepted: boolean;
    verifierAccepted: boolean;
    candidateClaimCount: number;
    externalEvidence: Record<string, string>;
  };
}

function fixture(
  branch: Branch = "send-accepted",
): Fixture {
  return JSON.parse(
    readFileSync(FIXTURES[branch].path, "utf8"),
  ) as Fixture;
}

function category(
  action: () => unknown,
): HelpDeskEmailRehearsalVerificationFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      HelpDeskEmailRehearsalVerificationError,
    );
    return (error as HelpDeskEmailRehearsalVerificationError).category;
  }
  throw new Error("Expected verifier refusal.");
}

describe("offline help-desk email rehearsal output verifier", () => {
  it.each(Object.entries(FIXTURES))(
    "accepts the independent committed %s fixture",
    (branch, { path, fileSha256, fakeDigest }) => {
      const text = readFileSync(path, "utf8");
      expect(createHash("sha256").update(text).digest("hex")).toBe(
        fileSha256,
      );
      const summary = verifyHelpDeskEmailRehearsalOutput(
        JSON.parse(text),
      );
      expect(summary).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        scenarioId: "help-desk-email-observation",
        manifestSchemaVersion: 2,
        planDigestSha256:
          "87846ba59f61fc67d6faa98fe130f4ae8db464b07b2c4f72454316db42821c68",
        fakeRunDigestSha256: fakeDigest,
        syntheticBranch: branch,
        fakeContract: "one-shot-terminal-verified",
        adapter: "accepted",
        receiptVerifier: "accepted",
        envelope: "accepted",
        externalEvidence: "all-uninspected",
        claimCount: 15,
      });
      expect(Object.isFrozen(summary)).toBe(true);
    },
  );

  it("verifies canonical fixture text deterministically", () => {
    for (const { path } of Object.values(FIXTURES)) {
      const text = readFileSync(path, "utf8");
      expect(verifyHelpDeskEmailRehearsalOutputText(text)).toEqual(
        verifyHelpDeskEmailRehearsalOutputText(text),
      );
    }
  });

  it("contains no fake, pipeline, send, network, retry, or persistence path", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "scripts/verify-help-desk-email-rehearsal-output.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain(
      "createDeterministicHelpDeskEmailFakeLifecycle",
    );
    expect(source).not.toContain("runHelpDeskEmailRehearsal");
    expect(source).not.toContain("DeterministicHelpDeskScenarioOperation");
    expect(source).not.toMatch(/\.execute\s*\(/);
    expect(source).not.toMatch(/\.send\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry/i);
  });

  it("rejects missing, extra, and reordered envelope fields", () => {
    const missing = fixture() as unknown as Record<string, unknown>;
    delete missing.receipt;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture() as unknown as Record<string, unknown>;
    extra.detail = "safe";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const canonical = fixture() as unknown as Record<string, unknown>;
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
      verifyHelpDeskEmailRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects missing, extra, and reordered nested fields", () => {
    const missing = fixture();
    delete (missing.binding as Partial<typeof missing.binding>)
      .fakeRunDigestSha256;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    (extra.fakeRun as unknown as Record<string, unknown>).detail = "safe";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const reordered = fixture();
    const evidence = reordered.receipt.externalEvidence;
    reordered.receipt.externalEvidence = {
      inboxVisibility: evidence.inboxVisibility!,
      emailSend: evidence.emailSend!,
      ...Object.fromEntries(
        Object.entries(evidence).filter(
          ([key]) => !["inboxVisibility", "emailSend"].includes(key),
        ),
      ),
    };
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects malformed, duplicate-key, compact, and oversized JSON", () => {
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutputText("{")
    )).toBe("NON_CANONICAL_JSON");

    const canonical = readFileSync(FIXTURES["send-accepted"].path, "utf8");
    const duplicate = canonical.replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    );
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutputText(duplicate)
    )).toBe("NON_CANONICAL_JSON");

    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutputText(JSON.stringify(fixture()))
    )).toBe("NON_CANONICAL_JSON");

    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutputText(
        `${" ".repeat(32 * 1024)}x`,
      )
    )).toBe("INPUT_OVERSIZED");

    const oversized = fixture() as unknown as Record<string, unknown>;
    oversized.detail = "x".repeat(32 * 1024);
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(oversized)
    )).toBe("INPUT_OVERSIZED");
  });

  it.each([
    ["11111111", "1111", "1111", "1111", "111111111111"].join("-"),
    ["person", "example.test"].join("@"),
    `/${["home", "example", "private.json"].join("/")}`,
    ["C:", "Users", "example", "secret.json"].join("\\"),
    ["ap2", "help-desk-email-20260101-001"].join("-"),
    ["run", "rawmarker"].join("-"),
    ["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" "),
    ["access", "token"].join("_"),
    ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "),
  ])("rejects unsafe content before shape: %s", (unsafe) => {
    const value = fixture() as unknown as Record<string, unknown>;
    value.detail = unsafe;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(value)
    )).toBe("UNSAFE_CONTENT");
  });

  it("rejects raw subject/body fields without accepting arbitrary text", () => {
    for (const key of ["subject", "body"]) {
      const value = fixture() as unknown as Record<string, unknown>;
      value[key] = "arbitrary evidence text";
      expect(category(() =>
        verifyHelpDeskEmailRehearsalOutput(value)
      )).toBe("INPUT_SHAPE");
    }
  });

  it("rejects wrong scenario, version, label, and plan digest", () => {
    const label = fixture();
    label.label = "LIVE";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(label)
    )).toBe("INPUT_SHAPE");

    const scenario = fixture();
    scenario.binding.scenarioId = "private-document-evidence";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(scenario)
    )).toBe("PLAN_BINDING");

    const version = fixture();
    version.binding.manifestSchemaVersion = 1;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(version)
    )).toBe("PLAN_BINDING");

    for (const digest of ["0".repeat(64), "not-a-digest"]) {
      const plan = fixture();
      plan.binding.planDigestSha256 = digest;
      expect(category(() =>
        verifyHelpDeskEmailRehearsalOutput(plan)
      )).toBe("PLAN_BINDING");
    }
  });

  it("rejects nonterminal result and every inconsistent stage", () => {
    const status = fixture();
    status.status = "refused";
    status.failure = "INPUT_SCHEMA";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(status)
    )).toBe("RUN_NONTERMINAL");

    for (const key of Object.keys(fixture().stages)) {
      const value = fixture();
      value.stages[key] = "refused";
      expect(category(() =>
        verifyHelpDeskEmailRehearsalOutput(value)
      )).toBe("RUN_NONTERMINAL");
    }
  });

  it("rejects malformed, tampered, and cross-branch fake digests", () => {
    for (const digest of [
      "0".repeat(64),
      "not-a-digest",
      fixture("learner-observed-cleaned").binding.fakeRunDigestSha256,
    ]) {
      const value = fixture();
      value.binding.fakeRunDigestSha256 = digest;
      expect(category(() =>
        verifyHelpDeskEmailRehearsalOutput(value)
      )).toBe("FAKE_CONTRACT_BINDING");
    }
  });

  it("rejects branch mismatch and send-as-visibility substitution", () => {
    const selected = fixture();
    selected.binding.syntheticBranch = "learner-observed-retained";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(selected)
    )).toBe("BRANCH_MISMATCH");

    const invalid = fixture();
    invalid.binding.syntheticBranch = "live";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(invalid)
    )).toBe("BRANCH_MISMATCH");

    const visibility = fixture();
    visibility.fakeRun.learnerVisibility = "synthetic-observed";
    visibility.fakeRun.retention = "synthetic-retained";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(visibility)
    )).toBe("BRANCH_MISMATCH");
    expect(visibility.fakeRun.send).toBe("synthetic-accepted");
  });

  it("rejects retained-as-cleaned and missing pre-cleanup visibility", () => {
    const retained = fixture("learner-observed-retained");
    retained.fakeRun.cleanup = "synthetic-cleaned";
    retained.fakeRun.retention = "synthetic-absent";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(retained)
    )).toBe("BRANCH_MISMATCH");

    const cleaned = fixture("learner-observed-cleaned");
    cleaned.fakeRun.learnerVisibility = "synthetic-uninspected";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(cleaned)
    )).toBe("CLEANUP_GAP");
    expect(cleaned.fakeRun.cleanup).toBe("synthetic-cleaned");
  });

  it.each([
    ["operationAttempts", 2],
    ["journalEntries", 1],
    ["send", "synthetic-failed"],
  ] as const)("rejects fake contract drift %s", (field, changed) => {
    const value = fixture();
    (value.fakeRun as unknown as Record<string, unknown>)[field] = changed;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(value)
    )).toBe("FAKE_CONTRACT_BINDING");
  });

  it.each([
    "learnerInterpretation",
    "auditOrDetection",
    "teamsCall",
    "voicemail",
  ] as const)("rejects synthetic %s overclaim", (field) => {
    const value = fixture("learner-observed-retained");
    value.fakeRun[field] = "synthetic-observed";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(value)
    )).toBe("EVIDENCE_OVERCLAIM");
  });

  it.each([
    "emailSend",
    "inboxVisibility",
    "learnerInterpretation",
    "response",
    "cleanup",
    "retention",
    "auditOrDetection",
    "teamsCall",
    "voicemail",
  ])("rejects external %s promotion in every branch", (claim) => {
    for (const branch of Object.keys(FIXTURES) as Branch[]) {
      const value = fixture(branch);
      value.receipt.externalEvidence[claim] = "proven";
      expect(category(() =>
        verifyHelpDeskEmailRehearsalOutput(value)
      )).toBe("EVIDENCE_OVERCLAIM");
    }
  });

  it("rejects missing or extra external claim coverage", () => {
    const missing = fixture();
    delete missing.receipt.externalEvidence.response;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.receipt.externalEvidence.delivery = "uninspected";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects adapter, receipt, claim-count, and envelope drift", () => {
    const adapter = fixture();
    adapter.receipt.adapterCandidateAccepted = false;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(adapter)
    )).toBe("RECEIPT_REFUSED");

    const verifier = fixture();
    verifier.receipt.verifierAccepted = false;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(verifier)
    )).toBe("RECEIPT_REFUSED");

    const count = fixture();
    count.receipt.candidateClaimCount = 14;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(count)
    )).toBe("RECEIPT_REFUSED");

    const envelope = fixture();
    envelope.envelope.externalEvidence = "some-inspected";
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(envelope)
    )).toBe("EVIDENCE_OVERCLAIM");
  });

  it("rejects AVD and private-document output families", () => {
    for (
      const path of [
        "scripts/fixtures/avd-three-vm-rehearsal-output.json",
        "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
      ]
    ) {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      expect(() =>
        verifyHelpDeskEmailRehearsalOutput(value)
      ).toThrow(HelpDeskEmailRehearsalVerificationError);
    }
  });

  it("rejects cyclic object input categorically", () => {
    const value = fixture() as Fixture & { self?: unknown };
    value.self = value;
    expect(category(() =>
      verifyHelpDeskEmailRehearsalOutput(value)
    )).toBe("INPUT_SHAPE");
  });

  it("runs the one-file CLI with stable safe success and failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-hd-verify-"));
    const validPath = join(directory, "valid.json");
    const invalidPath = join(directory, "invalid.json");
    try {
      writeFileSync(
        validPath,
        readFileSync(FIXTURES["send-accepted"].path, "utf8"),
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
