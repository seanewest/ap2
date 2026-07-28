import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  CallJournalState,
  JournalSink,
  ReducedJournalEvent,
} from "./journal.js";

const GRAPH_CALLS_URL =
  "https://graph.microsoft.com/v1.0/communications/calls";
const CALL_WINDOW_MS = 15_000;
const CALLBACK_WINDOW_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_GRAPH_ERROR_BYTES = 16_384;
const MAX_GRAPH_ERROR_MESSAGE_LENGTH = 512;

export interface CallingCanarySettings {
  targetUserId: string;
  callbackUri: string;
}

export interface AppTokenProvider {
  getToken(signal?: AbortSignal): Promise<string>;
}

export interface CallingCanaryResult {
  outcome: "ended" | "uncertain" | "refused";
  terminalCallback: boolean;
}

export class CallingCanaryBusyError extends Error {}

type Request = typeof fetch;
type RawCallState =
  | "establishing"
  | "ringing"
  | "established"
  | "terminating"
  | "terminated";
type UpdatedCallState = Exclude<RawCallState, "terminated">;

export class CallingCanary {
  readonly #settings: CallingCanarySettings;
  readonly #journal: JournalSink;
  readonly #tokenProvider: AppTokenProvider;
  readonly #request: Request;
  readonly #now: () => number;
  readonly #callWindowMs: number;
  readonly #callbackWindowMs: number;
  readonly #requestTimeoutMs: number;
  readonly #notificationDigests = new Set<string>();
  readonly #listeners = new Set<() => void>();

  #started = false;
  #shutdownRequested = false;
  #createAttempted = false;
  #runPromise?: Promise<CallingCanaryResult>;
  readonly #tokenAbort = new AbortController();
  #callId?: string;
  #callIdDigest?: string;
  #accessToken?: string;
  #state?: CallJournalState;
  #stateRank = -1;
  #hangupPromise?: Promise<boolean>;
  #attemptedAt = 0;

