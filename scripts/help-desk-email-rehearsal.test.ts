// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalHelpDeskEmailPlanningRequest,
  canonicalHelpDeskEmailRehearsalRequest,
  compileHelpDeskEmailRehearsalPlan,
  createDeterministicHelpDeskEmailFakeLifecycle,
  runHelpDeskEmailRehearsal,
  type HelpDeskEmailFakeLifecycle,
  type HelpDeskEmailSyntheticBranch,
} from "./help-desk-email-rehearsal.ts";

const CLI = resolve("scripts/run-help-desk-email-rehearsal.ts");
const FIXTURES = [
  {
    branch: "send-accepted",
    input: resolve(
      "scripts/fixtures/help-desk-email-rehearsal-send.json",
    ),
    output: resolve(
      "scripts/fixtures/help-desk-email-rehearsal-output-send.json",
    ),
    visibility: "synthetic-uninspected",
    retention: "synthetic-uninspected",
    cleanup: "synthetic-uninspected",
  },
  {
    branch: "learner-observed-retained",
    input: resolve(
      "scripts/fixtures/help-desk-email-rehearsal-retained.json",
    ),
    output: resolve(
      "scripts/fixtures/help-desk-email-rehearsal-output-retained.json",
    ),
    visibility: "synthetic-observed",
    retention: "synthetic-retained",
    cleanup: "synthetic-uninspected",
  },
  {
    branch: "learner-observed-cleaned",
    input: resolve(
      "scripts/fixtures/help-desk-email-rehearsal-cleaned.json",
    ),
    output: resolve(
      "scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json",
    ),
    visibility: "synthetic-observed",
    retention: "synthetic-absent",
    cleanup: "synthetic-cleaned",
  },
] as const;

