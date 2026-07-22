import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

export interface SigningKeyProvider {
  getSigningKey(keyId: string): Promise<KeyObject>;
}

export interface JwtVerificationConfig {
  issuer: string;
  audience: string;
  signingKeys: SigningKeyProvider;
  clockToleranceSeconds?: number;
  now?: () => number;
}

export class InvalidTokenError extends Error {}

export class JwtVerifier {
  readonly #config: JwtVerificationConfig;

  constructor(config: JwtVerificationConfig) {
    if (config.issuer.length === 0 || config.audience.length === 0) {
      throw new Error("JWT issuer and audience are required");
    }
    this.#config = config;
  }

  async verify(token: string): Promise<Readonly<Record<string, unknown>>> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new InvalidTokenError("JWT must have three segments");
    }

    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    if (!encodedHeader || !encodedClaims || !encodedSignature) {
      throw new InvalidTokenError("JWT segments must not be empty");
    }

    const header = parseObject(encodedHeader, "header");
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
      throw new InvalidTokenError("JWT must use RS256 and include a key ID");
    }

    let key: KeyObject;
    try {
      key = await this.#config.signingKeys.getSigningKey(header.kid);
    } catch {
      throw new InvalidTokenError("JWT signing key is unavailable");
    }

    if (key.type !== "public" || key.asymmetricKeyType !== "rsa") {
      throw new InvalidTokenError("JWT signing key must be an RSA public key");
    }

    const signed = Buffer.from(`${encodedHeader}.${encodedClaims}`);
    const signature = decodeBase64Url(encodedSignature, "signature");
    if (!verify("RSA-SHA256", signed, key, signature)) {
      throw new InvalidTokenError("JWT signature is invalid");
    }

    const claims = parseObject(encodedClaims, "claims");
    validateRegisteredClaims(claims, this.#config);
    return claims;
  }
}

export function publicKeyFromJwk(jwk: JsonWebKey): KeyObject {
  try {
    return createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new Error("Invalid JSON web key");
  }
}

function validateRegisteredClaims(
  claims: Readonly<Record<string, unknown>>,
  config: JwtVerificationConfig,
): void {
  if (claims.iss !== config.issuer || claims.aud !== config.audience) {
    throw new InvalidTokenError("JWT issuer or audience is invalid");
  }

  const now = (config.now ?? (() => Date.now() / 1000))();
  const tolerance = config.clockToleranceSeconds ?? 30;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now - tolerance) {
    throw new InvalidTokenError("JWT is expired or has no valid expiration");
  }
  if (
    claims.nbf !== undefined &&
    (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now + tolerance)
  ) {
    throw new InvalidTokenError("JWT is not active");
  }
}

function parseObject(segment: string, label: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(decodeBase64Url(segment, label).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error();
    }
    return value as Readonly<Record<string, unknown>>;
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw error;
    }
    throw new InvalidTokenError(`JWT ${label} is invalid`);
  }
}

function decodeBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidTokenError(`JWT ${label} is not base64url encoded`);
  }
  return Buffer.from(value, "base64url");
}
