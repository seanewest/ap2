// @vitest-environment node

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
  TeamsMissedCallRehearsalVerificationError,
  verifyTeamsMissedCallRehearsalOutput,
  verifyTeamsMissedCallRehearsalOutputText,
  type TeamsMissedCallRehearsalVerificationFailure,
} from "./verify-teams-missed-call-rehearsal-output.ts";

const BRANCHES = [
  "stage-only",
  "native-retained",
  "reported-retained",
  "native-cleaned",
] as const;
const FIXTURES = {
  "stage-only":
    "scripts/fixtures/teams-missed-call-rehearsal-output-stage-only.json",
  "native-retained":
    "scripts/fixtures/teams-missed-call-rehearsal-output-native-retained.json",
  "reported-retained":
    "scripts/fixtures/teams-missed-call-rehearsal-output-reported-retained.json",
  "native-cleaned":
    "scripts/fixtures/teams-missed-call-rehearsal-output-native-cleaned.json",
} as const;
const CLI = "scripts/verify-teams-missed-call-rehearsal-output-cli.ts";

interface MutableFixture {
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
  fakeRun: {
    stage: string;
    nativeHistory: string;
    activity: string;
    report: string;
    retention: string;
    terminalCleanup: string;
  };
  receipt: {
    adapterCandidateAccepted: boolean;
    verifierAccepted: boolean;
    candidateClaimCount: number;
    canonicalLearnerInterpretation: string;
  };
  envelope: {
    terminalState: string;
    observationSource: string;
    externalEvidence: string;
    claims: Record<string, string>;
  };
  [key: string]: unknown;
}

function fixture(
  branch: typeof BRANCHES[number] = "stage-only",
): MutableFixture {
  return JSON.parse(
    readFileSync(join(process.cwd(), FIXTURES[branch]), "utf8"),
  ) as MutableFixture;
}

function category(
  action: () => unknown,
): TeamsMissedCallRehearsalVerificationFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      TeamsMissedCallRehearsalVerificationError,
    );
    return (error as TeamsMissedCallRehearsalVerificationError).category;
  }
  throw new Error("Expected verifier refusal.");
}

