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

export interface CallingCanarySettings {
  targetUserId: string;
  callbackUri: string;
}

export interface AppTokenProvider {
  getToken(): Promise<string>;
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
  #createAttempted = false;
  #finished = false;
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

  async run(): Promise<CallingCanaryResult> {
    if (this.#started) throw new CallingCanaryBusyError();
    this.#started = true;

    let result: CallingCanaryResult;
    try {
      this.#accessToken = await this.#tokenProvider.getToken();
      if (!this.#accessToken) {
        result = { outcome: "refused", terminalCallback: false };
      } else {
        result = await this.#createAndEndCall();
      }
    } catch {
      result = {
        outcome: this.#createAttempted ? "uncertain" : "refused",
        terminalCallback: this.#state === "terminated",
      };
    }
    this.#finished = true;
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
    if (this.#hangupPromise) {
      await this.#hangupPromise;
      return;
    }
    if (
      this.#finished ||
      !this.#callId ||
      !this.#accessToken ||
      this.#state === "terminated"
    ) {
      return;
    }
    await this.#hangup();
  }

  async #createAndEndCall(): Promise<CallingCanaryResult> {
    this.#append({ phase: "attempting", state: "creating" });
    this.#createAttempted = true;
    this.#attemptedAt = this.#now();

    let response: Response | undefined;
    let body: unknown;
    try {
      response = await this.#request(GRAPH_CALLS_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
        headers: this.#headers(true),
        body: JSON.stringify(CallingCanary.requestBody(this.#settings)),
      });
      body = response.status === 201 ? await safeJson(response) : undefined;
    } catch {
      // A transport failure is uncertain and is never retried.
    }

    if (response?.status === 201 && hasCallId(body)) {
      this.#bindCall(body.id);
      this.#append({
        phase: "create-result",
        httpClass: "2xx",
        state: "active",
        callIdDigest: this.#callIdDigest,
      });
    } else if (response && response.status >= 400 && response.status < 500 &&
      ![408, 425, 429].includes(response.status)) {
      await discard(response);
      this.#append({
        phase: "create-result",
        httpClass: "4xx",
        state: "refused",
      });
      return { outcome: "refused", terminalCallback: false };
    } else {
      if (response) await discard(response);
      this.#append({
        phase: "create-result",
        httpClass: httpClass(response?.status),
        state: "uncertain",
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

    const remainingCall = this.#remainingCallWindow();
    await this.#waitFor(
      () => this.#isTerminal(),
      remainingCall,
    );
    if (this.#isTerminal()) {
      return { outcome: "ended", terminalCallback: true };
    }

    const hangup = await this.#hangup();
    if (!hangup) {
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
