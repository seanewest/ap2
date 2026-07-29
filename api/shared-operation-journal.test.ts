import { describe, expect, it } from "vitest";
import {
  AzureTableSharedOperationJournal,
  SharedOperationJournalError,
  operationKeys,
  parseSharedOperationJournalConfig,
  type SharedOperationIdentity,
} from "./shared-operation-journal";

const identity: SharedOperationIdentity = {
  markerAlias: "journal-canary",
  operationKind: "calendar.create",
  actorAlias: "cory-actor",
  targetAlias: "calendar-target",
};
const now = "2026-07-29T12:00:00.000Z";

class MemoryTable {
  readonly entities = new Map<string, Record<string, unknown>>();
  revision = 0;
  uncertainAfterCreate = false;
  uncertainAfterUpdate = false;
  uncertainAfterDelete = false;
  failBeforeUpdate = false;
  updateCalls = 0;

  async createEntity<T extends object>(
    entity: T & { partitionKey: string; rowKey: string },
  ): Promise<{ etag: string }> {
    this.updateCalls += 1;
    if (this.failBeforeUpdate) {
      this.failBeforeUpdate = false;
      throw tableError(503);
    }
    const key = this.#key(entity.partitionKey, entity.rowKey);
    if (this.entities.has(key)) throw tableError(409);
    const etag = this.#etag();
    this.entities.set(key, { ...entity, etag });
    if (this.uncertainAfterCreate) {
      this.uncertainAfterCreate = false;
      throw tableError(500);
    }
    return { etag };
  }

  async getEntity<T extends object>(
    partitionKey: string,
    rowKey: string,
  ): Promise<T & { partitionKey: string; rowKey: string; etag: string }> {
    const entity = this.entities.get(this.#key(partitionKey, rowKey));
    if (!entity) throw tableError(404);
    return structuredClone(entity) as T & {
      partitionKey: string;
      rowKey: string;
      etag: string;
    };
  }

  async updateEntity<T extends object>(
    entity: T & { partitionKey: string; rowKey: string },
    mode: "Replace",
    options: { etag: string },
  ): Promise<{ etag: string }> {
    expect(mode).toBe("Replace");
    const key = this.#key(entity.partitionKey, entity.rowKey);
    const current = this.entities.get(key);
    if (!current) throw tableError(404);
    if (current.etag !== options.etag) throw tableError(412);
    const etag = this.#etag();
    this.entities.set(key, { ...entity, etag });
    if (this.uncertainAfterUpdate) {
      this.uncertainAfterUpdate = false;
      throw tableError(500);
    }
    return { etag };
  }

  async deleteEntity(
    partitionKey: string,
    rowKey: string,
    options: { etag: string },
  ): Promise<void> {
    const key = this.#key(partitionKey, rowKey);
    const current = this.entities.get(key);
    if (!current || current.etag !== options.etag) throw tableError(412);
    this.entities.delete(key);
    if (this.uncertainAfterDelete) {
      this.uncertainAfterDelete = false;
      throw tableError(500);
    }
  }

  #key(partitionKey: string, rowKey: string): string {
    return `${partitionKey}/${rowKey}`;
  }

  #etag(): string {
    this.revision += 1;
    return `etag-${this.revision}`;
  }
}

