// @vitest-environment node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalOauthApplicationReconReceiptAdapterInput,
} from "../src/scenarios/oauth-application-recon-receipt-adapter.ts";
import {
  HelpDeskEmailRehearsalVerificationError,
  verifyHelpDeskEmailRehearsalOutput,
} from "./verify-help-desk-email-rehearsal-output.ts";
import {
  canonicalOauthApplicationReconRehearsalRequest,
  compileOauthApplicationReconRehearsalPlan,
  createDeterministicOauthApplicationReconFakeFourRead,
  runOauthApplicationReconRehearsal,
  type OauthApplicationReconFakeFourRead,
} from "./oauth-application-recon-rehearsal.ts";

const CLI = resolve("scripts/run-oauth-application-recon-rehearsal.ts");
const CLI_FIXTURE = resolve(
  "scripts/fixtures/oauth-application-recon-rehearsal.json",
);

interface MutableFake {
  scenarioId: string;
  result: Record<string, unknown>;
  journal: Array<Record<string, unknown>>;
  detector: Record<string, unknown>;
  learner: Record<string, unknown>;
  cleanup: Record<string, unknown>;
  [key: string]: unknown;
}

async function mutatedFake(
  mutate: (value: MutableFake) => void,
): Promise<{
  fake: OauthApplicationReconFakeFourRead;
  execute: ReturnType<typeof vi.fn>;
}> {
  const value = structuredClone(
    await createDeterministicOauthApplicationReconFakeFourRead().execute(),
  ) as MutableFake;
  mutate(value);
  const execute = vi.fn(async () => structuredClone(value));
  return { fake: { execute }, execute };
}

