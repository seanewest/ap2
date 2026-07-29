import { describe, expect, it } from "vitest";
import {
  CANONICAL_RECEIPT_FIXTURES,
  NEGATIVE_RECEIPT_FIXTURES,
} from "./scenario-evidence-receipt.fixtures";
import {
  EvidenceReceiptError,
  formatVerifiedClaimTable,
  readScenarioIdFromEvidenceReceipt,
  verifyScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt";

describe("scenario evidence receipts", () => {
  it.each(CANONICAL_RECEIPT_FIXTURES)(
    "verifies the canonical $name receipt",
    ({ manifest, receipt }) => {
      const verified = verifyScenarioEvidenceReceipt(receipt, manifest);

      expect(verified.scenarioId).toBe(manifest.id);
      expect(verified.roles).toEqual(receipt.roles);
      expect(verified.claims.length).toBe(receipt.claims.length);
    },
  );

  it.each(NEGATIVE_RECEIPT_FIXTURES)(
    "rejects the canonical negative $name receipt",
    ({ manifest, receipt, expectedCode }) => {
      expectReceiptError(
        () => verifyScenarioEvidenceReceipt(receipt, manifest),
        expectedCode,
      );
    },
  );

  it.each([
    [
      "proven",
      "operation-result",
    ],
    [
      "absent",
      "exact-reconciliation",
    ],
    [
      "refused",
      "provider-refusal",
    ],
    [
      "ambiguous",
      "query-empty",
    ],
    [
      "licensing-or-latency-blocked",
      "query-blocked",
    ],
  ] as const)("preserves the terminal %s state", (state, outcome) => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "operation-send-help-desk-email",
    )!;
    claim.state = state;
    claim.observation = {
      source: "provider-response",
      outcome,
      observerActorId: "ap2-orchestrator",
      operationKey: "send-help-desk-email",
    };

    const verified = verifyScenarioEvidenceReceipt(receipt, fixture.manifest);

    expect(
      verified.claims.find((row) =>
        row.claimId === "operation-send-help-desk-email"
      )?.state,
    ).toBe(state);
  });

  it("preserves uninspected without manufacturing an observation", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "operation-send-help-desk-email",
    )!;
    claim.state = "uninspected";
    delete claim.observation;

    const verified = verifyScenarioEvidenceReceipt(receipt, fixture.manifest);
    const row = verified.claims.find((item) =>
      item.claimId === "operation-send-help-desk-email"
    );

    expect(row).toMatchObject({
      state: "uninspected",
      observationSource: "none",
      observationOutcome: "none",
    });
  });

  it("rejects a terminal state without an observation", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "artifact-cory-help-desk-email",
    )!;
    delete claim.observation;

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "missing-observation",
    );
  });

  it("rejects an observation attached to uninspected", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "operation-interpret-help-desk-email",
    )!;
    claim.observation = {
      source: "learner-view",
      outcome: "learner-inspection",
      observerActorId: "cory-learner",
      operationKey: "interpret-help-desk-email",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "state-promotion",
    );
  });

  it("does not infer absence from an empty query", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[4]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "retention-purview-query-boundary",
    )!;
    claim.state = "absent";
    claim.observation = {
      source: "independent-detector",
      outcome: "query-empty",
      observerActorId: "purview-detector-app",
      operationKey: "read-bounded-audit-status",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "state-promotion",
    );
  });

  it("keeps exact Purview producer attribution separate from reachability", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[4]!;
    const verified = verifyScenarioEvidenceReceipt(
      fixture.receipt,
      fixture.manifest,
    );

    expect(
      verified.claims.find((row) => row.claimId === "producer-attribution"),
    ).toMatchObject({
      state: "proven",
      observationSource: "independent-detector",
      observationOutcome: "record-match",
    });
  });

  it("does not infer learner visibility from a blocked query", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[4]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "visibility-purview-query-boundary",
    )!;
    claim.state = "proven";
    claim.observation = {
      source: "learner-view",
      outcome: "query-blocked",
      observerActorId: "security-learner",
      operationKey: "interpret-audit-boundary",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "state-promotion",
    );
  });

  it("rejects missing cleanup coverage", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[2]!;
    const receipt = copy(fixture.receipt);
    receipt.claims = receipt.claims.filter(
      (claim) => claim.category !== "cleanup",
    );

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "cleanup-gap",
    );
  });

  it("rejects cleanup proof inferred from the cleanup mutation", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[2]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "cleanup-clean-retained-call-history",
    )!;
    claim.state = "proven";
    claim.observation = {
      source: "local-reconciliation",
      outcome: "exact-reconciliation",
      observerActorId: "ap2-instructor",
      operationKey: "clean-retained-call-history",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "cleanup-gap",
    );
  });

  it("rejects cleanup absence inferred from the cleanup mutation", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[2]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "cleanup-clean-retained-call-history",
    )!;
    claim.state = "absent";
    claim.observation = {
      source: "local-reconciliation",
      outcome: "exact-reconciliation",
      observerActorId: "ap2-instructor",
      operationKey: "clean-retained-call-history",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "cleanup-gap",
    );
  });

  it("rejects retention proof from a mutating operation", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[2]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "retention-cory-missed-call",
    )!;
    claim.observation = {
      source: "provider-response",
      outcome: "operation-result",
      observerActorId: "ap2-instructor",
      operationKey: "stage-one-audio-call",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "cleanup-gap",
    );
  });

  it("rejects retention absence from a mutating operation", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[2]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "retention-cory-missed-call",
    )!;
    claim.state = "absent";
    claim.observation = {
      source: "provider-response",
      outcome: "exact-reconciliation",
      observerActorId: "ap2-instructor",
      operationKey: "stage-one-audio-call",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "cleanup-gap",
    );
  });

  it("rejects an independent observation from the workload actor", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[3]!;
    const receipt = copy(fixture.receipt);
    const claim = receipt.claims.find(
      (row) => row.id === "detector-independent",
    )!;
    claim.observation = {
      source: "independent-detector",
      outcome: "record-match",
      observerActorId: "recon-workload-app",
      operationKey: "run-bounded-recon-reads",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "invalid-observation",
    );
  });

  it.each([
    ["01234567", "89ab", "4cde", "8fab", "0123456789ab"].join("-"),
    ["learner", "example.invalid"].join("@"),
    ["", "private", "evidence", "report.json"].join("/"),
    ["token", "value"].join(" "),
  ])("rejects a raw identifier form", (unsafe) => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt) as unknown as {
      roles: { learner: string };
    };
    receipt.roles.learner = unsafe;

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "raw-identifier",
    );
  });

  it("rejects arbitrary upstream fields", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = {
      ...copy(fixture.receipt),
      rawPayload: { unexpected: true },
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "shape",
    );
  });

  it("rejects a semantic proof when its artifact remains uninspected", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt);
    const artifact = receipt.claims.find(
      (row) => row.id === "artifact-cory-help-desk-email",
    )!;
    artifact.state = "uninspected";
    delete artifact.observation;

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "ungrounded-claim",
    );
  });

  it("rejects an artifact category that differs from the manifest", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const receipt = copy(fixture.receipt);
    const artifact = receipt.claims.find(
      (row) => row.id === "artifact-cory-help-desk-email",
    )!;
    artifact.artifact!.kind = "teams-missed-call";

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, fixture.manifest),
      "ungrounded-claim",
    );
  });

  it("does not extend platform acceptance grounding to other artifact kinds", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const manifest = structuredClone(fixture.manifest);
    const receipt = copy(fixture.receipt);
    const expected = manifest.evidence.artifacts[0]!;
    expected.state = "platform-accepted";
    expected.learnerVisibility = "not-proven";
    delete expected.observation;
    manifest.learner.completionState = "not-run";
    const artifact = receipt.claims.find(
      (row) => row.id === "artifact-cory-help-desk-email",
    )!;
    artifact.observation = {
      source: "local-reconciliation",
      outcome: "exact-reconciliation",
      observerActorId: "ap2-orchestrator",
      operationKey: "send-help-desk-email",
    };

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(receipt, manifest),
      "ungrounded-claim",
    );
  });

  it("does not extend receipt-only visibility grounding to other artifact kinds", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[0]!;
    const manifest = structuredClone(fixture.manifest);
    manifest.evidence.artifacts[0]!.learnerVisibility = "not-proven";
    manifest.learner.completionState = "not-run";

    expectReceiptError(
      () => verifyScenarioEvidenceReceipt(fixture.receipt, manifest),
      "unsupported-visibility",
    );
  });

  it("returns a deterministic sanitized claim table", () => {
    const fixture = CANONICAL_RECEIPT_FIXTURES[3]!;
    const reversed = copy(fixture.receipt);
    reversed.claims = [...reversed.claims].reverse();

    const first = formatVerifiedClaimTable(
      verifyScenarioEvidenceReceipt(fixture.receipt, fixture.manifest),
    );
    const second = formatVerifiedClaimTable(
      verifyScenarioEvidenceReceipt(reversed, fixture.manifest),
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^CLAIM\tCATEGORY\tSUBJECT\tASSERTION\tSTATE/m);
    expect(first).toContain("producer-attribution");
    expect(first).not.toContain("canonical:");
    expect(first).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
    expect(first).not.toContain("@");
    expect(first).not.toContain("/");
  });

  it("reads only the bounded sanitized scenario ID from an envelope", () => {
    const receipt = CANONICAL_RECEIPT_FIXTURES[4]!.receipt;

    expect(readScenarioIdFromEvidenceReceipt(receipt)).toBe(
      "purview-sharepoint-audit-boundary",
    );
  });
});

function copy(receipt: ScenarioEvidenceReceipt): ScenarioEvidenceReceipt {
  return structuredClone(receipt);
}

function expectReceiptError(
  action: () => unknown,
  expectedCode: EvidenceReceiptError["code"],
): void {
  try {
    action();
    throw new Error("expected receipt validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceReceiptError);
    expect((error as EvidenceReceiptError).code).toBe(expectedCode);
  }
}
