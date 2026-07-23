// @vitest-environment node

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
  defaultCallerPolicy,
} from "./auth-policy.js";
import { JwtVerifier, type SigningKeyProvider } from "./jwt-verifier.js";
import { createApiServer } from "./server.js";

const ISSUER = "https://fixtures.example/student/v2.0";
const AUDIENCE = "api://ap2-fixture";
const KEY_ID = "fixture-key";
const NOW = 2_000_000_000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signingKeys: SigningKeyProvider = {
  async getSigningKey(keyId: string): Promise<KeyObject> {
    if (keyId !== KEY_ID) {
      throw new Error("Unknown key");
    }
    return publicKey;
  },
};
const server = createApiServer({
  jwtVerifier: new JwtVerifier({ issuer: ISSUER, audience: AUDIENCE, signingKeys, now: () => NOW }),
  callerPolicy: defaultCallerPolicy,
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

  it("classifies the signed delegated operator", async () => {
    const response = await protectedRequest({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_OPERATOR_OBJECT_ID,
      scp: REQUIRED_DELEGATED_SCOPE,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      callerType: "delegated",
      objectId: STUDENT_OPERATOR_OBJECT_ID,
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
    ["another tenant", { tid: "another", oid: STUDENT_OPERATOR_OBJECT_ID, scp: "scope" }, 403],
    ["an unknown user", { tid: STUDENT_TENANT_ID, oid: "unknown", scp: "scope" }, 403],
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
      { tid: STUDENT_TENANT_ID, oid: STUDENT_OPERATOR_OBJECT_ID, scp: "other_scope" },
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
    ["missing required claims", { tid: STUDENT_TENANT_ID, oid: STUDENT_OPERATOR_OBJECT_ID }, 401],
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
  ])("rejects a correctly signed token with %s", async (_label, registeredClaim) => {
    const response = await protectedRequest({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_OPERATOR_OBJECT_ID,
      scp: "scope",
      ...registeredClaim,
    });
    expect(response.status).toBe(401);
  });

  it("rejects a tampered signed token", async () => {
    const token = fixtureToken({
      tid: STUDENT_TENANT_ID,
      oid: STUDENT_OPERATOR_OBJECT_ID,
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

async function protectedRequest(claims: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/whoami`, {
    headers: { Authorization: `Bearer ${fixtureToken(claims)}` },
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
