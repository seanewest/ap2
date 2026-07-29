import { createHash } from "node:crypto";
import {
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import {
  RestError,
  TableClient,
  type TableEntity,
  type TableEntityResult,
} from "@azure/data-tables";

const SCHEMA_VERSION = 1;
const ALIAS_PATTERN = /^[a-z][a-z0-9-]{2,47}$/;
const MARKER_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9]{2,62}$/;
const OPERATION_KINDS = [
  "onedrive.share",
  "onedrive.remove",
  "calendar.create",
  "calendar.cancel",
] as const;
const STATES = [
  "prepared",
  "executing",
  "succeeded",
  "failed",
  "ambiguous",
] as const;
const TERMINAL_STATES = ["succeeded", "failed"] as const;
const MAX_LEASE_SECONDS = 300;
const MAX_RETENTION_SECONDS = 31_536_000;

export type SharedOperationKind = (typeof OPERATION_KINDS)[number];
export type SharedOperationState = (typeof STATES)[number];
export type SharedOperationTerminalState = (typeof TERMINAL_STATES)[number];

export interface SharedOperationIdentity {
  markerAlias: string;
  operationKind: SharedOperationKind;
  actorAlias: string;
  targetAlias: string;
}

export interface SharedOperationJournalConfig {
  kind: "azure-table-managed-identity";
  endpoint: string;
  tableName: string;
  retentionSeconds: number;
}

export interface SharedOperationRecord extends SharedOperationIdentity {
  schemaVersion: 1;
  state: SharedOperationState;
  recordVersion: number;
  leaseOwner: string;
  leaseExpiresAt: string;
  retainUntil: string;
  terminalAt: string;
  ambiguityReason: "" | "conditional-write-uncertain" | "executing-lease-expired";
  etag: string;
}

export type DispatchClaim =
  | { kind: "dispatch"; record: SharedOperationRecord; reconciled: boolean }
  | {
      kind: "refused";
      reason:
        | "owned-by-another"
        | "terminal-tombstone"
        | "requires-reconciliation"
        | "conditional-conflict"
        | "store-unavailable";
      record?: SharedOperationRecord;
    }
  | { kind: "corrupt" };

export type JournalTransition =
  | { kind: "recorded"; record: SharedOperationRecord; reconciled: boolean }
  | {
      kind: "refused";
      reason:
        | "conditional-conflict"
        | "invalid-state"
        | "store-unavailable";
      record?: SharedOperationRecord;
    }
  | { kind: "corrupt" };

interface StoredOperationEntity extends SharedOperationIdentity {
  schemaVersion: number;
  state: string;
  recordVersion: number;
  leaseOwner: string;
  leaseExpiresAt: string;
  retainUntil: string;
  terminalAt: string;
  ambiguityReason: string;
}

type StoredEntity = TableEntity<StoredOperationEntity>;
type ReadEntity = TableEntityResult<StoredOperationEntity>;

interface TableTransport {
  createEntity<T extends object>(entity: TableEntity<T>): Promise<{ etag?: string }>;
  getEntity<T extends object>(
    partitionKey: string,
    rowKey: string,
  ): Promise<TableEntityResult<T>>;
  updateEntity<T extends object>(
    entity: TableEntity<T>,
    mode: "Replace",
    options: { etag: string },
  ): Promise<{ etag?: string }>;
  deleteEntity(
    partitionKey: string,
    rowKey: string,
    options: { etag: string },
  ): Promise<unknown>;
}

export class SharedOperationJournalError extends Error {
  constructor(message = "SHARED_OPERATION_JOURNAL_REFUSED") {
    super(message);
    this.name = "SharedOperationJournalError";
  }
}

export class AzureTableSharedOperationJournal {
  readonly #client: TableTransport;
  readonly #retentionSeconds: number;

