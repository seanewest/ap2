// @vitest-environment node

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultCallerPolicy } from "./auth-policy.js";
import { createApiServer } from "./server.js";
import {
  API_ROUTE_CONTRACTS,
  apiRouteContractsForPath,
} from "../src/api/api-route-contract.ts";

const server = createApiServer({
  tokenVerifier: { verify: vi.fn() },
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider: { getStatus: vi.fn() },
  allowedOrigin: "http://localhost:5173",
});
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
});

describe("API server contract dispatch", () => {
  it.each(API_ROUTE_CONTRACTS)(
    "dispatches declared $method $path through its fixed auth policy",
    async ({ authorization, method, path }) => {
      const response = await fetch(`${baseUrl}${path}`, { method });
      expect(response.status).toBe(authorization === "public" ? 200 : 401);
    },
  );

  it("rejects undeclared method/path combinations", async () => {
    await expect(fetch(`${baseUrl}/api/undeclared`)).resolves.toMatchObject({
      status: 404,
    });
    await expect(
      fetch(`${baseUrl}/api/scenario-plan`, { method: "DELETE" }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it.each([
    ...new Set(
      API_ROUTE_CONTRACTS
        .filter(({ authorization }) => authorization === "operator")
        .map(({ path }) => path),
    ),
  ])("derives protected preflight for %s", async (path) => {
    const contracts = apiRouteContractsForPath(path);
    const headers = contracts.some(({ requestContent }) =>
        requestContent === "json"
      )
      ? "Authorization, Content-Type"
      : "Authorization";
    const response = await fetch(`${baseUrl}${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": contracts[0]!.method,
        "Access-Control-Request-Headers": headers,
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      contracts.map(({ method }) => method).join(", "),
    );
  });
});