describe("offline Teams missed-call rehearsal output verifier", () => {
  it.each([
    [
      "stage-only",
      "068d3f762aef06f1bf2e70f2e1f50718d0d7f489f7df50200f2aa4bb381dc793",
      "uninspected",
      "uninspected",
      "uninspected",
    ],
    [
      "native-retained",
      "66ff4625c8592ad82534845f9735580d9950a1463e5db757378590c2110f1e7f",
      "two-surface",
      "uninspected",
      "uninspected",
    ],
    [
      "reported-retained",
      "2d7d644cffcec468d7fc360ef4f7db5f3bcd2fc911ae510bb6a2336f19d09e8a",
      "two-surface",
      "reported",
      "uninspected",
    ],
    [
      "native-cleaned",
      "7d00832c28304530db7bf7635dce4b24c13cd3e954cd0df6afe6055561c57d60",
      "two-surface",
      "uninspected",
      "two-surface-absent",
    ],
  ] as const)(
    "accepts the independent reviewer-confirmed %s fixture",
    (branch, fakeDigest, nativeObservation, report, cleanup) => {
      const summary = verifyTeamsMissedCallRehearsalOutput(
        fixture(branch),
      );
      expect(summary).toMatchObject({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        scenarioId: "teams-missed-call-observation",
        manifestSchemaVersion: 2,
        fakeRunDigestSha256: fakeDigest,
        syntheticBranch: branch,
        fakeContract: "one-attempt-categorical-verified",
        nativeObservation,
        report,
        cleanup,
        adapter: "accepted",
        receiptVerifier: "accepted",
        externalEvidence: "all-uninspected",
        canonicalLearnerInterpretation: "uninspected",
        claimCount: 14,
      });
      expect(summary.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(summary)).toBe(true);
    },
  );

  it("verifies canonical fixture text deterministically", () => {
    for (const branch of BRANCHES) {
      const text = readFileSync(FIXTURES[branch], "utf8");
      expect(verifyTeamsMissedCallRehearsalOutputText(text)).toEqual(
        verifyTeamsMissedCallRehearsalOutputText(text),
      );
    }
  });

  it("does not import or invoke the fake factory or pipeline runner", () => {
    const source = readFileSync(
      "scripts/verify-teams-missed-call-rehearsal-output.ts",
      "utf8",
    );
    expect(source).not.toContain(
      "createDeterministicTeamsMissedCallFakeLifecycle",
    );
    expect(source).not.toContain("runTeamsMissedCallRehearsal");
    expect(source).not.toMatch(/\.execute\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry\b/i);
    expect(source).not.toMatch(
      /cloudCommunications|startCall|sendMail|GraphServiceClient/,
    );
  });

  it("rejects missing, extra, and reordered top-level fields", () => {
    const missing = fixture();
    delete (missing as Partial<MutableFixture>).receipt;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.detail = "safe";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const value = fixture();
    const reordered = {
      label: value.label,
      schemaVersion: value.schemaVersion,
      ...Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => !["label", "schemaVersion"].includes(key),
        ),
      ),
    };
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects missing, extra, and reordered nested fields", () => {
    const missing = fixture();
    delete missing.envelope.claims.callback;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.fakeRun = { ...extra.fakeRun, detail: "safe" } as
      typeof extra.fakeRun;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const reordered = fixture();
    const claims = reordered.envelope.claims;
    reordered.envelope.claims = {
      callback: claims.callback!,
      liveCall: claims.liveCall!,
      ...Object.fromEntries(
        Object.entries(claims).filter(
          ([key]) => !["callback", "liveCall"].includes(key),
        ),
      ),
    };
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects malformed, duplicate-key, compact, and oversized JSON", () => {
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutputText("{")
    )).toBe("NON_CANONICAL_JSON");

    const canonical = readFileSync(FIXTURES["stage-only"], "utf8");
    const duplicate = canonical.replace(
      '  "schemaVersion": 1,',
      '  "schemaVersion": 1,\n  "schemaVersion": 1,',
    );
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutputText(duplicate)
    )).toBe("NON_CANONICAL_JSON");
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutputText(
        JSON.stringify(fixture()),
      )
    )).toBe("NON_CANONICAL_JSON");
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutputText(
        `${" ".repeat(32 * 1024)}x`,
      )
    )).toBe("INPUT_OVERSIZED");

    const oversized = fixture();
    oversized.detail = "x".repeat(32 * 1024);
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(oversized)
    )).toBe("INPUT_OVERSIZED");
  });

  it.each([
    ["11111111", "1111", "1111", "1111", "111111111111"].join("-"),
    ["person", "example.test"].join("@"),
    `/${["home", "example", "private.json"].join("/")}`,
    ["C:", "Users", "example", "secret.json"].join("\\"),
    ["ap2", "teams-hidden-value"].join("-"),
    ["run", "rawmarker"].join("-"),
    ["Bearer", "abcdefghijklmnopqrstuvwxyz"].join(" "),
    ["access", "token"].join("_"),
    ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "),
  ])("rejects unsafe or raw content before shape: %s", (unsafe) => {
    const value = fixture();
    value.detail = unsafe;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(value)
    )).toBe("UNSAFE_CONTENT");
  });

  it.each([
    ["userId", "raw-user"],
    ["tenantId", "raw-tenant"],
    ["callId", "raw-call"],
    ["sessionId", "raw-session"],
    ["messageId", "raw-message"],
    ["activityId", "raw-activity"],
    ["marker", "raw-marker"],
    ["timestamp", "raw-time"],
    ["screenshot", "raw-image"],
    ["clientState", "raw-client"],
  ])("rejects forbidden raw field %s categorically", (key, raw) => {
    const value = fixture();
    value[key] = raw;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(value)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects wrong scenario, version, label, and plan digest", () => {
    const label = fixture();
    label.label = "LIVE";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(label)
    )).toBe("INPUT_SHAPE");

    const scenario = fixture();
    scenario.binding.scenarioId = "private-document-evidence";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(scenario)
    )).toBe("PLAN_BINDING");

    const version = fixture();
    version.binding.manifestSchemaVersion = 1;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(version)
    )).toBe("PLAN_BINDING");

    for (const digest of ["0".repeat(64), "not-a-digest"]) {
      const plan = fixture();
      plan.binding.planDigestSha256 = digest;
      expect(category(() =>
        verifyTeamsMissedCallRehearsalOutput(plan)
      )).toBe("PLAN_BINDING");
    }
  });

  it("rejects nonterminal output and every inconsistent stage", () => {
    const output = fixture();
    output.status = "refused";
    output.failure = "FAKE_NONTERMINAL";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(output)
    )).toBe("RUN_NONTERMINAL");

    for (const key of Object.keys(fixture().stages)) {
      const value = fixture();
      value.stages[key] = "refused";
      expect(category(() =>
        verifyTeamsMissedCallRehearsalOutput(value)
      )).toBe("RUN_NONTERMINAL");
    }

    const stage = fixture();
    stage.fakeRun.stage = "synthetic-attempt-incomplete";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(stage)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects tampered, malformed, and cross-branch fake digests", () => {
    for (const digest of [
      "0".repeat(64),
      "not-a-digest",
      fixture("native-cleaned").binding.fakeRunDigestSha256,
    ]) {
      const value = fixture();
      value.binding.fakeRunDigestSha256 = digest;
      expect(category(() =>
        verifyTeamsMissedCallRehearsalOutput(value)
      )).toBe("FAKE_CONTRACT_BINDING");
    }
  });

  it("rejects unknown and cross-branch bindings", () => {
    const unknown = fixture();
    unknown.binding.syntheticBranch = "live";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(unknown)
    )).toBe("BRANCH_MISMATCH");

    const branch = fixture();
    branch.binding.syntheticBranch = "native-retained";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(branch)
    )).toBe("FAKE_CONTRACT_BINDING");

    const plan = fixture("reported-retained");
    plan.binding.planDigestSha256 =
      fixture("native-retained").binding.planDigestSha256;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(plan)
    )).toBe("PLAN_BINDING");
  });

  it.each([
    ["nativeHistory", "synthetic-uninspected"],
    ["activity", "synthetic-uninspected"],
  ] as const)("rejects a one-surface-only native result: %s", (key, value) => {
    const output = fixture("native-retained");
    output.fakeRun[key] = value;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(output)
    )).toBe("TWO_SURFACE_GAP");
  });

  it("does not let stage completion stand in for two-surface evidence", () => {
    const oneSurface = fixture();
    oneSurface.fakeRun.nativeHistory =
      "synthetic-one-missed-incoming";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(oneSurface)
    )).toBe("TWO_SURFACE_GAP");

    const substituted = fixture();
    substituted.fakeRun.nativeHistory =
      "synthetic-one-missed-incoming";
    substituted.fakeRun.activity =
      "synthetic-one-matching-notification";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(substituted)
    )).toBe("INPUT_SHAPE");
  });

  it("keeps optional reporting independent from cleanup", () => {
    const missingReport = fixture("reported-retained");
    missingReport.fakeRun.report = "synthetic-uninspected";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(missingReport)
    )).toBe("REPORT_CLEANUP_COUPLING");

    const reportDuringCleanup = fixture("native-cleaned");
    reportDuringCleanup.fakeRun.report = "synthetic-reported";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(reportDuringCleanup)
    )).toBe("REPORT_CLEANUP_COUPLING");
  });

  it("requires exact synthetic two-surface cleanup and absent retention", () => {
    const cleanup = fixture("native-cleaned");
    cleanup.fakeRun.terminalCleanup = "synthetic-uninspected";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(cleanup)
    )).toBe("CLEANUP_GAP");

    const retention = fixture("native-cleaned");
    retention.fakeRun.retention = "synthetic-retained";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(retention)
    )).toBe("CLEANUP_GAP");
  });

  it("rejects receipt drift and learner-interpretation promotion", () => {
    const adapter = fixture();
    adapter.receipt.adapterCandidateAccepted = false;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(adapter)
    )).toBe("RECEIPT_REFUSED");

    const verifier = fixture();
    verifier.receipt.verifierAccepted = false;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(verifier)
    )).toBe("RECEIPT_REFUSED");

    const count = fixture();
    count.receipt.candidateClaimCount = 13;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(count)
    )).toBe("RECEIPT_REFUSED");

    const interpretation = fixture("reported-retained");
    interpretation.receipt.canonicalLearnerInterpretation = "proven";
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(interpretation)
    )).toBe("RECEIPT_REFUSED");
  });

  it.each([
    "liveCall",
    "nativeMissedCallArtifact",
    "activityItem",
    "learnerVisibility",
    "learnerInterpretation",
    "response",
    "cleanup",
    "retention",
    "voicemail",
    "callback",
    "botPath",
    "externalIdentity",
    "externalProof",
  ])("rejects external %s evidence promotion in every branch", (claim) => {
    for (const branch of BRANCHES) {
      const value = fixture(branch);
      value.envelope.claims[claim] = "proven";
      expect(category(() =>
        verifyTeamsMissedCallRehearsalOutput(value)
      )).toBe("EVIDENCE_OVERCLAIM");
    }
  });

  it("rejects shared-envelope cardinality and category drift", () => {
    for (
      const [key, changed] of [
        ["terminalState", "nonterminal"],
        ["observationSource", "provider-response"],
        ["externalEvidence", "partially-proven"],
      ] as const
    ) {
      const value = fixture();
      value.envelope[key] = changed;
      expect(category(() =>
        verifyTeamsMissedCallRehearsalOutput(value)
      )).toBe("EVIDENCE_OVERCLAIM");
    }
  });

  it("rejects AVD and private-document cross-family outputs", () => {
    for (
      const path of [
        "scripts/fixtures/avd-three-vm-rehearsal-output.json",
        "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
      ]
    ) {
      const value = JSON.parse(readFileSync(path, "utf8"));
      expect(category(() =>
        verifyTeamsMissedCallRehearsalOutput(value)
      )).toBe("INPUT_SHAPE");
    }
  });

  it("rejects cyclic object input categorically", () => {
    const value = fixture();
    value.self = value;
    expect(category(() =>
      verifyTeamsMissedCallRehearsalOutput(value)
    )).toBe("INPUT_SHAPE");
  });

  it("runs the bounded one-file CLI with stable safe results", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-teams-verify-"));
    const validPath = join(directory, "valid.json");
    const invalidPath = join(directory, "invalid.json");
    try {
      writeFileSync(
        validPath,
        readFileSync(FIXTURES["native-cleaned"], "utf8"),
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
        cleanup: "two-surface-absent",
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

      const extra = spawnSync(
        process.execPath,
        [CLI, validPath, validPath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(extra.status).toBe(2);
      expect(JSON.parse(extra.stderr).failure).toBe("INPUT_SHAPE");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
