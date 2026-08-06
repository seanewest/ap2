import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  API_REQUEST_CORRELATION_PATTERN,
  StructuredConsoleApiRequestTelemetry,
  writeApiLifecycleEvent,
  type ApiRequestTelemetryEvent,
} from "./api-telemetry.ts";
import { createApiServer } from "./server.ts";
import { API_SUPPORT_REFERENCE_HEADER } from "../src/api/support-reference.ts";

const unsafe = "unsafe-body-token-marker@example.test";
const messages: string[] = [];
let correlationSequence = 0;
let shuttingDown = false;
const tokenVerifier = {
  verify: vi.fn(async () => ({
    tid: "fixture-tenant",
    oid: "fixture-operator",
    scp: "access_as_user",
  })),
};
const server = createApiServer({
  tokenVerifier,
  callerPolicy: {
    tenantId: "fixture-tenant",
    delegatedUserObjectIds: ["fixture-operator"],
    automationClientId: "fixture-automation",
  },
  rehearsalStatusProvider: {
    getStatus: vi.fn(async () => ({
      appName: "fixture",
      region: "fixture",
      runningStatus: "Ready" as const,
      latestReadyRevision: "fixture",
    })),
  },
  sharePointTrustedVersionLifecycleOperation: {
    run: vi.fn(() => {
      throw new Error("Invalid requests must not reach dispatch");
    }),
  },
  allowedOrigin: "https://allowed.example.test",
  isShuttingDown: () => shuttingDown,
  requestTelemetry: new StructuredConsoleApiRequestTelemetry({
    write: (message) => messages.push(message),
    correlation: () => {
      correlationSequence += 1;
      return `r1_${correlationSequence.toString(16).padStart(24, "0")}`;
    },
    clock: (() => {
      let now = 1_000;
      return () => {
        now += 2;
        return now;
      };
    })(),
  }),
});
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("API request telemetry", () => {
  it("emits one fixed redacted terminal record for each decisive path", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get(API_SUPPORT_REFERENCE_HEADER)).toBeNull();
    const unauthorized = await fetch(`${baseUrl}/api/whoami`, {
      headers: {
        [API_SUPPORT_REFERENCE_HEADER]: "r1_aaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(unauthorized.status).toBe(401);
    const authorized = await authorizedFetch("/api/whoami", {
      headers: { Origin: "https://allowed.example.test" },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("Access-Control-Expose-Headers")).toBe(
      API_SUPPORT_REFERENCE_HEADER,
    );
    expect((await authorizedFetch("/api/sharepoint-trusted-version-lifecycle", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: unsafe,
    })).status).toBe(415);
    expect((await authorizedFetch("/api/sharepoint-trusted-version-lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{${unsafe}`,
    })).status).toBe(400);
    expect((await authorizedFetch("/api/sharepoint-trusted-version-lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: `${unsafe}${"x".repeat(512)}` }),
    })).status).toBe(413);
    expect((await fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Origin: `https://${unsafe}` },
    })).status).toBe(403);
    shuttingDown = true;
    const shutdown = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Origin: "https://allowed.example.test" },
    });
    expect(shutdown.status).toBe(503);
    expect(shutdown.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://allowed.example.test",
    );
    expect(shutdown.headers.get("Access-Control-Expose-Headers")).toBe(
      API_SUPPORT_REFERENCE_HEADER,
    );

    const events = messages.map(
      (message) => JSON.parse(message) as ApiRequestTelemetryEvent,
    );
    expect(events).toHaveLength(8);
    expect(events.map(({ routeOwner, sideEffect, status, outcome }) => [
      routeOwner,
      sideEffect,
      status,
      outcome,
    ])).toEqual([
      ["health", "pure", 200, "completed"],
      ["whoami", "pure", 401, "refused"],
      ["whoami", "pure", 200, "completed"],
      ["sharepoint-trusted-version-lifecycle", "bounded-mutation", 415, "refused"],
      ["sharepoint-trusted-version-lifecycle", "bounded-mutation", 400, "refused"],
      ["sharepoint-trusted-version-lifecycle", "bounded-mutation", 413, "refused"],
      ["simulated-email-send", "bounded-mutation", 403, "refused"],
      ["whoami", "pure", 503, "shutdown-refused"],
    ]);
    expect(new Set(events.map(({ correlationId }) => correlationId)).size)
      .toBe(events.length);
    expect(unauthorized.headers.get(API_SUPPORT_REFERENCE_HEADER)).toBe(
      events[1]!.correlationId,
    );
    expect(unauthorized.headers.get(API_SUPPORT_REFERENCE_HEADER)).not.toBe(
      "r1_aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(authorized.headers.get(API_SUPPORT_REFERENCE_HEADER)).toBe(
      events[2]!.correlationId,
    );
    expect(shutdown.headers.get(API_SUPPORT_REFERENCE_HEADER)).toBe(
      events[7]!.correlationId,
    );
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual([
        "authorization",
        "correlationId",
        "durationMs",
        "event",
        "outcome",
        "routeOwner",
        "schemaVersion",
        "sideEffect",
        "status",
      ]);
      expect(event.correlationId).toMatch(API_REQUEST_CORRELATION_PATTERN);
      expect(event.durationMs).toBe(2);
    }
    expect(messages.join("\n")).not.toContain(unsafe);
    expect(messages.join("\n")).not.toContain("fixture-token");
    expect(tokenVerifier.verify).toHaveBeenCalledTimes(4);
  });

  it("isolates invalid correlation factories and failing sinks", async () => {
    const invalidWrite = vi.fn();
    const invalid = new StructuredConsoleApiRequestTelemetry({
      write: invalidWrite,
      correlation: () => unsafe,
    });
    const failing = new StructuredConsoleApiRequestTelemetry({
      write: () => {
        throw new Error(unsafe);
      },
      correlation: () => "r1_111111111111111111111111",
    });
    const isolated = createApiServer({
      tokenVerifier,
      callerPolicy: {
        tenantId: "fixture-tenant",
        delegatedUserObjectIds: ["fixture-operator"],
        automationClientId: "fixture-automation",
      },
      rehearsalStatusProvider: {
        getStatus: vi.fn(),
      },
      requestTelemetry: {
        observe(response, contract, draining) {
          invalid.observe(response, contract, draining);
          failing.observe(response, contract, draining);
        },
      },
    });
    await new Promise<void>((resolve) => {
      isolated.listen(0, "127.0.0.1", resolve);
    });
    const isolatedUrl =
      `http://127.0.0.1:${(isolated.address() as AddressInfo).port}`;
    expect((await fetch(`${isolatedUrl}/health`)).status).toBe(200);
    await new Promise<void>((resolve, reject) => {
      isolated.close((error) => error ? reject(error) : resolve());
    });
    expect(invalidWrite).not.toHaveBeenCalled();
  });

  it("isolates a telemetry observer that throws before attaching", async () => {
    const isolated = createApiServer({
      tokenVerifier,
      callerPolicy: {
        tenantId: "fixture-tenant",
        delegatedUserObjectIds: ["fixture-operator"],
        automationClientId: "fixture-automation",
      },
      rehearsalStatusProvider: {
        getStatus: vi.fn(),
      },
      requestTelemetry: {
        observe() {
          throw new Error(unsafe);
        },
      },
    });
    await new Promise<void>((resolve) => {
      isolated.listen(0, "127.0.0.1", resolve);
    });
    const isolatedUrl =
      `http://127.0.0.1:${(isolated.address() as AddressInfo).port}`;
    expect((await fetch(`${isolatedUrl}/health`)).status).toBe(200);
    await new Promise<void>((resolve, reject) => {
      isolated.close((error) => error ? reject(error) : resolve());
    });
  });
});

describe("API lifecycle telemetry", () => {
  it("serializes only the fixed lifecycle schema", () => {
    const write = vi.fn();
    writeApiLifecycleEvent({
      schemaVersion: 1,
      event: "api_lifecycle",
      state: "draining",
      signal: "SIGTERM",
    }, write);

    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(write.mock.calls[0]![0])).toEqual({
      schemaVersion: 1,
      event: "api_lifecycle",
      state: "draining",
      signal: "SIGTERM",
    });
  });
});

function authorizedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: "Bearer fixture-token",
      ...init.headers,
    },
  });
}
