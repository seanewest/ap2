// @vitest-environment node

import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createLocalJWKSet, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultCallerPolicy } from "./auth-policy.js";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "./identity.js";
import {
  InMemoryOauthApplicationReconRehearsalVerificationService,
} from "./oauth-application-recon-rehearsal-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES,
  type OauthApplicationReconRehearsalVerificationRequest,
} from "../src/api/oauth-application-recon-rehearsal-verification-contract.js";

const ISSUER = "https://auth.example.test/oauth-recon-rehearsal/v2.0";
const AUDIENCE = "api://oauth-recon-rehearsal-test";
const KEY_ID = "oauth-recon-rehearsal-test-key";
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
const service =
  new InMemoryOauthApplicationReconRehearsalVerificationService();
const verify = vi.spyOn(service, "verify");
const server = createApiServer({
  tokenVerifier: new JoseTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
    now: () => TOKEN_TIME,
  }),
  callerPolicy: defaultCallerPolicy,
  rehearsalStatusProvider: { getStatus: vi.fn() },
  oauthApplicationReconRehearsalVerificationService: service,
});
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("signed OAuth application-recon rehearsal verification HTTP path", () => {
  it("returns only the fixed safe summary", async () => {
    const output = fixture();
    const response = await post(output, signedToken());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      scenarioId: "oauth-application-reconnaissance",
      manifestSchemaVersion: 2,
      planDigestSha256: output.binding!.planDigestSha256,
      fakeResultDigestSha256: output.binding!.fakeResultDigestSha256,
      outputDigestSha256:
        "5bff66e08b05f871c21c5491d85314e64add30ce89bfdab734e2b35182dc378b",
      fakeContract: "ordered-four-read-terminal-verified",
      adapter: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
      externalEvidence: "all-uninspected",
      claimCount: 13,
    });
  });

  it("authorizes before reading or validating the body", async () => {
    verify.mockClear();
    const noToken = await fetch(
      `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
      { method: "POST", body: "not-json" },
    );
    const wrongCaller = await post(fixture(), signedToken("wrong-caller"));
    expect(noToken.status).toBe(401);
    expect(wrongCaller.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails closed on content type, unknown fields, and cross-family input", async () => {
    const unsupported = await fetch(
      `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${signedToken()}` },
        body: JSON.stringify(fixture()),
      },
    );
    const unknown =
      structuredClone(fixture()) as unknown as Record<string, unknown>;
    unknown.detail = "arbitrary";
    const crossFamily = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json",
    ), "utf8"));
    expect(unsupported.status).toBe(415);
    await expect((await post(unknown, signedToken())).json()).resolves.toEqual({
      error: "oauth_application_recon_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
    await expect((await post(crossFamily, signedToken())).json()).resolves
      .toEqual({
        error: "oauth_application_recon_rehearsal_refused",
        category: "INPUT_SHAPE",
      });
  });

  it("bounds encoding, malformed JSON, request bytes, and methods", async () => {
    const headers = {
      Authorization: `Bearer ${signedToken()}`,
      "Content-Type": "application/json",
    };
    const encoded = await fetch(
      `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
      {
        method: "POST",
        headers: { ...headers, "Content-Encoding": "gzip" },
        body: JSON.stringify(fixture()),
      },
    );
    const malformed = await fetch(
      `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
      { method: "POST", headers, body: "{" },
    );
    const oversized = await fetch(
      `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
      {
        method: "POST",
        headers,
        body: "x".repeat(
          OAUTH_APPLICATION_RECON_REHEARSAL_MAX_REQUEST_BYTES + 1,
        ),
      },
    );
    const wrongMethod = await fetch(
      `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
      { method: "GET", headers },
    );
    expect(encoded.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(wrongMethod.status).toBe(404);
  });
});

function fixture(): OauthApplicationReconRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/oauth-application-recon-rehearsal-output.json",
  ), "utf8")) as OauthApplicationReconRehearsalVerificationRequest;
}

function post(value: unknown, token: string): Promise<Response> {
  return fetch(
    `${baseUrl}/api/oauth-application-recon-rehearsal-verification`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    },
  );
}

function signedToken(oid = STUDENT_PRODUCT_OPERATOR_OBJECT_ID): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    nbf: TOKEN_TIME - 5,
    exp: TOKEN_TIME + 300,
    tid: STUDENT_TENANT_ID,
    oid,
    scp: REQUIRED_DELEGATED_SCOPE,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
