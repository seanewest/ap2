import { describe, expect, it } from "vitest";
import { verifyCanonicalScenarioEvidenceReceipt } from "./scenario-evidence-verification.ts";
import {
  adaptOauthApplicationReconToReceipt,
  canonicalOauthApplicationReconReceiptAdapterInput,
  OauthReconReceiptAdapterError,
  type OauthApplicationReconReceiptAdapterInput,
} from "./oauth-application-recon-receipt-adapter.ts";

function input(): OauthApplicationReconReceiptAdapterInput {
  return structuredClone(canonicalOauthApplicationReconReceiptAdapterInput());
}

function detectorObserved(): NonNullable<
  OauthApplicationReconReceiptAdapterInput["detector"]
> {
  return {
    state: "observed",
    observerRole: "detector",
    workloadRole: "workloadActor",
    operation: "observe-bounded-sign-in",
    event: "successful-service-principal-sign-in",
    match: "exact-workload-token-event",
    freshness: "current-bounded-window",
    collection: "complete-within-bound",
    attribution: "token-event-only",
  };
}

function learnerVisible(): NonNullable<
  OauthApplicationReconReceiptAdapterInput["learner"]
> {
  return {
    state: "visible",
    observerRole: "learner",
    operation: "interpret-recon-summary",
    artifact: "application-recon-summary",
    visibility: "observed",
    interpretation: "not-claimed",
  };
}

function cleanupRestored(): NonNullable<
  OauthApplicationReconReceiptAdapterInput["cleanup"]
> {
  return {
    state: "restored",
    observerRole: "cleanupOwner",
    operation: "close-evidence-window",
    permissionState: "restored-to-retained-baseline",
    temporaryGrants: "absent-with-fresh-token",
    collection: "complete-within-bound",
  };
}

function claim(
  receipt: ReturnType<typeof adaptOauthApplicationReconToReceipt>,
  id: string,
) {
  return receipt.claims.find((candidate) => candidate.id === id);
}

