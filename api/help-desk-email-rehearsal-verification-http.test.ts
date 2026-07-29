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
  InMemoryHelpDeskEmailRehearsalVerificationService,
} from "./help-desk-email-rehearsal-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import type {
  HelpDeskEmailRehearsalVerificationRequest,
} from "../src/api/help-desk-email-rehearsal-verification-contract.js";
import {
  HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES,
} from "../src/api/help-desk-email-rehearsal-verification-contract.js";

const ISSUER = "https://auth.example.test/help-desk-rehearsal/v2.0";
const AUDIENCE = "api://help-desk-rehearsal-test";
const KEY_ID = "help-desk-rehearsal-test-key";
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
const service = new InMemoryHelpDeskEmailRehearsalVerificationService();
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
  helpDeskEmailRehearsalVerificationService: service,
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

describe("signed help-desk email rehearsal verification HTTP path", () => {
  it.each(["send", "retained", "cleaned"] as const)(
    "returns only the fixed %s safe summary",
    async (branch) => {
      const output = fixture(branch);
      const response = await post(output, signedToken());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFIED",
        status: "verified",
        scenarioId: "help-desk-email-observation",
        manifestSchemaVersion: 2,
        planDigestSha256: output.binding!.planDigestSha256,
        fakeRunDigestSha256: output.binding!.fakeRunDigestSha256,
        syntheticBranch: output.binding!.syntheticBranch,
        fakeContract: "one-shot-terminal-verified",
        adapter: "accepted",
        receiptVerifier: "accepted",
        envelope: "accepted",
        externalEvidence: "all-uninspected",
        claimCount: 15,
      });
    },
  );

  it("authorizes before body handling", async () => {
    verify.mockClear();
    const noToken = await fetch(
      `${baseUrl}/api/help-desk-email-rehearsal-verification`,
      { method: "POST", body: "not-json" },
    );
    const wrongCaller = await post(fixture(), signedToken("wrong-caller"));
    expect(noToken.status).toBe(401);
    expect(wrongCaller.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails closed on content type, unknown fields, and cross-family input", async () => {
    const unsupported = await fetch(
      `${baseUrl}/api/help-desk-email-rehearsal-verification`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${signedToken()}` },
        body: JSON.stringify(fixture()),
      },
    );
    const unknown = structuredClone(fixture()) as unknown as Record<string, unknown>;
    unknown.detail = "arbitrary";
    const crossFamily = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
    ), "utf8"));
    expect(unsupported.status).toBe(415);
    await expect((await post(unknown, signedToken())).json()).resolves.toEqual({
      error: "help_desk_email_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
    await expect((await post(crossFamily, signedToken())).json()).resolves
      .toEqual({
        error: "help_desk_email_rehearsal_refused",
        category: "INPUT_SHAPE",
      });
  });

  it("bounds encoding, malformed JSON, and request bytes", async () => {
    const headers = {
      Authorization: `Bearer ${signedToken()}`,
      "Content-Type": "application/json",
    };
    const encoded = await fetch(
      `${baseUrl}/api/help-desk-email-rehearsal-verification`,
      {
        method: "POST",
        headers: { ...headers, "Content-Encoding": "gzip" },
        body: JSON.stringify(fixture()),
      },
    );
    const malformed = await fetch(
      `${baseUrl}/api/help-desk-email-rehearsal-verification`,
      { method: "POST", headers, body: "{" },
    );
    const oversized = await fetch(
      `${baseUrl}/api/help-desk-email-rehearsal-verification`,
      {
        method: "POST",
        headers,
        body: "x".repeat(HELP_DESK_EMAIL_REHEARSAL_MAX_REQUEST_BYTES + 1),
      },
    );
    expect(encoded.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
  });
});

function fixture(
  branch: "send" | "retained" | "cleaned" = "send",
): HelpDeskEmailRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures",
    `help-desk-email-rehearsal-output-${branch}.json`,
  ), "utf8")) as HelpDeskEmailRehearsalVerificationRequest;
}

function post(value: unknown, token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/help-desk-email-rehearsal-verification`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
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
