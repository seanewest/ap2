import { describe, expect, it } from "vitest";
import {
  adaptPurviewOperationToReceipt,
  PurviewOperationReceiptAdapterError,
  type PurviewOperationReceiptAdapterInput,
} from "./purview-operation-receipt-adapter.ts";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from "./purview-audit-boundary.ts";
import { verifyScenarioEvidenceReceipt } from "./scenario-evidence-receipt.ts";

describe("Purview operation receipt adapter", () => {
  it("adapts one deduplicated exact operation observation", () => {
    const receipt = adaptPurviewOperationToReceipt(input());
    const verified = verifyScenarioEvidenceReceipt(
      receipt,
      PURVIEW_AUDIT_BOUNDARY_SCENARIO,
    );

    expect(row(verified, "artifact-purview-query-boundary")).toMatchObject({
      state: "proven",
      observationSource: "independent-detector",
      observationOutcome: "record-match",
    });
    expect(row(verified, "producer-attribution")).toMatchObject({
      state: "proven",
      observationSource: "independent-detector",
      observationOutcome: "record-match",
    });
    expect(row(verified, "surface-reachability")?.state).toBe("proven");
    expect(row(verified, "terminal-purview-surface")?.state).toBe("proven");
    expect(receipt.claims.filter(({ id }) =>
      id === "producer-attribution"
    )).toHaveLength(1);
    expect(JSON.stringify(receipt)).not.toContain("FileUploaded");
    expect(JSON.stringify(receipt)).not.toContain("uniqueMatches");
  });

  it("leaves unsupported receipt coverage uninspected", () => {
    const verified = verifyScenarioEvidenceReceipt(
      adaptPurviewOperationToReceipt(input()),
      PURVIEW_AUDIT_BOUNDARY_SCENARIO,
    );

    for (const claimId of [
      "operation-submit-bounded-audit-query",
      "operation-interpret-audit-boundary",
      "operation-close-purview-evidence-window",
      "visibility-purview-query-boundary",
      "learner-interpretation",
      "response-report-purview-boundary",
      "cleanup-close-purview-evidence-window",
      "retention-purview-query-boundary",
    ]) {
      expect(row(verified, claimId)?.state).toBe("uninspected");
    }
  });

  it.each([
    ["surface only", { status: "officially-supported" }, "semantic-overclaim"],
    ["ambiguous", { status: "observed-but-incomplete" }, "semantic-overclaim"],
    ["wrong workload", { workload: "Exchange" }, "observation-mismatch"],
    ["wrong record", { recordType: "servicePrincipalSignIn" }, "observation-mismatch"],
    ["wrong operation", { operation: "FileAccessed" }, "observation-mismatch"],
    ["wrong producer", { producerApplication: "other" }, "observation-mismatch"],
    ["outside window", { occurredAt: "outside-window" }, "observation-mismatch"],
    ["missing marker", { target: "marker-absent" }, "observation-mismatch"],
    ["missing target type", { targetType: "absent" }, "observation-mismatch"],
    ["missing correlation", { correlation: "absent" }, "observation-mismatch"],
    ["not deduplicated", { recordSet: "duplicate-pages" }, "observation-mismatch"],
    ["no match", { uniqueMatches: "none" }, "observation-mismatch"],
  ] as const)("rejects %s", (_name, changed, code) => {
    const candidate = input() as unknown as {
      result: Record<string, unknown>;
    };
    Object.assign(candidate.result, changed);
    expectAdapterError(candidate, code);
  });

  it("rejects cross-scenario, role conflation, raw fields, and missing fields", () => {
    const crossScenario = structuredClone(input()) as unknown as {
      scenario: Record<string, unknown>;
    };
    crossScenario.scenario.id = "private-document-evidence";
    expectAdapterError(crossScenario, "scenario-mismatch");

    const conflated = structuredClone(input()) as unknown as {
      roles: Record<string, unknown>;
    };
    conflated.roles.detector = "sharepoint-workload-app";
    expectAdapterError(conflated, "role-conflation");

    const raw = structuredClone(input()) as unknown as Record<string, unknown>;
    raw.recordId = "raw-value";
    expectAdapterError(raw, "shape");

    const missing = structuredClone(input()) as unknown as {
      result: Record<string, unknown>;
    };
    delete missing.result.correlation;
    expectAdapterError(missing, "shape");
  });

  it("is deterministic across the supported operations", () => {
    for (const operation of [
      "FileUploaded",
      "FileRecycled",
      "FileDeleted",
    ] as const) {
      const candidate = input();
      candidate.result.operation = operation;
      expect(adaptPurviewOperationToReceipt(candidate)).toEqual(
        adaptPurviewOperationToReceipt(structuredClone(candidate)),
      );
    }
  });
});

function input(): PurviewOperationReceiptAdapterInput {
  return {
    schemaVersion: 1,
    scenario: {
      id: "purview-sharepoint-audit-boundary",
      manifestSchemaVersion: 2,
    },
    roles: {
      evidenceProducer: "purview-lab-harness",
      workloadActor: "sharepoint-workload-app",
      learner: "security-learner",
      detector: "purview-detector-app",
    },
    result: {
      status: "live-proven",
      observationSource: "independent-detector",
      workload: "SharePoint",
      recordType: "sharePointFileOperation",
      operation: "FileUploaded",
      producerApplication: "matches-workload-actor",
      occurredAt: "inside-frozen-window",
      target: "marker-bearing",
      targetType: "present",
      correlation: "present",
      recordSet: "bounded-unpaged-deduplicated",
      uniqueMatches: "one-or-more",
    },
  };
}

function row(
  verified: ReturnType<typeof verifyScenarioEvidenceReceipt>,
  claimId: string,
) {
  return verified.claims.find((claim) => claim.claimId === claimId);
}

function expectAdapterError(
  value: unknown,
  code: PurviewOperationReceiptAdapterError["code"],
): void {
  try {
    adaptPurviewOperationToReceipt(value);
    throw new Error("expected adapter refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(PurviewOperationReceiptAdapterError);
    expect((error as PurviewOperationReceiptAdapterError).code).toBe(code);
  }
}
