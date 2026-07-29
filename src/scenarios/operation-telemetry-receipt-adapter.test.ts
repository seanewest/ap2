// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { OperationTelemetryEvent } from "../../api/operation-telemetry.ts";
import { CANONICAL_RECEIPT_FIXTURES } from "./scenario-evidence-receipt.fixtures.ts";
import {
  EvidenceReceiptError,
  verifyScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import {
  adaptOperationTelemetryToReceiptCandidates,
  TelemetryReceiptAdapterError,
  type TelemetryReceiptAdapterContract,
} from "./operation-telemetry-receipt-adapter.ts";

const HASH = ["m1", "0123456789abcdef01234567"].join("_");
const OTHER_HASH = ["m1", "89abcdef0123456701234567"].join("_");
const helpDeskFixture = CANONICAL_RECEIPT_FIXTURES[0]!;

const createContract: TelemetryReceiptAdapterContract = {
  schemaVersion: 1,
  scenarioId: helpDeskFixture.manifest.id,
  roles: {
    evidenceProducer: helpDeskFixture.manifest.roles.evidenceProducer,
    workloadActor: helpDeskFixture.manifest.roles.workloadActor,
    learner: helpDeskFixture.manifest.roles.learner,
  },
  operations: [
    {
      operationKind: "calendar.create",
      phase: "execution",
      manifestOperationKey: "send-help-desk-email",
      observerRole: "evidenceProducer",
    },
  ],
};

const cancelContract: TelemetryReceiptAdapterContract = {
  ...createContract,
  operations: [
    {
      operationKind: "calendar.cancel",
      phase: "cleanup",
      manifestOperationKey: "delete-help-desk-email",
      observerRole: "evidenceProducer",
    },
  ],
};

function event(
  operationKind: OperationTelemetryEvent["operationKind"],
  phase: OperationTelemetryEvent["phase"],
  outcome: OperationTelemetryEvent["outcome"],
  overrides: Partial<OperationTelemetryEvent> = {},
): OperationTelemetryEvent {
  return {
    schemaVersion: 1,
    markerHash: HASH,
    operationKind,
    phase,
    outcome,
    durationMs: outcome === "started" ? 0 : 7,
    reason: outcome === "started" || outcome === "succeeded"
      ? "none"
      : "upstream-refusal",
    ambiguityState: outcome === "ambiguous" ? "possible-mutation" : "none",
    recoveryState: outcome === "started" ? "not-applicable" : "not-needed",
    ...overrides,
  };
}

function snapshot(
  events: readonly OperationTelemetryEvent[],
  order: "oldest" | "newest" = "oldest",
): unknown {
  return { schemaVersion: 1, order, events };
}

function candidate(
  events: readonly OperationTelemetryEvent[],
  contract = createContract,
) {
  return adaptOperationTelemetryToReceiptCandidates(
    snapshot(events),
    contract,
  );
}

function expectAdapterError(
  action: () => unknown,
  code: TelemetryReceiptAdapterError["code"],
): void {
  try {
    action();
    throw new Error("Expected adapter error.");
  } catch (error) {
    expect(error).toBeInstanceOf(TelemetryReceiptAdapterError);
    expect((error as TelemetryReceiptAdapterError).code).toBe(code);
  }
}

describe("operation telemetry receipt adapter", () => {
  it("maps a coherent completion only to an operation candidate", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "succeeded"),
    ]);

    expect(result.status).toBe("coherent");
    expect(result.candidates[0]).toMatchObject({
      lifecycleOutcome: "completed",
      reasonCategory: "none",
      recoveryCategory: "not-needed",
      claim: {
        category: "operation",
        state: "proven",
        observation: {
          source: "provider-response",
          outcome: "operation-result",
          operationKey: "send-help-desk-email",
        },
      },
    });
    expect(result.missingReceiptCoverage).toEqual([
      "artifact",
      "independent-observation",
      "learner-visibility",
      "learner-interpretation",
      "response",
      "cleanup",
      "retention",
      "terminal-proof",
    ]);
  });

  it("preserves a pre-identity refusal without inventing provider refusal", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "refused", {
        reason: "precondition-refusal",
      }),
    ]);

    expect(result.candidates[0]).toMatchObject({
      lifecycleOutcome: "refused",
      reasonCategory: "precondition-refusal",
      claim: { state: "uninspected" },
    });
    expect(result.issues).toEqual(["non-provider-refusal"]);
    expect(result.candidates[0]?.claim).not.toHaveProperty("observation");
  });

  it("maps a definite upstream refusal to provider refusal", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "refused", {
        reason: "upstream-refusal",
      }),
    ]);

    expect(result.candidates[0]).toMatchObject({
      lifecycleOutcome: "refused",
      claim: {
        state: "refused",
        observation: { outcome: "provider-refusal" },
      },
    });
  });

  it("preserves an ambiguous write as ambiguous", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "ambiguous", {
        reason: "upstream-unavailable",
        ambiguityState: "possible-mutation",
      }),
    ]);

    expect(result.candidates[0]).toMatchObject({
      lifecycleOutcome: "ambiguous",
      reasonCategory: "upstream-unavailable",
      claim: { state: "ambiguous" },
    });
  });

  it("maps reconciled recovery plus completion without proving cleanup absence", () => {
    const result = candidate([
      event("calendar.cancel", "cleanup", "started"),
      event("calendar.cancel", "recovery", "started", {
        recoveryState: "in-progress",
      }),
      event("calendar.cancel", "recovery", "succeeded", {
        recoveryState: "reconciled",
      }),
      event("calendar.cancel", "cleanup", "succeeded", {
        recoveryState: "reconciled",
      }),
    ], cancelContract);

    expect(result.candidates[0]).toMatchObject({
      lifecycleOutcome: "recovered",
      recoveryCategory: "reconciled",
      claim: { category: "operation", state: "proven" },
    });
    expect(result.candidates[0]?.claim.state).not.toBe("absent");
    expect(result.missingReceiptCoverage).toContain("cleanup");
    expect(result.missingReceiptCoverage).toContain("retention");
  });

  it("keeps unresolved recovery ambiguous even when cleanup reports refusal", () => {
    const result = candidate([
      event("calendar.cancel", "cleanup", "started"),
      event("calendar.cancel", "recovery", "started", {
        recoveryState: "in-progress",
      }),
      event("calendar.cancel", "recovery", "ambiguous", {
        reason: "upstream-unavailable",
        ambiguityState: "unresolved",
        recoveryState: "unresolved",
      }),
      event("calendar.cancel", "cleanup", "refused", {
        reason: "upstream-unavailable",
        ambiguityState: "unresolved",
        recoveryState: "unresolved",
      }),
    ], cancelContract);

    expect(result.candidates[0]).toMatchObject({
      lifecycleOutcome: "unresolved",
      recoveryCategory: "unresolved",
      claim: { state: "ambiguous" },
    });
  });

  it("turns missing lifecycle events into uninspected, never absent", () => {
    const result = candidate([]);

    expect(result).toMatchObject({
      status: "incomplete",
      issues: ["missing-events"],
      candidates: [
        {
          lifecycleOutcome: "uninspected",
          claim: { state: "uninspected" },
        },
      ],
    });
  });

  it("distinguishes missing start and missing terminal", () => {
    const missingStart = candidate([
      event("calendar.create", "execution", "succeeded"),
    ]);
    expect(missingStart.issues).toEqual(["missing-start"]);
    expect(missingStart.candidates[0]?.claim.state).toBe("uninspected");

    const missingTerminal = candidate([
      event("calendar.create", "execution", "started"),
    ]);
    expect(missingTerminal.issues).toEqual(["missing-terminal"]);
    expect(missingTerminal.candidates[0]?.claim.state).toBe("uninspected");
  });

  it("fails closed at collector capacity", () => {
    const events = Array.from(
      { length: 64 },
      () => event("calendar.create", "execution", "started"),
    );
    const result = candidate(events);

    expect(result.status).toBe("incomplete");
    expect(result.issues).toContain("capacity-boundary");
    expect(result.candidates[0]?.claim.state).toBe("uninspected");
  });

  it("fails closed on duplicate terminal events", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "succeeded"),
      event("calendar.create", "execution", "refused"),
    ]);

    expect(result.issues).toEqual(["duplicate-terminal"]);
    expect(result.candidates[0]?.claim.state).toBe("uninspected");
  });

  it("fails closed on mixed correlations and conflicting recovery", () => {
    const mixed = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "succeeded", {
        markerHash: OTHER_HASH,
      }),
    ]);
    expect(mixed.issues).toEqual(["mixed-correlation"]);

    const conflict = candidate([
      event("calendar.cancel", "cleanup", "started"),
      event("calendar.cancel", "recovery", "started", {
        recoveryState: "in-progress",
      }),
      event("calendar.cancel", "recovery", "succeeded", {
        recoveryState: "reconciled",
      }),
      event("calendar.cancel", "cleanup", "succeeded", {
        recoveryState: "unresolved",
      }),
    ], cancelContract);
    expect(conflict.issues).toEqual(["conflicting-recovery"]);
    expect(conflict.candidates[0]?.claim.state).toBe("uninspected");
  });

  it("uses declared snapshot ordering and rejects incoherent ordering", () => {
    const newest = adaptOperationTelemetryToReceiptCandidates(
      snapshot([
        event("calendar.create", "execution", "succeeded"),
        event("calendar.create", "execution", "started"),
      ], "newest"),
      createContract,
    );
    expect(newest.candidates[0]?.claim.state).toBe("proven");

    const incoherent = candidate([
      event("calendar.create", "execution", "succeeded"),
      event("calendar.create", "execution", "started"),
    ]);
    expect(incoherent.issues).toEqual(["out-of-order"]);
  });

  it("reports telemetry with no canonical mapping as incomplete", () => {
    const result = candidate([
      event("calendar.cancel", "cleanup", "started"),
      event("calendar.cancel", "cleanup", "succeeded"),
    ]);

    expect(result.issues).toEqual(["missing-events", "unmapped-event"]);
    expect(result.candidates[0]?.claim.state).toBe("uninspected");
  });

  it("rejects unknown operation, phase, and reason categories", () => {
    for (const [field, value] of [
      ["operationKind", "unknown.operation"],
      ["phase", "unknown-phase"],
      ["reason", "raw-error-category"],
    ] as const) {
      const invalid = event("calendar.create", "execution", "refused");
      Object.assign(invalid, { [field]: value });
      expectAdapterError(() => candidate([invalid]), "snapshot");
    }
  });

  it("does not propagate correlation, duration, status, or arbitrary fields", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "refused", {
        reason: "upstream-refusal",
        durationMs: 31,
        upstreamStatus: 429,
      }),
    ]);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(HASH);
    expect(serialized).not.toContain("markerHash");
    expect(serialized).not.toContain("durationMs");
    expect(serialized).not.toContain("upstreamStatus");

    const withRawError = {
      ...event("calendar.create", "execution", "refused"),
      arbitraryError: "private upstream response",
    };
    expectAdapterError(() => candidate([withRawError]), "snapshot");
  });

  it("returns deterministic candidate ordering independent of mapping order", () => {
    const both: TelemetryReceiptAdapterContract = {
      ...createContract,
      operations: [
        cancelContract.operations[0]!,
        createContract.operations[0]!,
      ],
    };
    const events = [
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "succeeded"),
      event("calendar.cancel", "cleanup", "started"),
      event("calendar.cancel", "cleanup", "refused"),
    ];
    const first = adaptOperationTelemetryToReceiptCandidates(
      snapshot(events),
      both,
    );
    const second = adaptOperationTelemetryToReceiptCandidates(
      snapshot([...events].reverse(), "newest"),
      { ...both, operations: [...both.operations].reverse() },
    );

    expect(second).toEqual(first);
    expect(first.candidates.map(({ manifestOperationKey }) =>
      manifestOperationKey
    )).toEqual(["delete-help-desk-email", "send-help-desk-email"]);
  });

  it("rejects cross-operation correlation mixing for one scenario", () => {
    const both: TelemetryReceiptAdapterContract = {
      ...createContract,
      operations: [
        createContract.operations[0]!,
        cancelContract.operations[0]!,
      ],
    };
    const result = adaptOperationTelemetryToReceiptCandidates(
      snapshot([
        event("calendar.create", "execution", "started"),
        event("calendar.create", "execution", "succeeded"),
        event("calendar.cancel", "cleanup", "started", {
          markerHash: OTHER_HASH,
        }),
        event("calendar.cancel", "cleanup", "succeeded", {
          markerHash: OTHER_HASH,
        }),
      ]),
      both,
    );

    expect(result.issues).toEqual(["mixed-correlation"]);
    expect(result.candidates.every(({ claim }) =>
      claim.state === "uninspected"
    )).toBe(true);
  });

  it("composes one candidate with the receipt verifier but cannot complete it", () => {
    const result = candidate([
      event("calendar.create", "execution", "started"),
      event("calendar.create", "execution", "succeeded"),
    ]);
    const receipt = {
      ...structuredClone(helpDeskFixture.receipt),
      claims: helpDeskFixture.receipt.claims.map((claim) =>
        claim.id === "operation-send-help-desk-email"
          ? structuredClone(result.candidates[0]!.claim)
          : structuredClone(claim)
      ),
    };

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, helpDeskFixture.manifest)
    ).not.toThrow();
    expect(result.candidates).toHaveLength(1);
    expect(result.missingReceiptCoverage).toHaveLength(8);

    expect(() =>
      verifyScenarioEvidenceReceipt({
        schemaVersion: 1,
        scenario: {
          id: result.scenarioId,
          manifestSchemaVersion: 2,
        },
        roles: createContract.roles,
        claims: [result.candidates[0]!.claim],
      }, helpDeskFixture.manifest)
    ).toThrow(EvidenceReceiptError);
  });

  it("rejects unsafe mappings, roles, phases, and arbitrary contract fields", () => {
    for (const invalid of [
      { ...createContract, scenarioId: ["learner", "example.invalid"].join("@") },
      {
        ...createContract,
        scenarioId: ["a1234567", "89ab", "4cde", "8fab", "0123456789ab"].join(
          "-",
        ),
      },
      {
        ...createContract,
        scenarioId: ["", "private", "evidence", "receipt"].join("/"),
      },
      {
        ...createContract,
        roles: {
          ...createContract.roles,
          evidenceProducer: createContract.roles.learner,
        },
      },
      {
        ...createContract,
        operations: [{
          ...createContract.operations[0],
          phase: "cleanup",
        }],
      },
      { ...createContract, rawPayload: { unsafe: true } },
    ]) {
      expectAdapterError(
        () =>
          adaptOperationTelemetryToReceiptCandidates(snapshot([]), invalid),
        "contract",
      );
    }
  });
});
