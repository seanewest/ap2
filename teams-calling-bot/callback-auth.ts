import {
  createLocalJWKSet,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";

const CALLBACK_ISSUER = "https://api.botframework.com";
const CALLBACK_OPENID_CONFIGURATION =
  "https://api.aps.skype.com/v1/.well-known/OpenIdConfiguration";

export interface CallbackTokenVerifier {
  verify(token: string): Promise<void>;
}

export class InvalidCallbackTokenError extends Error {}

export class JoseCallbackTokenVerifier implements CallbackTokenVerifier {
  constructor(
    private readonly tenantId: string,
    private readonly appId: string,
    private readonly keyResolver: JWTVerifyGetKey,
    private readonly now?: () => number,
  ) {}

  async verify(token: string): Promise<void> {
    try {
      const { payload } = await jwtVerify(token, this.keyResolver, {
        algorithms: ["RS256"],
        issuer: CALLBACK_ISSUER,
        audience: this.appId,
        requiredClaims: ["exp", "tid"],
        clockTolerance: 30,
        currentDate: this.now ? new Date(this.now() * 1_000) : undefined,
      });
      if (payload.tid !== this.tenantId) {
        throw new Error("Wrong tenant.");
      }
    } catch {
      throw new InvalidCallbackTokenError();
    }
  }
}

export async function createMicrosoftCallbackTokenVerifier(
  tenantId: string,
  appId: string,
  request: typeof fetch = fetch,
): Promise<CallbackTokenVerifier> {
  const response = await request(CALLBACK_OPENID_CONFIGURATION, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const metadata = await safeJson(response);
  if (
    response.status !== 200 ||
    !isRecord(metadata) ||
    metadata.issuer !== CALLBACK_ISSUER ||
    typeof metadata.jwks_uri !== "string"
  ) {
    throw new Error("Microsoft callback metadata is unavailable.");
  }
  const jwksUrl = new URL(metadata.jwks_uri);
  if (
    jwksUrl.protocol !== "https:" ||
    jwksUrl.hostname !== "api.aps.skype.com"
  ) {
    throw new Error("Microsoft callback key URL is invalid.");
  }
  const keysResponse = await request(jwksUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const keys = await safeJson(keysResponse);
  if (
    keysResponse.status !== 200 ||
    !isRecord(keys) ||
    !Array.isArray(keys.keys) ||
    keys.keys.length === 0 ||
    !keys.keys.every(isRecord)
  ) {
    throw new Error("Microsoft callback keys are unavailable.");
  }
  return new JoseCallbackTokenVerifier(
    tenantId,
    appId,
    createLocalJWKSet({ keys: keys.keys as JWK[] }),
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