function expectCode(value: unknown, code: string): void {
  try {
    adaptOauthApplicationReconToReceipt(value);
    throw new Error("expected adapter rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(OauthReconReceiptAdapterError);
    expect((error as OauthReconReceiptAdapterError).code).toBe(code);
  }
}

describe("OAuth application reconnaissance receipt adapter", () => {
  it("proves only the exact four-step reachability operation", () => {
    const receipt = adaptOauthApplicationReconToReceipt(input());
    const verified = verifyCanonicalScenarioEvidenceReceipt(receipt);

    expect(claim(receipt, "operation-run-bounded-recon-reads")).toMatchObject({
      state: "proven",
      observation: {
        source: "provider-response",
        outcome: "operation-result",
        observerActorId: "recon-workload-app",
      },
    });
    expect(claim(receipt, "artifact-application-recon-summary")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "detector-independent")?.state).toBe("uninspected");
    expect(
      claim(receipt, "terminal-application-reconnaissance")?.state,
    ).toBe("uninspected");
    expect(verified.missingCoverage).toContain(
      "artifact-application-recon-summary",
    );
    expect(JSON.stringify(receipt)).not.toMatch(
      /(?:count|timestamp|correlation|https?:|@|eyJ|Bearer)/i,
    );
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("requires the separately attributed detector event before promotion", () => {
    const candidate = input();
    candidate.detector = detectorObserved();
    const receipt = adaptOauthApplicationReconToReceipt(candidate);
    const verified = verifyCanonicalScenarioEvidenceReceipt(receipt);

    for (const id of [
      "operation-observe-bounded-sign-in",
      "artifact-application-recon-summary",
      "detector-independent",
      "producer-attribution",
      "terminal-application-reconnaissance",
    ]) {
      expect(claim(receipt, id)?.state).toBe("proven");
    }
    expect(
      claim(receipt, "producer-attribution")?.observation,
    ).toMatchObject({
      source: "independent-detector",
      observerActorId: "audit-observer-app",
      operationKey: "observe-bounded-sign-in",
      outcome: "record-match",
    });
    expect(verified.missingCoverage).not.toContain("detector-independent");
  });

  it("accepts a separate learner visibility observation without interpretation", () => {
    const candidate = input();
    candidate.learner = learnerVisible();
    const receipt = adaptOauthApplicationReconToReceipt(candidate);

    expect(claim(receipt, "operation-interpret-recon-summary")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "visibility-application-recon-summary")?.state).toBe(
      "proven",
    );
    expect(claim(receipt, "learner-interpretation")?.state).toBe(
      "uninspected",
    );
    expect(
      claim(receipt, "response-report-recon-interpretation")?.state,
    ).toBe("uninspected");
  });

  it("accepts fresh-token restoration to the retained baseline without cleanup overclaim", () => {
    const candidate = input();
    candidate.cleanup = cleanupRestored();
    const receipt = adaptOauthApplicationReconToReceipt(candidate);

    expect(claim(receipt, "operation-close-evidence-window")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "cleanup-close-evidence-window")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "retention-application-recon-summary")?.state).toBe(
      "uninspected",
    );
    expect(() => verifyCanonicalScenarioEvidenceReceipt(receipt)).not.toThrow();
  });

  it.each([
    {
      name: "wrong scenario",
      code: "scenario-mismatch",
      mutate: (value: Record<string, unknown>) => {
        value.scenarioId = "help-desk-email-observation";
      },
    },
    {
      name: "wrong result actor",
      code: "actor-mismatch",
      mutate: (value: Record<string, unknown>) => {
        (value.result as Record<string, unknown>).actorRole = "detector";
      },
    },
    {
      name: "missing read",
      code: "sequence",
      mutate: (value: Record<string, unknown>) => {
        (value.journal as unknown[]).pop();
      },
    },
    {
      name: "reordered reads",
      code: "sequence",
      mutate: (value: Record<string, unknown>) => {
        const journal = value.journal as unknown[];
        [journal[0], journal[1]] = [journal[1], journal[0]];
      },
    },
    {
      name: "duplicated read",
      code: "sequence",
      mutate: (value: Record<string, unknown>) => {
        const journal = value.journal as unknown[];
        journal[1] = structuredClone(journal[0]);
      },
    },
    {
      name: "incomplete result",
      code: "workload-mismatch",
      mutate: (value: Record<string, unknown>) => {
        (value.result as Record<string, unknown>).completedSteps = "three";
      },
    },
    {
      name: "read refusal",
      code: "workload-mismatch",
      mutate: (value: Record<string, unknown>) => {
        (value.journal as Record<string, unknown>[])[2]!.outcome = "refused";
      },
    },
    {
      name: "truncated workload collection",
      code: "pagination-uncertain",
      mutate: (value: Record<string, unknown>) => {
        (value.journal as Record<string, unknown>[])[0]!.collection =
          "truncated";
      },
    },
    {
      name: "workload content overclaim",
      code: "semantic-overclaim",
      mutate: (value: Record<string, unknown>) => {
        (value.result as Record<string, unknown>).evidenceBoundary =
          "tenant-contents";
      },
    },
    {
      name: "same-actor detector",
      code: "actor-mismatch",
      mutate: (value: Record<string, unknown>) => {
        value.detector = {
          ...detectorObserved(),
          observerRole: "workloadActor",
        };
      },
    },
    {
      name: "stale detector event",
      code: "stale-observation",
      mutate: (value: Record<string, unknown>) => {
        value.detector = { ...detectorObserved(), freshness: "stale" };
      },
    },
    {
      name: "ambiguous detector event",
      code: "stale-observation",
      mutate: (value: Record<string, unknown>) => {
        value.detector = { ...detectorObserved(), state: "ambiguous" };
      },
    },
    {
      name: "truncated detector collection",
      code: "pagination-uncertain",
      mutate: (value: Record<string, unknown>) => {
        value.detector = {
          ...detectorObserved(),
          collection: "truncated",
        };
      },
    },
    {
      name: "detector attribution overclaim",
      code: "detector-mismatch",
      mutate: (value: Record<string, unknown>) => {
        value.detector = {
          ...detectorObserved(),
          attribution: "four-reads-proven",
        };
      },
    },
    {
      name: "learner actor conflation",
      code: "actor-mismatch",
      mutate: (value: Record<string, unknown>) => {
        value.learner = {
          ...learnerVisible(),
          observerRole: "workloadActor",
        };
      },
    },
    {
      name: "learner interpretation overclaim",
      code: "learner-overclaim",
      mutate: (value: Record<string, unknown>) => {
        value.learner = {
          ...learnerVisible(),
          interpretation: "completed",
        };
      },
    },
    {
      name: "cleanup without fresh-token absence",
      code: "cleanup-gap",
      mutate: (value: Record<string, unknown>) => {
        value.cleanup = {
          ...cleanupRestored(),
          temporaryGrants: "unknown",
        };
      },
    },
    {
      name: "permission revocation overclaim",
      code: "semantic-overclaim",
      mutate: (value: Record<string, unknown>) => {
        value.cleanup = {
          ...cleanupRestored(),
          permissionState: "revoked",
        };
      },
    },
    {
      name: "unknown input field",
      code: "shape",
      mutate: (value: Record<string, unknown>) => {
        value.note = "anything";
      },
    },
  ])("rejects $name", ({ code, mutate }) => {
    const candidate = structuredClone(input()) as unknown as Record<
      string,
      unknown
    >;
    mutate(candidate);
    expectCode(candidate, code);
  });

  it.each([
    ["raw identifier", { objectId: "11111111-1111-4111-8111-111111111111" }],
    ["UPN", { observer: "person@example.test" }],
    ["URL", { source: "https://example.test/raw" }],
    ["timestamp", { time: "2026-07-29T00:00:00.000Z" }],
    ["private path", { source: "/home/example/private" }],
    ["token-like value", { secret: `Bearer ${"x".repeat(30)}` }],
    ["raw count", { count: 4 }],
  ])("rejects unsafe %s before adaptation", (_name, unsafe) => {
    expectCode({ ...input(), unsafe }, "unsafe-input");
  });

  it("rejects oversized input before adaptation", () => {
    expectCode(
      {
        ...input(),
        unsafe: "x".repeat(6_145),
      },
      "unsafe-input",
    );
  });

  it("rejects structurally deep input before adaptation", () => {
    let nested: Record<string, unknown> = {};
    const unsafe = nested;
    for (let depth = 0; depth < 9; depth += 1) {
      nested.child = {};
      nested = nested.child as Record<string, unknown>;
    }
    expectCode({ ...input(), unsafe }, "unsafe-input");
  });

  it("rejects excessive input value cardinality before adaptation", () => {
    expectCode(
      {
        ...input(),
        unsafe: Array.from({ length: 97 }, () => "safe"),
      },
      "unsafe-input",
    );
  });

  it("is deterministic and does not mutate reduced input", () => {
    const candidate = input();
    candidate.detector = detectorObserved();
    candidate.learner = learnerVisible();
    candidate.cleanup = cleanupRestored();
    const before = structuredClone(candidate);

    expect(adaptOauthApplicationReconToReceipt(candidate)).toEqual(
      adaptOauthApplicationReconToReceipt(candidate),
    );
    expect(candidate).toEqual(before);
  });
});