describe("Azure Table shared operation journal", () => {
  it("allows one dispatch and suppresses a concurrent and fresh-process duplicate", async () => {
    const table = new MemoryTable();
    const firstProcess = new AzureTableSharedOperationJournal(table, 3_600);
    const secondProcess = new AzureTableSharedOperationJournal(table, 3_600);

    const [first, second] = await Promise.all([
      firstProcess.acquireDispatch(identity, "process-one", now, 30),
      secondProcess.acquireDispatch(identity, "process-two", now, 30),
    ]);

    const claims = [first, second];
    expect(claims.filter((claim) => claim.kind === "dispatch")).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === "refused")).toHaveLength(1);

    const freshProcess = new AzureTableSharedOperationJournal(table, 3_600);
    await expect(
      freshProcess.acquireDispatch(identity, "process-three", now, 30),
    ).resolves.toMatchObject({
      kind: "refused",
      reason: "requires-reconciliation",
    });
  });

  it("reconciles uncertain conditional writes without replay", async () => {
    const table = new MemoryTable();
    table.uncertainAfterCreate = true;
    table.uncertainAfterUpdate = true;
    const journal = new AzureTableSharedOperationJournal(table, 3_600);

    const claim = await journal.acquireDispatch(identity, "process-one", now, 30);
    expect(claim).toMatchObject({ kind: "dispatch", reconciled: true });
    if (claim.kind !== "dispatch") throw new Error("expected dispatch");

    table.uncertainAfterUpdate = true;
    const terminal = await journal.recordTerminal(
      identity,
      "process-one",
      claim.record.etag,
      "succeeded",
      "2026-07-29T12:00:05.000Z",
    );
    expect(terminal).toMatchObject({
      kind: "recorded",
      reconciled: true,
      record: { state: "succeeded" },
    });
    await expect(
      new AzureTableSharedOperationJournal(table, 3_600).acquireDispatch(
        identity,
        "process-two",
        "2026-07-29T12:00:06.000Z",
        30,
      ),
    ).resolves.toMatchObject({
      kind: "refused",
      reason: "terminal-tombstone",
    });
  });

  it("never retries a conditional transition that fails before application", async () => {
    const table = new MemoryTable();
    table.failBeforeUpdate = true;
    const journal = new AzureTableSharedOperationJournal(table, 3_600);
    await expect(
      journal.acquireDispatch(identity, "process-one", now, 30),
    ).resolves.toMatchObject({
      kind: "refused",
      reason: "requires-reconciliation",
    });
    expect(table.updateCalls).toBe(1);

    await expect(
      journal.recordTerminal(
        identity,
        "process-one",
        "stale-etag",
        "succeeded",
        "2026-07-29T12:00:05.000Z",
      ),
    ).resolves.toMatchObject({ kind: "refused", reason: "invalid-state" });
    expect(table.updateCalls).toBe(1);
  });

  it("allows expired prepared takeover but never expired executing replay", async () => {
    const table = new MemoryTable();
    const journal = new AzureTableSharedOperationJournal(table, 3_600);
    const keys = operationKeys(identity);
    await table.createEntity({
      ...keys,
      schemaVersion: 1,
      ...identity,
      state: "prepared",
      recordVersion: 1,
      leaseOwner: "old-process",
      leaseExpiresAt: "2026-07-29T11:59:00.000Z",
      retainUntil: "2026-07-29T13:00:00.000Z",
      terminalAt: "",
      ambiguityReason: "",
    });
    await expect(
      journal.acquireDispatch(identity, "new-process", now, 30),
    ).resolves.toMatchObject({
      kind: "dispatch",
      record: { state: "executing", leaseOwner: "new-process" },
    });

    const running = await table.getEntity<Record<string, unknown>>(
      keys.partitionKey,
      keys.rowKey,
    );
    running.leaseExpiresAt = "2026-07-29T11:59:30.000Z";
    table.entities.set(`${keys.partitionKey}/${keys.rowKey}`, running);
    const crashRecovery =
      await new AzureTableSharedOperationJournal(table, 3_600).acquireDispatch(
        identity,
        "third-process",
        now,
        30,
      );
    expect(crashRecovery).toMatchObject({
      kind: "refused",
      reason: "requires-reconciliation",
      record: {
        state: "ambiguous",
        ambiguityReason: "executing-lease-expired",
      },
    });
    if (crashRecovery.kind !== "refused" || !crashRecovery.record) {
      throw new Error("expected ambiguity");
    }
    await expect(
      journal.resolveAmbiguous(
        identity,
        crashRecovery.record.etag,
        "succeeded",
        "2026-07-29T12:00:01.000Z",
      ),
    ).resolves.toMatchObject({
      kind: "recorded",
      record: { state: "succeeded" },
    });
  });

  it("retains terminal and ambiguous tombstones until exact resolution or retirement", async () => {
    const table = new MemoryTable();
    const journal = new AzureTableSharedOperationJournal(table, 60);
    const claim = await journal.acquireDispatch(identity, "process-one", now, 30);
    if (claim.kind !== "dispatch") throw new Error("expected dispatch");
    const ambiguous = await journal.recordAmbiguous(
      identity,
      "process-one",
      claim.record.etag,
      "conditional-write-uncertain",
    );
    expect(ambiguous).toMatchObject({
      kind: "recorded",
      record: { state: "ambiguous" },
    });
    if (ambiguous.kind !== "recorded") throw new Error("expected ambiguity");
    await expect(
      journal.retireTerminal(
        identity,
        ambiguous.record.etag,
        "2026-07-30T12:00:00.000Z",
        true,
      ),
    ).resolves.toMatchObject({ kind: "refused", reason: "invalid-state" });

    const terminal = await journal.resolveAmbiguous(
      identity,
      ambiguous.record.etag,
      "failed",
      "2026-07-29T12:00:05.000Z",
    );
    expect(terminal).toMatchObject({
      kind: "recorded",
      record: { state: "failed" },
    });
    if (terminal.kind !== "recorded") throw new Error("expected terminal");
    await expect(
      journal.retireTerminal(
        identity,
        terminal.record.etag,
        "2026-07-29T12:01:06.000Z",
        true,
      ),
    ).resolves.toMatchObject({ kind: "recorded" });
    expect(table.entities.size).toBe(0);
  });

  it("fails closed on corruption and immutable identity mismatch", async () => {
    const table = new MemoryTable();
    const keys = operationKeys(identity);
    await table.createEntity({
      ...keys,
      schemaVersion: 2,
      ...identity,
      state: "prepared",
      recordVersion: 1,
      leaseOwner: "old-process",
      leaseExpiresAt: "2026-07-29T12:01:00.000Z",
      retainUntil: "2026-07-29T13:00:00.000Z",
      terminalAt: "",
      ambiguityReason: "",
    });
    await expect(
      new AzureTableSharedOperationJournal(table, 3_600).acquireDispatch(
        identity,
        "new-process",
        now,
        30,
      ),
    ).resolves.toEqual({ kind: "corrupt" });
  });

  it.each([
    {
      name: "prepared ambiguity residue",
      patch: { ambiguityReason: "conditional-write-uncertain" },
    },
    {
      name: "executing terminal residue",
      patch: { state: "executing", terminalAt: now },
    },
    {
      name: "ambiguous terminal residue",
      patch: {
        state: "ambiguous",
        leaseOwner: "",
        leaseExpiresAt: "",
        ambiguityReason: "executing-lease-expired",
        terminalAt: now,
      },
    },
    {
      name: "terminal ambiguity residue",
      patch: {
        state: "failed",
        leaseOwner: "",
        leaseExpiresAt: "",
        ambiguityReason: "conditional-write-uncertain",
        terminalAt: now,
      },
    },
    {
      name: "mismatched deterministic key",
      patch: { rowKey: "foreign-row" },
    },
  ])("rejects corrupt cross-state fields: $name", async ({ patch }) => {
    const table = new MemoryTable();
    const keys = operationKeys(identity);
    await table.createEntity({
      ...keys,
      schemaVersion: 1,
      ...identity,
      state: "prepared",
      recordVersion: 1,
      leaseOwner: "old-process",
      leaseExpiresAt: "2026-07-29T12:01:00.000Z",
      retainUntil: "2026-07-29T13:00:00.000Z",
      terminalAt: "",
      ambiguityReason: "",
      ...patch,
    });
    if ("rowKey" in patch) {
      const stored = [...table.entities.values()][0];
      if (!stored) throw new Error("expected stored fixture");
      table.entities.clear();
      table.entities.set(`${keys.partitionKey}/${keys.rowKey}`, stored);
    }
    await expect(
      new AzureTableSharedOperationJournal(table, 3_600).acquireDispatch(
        identity,
        "new-process",
        now,
        30,
      ),
    ).resolves.toEqual({ kind: "corrupt" });
  });

  it("reconciles an uncertain conditional terminal deletion by one exact read", async () => {
    const table = new MemoryTable();
    const journal = new AzureTableSharedOperationJournal(table, 60);
    const claim = await journal.acquireDispatch(identity, "process-one", now, 30);
    if (claim.kind !== "dispatch") throw new Error("expected dispatch");
    const terminal = await journal.recordTerminal(
      identity,
      "process-one",
      claim.record.etag,
      "succeeded",
      "2026-07-29T12:00:05.000Z",
    );
    if (terminal.kind !== "recorded") throw new Error("expected terminal");
    table.uncertainAfterDelete = true;
    await expect(
      journal.retireTerminal(
        identity,
        terminal.record.etag,
        "2026-07-29T12:01:06.000Z",
        true,
      ),
    ).resolves.toMatchObject({ kind: "recorded", reconciled: true });
    expect(table.entities.size).toBe(0);
  });

  it("accepts only managed-identity HTTPS metadata and bounded aliases", () => {
    expect(
      parseSharedOperationJournalConfig({
        kind: "azure-table-managed-identity",
        endpoint: "https://ap2journal.table.core.windows.net",
        tableName: "ap2operations",
        retentionSeconds: 86_400,
      }),
    ).toEqual({
      kind: "azure-table-managed-identity",
      endpoint: "https://ap2journal.table.core.windows.net",
      tableName: "ap2operations",
      retentionSeconds: 86_400,
    });
    for (const bad of [
      {
        kind: "azure-table-managed-identity",
        endpoint: "not-a-url",
        tableName: "ap2operations",
        retentionSeconds: 86_400,
      },
      {
        kind: "azure-table-managed-identity",
        endpoint: "https://ap2journal.table.core.windows.net",
        tableName: "ap2operations",
        retentionSeconds: 86_400,
        [["account", "key"].join("")]: "not-accepted",
      },
      {
        kind: "azure-table-managed-identity",
        endpoint: "http://127.0.0.1:10002",
        tableName: "ap2operations",
        retentionSeconds: 86_400,
      },
      {
        kind: "azure-table-managed-identity",
        endpoint: "https://ap2journal.table.core.windows.net?sig=not-allowed",
        tableName: "ap2operations",
        retentionSeconds: 86_400,
      },
    ]) {
      expect(() => parseSharedOperationJournalConfig(bad)).toThrow(
        SharedOperationJournalError,
      );
    }
    expect(() =>
      operationKeys({
        ...identity,
        actorAlias: ["person", "example.test"].join("@"),
      }),
    ).toThrow(SharedOperationJournalError);
    expect(() =>
      operationKeys({ ...identity, requestBody: "not-accepted" }),
    ).toThrow(SharedOperationJournalError);
    expect(() =>
      operationKeys({
        ...identity,
        markerAlias: ["123e4567", "e89b", "12d3", "a456", "426614174000"].join(
          "-",
        ),
      }),
    ).toThrow(SharedOperationJournalError);
  });
});

function tableError(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error("TABLE_OPERATION_FAILED"), { statusCode });
}
