// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  InMemoryOperationTelemetryCollector,
  OPERATION_TELEMETRY_MAX_AGE_MS,
  OPERATION_TELEMETRY_MAX_EVENTS,
  OPERATION_TELEMETRY_MAX_RESPONSE_BYTES,
} from "./operation-telemetry-collector.js";
import {
  OperationTelemetry,
  type OperationTelemetryEvent,
} from "./operation-telemetry.js";

const HASH = "m1_0123456789abcdef01234567";

function event(
  outcome: OperationTelemetryEvent["outcome"],
  overrides: Partial<OperationTelemetryEvent> = {},
): OperationTelemetryEvent {
  return {
    schemaVersion: 1,
    markerHash: HASH,
    operationKind: "calendar.create",
    phase: "execution",
    outcome,
    durationMs: outcome === "started" ? 0 : 4,
    reason: "none",
    ambiguityState: "none",
    recoveryState: outcome === "started" ? "not-applicable" : "not-needed",
    ...overrides,
  };
}

describe("InMemoryOperationTelemetryCollector", () => {
  it("uses conservative bounded process-local defaults", () => {
    expect(OPERATION_TELEMETRY_MAX_EVENTS).toBe(64);
    expect(OPERATION_TELEMETRY_MAX_AGE_MS).toBe(15 * 60 * 1_000);
    expect(OPERATION_TELEMETRY_MAX_RESPONSE_BYTES).toBe(16 * 1_024);
  });

  it("returns an empty immutable snapshot", () => {
    const collector = new InMemoryOperationTelemetryCollector({
      clock: () => 1_000,
    });
    const snapshot = collector.snapshot("newest");
    expect(snapshot).toEqual({ schemaVersion: 1, order: "newest", events: [] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
  });

  it("records a normal two-event run in deterministic orders", () => {
    let now = 1_000;
    const collector = new InMemoryOperationTelemetryCollector({
      clock: () => now,
    });
    collector.record(event("started"));
    now += 1;
    collector.record(event("succeeded"));
    expect(
      collector.snapshot("newest").events.map(({ outcome }) => outcome),
    ).toEqual(["succeeded", "started"]);
    expect(
      collector.snapshot("oldest").events.map(({ outcome }) => outcome),
    ).toEqual(["started", "succeeded"]);
  });

  it("keeps the four-event recovery maximum emitted by one run", () => {
    let now = 1_000;
    const collector = new InMemoryOperationTelemetryCollector({
      clock: () => now++,
    });
    const telemetry = new OperationTelemetry(
      "calendar-recovery-fixture",
      collector,
      () => now++,
    );
    const run = telemetry.begin("calendar.cancel", "cleanup");
    const recovery = run.beginRecovery();
    recovery.finish("succeeded", { recoveryState: "reconciled" });
    run.finish("succeeded", { recoveryState: "reconciled" });
    expect(collector.snapshot("oldest").events).toHaveLength(4);
    expect(
      collector.snapshot("oldest").events.map(({ phase, outcome }) => [
        phase,
        outcome,
      ]),
    ).toEqual([
      ["cleanup", "started"],
      ["recovery", "started"],
      ["recovery", "succeeded"],
      ["cleanup", "succeeded"],
    ]);
  });

  it("evicts oldest events at capacity", () => {
    let now = 1_000;
    const collector = new InMemoryOperationTelemetryCollector({
      maxEvents: 2,
      clock: () => now,
    });
    collector.record(event("started"));
    now += 1;
    collector.record(event("refused"));
    now += 1;
    collector.record(event("succeeded"));
    expect(
      collector.snapshot("oldest").events.map(({ outcome }) => outcome),
    ).toEqual(["refused", "succeeded"]);
  });

  it("prunes expired events on writes and reads", () => {
    let now = 1_000;
    const collector = new InMemoryOperationTelemetryCollector({
      maxAgeMs: 10,
      clock: () => now,
    });
    collector.record(event("started"));
    now = 1_011;
    expect(collector.snapshot("newest").events).toEqual([]);
    collector.record(event("succeeded"));
    expect(collector.snapshot("newest").events).toHaveLength(1);
  });

  it("drops oldest retained events to enforce serialized response size", () => {
    let now = 1_000;
    const oneEventBytes = Buffer.byteLength(JSON.stringify({
      schemaVersion: 1,
      order: "newest",
      events: [event("succeeded")],
    }));
    const collector = new InMemoryOperationTelemetryCollector({
      maxResponseBytes: oneEventBytes,
      clock: () => now,
    });
    collector.record(event("started"));
    now += 1;
    collector.record(event("succeeded"));
    const snapshot = collector.snapshot("newest");
    expect(snapshot.events.map(({ outcome }) => outcome)).toEqual([
      "succeeded",
    ]);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(
      oneEventBytes,
    );
  });

  it("rejects arbitrary fields and invalid safe fields", () => {
    const collector = new InMemoryOperationTelemetryCollector();
    expect(() =>
      collector.record({
        ...event("started"),
        rawMarker: "private marker",
      } as OperationTelemetryEvent)
    ).toThrow(TypeError);
    expect(() =>
      collector.record(event("started", { markerHash: "raw-marker" }))
    ).toThrow(TypeError);
    expect(collector.snapshot("newest").events).toEqual([]);
  });

  it("returns copies that cannot mutate stored events", () => {
    const collector = new InMemoryOperationTelemetryCollector();
    collector.record(event("succeeded"));
    const first = collector.snapshot("newest");
    expect(Object.isFrozen(first.events[0])).toBe(true);
    expect(() => {
      (first.events[0] as { outcome: string }).outcome = "ambiguous";
    }).toThrow(TypeError);
    expect(collector.snapshot("newest").events[0]?.outcome).toBe("succeeded");
  });
});
