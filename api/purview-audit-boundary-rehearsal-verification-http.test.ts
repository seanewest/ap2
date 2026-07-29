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
  InMemoryPurviewAuditBoundaryRehearsalVerificationService,
} from "./purview-audit-boundary-rehearsal-verification.js";
import { createApiServer } from "./server.js";
import { JoseTokenVerifier } from "./token-verifier.js";
import {
  PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES,
  type PurviewAuditBoundaryRehearsalVerificationRequest,
} from "../src/api/purview-audit-boundary-rehearsal-verification-contract.js";

const ISSUER = "https://auth.example.test/purview-rehearsal/v2.0";
const AUDIENCE = "api://purview-rehearsal-test";
const KEY_ID = "purview-rehearsal-test-key";
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
  new InMemoryPurviewAuditBoundaryRehearsalVerificationService();
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
  purviewAuditBoundaryRehearsalVerificationService: service,
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

describe("signed Purview rehearsal verification transport seam", () => {
  it("authorizes before reading or validating the body", async () => {
    verify.mockClear();
    const noToken = await fetch(
      `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
      { method: "POST", body: "not-json" },
    );
    const wrongCaller = await post({}, signedToken("wrong-caller"));
    expect(noToken.status).toBe(401);
    expect(wrongCaller.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns only the authoritative fixed safe summary", async () => {
    verify.mockClear();
    const output = fixture();
    const response = await post(output, signedToken());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      scenarioId: "purview-sharepoint-audit-boundary",
      manifestSchemaVersion: 2,
      planDigestSha256: output.binding!.planDigestSha256,
      syntheticInputDigestSha256:
        output.binding!.syntheticInputDigestSha256,
      receiptDigestSha256: output.binding!.receiptDigestSha256,
      outputDigestSha256: output.binding!.outputDigestSha256,
      syntheticContract:
        "deduplicated-producer-attribution-terminal-verified",
      adapter: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
      externalEvidence: "all-uninspected",
      claimCount: 14,
      producerAttributionClaimCount: 1,
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith(output);
  });

  it("fails closed on unknown, cardinality-drifted, and cross-family input", async () => {
    const unknown = fixture() as unknown as Record<string, unknown>;
    unknown.detail = "arbitrary";
    const cardinality = fixture();
    (cardinality.receipt as unknown as Record<string, unknown>)
      .duplicatePageClaimCount = 2;
    const crossFamily = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/teams-missed-call-rehearsal-output-stage-only.json",
    ), "utf8"));

    await expect((await post(unknown, signedToken())).json()).resolves.toEqual({
      error: "purview_audit_boundary_rehearsal_refused",
      category: "INPUT_SHAPE",
    });
    await expect((await post(cardinality, signedToken())).json()).resolves
      .toEqual({
        error: "purview_audit_boundary_rehearsal_refused",
        category: "DEDUPLICATION_MISMATCH",
      });
    await expect((await post(crossFamily, signedToken())).json()).resolves
      .toEqual({
        error: "purview_audit_boundary_rehearsal_refused",
        category: "INPUT_SHAPE",
      });
  });

  it("fails closed on content type, encoding, malformed JSON, bounds, and methods", async () => {
    const authorization = { Authorization: `Bearer ${signedToken()}` };
    const unsupported = await fetch(
      `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
      {
        method: "POST",
        headers: authorization,
        body: "{}",
      },
    );
    const encoded = await fetch(
      `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
      {
        method: "POST",
        headers: {
          ...authorization,
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        body: "{}",
      },
    );
    const malformed = await fetch(
      `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: "{",
      },
    );
    const oversized = await fetch(
      `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: "x".repeat(
          PURVIEW_AUDIT_BOUNDARY_REHEARSAL_MAX_REQUEST_BYTES + 1,
        ),
      },
    );
    const wrongMethod = await fetch(
      `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
      { method: "GET", headers: authorization },
    );
    expect(unsupported.status).toBe(415);
    expect(encoded.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(wrongMethod.status).toBe(404);
  });
});

function post(value: unknown, token: string): Promise<Response> {
  return fetch(
    `${baseUrl}/api/purview-audit-boundary-rehearsal-verification`,
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

function fixture(): PurviewAuditBoundaryRehearsalVerificationRequest {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "scripts/fixtures/purview-audit-boundary-rehearsal-output.json",
  ), "utf8")) as PurviewAuditBoundaryRehearsalVerificationRequest;
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