  constructor(client: TableTransport, retentionSeconds: number) {
    if (
      !Number.isSafeInteger(retentionSeconds) ||
      retentionSeconds < 60 ||
      retentionSeconds > MAX_RETENTION_SECONDS
    ) {
      throw new SharedOperationJournalError();
    }
    this.#client = client;
    this.#retentionSeconds = retentionSeconds;
  }

  async acquireDispatch(
    identityValue: unknown,
    leaseOwnerValue: unknown,
    nowValue: unknown,
    leaseSecondsValue: unknown,
  ): Promise<DispatchClaim> {
    const identity = parseIdentity(identityValue);
    const leaseOwner = requireAlias(leaseOwnerValue);
    const now = requireUtc(nowValue);
    const leaseSeconds = requireLeaseSeconds(leaseSecondsValue);
    const keys = operationKeys(identity);

    const firstRead = await this.#read(keys, identity);
    if (firstRead.kind === "corrupt") return firstRead;
    if (firstRead.kind === "unavailable") {
      return { kind: "refused", reason: "store-unavailable" };
    }

    let prepared: SharedOperationRecord;
    if (firstRead.kind === "missing") {
      const entity = newEntity(
        keys,
        identity,
        leaseOwner,
        now,
        leaseSeconds,
        this.#retentionSeconds,
      );
      const created = await this.#create(entity, identity);
      if (created.kind === "corrupt") return created;
      if (created.kind === "unavailable") {
        return { kind: "refused", reason: "store-unavailable" };
      }
      if (created.kind === "uncertain") {
        return { kind: "refused", reason: "requires-reconciliation" };
      }
      if (created.kind === "existing") {
        return this.#claimExisting(created.record, leaseOwner, now, leaseSeconds);
      }
      prepared = created.record;
    } else {
      return this.#claimExisting(firstRead.record, leaseOwner, now, leaseSeconds);
    }

    return this.#startExecuting(prepared, now, leaseSeconds);
  }

