export interface RevisionGateTiming {
  timeoutMs?: number;
  requestTimeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<boolean>;
  signal?: AbortSignal;
}

export async function dispatchAfterExactPublicRevision(
  callbackUri: string,
  expectedRevision: string,
  dispatch: () => Promise<void>,
  request: typeof fetch = fetch,
  timing: RevisionGateTiming = {},
): Promise<boolean> {
  const healthUrl = new URL("/health", callbackUri);
  if (healthUrl.protocol !== "https:") return false;

  const timeoutMs = timing.timeoutMs ?? 30_000;
  const requestTimeoutMs = timing.requestTimeoutMs ?? 2_000;
  const pollMs = timing.pollMs ?? 1_000;
  const now = timing.now ?? Date.now;
  const wait = timing.wait ?? boundedWait;
  const startedAt = now();

  while (now() - startedAt < timeoutMs && !timing.signal?.aborted) {
    const remaining = timeoutMs - (now() - startedAt);
    const timeoutSignal = AbortSignal.timeout(
      Math.max(1, Math.min(requestTimeoutMs, remaining)),
    );
    const signal = timing.signal
      ? AbortSignal.any([timing.signal, timeoutSignal])
      : timeoutSignal;
    try {
      const response = await request(healthUrl, {
        method: "GET",
        redirect: "error",
        signal,
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
        },
      });
      const body = response.status === 200 ? await safeJson(response) : undefined;
      if (
        isRecord(body) &&
        Object.keys(body).sort().join(",") === "revision,status" &&
        body.status === "ok" &&
        body.revision === expectedRevision &&
        !timing.signal?.aborted
      ) {
        await dispatch();
        return true;
      }
      if (response.status !== 200) await discard(response);
    } catch {
      // Read-only routing observations are bounded and may be repeated.
    }

    const waitFor = Math.min(pollMs, timeoutMs - (now() - startedAt));
    if (
      waitFor <= 0 ||
      !await wait(waitFor, timing.signal)
    ) {
      break;
    }
  }
  return false;
}

async function boundedWait(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  return await new Promise<boolean>((resolve) => {
    const finish = (completed: boolean): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      resolve(completed);
    };
    const aborted = (): void => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal?.addEventListener("abort", aborted, { once: true });
  });
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
    // This is a bounded read-only observation.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
