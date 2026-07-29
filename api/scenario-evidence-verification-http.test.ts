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
  InMemoryScenarioEvidenceVerificationService,
  SCENARIO_RECEIPT_MAX_REQUEST_BYTES,
} from "./scenario-evidence-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  CANONICAL_RECEIPT_FIXTURES,
  NEGATIVE_RECEIPT_FIXTURES,
} from "../src/scenarios/scenario-evidence-receipt.fixtures.js";

const ISSUER = "https://auth.example.test/receipt-operator/v2.0";
const AUDIENCE = "api://receipt-verification-test";
const KEY_ID = "receipt-verification-test-key";
const TOKEN_TIME = 2_000_000_000;
const PATH = "/api/scenario-evidence-verification";

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
const server = createApiServer({
  tokenVerifier: tokenVerifier(),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider,
  scenarioEvidenceVerificationService:
    new InMemoryScenarioEvidenceVerificationService(),
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

describe("authenticated scenario evidence verification HTTP path", () => {
  it.each(CANONICAL_RECEIPT_FIXTURES)(
    "verifies $name deterministically with signed operator auth and no external calls",
    async ({ receipt }) => {
      const externalFetch = vi.spyOn(globalThis, "fetch");
      const first = await receiptRequest(receipt);
      const second = await receiptRequest(structuredClone(receipt));

      expect(first.status).toBe(200);
      expect(first.headers["content-type"]).toBe(
        "application/json; charset=utf-8",
      );
      expect(first.body).toBe(second.body);
      expect(JSON.parse(first.body)).toMatchObject({
        kind: "verified-scenario-evidence-receipt",
        scenarioId: receipt.scenario.id,
      });
      expect(first.body).not.toMatch(
        /operationKey|proofReference|upstreamPayload|@|\/home\//i,
      );
      expect(externalFetch).not.toHaveBeenCalled();
      externalFetch.mockRestore();
    },
  );

  it("authenticates and authorizes before reading the receipt", async () => {
    const body = JSON.stringify(CANONICAL_RECEIPT_FIXTURES[0]!.receipt);
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
    expect(rehearsalStatusProvider.getStatus).not.toHaveBeenCalled();
  });

  it("bounds content type, JSON shape, and request bytes", async () => {
    const receipt = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;
    const noType = await rawRequest(JSON.stringify(receipt), authHeaders());
    const malformed = await rawRequest("{", {
      ...authHeaders(),
      "content-type": "application/json",
    });
    const oversized = await rawRequest(
      "x".repeat(SCENARIO_RECEIPT_MAX_REQUEST_BYTES + 1),
      { ...authHeaders(), "content-type": "application/json" },
    );

    expect(noType.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  it.each([
    {
      name: "unknown field",
      mutate: (value: Record<string, unknown>) => {
        value.payload = "arbitrary";
      },
      category: "shape",
    },
    {
      name: "raw actor alias",
      mutate: (value: Record<string, unknown>) => {
        const roles = value.roles as Record<string, unknown>;
        roles.learner = ["learner", "example.test"].join("@");
      },
      category: "raw-identifier",
    },
    {
      name: "scenario version",
      mutate: (value: Record<string, unknown>) => {
        const scenario = value.scenario as Record<string, unknown>;
        scenario.manifestSchemaVersion = 3;
      },
      category: "shape",
    },
    {
      name: "unknown scenario",
      mutate: (value: Record<string, unknown>) => {
        const scenario = value.scenario as Record<string, unknown>;
        scenario.id = "unknown-scenario";
      },
      category: "scenario-mismatch",
    },
    {
      name: "empty claims",
      mutate: (value: Record<string, unknown>) => {
        value.claims = [];
      },
      category: "shape",
    },
    {
      name: "too many claims",
      mutate: (value: Record<string, unknown>) => {
        const claims = value.claims as Array<Record<string, unknown>>;
        value.claims = Array.from({ length: 257 }, () =>
          structuredClone(claims[0]!)
        );
      },
      category: "shape",
    },
    {
      name: "long claim alias",
      mutate: (value: Record<string, unknown>) => {
        const claims = value.claims as Array<Record<string, unknown>>;
        claims[0]!.id = "a".repeat(101);
      },
      category: "raw-identifier",
    },
    {
      name: "extra actor role",
      mutate: (value: Record<string, unknown>) => {
        const roles = value.roles as Record<string, unknown>;
        roles.operator = "operator";
      },
      category: "shape",
    },
    {
      name: "observation category",
      mutate: (value: Record<string, unknown>) => {
        const claims = value.claims as Array<Record<string, unknown>>;
        const observed = claims.find((claim) => claim.observation !== undefined)!;
        (observed.observation as Record<string, unknown>).source = "arbitrary";
      },
      category: "shape",
    },
    {
      name: "claim marker",
      mutate: (value: Record<string, unknown>) => {
        const claims = value.claims as Array<Record<string, unknown>>;
        claims[0]!.id = "marker-run-value";
      },
      category: "raw-identifier",
    },
  ])("returns a categorical refusal for $name", async ({ mutate, category }) => {
    const value = structuredClone(
      CANONICAL_RECEIPT_FIXTURES[0]!.receipt,
    ) as unknown as Record<string, unknown>;
    mutate(value);
    const response = await receiptRequest(value);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "scenario_evidence_receipt_refused",
      category,
    });
  });

  it("refuses receipt overclaims without exposing verifier detail", async () => {
    const fixture = NEGATIVE_RECEIPT_FIXTURES[0]!;
    const response = await receiptRequest(fixture.receipt);

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: "scenario_evidence_receipt_refused",
      category: fixture.expectedCode,
    });
  });

  it("isolates verifier exceptions and never returns their text", async () => {
    const isolated = createApiServer({
      tokenVerifier: tokenVerifier(),
      callerPolicy: defaultCallerPolicy,
      rehearsalStatusProvider,
      scenarioEvidenceVerificationService:
        new InMemoryScenarioEvidenceVerificationService(() => {
          throw new Error("private upstream payload");
        }),
    });
    await new Promise<void>((resolve) =>
      isolated.listen(0, "127.0.0.1", resolve)
    );
    const isolatedPort = (isolated.address() as AddressInfo).port;
    const response = await rawRequest(
      JSON.stringify(CANONICAL_RECEIPT_FIXTURES[0]!.receipt),
      { ...authHeaders(), "content-type": "application/json" },
      isolatedPort,
    );
    await new Promise<void>((resolve) => isolated.close(() => resolve()));

    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: "scenario_evidence_receipt_failed",
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

function receiptRequest(value: unknown): Promise<HttpResult> {
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
