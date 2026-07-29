// @vitest-environment node

import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_DELEGATED_SCOPE } from "./identity.js";
import {
  StructuredConsoleApiRequestTelemetry,
  type ApiRequestTelemetryEvent,
} from "./api-telemetry.js";
import { API_PROCESS_ADMISSION_LIMITS } from "./process-admission.js";
import {
  API_HEADERS_TIMEOUT_MS,
  API_INACTIVITY_TIMEOUT_MS,
  API_KEEP_ALIVE_TIMEOUT_MS,
  API_REQUEST_RECEIVE_TIMEOUT_MS,
  createApiServer,
  type ApiDependencies,
} from "./server.js";
import { API_SUPPORT_REFERENCE_HEADER } from "../src/api/support-reference.js";

const policy = {
  tenantId: "fixture-tenant",
  delegatedUserObjectIds: ["fixture-operator"],
  automationClientId: "fixture-automation",
};
const claims = {
  tid: policy.tenantId,
  oid: policy.delegatedUserObjectIds[0],
  scp: REQUIRED_DELEGATED_SCOPE,
};
const servers = new Set<ReturnType<typeof createApiServer>>();

afterEach(async () => {
  await Promise.all([...servers].map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ));
  servers.clear();
});

describe("API process-local admission", () => {
  it("refuses excess pure work before authentication or body parsing", async () => {
    const gate = deferred();
    const telemetryMessages: string[] = [];
    let correlationSequence = 0;
    const compile = vi.fn(async () => {
      await gate.promise;
      return { status: "compiled" };
    });
    const verify = vi.fn(async () => claims);
    const baseUrl = await start({
      tokenVerifier: { verify },
      scenarioPlanService: {
        compile: compile as unknown as NonNullable<
          ApiDependencies["scenarioPlanService"]
        >["compile"],
      },
      allowedOrigin: "https://allowed.example.test",
      requestTelemetry: new StructuredConsoleApiRequestTelemetry({
        write: (message) => telemetryMessages.push(message),
        correlation: () =>
          `r1_${(++correlationSequence).toString(16).padStart(24, "0")}`,
      }),
    });
    const accepted = Array.from(
      { length: API_PROCESS_ADMISSION_LIMITS.purePerRoute },
      () => fetch(`${baseUrl}/api/scenario-plan`, {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "application/json",
          Origin: "https://allowed.example.test",
        },
        body: "{}",
      }),
    );
    await until(() =>
      compile.mock.calls.length ===
        API_PROCESS_ADMISSION_LIMITS.purePerRoute
    );

    const refused = await fetch(`${baseUrl}/api/scenario-plan`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "application/json",
        Origin: "https://allowed.example.test",
      },
      body: "not-json",
    });
    expect(refused.status).toBe(503);
    await expect(refused.json()).resolves.toEqual({
      error: "process_capacity_exceeded",
    });
    expect(refused.headers.get("retry-after")).toBeNull();
    expect(refused.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://allowed.example.test",
    );
    expect(refused.headers.get("Access-Control-Expose-Headers")).toBe(
      API_SUPPORT_REFERENCE_HEADER,
    );
    expect(verify).toHaveBeenCalledTimes(
      API_PROCESS_ADMISSION_LIMITS.purePerRoute,
    );

    gate.resolve();
    expect((await Promise.all(accepted)).every(({ status }) => status === 200))
      .toBe(true);
    const capacityEvent = telemetryMessages
      .map((message) => JSON.parse(message) as ApiRequestTelemetryEvent)
      .find(({ status }) => status === 503);
    expect(capacityEvent).toBeDefined();
    expect(refused.headers.get(API_SUPPORT_REFERENCE_HEADER)).toBe(
      capacityEvent!.correlationId,
    );
  });

  it("never queues a second mutation on the same route", async () => {
    const gate = deferred();
    const send = vi.fn(async () => {
      await gate.promise;
      return {
        accepted: true as const,
        sender: "fixture-sender",
        recipient: "fixture-recipient",
        subject: "fixture-subject",
      };
    });
    const verify = vi.fn(async () => claims);
    const baseUrl = await start({
      tokenVerifier: { verify },
      simulatedEmailOperation: {
        send: send as unknown as NonNullable<
          ApiDependencies["simulatedEmailOperation"]
        >["send"],
      },
    });
    const first = fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
    });
    await until(() => send.mock.calls.length === 1);

    const refused = await fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
    });
    expect(refused.status).toBe(503);
    await expect(refused.json()).resolves.toEqual({
      error: "process_capacity_exceeded",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);

    gate.resolve();
    expect((await first).status).toBe(202);
  });

  it("keeps an aborted mutation admitted until its operation settles", async () => {
    const gate = deferred();
    const operationSettled = deferred();
    const send = vi.fn(async () => {
      await gate.promise;
      operationSettled.resolve();
      return {
        accepted: true as const,
        sender: "fixture-sender",
        recipient: "fixture-recipient",
        subject: "fixture-subject",
      };
    });
    const verify = vi.fn(async () => claims);
    const baseUrl = await start({
      tokenVerifier: { verify },
      simulatedEmailOperation: {
        send: send as unknown as NonNullable<
          ApiDependencies["simulatedEmailOperation"]
        >["send"],
      },
    });
    const controller = new AbortController();
    const first = fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
      signal: controller.signal,
    }).catch((error: unknown) => error);
    await until(() => send.mock.calls.length === 1);
    controller.abort();
    expect(await first).toBeInstanceOf(Error);

    const refused = await fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
    });
    expect(refused.status).toBe(503);
    await expect(refused.json()).resolves.toEqual({
      error: "process_capacity_exceeded",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);

    gate.resolve();
    await operationSettled.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const afterSettlement = await fetch(`${baseUrl}/api/simulated-email`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
    });
    expect(afterSettlement.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("bounds authentication work and releases capacity after completion", async () => {
    const gate = deferred();
    const verify = vi.fn(async () => {
      await gate.promise;
      return claims;
    });
    const baseUrl = await start({ tokenVerifier: { verify } });
    const accepted = Array.from(
      { length: API_PROCESS_ADMISSION_LIMITS.purePerRoute },
      () => fetch(`${baseUrl}/api/whoami`, {
        headers: { Authorization: "Bearer fixture" },
      }),
    );
    await until(() =>
      verify.mock.calls.length ===
        API_PROCESS_ADMISSION_LIMITS.purePerRoute
    );

    await expect(fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: "Bearer fixture" },
    })).resolves.toMatchObject({ status: 503 });
    gate.resolve();
    expect((await Promise.all(accepted)).every(({ status }) => status === 200))
      .toBe(true);
    await expect(fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: "Bearer fixture" },
    })).resolves.toMatchObject({ status: 200 });
  });

  it("freezes bounded HTTP receive and keep-alive settings", async () => {
    const server = createApiServer(dependencies());
    servers.add(server);
    expect(server.headersTimeout).toBe(API_HEADERS_TIMEOUT_MS);
    expect(server.requestTimeout).toBe(API_REQUEST_RECEIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(API_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.timeout).toBe(API_INACTIVITY_TIMEOUT_MS);
    expect(server.maxHeadersCount).toBe(64);
    expect(server.maxRequestsPerSocket).toBe(100);
  });
});

async function start(
  overrides: Partial<ApiDependencies>,
): Promise<string> {
  const server = createApiServer(dependencies(overrides));
  servers.add(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function dependencies(
  overrides: Partial<ApiDependencies> = {},
): ApiDependencies {
  return {
    tokenVerifier: { verify: vi.fn(async () => claims) },
    callerPolicy: policy,
    rehearsalStatusProvider: {
      getStatus: vi.fn(async () => ({
        appName: "fixture",
        region: "fixture",
        runningStatus: "Ready" as const,
        latestReadyRevision: "fixture",
      })),
    },
    ...overrides,
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for bounded request admission");
}
