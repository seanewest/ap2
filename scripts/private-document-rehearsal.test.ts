import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalPrivateDocumentRehearsalRequest,
  compilePrivateDocumentRehearsalPlan,
  createDeterministicPrivateDocumentFakeLifecycle,
  runPrivateDocumentRehearsal,
  type PrivateDocumentFakeLifecycle,
  type PrivateDocumentSyntheticBranch,
} from "./private-document-rehearsal.ts";

const CLEANED_FIXTURE = resolve(
  "scripts/fixtures/private-document-rehearsal-cleaned.json",
);
const LEARNER_FIXTURE = resolve(
  "scripts/fixtures/private-document-rehearsal-learner.json",
);
const CLEANED_OUTPUT_FIXTURE = resolve(
  "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
);
const LEARNER_OUTPUT_FIXTURE = resolve(
  "scripts/fixtures/private-document-rehearsal-output-learner.json",
);
const CLI = resolve("scripts/run-private-document-rehearsal.ts");

describe("private-document REHEARSAL_ONLY pipeline", () => {
  it.each([
    [
      "cleaned-canary",
      CLEANED_FIXTURE,
      CLEANED_OUTPUT_FIXTURE,
      "blocked-cleanup",
    ],
    [
      "learner-observation",
      LEARNER_FIXTURE,
      LEARNER_OUTPUT_FIXTURE,
      "completed-cleaned",
    ],
  ] as const)(
    "composes and binds the %s branch deterministically",
    async (branch, fixture, outputFixture, lifecycleStatus) => {
      const request: unknown = JSON.parse(readFileSync(fixture, "utf8"));
      const first = await runPrivateDocumentRehearsal(
        request,
        createDeterministicPrivateDocumentFakeLifecycle(),
      );
      const second = await runPrivateDocumentRehearsal(
        request,
        createDeterministicPrivateDocumentFakeLifecycle(),
      );

      expect(first).toEqual(second);
      expect(Object.isFrozen(first)).toBe(true);
      expect(first).toMatchObject({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY",
        status: "completed",
        failure: null,
        binding: {
          scenarioId: "private-document-evidence",
          manifestSchemaVersion: 2,
          syntheticBranch: branch,
          planDigestSha256:
            compilePrivateDocumentRehearsalPlan().digestSha256,
        },
        stages: {
          plan: "compiled",
          fakeLifecycle: "completed",
          adapter: "accepted",
          receiptVerifier: "accepted",
        },
        fakeRun: {
          lifecycleStatus,
          journalEntries: 30,
          freshTerminal: {
            rounds: 3,
            producerFolder: "synthetic-absent",
            producerItem: "synthetic-absent",
            producerPermission: "synthetic-absent",
            learnerAccess: "synthetic-absent",
          },
        },
        receipt: {
          adapterCandidateAccepted: true,
          verifierAccepted: true,
          candidateClaimCount: 18,
        },
      });
      expect(first.binding?.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(first.binding?.fakeRunDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(`${JSON.stringify(first, null, 2)}\n`).toBe(
        readFileSync(outputFixture, "utf8"),
      );
    },
  );

  it("keeps every external claim uninspected in both synthetic branches", async () => {
    for (
      const branch of [
        "cleaned-canary",
        "learner-observation",
      ] as const
    ) {
      const result = await runPrivateDocumentRehearsal(
        canonicalPrivateDocumentRehearsalRequest(branch),
        createDeterministicPrivateDocumentFakeLifecycle(),
      );
      expect(result.receipt?.externalEvidence).toEqual({
        producerStaging: "uninspected",
        learnerVisibility: "uninspected",
        learnerInterpretation: "uninspected",
        auditOrDetection: "uninspected",
        response: "uninspected",
        cleanup: "uninspected",
        retention: "uninspected",
      });
    }
  });

  it("distinguishes synthetic learner exercise from external visibility", async () => {
    const cleaned = await runPrivateDocumentRehearsal(
      canonicalPrivateDocumentRehearsalRequest("cleaned-canary"),
      createDeterministicPrivateDocumentFakeLifecycle(),
    );
    const learner = await runPrivateDocumentRehearsal(
      canonicalPrivateDocumentRehearsalRequest("learner-observation"),
      createDeterministicPrivateDocumentFakeLifecycle(),
    );

    expect(cleaned.fakeRun?.learnerObservation)
      .toBe("synthetic-not-proven");
    expect(learner.fakeRun?.learnerObservation).toBe("synthetic-proven");
    expect(learner.receipt?.externalEvidence.learnerVisibility)
      .toBe("uninspected");
    expect(cleaned.binding?.fakeRunDigestSha256)
      .not.toBe(learner.binding?.fakeRunDigestSha256);
  });

  it("executes the injected fake exactly once and never retries refusal", async () => {
    const execute = vi.fn(async () => {
      throw new Error("synthetic failure");
    });
    const result = await runPrivateDocumentRehearsal(
      canonicalPrivateDocumentRehearsalRequest(),
      { execute },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "refused",
      failure: "LIFECYCLE_NONTERMINAL",
      stages: {
        plan: "compiled",
        fakeLifecycle: "refused",
        adapter: "not-run",
        receiptVerifier: "not-run",
      },
    });
  });

  it("runs with network access disabled", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network access is forbidden");
    });
    try {
      const result = await runPrivateDocumentRehearsal(
        canonicalPrivateDocumentRehearsalRequest(),
        createDeterministicPrivateDocumentFakeLifecycle(),
      );
      expect(result.status).toBe("completed");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    {
      name: "ambiguous mutation",
      expected: "LIFECYCLE_NONTERMINAL",
      mutate: (value: LifecycleRecord) => {
        value.journal[0]!.transition = "ambiguous";
        value.journal[0]!.detail = "requires-exact-read";
      },
    },
    {
      name: "failed mutation",
      expected: "LIFECYCLE_NONTERMINAL",
      mutate: (value: LifecycleRecord) => {
        value.journal[0]!.transition = "failed";
        value.journal[0]!.detail = "definite-failure";
      },
    },
    {
      name: "incomplete result",
      expected: "LIFECYCLE_NONTERMINAL",
      mutate: (value: LifecycleRecord) => {
        value.result.status = "incomplete";
      },
    },
    {
      name: "nonterminal cleaned-after-failure result",
      expected: "LIFECYCLE_NONTERMINAL",
      mutate: (value: LifecycleRecord) => {
        value.result.status = "cleaned-after-failure";
      },
    },
    {
      name: "reordered journal",
      expected: "LIFECYCLE_SEQUENCE",
      mutate: (value: LifecycleRecord) => {
        [value.journal[0], value.journal[1]] = [
          value.journal[1]!,
          value.journal[0]!,
        ];
      },
    },
    {
      name: "duplicated journal event",
      expected: "LIFECYCLE_SEQUENCE",
      mutate: (value: LifecycleRecord) => {
        value.journal[1] = structuredClone(value.journal[0]!);
      },
    },
    {
      name: "mismatched correlation",
      expected: "LIFECYCLE_MARKER_MISMATCH",
      mutate: (value: LifecycleRecord) => {
        value.journal[4]!.correlation = "run-other";
      },
    },
    {
      name: "unsafe correlation",
      expected: "LIFECYCLE_UNSAFE_INPUT",
      mutate: (value: LifecycleRecord) => {
        value.correlation = "unsafe!correlation";
      },
    },
    {
      name: "unknown operation",
      expected: "LIFECYCLE_SHAPE",
      mutate: (value: LifecycleRecord) => {
        value.journal[0]!.operation = "unknown-operation";
      },
    },
    {
      name: "cleanup terminal gap",
      expected: "LIFECYCLE_CLEANUP_GAP",
      mutate: (value: LifecycleRecord) => {
        value.terminal.learnerAccess = "present";
      },
    },
    {
      name: "result claim overreach",
      expected: "LIFECYCLE_OVERCLAIM",
      mutate: (value: LifecycleRecord) => {
        value.result.learnerVisibility = "proven";
      },
    },
    {
      name: "learner observation overreach",
      expected: "LIFECYCLE_OVERCLAIM",
      mutate: (value: LifecycleRecord) => {
        value.journal[9]!.detail = "learner-visible";
      },
    },
  ] as const)(
    "fails closed on $name without retry",
    async ({ expected, mutate }) => {
      const { lifecycle, execute } = await mutatedLifecycle(
        "cleaned-canary",
        mutate,
      );
      const result = await runPrivateDocumentRehearsal(
        canonicalPrivateDocumentRehearsalRequest("cleaned-canary"),
        lifecycle,
      );

      expect(result.status).toBe("refused");
      expect(result.failure).toBe(expected);
      expect(result.binding).toBeNull();
      expect(result.fakeRun).toBeNull();
      expect(result.receipt).toBeNull();
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["permission deletion order", 10, 16],
    ["file deletion order", 16, 22],
    ["folder terminal order", 22, 28],
  ] as const)(
    "rejects reordered %s",
    async (_name, left, right) => {
      const { lifecycle } = await mutatedLifecycle(
        "cleaned-canary",
        (value) => {
          [value.journal[left], value.journal[right]] = [
            value.journal[right]!,
            value.journal[left]!,
          ];
        },
      );
      const result = await runPrivateDocumentRehearsal(
        canonicalPrivateDocumentRehearsalRequest(),
        lifecycle,
      );
      expect(result).toMatchObject({
        status: "refused",
        failure: "LIFECYCLE_SEQUENCE",
      });
    },
  );

  it.each([
    ["producerFolder"],
    ["producerItem"],
    ["producerPermission"],
    ["learnerAccess"],
  ] as const)(
    "requires terminal absence for %s",
    async (field) => {
      const { lifecycle } = await mutatedLifecycle(
        "cleaned-canary",
        (value) => {
          value.terminal[field] = "present";
        },
      );
      const result = await runPrivateDocumentRehearsal(
        canonicalPrivateDocumentRehearsalRequest(),
        lifecycle,
      );
      expect(result.failure).toBe("LIFECYCLE_CLEANUP_GAP");
    },
  );

  it("rejects a valid fake branch that does not match the request", async () => {
    const learnerValue = await createDeterministicPrivateDocumentFakeLifecycle()
      .execute("learner-observation");
    const execute = vi.fn(async () => structuredClone(learnerValue));
    const result = await runPrivateDocumentRehearsal(
      canonicalPrivateDocumentRehearsalRequest("cleaned-canary"),
      { execute },
    );

    expect(result.status).toBe("refused");
    expect(result.failure).toBe("FAKE_OUTCOME_MISMATCH");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    {
      schemaVersion: 1,
      label: "LIVE",
      scenarioId: "private-document-evidence",
      syntheticBranch: "cleaned-canary",
    },
    {
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      scenarioId: "other",
      syntheticBranch: "cleaned-canary",
    },
    {
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      scenarioId: "private-document-evidence",
      syntheticBranch: "live",
    },
    {
      ...canonicalPrivateDocumentRehearsalRequest(),
      rawIdentifier: "forbidden",
    },
  ])("rejects unsafe or noncanonical request %#", async (request) => {
    const execute = vi.fn();
    const result = await runPrivateDocumentRehearsal(request, { execute });
    expect(result).toMatchObject({
      status: "refused",
      failure: "INPUT_SCHEMA",
      binding: null,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [CLEANED_FIXTURE, "blocked-cleanup"],
    [LEARNER_FIXTURE, "completed-cleaned"],
  ] as const)(
    "runs the bounded CLI for %s",
    (fixture, lifecycleStatus) => {
      const stdout = execFileSync(
        process.execPath,
        [CLI, fixture],
        { encoding: "utf8" },
      );
      const result = JSON.parse(stdout) as Record<string, unknown>;
      expect(result).toMatchObject({
        label: "REHEARSAL_ONLY",
        status: "completed",
        fakeRun: { lifecycleStatus },
      });
      expect(stdout).not.toMatch(
        /synthetic-(?:producer|learner|drive|folder|item|permission)/,
      );
      expect(stdout).not.toMatch(
        /ap2doc-|sharepoint\.com|@|journal\.jsonl|authorized-lab-document/,
      );
    },
  );

  it("refuses malformed CLI input with bounded safe stderr", () => {
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
        resolve("scripts/fixtures/help-desk-email-rehearsal-send.json"),
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

interface LifecycleRecord {
  correlation: string;
  result: Record<string, unknown>;
  journal: Array<Record<string, unknown>>;
  terminal: Record<string, unknown>;
}

async function mutatedLifecycle(
  branch: PrivateDocumentSyntheticBranch,
  mutate: (value: LifecycleRecord) => void,
): Promise<{
  lifecycle: PrivateDocumentFakeLifecycle;
  execute: ReturnType<typeof vi.fn>;
}> {
  const canonical = await createDeterministicPrivateDocumentFakeLifecycle()
    .execute(branch);
  const value = structuredClone(canonical) as LifecycleRecord;
  mutate(value);
  const execute = vi.fn(async () => structuredClone(value));
  return { lifecycle: { execute }, execute };
}