  async recordTerminal(
    identityValue: unknown,
    leaseOwnerValue: unknown,
    expectedEtagValue: unknown,
    stateValue: unknown,
    nowValue: unknown,
  ): Promise<JournalTransition> {
    const identity = parseIdentity(identityValue);
    const leaseOwner = requireAlias(leaseOwnerValue);
    const expectedEtag = requireEtag(expectedEtagValue);
    const state = requireTerminalState(stateValue);
    const now = requireUtc(nowValue);
    const current = await this.#read(operationKeys(identity), identity);
    if (current.kind === "corrupt") return current;
    if (current.kind !== "record") {
      return {
        kind: "refused",
        reason: current.kind === "unavailable" ? "store-unavailable" : "invalid-state",
      };
    }
    if (
      current.record.etag !== expectedEtag ||
      current.record.state !== "executing" ||
      current.record.leaseOwner !== leaseOwner
    ) {
      return { kind: "refused", reason: "invalid-state", record: current.record };
    }
    return this.#replace(current.record, {
      ...current.record,
      state,
      recordVersion: current.record.recordVersion + 1,
      leaseOwner: "",
      leaseExpiresAt: "",
      terminalAt: now,
      retainUntil: addSeconds(now, this.#retentionSeconds),
      ambiguityReason: "",
    });
  }

  async recordAmbiguous(
    identityValue: unknown,
    leaseOwnerValue: unknown,
    expectedEtagValue: unknown,
    reasonValue: unknown,
  ): Promise<JournalTransition> {
    const identity = parseIdentity(identityValue);
    const leaseOwner = requireAlias(leaseOwnerValue);
    const expectedEtag = requireEtag(expectedEtagValue);
    const reason = requireAmbiguityReason(reasonValue);
    const current = await this.#read(operationKeys(identity), identity);
    if (current.kind === "corrupt") return current;
    if (current.kind !== "record") {
      return {
        kind: "refused",
        reason: current.kind === "unavailable" ? "store-unavailable" : "invalid-state",
      };
    }
    if (
      current.record.etag !== expectedEtag ||
      current.record.state !== "executing" ||
      current.record.leaseOwner !== leaseOwner
    ) {
      return { kind: "refused", reason: "invalid-state", record: current.record };
    }
    return this.#replace(current.record, {
      ...current.record,
      state: "ambiguous",
      recordVersion: current.record.recordVersion + 1,
      leaseOwner: "",
      leaseExpiresAt: "",
      ambiguityReason: reason,
    });
  }

  async resolveAmbiguous(
    identityValue: unknown,
    expectedEtagValue: unknown,
    stateValue: unknown,
    nowValue: unknown,
  ): Promise<JournalTransition> {
    const identity = parseIdentity(identityValue);
    const expectedEtag = requireEtag(expectedEtagValue);
    const state = requireTerminalState(stateValue);
    const now = requireUtc(nowValue);
    const current = await this.#read(operationKeys(identity), identity);
    if (current.kind === "corrupt") return current;
    if (current.kind !== "record") {
      return {
        kind: "refused",
        reason: current.kind === "unavailable" ? "store-unavailable" : "invalid-state",
      };
    }
    if (
      current.record.etag !== expectedEtag ||
      current.record.state !== "ambiguous"
    ) {
      return { kind: "refused", reason: "invalid-state", record: current.record };
    }
    return this.#replace(current.record, {
      ...current.record,
      state,
      recordVersion: current.record.recordVersion + 1,
      terminalAt: now,
      retainUntil: addSeconds(now, this.#retentionSeconds),
      ambiguityReason: "",
    });
  }

  async retireTerminal(
    identityValue: unknown,
    expectedEtagValue: unknown,
    nowValue: unknown,
    markerRetiredValue: unknown,
  ): Promise<JournalTransition> {
    const identity = parseIdentity(identityValue);
    const expectedEtag = requireEtag(expectedEtagValue);
    const now = requireUtc(nowValue);
    if (markerRetiredValue !== true) throw new SharedOperationJournalError();
    const keys = operationKeys(identity);
    const current = await this.#read(keys, identity);
    if (current.kind === "corrupt") return current;
    if (current.kind !== "record") {
      return {
        kind: "refused",
        reason: current.kind === "unavailable" ? "store-unavailable" : "invalid-state",
      };
    }
    if (
      current.record.etag !== expectedEtag ||
      !TERMINAL_STATES.includes(current.record.state as SharedOperationTerminalState) ||
      Date.parse(current.record.retainUntil) > Date.parse(now)
    ) {
      return { kind: "refused", reason: "invalid-state", record: current.record };
    }
    try {
      await this.#client.deleteEntity(keys.partitionKey, keys.rowKey, {
        etag: expectedEtag,
      });
      return { kind: "recorded", record: current.record, reconciled: false };
    } catch (error) {
      if (isConditionalConflict(error)) {
        const read = await this.#read(keys, identity);
        if (read.kind === "corrupt") return read;
        return {
          kind: "refused",
          reason: read.kind === "unavailable"
            ? "store-unavailable"
            : "conditional-conflict",
          record: read.kind === "record" ? read.record : undefined,
        };
      }
      const read = await this.#read(keys, identity);
      if (read.kind === "corrupt") return read;
      if (read.kind === "missing") {
        return { kind: "recorded", record: current.record, reconciled: true };
      }
      return {
        kind: "refused",
        reason: "store-unavailable",
        record: read.kind === "record" ? read.record : undefined,
      };
    }
  }

  async #claimExisting(
    record: SharedOperationRecord,
    leaseOwner: string,
    now: string,
    leaseSeconds: number,
  ): Promise<DispatchClaim> {
    if (
      record.state === "succeeded" ||
      record.state === "failed"
    ) {
      return { kind: "refused", reason: "terminal-tombstone", record };
    }
    if (record.state === "ambiguous") {
      return { kind: "refused", reason: "requires-reconciliation", record };
    }
    if (record.state === "executing") {
      if (
        record.leaseOwner === leaseOwner &&
        Date.parse(record.leaseExpiresAt) > Date.parse(now)
      ) {
        return { kind: "dispatch", record, reconciled: true };
      }
      if (Date.parse(record.leaseExpiresAt) <= Date.parse(now)) {
        const ambiguity = await this.#replace(record, {
          ...record,
          state: "ambiguous",
          recordVersion: record.recordVersion + 1,
          leaseOwner: "",
          leaseExpiresAt: "",
          ambiguityReason: "executing-lease-expired",
        });
        if (ambiguity.kind === "corrupt") return ambiguity;
        if (ambiguity.kind === "recorded") {
          return {
            kind: "refused",
            reason: "requires-reconciliation",
            record: ambiguity.record,
          };
        }
        return {
          kind: "refused",
          reason: ambiguity.reason === "invalid-state"
            ? "conditional-conflict"
            : ambiguity.reason === "store-unavailable"
              ? "requires-reconciliation"
              : ambiguity.reason,
          record: ambiguity.record,
        };
      }
      return { kind: "refused", reason: "requires-reconciliation", record };
    }
    if (
      record.leaseOwner !== leaseOwner &&
      Date.parse(record.leaseExpiresAt) > Date.parse(now)
    ) {
      return { kind: "refused", reason: "owned-by-another", record };
    }
    if (record.leaseOwner !== leaseOwner) {
      const takeover = await this.#replace(record, {
        ...record,
        recordVersion: record.recordVersion + 1,
        leaseOwner,
        leaseExpiresAt: addSeconds(now, leaseSeconds),
      });
      if (takeover.kind !== "recorded") {
        if (takeover.kind === "corrupt") return takeover;
        return {
          kind: "refused",
          reason: takeover.reason === "invalid-state"
            ? "conditional-conflict"
            : takeover.reason,
          record: takeover.record,
        };
      }
      return this.#startExecuting(takeover.record, now, leaseSeconds);
    }
    return this.#startExecuting(record, now, leaseSeconds);
  }

  async #startExecuting(
    prepared: SharedOperationRecord,
    now: string,
    leaseSeconds: number,
  ): Promise<DispatchClaim> {
    const transition = await this.#replace(prepared, {
      ...prepared,
      state: "executing",
      recordVersion: prepared.recordVersion + 1,
      leaseExpiresAt: addSeconds(now, leaseSeconds),
    });
    if (transition.kind === "corrupt") return transition;
    if (transition.kind === "recorded") {
      return {
        kind: "dispatch",
        record: transition.record,
        reconciled: transition.reconciled,
      };
    }
    return {
      kind: "refused",
      reason: transition.reason === "store-unavailable"
        ? "requires-reconciliation"
        : transition.reason === "invalid-state"
          ? "conditional-conflict"
          : transition.reason,
      record: transition.record,
    };
  }

  async #create(
    entity: StoredEntity,
    identity: SharedOperationIdentity,
  ): Promise<
    | { kind: "record"; record: SharedOperationRecord }
    | { kind: "existing"; record: SharedOperationRecord }
    | { kind: "uncertain" }
    | { kind: "unavailable" }
    | { kind: "corrupt" }
  > {
    try {
      const response = await this.#client.createEntity(entity);
      if (response.etag) {
        return { kind: "record", record: parseStored(entity, response.etag, identity) };
      }
      const read = await this.#read(
        { partitionKey: entity.partitionKey, rowKey: entity.rowKey },
        identity,
      );
      return read.kind === "record" ? read : read.kind === "corrupt"
        ? read
        : { kind: "uncertain" };
    } catch (error) {
      if (isAlreadyExists(error)) {
        const read = await this.#read(
          { partitionKey: entity.partitionKey, rowKey: entity.rowKey },
          identity,
        );
        return read.kind === "record"
          ? { kind: "existing", record: read.record }
          : read.kind === "corrupt"
            ? read
            : { kind: "unavailable" };
      }
      const read = await this.#read(
        { partitionKey: entity.partitionKey, rowKey: entity.rowKey },
        identity,
      );
      if (read.kind === "record" && matchesStored(read.record, entity)) {
        return { kind: "record", record: read.record };
      }
      return read.kind === "corrupt" ? read : { kind: "uncertain" };
    }
  }

  async #replace(
    current: SharedOperationRecord,
    next: SharedOperationRecord,
  ): Promise<JournalTransition> {
    const keys = keysForIdentity(parseIdentity(current, true));
    const entity = toStored(keys, next);
    try {
      const response = await this.#client.updateEntity(entity, "Replace", {
        etag: current.etag,
      });
      if (response.etag) {
        return {
          kind: "recorded",
          record: parseStored(entity, response.etag, current),
          reconciled: false,
        };
      }
    } catch (error) {
      if (isConditionalConflict(error)) {
        const read = await this.#read(keys, current);
        return read.kind === "record"
          ? { kind: "refused", reason: "conditional-conflict", record: read.record }
          : read.kind === "corrupt"
            ? read
            : { kind: "refused", reason: "store-unavailable" };
      }
    }
    const read = await this.#read(keys, current);
    if (read.kind === "record" && matchesStored(read.record, entity)) {
      return { kind: "recorded", record: read.record, reconciled: true };
    }
    if (read.kind === "corrupt") return read;
    return { kind: "refused", reason: "store-unavailable" };
  }

  async #read(
    keys: { partitionKey: string; rowKey: string },
    identity: SharedOperationIdentity,
  ): Promise<
    | { kind: "record"; record: SharedOperationRecord }
    | { kind: "missing" }
    | { kind: "unavailable" }
    | { kind: "corrupt" }
  > {
    try {
      const entity = await this.#client.getEntity<StoredOperationEntity>(
        keys.partitionKey,
        keys.rowKey,
      );
      return { kind: "record", record: parseStored(entity, entity.etag, identity) };
    } catch (error) {
      if (isNotFound(error)) return { kind: "missing" };
      if (error instanceof SharedOperationJournalError) return { kind: "corrupt" };
      return { kind: "unavailable" };
    }
  }
}

