import { createHash } from "node:crypto";

export const OPERATION_TELEMETRY_SCHEMA_VERSION = 1;
export const MAX_OPERATION_MARKER_LENGTH = 128;
export const MAX_OPERATION_DURATION_MS = 86_400_000;
export const MAX_OPERATION_EVENTS_PER_RUN = 4;

export const OPERATION_KINDS = [
  "calendar.create",
  "calendar.cancel",
] as const;
export type OperationKind = typeof OPERATION_KINDS[number];

export const OPERATION_PHASES = [
  "execution",
  "cleanup",
  "recovery",
] as const;
export type OperationPhase = typeof OPERATION_PHASES[number];

export const OPERATION_OUTCOMES = [
  "started",
  "succeeded",
  "refused",
  "ambiguous",
] as const;
export type OperationOutcome = typeof OPERATION_OUTCOMES[number];

export const OPERATION_REASON_CATEGORIES = [
  "none",
  "precondition-refusal",
  "upstream-refusal",
  "upstream-unavailable",
  "invalid-upstream-shape",
  "unexpected",
] as const;
export type OperationReasonCategory =
  typeof OPERATION_REASON_CATEGORIES[number];

export const OPERATION_AMBIGUITY_STATES = [
  "none",
  "possible-mutation",
  "unresolved",
] as const;
export type OperationAmbiguityState =
  typeof OPERATION_AMBIGUITY_STATES[number];

export const OPERATION_RECOVERY_STATES = [
  "not-applicable",
  "not-needed",
  "in-progress",
  "reconciled",
  "unresolved",
] as const;
export type OperationRecoveryState =
  typeof OPERATION_RECOVERY_STATES[number];

export interface OperationTelemetryEvent {
  schemaVersion: typeof OPERATION_TELEMETRY_SCHEMA_VERSION;
  markerHash: string;
  operationKind: OperationKind;
  phase: OperationPhase;
  outcome: OperationOutcome;
  durationMs: number;
  reason: OperationReasonCategory;
  ambiguityState: OperationAmbiguityState;
  recoveryState: OperationRecoveryState;
  upstreamStatus?: number;
}

export interface OperationTelemetrySink {
  record(event: Readonly<OperationTelemetryEvent>): void;
}

export interface OperationTerminalDetails {
  reason?: OperationReasonCategory;
  ambiguityState?: OperationAmbiguityState;
  recoveryState?: OperationRecoveryState;
  upstreamStatus?: number;
}

type TerminalOutcome = Exclude<OperationOutcome, "started">;
type Clock = () => number;

const NOOP_SINK: OperationTelemetrySink = { record: () => undefined };
const SAFE_MARKER = /^[a-z0-9][a-z0-9._:-]*$/;

export class OperationTelemetry {
  readonly #markerHash: string;
  readonly #sink: OperationTelemetrySink;
  readonly #clock: Clock;

  constructor(
    operationMarker: string,
    sink: OperationTelemetrySink = NOOP_SINK,
    clock: Clock = Date.now,
  ) {
    if (
      operationMarker.length === 0 ||
      operationMarker.length > MAX_OPERATION_MARKER_LENGTH ||
      !SAFE_MARKER.test(operationMarker)
    ) {
      throw new TypeError("Operation telemetry marker is invalid.");
    }
    this.#markerHash = markerHash(operationMarker);
    this.#sink = sink;
    this.#clock = clock;
  }

  begin(
    operationKind: OperationKind,
    phase: Exclude<OperationPhase, "recovery">,
  ): OperationTelemetryRun {
    return new OperationTelemetryRun(
      this.#markerHash,
      operationKind,
      phase,
      this.#sink,
      this.#clock,
    );
  }
}

export class StructuredConsoleOperationTelemetrySink
  implements OperationTelemetrySink
{
  readonly #write: (message: string) => void;

  constructor(
    write: (message: string) => void = (message) => console.info(message),
  ) {
    this.#write = write;
  }

  record(event: Readonly<OperationTelemetryEvent>): void {
    this.#write(JSON.stringify(event));
  }
}

export class OperationTelemetryRun {
  readonly #markerHash: string;
  readonly #operationKind: OperationKind;
  readonly #phase: Exclude<OperationPhase, "recovery">;
  readonly #sink: OperationTelemetrySink;
  readonly #clock: Clock;
  readonly #startedAt: number;
  #finished = false;
  #recovery: OperationTelemetryRecovery | undefined;