describe("OAuth application reconnaissance REHEARSAL_ONLY pipeline", () => {
  it("composes the canonical plan, fake four reads, adapter, verifier, and shared envelope deterministically", async () => {
    const request = canonicalOauthApplicationReconRehearsalRequest();
    const first = await runOauthApplicationReconRehearsal(
      request,
      createDeterministicOauthApplicationReconFakeFourRead(),
    );
    const second = await runOauthApplicationReconRehearsal(
      request,
      createDeterministicOauthApplicationReconFakeFourRead(),
    );

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toMatchObject({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      status: "completed",
      failure: null,
      binding: {
        scenarioId: "oauth-application-reconnaissance",
        manifestSchemaVersion: 2,
        planDigestSha256:
          compileOauthApplicationReconRehearsalPlan().digestSha256,
      },
      stages: {
        plan: "compiled",
        fakeFourRead: "completed",
        adapter: "accepted",
        fakeBinding: "accepted",
        receiptVerifier: "accepted",
        envelope: "accepted",
      },
      fakeRun: {
        terminalState: "synthetic-four-read-completed",
        orderedReads: [
          "synthetic-directory-memberships-reachable",
          "synthetic-mailbox-folders-reachable",
          "synthetic-personal-drive-root-reachable",
          "synthetic-shared-drive-root-reachable",
        ],
        collectionBoundary: "synthetic-complete-within-bound",
        evidenceBoundary: "synthetic-reachability-only",
        detector: "synthetic-uninspected",
        learner: "synthetic-uninspected",
        permissionRestoration: "synthetic-uninspected",
        cleanup: "synthetic-uninspected",
      },
      receipt: {
        adapterCandidateAccepted: true,
        verifierAccepted: true,
        candidateClaimCount: 13,
        syntheticReachability: "synthetic-four-read-reachability-only",
        allOtherClaims: "uninspected",
      },
      envelope: {
        terminalState: "terminal-complete",
        observationSource: "synthetic-only",
        externalEvidence: "all-uninspected",
      },
    });
    expect(first.binding?.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.binding?.fakeResultDigestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps every external claim uninspected and exposes only bounded synthetic categories", async () => {
    const result = await runOauthApplicationReconRehearsal(
      canonicalOauthApplicationReconRehearsalRequest(),
      createDeterministicOauthApplicationReconFakeFourRead(),
    );

    expect(Object.keys(result.envelope?.claims ?? {})).toHaveLength(13);
    expect(
      Object.values(result.envelope?.claims ?? {}).every(
        (value) => value === "uninspected",
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /@|https?:|Bearer|eyJ|-----BEGIN|onmicrosoft|tenantId|objectId|messageId/i,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:detectorAttribution|learnerVisibility|learnerInterpretation|permissionRestoration|evidenceWindowClosure|cleanup|retention|revocation)":"(?:proven|observed|restored|completed)"/,
    );
  });

  it("executes the injected fake exactly once and never retries a refusal", async () => {
    const execute = vi.fn(async () => {
      throw new Error("synthetic refusal");
    });
    const result = await runOauthApplicationReconRehearsal(
      canonicalOauthApplicationReconRehearsalRequest(),
      { execute },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "refused",
      failure: "FAKE_NONTERMINAL",
      stages: {
        plan: "compiled",
        fakeFourRead: "refused",
        adapter: "not-run",
        fakeBinding: "not-run",
        receiptVerifier: "not-run",
        envelope: "not-run",
      },
    });
  });

  it("runs with network access disabled", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network forbidden");
    });
    try {
      const result = await runOauthApplicationReconRehearsal(
        canonicalOauthApplicationReconRehearsalRequest(),
        createDeterministicOauthApplicationReconFakeFourRead(),
      );
      expect(result.status).toBe("completed");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    {
      name: "missing read",
      failure: "FAKE_SEQUENCE",
      mutate: (value: MutableFake) => value.journal.pop(),
    },
    {
      name: "reordered reads",
      failure: "FAKE_SEQUENCE",
      mutate: (value: MutableFake) => {
        [value.journal[0], value.journal[1]] = [
          value.journal[1]!,
          value.journal[0]!,
        ];
      },
    },
    {
      name: "duplicate read",
      failure: "FAKE_SEQUENCE",
      mutate: (value: MutableFake) => {
        value.journal[1] = structuredClone(value.journal[0]!);
      },
    },
    {
      name: "malformed collection bound",
      failure: "FAKE_PAGINATION_UNCERTAIN",
      mutate: (value: MutableFake) => {
        value.journal[0]!.collection = "truncated";
      },
    },
    {
      name: "read overclaim",
      failure: "FAKE_EXTERNAL_OVERCLAIM",
      mutate: (value: MutableFake) => {
        value.result.evidenceBoundary = "tenant-contents";
      },
    },
    {
      name: "wrong workload actor",
      failure: "FAKE_ACTOR_MISMATCH",
      mutate: (value: MutableFake) => {
        value.result.actorRole = "detector";
      },
    },
    {
      name: "cross-family scenario",
      failure: "FAKE_SCENARIO_MISMATCH",
      mutate: (value: MutableFake) => {
        value.scenarioId = "help-desk-email-observation";
      },
    },
  ])("fails closed on $name", async ({ failure, mutate }) => {
    const { fake, execute } = await mutatedFake(mutate);
    const result = await runOauthApplicationReconRehearsal(
      canonicalOauthApplicationReconRehearsalRequest(),
      fake,
    );

    expect(result.status).toBe("refused");
    expect(result.failure).toBe(failure);
    expect(result.binding).toBeNull();
    expect(result.fakeRun).toBeNull();
    expect(result.receipt).toBeNull();
    expect(result.envelope).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["detector", {
      state: "observed",
      observerRole: "detector",
      workloadRole: "workloadActor",
      operation: "observe-bounded-sign-in",
      event: "successful-service-principal-sign-in",
      match: "exact-workload-token-event",
      freshness: "current-bounded-window",
      collection: "complete-within-bound",
      attribution: "token-event-only",
      identityBinding: {
        contract: "distinct-application-identity/v1",
        planDigestSha256: "a".repeat(64),
        bindingDigestSha256: "b".repeat(64),
      },
    }],
    ["learner", {
      state: "visible",
      observerRole: "learner",
      operation: "interpret-recon-summary",
      artifact: "application-recon-summary",
      visibility: "observed",
      interpretation: "not-claimed",
    }],
    ["cleanup", {
      state: "restored",
      observerRole: "cleanupOwner",
      operation: "close-evidence-window",
      permissionState: "restored-to-retained-baseline",
      temporaryGrants: "absent-with-fresh-token",
      collection: "complete-within-bound",
    }],
  ] as const)(
    "rejects a synthetic %s promotion instead of treating it as external proof",
    async (key, observation) => {
      const { fake } = await mutatedFake((value) => {
        value[key] = structuredClone(observation);
      });
      const result = await runOauthApplicationReconRehearsal(
        canonicalOauthApplicationReconRehearsalRequest(),
        fake,
      );
      expect(result.failure).toBe("FAKE_EXTERNAL_OVERCLAIM");
      expect(result.envelope).toBeNull();
    },
  );

  it.each([
    ["ambiguous", "FAKE_AMBIGUOUS"],
    ["failed", "FAKE_NONTERMINAL"],
    ["incomplete", "FAKE_NONTERMINAL"],
    ["unknown", "FAKE_NONTERMINAL"],
  ] as const)("rejects %s fake terminal state", async (outcome, failure) => {
    const { fake, execute } = await mutatedFake((value) => {
      value.result.outcome = outcome;
    });
    const result = await runOauthApplicationReconRehearsal(
      canonicalOauthApplicationReconRehearsalRequest(),
      fake,
    );
    expect(result.failure).toBe(failure);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["raw GUID", "objectId", "11111111-1111-4111-8111-111111111111"],
    ["UPN", "observer", "person@example.test"],
    ["URL", "url", "https://example.test/raw"],
    ["token", "token", `Bearer ${"x".repeat(30)}`],
    ["private path", "path", "/home/example/private"],
    ["arbitrary payload", "payload", { arbitrary: "text" }],
  ])("rejects unsafe fake %s without reflecting it", async (
    _name,
    key,
    unsafe,
  ) => {
    const { fake } = await mutatedFake((value) => {
      value[key] = unsafe;
    });
    const result = await runOauthApplicationReconRehearsal(
      canonicalOauthApplicationReconRehearsalRequest(),
      fake,
    );
    expect(["FAKE_UNSAFE_INPUT", "FAKE_SHAPE"]).toContain(result.failure);
    expect(JSON.stringify(result)).not.toContain(String(unsafe));
  });

  it("rejects plan digest drift before fake execution", async () => {
    const request = canonicalOauthApplicationReconRehearsalRequest();
    request.planDigestSha256 = "0".repeat(64);
    const execute = vi.fn();
    const result = await runOauthApplicationReconRehearsal(request, {
      execute,
    });
    expect(result.failure).toBe("PLAN_BINDING");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {},
    {
      schemaVersion: 1,
      label: "LIVE",
      scenarioId: "oauth-application-reconnaissance",
      planDigestSha256: "0".repeat(64),
    },
    {
      ...canonicalOauthApplicationReconRehearsalRequest(),
      scenarioId: "teams-missed-call-observation",
    },
    {
      ...canonicalOauthApplicationReconRehearsalRequest(),
      planDigestSha256: "malformed",
    },
    {
      ...canonicalOauthApplicationReconRehearsalRequest(),
      extra: "unknown",
    },
  ])("rejects noncanonical request %# without executing", async (request) => {
    const execute = vi.fn();
    const result = await runOauthApplicationReconRehearsal(request, {
      execute,
    });
    expect(result.failure).toBe("INPUT_SCHEMA");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects oversized and unsafe requests before executing", async () => {
    for (const request of [
      {
        ...canonicalOauthApplicationReconRehearsalRequest(),
        extra: "x".repeat(4_097),
      },
      {
        ...canonicalOauthApplicationReconRehearsalRequest(),
        observer: "person@example.test",
      },
    ]) {
      const execute = vi.fn();
      const result = await runOauthApplicationReconRehearsal(request, {
        execute,
      });
      expect(["INPUT_SCHEMA", "INPUT_UNSAFE"]).toContain(result.failure);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("cannot be substituted into a different scenario-family verifier", async () => {
    const result = await runOauthApplicationReconRehearsal(
      canonicalOauthApplicationReconRehearsalRequest(),
      createDeterministicOauthApplicationReconFakeFourRead(),
    );
    expect(() => verifyHelpDeskEmailRehearsalOutput(result)).toThrow(
      HelpDeskEmailRehearsalVerificationError,
    );
  });

  it("runs the bounded canonical-input CLI with deterministic safe output", () => {
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
      envelope: {
        observationSource: "synthetic-only",
        externalEvidence: "all-uninspected",
      },
    });
    expect(first).not.toContain(CLI_FIXTURE);
    expect(first).not.toMatch(
      /@|Bearer|eyJ|-----BEGIN|onmicrosoft|ap2-application-recon-window/,
    );
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

  it("the deterministic fake is exactly the PR #108 uninspected input", async () => {
    expect(
      await createDeterministicOauthApplicationReconFakeFourRead().execute(),
    ).toEqual(canonicalOauthApplicationReconReceiptAdapterInput());
  });

  it("source contains no OAuth, Graph, network, retry, or persistence implementation", () => {
    const source = readFileSync(
      resolve("scripts/oauth-application-recon-rehearsal.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry\b/i);
    expect(source).not.toMatch(/graph\.microsoft|acquireToken|clientSecret/i);
  });
});