export function createManagedIdentitySharedOperationJournal(
  configValue: unknown,
  credential: TokenCredential = new ManagedIdentityCredential(),
): AzureTableSharedOperationJournal {
  const config = parseSharedOperationJournalConfig(configValue);
  return new AzureTableSharedOperationJournal(
    new TableClient(config.endpoint, config.tableName, credential, {
      retryOptions: { maxRetries: 0 },
    }),
    config.retentionSeconds,
  );
}

export function parseSharedOperationJournalConfig(
  value: unknown,
): SharedOperationJournalConfig {
  const record = requireRecord(value);
  exactKeys(record, ["endpoint", "kind", "retentionSeconds", "tableName"]);
  if (
    record.kind !== "azure-table-managed-identity" ||
    typeof record.endpoint !== "string" ||
    typeof record.tableName !== "string" ||
    !TABLE_PATTERN.test(record.tableName) ||
    !Number.isSafeInteger(record.retentionSeconds) ||
    (record.retentionSeconds as number) < 60 ||
    (record.retentionSeconds as number) > MAX_RETENTION_SECONDS
  ) {
    throw new SharedOperationJournalError();
  }
  let endpoint: URL;
  try {
    endpoint = new URL(record.endpoint);
  } catch {
    throw new SharedOperationJournalError();
  }
  if (
    endpoint.protocol !== "https:" ||
    !/^[a-z0-9]{3,24}\.table\.core\.windows\.net$/.test(endpoint.hostname) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    (endpoint.pathname !== "" && endpoint.pathname !== "/")
  ) {
    throw new SharedOperationJournalError();
  }
  return Object.freeze({
    kind: "azure-table-managed-identity",
    endpoint: endpoint.origin,
    tableName: record.tableName,
    retentionSeconds: record.retentionSeconds as number,
  });
}