  constructor(
    markerHashValue: string,
    operationKind: OperationKind,
    phase: Exclude<OperationPhase, "recovery">,
    sink: OperationTelemetrySink,
    clock: Clock,
  ) {
    this.#markerHash = markerHashValue;
    this.#operationKind = operationKind;
    this.#phase = phase;
    this.#sink = sink;
    this.#clock = clock;
    this.#startedAt = safeNow(clock);
    this.#emit({
      phase,
      outcome: "started",
      durationMs: 0,
      reason: "none",
      ambiguityState: "none",
      recoveryState: "not-applicable",
    });
  }

  beginRecovery(): OperationTelemetryRecovery {
    if (!this.#recovery) {
      this.#recovery = new OperationTelemetryRecovery(
        this.#markerHash,
        this.#operationKind,
        this.#sink,
        this.#clock,
      );
    }
    return this.#recovery;
  }

  finish(
    outcome: TerminalOutcome,
    details: OperationTerminalDetails = {},
  ): void {
    if (this.#finished) {
      return;
    }
    this.#finished = true;
    const upstreamStatus = safeHttpStatus(details.upstreamStatus);
    this.#emit({
      phase: this.#phase,
      outcome,
      durationMs: elapsed(this.#startedAt, safeNow(this.#clock)),
      reason: details.reason ?? "none",
      ambiguityState: details.ambiguityState ?? "none",
      recoveryState: details.recoveryState ?? "not-needed",
      ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    });
  }

  #emit(
    event: Omit<
      OperationTelemetryEvent,
      "schemaVersion" | "markerHash" | "operationKind"
    >,
  ): void {
    safeRecord(this.#sink, {
      schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
      markerHash: this.#markerHash,
      operationKind: this.#operationKind,
      ...event,
    });
  }
}

export class OperationTelemetryRecovery {
  readonly #markerHash: string;
  readonly #operationKind: OperationKind;
  readonly #sink: OperationTelemetrySink;
  readonly #clock: Clock;
  readonly #startedAt: number;
  #finished = false;

  constructor(
    markerHashValue: string,
    operationKind: OperationKind,
    sink: OperationTelemetrySink,
    clock: Clock,
  ) {
    this.#markerHash = markerHashValue;
    this.#operationKind = operationKind;
    this.#sink = sink;
    this.#clock = clock;
    this.#startedAt = safeNow(clock);
    this.#emit({
      outcome: "started",
      durationMs: 0,
      reason: "none",
      ambiguityState: "none",
      recoveryState: "in-progress",
    });
  }

  finish(
    outcome: TerminalOutcome,
    details: OperationTerminalDetails = {},
  ): void {
    if (this.#finished) {
      return;
    }
    this.#finished = true;
    const upstreamStatus = safeHttpStatus(details.upstreamStatus);
    this.#emit({
      outcome,
      durationMs: elapsed(this.#startedAt, safeNow(this.#clock)),
      reason: details.reason ?? "none",
      ambiguityState: details.ambiguityState ?? "none",
      recoveryState: details.recoveryState ?? "reconciled",
      ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    });
  }

  #emit(
    event: Omit<
      OperationTelemetryEvent,
      "schemaVersion" | "markerHash" | "operationKind" | "phase"
    >,
  ): void {
    safeRecord(this.#sink, {
      schemaVersion: OPERATION_TELEMETRY_SCHEMA_VERSION,
      markerHash: this.#markerHash,
      operationKind: this.#operationKind,
      phase: "recovery",
      ...event,
    });
  }
}

function markerHash(marker: string): string {
  return `m1_${createHash("sha256").update(marker, "utf8").digest("hex").slice(0, 24)}`;
}

function safeRecord(
  sink: OperationTelemetrySink,
  event: OperationTelemetryEvent,
): void {
  try {
    sink.record(Object.freeze(event));
  } catch {
    // Telemetry is observational and must not change operation behavior.
  }
}

function safeNow(clock: Clock): number {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function elapsed(startedAt: number, finishedAt: number): number {
  return Math.min(
    MAX_OPERATION_DURATION_MS,
    Math.max(0, Math.floor(finishedAt - startedAt)),
  );
}

function safeHttpStatus(status: number | undefined): number | undefined {
  return Number.isInteger(status) && status !== undefined &&
    status >= 100 && status <= 599
    ? status
    : undefined;
}
