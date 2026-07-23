// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultCallerPolicy } from "./auth-policy.js";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "./identity.js";
import type { RehearsalStatus } from "./rehearsal-status.js";
import { createApiServer } from "./server.js";
import {
  HOMER_USER_PRINCIPAL_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  SIMULATED_EMAIL_SUBJECT,
  type SimulatedEmailResult,
} from "./simulated-email.js";
import { JoseTokenVerifier } from "./token-verifier.js";

const ISSUER = "https://fixtures.example/student/v2.0";
const AUDIENCE = "api://ap2-fixture";
const KEY_ID = "fixture-key";
const NOW = 2_000_000_000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
} as JWK;
const rehearsalStatus: RehearsalStatus = {
  appName: "ca-ap2-api",
  region: "East US",
  runningStatus: "Running",
  latestReadyRevision: "ca-ap2-api--revision",
};
const rehearsalStatusProvider = {
  getStatus: vi.fn().mockResolvedValue(rehearsalStatus),
};
const simulatedEmailResult: SimulatedEmailResult = {
  accepted: true,
  sender: HOMER_USER_PRINCIPAL_NAME,
  recipient: MARGE_USER_PRINCIPAL_NAME,
  subject: SIMULATED_EMAIL_SUBJECT,
};
const simulatedEmailOperation = {
  send: vi.fn().mockResolvedValue(simulatedEmailResult),
};
const server = createApiServer({
  tokenVerifier: new JoseTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => NOW,
  }),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider,
  simulatedEmailOperation,
  allowedOrigin: "http://localhost:5173",
});
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("local API", () => {
  it("serves health without authentication", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it.each(["/api/whoami", "/api/rehearsal-status"])(
    "allows only the configured origin to preflight %s",
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "http://localhost:5173",
      );
      expect(response.headers.get("access-control-allow-methods")).toBe("GET");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Authorization",
      );
    },
  );

  it("allows only POST with Authorization to preflight the simulated email", async () => {
    const response = await fetch(`${baseUrl}/api/simulated-email`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization",
    );
  });

  it.each([
    ["GET", "Authorization"],
    ["POST", "Authorization, Content-Type"],
  ])(
    "rejects simulated email preflight for %s with %s",
    async (method, headers) => {
      const response = await fetch(`${baseUrl}/api/simulated-email`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": headers,
        },
      });

      expect(response.status).toBe(403);
    },
  );

  it("rejects another origin and broader preflight requests", async () => {
    const otherOrigin = await fetch(`${baseUrl}/api/whoami`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://other.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    expect(otherOrigin.status).toBe(403);
    expect(otherOrigin.headers.get("access-control-allow-origin")).toBeNull();

    const broaderRequest = await fetch(`${baseUrl}/api/whoami`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });
    expect(broaderRequest.status).toBe(403);
  });

  it("returns CORS headers on an allowed delegated request", async () => {
    const response = await protectedRequest(
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      },
      "http://localhost:5173",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });

  it.each([
    ["human product operator", STUDENT_PRODUCT_OPERATOR_OBJECT_ID],
    ["dedicated CBA test operator", STUDENT_CBA_TEST_OPERATOR_OBJECT_ID],
  ])("classifies the signed %s", async (_label, objectId) => {
    const response = await protectedRequest({
      tid: STUDENT_TENANT_ID,
      oid: objectId,
      scp: REQUIRED_DELEGATED_SCOPE,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      callerType: "delegated",
      objectId,
      tenantId: STUDENT_TENANT_ID,
    });
  });

  it("classifies the signed development automation app", async () => {
    const response = await protectedRequest({
      tid: STUDENT_TENANT_ID,
      idtyp: "app",
      azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
      roles: [REQUIRED_APPLICATION_ROLE],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      callerType: "app-only",
      clientId: DEVELOPMENT_AUTOMATION_CLIENT_ID,
      tenantId: STUDENT_TENANT_ID,
    });
  });

  it.each([
    [
      "delegated operator",
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      },
    ],
    [
      "development automation app",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: [REQUIRED_APPLICATION_ROLE],
      },
    ],
  ])("returns rehearsal status to the authorized %s", async (_label, claims) => {
    const response = await protectedRequest(
      claims,
      undefined,
      "/api/rehearsal-status",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(rehearsalStatus);
  });

  it("does not read Azure for an unknown delegated caller", async () => {
    rehearsalStatusProvider.getStatus.mockClear();

    const response = await protectedRequest(
      {
        tid: STUDENT_TENANT_ID,
        oid: "unknown-user",
        scp: REQUIRED_DELEGATED_SCOPE,
      },
      undefined,
      "/api/rehearsal-status",
    );

    expect(response.status).toBe(403);
    expect(rehearsalStatusProvider.getStatus).not.toHaveBeenCalled();
  });

  it.each([
    [
      "delegated operator",
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      },
    ],
    [
      "development automation app",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: [REQUIRED_APPLICATION_ROLE],
      },
    ],
  ])("sends the fixed simulated email for the authorized %s", async (
    _label,
    claims,
  ) => {
    simulatedEmailOperation.send.mockClear();

    const response = await simulatedEmailRequest(claims);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(simulatedEmailResult);
    expect(simulatedEmailOperation.send).toHaveBeenCalledOnce();
    expect(simulatedEmailOperation.send).toHaveBeenCalledWith();
  });

  it("returns the configured CORS origin on an accepted simulated email", async () => {
    simulatedEmailOperation.send.mockClear();

    const response = await simulatedEmailRequest(
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      },
      "http://localhost:5173",
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(simulatedEmailOperation.send).toHaveBeenCalledOnce();
  });

  it("does not send simulated email for an unauthorized caller", async () => {
    simulatedEmailOperation.send.mockClear();

    const response = await simulatedEmailRequest({
      tid: STUDENT_TENANT_ID,
      oid: "unknown",
      scp: REQUIRED_DELEGATED_SCOPE,
    });

    expect(response.status).toBe(403);
    expect(simulatedEmailOperation.send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "another tenant",
      {
        tid: "another",
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      },
      403,
    ],
    [
      "an unknown user",
      {
        tid: STUDENT_TENANT_ID,
        oid: "unknown",
        scp: REQUIRED_DELEGATED_SCOPE,
      },
      403,
    ],
    [
      "an unknown app",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: "unknown",
        roles: [REQUIRED_APPLICATION_ROLE],
      },
      403,
    ],
    [
      "the operator without the exact delegated scope",
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: "other_scope",
      },
      403,
    ],
    [
      "the automation app without the exact application role",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: ["other_role"],
      },
      403,
    ],
    [
      "missing required claims",
      { tid: STUDENT_TENANT_ID, oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID },
      401,
    ],
    [
      "confused delegated and app-only claims",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: [REQUIRED_APPLICATION_ROLE],
        scp: "scope",
      },
      401,
    ],
  ])("rejects a signed token from %s", async (_label, claims, status) => {
    const response = await protectedRequest(claims);
    expect(response.status).toBe(status);
  });

  it("rejects an unsigned token", async () => {
    const token = [
      Buffer.from(JSON.stringify({ alg: "none", kid: KEY_ID })).toString("base64url"),
      Buffer.from(JSON.stringify(registeredClaims({ tid: STUDENT_TENANT_ID }))).toString("base64url"),
      "unsigned",
    ].join(".");
    const response = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  it.each([
    ["wrong issuer", { iss: "https://wrong.example/" }],
    ["wrong audience", { aud: "api://wrong" }],
    ["expired lifetime", { exp: NOW - 60 }],
    ["future not-before time", { nbf: NOW + 60 }],
    ["missing expiration", { exp: undefined }],
  ])("rejects a correctly signed token with %s", async (_label, registeredClaim) => {
    const response = await protectedRequest({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
      scp: "scope",
      ...registeredClaim,
    });
    expect(response.status).toBe(401);
  });

  it("rejects a tampered signed token", async () => {
    const token = fixtureToken({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
      scp: "scope",
    });
    const [header, _claims, signature] = token.split(".");
    const tamperedClaims = Buffer.from(
      JSON.stringify(registeredClaims({
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: [REQUIRED_APPLICATION_ROLE],
      })),
    ).toString("base64url");
    const response = await fetch(`${baseUrl}/api/whoami`, {
      headers: { Authorization: `Bearer ${header}.${tamperedClaims}.${signature}` },
    });
    expect(response.status).toBe(401);
  });
});

async function protectedRequest(
  claims: Record<string, unknown>,
  origin?: string,
  path = "/api/whoami",
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${fixtureToken(claims)}`,
      ...(origin ? { Origin: origin } : {}),
    },
  });
}

async function simulatedEmailRequest(
  claims: Record<string, unknown>,
  origin?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/simulated-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fixtureToken(claims)}`,
      ...(origin ? { Origin: origin } : {}),
    },
  });
}

function fixtureToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(registeredClaims(claims))).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString(
    "base64url",
  );
  return `${header}.${payload}.${signature}`;
}

function registeredClaims(claims: Record<string, unknown>): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    exp: NOW + 300,
    nbf: NOW - 10,
    ...claims,
  };
}