describe("help-desk email REHEARSAL_ONLY pipeline", () => {
  it.each(FIXTURES)(
    "composes the $branch branch deterministically",
    async ({ branch, input, output, visibility, retention, cleanup }) => {
      const request: unknown = JSON.parse(readFileSync(input, "utf8"));
      const first = await runHelpDeskEmailRehearsal(
        request,
        createDeterministicHelpDeskEmailFakeLifecycle(),
      );
      const second = await runHelpDeskEmailRehearsal(
        request,
        createDeterministicHelpDeskEmailFakeLifecycle(),
      );

      expect(first).toEqual(second);
      expect(Object.isFrozen(first)).toBe(true);
      expect(first).toMatchObject({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY",
        status: "completed",
        failure: null,
        binding: {
          scenarioId: "help-desk-email-observation",
          manifestSchemaVersion: 2,
          syntheticBranch: branch,
          planDigestSha256:
            compileHelpDeskEmailRehearsalPlan().digestSha256,
        },
        stages: {
          plan: "compiled",
          fakeOperation: "completed",
          adapter: "accepted",
          fakeBinding: "accepted",
          receiptVerifier: "accepted",
          envelope: "accepted",
        },
        envelope: {
          terminalState: "terminal-complete",
          observationSource: "synthetic-only",
          externalEvidence: "all-uninspected",
        },
        fakeRun: {
          operationAttempts: 1,
          journalEntries: 2,
          send: "synthetic-accepted",
          learnerVisibility: visibility,
          learnerInterpretation: "synthetic-uninspected",
          retention,
          cleanup,
          auditOrDetection: "synthetic-uninspected",
          teamsCall: "synthetic-uninspected",
          voicemail: "synthetic-uninspected",
          terminalState: `synthetic-${branch}`,
        },
        receipt: {
          adapterCandidateAccepted: true,
          verifierAccepted: true,
          candidateClaimCount: 15,
        },
      });
      expect(first.binding?.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(first.binding?.fakeRunDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(`${JSON.stringify(first, null, 2)}\n`).toBe(
        readFileSync(output, "utf8"),
      );
    },
  );

  it("compiles the canonical zero-cost plan without selecting interpretation", () => {
    const request = canonicalHelpDeskEmailPlanningRequest();
    const plan = compileHelpDeskEmailRehearsalPlan();

    expect(request).toMatchObject({
      scenarioId: "help-desk-email-observation",
      maximumBudgetUsd: 0,
    });
    expect(plan.selectedResponseId).toBeNull();
    expect(plan.budget).toEqual({
      currency: "USD",
      plannedMaximum: 0,
      suppliedCeiling: 0,
    });
    expect(plan.terminalProof).toMatchObject({
      cleanupOperationKeys: ["delete-retained-help-desk-email"],
      evidenceArtifactIds: ["cory-help-desk-email"],
      requiredResult: "reconciled",
    });
  });

  it("keeps every external claim uninspected in every synthetic branch", async () => {
    for (const { branch } of FIXTURES) {
      const result = await runHelpDeskEmailRehearsal(
        canonicalHelpDeskEmailRehearsalRequest(branch),
        createDeterministicHelpDeskEmailFakeLifecycle(),
      );
      expect(result.receipt?.externalEvidence).toEqual({
        emailSend: "uninspected",
        inboxVisibility: "uninspected",
        learnerInterpretation: "uninspected",
        response: "uninspected",
        cleanup: "uninspected",
        retention: "uninspected",
        auditOrDetection: "uninspected",
        teamsCall: "uninspected",
        voicemail: "uninspected",
      });
      expect(result.fakeRun?.learnerInterpretation).toBe(
        "synthetic-uninspected",
      );
    }
  });

  it("runs with network access disabled and never invokes a real send path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access is forbidden");
    });
    try {
      const result = await runHelpDeskEmailRehearsal(
        canonicalHelpDeskEmailRehearsalRequest(
          "learner-observed-cleaned",
        ),
        createDeterministicHelpDeskEmailFakeLifecycle(),
      );
      expect(result.status).toBe("completed");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("executes an injected fake exactly once and never retries", async () => {
    const execute = vi.fn(async () => {
      throw new Error("synthetic ambiguity");
    });
    const result = await runHelpDeskEmailRehearsal(
      canonicalHelpDeskEmailRehearsalRequest(),
      { execute },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "refused",
      failure: "FAKE_NONTERMINAL",
      binding: null,
      stages: {
        plan: "compiled",
        fakeOperation: "refused",
        adapter: "not-run",
        fakeBinding: "not-run",
        receiptVerifier: "not-run",
        envelope: "not-run",
      },
    });
  });

  it.each([
    {
      name: "ambiguous outcome",
      failure: "FAKE_OUTCOME_MISMATCH",
      mutate: (input: FakeInput) => {
        input.result.outcome = "ambiguous";
      },
    },
    {
      name: "failed outcome",
      failure: "FAKE_OUTCOME_MISMATCH",
      mutate: (input: FakeInput) => {
        input.result.outcome = "failed";
      },
    },
    {
      name: "incomplete outcome",
      failure: "FAKE_OUTCOME_MISMATCH",
      mutate: (input: FakeInput) => {
        input.result.outcome = "incomplete";
      },
    },
    {
      name: "missing journal entry",
      failure: "FAKE_SEQUENCE",
      mutate: (input: FakeInput) => {
        input.journal.pop();
      },
    },
    {
      name: "duplicate journal entry",
      failure: "FAKE_SEQUENCE",
      mutate: (input: FakeInput) => {
        input.journal[1] = structuredClone(input.journal[0]!);
      },
    },
    {
      name: "reordered journal",
      failure: "FAKE_SEQUENCE",
      mutate: (input: FakeInput) => {
        input.journal.reverse();
      },
    },
    {
      name: "mismatched scenario",
      failure: "FAKE_OUTCOME_MISMATCH",
      mutate: (input: FakeInput) => {
        input.scenarioId = "private-document-evidence";
      },
    },
    {
      name: "producer visibility",
      failure: "FAKE_OUTCOME_MISMATCH",
      mutate: (input: FakeInput) => {
        input.learner.artifact.observerRole = "evidenceProducer";
      },
    },
    {
      name: "unsupported interpretation",
      failure: "EVIDENCE_OVERCLAIM",
      mutate: (input: FakeInput) => {
        input.learner.interpretation = {
          state: "observed",
          observerRole: "learner",
          operation: "interpret-help-desk-email",
          responseAction: "report-help-desk-interpretation",
        };
      },
    },
    {
      name: "cleanup terminal mismatch",
      failure: "CLEANUP_GAP",
      mutate: (input: FakeInput) => {
        input.cleanup.terminalOperation =
          "delete-retained-help-desk-email";
      },
    },
    {
      name: "Teams conflation",
      failure: "ADAPTER_REFUSED",
      mutate: (input: FakeInput) => {
        input.learner.teamsCall = "observed";
      },
    },
    {
      name: "voicemail conflation",
      failure: "ADAPTER_REFUSED",
      mutate: (input: FakeInput) => {
        input.cleanup.voicemail = "absent";
      },
    },
    {
      name: "raw sender",
      failure: "FAKE_UNSAFE_INPUT",
      mutate: (input: FakeInput) => {
        input.sender = ["learner", "example.invalid"].join("@");
      },
    },
    {
      name: "raw message marker",
      failure: "FAKE_UNSAFE_INPUT",
      mutate: (input: FakeInput) => {
        input.marker = ["ap2", "hidden-message-marker"].join("-");
      },
    },
    {
      name: "raw path",
      failure: "FAKE_UNSAFE_INPUT",
      mutate: (input: FakeInput) => {
        input.path = ["", "home", "operator", "mail"].join("/");
      },
    },
    {
      name: "raw token",
      failure: "FAKE_UNSAFE_INPUT",
      mutate: (input: FakeInput) => {
        input.token = ["Bearer", "hidden-value"].join(" ");
      },
    },
  ])("fails closed once on $name", async ({ failure, mutate }) => {
    const { lifecycle, execute } = await mutatedLifecycle(
      "learner-observed-cleaned",
      mutate,
    );
    const result = await runHelpDeskEmailRehearsal(
      canonicalHelpDeskEmailRehearsalRequest(
        "learner-observed-cleaned",
      ),
      lifecycle,
    );

    expect(result.status).toBe("refused");
    expect(result.failure).toBe(failure);
    expect(result.binding).toBeNull();
    expect(result.fakeRun).toBeNull();
    expect(result.receipt).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects valid retained/cleaned fake results under the wrong branch", async () => {
    for (
      const [requested, supplied] of [
        ["learner-observed-retained", "learner-observed-cleaned"],
        ["learner-observed-cleaned", "learner-observed-retained"],
      ] as const
    ) {
      const value = await createDeterministicHelpDeskEmailFakeLifecycle()
        .execute(supplied);
      const execute = vi.fn(async () => structuredClone(value));
      const result = await runHelpDeskEmailRehearsal(
        canonicalHelpDeskEmailRehearsalRequest(requested),
        { execute },
      );
      expect(result.failure).toBe("SYNTHETIC_BRANCH_MISMATCH");
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    {},
    {
      schemaVersion: 1,
      label: "LIVE",
      scenarioId: "help-desk-email-observation",
      syntheticBranch: "send-accepted",
    },
    {
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      scenarioId: "private-document-evidence",
      syntheticBranch: "cleaned-canary",
    },
    {
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      planRequest: {},
      runner: {},
      transport: {},
      terminal: {},
    },
    {
      ...canonicalHelpDeskEmailRehearsalRequest(),
      subject: "arbitrary text",
    },
    {
      ...canonicalHelpDeskEmailRehearsalRequest(),
      sender: ["learner", "example.invalid"].join("@"),
    },
  ])("rejects unsafe or cross-family request %#", async (request) => {
    const execute = vi.fn();
    const result = await runHelpDeskEmailRehearsal(request, { execute });
    expect(result).toMatchObject({
      status: "refused",
      failure: "INPUT_SCHEMA",
      binding: null,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(FIXTURES)(
    "runs the bounded CLI for $branch with canonical safe output",
    ({ input, output }) => {
      const stdout = execFileSync(
        process.execPath,
        [CLI, input],
        { encoding: "utf8" },
      );
      expect(stdout).toBe(readFileSync(output, "utf8"));
      expect(stdout).not.toMatch(
        /@|onmicrosoft|ap2-help-desk-email|Bearer|\/home\/|\\\\|subject|body|messageId|tenantId|userId/,
      );
    },
  );

  it("refuses malformed CLI input with bounded categorical stderr", () => {
    const result = spawnSync(
      process.execPath,
      [CLI, CLI],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      status: "refused",
      failure: "INPUT_SCHEMA",
    });

    const schemaRejected = spawnSync(
      process.execPath,
      [
        CLI,
        resolve("scripts/fixtures/private-document-rehearsal-cleaned.json"),
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
});

interface FakeInput {
  scenarioId: string;
  result: Record<string, unknown>;
  journal: Array<Record<string, unknown>>;
  learner: {
    artifact: Record<string, unknown>;
    interpretation: Record<string, unknown>;
    teamsCall?: string;
  };
  cleanup: Record<string, unknown> & { voicemail?: string };
  [key: string]: unknown;
}

async function mutatedLifecycle(
  branch: HelpDeskEmailSyntheticBranch,
  mutate: (value: FakeInput) => void,
): Promise<{
  lifecycle: HelpDeskEmailFakeLifecycle;
  execute: ReturnType<typeof vi.fn>;
}> {
  const canonical = await createDeterministicHelpDeskEmailFakeLifecycle()
    .execute(branch);
  const value = structuredClone(canonical) as FakeInput;
  mutate(value);
  const execute = vi.fn(async () => structuredClone(value));
  return { lifecycle: { execute }, execute };
}
