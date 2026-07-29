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
  InMemoryMultiScenarioFeasibilityService,
} from "./multi-scenario-feasibility.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  AVD_PLAN_REQUEST,
  feasibleBatchRequest,
} from "../src/api/multi-scenario-feasibility.fixtures.js";
import {
  BATCH_FEASIBILITY_MAX_PLANS,
  BATCH_FEASIBILITY_MAX_REQUEST_BYTES,
} from "../src/api/multi-scenario-feasibility-contract.js";

const ISSUER = "https://auth.example.test/feasibility-operator/v2.0";
const AUDIENCE = "api://batch-feasibility-test";
const KEY_ID = "batch-feasibility-test-key";
const TOKEN_TIME = 2_000_000_000;
const PATH = "/api/multi-scenario-feasibility";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
} as JWK;
const rehearsalStatusProvider = { getStatus: vi.fn() };
const scenarioPlanService = { compile: vi.fn() };
const scenarioEvidenceVerificationService = { verify: vi.fn() };
const rehearsalOutputVerificationService = { verify: vi.fn() };
const server = createApiServer({
  tokenVerifier: tokenVerifier(),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider,
  scenarioPlanService,
  scenarioEvidenceVerificationService,
  rehearsalOutputVerificationService,
  multiScenarioFeasibilityService:
    new InMemoryMultiScenarioFeasibilityService(),
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

describe("authenticated multi-scenario feasibility HTTP path", () => {
  it.each([false, true])(
    "calculates a deterministic signed feasibility result (many=%s)",
    async (many) => {
      const externalFetch = vi.spyOn(globalThis, "fetch");
      const request = feasibleBatchRequest(many);
      const first = await feasibilityRequest(request);
      const second = await feasibilityRequest(structuredClone(request));

      expect(first.status).toBe(200);
      expect(first.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(first.body).toBe(second.body);
      expect(JSON.parse(first.body)).toMatchObject({
        label: "FEASIBILITY_ONLY",
        status: "feasible",
        planCount: many ? 2 : 1,
        blockers: [],
      });
      expect(first.body).not.toMatch(
        /actorAliases|planRequest|operationKey|proofReference|upstreamPayload|@/i,
      );
      expect(externalFetch).not.toHaveBeenCalled();
      expect(scenarioPlanService.compile).not.toHaveBeenCalled();
      expect(scenarioEvidenceVerificationService.verify).not.toHaveBeenCalled();
      expect(rehearsalOutputVerificationService.verify).not.toHaveBeenCalled();
      externalFetch.mockRestore();
    },
  );

  it("authenticates and authorizes before reading the request body", async () => {
    const body = JSON.stringify(feasibleBatchRequest());
    const missing = await rawRequest(body, {});
    const wrongActor = await rawRequest(body, {
      authorization: `Bearer ${signedToken({
        tid: STUDENT_TENANT_ID,
        oid: AFTER_PARTY_CLIENT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      })}`,
      "content-type": "application/json",
    });

    expect(missing.status).toBe(401);
    expect(wrongActor.status).toBe(403);
  });

  it("bounds content type, encoding, malformed JSON, and request bytes", async () => {
    const body = JSON.stringify(feasibleBatchRequest());
    const noType = await rawRequest(body, authHeaders());
    const encoded = await rawRequest(body, {
      ...authHeaders(),
      "content-type": "application/json",
      "content-encoding": "gzip",
    });
    const malformed = await rawRequest("{", {
      ...authHeaders(),
      "content-type": "application/json",
    });
    const oversized = await rawRequest(
      "x".repeat(BATCH_FEASIBILITY_MAX_REQUEST_BYTES + 1),
      { ...authHeaders(), "content-type": "application/json" },
    );

    expect(noType.status).toBe(415);
    expect(encoded.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(JSON.parse(malformed.body)).toEqual({
      error: "invalid_request_body",
    });
    expect(oversized.status).toBe(413);
  });

  it.each([
    {
      name: "aggregate budget",
      mutate: (value: Record<string, unknown>) => {
        (value.session as Record<string, unknown>)
          .aggregateBudgetCeilingUsd = "9.99";
      },
      blockers: ["AGGREGATE_BUDGET_OVERRUN"],
    },
    {
      name: "concurrency",
      mutate: (value: Record<string, unknown>) => {
        (value.session as Record<string, unknown>).concurrencyLimit = 1;
      },
      blockers: ["CONCURRENCY_OVERRUN"],
    },
    {
      name: "session duration",
      mutate: (value: Record<string, unknown>) => {
        const session = value.session as Record<string, unknown>;
        session.requestedDurationMinutes = 16;
        session.minimumExpiryMarginMinutes = 0;
      },
      blockers: ["SESSION_DURATION_OVERRUN"],
    },
    {
      name: "expiry margin",
      mutate: (value: Record<string, unknown>) => {
        (value.session as Record<string, unknown>)
          .minimumExpiryMarginMinutes = 6;
      },
      blockers: ["EXPIRY_MARGIN_INSUFFICIENT"],
    },
    {
      name: "human gate",
      mutate: (value: Record<string, unknown>) => {
        (value.session as Record<string, unknown>).humanGatePolicy = "refuse";
      },
      blockers: ["HUMAN_GATE_NOT_ALLOWED"],
    },
    {
      name: "duplicate instance",
      mutate: (value: Record<string, unknown>) => {
        const plans = value.plans as Array<Record<string, unknown>>;
        plans[1]!.instanceAlias = plans[0]!.instanceAlias;
      },
      blockers: ["DUPLICATE_INSTANCE"],
    },
  ])("returns the categorical infeasible $name result", async ({
    mutate,
    blockers,
  }) => {
    const request = structuredClone(
      feasibleBatchRequest(true),
    ) as unknown as Record<string, unknown>;
    mutate(request);
    const response = await feasibilityRequest(request);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      status: "infeasible",
      blockers,
    });
  });

  it.each([
    {
      name: "individual budget",
      category: "BUDGET_EXCEEDED",
      mutate: (value: Record<string, unknown>) => {
        const plans = value.plans as Array<Record<string, unknown>>;
        plans[0] = {
          instanceAlias: "avd-one",
          planRequest: { ...AVD_PLAN_REQUEST, maximumBudgetUsd: 9 },
        };
      },
    },
    {
      name: "individual expiry",
      category: "EXPIRY_INVALID",
      mutate: (value: Record<string, unknown>) => {
        const plans = value.plans as Array<Record<string, unknown>>;
        const item = plans[0]!;
        const request = item.planRequest as Record<string, unknown>;
        request.expiresAt = request.now;
      },
    },
    {
      name: "raw role alias",
      category: "RAW_IDENTIFIER_REJECTED",
      mutate: (value: Record<string, unknown>) => {
        const plans = value.plans as Array<Record<string, unknown>>;
        const request = plans[0]!.planRequest as Record<string, unknown>;
        const aliases = request.actorAliases as Record<string, unknown>;
        aliases.learner = ["learner", "example.test"].join("@");
      },
    },
    {
      name: "raw instance alias",
      category: "RAW_IDENTIFIER_REJECTED",
      mutate: (value: Record<string, unknown>) => {
        const plans = value.plans as Array<Record<string, unknown>>;
        plans[0]!.instanceAlias = ["instance", "example.test"].join("@");
      },
    },
    {
      name: "unknown field",
      category: "INPUT_INVALID",
      mutate: (value: Record<string, unknown>) => {
        value.payload = "arbitrary";
      },
    },
  ])("returns only the categorical $name refusal", async ({
    category,
    mutate,
  }) => {
    const request = structuredClone(
      feasibleBatchRequest(),
    ) as unknown as Record<string, unknown>;
    mutate(request);
    const response = await feasibilityRequest(request);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "batch_feasibility_refused",
      category,
    });
    expect(response.body).not.toMatch(/learner@|instance@|payload/i);
  });

  it("rejects empty, excessive, arbitrary-label, and unbounded session input", async () => {
    const empty = structuredClone(feasibleBatchRequest()) as unknown as
      Record<string, unknown>;
    empty.plans = [];
    const excessive = structuredClone(feasibleBatchRequest()) as unknown as
      Record<string, unknown>;
    const item = (excessive.plans as unknown[])[0]!;
    excessive.plans = Array.from(
      { length: BATCH_FEASIBILITY_MAX_PLANS + 1 },
      (_value, index) => ({
        ...(structuredClone(item) as object),
        instanceAlias: `email-${index}`,
      }),
    );
    const label = {
      ...feasibleBatchRequest(),
      label: "EXECUTE_BATCH",
    };
    const duration = structuredClone(feasibleBatchRequest()) as unknown as
      Record<string, unknown>;
    (duration.session as Record<string, unknown>)
      .requestedDurationMinutes = Number.MAX_SAFE_INTEGER;

    for (const value of [empty, excessive, label, duration]) {
      const response = await feasibilityRequest(value);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error: "batch_feasibility_refused",
        category: "INPUT_INVALID",
      });
    }
  });

  it("isolates internal exceptions without returning their text", async () => {
    const isolated = createApiServer({
      tokenVerifier: tokenVerifier(),
      callerPolicy: defaultCallerPolicy,
      rehearsalStatusProvider,
      multiScenarioFeasibilityService:
        new InMemoryMultiScenarioFeasibilityService(() => {
          throw new Error("private upstream payload");
        }),
    });
    await new Promise<void>((resolve) =>
      isolated.listen(0, "127.0.0.1", resolve)
    );
    const isolatedPort = (isolated.address() as AddressInfo).port;
    const response = await rawRequest(
      JSON.stringify(feasibleBatchRequest()),
      { ...authHeaders(), "content-type": "application/json" },
      isolatedPort,
    );
    await new Promise<void>((resolve) => isolated.close(() => resolve()));

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: "batch_feasibility_failed",
    });
    expect(response.body).not.toContain("private upstream payload");
  });

  it("accepts only authorization and content-type in CORS preflight", async () => {
    const baseHeaders = {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
    };
    const accepted = await rawRequest("", {
      ...baseHeaders,
      "access-control-request-headers": "Authorization, Content-Type",
    }, port, "OPTIONS");
    const broader = await rawRequest("", {
      ...baseHeaders,
      "access-control-request-headers":
        "Authorization, Content-Type, X-Upstream",
    }, port, "OPTIONS");

    expect(accepted.status).toBe(204);
    expect(accepted.headers["access-control-allow-headers"]).toBe(
      "Authorization, Content-Type",
    );
    expect(broader.status).toBe(403);
  });
});

function feasibilityRequest(value: unknown): Promise<HttpResult> {
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

function tokenVerifier(): JoseTokenVerifier {
  return new JoseTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => TOKEN_TIME,
  });
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
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = nodeRequest({
      hostname: "127.0.0.1",
      port: targetPort,
      path: PATH,
      method,
      headers,
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
