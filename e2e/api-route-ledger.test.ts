import type {
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse,
} from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { ApiRouteLedger } from "./api-route-ledger";

type EventName = "request" | "response" | "requestfailed";

function fixture() {
  const handlers = new Map<EventName, Array<(value: never) => void>>();
  const page = {
    on: vi.fn((event: EventName, handler: (value: never) => void) => {
      const listeners = handlers.get(event) ?? [];
      listeners.push(handler);
      handlers.set(event, listeners);
      return page;
    }),
  } as unknown as Pick<Page, "on">;
  let monotonicMs = 0;
  const ledger = new ApiRouteLedger(
    page,
    "https://api.example.test",
    {
      monotonicMs: () => monotonicMs,
      utcNow: () => "2026-07-24T01:00:00.000Z",
    },
  );
  return {
    ledger,
    setTime: (value: number) => {
      monotonicMs = value;
    },
    request(method: string, url: string): PlaywrightRequest {
      return {
        method: () => method,
        url: () => url,
      } as PlaywrightRequest;
    },
    emit(event: EventName, value: unknown): void {
      for (const handler of handlers.get(event) ?? []) {
        handler(value as never);
      }
    },
  };
}

describe("API route evidence ledger", () => {
  it("preserves safe response status, body, and elapsed time", async () => {
    const test = fixture();
    const request = test.request(
      "GET",
      "https://api.example.test/api/whoami?ignored=true",
    );
    test.emit("request", request);
    test.setTime(1_234.4);
    test.emit("response", {
      request: () => request,
      status: () => 200,
      json: async () => ({
        callerType: "delegated",
        tenantId: "student-tenant",
        token: "must-not-escape",
        rawResponse: { secret: "must-not-escape" },
      }),
    } as PlaywrightResponse);

    const evidence = await test.ledger.snapshot();

    expect(evidence).toEqual([
      {
        sequence: 1,
        method: "GET",
        path: "/api/whoami",
        startedAtUtc: "2026-07-24T01:00:00.000Z",
        durationMs: 1_234,
        outcome: "response",
        status: 200,
        safeBody: {
          callerType: "delegated",
          tenantId: "student-tenant",
        },
        bodyShape: "json-object",
      },
    ]);
    expect(JSON.stringify(evidence)).not.toContain("must-not-escape");
    expect(JSON.stringify(evidence)).not.toContain("rawResponse");
  });

  it("records pending and failed requests even without a response", async () => {
    const test = fixture();
    const pending = test.request(
      "GET",
      "https://api.example.test/api/rehearsal-status",
    );
    const failed = test.request(
      "POST",
      "https://api.example.test/api/onedrive-share-proof",
    );
    test.emit("request", pending);
    test.setTime(20);
    test.emit("request", failed);
    test.setTime(75);
    test.emit("requestfailed", failed);
    test.setTime(120);

    await expect(test.ledger.snapshot()).resolves.toEqual([
      {
        sequence: 1,
        method: "GET",
        path: "/api/rehearsal-status",
        startedAtUtc: "2026-07-24T01:00:00.000Z",
        durationMs: 120,
        outcome: "pending",
      },
      {
        sequence: 2,
        method: "POST",
        path: "/api/onedrive-share-proof",
        startedAtUtc: "2026-07-24T01:00:00.000Z",
        durationMs: 55,
        outcome: "transport-failed",
      },
    ]);
  });

  it("ignores requests outside the configured API origin", async () => {
    const test = fixture();
    test.emit(
      "request",
      test.request("GET", "https://login.microsoftonline.com/api/whoami"),
    );
    test.emit(
      "request",
      test.request("GET", "https://api.example.test/not-an-api-route"),
    );

    await expect(test.ledger.snapshot()).resolves.toEqual([]);
  });
});
