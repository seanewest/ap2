import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiServer } from "./server.ts";

const tokenVerifier = {
  verify: vi.fn(async () => {
    throw new Error("Shutdown must precede authentication");
  }),
};
const sharePointTrustedVersionLifecycleOperation = {
  run: vi.fn(() => {
    throw new Error("Shutdown must precede body parsing and dispatch");
  }),
};
const simulatedEmailOperation = {
  send: vi.fn(async () => {
    throw new Error("Shutdown must precede mutation dispatch");
  }),
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
  sharePointTrustedVersionLifecycleOperation,
  simulatedEmailOperation,
  isShuttingDown: () => true,
});
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("API draining admission boundary", () => {
  it.each([
    ["GET", "/health", undefined],
    ["POST", "/api/sharepoint-trusted-version-lifecycle", "not-json"],
    ["POST", "/api/simulated-email", undefined],
  ])("refuses %s %s before authentication, body parsing, or dispatch", async (
    method,
    path,
    body,
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: "Bearer fixture" },
      ...(body === undefined ? {} : { body }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "server_shutting_down",
    });
  });

  it("does not reach protected services while draining", () => {
    expect(tokenVerifier.verify).not.toHaveBeenCalled();
    expect(sharePointTrustedVersionLifecycleOperation.run).not.toHaveBeenCalled();
    expect(simulatedEmailOperation.send).not.toHaveBeenCalled();
  });
});
