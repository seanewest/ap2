// @vitest-environment node

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CallingCanary,
  CallingCanaryBusyError,
  type AppTokenProvider,
} from "./call-canary.js";
import type {
  JournalSink,
  ReducedJournalEvent,
} from "./journal.js";

const SETTINGS = {
  targetUserId: "fixture-target-user",
  callbackUri: "https://calling.example.test/callbacks/calls",
};

class MemoryJournal implements JournalSink {
  readonly entries: ReducedJournalEvent[] = [];
  append(event: ReducedJournalEvent): void {
    this.entries.push(event);
  }
}

class OneToken implements AppTokenProvider {
  calls = 0;
  async getToken(): Promise<string> {
    this.calls += 1;
    return "private-token";
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CallingCanary", () => {
  it("rings for 15 seconds, hangs up once, and requires a terminal callback", async () => {
    vi.useFakeTimers();
    const journal = new MemoryJournal();
    const token = new OneToken();
    const requests: Array<{ method: string; url: string; attempted: boolean }> = [];
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        method: init?.method ?? "GET",
        url: input.toString(),
        attempted: journal.entries.some((entry) => entry.phase === "attempting"),
      });
      return init?.method === "POST"
        ? jsonResponse(201, { id: "call-one" })
        : new Response(null, { status: 204 });
    });
    const canary = new CallingCanary(SETTINGS, journal, token, request);

    const run = canary.run();
    await flush();
    expect(canary.handleNotificationEnvelope(
      notification("call-one", "establishing"),
      "digest-establishing",
    )).toBe("accepted");
    expect(canary.handleNotificationEnvelope(
      notification("call-one", "establishing"),
      "digest-establishing",
    )).toBe("duplicate");
    expect(canary.handleNotificationEnvelope(
      notification("call-one", "ringing"),
      "digest-ringing",
    )).toBe("accepted");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(1);
    expect(canary.handleNotificationEnvelope(
      notification("call-one", "terminated"),
      "digest-terminated",
    )).toBe("accepted");

    await expect(run).resolves.toEqual({
      outcome: "ended",
      terminalCallback: true,
    });
    expect(token.calls).toBe(1);
    expect(requests[0]).toMatchObject({ method: "POST", attempted: true });
    expect(requests.filter(({ method }) => method === "POST")).toHaveLength(1);
    expect(
      journal.entries.filter((entry) => entry.phase === "callback"),
    ).toHaveLength(3);
    const reducedEvidence = JSON.stringify(journal.entries);
    expect(reducedEvidence).not.toContain("private-token");
    expect(reducedEvidence).not.toContain(SETTINGS.targetUserId);
    expect(reducedEvidence).not.toContain("call-one");
  });

  it("allows an answered call for at most five seconds before one hang-up", async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        requests.push(init?.method ?? "GET");
        return init?.method === "POST"
          ? jsonResponse(201, { id: "call-two" })
          : new Response(null, { status: 204 });
      },
    );

    const run = canary.run();
    await flush();
    expect(canary.handleNotificationEnvelope(
      notification("call-two", "established"),
      "digest-connected",
    )).toBe("accepted");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(requests).not.toContain("DELETE");
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.filter((method) => method === "DELETE")).toHaveLength(1);
    canary.handleNotificationEnvelope(
      notification("call-two", "terminated"),
      "digest-terminal",
    );
    await expect(run).resolves.toMatchObject({ outcome: "ended" });
  });

  it("does not hang up after an earlier terminal callback", async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        methods.push(init?.method ?? "GET");
        return jsonResponse(201, { id: "call-three" });
      },
    );
    const run = canary.run();
    await flush();
    canary.handleNotificationEnvelope(
      notification("call-three", "terminated"),
      "digest-terminal",
    );
    await expect(run).resolves.toEqual({
      outcome: "ended",
      terminalCallback: true,
    });
    expect(methods).toEqual(["POST"]);
  });

  it("never retries an ambiguous create and stops without a call identity", async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        methods.push(init?.method ?? "GET");
        throw new TypeError("sanitized transport failure");
      },
    );
    const run = canary.run();
    await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(run).resolves.toEqual({
      outcome: "uncertain",
      terminalCallback: false,
    });
    expect(methods).toEqual(["POST"]);
  });

  it("observes an ambiguous hang-up once without retrying mutation", async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        if (method === "POST") return jsonResponse(201, { id: "call-four" });
        if (method === "DELETE") throw new TypeError("ambiguous");
        return jsonResponse(200, { state: "terminating" });
      },
    );
    const run = canary.run();
    await flush();
    canary.handleNotificationEnvelope(
      notification("call-four", "ringing"),
      "digest-ring",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(methods).toEqual(["POST", "DELETE", "GET"]);
    canary.handleNotificationEnvelope(
      notification("call-four", "terminated"),
      "digest-terminal",
    );
    await expect(run).resolves.toMatchObject({
      outcome: "ended",
      terminalCallback: true,
    });
  });

  it("shares the one hang-up gate with graceful shutdown", async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        return method === "POST"
          ? jsonResponse(201, { id: "call-shutdown" })
          : new Response(null, { status: 204 });
      },
    );
    const run = canary.run();
    await flush();
    canary.handleNotificationEnvelope(
      notification("call-shutdown", "ringing"),
      "digest-ring",
    );

    await Promise.all([canary.shutdown(), canary.shutdown()]);
    expect(methods.filter((method) => method === "DELETE")).toHaveLength(1);
    canary.handleNotificationEnvelope(
      notification("call-shutdown", "terminated"),
      "digest-terminal",
    );
    await expect(run).resolves.toMatchObject({ outcome: "ended" });
  });

  it("rejects mismatched and backward callbacks and enforces one run", async () => {
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async () => new Response(null, { status: 400 }),
    );
    const run = canary.run();
    await expect(canary.run()).rejects.toBeInstanceOf(CallingCanaryBusyError);
    await expect(run).resolves.toMatchObject({ outcome: "refused" });

    const active = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async () => jsonResponse(201, { id: "call-five" }),
      { ringWindowMs: 60_000 },
    );
    void active.run();
    await flush();
    expect(active.handleNotificationEnvelope(
      notification("call-five", "ringing"),
      "digest-ring",
    )).toBe("accepted");
    expect(active.handleNotificationEnvelope(
      notification("other-call", "terminated"),
      "digest-other",
    )).toBe("rejected");
    expect(active.handleNotificationEnvelope(
      notification("call-five", "establishing"),
      "digest-backward",
    )).toBe("rejected");
    active.handleNotificationEnvelope(
      notification("call-five", "terminated"),
      "digest-end",
    );
  });
});

function notification(callId: string, state: string): Record<string, unknown> {
  return {
    value: [{
      changeType: "updated",
      resource: `/communications/calls/${callId}`,
      resourceData: { id: callId, state },
    }],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