  constructor(
    settings: CallingCanarySettings,
    journal: JournalSink,
    tokenProvider: AppTokenProvider,
    request: Request = fetch,
    timing: {
      now?: () => number;
      callWindowMs?: number;
      callbackWindowMs?: number;
      requestTimeoutMs?: number;
    } = {},
  ) {
    this.#settings = settings;
    this.#journal = journal;
    this.#tokenProvider = tokenProvider;
    this.#request = request;
    this.#now = timing.now ?? (() => performance.now());
    this.#callWindowMs = timing.callWindowMs ?? CALL_WINDOW_MS;
    this.#callbackWindowMs =
      timing.callbackWindowMs ?? CALLBACK_WINDOW_MS;
    this.#requestTimeoutMs =
      timing.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  static requestBody(settings: CallingCanarySettings): Record<string, unknown> {
    return {
      "@odata.type": "#microsoft.graph.call",
      callbackUri: settings.callbackUri,
      targets: [
        {
          "@odata.type":
            "#microsoft.graph.invitationParticipantInfo",
          identity: {
            "@odata.type": "#microsoft.graph.identitySet",
            user: {
              "@odata.type": "#microsoft.graph.identity",
              id: settings.targetUserId,
            },
          },
        },
      ],
      requestedModalities: ["audio"],
      mediaConfig: {
        "@odata.type": "#microsoft.graph.serviceHostedMediaConfig",
      },
    };
  }

  static requestDigest(settings: CallingCanarySettings): string {
    return digest(JSON.stringify(CallingCanary.requestBody(settings)));
  }

  run(): Promise<CallingCanaryResult> {
    if (this.#started || this.#shutdownRequested) {
      return Promise.reject(new CallingCanaryBusyError());
    }
    this.#started = true;
    this.#runPromise = this.#run();
    return this.#runPromise;
  }

  async #run(): Promise<CallingCanaryResult> {
    let result: CallingCanaryResult;
    try {
      const accessToken = await this.#tokenProvider.getToken(
        this.#tokenAbort.signal,
      );
      if (this.#shutdownRequested || !accessToken) {
        result = { outcome: "refused", terminalCallback: false };
      } else {
        this.#accessToken = accessToken;
        result = await this.#createAndEndCall();
      }
    } catch {
      result = {
        outcome: this.#createAttempted ? "uncertain" : "refused",
        terminalCallback: this.#state === "terminated",
      };
    }
    this.#append({
      phase: "complete",
      outcome: result.outcome,
      terminalCallback: result.terminalCallback,
    });
    return result;
  }

  handleNotificationEnvelope(
    body: unknown,
    notificationDigest: string,
  ): "accepted" | "duplicate" | "rejected" {
    if (this.#notificationDigests.has(notificationDigest)) return "duplicate";
    const notification = exactNotification(body);
    if (!notification || !this.#started || !this.#createAttempted) {
      return "rejected";
    }
    if (this.#callId && notification.callId !== this.#callId) {
      return "rejected";
    }

    const state = journalState(notification.state);
    const rank = stateRank(state);
    if (rank < this.#stateRank) return "rejected";

    const callIdDigest = digest(notification.callId);
    this.#append({
      phase: "callback",
      state,
      notificationDigest,
      callIdDigest,
    });
    this.#notificationDigests.add(notificationDigest);
    this.#callId ??= notification.callId;
    this.#callIdDigest ??= callIdDigest;
    this.#state = state;
    this.#stateRank = rank;
    this.#notify();
    if (state !== "terminated" && this.#deadlineReached()) {
      void this.#hangup().catch(() => {
        // The one safety hang-up remains uncertain and is never retried.
      });
    }
    return "accepted";
  }

  async shutdown(): Promise<void> {
    this.#shutdownRequested = true;
    this.#tokenAbort.abort();
    this.#notify();
    await this.#runPromise;
    await this.#hangupPromise;
  }

  async #createAndEndCall(): Promise<CallingCanaryResult> {
    this.#append({ phase: "attempting", state: "creating" });
    this.#createAttempted = true;
    this.#attemptedAt = this.#now();

    let response: Response | undefined;
    let body: unknown;
    let graphError: GraphErrorEvidence = {};
    try {
      response = await this.#request(GRAPH_CALLS_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
        headers: this.#headers(true),
        body: JSON.stringify(CallingCanary.requestBody(this.#settings)),
      });
      if (response.status === 201) {
        body = await safeJson(response);
      } else {
        graphError = await reducedGraphError(response);
      }
    } catch {
      // A transport failure is uncertain and is never retried.
    }

    if (response?.status === 201 && hasCallId(body)) {
      this.#bindCall(body.id);
      this.#append({
        phase: "create-result",
        httpClass: "2xx",
        httpStatus: response.status,
        state: "active",
        callIdDigest: this.#callIdDigest,
      });
    } else if (response && response.status >= 400 && response.status < 500 &&
      ![408, 425, 429].includes(response.status)) {
      this.#append({
        phase: "create-result",
        httpClass: "4xx",
        httpStatus: response.status,
        state: "refused",
        ...graphError,
      });
      return { outcome: "refused", terminalCallback: false };
    } else {
      this.#append({
        phase: "create-result",
        httpClass: httpClass(response?.status),
        ...(response ? { httpStatus: response.status } : {}),
        state: "uncertain",
        ...graphError,
      });
      const remaining = this.#remainingCallWindow();
      await this.#waitFor(() => Boolean(this.#callId), remaining);
      if (!this.#callId) {
        return { outcome: "uncertain", terminalCallback: false };
      }
    }

    if (this.#isTerminal()) {
      return { outcome: "ended", terminalCallback: true };
    }
    if (this.#shutdownRequested) {
      return await this.#hangupAndFinish();
    }

    const remainingCall = this.#remainingCallWindow();
    await this.#waitFor(
      () => this.#isTerminal() || this.#shutdownRequested,
      remainingCall,
    );
    if (this.#isTerminal()) {
      return { outcome: "ended", terminalCallback: true };
    }

    return await this.#hangupAndFinish();
  }

  async #hangupAndFinish(): Promise<CallingCanaryResult> {
    const hangup = await this.#hangup();
    if (!hangup) {
      return {
        outcome: this.#isTerminal() ? "ended" : "uncertain",
        terminalCallback: this.#isTerminal(),
      };
    }
    if (this.#shutdownRequested) {
      return {
        outcome: this.#isTerminal() ? "ended" : "uncertain",
        terminalCallback: this.#isTerminal(),
      };
    }
    await this.#waitFor(
      () => this.#isTerminal(),
      this.#callbackWindowMs,
    );
    return {
      outcome: this.#isTerminal() ? "ended" : "uncertain",
      terminalCallback: this.#isTerminal(),
    };
  }

  #hangup(): Promise<boolean> {
    if (this.#hangupPromise) return this.#hangupPromise;
    if (
      !this.#callId ||
      !this.#callIdDigest ||
      !this.#accessToken ||
      this.#state === "terminated"
    ) {
      return Promise.resolve(false);
    }
    this.#hangupPromise = this.#performHangup(
      this.#callId,
      this.#callIdDigest,
    );
    return this.#hangupPromise;
  }

  async #performHangup(
    callId: string,
    callIdDigest: string,
  ): Promise<boolean> {
    this.#append({
      phase: "hangup-attempting",
      callIdDigest,
    });

    let response: Response | undefined;
    try {
      response = await this.#request(
        `${GRAPH_CALLS_URL}/${encodeURIComponent(callId)}`,
        {
          method: "DELETE",
          redirect: "error",
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
          headers: this.#headers(),
        },
      );
    } catch {
      // The one hang-up attempt is uncertain and is never retried.
    }

    if (response?.status === 204) {
      await discard(response);
      this.#append({
        phase: "hangup-result",
        httpClass: "2xx",
        state: "accepted",
      });
      return true;
    }

    const ambiguous = !response ||
      [408, 425, 429].includes(response.status) ||
      response.status >= 500 ||
      (response.status >= 200 && response.status < 300);
    if (response) await discard(response);
    this.#append({
      phase: "hangup-result",
      httpClass: httpClass(response?.status),
      state: ambiguous ? "uncertain" : "refused",
    });
    if (ambiguous) await this.#observeCallOnce();
    return true;
  }

  async #observeCallOnce(): Promise<void> {
    if (!this.#callId || !this.#accessToken) return;
    let observed: ReducedJournalEvent & { phase: "hangup-observation" };
    try {
      const response = await this.#request(
        `${GRAPH_CALLS_URL}/${encodeURIComponent(this.#callId)}`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
          headers: this.#headers(),
        },
      );
      if (response.status === 404) {
        await discard(response);
        observed = { phase: "hangup-observation", state: "missing" };
      } else if (response.status === 200) {
        const body = await safeJson(response);
        observed = {
          phase: "hangup-observation",
          state: isRecord(body) && body.state === "terminated"
            ? "terminal"
            : isRecord(body) && typeof body.state === "string"
            ? "active"
            : "malformed",
        };
      } else {
        await discard(response);
        observed = { phase: "hangup-observation", state: "malformed" };
      }
    } catch {
      observed = { phase: "hangup-observation", state: "malformed" };
    }
    this.#append(observed);
  }

  #bindCall(callId: string): void {
    if (this.#callId && this.#callId !== callId) {
      throw new Error("Call identity conflict.");
    }
    this.#callId = callId;
    this.#callIdDigest ??= digest(callId);
  }

  #headers(json = false): Record<string, string> {
    if (!this.#accessToken) throw new Error("Token is unavailable.");
    return {
      Authorization: `Bearer ${this.#accessToken}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  #isTerminal(): boolean {
    return this.#state === "terminated";
  }

  #remainingCallWindow(): number {
    return Math.max(
      0,
      this.#callWindowMs - (this.#now() - this.#attemptedAt),
    );
  }

  #deadlineReached(): boolean {
    return this.#createAttempted && this.#remainingCallWindow() === 0;
  }

  #append(event: ReducedJournalEvent): void {
    this.#journal.append(event);
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  async #waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    if (predicate()) return true;
    if (timeoutMs <= 0) return false;
    return await new Promise<boolean>((resolve) => {
      const finish = (value: boolean): void => {
        clearTimeout(timer);
        this.#listeners.delete(listener);
        resolve(value);
      };
      const listener = (): void => {
        if (predicate()) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.#listeners.add(listener);
    });
  }
}

function exactNotification(
  body: unknown,
): { callId: string; state: RawCallState } | undefined {
  if (!isRecord(body) || !Array.isArray(body.value) || body.value.length !== 1) {
    return undefined;
  }
  const value = body.value[0];
  if (
    !isRecord(value) ||
    typeof value.resourceUrl !== "string"
  ) {
    return undefined;
  }
  const match = /^\/communications\/calls\/([^/?#]+)$/.exec(
    value.resourceUrl,
  );
  let resourceId: string;
  try {
    resourceId = decodeURIComponent(match?.[1] ?? "");
  } catch {
    return undefined;
  }
  if (
    !match ||
    !resourceId ||
    resourceId === "." ||
    resourceId === ".." ||
    /[/\\?#\u0000-\u001f\u007f]/.test(resourceId)
  ) {
    return undefined;
  }
  if (value.changeType === "deleted") {
    return { callId: resourceId, state: "terminated" };
  }
  if (
    value.changeType !== "updated" ||
    !isRecord(value.resourceData) ||
    !isRawCallState(value.resourceData.state)
  ) {
    return undefined;
  }
  return {
    callId: resourceId,
    state: value.resourceData.state,
  };
}

function isRawCallState(value: unknown): value is UpdatedCallState {
  return [
    "establishing",
    "ringing",
    "established",
    "terminating",
  ].includes(value as string);
}

function journalState(state: RawCallState): CallJournalState {
  return state === "established" ? "connected" : state;
}

function stateRank(state: CallJournalState): number {
  return {
    establishing: 0,
    ringing: 1,
    connected: 2,
    terminating: 3,
    terminated: 4,
  }[state];
}

function hasCallId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface GraphErrorEvidence {
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
  clientRequestId?: string;
  responseDate?: string;
}

async function reducedGraphError(
  response: Response,
): Promise<GraphErrorEvidence> {
  const evidence: GraphErrorEvidence = {};
  const headerRequestId = safeCorrelationId(response.headers.get("request-id"));
  const headerClientRequestId = safeCorrelationId(
    response.headers.get("client-request-id"),
  );
  const headerDate = safeResponseDate(response.headers.get("date"));
  if (headerRequestId) evidence.requestId = headerRequestId;
  if (headerClientRequestId) evidence.clientRequestId = headerClientRequestId;
  if (headerDate) evidence.responseDate = headerDate;

  const text = await readLimitedText(response, MAX_GRAPH_ERROR_BYTES);
  if (text === undefined) return evidence;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return evidence;
  }
  if (!isRecord(body) || !isRecord(body.error)) return evidence;

  const errorCode = safeErrorCode(body.error.code);
  const errorMessage = safeErrorMessage(body.error.message);
  if (errorCode) evidence.errorCode = errorCode;
  if (errorMessage) evidence.errorMessage = errorMessage;

  const innerError = isRecord(body.error.innerError)
    ? body.error.innerError
    : isRecord(body.error.innererror)
    ? body.error.innererror
    : undefined;
  if (!innerError) return evidence;

  if (!evidence.requestId) {
    const requestId = safeCorrelationId(innerError["request-id"]);
    if (requestId) evidence.requestId = requestId;
  }
  if (!evidence.clientRequestId) {
    const clientRequestId = safeCorrelationId(innerError["client-request-id"]);
    if (clientRequestId) evidence.clientRequestId = clientRequestId;
  }
  if (!evidence.responseDate) {
    const responseDate = safeResponseDate(innerError.date);
    if (responseDate) evidence.responseDate = responseDate;
  }
  return evidence;
}

async function readLimitedText(
  response: Response,
  maximumBytes: number,
): Promise<string | undefined> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > maximumBytes)
  ) {
    await discard(response);
    return undefined;
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(chunk.value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The response is intentionally not retried.
    }
    return undefined;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function safeErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+\S+/gi, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}\b/g, "[redacted-token]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[redacted-id]",
    )
    .replace(/\+?\d[\d ().-]{8,}\d/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim();
  return message ? message.slice(0, MAX_GRAPH_ERROR_MESSAGE_LENGTH) : undefined;
}

function safeCorrelationId(value: unknown): string | undefined {
  return typeof value === "string" &&
      value.length > 0 &&
      value.length <= 128 &&
      /^[A-Za-z0-9._-]+$/.test(value)
    ? value
    : undefined;
}

function safeResponseDate(value: unknown): string | undefined {
  return typeof value === "string" &&
      value.length > 0 &&
      value.length <= 64 &&
      /^[A-Za-z0-9,:+ .-]+$/.test(value) &&
      Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is intentionally not retried.
  }
}

function httpClass(status: number | undefined): string {
  return status === undefined ? "transport" : `${Math.floor(status / 100)}xx`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
