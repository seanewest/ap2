// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  BestEffortOperationTelemetrySink,
  MAX_OPERATION_DURATION_MS,
  MAX_OPERATION_EVENTS_PER_RUN,
  MAX_OPERATION_MARKER_LENGTH,
  OPERATION_AMBIGUITY_STATES,
  OPERATION_KINDS,
  OPERATION_OUTCOMES,
  OPERATION_PHASES,
  OPERATION_REASON_CATEGORIES,
  OPERATION_RECOVERY_STATES,
  OPERATION_TELEMETRY_SCHEMA_VERSION,
  OperationTelemetry,
  StructuredConsoleOperationTelemetrySink,
  type OperationTelemetryEvent,
  type OperationTelemetrySink,
} from "./operation-telemetry.js";

function collector(): {
  events: OperationTelemetryEvent[];
  sink: OperationTelemetrySink;
} {
  const events: OperationTelemetryEvent[] = [];
  return {
    events,
    sink: { record: (event) => events.push(event) },
  };
}

function clock(...values: number[]): () => number {
  return () => {
    const value = values.shift();
    if (value === undefined) {
      throw new Error("Unexpected clock read.");
    }
    return value;
  };
}

describe("operation telemetry contract", () => {
  it("isolates each best-effort sink from operations and other sinks", () => {
    const received: OperationTelemetryEvent[] = [];
    const sink = new BestEffortOperationTelemetrySink(
      { record: () => { throw new Error("collector unavailable"); } },
      { record: (value) => received.push(value) },
    );
    const telemetry = new OperationTelemetry("safe-fanout", sink);

    const run = telemetry.begin("calendar.create", "execution");
    run.finish("succeeded");

    expect(received.map(({ outcome }) => outcome)).toEqual([
      "started",
      "succeeded",
    ]);
  });

  it("emits only the fixed safe schema with a bounded marker hash", () => {
    const fixture = collector();
    const marker =
      "ap2-secret-password-cookie-token-certificate-browser-cache-message-file";
    const telemetry = new OperationTelemetry(
      marker,
      fixture.sink,
      clock(100, 145),
    );

    const run = telemetry.begin("calendar.create", "execution");
    run.finish("refused", {
      reason: "upstream-refusal",
      upstreamStatus: 429,
    });

    expect(fixture.events).toHaveLength(2);
    expect(fixture.events[0]).toEqual({
      schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
      markerHash: expect.stringMatching(/^m1_[0-9a-f]{24}$/),
      operationKind: "calendar.create",
      phase: "execution",
      outcome: "started",
      durationMs: 0,
      reason: "none",
      ambiguityState: "none",
      recoveryState: "not-applicable",
    });
    expect(fixture.events[1]).toEqual({
      schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
      markerHash: fixture.events[0]?.markerHash,
      operationKind: "calendar.create",
      phase: "execution",
      outcome: "refused",
      durationMs: 45,
      reason: "upstream-refusal",
      ambiguityState: "none",
      recoveryState: "not-needed",
      upstreamStatus: 429,
    });
    const serialized = JSON.stringify(fixture.events);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("certificate");
    expect(serialized).not.toContain("browser");
    expect(serialized).not.toContain("cache");
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("file");
  });

  it("bounds label values, duration, and events per operation run", () => {
    const fixture = collector();
    const telemetry = new OperationTelemetry(
      "ap2-calendar-cardinality",
      fixture.sink,
      clock(0, 1, MAX_OPERATION_DURATION_MS + 100, 2),
    );

    const run = telemetry.begin("calendar.cancel", "cleanup");
    const recovery = run.beginRecovery();
    expect(run.beginRecovery()).toBe(recovery);
    recovery.finish("ambiguous", {
      reason: "upstream-unavailable",
      ambiguityState: "unresolved",
      recoveryState: "unresolved",
      upstreamStatus: 999,
    });
    recovery.finish("succeeded");
    run.finish("ambiguous", {
      reason: "upstream-unavailable",
      ambiguityState: "possible-mutation",
      recoveryState: "unresolved",
    });
    run.finish("succeeded");

    expect(fixture.events).toHaveLength(MAX_OPERATION_EVENTS_PER_RUN);
    expect(fixture.events[2]?.durationMs).toBe(MAX_OPERATION_DURATION_MS);
    expect(fixture.events[2]).not.toHaveProperty("upstreamStatus");
    for (const event of fixture.events) {
      expect(OPERATION_KINDS).toContain(event.operationKind);
      expect(OPERATION_PHASES).toContain(event.phase);
      expect(OPERATION_OUTCOMES).toContain(event.outcome);
      expect(OPERATION_REASON_CATEGORIES).toContain(event.reason);
      expect(OPERATION_AMBIGUITY_STATES).toContain(event.ambiguityState);
      expect(OPERATION_RECOVERY_STATES).toContain(event.recoveryState);
      expect(Object.keys(event).sort()).toEqual(
        [
          "ambiguityState",
          "durationMs",
          "markerHash",
          "operationKind",
          "outcome",
          "phase",
          "reason",
          "recoveryState",
          "schemaVersion",
        ].sort(),
      );
    }
  });

  it("rejects unbounded or unsafe markers before an operation begins", () => {
    for (const marker of [
      "",
      "contains spaces",
      "contains/user/data",
      "x".repeat(MAX_OPERATION_MARKER_LENGTH + 1),
    ]) {
      expect(() => new OperationTelemetry(marker)).toThrow(
        "Operation telemetry marker is invalid.",
      );
    }
    expect(() =>
      new OperationTelemetry("a".repeat(MAX_OPERATION_MARKER_LENGTH))
    ).not.toThrow();
  });

  it("isolates sink and clock defects from terminal operation behavior", () => {
    const sink = {
      record: vi.fn(() => {
        throw new Error("sink body with bearer credential");
      }),
    };
    const telemetry = new OperationTelemetry(
      "ap2-calendar-sink-failure",
      sink,
      (() => {
        let reads = 0;
        return () => {
          if (reads++ === 0) {
            return Number.NaN;
          }
          throw new Error("clock failure");
        };
      })(),
    );

    expect(() => {
      const run = telemetry.begin("calendar.create", "execution");
      run.finish("succeeded");
    }).not.toThrow();
    expect(sink.record).toHaveBeenCalledTimes(2);
  });

  it("serializes a structured console event without adding fields", () => {
    const write = vi.fn();
    const sink = new StructuredConsoleOperationTelemetrySink(write);
    const event: OperationTelemetryEvent = {
      schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
      markerHash: "m1_111111111111111111111111",
      operationKind: "calendar.create",
      phase: "execution",
      outcome: "succeeded",
      durationMs: 12,
      reason: "none",
      ambiguityState: "none",
      recoveryState: "not-needed",
    };

    sink.record(event);

    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toEqual(event);
  });
});
