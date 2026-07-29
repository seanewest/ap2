// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  PRIVATE_DOCUMENT_FILES_READ_SCOPE,
  PRIVATE_DOCUMENT_FILES_READ_WRITE_SCOPE,
  PrivateDocumentEvidenceRunner,
  buildPrivateDocumentPlan,
  sanitizedPrivateDocumentPlan,
  type FrozenPrivateDocumentPlan,
  type PrivateDocumentJournalEntry,
  type PrivateDocumentMutation,
  type PrivateDocumentMutationOutcome,
  type PrivateDocumentObservation,
  type PrivateDocumentPlanContext,
  type PrivateDocumentRead,
  type PrivateDocumentReconciliation,
  type PrivateDocumentScenario,
  type PrivateDocumentState,
  type PrivateDocumentTransport,
} from "./private-document-evidence.js";

const context: PrivateDocumentPlanContext = {
  expectedTenantId: "fixed-tenant",
};

function scenario(
  changes: Partial<PrivateDocumentScenario> = {},
): PrivateDocumentScenario {
  const producer = {
    alias: "kobe" as const,
    tenantId: "fixed-tenant",
    objectId: "producer-object",
  };
  const learner = {
    alias: "cory" as const,
    tenantId: "fixed-tenant",
    objectId: "learner-object",
  };
  return {
    runMarker: "ap2doc-20260101T000000Z-a1b2c3",
    tenantId: "fixed-tenant",
    producer,
    learner,
    drive: {
      id: "producer-drive",
      driveType: "business",
      ownerObjectId: producer.objectId,
      hostname: "fixed.sharepoint.com",
    },
    runFolderPathAbsent: true,
    producerScopes: [PRIVATE_DOCUMENT_FILES_READ_WRITE_SCOPE],
    learnerScopes: [PRIVATE_DOCUMENT_FILES_READ_SCOPE],
    cleanupOwnerAlias: "kobe",
    payloadCategory: "authorized-lab-document-review",
    retention: "ephemeral",
    share: {
      recipientObjectId: learner.objectId,
      roles: ["read"],
      requireSignIn: true,
      sendInvitation: false,
      allowLinks: false,
    },
    claims: {
      learnerVisibility: "metadata-or-content-read",
      learnerInterpretation: false,
      auditOrDetection: false,
    },
    ...changes,
  };
}

class FakeTransport implements PrivateDocumentTransport {
  readonly mutations: PrivateDocumentMutation[] = [];
  readonly reconciliations: PrivateDocumentMutation[] = [];
  readonly observations: PrivateDocumentRead[] = [];
  readonly outcomes =
    new Map<PrivateDocumentMutation, PrivateDocumentMutationOutcome>();
  readonly thrownMutations = new Set<PrivateDocumentMutation>();
  readonly ambiguousApplied = new Set<PrivateDocumentMutation>();
  readonly incompleteReads = new Map<PrivateDocumentMutation, number>();
  readonly scriptedReconciliations =
    new Map<PrivateDocumentMutation, PrivateDocumentReconciliation[]>();
  folder = false;
  file = false;
  share = false;

