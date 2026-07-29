// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RehearsalOutputVerificationError,
  verifyAvdThreeVmRehearsalOutput,
} from "./verify-avd-three-vm-rehearsal-output.ts";
import {
  PrivateDocumentRehearsalVerificationError,
  verifyPrivateDocumentRehearsalOutput,
} from "./verify-private-document-rehearsal-output.ts";
import {
  canonicalTeamsMissedCallRehearsalRequest,
  compileTeamsMissedCallRehearsalPlan,
  createDeterministicTeamsMissedCallFakeLifecycle,
  runTeamsMissedCallRehearsal,
  type TeamsMissedCallFakeLifecycle,
  type TeamsMissedCallRehearsalResult,
  type TeamsMissedCallSyntheticBranch,
} from "./teams-missed-call-rehearsal.ts";

const CLI = resolve("scripts/run-teams-missed-call-rehearsal.ts");
const CLI_FIXTURE = resolve(
  "scripts/fixtures/teams-missed-call-rehearsal-stage-only.json",
);
const BRANCHES = [
  "stage-only",
  "native-retained",
  "reported-retained",
  "native-cleaned",
] as const satisfies readonly TeamsMissedCallSyntheticBranch[];

interface MutableFake {
  scenarioId: string;
  stage: Record<string, unknown>;
  journal: Array<Record<string, unknown>>;
  nativeObservation: Record<string, unknown>;
  interpretation: Record<string, unknown>;
  cleanup: Record<string, unknown>;
  [key: string]: unknown;
}

async function mutatedLifecycle(
  branch: TeamsMissedCallSyntheticBranch,
  mutate: (value: MutableFake) => void,
): Promise<{
  lifecycle: TeamsMissedCallFakeLifecycle;
  execute: ReturnType<typeof vi.fn>;
}> {
  const canonical = await createDeterministicTeamsMissedCallFakeLifecycle()
    .execute(branch);
  const value = structuredClone(canonical) as MutableFake;
  mutate(value);
  const execute = vi.fn(async () => structuredClone(value));
  return { lifecycle: { execute }, execute };
}

