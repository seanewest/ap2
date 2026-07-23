import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export interface TokenVerifier {
  verify(token: string): Promise<Readonly<Record<string, unknown>>>;
}

export interface TokenVerifierConfig {
  issuer: string;
  audience: string;
  keyResolver: JWTVerifyGetKey;
  now?: () => number;
}

export class JoseTokenVerifier implements TokenVerifier {
  readonly #config: TokenVerifierConfig;

  constructor(config: TokenVerifierConfig) {
    if (!config.issuer || !config.audience) {
      throw new Error("JWT issuer and audience are required");
    }
    this.#config = config;
  }

  async verify(token: string): Promise<Readonly<Record<string, unknown>>> {
    try {
      const { payload } = await jwtVerify<Record<string, unknown>>(
        token,
        this.#config.keyResolver,
        {
          algorithms: ["RS256"],
          issuer: this.#config.issuer,
          audience: this.#config.audience,
          requiredClaims: ["exp"],
          clockTolerance: 30,
          currentDate: this.#config.now
            ? new Date(this.#config.now() * 1_000)
            : undefined,
        },
      );
      return payload;
    } catch {
      throw new InvalidTokenError();
    }
  }
}

export function createRemoteTokenVerifier(
  config: Omit<TokenVerifierConfig, "keyResolver"> & {
    jwksUrl: string;
    allowInsecureHttp?: boolean;
  },
): TokenVerifier {
  const jwksUrl = new URL(config.jwksUrl);
  if (
    jwksUrl.protocol !== "https:" &&
    !(config.allowInsecureHttp && jwksUrl.protocol === "http:")
  ) {
    throw new Error("JWKS URL must use HTTPS");
  }

  return new JoseTokenVerifier({
    issuer: config.issuer,
    audience: config.audience,
    keyResolver: createRemoteJWKSet(jwksUrl),
    now: config.now,
  });
}

export class InvalidTokenError extends Error {}