export function operationKeys(identityValue: unknown): {
  partitionKey: string;
  rowKey: string;
} {
  const identity = parseIdentity(identityValue);
  return keysForIdentity(identity);
}

function keysForIdentity(identity: SharedOperationIdentity): {
  partitionKey: string;
  rowKey: string;
} {
  return {
    partitionKey: `v1-${digest(identity.markerAlias).slice(0, 32)}`,
    rowKey: digest([
      identity.markerAlias,
      identity.operationKind,
      identity.actorAlias,
      identity.targetAlias,
    ].join("\n")),
  };
}

function newEntity(
  keys: { partitionKey: string; rowKey: string },
  identity: SharedOperationIdentity,
  leaseOwner: string,
  now: string,
  leaseSeconds: number,
  retentionSeconds: number,
): StoredEntity {
  return {
    ...keys,
    schemaVersion: SCHEMA_VERSION,
    ...identity,
    state: "prepared",
    recordVersion: 1,
    leaseOwner,
    leaseExpiresAt: addSeconds(now, leaseSeconds),
    retainUntil: addSeconds(now, retentionSeconds),
    terminalAt: "",
    ambiguityReason: "",
  };
}

function toStored(
  keys: { partitionKey: string; rowKey: string },
  record: SharedOperationRecord,
): StoredEntity {
  const { etag: _etag, ...properties } = record;
  return { ...keys, ...properties };
}