describe("Teams missed-call REHEARSAL_ONLY pipeline", () => {
  it.each(BRANCHES)(
    "composes and binds the %s branch deterministically",
    async (branch) => {
      const request = canonicalTeamsMissedCallRehearsalRequest(branch);
      const first = await runTeamsMissedCallRehearsal(
        request,
        createDeterministicTeamsMissedCallFakeLifecycle(),
      );
      const second = await runTeamsMissedCallRehearsal(
        request,
        createDeterministicTeamsMissedCallFakeLifecycle(),
      );

      expect(first).toEqual(second);
      expect(Object.isFrozen(first)).toBe(true);
      expect(first).toMatchObject({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY",
        status: "completed",
        failure: null,
        binding: {
          scenarioId: "teams-missed-call-observation",
          manifestSchemaVersion: 2,
          syntheticBranch: branch,
          planDigestSha256:
            compileTeamsMissedCallRehearsalPlan(branch).digestSha256,
        },
        stages: {
          plan: "compiled",
          fakeLifecycle: "completed",
          adapter: "accepted",
          receiptVerifier: "accepted",
          envelope: "accepted",
        },
        fakeRun: {
          stage: "synthetic-one-attempt-completed",
        },
        receipt: {
          adapterCandidateAccepted: true,
          verifierAccepted: true,
          candidateClaimCount: 14,
          canonicalLearnerInterpretation: "uninspected",
        },
        envelope: {
          terminalState: "terminal-complete",
          observationSource: "synthetic-only",
          externalEvidence: "all-uninspected",
        },
      });
      expect(first.binding?.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(first.binding?.fakeRunDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it("keeps every external claim uninspected in every synthetic branch", async () => {
    for (const branch of BRANCHES) {
      const result = await runTeamsMissedCallRehearsal(
        canonicalTeamsMissedCallRehearsalRequest(branch),
        createDeterministicTeamsMissedCallFakeLifecycle(),
      );
      expect(
        Object.values(result.envelope?.claims ?? {}),
      ).toHaveLength(13);
      expect(
        Object.values(result.envelope?.claims ?? {}).every(
          (value) => value === "uninspected",
        ),
      ).toBe(true);
      expect(result.receipt?.canonicalLearnerInterpretation).toBe(
        "uninspected",
      );
    }
  });

  it("distinguishes stage, retained, report, and independent cleanup branches", async () => {
    const results = Object.fromEntries(
      await Promise.all(BRANCHES.map(async (branch) => [
        branch,
        await runTeamsMissedCallRehearsal(
          canonicalTeamsMissedCallRehearsalRequest(branch),
          createDeterministicTeamsMissedCallFakeLifecycle(),
        ),
      ])),
    ) as Record<TeamsMissedCallSyntheticBranch, TeamsMissedCallRehearsalResult>;

    expect(results["stage-only"].fakeRun).toMatchObject({
      nativeHistory: "synthetic-uninspected",
      activity: "synthetic-uninspected",
      report: "synthetic-uninspected",
      retention: "synthetic-uninspected",
      terminalCleanup: "synthetic-uninspected",
    });
    expect(results["native-retained"].fakeRun).toMatchObject({
      nativeHistory: "synthetic-one-missed-incoming",
      activity: "synthetic-one-matching-notification",
      report: "synthetic-uninspected",
      retention: "synthetic-retained",
      terminalCleanup: "synthetic-uninspected",
    });
    expect(results["reported-retained"].fakeRun).toMatchObject({
      report: "synthetic-reported",
      retention: "synthetic-retained",
      terminalCleanup: "synthetic-uninspected",
    });
    expect(results["native-cleaned"].fakeRun).toMatchObject({
      report: "synthetic-uninspected",
      retention: "synthetic-absent",
      terminalCleanup: "synthetic-two-surface-absent",
    });
    expect(
      new Set(
        Object.values(results).map(
          ({ binding }) => binding?.fakeRunDigestSha256,
        ),
      ).size,
    ).toBe(BRANCHES.length);
  });

  it("executes the injected fake exactly once and never retries refusal", async () => {
    const execute = vi.fn(async () => {
      throw new Error("synthetic failure");
    });
    const result = await runTeamsMissedCallRehearsal(
      canonicalTeamsMissedCallRehearsalRequest(),
      { execute },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "refused",
      failure: "FAKE_NONTERMINAL",
      stages: {
        plan: "compiled",
        fakeLifecycle: "refused",
        adapter: "not-run",
        receiptVerifier: "not-run",
        envelope: "not-run",
      },
    });
  });

  it("runs with network access disabled", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access is forbidden");
    });
    try {
      const result = await runTeamsMissedCallRehearsal(
        canonicalTeamsMissedCallRehearsalRequest("native-cleaned"),
        createDeterministicTeamsMissedCallFakeLifecycle(),
      );
      expect(result.status).toBe("completed");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    ["ambiguous", "FAKE_NONTERMINAL"],
    ["refused", "FAKE_NONTERMINAL"],
    ["pre-identity", "FAKE_NONTERMINAL"],
    ["failed", "FAKE_NONTERMINAL"],
    ["incomplete", "FAKE_NONTERMINAL"],
  ] as const)("rejects a %s stage outcome once", async (outcome, expected) => {
    const { lifecycle, execute } = await mutatedLifecycle(
      "stage-only",
      (value) => {
        value.stage.outcome = outcome;
      },
    );
    const result = await runTeamsMissedCallRehearsal(
      canonicalTeamsMissedCallRehearsalRequest(),
      lifecycle,
    );
    expect(result.failure).toBe(expected);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "duplicate event",
      expected: "FAKE_SEQUENCE",
      branch: "stage-only" as const,
      mutate: (value: MutableFake) => {
        value.journal[1] = structuredClone(value.journal[0]!);
      },
    },
    {
      name: "reordered events",
      expected: "FAKE_SEQUENCE",
      branch: "stage-only" as const,
      mutate: (value: MutableFake) => {
        value.journal.reverse();
      },
    },
    {
      name: "mismatched scenario",
      expected: "FAKE_SCENARIO_MISMATCH",
      branch: "stage-only" as const,
      mutate: (value: MutableFake) => {
        value.scenarioId = "help-desk-email-observation";
      },
    },
    {
      name: "bot/human conflation",
      expected: "FAKE_ROLE_CONFLATION",
      branch: "stage-only" as const,
      mutate: (value: MutableFake) => {
        value.stage.actorPath = "graph-bot";
      },
    },
    {
      name: "one-surface history only",
      expected: "FAKE_OBSERVATION_MISMATCH",
      branch: "native-retained" as const,
      mutate: (value: MutableFake) => {
        value.nativeObservation.activity = "uninspected";
      },
    },
    {
      name: "non-native evidence",
      expected: "FAKE_OBSERVATION_MISMATCH",
      branch: "native-retained" as const,
      mutate: (value: MutableFake) => {
        value.nativeObservation.authenticity = "application-narrative";
      },
    },
    {
      name: "voicemail inference",
      expected: "FAKE_SEMANTIC_OVERCLAIM",
      branch: "reported-retained" as const,
      mutate: (value: MutableFake) => {
        value.interpretation.conclusion =
          "missed-teams-call-with-voicemail";
      },
    },
    {
      name: "callback inference",
      expected: "FAKE_SEMANTIC_OVERCLAIM",
      branch: "reported-retained" as const,
      mutate: (value: MutableFake) => {
        value.interpretation.conclusion =
          "missed-teams-call-with-callback";
      },
    },
    {
      name: "one-surface cleanup",
      expected: "FAKE_CLEANUP_GAP",
      branch: "native-cleaned" as const,
      mutate: (value: MutableFake) => {
        value.cleanup.activity = "present";
      },
    },
    {
      name: "ambiguous cleanup",
      expected: "FAKE_CLEANUP_GAP",
      branch: "native-cleaned" as const,
      mutate: (value: MutableFake) => {
        value.cleanup.retention = "ambiguous";
      },
    },
  ])("fails closed on $name", async ({ expected, branch, mutate }) => {
    const { lifecycle, execute } = await mutatedLifecycle(branch, mutate);
    const result = await runTeamsMissedCallRehearsal(
      canonicalTeamsMissedCallRehearsalRequest(branch),
      lifecycle,
    );

    expect(result.status).toBe("refused");
    expect(result.failure).toBe(expected);
    expect(result.binding).toBeNull();
    expect(result.fakeRun).toBeNull();
    expect(result.receipt).toBeNull();
    expect(result.envelope).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects valid fake output from the wrong branch", async () => {
    const other = await createDeterministicTeamsMissedCallFakeLifecycle()
      .execute("native-retained");
    const execute = vi.fn(async () => structuredClone(other));
    const result = await runTeamsMissedCallRehearsal(
      canonicalTeamsMissedCallRehearsalRequest("reported-retained"),
      { execute },
    );

    expect(result.failure).toBe("FAKE_OUTCOME_MISMATCH");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["userId", ["12345678", "1234", "1234", "1234", "123456789abc"].join("-")],
    ["upn", ["learner", "example.invalid"].join("@")],
    ["timestamp", ["2026-07-29", "12:00:00Z"].join("T")],
    ["duration", 12],
    ["marker", ["teams", "missed-call-controlled-hidden"].join("-")],
    ["screenshot", "encoded-image"],
    ["clientState", "signed-in"],
    ["token", ["Bearer", "hidden-value"].join(" ")],
    ["path", ["", "home", "operator", "evidence"].join("/")],
    ["payload", { arbitrary: "upstream" }],
    ["text", "arbitrary observation"],
  ])("rejects unsafe fake field %s before output", async (key, raw) => {
    const { lifecycle } = await mutatedLifecycle("stage-only", (value) => {
      value[key] = raw;
    });
    const result = await runTeamsMissedCallRehearsal(
      canonicalTeamsMissedCallRehearsalRequest(),
      lifecycle,
    );
    expect(result.failure).toBe("FAKE_UNSAFE_INPUT");
    expect(JSON.stringify(result)).not.toContain(String(raw));
  });

  it.each([
    {},
    {
      schemaVersion: 1,
      label: "LIVE",
      scenarioId: "teams-missed-call-observation",
      syntheticBranch: "stage-only",
    },
    {
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      scenarioId: "private-document-evidence",
      syntheticBranch: "stage-only",
    },
    {
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      scenarioId: "teams-missed-call-observation",
      syntheticBranch: "live",
    },
    {
      ...canonicalTeamsMissedCallRehearsalRequest(),
      rawIdentifier: "forbidden",
    },
  ])("rejects noncanonical request %# without executing", async (request) => {
    const execute = vi.fn();
    const result = await runTeamsMissedCallRehearsal(request, { execute });
    expect(result).toMatchObject({
      status: "refused",
      failure: "INPUT_SCHEMA",
      binding: null,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses cross-family verification", async () => {
    const teams = await runTeamsMissedCallRehearsal(
      canonicalTeamsMissedCallRehearsalRequest(),
      createDeterministicTeamsMissedCallFakeLifecycle(),
    );
    expect(() => verifyAvdThreeVmRehearsalOutput(teams)).toThrow(
      RehearsalOutputVerificationError,
    );
    expect(() => verifyPrivateDocumentRehearsalOutput(teams)).toThrow(
      PrivateDocumentRehearsalVerificationError,
    );
  });

  it("runs the bounded canonical-input CLI with safe deterministic output", () => {
    const first = execFileSync(
      process.execPath,
      [CLI, CLI_FIXTURE],
      { encoding: "utf8" },
    );
    const second = execFileSync(
      process.execPath,
      [CLI, CLI_FIXTURE],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(first);

    expect(first).toBe(second);
    expect(parsed).toMatchObject({
      label: "REHEARSAL_ONLY",
      status: "completed",
      binding: { syntheticBranch: "stage-only" },
      envelope: {
        externalEvidence: "all-uninspected",
      },
    });
    expect(first).not.toMatch(
      /@|Bearer|eyJ|-----BEGIN|teams-missed-call-controlled-/,
    );
    expect(first).not.toContain(CLI_FIXTURE);
  });

  it("refuses malformed or noncanonical CLI input with bounded stderr", () => {
    const malformed = spawnSync(
      process.execPath,
      [CLI, CLI],
      { encoding: "utf8" },
    );
    expect(malformed.status).toBe(2);
    expect(malformed.stdout).toBe("");
    expect(JSON.parse(malformed.stderr)).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      status: "refused",
      failure: "NON_CANONICAL_JSON",
    });

    const extraArgument = spawnSync(
      process.execPath,
      [CLI, CLI_FIXTURE, CLI_FIXTURE],
      { encoding: "utf8" },
    );
    expect(extraArgument.status).toBe(2);
    expect(JSON.parse(extraArgument.stderr)).toMatchObject({
      status: "refused",
      failure: "INPUT_SCHEMA",
    });

    const schemaRejected = spawnSync(
      process.execPath,
      [
        CLI,
        resolve("scripts/fixtures/oauth-application-recon-rehearsal.json"),
      ],
      { encoding: "utf8" },
    );
    expect(schemaRejected.status).toBe(2);
    expect(schemaRejected.stdout).toBe("");
    expect(JSON.parse(schemaRejected.stderr)).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      status: "refused",
      failure: "INPUT_SCHEMA",
    });
  });

  it("source has no call, network, retry, or persistence implementation", () => {
    const source = readFileSync(
      resolve("scripts/teams-missed-call-rehearsal.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry\b/i);
    expect(source).not.toMatch(/cloudCommunications|sendMail|startCall/i);
  });
});
