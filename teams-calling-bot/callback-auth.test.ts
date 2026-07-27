// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import {
  InvalidCallbackTokenError,
  JoseCallbackTokenVerifier,
} from "./callback-auth.js";

const TENANT_ID = "fixture-tenant";
const APP_ID = "fixture-app";
const NOW = 2_000_000_000;

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  keySet = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: "expected", alg: "RS256", use: "sig" }],
  } as { keys: JWK[] });
});

describe("JoseCallbackTokenVerifier", () => {
  it("accepts only the exact signed callback identity", async () => {
    const verifier = new JoseCallbackTokenVerifier(
      TENANT_ID,
      APP_ID,
      keySet,
      () => NOW,
    );
    await expect(verifier.verify(await token())).resolves.toBeUndefined();
  });

  it.each([
    ["wrong audience", { audience: "other-app" }],
    ["wrong tenant", { tenantId: "other-tenant" }],
    ["wrong issuer", { issuer: "https://example.invalid" }],
    ["expired", { expiresAt: NOW - 60 }],
    ["wrong signature", { key: "other" }],
  ])("rejects %s", async (_label, options) => {
    const verifier = new JoseCallbackTokenVerifier(
      TENANT_ID,
      APP_ID,
      keySet,
      () => NOW,
    );
    await expect(verifier.verify(await token(options))).rejects.toBeInstanceOf(
      InvalidCallbackTokenError,
    );
  });
});

async function token(options: {
  audience?: string;
  tenantId?: string;
  issuer?: string;
  expiresAt?: number;
  key?: string;
} = {}): Promise<string> {
  return await new SignJWT({
    tid: options.tenantId ?? TENANT_ID,
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: options.key === "other" ? "other" : "expected",
    })
    .setIssuer(options.issuer ?? "https://api.botframework.com")
    .setAudience(options.audience ?? APP_ID)
    .setIssuedAt(NOW - 10)
    .setExpirationTime(options.expiresAt ?? NOW + 300)
    .sign(options.key === "other" ? otherPrivateKey : privateKey);
}