function parseStored(
  value: StoredEntity | ReadEntity,
  etagValue: unknown,
  expectedIdentity: SharedOperationIdentity,
): SharedOperationRecord {
  const record = requireRecord(value);
  const normalizedExpectedIdentity = parseIdentity(expectedIdentity, true);
  const allowed = [
    "actorAlias",
    "ambiguityReason",
    "etag",
    "leaseExpiresAt",
    "leaseOwner",
    "markerAlias",
    "operationKind",
    "odata.metadata",
    "partitionKey",
    "recordVersion",
    "retainUntil",
    "rowKey",
    "schemaVersion",
    "state",
    "targetAlias",
    "terminalAt",
    "timestamp",
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new SharedOperationJournalError("SHARED_OPERATION_JOURNAL_SHAPE_REFUSED");
  }
  const parsedIdentity = parseIdentity(record, true);
  if (
    JSON.stringify(parsedIdentity) !== JSON.stringify(normalizedExpectedIdentity) ||
    record.schemaVersion !== SCHEMA_VERSION ||
    !STATES.includes(record.state as SharedOperationState) ||
    !Number.isSafeInteger(record.recordVersion) ||
    (record.recordVersion as number) < 1
  ) {
    throw new SharedOperationJournalError("SHARED_OPERATION_JOURNAL_FIELDS_REFUSED");
  }
  const state = record.state as SharedOperationState;
  const leaseOwner = record.leaseOwner === "" ? "" : requireAlias(record.leaseOwner);
  const leaseExpiresAt = record.leaseExpiresAt === "" ? "" : requireUtc(record.leaseExpiresAt);
  const terminalAt = record.terminalAt === "" ? "" : requireUtc(record.terminalAt);
  const retainUntil = requireUtc(record.retainUntil);
  const ambiguityReason = record.ambiguityReason;
  const keys = keysForIdentity(parsedIdentity);
  if (
    !["", "conditional-write-uncertain", "executing-lease-expired"].includes(
      ambiguityReason as string,
    ) ||
    record.partitionKey !== keys.partitionKey ||
    record.rowKey !== keys.rowKey ||
    ((state === "prepared" || state === "executing") &&
      (leaseOwner === "" ||
        leaseExpiresAt === "" ||
        terminalAt !== "" ||
        ambiguityReason !== "")) ||
    ((state === "succeeded" || state === "failed") &&
      (terminalAt === "" || ambiguityReason !== "")) ||
    (state === "ambiguous" &&
      (terminalAt !== "" || ambiguityReason === "")) ||
    ((state === "succeeded" || state === "failed" || state === "ambiguous") &&
      (leaseOwner !== "" || leaseExpiresAt !== ""))
  ) {
    throw new SharedOperationJournalError("SHARED_OPERATION_JOURNAL_STATE_REFUSED");
  }
  return {
    schemaVersion: 1,
    ...parsedIdentity,
    state,
    recordVersion: record.recordVersion as number,
    leaseOwner,
    leaseExpiresAt,
    retainUntil,
    terminalAt,
    ambiguityReason: ambiguityReason as SharedOperationRecord["ambiguityReason"],
    etag: requireEtag(etagValue),
  };
}

