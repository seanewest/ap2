import {
  MAX_OPERATION_DURATION_MS,
  OPERATION_AMBIGUITY_STATES,
  OPERATION_KINDS,
  OPERATION_OUTCOMES,
  OPERATION_PHASES,
  OPERATION_REASON_CATEGORIES,
  OPERATION_RECOVERY_STATES,
  OPERATION_TELEMETRY_SCHEMA_VERSION,
  type OperationTelemetryEvent,
  type OperationTelemetrySink,
} from "./operation-telemetry.js";

export const OPERATION_TELEMETRY_MAX_EVENTS = 64;
export const OPERATION_TELEMETRY_MAX_AGE_MS = 15 * 60 * 1_000;
export const OPERATION_TELEMETRY_MAX_RESPONSE_BYTES = 16 * 1_024;

export const OPERATION_TELEMETRY_ORDERS = ["newest", "oldest"] as const;
export type OperationTelemetryOrder =
  typeof OPERATION_TELEMETRY_ORDERS[number];

export interface OperationTelemetrySnapshot {
  schemaVersion: typeof OPERATION_TELEMETRY_SCHEMA_VERSION;
  order: OperationTelemetryOrder;
  events: readonly Readonly<OperationTelemetryEvent>[];
}

export interface OperationTelemetryReader {
  snapshot(order: OperationTelemetryOrder): OperationTelemetrySnapshot;
}

interface CollectorOptions {
  maxEvents?: number;
  maxAgeMs?: number;
  maxResponseBytes?: number;
  clock?: () => number;
}

interface StoredEvent {
  readonly recordedAt: number;
  readonly event: Readonly<OperationTelemetryEvent>;
}

const EVENT_KEYS = new Set([
  "schemaVersion",
  "markerHash",
  "operationKind",
  "phase",
  "outcome",
  "durationMs",
  "reason",
  "ambiguityState",
  "recoveryState",
  "upstreamStatus",
]);
const MARKER_HASH = /^m1_[0-9a-f]{24}$/;

export class InMemoryOperationTelemetryCollector
  implements OperationTelemetrySink, OperationTelemetryReader
{
  readonly #maxEvents: number;
  readonly #maxAgeMs: number;
  readonly #maxResponseBytes: number;
  readonly #clock: () => number;
  #events: StoredEvent[] = [];

  constructor(options: CollectorOptions = {}) {
    this.#maxEvents = positiveInteger(
      options.maxEvents ?? OPERATION_TELEMETRY_MAX_EVENTS,
      "maxEvents",
    );
    this.#maxAgeMs = positiveInteger(
      options.maxAgeMs ?? OPERATION_TELEMETRY_MAX_AGE_MS,
      "maxAgeMs",
    );
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? OPERATION_TELEMETRY_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    );
    this.#clock = options.clock ?? Date.now;
    if (
      responseBytes({
        schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
        order: "newest",
        events: [],
      }) > this.#maxResponseBytes
    ) {
      throw new TypeError("maxResponseBytes cannot fit an empty snapshot.");
    }
  }

  record(event: Readonly<OperationTelemetryEvent>): void {
    const recordedAt = this.#now();
    const safeEvent = copySafeEvent(event);
    this.#prune(recordedAt);
    this.#events.push({
      recordedAt,
      event: Object.freeze(safeEvent),
    });
    if (this.#events.length > this.#maxEvents) {
      this.#events.splice(0, this.#events.length - this.#maxEvents);
    }
  }

  snapshot(order: OperationTelemetryOrder): OperationTelemetrySnapshot {
    if (!OPERATION_TELEMETRY_ORDERS.includes(order)) {
      throw new TypeError("Operation telemetry order is invalid.");
    }
    this.#prune(this.#now());

    const retained = [...this.#events];
    while (
      retained.length > 0 &&
      responseBytes(this.#snapshotFrom(retained, order)) >
        this.#maxResponseBytes
    ) {
      retained.shift();
    }
    return this.#snapshotFrom(retained, order);
  }

  #snapshotFrom(
    stored: readonly StoredEvent[],
    order: OperationTelemetryOrder,
  ): OperationTelemetrySnapshot {
    const ordered = order === "newest" ? [...stored].reverse() : [...stored];
    const events = ordered.map(({ event }) =>
      Object.freeze({ ...event })
    );
    return Object.freeze({
      schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
      order,
      events: Object.freeze(events),
    });
  }

  #prune(now: number): void {
    const oldestAllowed = now - this.#maxAgeMs;
    this.#events = this.#events.filter(
      ({ recordedAt }) => recordedAt >= oldestAllowed,
    );
  }

  #now(): number {
    const value = this.#clock();
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("Operation telemetry clock is invalid.");
    }
    return Math.floor(value);
  }
}

function copySafeEvent(
  event: Readonly<OperationTelemetryEvent>,
): OperationTelemetryEvent {
  if (
    typeof event !== "object" ||
    event === null ||
    Object.keys(event).some((key) => !EVENT_KEYS.has(key)) ||
    event.schemaVersion !== OPERATION_TELEMETRY_SCHEMA_VERSION ||
    !MARKER_HASH.test(event.markerHash) ||
    !OPERATION_KINDS.includes(event.operationKind) ||
    !OPERATION_PHASES.includes(event.phase) ||
    !OPERATION_OUTCOMES.includes(event.outcome) ||
    !Number.isInteger(event.durationMs) ||
    event.durationMs < 0 ||
    event.durationMs > MAX_OPERATION_DURATION_MS ||
    !OPERATION_REASON_CATEGORIES.includes(event.reason) ||
    !OPERATION_AMBIGUITY_STATES.includes(event.ambiguityState) ||
    !OPERATION_RECOVERY_STATES.includes(event.recoveryState) ||
    (
      event.upstreamStatus !== undefined &&
      (
        !Number.isInteger(event.upstreamStatus) ||
        event.upstreamStatus < 100 ||
        event.upstreamStatus > 599
      )
    )
  ) {
    throw new TypeError("Operation telemetry event is invalid.");
  }
  return {
    schemaVersion: event.schemaVersion,
    markerHash: event.markerHash,
    operationKind: event.operationKind,
    phase: event.phase,
    outcome: event.outcome,
    durationMs: event.durationMs,
    reason: event.reason,
    ambiguityState: event.ambiguityState,
    recoveryState: event.recoveryState,
    ...(event.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: event.upstreamStatus }),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function responseBytes(snapshot: OperationTelemetrySnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}
