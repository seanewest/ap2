import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_CONNECTION_CLOSED_STATUS,
  StructuredConsoleApiRequestTelemetry,
  type ApiRequestTelemetryEvent,
} from "./api-telemetry.ts";
import {
  API_CONNECTIONS_CHECKING_INTERVAL_MS,
  API_HEADERS_TIMEOUT_MS,
  API_INACTIVITY_TIMEOUT_MS,
  API_KEEP_ALIVE_TIMEOUT_MS,
  API_REQUEST_RECEIVE_TIMEOUT_MS,
  createApiServer,
} from "./server.ts";
import type { ScenarioPlanService } from "./scenario-plan.ts";

const servers: ReturnType<typeof createApiServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
});

describe("API deadline and client-cancellation boundary", () => {
  it("sets explicit finite production transport limits", () => {
    const server = auditServer().server;
    expect(server.headersTimeout).toBe(API_HEADERS_TIMEOUT_MS);
    expect(server.requestTimeout).toBe(API_REQUEST_RECEIVE_TIMEOUT_MS);
    expect((server as unknown as { connectionsCheckingInterval: number })
      .connectionsCheckingInterval)
      .toBe(API_CONNECTIONS_CHECKING_INTERVAL_MS);
    expect(server.timeout).toBe(API_INACTIVITY_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(API_KEEP_ALIVE_TIMEOUT_MS);
  });

  it("closes a held authenticated pure request without cancelling its work", async () => {
    const pure = deferred<unknown>();
    const started = deferred<void>();
    const compile = vi.fn(() => {
      started.resolve();
      return pure.promise;
    });
    const { server, messages } = auditServer({
      scenarioPlanService: { compile } as unknown as ScenarioPlanService,
    });
    const base = await listen(server, 40);
    const client = post(base, "/api/scenario-plan", "{}");
    await started.promise;

    await expect(client).rejects.toThrow();
    expect(compile).toHaveBeenCalledOnce();
    await waitForTerminal(messages);
    expect(terminalEvents(messages)).toEqual([
      expect.objectContaining({
        routeOwner: "scenario-plan-compile",
        sideEffect: "pure",
        status: API_CONNECTION_CLOSED_STATUS,
        outcome: "connection-closed",
      }),
    ]);

    pure.resolve({ safe: true });
    await settledTurn();
    expect(terminalEvents(messages)).toHaveLength(1);
  });

  it("bounds a held mutation connection without retry or cancellation", async () => {
    const mutation = deferred<unknown>();
    const started = deferred<void>();
    const send = vi.fn(() => {
      started.resolve();
      return mutation.promise;
    });
    const { server, messages } = auditServer({
      simulatedEmailOperation: { send } as never,
    });
    const base = await listen(server, 40);
    const client = post(base, "/api/simulated-email");
    await started.promise;

    await expect(client).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
    await waitForTerminal(messages);
    expect(terminalEvents(messages)).toEqual([
      expect.objectContaining({
        routeOwner: "simulated-email-send",
        sideEffect: "bounded-mutation",
        status: API_CONNECTION_CLOSED_STATUS,
        outcome: "connection-closed",
      }),
    ]);

    mutation.resolve({ accepted: true });
    await settledTurn();
    expect(send).toHaveBeenCalledOnce();
    expect(terminalEvents(messages)).toHaveLength(1);
  });

  it("does not dispatch work after a client aborts held authentication", async () => {
    const authentication = deferred<Readonly<Record<string, unknown>>>();
    const started = deferred<void>();
    const operation = vi.fn();
    const { server, messages } = auditServer({
      tokenVerifier: {
        verify: vi.fn(() => {
          started.resolve();
          return authentication.promise;
        }),
      },
      simulatedEmailOperation: { send: operation } as never,
    });
    const base = await listen(server, 500);
    const client = post(base, "/api/simulated-email");
    await started.promise;
    client.destroy();

    await expect(client.result).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    await waitForTerminal(messages);
    expect(terminalEvents(messages)).toEqual([
      expect.objectContaining({
        routeOwner: "simulated-email-send",
        status: API_CONNECTION_CLOSED_STATUS,
        outcome: "connection-closed",
      }),
    ]);

    authentication.resolve({
      tid: "fixture-tenant",
      oid: "fixture-operator",
      scp: "access_as_user",
    });
    await settledTurn();
    expect(operation).not.toHaveBeenCalled();
    expect(terminalEvents(messages)).toHaveLength(1);
  });

  it("terminates an incomplete request body under the receive boundary", async () => {
    const { server, messages } = auditServer({
      scenarioPlanService: {
        compile: vi.fn(() => {
          throw new Error("Incomplete input must not compile");
        }),
      },
    });
    server.requestTimeout = 40;
    const base = await listen(server, 500);
    const socket = connect(base.port, base.host);
    socket.setEncoding("utf8");
    let received = "";
    socket.on("data", (chunk: string) => {
      received += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write([
      "POST /api/scenario-plan HTTP/1.1",
      `Host: ${base.host}:${base.port}`,
      "Authorization: Bearer fixture-token",
      "Content-Type: application/json",
      "Content-Length: 16",
      "Connection: close",
      "",
      "{",
    ].join("\r\n"));

    await new Promise<void>((resolve, reject) => {
      socket.once("end", resolve);
      socket.once("close", resolve);
      socket.once("error", reject);
    });
    expect(received).not.toContain("500 Internal Server Error");
    if (received.length > 0) {
      expect(received).toContain("408 Request Timeout");
    }
    await waitForTerminal(messages);
    expect(terminalEvents(messages)).toEqual([
      expect.objectContaining({
        routeOwner: "scenario-plan-compile",
        status: API_CONNECTION_CLOSED_STATUS,
        outcome: "connection-closed",
      }),
    ]);
  }, 2_000);
});

function auditServer(
  overrides: Partial<Parameters<typeof createApiServer>[0]> = {},
): {
  server: ReturnType<typeof createApiServer>;
  messages: string[];
} {
  const messages: string[] = [];
  const server = createApiServer({
    tokenVerifier: {
      verify: vi.fn(async () => ({
        tid: "fixture-tenant",
        oid: "fixture-operator",
        scp: "access_as_user",
      })),
    },
    callerPolicy: {
      tenantId: "fixture-tenant",
      delegatedUserObjectIds: ["fixture-operator"],
      automationClientId: "fixture-automation",
    },
    rehearsalStatusProvider: {
      getStatus: vi.fn(),
    },
    requestTelemetry: new StructuredConsoleApiRequestTelemetry({
      write: (message) => messages.push(message),
    }),
    ...overrides,
  });
  servers.push(server);
  return { server, messages };
}

async function listen(
  server: ReturnType<typeof createApiServer>,
  inactivityTimeoutMs: number,
): Promise<{ host: string; port: number; origin: string }> {
  server.setTimeout(inactivityTimeoutMs);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    host: "127.0.0.1",
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

function post(
  base: { host: string; port: number; origin: string },
  path: string,
  body?: string,
): Promise<void> & {
  destroy(): void;
  result: Promise<void>;
} {
  let client!: ReturnType<typeof httpRequest>;
  const result = new Promise<void>((resolve, reject) => {
    client = httpRequest({
      hostname: base.host,
      port: base.port,
      path,
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-token",
        ...(body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }),
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve());
    });
    client.once("error", reject);
    client.end(body);
  });
  return Object.assign(result, {
    destroy: () => client.destroy(),
    result,
  });
}

function terminalEvents(messages: readonly string[]): ApiRequestTelemetryEvent[] {
  return messages.map((message) =>
    JSON.parse(message) as ApiRequestTelemetryEvent
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function settledTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForTerminal(messages: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 50 && messages.length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  expect(messages).toHaveLength(1);
}
