// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import { request as nodeRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultCallerPolicy } from "./auth-policy.js";
import {
  AFTER_PARTY_CLIENT_ID,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "./identity.js";
import {
  InMemoryScenarioPlanService,
  SCENARIO_PLAN_MAX_REQUEST_BYTES,
} from "./scenario-plan.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import type { ScenarioPlanningRequest } from "../src/scenarios/scenario-plan.js";

const ISSUER = "https://auth.example.test/operator/v2.0";
const AUDIENCE = "api://scenario-plan-test";
const KEY_ID = "scenario-plan-test-key";
const TOKEN_TIME = 2_000_000_000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
} as JWK;

const REQUESTS = [
  {
    scenarioId: "help-desk-email-observation",
    actorAliases: {
      evidenceProducer: "producer",
      workloadActor: "sender",
      learner: "learner",
      cleanupOwner: "producer",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T06:15:00Z",
    maximumBudgetUsd: 0,
  },
  {
    scenarioId: "avd-three-vm-substrate",
    actorAliases: {
      evidenceProducer: "orchestrator",
      workloadActor: "endpoint",
      learner: "learner",
      responder: "orchestrator",
      cleanupOwner: "orchestrator",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T11:00:00Z",
    maximumBudgetUsd: 10,
  },
  {
    scenarioId: "teams-missed-call-observation",
    actorAliases: {
      evidenceProducer: "instructor",
      workloadActor: "caller",
      learner: "learner",
      cleanupOwner: "instructor",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T06:15:00Z",
    maximumBudgetUsd: 0,
  },
  {
    scenarioId: "oauth-application-reconnaissance",
    actorAliases: {
      evidenceProducer: "harness",
      workloadActor: "workload",
      learner: "learner",
      detector: "observer",
      cleanupOwner: "harness",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T07:00:00Z",
    maximumBudgetUsd: 0,
  },
] as const satisfies readonly ScenarioPlanningRequest[];

const rehearsalStatusProvider = { getStatus: vi.fn() };
const server = createApiServer({
  tokenVerifier: new JoseTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => TOKEN_TIME,
  }),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider,
  scenarioPlanService: new InMemoryScenarioPlanService(),
  allowedOrigin: "http://localhost:5173",
});
let port: number;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("authenticated scenario-plan HTTP product path", () => {
  it.each(REQUESTS)(
    "compiles $scenarioId deterministically for a signed operator without external calls",
    async (planningRequest) => {
      const externalFetch = vi.spyOn(globalThis, "fetch");
      const first = await planRequest(planningRequest);
      const second = await planRequest(planningRequest);

      expect(first.status).toBe(200);
      expect(first.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(first.body).toEqual(second.body);
      expect(JSON.parse(first.body)).toMatchObject({
        kind: "scenario-execution-plan",
        scenarioId: planningRequest.scenarioId,
      });
      expect(first.body).not.toMatch(
        /@|onmicrosoft|\/home\/|tenant|subscription|credential|token|session/i,
      );
      expect(externalFetch).not.toHaveBeenCalled();
      externalFetch.mockRestore();
    },
  );

  it("authenticates before parsing and requires operator authorization", async () => {
    const missing = await rawRequest(JSON.stringify(REQUESTS[0]), {});
    const wrongActor = await rawRequest(JSON.stringify(REQUESTS[0]), {
      authorization: `Bearer ${signedToken({
        tid: STUDENT_TENANT_ID,
        oid: AFTER_PARTY_CLIENT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      })}`,
      "content-type": "application/json",
    });

    expect(missing.status).toBe(401);
    expect(wrongActor.status).toBe(403);
    expect(rehearsalStatusProvider.getStatus).not.toHaveBeenCalled();
  });

  it("fails closed for media type, malformed, oversized, extra, and raw inputs", async () => {
    const noType = await rawRequest(JSON.stringify(REQUESTS[0]), authHeaders());
    const malformed = await rawRequest("{", {
      ...authHeaders(),
      "content-type": "application/json",
    });
    const oversized = await rawRequest(
      "x".repeat(SCENARIO_PLAN_MAX_REQUEST_BYTES + 1),
      { ...authHeaders(), "content-type": "application/json" },
    );
    const extra = await planRequest({ ...REQUESTS[0], payload: "arbitrary" });
    const raw = await planRequest({
      ...REQUESTS[0],
      actorAliases: {
        ...REQUESTS[0].actorAliases,
        learner: ["learner", "example.test"].join("@"),
      },
    });

    expect(noType.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(extra.status).toBe(400);
    expect(JSON.parse(extra.body)).toEqual({
      error: "scenario_plan_refused",
      category: "INPUT_INVALID",
    });
    expect(JSON.parse(raw.body)).toEqual({
      error: "scenario_plan_refused",
      category: "RAW_IDENTIFIER_REJECTED",
    });
  });

  it.each([
    [
      { ...REQUESTS[0], expiresAt: REQUESTS[0].now },
      "EXPIRY_INVALID",
    ],
    [
      { ...REQUESTS[1], maximumBudgetUsd: 0 },
      "BUDGET_EXCEEDED",
    ],
    [
      { ...REQUESTS[0], selectedResponseId: "undeclared-response" },
      "RESPONSE_NOT_ALLOWED",
    ],
    [
      {
        ...REQUESTS[0],
        actorAliases: { ...REQUESTS[0].actorAliases, learner: "BadAlias" },
      },
      "ACTOR_BINDING_INVALID",
    ],
  ])("returns categorical refusal %s", async (value, category) => {
    const response = await planRequest(value);
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "scenario_plan_refused",
      category,
    });
  });

  it("isolates compiler exceptions and never returns their text", async () => {
    const isolatedServer = createApiServer({
      tokenVerifier: new JoseTokenVerifier({
        issuer: ISSUER,
        audience: AUDIENCE,
        keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
        now: () => TOKEN_TIME,
      }),
      callerPolicy: defaultCallerPolicy,
      rehearsalStatusProvider,
      scenarioPlanService: new InMemoryScenarioPlanService(() => {
        throw new Error("private upstream payload");
      }),
    });
    await new Promise<void>((resolve) =>
      isolatedServer.listen(0, "127.0.0.1", resolve)
    );
    const isolatedPort = (isolatedServer.address() as AddressInfo).port;
    const result = await rawRequest(
      JSON.stringify(REQUESTS[0]),
      { ...authHeaders(), "content-type": "application/json" },
      isolatedPort,
    );
    await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));

    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: "scenario_plan_failed",
    });
    expect(result.body).not.toContain("private upstream payload");
  });

  it("accepts only the exact CORS request headers", async () => {
    const accepted = await rawRequest("", {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "Authorization, Content-Type",
    }, port, "OPTIONS", "http://localhost:5173");
    const broader = await rawRequest("", {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "Authorization, Content-Type, X-Extra",
    }, port, "OPTIONS", "http://localhost:5173");

    expect(accepted.status).toBe(204);
    expect(accepted.headers["access-control-allow-headers"]).toBe(
      "Authorization, Content-Type",
    );
    expect(broader.status).toBe(403);
  });
});

function planRequest(value: unknown): Promise<HttpResult> {
  return rawRequest(JSON.stringify(value), {
    ...authHeaders(),
    "content-type": "application/json",
  });
}

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${signedToken({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
      scp: REQUIRED_DELEGATED_SCOPE,
    })}`,
  };
}

function signedToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    exp: TOKEN_TIME + 300,
    nbf: TOKEN_TIME - 10,
    ...claims,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

interface HttpResult {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

function rawRequest(
  body: string,
  headers: Record<string, string>,
  targetPort = port,
  method = "POST",
  origin?: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = nodeRequest({
      hostname: "127.0.0.1",
      port: targetPort,
      path: "/api/scenario-plan",
      method,
      headers: {
        ...headers,
        ...(origin === undefined ? {} : { origin }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: {
          "content-type": response.headers["content-type"],
          "access-control-allow-headers":
            response.headers["access-control-allow-headers"],
        },
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
