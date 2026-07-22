import type { JsonWebKey, KeyObject } from "node:crypto";
import { publicKeyFromJwk, type SigningKeyProvider } from "./jwt-verifier.js";

interface JwkDocument {
  keys: unknown[];
}

export class RemoteJwksSigningKeyProvider implements SigningKeyProvider {
  readonly #url: URL;
  readonly #cacheMilliseconds: number;
  readonly #missingKeyRefreshMilliseconds: number;
  #cachedAt = 0;
  #keys = new Map<string, KeyObject>();

  constructor(
    url: string,
    options: {
      allowInsecureHttp?: boolean;
      cacheMilliseconds?: number;
      missingKeyRefreshMilliseconds?: number;
    } = {},
  ) {
    this.#url = new URL(url);
    if (this.#url.protocol !== "https:" && !options.allowInsecureHttp) {
      throw new Error("JWKS URL must use HTTPS");
    }
    if (this.#url.protocol !== "https:" && this.#url.protocol !== "http:") {
      throw new Error("JWKS URL must use HTTP or HTTPS");
    }
    this.#cacheMilliseconds = options.cacheMilliseconds ?? 300_000;
    this.#missingKeyRefreshMilliseconds = options.missingKeyRefreshMilliseconds ?? 30_000;
  }

  async getSigningKey(keyId: string): Promise<KeyObject> {
    const cacheAge = Date.now() - this.#cachedAt;
    if (
      cacheAge >= this.#cacheMilliseconds ||
      this.#keys.size === 0 ||
      (!this.#keys.has(keyId) && cacheAge >= this.#missingKeyRefreshMilliseconds)
    ) {
      await this.#refresh();
    }
    const key = this.#keys.get(keyId);
    if (!key) {
      throw new Error("Signing key not found");
    }
    return key;
  }

  async #refresh(): Promise<void> {
    const response = await fetch(this.#url, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`JWKS request failed with status ${response.status}`);
    }

    const document: unknown = await response.json();
    if (!isJwkDocument(document)) {
      throw new Error("JWKS response is invalid");
    }

    const keys = new Map<string, KeyObject>();
    for (const candidate of document.keys) {
      if (!isUsableRsaSigningJwk(candidate)) {
        continue;
      }
      if (keys.has(candidate.kid)) {
        throw new Error("JWKS contains duplicate key IDs");
      }
      keys.set(candidate.kid, publicKeyFromJwk(candidate));
    }
    if (keys.size === 0) {
      throw new Error("JWKS contains no usable RS256 signing keys");
    }

    this.#keys = keys;
    this.#cachedAt = Date.now();
  }
}

function isJwkDocument(value: unknown): value is JwkDocument {
  return typeof value === "object" && value !== null && Array.isArray((value as JwkDocument).keys);
}

function isUsableRsaSigningJwk(value: unknown): value is JsonWebKey & { kid: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const key = value as Record<string, unknown>;
  return (
    key.kty === "RSA" &&
    typeof key.kid === "string" &&
    key.kid.length > 0 &&
    (key.use === undefined || key.use === "sig") &&
    (key.alg === undefined || key.alg === "RS256") &&
    typeof key.n === "string" &&
    typeof key.e === "string"
  );
}