  async mutate(
    operation: PrivateDocumentMutation,
  ): Promise<PrivateDocumentMutationOutcome> {
    this.mutations.push(operation);
    if (this.ambiguousApplied.has(operation)) {
      this.#apply(operation);
      throw new Error("raw ambiguous response after mutation");
    }
    if (this.thrownMutations.has(operation)) {
      throw new Error("raw transport response");
    }
    const configured = this.outcomes.get(operation);
    if (configured) {
      if (configured.status === "succeeded") {
        this.#apply(operation);
      }
      return configured;
    }
    this.#apply(operation);
    return { status: "succeeded", state: this.#state() };
  }

  async reconcile(
    operation: PrivateDocumentMutation,
  ): Promise<PrivateDocumentReconciliation> {
    this.reconciliations.push(operation);
    const scripted = this.scriptedReconciliations.get(operation);
    if (scripted && scripted.length > 0) {
      return scripted.shift() as PrivateDocumentReconciliation;
    }
    const incomplete = this.incompleteReads.get(operation) ?? 0;
    if (incomplete > 0) {
      this.incompleteReads.set(operation, incomplete - 1);
      return { status: "incomplete" };
    }
    const present = operation.startsWith("folder")
      ? this.folder
      : operation.startsWith("file")
        ? this.file
        : this.share;
    const cleanup = operation.endsWith("delete");
    if (cleanup) {
      return present
        ? { status: "present", state: this.#state() }
        : { status: "desired", state: this.#state() };
    }
    return present
      ? { status: "desired", state: this.#state() }
      : { status: "absent", state: this.#state() };
  }

  async observe(
    read: PrivateDocumentRead,
  ): Promise<PrivateDocumentObservation> {
    this.observations.push(read);
    if (read === "learner-visibility") {
      return this.folder && this.file && this.share
        ? { status: "proven", summary: "learner-visible" }
        : { status: "failed", summary: "contract-failed" };
    }
    const absent = !this.folder && !this.file && !this.share;
    return absent
      ? {
          status: "absent",
          summary:
            read === "terminal-producer-absence"
              ? "producer-absent"
              : "learner-absent",
        }
      : { status: "failed", summary: "contract-failed" };
  }

  #apply(operation: PrivateDocumentMutation): void {
    if (operation === "folder-create") {
      this.folder = true;
    } else if (operation === "file-create") {
      this.file = true;
    } else if (operation === "direct-share-create") {
      this.share = true;
    } else if (operation === "direct-share-delete") {
      this.share = false;
    } else if (operation === "file-delete") {
      this.file = false;
    } else {
      this.folder = false;
    }
  }

  #state(): PrivateDocumentState {
    return {
      ...(this.folder
        ? { folderId: "folder", folderETag: "folder-etag" }
        : {}),
      ...(this.file ? { itemId: "item", itemETag: "item-etag" } : {}),
      ...(this.share ? { permissionId: "permission" } : {}),
    };
  }
}

function runner(
  plan: FrozenPrivateDocumentPlan = buildPrivateDocumentPlan(
    scenario(),
    context,
  ),
): {
  runner: PrivateDocumentEvidenceRunner;
  transport: FakeTransport;
  journal: PrivateDocumentJournalEntry[];
  waits: number[];
} {
  const transport = new FakeTransport();
  const journal: PrivateDocumentJournalEntry[] = [];
  const waits: number[] = [];
  return {
    runner: new PrivateDocumentEvidenceRunner(
      plan,
      transport,
      {
        append: async (entry) => {
          journal.push(entry);
        },
      },
      {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
      },
    ),
    transport,
    journal,
    waits,
  };
}

describe("private-document evidence plan", () => {
  it("freezes the exact private direct-share and cleanup contract", () => {
    const plan = buildPrivateDocumentPlan(scenario(), context);

    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.mutationOrder).toEqual([
      "folder-create",
      "file-create",
      "direct-share-create",
    ]);
    expect(plan.cleanupOrder).toEqual([
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ]);
    expect(plan.share).toEqual({
      recipientObjectId: "learner-object",
      roles: ["read"],
      requireSignIn: true,
      sendInvitation: false,
      allowLinks: false,
    });
    expect(plan.claims).toEqual({
      learnerVisibility: "metadata-or-content-read",
      learnerInterpretation: false,
      auditOrDetection: false,
    });
  });

  it.each([
    ["wrong tenant", { tenantId: "wrong" }, /tenant/],
    [
      "same producer and learner",
      {
        learner: {
          alias: "cory" as const,
          tenantId: "fixed-tenant",
          objectId: "producer-object",
        },
      },
      /distinct/,
    ],
    ["malformed marker", { runMarker: "bad" }, /marker/],
    ["existing folder", { runFolderPathAbsent: false }, /absent/],
    [
      "external drive",
      {
        drive: {
          id: "drive",
          driveType: "business" as const,
          ownerObjectId: "producer-object",
          hostname: "external.example",
        },
      },
      /business OneDrive/,
    ],
    [
      "wrong owner",
      {
        drive: {
          id: "drive",
          driveType: "business" as const,
          ownerObjectId: "unrelated",
          hostname: "fixed.sharepoint.com",
        },
      },
      /business OneDrive/,
    ],
    ["missing cleanup owner", { cleanupOwnerAlias: "cory" as "kobe" }, /Kobe/],
    [
      "insufficient producer scope",
      { producerScopes: [PRIVATE_DOCUMENT_FILES_READ_SCOPE] },
      /Files scopes/,
    ],
    [
      "invitation email",
      { share: { ...scenario().share, sendInvitation: true as false } },
      /direct signed-in/,
    ],
    [
      "anonymous link",
      { share: { ...scenario().share, allowLinks: true } },
      /direct signed-in/,
    ],
    [
      "write permission",
      { share: { ...scenario().share, roles: ["write"] as unknown as ["read"] } },
      /direct signed-in/,
    ],
    [
      "audit claim",
      { claims: { ...scenario().claims, auditOrDetection: true } },
      /claim contract/,
    ],
  ])("rejects %s", (_name, changes, expected) => {
    expect(() =>
      buildPrivateDocumentPlan(
        scenario(changes as Partial<PrivateDocumentScenario>),
        context,
      ),
    ).toThrow(expected as RegExp);
  });

  it("rejects marker reuse and removes identities from the sanitized plan", () => {
    const input = scenario();
    expect(() =>
      buildPrivateDocumentPlan(input, {
        ...context,
        existingMarkers: new Set([input.runMarker]),
      }),
    ).toThrow(/marker/);

    const summary = JSON.stringify(
      sanitizedPrivateDocumentPlan(
        buildPrivateDocumentPlan(input, context),
      ),
    );
    expect(summary).not.toContain(input.tenantId);
    expect(summary).not.toContain(input.producer.objectId);
    expect(summary).not.toContain(input.learner.objectId);
    expect(summary).not.toContain(input.drive.id);
    expect(summary).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});

describe("private-document lifecycle runner", () => {
  it("stages, proves learner visibility, and cleans in exact order", async () => {
    const fixture = runner();

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "completed-cleaned",
      learnerVisibility: "proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
    });
    expect(fixture.transport.mutations).toEqual([
      "folder-create",
      "file-create",
      "direct-share-create",
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ]);
    expect(fixture.transport.observations).toEqual([
      "learner-visibility",
      "terminal-producer-absence",
      "terminal-learner-absence",
    ]);
    expect(fixture.transport.folder).toBe(false);
    expect(fixture.transport.file).toBe(false);
    expect(fixture.transport.share).toBe(false);
  });

  it("never replays an ambiguous mutation and reconciles it by exact reads", async () => {
    const fixture = runner();
    fixture.transport.thrownMutations.add("file-create");
    fixture.transport.file = true;

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "completed-cleaned",
    });
    expect(
      fixture.transport.mutations.filter(
        (operation) => operation === "file-create",
      ),
    ).toHaveLength(1);
    expect(
      fixture.journal
        .filter((entry) => entry.operation === "file-create")
        .map((entry) => entry.transition),
    ).toEqual(["intent", "ambiguous", "reconciled"]);
    expect(JSON.stringify(fixture.journal)).not.toContain(
      "raw transport response",
    );
  });

  it("requires three spaced exact absence reads after an ambiguous create", async () => {
    const fixture = runner();
    fixture.transport.thrownMutations.add("folder-create");

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      failedOperation: "folder-create",
    });
    expect(
      fixture.transport.mutations.filter(
        (operation) => operation === "folder-create",
      ),
    ).toHaveLength(1);
    expect(
      fixture.transport.reconciliations.filter(
        (operation) => operation === "folder-create",
      ),
    ).toHaveLength(3);
    expect(
      fixture.journal.filter(
        (entry) =>
          entry.operation === "folder-create" &&
          entry.detail === "absence-awaiting-propagation",
      ),
    ).toHaveLength(2);
    expect(fixture.waits.every((milliseconds) => milliseconds === 1_000))
      .toBe(true);
  });

  it("does not trust a transient absence after a definite create", async () => {
    const fixture = runner();
    fixture.transport.scriptedReconciliations.set("folder-create", [
      { status: "absent", state: {} },
      {
        status: "desired",
        state: { folderId: "folder", folderETag: "folder-etag" },
      },
    ]);

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "completed-cleaned",
    });
    expect(
      fixture.transport.mutations.filter(
        (operation) => operation === "folder-create",
      ),
    ).toHaveLength(1);
    expect(
      fixture.transport.reconciliations.filter(
        (operation) => operation === "folder-create",
      ),
    ).toHaveLength(2);
    expect(fixture.waits).toContain(1_000);
    expect(fixture.transport.folder).toBe(false);
  });

  it("requires three spaced exact absence reads after an ambiguous delete", async () => {
    const fixture = runner();
    fixture.transport.ambiguousApplied.add("direct-share-delete");

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "completed-cleaned",
    });
    expect(
      fixture.transport.mutations.filter(
        (operation) => operation === "direct-share-delete",
      ),
    ).toHaveLength(1);
    expect(
      fixture.transport.reconciliations.filter(
        (operation) => operation === "direct-share-delete",
      ),
    ).toHaveLength(4);
    expect(
      fixture.journal.filter(
        (entry) =>
          entry.operation === "direct-share-delete" &&
          entry.detail === "absence-awaiting-propagation",
      ),
    ).toHaveLength(2);
    expect(fixture.waits.every((milliseconds) => milliseconds === 1_000))
      .toBe(true);
  });

  it("performs exact cleanup after partial staging failure", async () => {
    const fixture = runner();
    fixture.transport.outcomes.set("direct-share-create", {
      status: "failed",
    });

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      failedOperation: "direct-share-create",
    });
    expect(fixture.transport.mutations).not.toContain("direct-share-delete");
    expect(fixture.transport.mutations.slice(-2)).toEqual([
      "file-delete",
      "folder-delete",
    ]);
    expect(fixture.transport.folder).toBe(false);
    expect(fixture.transport.file).toBe(false);
  });

  it("caps exact reconciliation at three and reports blocked cleanup", async () => {
    const fixture = runner();
    fixture.transport.incompleteReads.set("direct-share-delete", 3);

    await expect(fixture.runner.run()).resolves.toMatchObject({
      status: "blocked-cleanup",
      failedOperation: "direct-share-delete",
    });
    expect(
      fixture.transport.reconciliations.filter(
        (operation) => operation === "direct-share-delete",
      ),
    ).toHaveLength(3);
    expect(
      fixture.transport.mutations.filter(
        (operation) => operation === "direct-share-delete",
      ),
    ).toHaveLength(0);
  });
});
