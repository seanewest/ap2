// @vitest-environment node

import { describe, expect, it } from "vitest";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from "./private-document-evidence.ts";
import { RECEIPT_MANIFESTS } from "./scenario-evidence-receipt.fixtures.ts";
import {
  adaptPrivateDocumentLifecycleToReceipt,
  PrivateDocumentReceiptAdapterError,
  type PrivateDocumentLifecycleReceiptInput,
  type SanitizedPrivateDocumentJournalEntry,
} from "./private-document-receipt-adapter.ts";
import {
  EvidenceReceiptError,
  formatVerifiedClaimTable,
  verifyScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";

const CORRELATION = "run-fixture";
type MutableInput = Omit<
  PrivateDocumentLifecycleReceiptInput,
  "journal"
> & {
  journal: SanitizedPrivateDocumentJournalEntry[];
};

function coreJournal(
  learnerProven: boolean,
  initialLearnerAbsence: boolean,
): Omit<SanitizedPrivateDocumentJournalEntry, "sequence" | "correlation">[] {
  const entries: Omit<
    SanitizedPrivateDocumentJournalEntry,
    "sequence" | "correlation"
  >[] = [];
  for (
    const operation of [
      "folder-create",
      "file-create",
      "direct-share-create",
    ] as const
  ) {
    entries.push(
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      {
        operation,
        transition: "reconciled",
        detail: "exact-desired-state",
      },
    );
  }
  entries.push({
    operation: "learner-visibility",
    transition: "observed",
    detail: learnerProven ? "learner-visible" : "contract-failed",
  });
  for (
    const operation of [
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ] as const
  ) {
    entries.push(
      {
        operation,
        transition: "reconciled",
        detail: "exact-present-state",
      },
      { operation, transition: "intent", detail: "mutation-intent" },
      { operation, transition: "succeeded", detail: "definite-success" },
      {
        operation,
        transition: "reconciliation-incomplete",
        detail: "absence-awaiting-propagation",
      },
      {
        operation,
        transition: "reconciliation-incomplete",
        detail: "absence-awaiting-propagation",
      },
      {
        operation,
        transition: "reconciled",
        detail: "exact-desired-state",
      },
    );
  }
  entries.push(
    {
      operation: "terminal-producer-absence",
      transition: "observed",
      detail: "producer-absent",
    },
    {
      operation: "terminal-learner-absence",
      transition: "observed",
      detail: initialLearnerAbsence ? "learner-absent" : "contract-failed",
    },
  );
  return entries;
}

function journal(
  learnerProven = false,
  initialLearnerAbsence = false,
): SanitizedPrivateDocumentJournalEntry[] {
  return coreJournal(learnerProven, initialLearnerAbsence).map(
    (entry, index) => ({
      sequence: index + 1,
      correlation: CORRELATION,
      ...entry,
    }),
  );
}

function honestInput(): MutableInput {
  return {
    schemaVersion: 1,
    scenarioId: "private-document-evidence",
    correlation: CORRELATION,
    result: {
      status: "blocked-cleanup",
      failedOperation: "terminal-absence",
      learnerVisibility: "not-proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    },
    journal: journal(),
    terminal: {
      freshSessionRounds: 3,
      producerFolder: "absent",
      producerItem: "absent",
      producerPermission: "absent",
      learnerAccess: "absent",
    },
  };
}

function learnerProvenInput(): MutableInput {
  return {
    ...honestInput(),
    result: {
      status: "completed-cleaned",
      learnerVisibility: "proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    },
    journal: journal(true, true),
  };
}

function clonedInput(
  input: PrivateDocumentLifecycleReceiptInput = honestInput(),
): MutableInput {
  return structuredClone(input) as MutableInput;
}

function claim(
  receipt: ScenarioEvidenceReceipt,
  id: string,
) {
  return receipt.claims.find((candidate) => candidate.id === id);
}

function expectAdapterError(
  action: () => unknown,
  code: PrivateDocumentReceiptAdapterError["code"],
): void {
  try {
    action();
    throw new Error("Expected private-document adapter failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateDocumentReceiptAdapterError);
    expect((error as PrivateDocumentReceiptAdapterError).code).toBe(code);
  }
}

describe("private-document lifecycle receipt adapter", () => {
  it("registers the canonical scenario for receipt validation", () => {
    expect(
      RECEIPT_MANIFESTS.filter((manifest) =>
        manifest.id === "private-document-evidence"
      ),
    ).toHaveLength(1);
  });

  it("maps the honest cleaned canary boundary without learner overclaim", () => {
    const input = honestInput();
    const before = structuredClone(input);
    const receipt = adaptPrivateDocumentLifecycleToReceipt(input);
    const verified = verifyScenarioEvidenceReceipt(
      receipt,
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
    );

    expect(input).toEqual(before);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(verified.scenarioId).toBe("private-document-evidence");
    expect(claim(receipt, "artifact-private-text-document")).toMatchObject({
      state: "proven",
      artifact: {
        kind: "private-document",
        authenticity: "platform-native",
      },
      observation: {
        source: "local-reconciliation",
        outcome: "exact-reconciliation",
        operationKey: "grant-direct-learner-read",
      },
    });
    expect(claim(receipt, "visibility-private-text-document")).toEqual({
      id: "visibility-private-text-document",
      category: "learner-visibility",
      subject: { kind: "artifact", id: "private-text-document" },
      assertion: "learner-visible",
      state: "uninspected",
    });
    expect(claim(receipt, "learner-interpretation")?.state).toBe(
      "uninspected",
    );
    expect(
      receipt.claims.filter((candidate) =>
        candidate.category === "cleanup"
      ),
    ).toHaveLength(3);
    expect(
      receipt.claims
        .filter((candidate) => candidate.category === "cleanup")
        .every((candidate) =>
          candidate.state === "proven" &&
          candidate.observation?.operationKey ===
            "reconcile-private-document-cleanup"
        ),
    ).toBe(true);
    expect(claim(receipt, "retention-private-text-document")).toMatchObject({
      state: "absent",
      observation: {
        source: "local-reconciliation",
        outcome: "exact-reconciliation",
      },
    });
    expect(
      receipt.claims.some((candidate) =>
        candidate.category === "independent-observation" ||
        candidate.category === "response"
      ),
    ).toBe(false);
  });

  it("accepts a synthetic exact learner observation but not interpretation", () => {
    const receipt = adaptPrivateDocumentLifecycleToReceipt(
      learnerProvenInput(),
    );

    expect(() =>
      verifyScenarioEvidenceReceipt(
        receipt,
        PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
      )
    ).not.toThrow();
    expect(claim(receipt, "visibility-private-text-document")).toMatchObject({
      state: "proven",
      observation: {
        source: "learner-view",
        outcome: "learner-inspection",
        observerActorId: "document-learner",
        operationKey: "read-private-document-exact",
      },
    });
    expect(claim(receipt, "learner-interpretation")?.state).toBe(
      "uninspected",
    );
    expect(
      receipt.claims.filter((candidate) =>
        candidate.category === "terminal-proof"
      ),
    ).toEqual([
      expect.objectContaining({
        assertion: "private-document-staged",
        state: "proven",
      }),
    ]);
  });

  it("does not accept a non-evidence learner action as visibility proof", () => {
    const receipt = structuredClone(
      adaptPrivateDocumentLifecycleToReceipt(learnerProvenInput()),
    );
    const visibility = receipt.claims.find((candidate) =>
      candidate.id === "visibility-private-text-document"
    )!;
    visibility.observation = {
      source: "learner-view",
      outcome: "learner-inspection",
      observerActorId: "document-learner",
      operationKey: "inspect-private-document",
    };

    expect(() =>
      verifyScenarioEvidenceReceipt(
        receipt,
        PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
      )
    ).toThrowError(
      expect.objectContaining<Partial<EvidenceReceiptError>>({
        code: "unsupported-visibility",
      }),
    );
  });

  it("does not treat terminal learner access absence as visibility", () => {
    const receipt = structuredClone(
      adaptPrivateDocumentLifecycleToReceipt(learnerProvenInput()),
    );
    const visibility = receipt.claims.find((candidate) =>
      candidate.id === "visibility-private-text-document"
    )!;
    visibility.observation = {
      source: "learner-view",
      outcome: "learner-inspection",
      observerActorId: "document-learner",
      operationKey: "reconcile-private-document-learner-access",
    };

    expect(() =>
      verifyScenarioEvidenceReceipt(
        receipt,
        PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
      )
    ).toThrowError(
      expect.objectContaining<Partial<EvidenceReceiptError>>({
        code: "unsupported-visibility",
      }),
    );
  });

  it("does not prove the artifact when any staging operation is unproven", () => {
    const receipt = structuredClone(
      adaptPrivateDocumentLifecycleToReceipt(honestInput()),
    );
    const folder = receipt.claims.find((candidate) =>
      candidate.id === "operation-create-private-run-folder"
    )!;
    folder.state = "uninspected";
    delete folder.observation;

    expect(() =>
      verifyScenarioEvidenceReceipt(
        receipt,
        PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
      )
    ).toThrowError(
      expect.objectContaining<Partial<EvidenceReceiptError>>({
        code: "ungrounded-claim",
      }),
    );
  });

  it("does not extend private-document grounding to another manifest", () => {
    const manifest = structuredClone(PRIVATE_DOCUMENT_EVIDENCE_SCENARIO);
    manifest.id = "private-document-other";
    const receipt = structuredClone(
      adaptPrivateDocumentLifecycleToReceipt(learnerProvenInput()),
    );
    receipt.scenario.id = manifest.id;
    const interpretation = receipt.claims.find((candidate) =>
      candidate.id === "learner-interpretation"
    )!;
    interpretation.subject.id = manifest.id;

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, manifest)
    ).toThrowError(
      expect.objectContaining<Partial<EvidenceReceiptError>>({
        code: "ungrounded-claim",
      }),
    );
  });

  it("emits deterministic receipt data without correlation or backend fields", () => {
    const first = adaptPrivateDocumentLifecycleToReceipt(honestInput());
    const second = adaptPrivateDocumentLifecycleToReceipt(clonedInput());
    const serialized = JSON.stringify(first);
    const table = formatVerifiedClaimTable(
      verifyScenarioEvidenceReceipt(
        first,
        PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
      ),
    );

    expect(first).toEqual(second);
    expect(serialized).not.toContain(CORRELATION);
    expect(serialized).not.toContain("correlation");
    expect(serialized).not.toContain("sequence");
    expect(serialized).not.toContain("freshSessionRounds");
    expect(serialized).not.toContain("producerFolder");
    expect(serialized).not.toContain("learnerAccess");
    expect(table).not.toContain(CORRELATION);
    expect(table).not.toContain("@");
    expect(table).not.toContain("/");
    expect(table).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });

  it.each([
    ["ambiguous", "ambiguous", "requires-exact-read"],
    ["failed", "failed", "definite-failure"],
    ["incomplete", "reconciliation-incomplete", "read-incomplete"],
  ] as const)("rejects a %s journal outcome", (_name, transition, detail) => {
    const input = clonedInput();
    input.journal[1] = {
      ...input.journal[1]!,
      transition,
      detail,
    };

    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(input),
      "nonterminal",
    );
  });

  it("rejects reordered, duplicated, and missing lifecycle events", () => {
    const reordered = clonedInput();
    [reordered.journal[1], reordered.journal[2]] = [
      reordered.journal[2]!,
      reordered.journal[1]!,
    ];
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(reordered),
      "sequence",
    );

    const duplicated = clonedInput();
    duplicated.journal[2] = { ...duplicated.journal[1]! };
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(duplicated),
      "sequence",
    );

    const missing = clonedInput();
    missing.journal = missing.journal
      .filter((entry) => entry.operation !== "file-delete")
      .map((entry, index) => ({ ...entry, sequence: index + 1 }));
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(missing),
      "sequence",
    );
  });

  it("rejects cleanup operations in the wrong order", () => {
    const input = clonedInput();
    const shareStart = input.journal.findIndex((entry) =>
      entry.operation === "direct-share-delete"
    );
    const fileStart = input.journal.findIndex((entry) =>
      entry.operation === "file-delete"
    );
    const share = input.journal.slice(shareStart, shareStart + 6);
    const file = input.journal.slice(fileStart, fileStart + 6);
    input.journal = [
      ...input.journal.slice(0, shareStart),
      ...file,
      ...share,
      ...input.journal.slice(fileStart + 6),
    ].map((entry, index) => ({ ...entry, sequence: index + 1 }));

    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(input),
      "sequence",
    );
  });

  it("rejects mismatched and unsafe run correlations", () => {
    const mismatched = clonedInput();
    mismatched.journal[4] = {
      ...mismatched.journal[4]!,
      correlation: "run-other",
    };
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(mismatched),
      "marker-mismatch",
    );

    for (const unsafe of [
      ["01234567", "89ab", "4cde", "8fab", "0123456789ab"].join("-"),
      ["learner", "example.invalid"].join("@"),
      ["", "private", "journal.json"].join("/"),
      ["token", "value"].join(" "),
      "ap2doc-20260101t000000z-a1b2c3",
    ]) {
      const input = clonedInput() as unknown as {
        correlation: string;
      };
      input.correlation = unsafe;
      expectAdapterError(
        () => adaptPrivateDocumentLifecycleToReceipt(input),
        "unsafe-input",
      );
    }
  });

  it("rejects unknown and arbitrary input fields", () => {
    const unknownOperation = clonedInput() as unknown as {
      journal: Array<Record<string, unknown>>;
    };
    unknownOperation.journal[0]!.operation = "unknown-operation";
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(unknownOperation),
      "shape",
    );

    const unknownDetail = clonedInput() as unknown as {
      journal: Array<Record<string, unknown>>;
    };
    unknownDetail.journal[0]!.detail = "raw-backend-detail";
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(unknownDetail),
      "shape",
    );

    const arbitrary = {
      ...clonedInput(),
      rawPayload: { unsafe: true },
    };
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(arbitrary),
      "shape",
    );
  });

  it("rejects learner visibility overclaim in either direction", () => {
    const resultOverclaim = clonedInput() as unknown as {
      result: Record<string, unknown>;
      journal: SanitizedPrivateDocumentJournalEntry[];
    };
    resultOverclaim.result = {
      status: "completed-cleaned",
      learnerVisibility: "proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    };
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(resultOverclaim),
      "overclaim",
    );

    const journalOverclaim = clonedInput();
    const learner = journalOverclaim.journal.findIndex((entry) =>
      entry.operation === "learner-visibility"
    );
    journalOverclaim.journal[learner] = {
      ...journalOverclaim.journal[learner]!,
      detail: "learner-visible",
    };
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(journalOverclaim),
      "overclaim",
    );
  });

  it("rejects interpretation, audit, detection, and response input claims", () => {
    for (const field of [
      "learnerInterpretation",
      "auditOrDetection",
    ] as const) {
      const input = clonedInput() as unknown as {
        result: Record<string, unknown>;
      };
      input.result[field] = "proven";
      expectAdapterError(
        () => adaptPrivateDocumentLifecycleToReceipt(input),
        "overclaim",
      );
    }

    const response = {
      ...clonedInput(),
      response: "completed",
    };
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(response),
      "shape",
    );
  });

  it("requires all cleanup mutations and exact fresh-session terminal absence", () => {
    for (const [field, value] of [
      ["freshSessionRounds", 2],
      ["producerFolder", "present"],
      ["producerItem", "present"],
      ["producerPermission", "present"],
      ["learnerAccess", "present"],
    ] as const) {
      const input = clonedInput() as unknown as {
        terminal: Record<string, unknown>;
      };
      input.terminal[field] = value;
      expectAdapterError(
        () => adaptPrivateDocumentLifecycleToReceipt(input),
        "cleanup-gap",
      );
    }
  });

  it("rejects failed, incomplete, and unsupported lifecycle results", () => {
    for (const status of [
      "cleaned-after-failure",
      "ambiguous",
      "failed",
      "incomplete",
    ]) {
      const input = clonedInput() as unknown as {
        result: Record<string, unknown>;
      };
      input.result.status = status;
      expectAdapterError(
        () => adaptPrivateDocumentLifecycleToReceipt(input),
        "nonterminal",
      );
    }

    const unknown = clonedInput() as unknown as {
      result: Record<string, unknown>;
    };
    unknown.result.status = "unknown-result";
    expectAdapterError(
      () => adaptPrivateDocumentLifecycleToReceipt(unknown),
      "shape",
    );
  });
});