function matchesStored(record: SharedOperationRecord, entity: StoredEntity): boolean {
  const { partitionKey: _partitionKey, rowKey: _rowKey, ...expected } = entity;
  const { etag: _etag, ...actual } = record;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function parseIdentity(
  value: unknown,
  allowAdditionalFields = false,
): SharedOperationIdentity {
  const record = requireRecord(value);
  if (!allowAdditionalFields) {
    exactKeys(record, [
      "actorAlias",
      "markerAlias",
      "operationKind",
      "targetAlias",
    ]);
  }
  if (
    typeof record.markerAlias !== "string" ||
    !MARKER_PATTERN.test(record.markerAlias) ||
    looksSensitive(record.markerAlias) ||
    !OPERATION_KINDS.includes(record.operationKind as SharedOperationKind)
  ) {
    throw new SharedOperationJournalError();
  }
  return {
    markerAlias: record.markerAlias,
    operationKind: record.operationKind as SharedOperationKind,
    actorAlias: requireAlias(record.actorAlias),
    targetAlias: requireAlias(record.targetAlias),
  };
}

function requireAlias(value: unknown): string {
  if (
    typeof value !== "string" ||
    !ALIAS_PATTERN.test(value) ||
    looksSensitive(value)
  ) {
    throw new SharedOperationJournalError();
  }
  return value;
}

function looksSensitive(value: string): boolean {
  return (
    value.includes("@") ||
    value.includes("/") ||
    value.includes("\\") ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ||
    /(?:token|secret|password|credential|certificate)/i.test(value)
  );
}

function requireUtc(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new SharedOperationJournalError();
  }
  return value;
}

function requireEtag(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /[\r\n]/.test(value)
  ) {
    throw new SharedOperationJournalError();
  }
  return value;
}

function requireLeaseSeconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 5 ||
    (value as number) > MAX_LEASE_SECONDS
  ) {
    throw new SharedOperationJournalError();
  }
  return value as number;
}

function requireTerminalState(value: unknown): SharedOperationTerminalState {
  if (!TERMINAL_STATES.includes(value as SharedOperationTerminalState)) {
    throw new SharedOperationJournalError();
  }
  return value as SharedOperationTerminalState;
}

function requireAmbiguityReason(
  value: unknown,
): SharedOperationRecord["ambiguityReason"] {
  if (
    value !== "conditional-write-uncertain" &&
    value !== "executing-lease-expired"
  ) {
    throw new SharedOperationJournalError();
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SharedOperationJournalError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(record).sort().join(",") !== [...expected].sort().join(",")) {
    throw new SharedOperationJournalError();
  }
}

function addSeconds(value: string, seconds: number): string {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function statusCode(error: unknown): number | undefined {
  if (error instanceof RestError) return error.statusCode;
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

function isAlreadyExists(error: unknown): boolean {
  return statusCode(error) === 409;
}

function isConditionalConflict(error: unknown): boolean {
  return statusCode(error) === 409 || statusCode(error) === 412;
}
