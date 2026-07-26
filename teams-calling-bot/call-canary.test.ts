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
const FAKE_CLOCK = { now: () => Date.now() };

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
    const canary = new CallingCanary(
      SETTINGS,
      journal,
      token,
      request,
      FAKE_CLOCK,
    );

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

    await vi.advanceTimersByTimeAsync(14_999);
    expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(1);
    expect(canary.handleNotificationEnvelope(
      deletedNotification("call-one"),
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

  it("uses the initiation deadline after an early answer", async () => {
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
      FAKE_CLOCK,
    );

    const run = canary.run();
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(canary.handleNotificationEnvelope(
      notification("call-two", "established"),
      "digest-connected",
    )).toBe("accepted");
    await vi.advanceTimersByTimeAsync(13_999);
    expect(requests).not.toContain("DELETE");
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.filter((method) => method === "DELETE")).toHaveLength(1);
    canary.handleNotificationEnvelope(
      deletedNotification("call-two"),
      "digest-terminal",
    );
    await expect(run).resolves.toMatchObject({ outcome: "ended" });
  });

  it("cannot extend the deadline by answering at its boundary", async () => {
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
          ? jsonResponse(201, { id: "call-boundary" })
          : new Response(null, { status: 204 });
      },
      FAKE_CLOCK,
    );

    const run = canary.run();
    await flush();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(canary.handleNotificationEnvelope(
      notification("call-boundary", "established"),
      "digest-boundary",
    )).toBe("accepted");
    expect(methods).toEqual(["POST"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(methods).toEqual(["POST", "DELETE"]);
    expect(canary.handleNotificationEnvelope(
      notification("call-boundary", "established"),
      "digest-late-duplicate-state",
    )).toBe("accepted");
    expect(methods).toEqual(["POST", "DELETE"]);
    canary.handleNotificationEnvelope(
      deletedNotification("call-boundary"),
      "digest-boundary-terminal",
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
      FAKE_CLOCK,
    );
    const run = canary.run();
    await flush();
    canary.handleNotificationEnvelope(
      deletedNotification("call-three"),
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
      FAKE_CLOCK,
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

  it("uses a late callback only for one safety hang-up, never a second call", async () => {
    vi.useFakeTimers();
    const methods: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        if (method === "POST") {
          throw new TypeError("ambiguous create");
        }
        return new Response(null, { status: 204 });
      },
      FAKE_CLOCK,
    );

    const run = canary.run();
    await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(run).resolves.toEqual({
      outcome: "uncertain",
      terminalCallback: false,
    });
    expect(methods).toEqual(["POST"]);

    expect(canary.handleNotificationEnvelope(
      notification("late-call", "establishing"),
      "digest-late",
    )).toBe("accepted");
    await flush();
    expect(methods).toEqual(["POST", "DELETE"]);
    expect(canary.handleNotificationEnvelope(
      notification("late-call", "ringing"),
      "digest-later",
    )).toBe("accepted");
    await Promise.all([canary.shutdown(), canary.shutdown()]);
    expect(methods).toEqual(["POST", "DELETE"]);
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
      FAKE_CLOCK,
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
      deletedNotification("call-four"),
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
    let resolveDelete!: (response: Response) => void;
    const deleteResponse = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        if (method === "POST") {
          return jsonResponse(201, { id: "call-shutdown" });
        }
        return deleteResponse;
      },
      FAKE_CLOCK,
    );
    const run = canary.run();
    await flush();
    canary.handleNotificationEnvelope(
      notification("call-shutdown", "ringing"),
      "digest-ring",
    );

    const shutdown = Promise.all([canary.shutdown(), canary.shutdown()]);
    await flush();
    expect(methods.filter((method) => method === "DELETE")).toHaveLength(1);
    let settled = false;
    void shutdown.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(methods.filter((method) => method === "DELETE")).toHaveLength(1);
    resolveDelete(new Response(null, { status: 204 }));
    await shutdown;
    expect(settled).toBe(true);
    canary.handleNotificationEnvelope(
      deletedNotification("call-shutdown"),
      "digest-terminal",
    );
    await expect(run).resolves.toMatchObject({ outcome: "ended" });
  });

  it("accepts official updated states and a field-free deleted terminal", async () => {
    const methods: string[] = [];
    const canary = new CallingCanary(
      SETTINGS,
      new MemoryJournal(),
      new OneToken(),
      async (_input, init) => {
        methods.push(init?.method ?? "GET");
        return jsonResponse(201, { id: "official-call" });
      },
    );
    const run = canary.run();
    await flush();

    expect(canary.handleNotificationEnvelope(
      notification("official-call", "establishing"),
      "official-establishing",
    )).toBe("accepted");
    expect(canary.handleNotificationEnvelope(
      notification("official-call", "ringing"),
      "official-ringing",
    )).toBe("accepted");
    expect(canary.handleNotificationEnvelope(
      notification("official-call", "established"),
      "official-established",
    )).toBe("accepted");
    expect(canary.handleNotificationEnvelope(
      deletedNotification("official-call"),
      "official-deleted",
    )).toBe("accepted");

    await expect(run).resolves.toEqual({
      outcome: "ended",
      terminalCallback: true,
    });
    expect(methods).toEqual(["POST"]);
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
      { ...FAKE_CLOCK, callWindowMs: 60_000 },
    );
    void active.run();
    await flush();
    expect(active.handleNotificationEnvelope(
      notification("call-five", "ringing"),
      "digest-ring",
    )).toBe("accepted");
    expect(active.handleNotificationEnvelope(
      deletedNotification("other-call"),
      "digest-other",
    )).toBe("rejected");
    expect(active.handleNotificationEnvelope(
      notification("call-five", "establishing"),
      "digest-backward",
    )).toBe("rejected");
    expect(active.handleNotificationEnvelope({
      value: [{
        changeType: "updated",
        resourceUrl: "/communications/calls/call-five/participants",
        resourceData: { state: "established" },
      }],
    }, "digest-unrelated")).toBe("rejected");
    expect(active.handleNotificationEnvelope({
      value: [{
        changeType: "updated",
        resourceUrl: "/communications/calls/%2F",
        resourceData: { state: "established" },
      }],
    }, "digest-malformed")).toBe("rejected");
    expect(active.handleNotificationEnvelope({
      value: [{
        changeType: "updated",
        resourceUrl: "/communications/calls/%3F",
        resourceData: { state: "established" },
      }],
    }, "digest-delimiter")).toBe("rejected");
    expect(active.handleNotificationEnvelope(
      notification("call-five", "terminated"),
      "digest-undocumented-terminal-update",
    )).toBe("rejected");
    active.handleNotificationEnvelope(
      deletedNotification("call-five"),
      "digest-end",
    );
  });
});

function notification(callId: string, state: string): Record<string, unknown> {
  return {
    value: [{
      changeType: "updated",
      resourceUrl: `/communications/calls/${encodeURIComponent(callId)}`,
      resourceData: { state },
    }],
  };
}

function deletedNotification(callId: string): Record<string, unknown> {
  return {
    value: [{
      changeType: "deleted",
      resourceUrl: `/communications/calls/${encodeURIComponent(callId)}`,
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
