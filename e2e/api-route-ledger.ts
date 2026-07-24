import type {
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse,
} from "@playwright/test";

type SafeValue = string | number | boolean;

export interface ApiRouteEvidence {
  sequence: number;
  method: string;
  path: string;
  startedAtUtc: string;
  durationMs: number;
  outcome: "pending" | "response" | "transport-failed";
  status?: number;
  safeBody?: Record<string, SafeValue>;
  bodyShape?: "json-object" | "unavailable";
}

interface MutableApiRouteEvidence extends ApiRouteEvidence {
  request: PlaywrightRequest;
  startedAtMs: number;
}

interface LedgerClock {
  monotonicMs(): number;
  utcNow(): string;
}

const SAFE_BODY_FIELDS = new Set([
  "error",
  "callerType",
  "tenantId",
  "appName",
  "region",
  "runningStatus",
  "latestReadyRevision",
  "state",
  "stage",
  "upstreamStatus",
  "graphErrorCode",
  "requestId",
  "clientRequestId",
  "responseDate",
  "retryAfter",
  "responseShape",
  "path",
  "owner",
  "recipient",
  "access",
  "verifiedAs",
  "contentMatches",
  "reason",
]);
const SAFE_BODY_TIMEOUT_MS = 1_000;

export class ApiRouteLedger {
  readonly #apiOrigin: string;
  readonly #clock: LedgerClock;
  readonly #entries: MutableApiRouteEvidence[] = [];
  readonly #byRequest = new Map<
    PlaywrightRequest,
    MutableApiRouteEvidence
  >();
  readonly #bodyReads = new Set<Promise<void>>();

  constructor(
    page: Pick<Page, "on">,
    apiBaseUrl: string,
    clock: LedgerClock = systemClock,
  ) {
    const url = new URL(apiBaseUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      throw new TypeError("The API route-ledger URL is invalid.");
    }
    this.#apiOrigin = url.origin;
    this.#clock = clock;
    page.on("request", (request) => this.#recordRequest(request));
    page.on("response", (response) => this.#recordResponse(response));
    page.on("requestfailed", (request) => this.#recordFailure(request));
  }

  async snapshot(): Promise<ApiRouteEvidence[]> {
    const now = this.#clock.monotonicMs();
    const baseEvidence = this.#entries.map((entry) => ({
      sequence: entry.sequence,
      method: entry.method,
      path: entry.path,
      startedAtUtc: entry.startedAtUtc,
      durationMs: entry.outcome === "pending"
        ? roundedDuration(now - entry.startedAtMs)
        : entry.durationMs,
      outcome: entry.outcome,
      ...(entry.status === undefined ? {} : { status: entry.status }),
    }));
    await Promise.allSettled([...this.#bodyReads]);
    return baseEvidence.map((evidence, index) => {
      const entry = this.#entries[index];
      if (!entry) {
        return evidence;
      }
      return {
        ...evidence,
        ...(entry.safeBody === undefined ? {} : { safeBody: entry.safeBody }),
        ...(entry.bodyShape === undefined
          ? {}
          : { bodyShape: entry.bodyShape }),
      };
    });
  }

  #recordRequest(request: PlaywrightRequest): void {
    const url = new URL(request.url());
    if (url.origin !== this.#apiOrigin || !url.pathname.startsWith("/api/")) {
      return;
    }
    const startedAtMs = this.#clock.monotonicMs();
    const entry: MutableApiRouteEvidence = {
      sequence: this.#entries.length + 1,
      method: request.method(),
      path: url.pathname,
      startedAtUtc: this.#clock.utcNow(),
      durationMs: 0,
      outcome: "pending",
      request,
      startedAtMs,
    };
    this.#entries.push(entry);
    this.#byRequest.set(request, entry);
  }

  #recordResponse(response: PlaywrightResponse): void {
    const entry = this.#byRequest.get(response.request());
    if (!entry) {
      return;
    }
    entry.durationMs = roundedDuration(
      this.#clock.monotonicMs() - entry.startedAtMs,
    );
    entry.outcome = "response";
    entry.status = response.status();
    const bodyRead = readSafeBody(response)
      .then(({ safeBody, bodyShape }) => {
        entry.safeBody = safeBody;
        entry.bodyShape = bodyShape;
      })
      .finally(() => this.#bodyReads.delete(bodyRead));
    this.#bodyReads.add(bodyRead);
  }

  #recordFailure(request: PlaywrightRequest): void {
    const entry = this.#byRequest.get(request);
    if (!entry) {
      return;
    }
    entry.durationMs = roundedDuration(
      this.#clock.monotonicMs() - entry.startedAtMs,
    );
    entry.outcome = "transport-failed";
  }
}

async function readSafeBody(
  response: PlaywrightResponse,
): Promise<{
  safeBody?: Record<string, SafeValue>;
  bodyShape: "json-object" | "unavailable";
}> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      response.json().then(
        (value: unknown) => ({ kind: "value" as const, value }),
        () => ({ kind: "unavailable" as const }),
      ),
      new Promise<{ kind: "unavailable" }>((resolve) => {
        timeout = setTimeout(
          () => resolve({ kind: "unavailable" }),
          SAFE_BODY_TIMEOUT_MS,
        );
      }),
    ]);
    if (outcome.kind !== "value" || !isRecord(outcome.value)) {
      return { bodyShape: "unavailable" };
    }
    const safeBody = Object.fromEntries(
      Object.entries(outcome.value).filter(
        ([key, fieldValue]) =>
          SAFE_BODY_FIELDS.has(key) &&
          (typeof fieldValue === "string" ||
            typeof fieldValue === "number" ||
            typeof fieldValue === "boolean"),
      ),
    ) as Record<string, SafeValue>;
    return { safeBody, bodyShape: "json-object" };
  } catch {
    return { bodyShape: "unavailable" };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function roundedDuration(value: number): number {
  return Math.max(0, Math.round(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const systemClock: LedgerClock = {
  monotonicMs: () => performance.now(),
  utcNow: () => new Date().toISOString(),
};
