// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { dispatchAfterExactPublicRevision } from "./startup-gate.js";

describe("dispatchAfterExactPublicRevision", () => {
  it("waits through old stable-host routing and dispatches on the exact revision", async () => {
    let now = 0;
    const revisions = ["old-revision", "new-revision"];
    const dispatch = vi.fn(async () => undefined);
    const request = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) =>
      jsonResponse({ status: "ok", revision: revisions.shift() })
    );

    await expect(dispatchAfterExactPublicRevision(
      "https://calling.example.test/callbacks/calls",
      "new-revision",
      dispatch,
      request,
      {
        timeoutMs: 3_000,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
          return true;
        },
      },
    )).resolves.toBe(true);

    expect(request).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].toString()).toBe(
      "https://calling.example.test/health",
    );
  });

  it("fails closed on bounded mismatch without journal/create dispatch", async () => {
    let now = 0;
    const dispatch = vi.fn(async () => undefined);
    const request = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) =>
      jsonResponse({ status: "ok", revision: "old-revision" })
    );

    await expect(dispatchAfterExactPublicRevision(
      "https://calling.example.test/callbacks/calls",
      "new-revision",
      dispatch,
      request,
      {
        timeoutMs: 2_500,
        pollMs: 1_000,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
          return true;
        },
      },
    )).resolves.toBe(false);

    expect(request).toHaveBeenCalledTimes(3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects malformed revision responses and shutdown cancellation", async () => {
    const dispatch = vi.fn(async () => undefined);
    const controller = new AbortController();
    controller.abort();
    await expect(dispatchAfterExactPublicRevision(
      "https://calling.example.test/callbacks/calls",
      "new-revision",
      dispatch,
      async () => jsonResponse({ status: "ok", revision: "new-revision" }),
      { signal: controller.signal },
    )).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();

    let now = 0;
    await expect(dispatchAfterExactPublicRevision(
      "https://calling.example.test/callbacks/calls",
      "new-revision",
      dispatch,
      async () => jsonResponse({
        status: "ok",
        revision: "new-revision",
        unexpected: true,
      }),
      {
        timeoutMs: 1,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
          return true;
        },
      },
    )).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
