import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import type {
  ApiAuthorizationClass,
  ApiRouteContract,
  ApiSideEffectClass,
} from "../src/api/api-route-contract.js";
import { API_SUPPORT_REFERENCE_PATTERN } from "../src/api/support-reference.js";

export const API_REQUEST_TELEMETRY_SCHEMA_VERSION = 1;
export const API_REQUEST_CORRELATION_PATTERN = API_SUPPORT_REFERENCE_PATTERN;
export const MAX_API_REQUEST_DURATION_MS = 60_000;
export const API_CONNECTION_CLOSED_STATUS = 499;

export type ApiRequestOutcome =
  | "completed"
  | "refused"
  | "failed"
  | "shutdown-refused"
  | "connection-closed";

export interface ApiRequestTelemetryEvent {
  schemaVersion: typeof API_REQUEST_TELEMETRY_SCHEMA_VERSION;
  event: "api_request";
  correlationId: string;
  routeOwner: ApiRouteContract["ownerKey"] | "unmatched";
  sideEffect: ApiSideEffectClass | "unmatched";
  authorization: ApiAuthorizationClass | "unmatched";
  status: number;
  outcome: ApiRequestOutcome;
  durationMs: number;
}

export interface ApiRequestTelemetry {
  observe(
    response: ServerResponse,
    contract: ApiRouteContract | undefined,
    shuttingDown: boolean,
  ): string | undefined | void;
}

type Clock = () => number;
type CorrelationFactory = () => string;

export class StructuredConsoleApiRequestTelemetry
  implements ApiRequestTelemetry {
  readonly #write: (message: string) => void;
  readonly #clock: Clock;
  readonly #correlation: CorrelationFactory;

  constructor(options: {
    write?: (message: string) => void;
    clock?: Clock;
    correlation?: CorrelationFactory;
  } = {}) {
    this.#write = options.write ?? ((message) => console.info(message));
    this.#clock = options.clock ?? Date.now;
    this.#correlation = options.correlation ?? requestCorrelation;
  }

  observe(
    response: ServerResponse,
    contract: ApiRouteContract | undefined,
    shuttingDown: boolean,
  ): string | undefined {
    const correlationId = safeCorrelation(this.#correlation);
    if (!correlationId) return undefined;
    const startedAt = safeNow(this.#clock);
    let emitted = false;
    const emit = (status: number, outcome?: ApiRequestOutcome): void => {
      if (emitted) return;
      emitted = true;
      const safeTerminalStatus = safeStatus(status);
      const event: ApiRequestTelemetryEvent = Object.freeze({
        schemaVersion: API_REQUEST_TELEMETRY_SCHEMA_VERSION,
        event: "api_request",
        correlationId,
        routeOwner: contract?.ownerKey ?? "unmatched",
        sideEffect: contract?.sideEffect ?? "unmatched",
        authorization: contract?.authorization ?? "unmatched",
        status: safeTerminalStatus,
        outcome: outcome ?? requestOutcome(safeTerminalStatus, shuttingDown),
        durationMs: elapsed(startedAt, safeNow(this.#clock)),
      });
      try {
        this.#write(JSON.stringify(event));
      } catch {
        // Request telemetry is observational and never changes API behavior.
      }
    };
    response.once("finish", () => {
      emit(response.statusCode);
    });
    response.once("close", () => {
      emit(API_CONNECTION_CLOSED_STATUS, "connection-closed");
    });
    return correlationId;
  }
}

export type ApiLifecycleEvent =
  | {
      schemaVersion: 1;
      event: "api_lifecycle";
      state: "ready";
    }
  | {
      schemaVersion: 1;
      event: "api_lifecycle";
      state: "startup-failed";
      reason: "configuration" | "listener";
    }
  | {
      schemaVersion: 1;
      event: "api_lifecycle";
      state: "draining";
      signal: "SIGINT" | "SIGTERM";
    }
  | {
      schemaVersion: 1;
      event: "api_lifecycle";
      state: "stopped";
      reason: "drained";
    }
  | {
      schemaVersion: 1;
      event: "api_lifecycle";
      state: "forced-exit";
      reason: "drain-timeout" | "listener-close";
    };

export function writeApiLifecycleEvent(
  event: ApiLifecycleEvent,
  write: (message: string) => void = (message) => console.info(message),
): void {
  try {
    write(JSON.stringify(Object.freeze(event)));
  } catch {
    // Lifecycle telemetry is observational and never changes exit behavior.
  }
}

function requestCorrelation(): string {
  return `r1_${randomBytes(12).toString("hex")}`;
}

function safeCorrelation(factory: CorrelationFactory): string | undefined {
  try {
    const value = factory();
    return API_REQUEST_CORRELATION_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function requestOutcome(
  status: number,
  shuttingDown: boolean,
): ApiRequestOutcome {
  if (shuttingDown) return "shutdown-refused";
  if (status < 400) return "completed";
  if (status < 500) return "refused";
  return "failed";
}

function safeStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 500;
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
    MAX_API_REQUEST_DURATION_MS,
    Math.max(0, Math.floor(finishedAt - startedAt)),
  );
}
