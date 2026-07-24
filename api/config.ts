import { isAbsolute } from "node:path";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_DELEGATED_USER_OBJECT_IDS,
  STUDENT_TENANT_ID,
} from "./identity.js";
import type { CallerPolicy } from "./auth-policy.js";

export interface SimulatedUserCertificateConfig {
  pfxPath: string;
  pfxPassphrase: string;
}

export interface SimulatedUsersCbaConfig {
  clientId: string;
  homer: SimulatedUserCertificateConfig;
}

export interface ApiConfig {
  host: string;
  port: number;
  issuer: string;
  audience: string;
  jwksUrl: string;
  allowInsecureJwks: boolean;
  allowedOrigin?: string;
  callerPolicy: CallerPolicy;
  simulatedUsersCba?: SimulatedUsersCbaConfig;
}

export function loadApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: environment.HOST ?? "0.0.0.0",
    port: parsePort(environment.PORT ?? "3000"),
    issuer: required(environment, "AUTH_ISSUER"),
    audience: required(environment, "AUTH_AUDIENCE"),
    jwksUrl: required(environment, "AUTH_JWKS_URL"),
    allowInsecureJwks: environment.AUTH_ALLOW_INSECURE_JWKS === "true",
    allowedOrigin: parseAllowedOrigin(environment.CORS_ALLOWED_ORIGIN),
    callerPolicy: {
      tenantId: STUDENT_TENANT_ID,
      delegatedUserObjectIds: parseDelegatedUserObjectIds(
        environment.AUTH_DELEGATED_USER_OBJECT_IDS,
      ),
      automationClientId:
        environment.AUTH_AUTOMATION_CLIENT_ID ?? DEVELOPMENT_AUTOMATION_CLIENT_ID,
    },
    simulatedUsersCba: parseSimulatedUsersCbaConfig(environment),
  };
}

function parseSimulatedUsersCbaConfig(
  environment: NodeJS.ProcessEnv,
): SimulatedUsersCbaConfig | undefined {
  const clientId = environment.SIMULATED_USER_CLIENT_ID;
  const homer = parseCertificate(
    environment,
    "HOMER_CBA_PFX_PATH",
    "HOMER_CBA_PFX_PASSPHRASE",
  );

  if (clientId === undefined && !homer) {
    return undefined;
  }
  if (!clientId || !homer) {
    throw new Error(
      "SIMULATED_USER_CLIENT_ID and Homer's complete certificate must be configured together",
    );
  }
  if (!isUuid(clientId)) {
    throw new Error("SIMULATED_USER_CLIENT_ID must be a UUID");
  }
  return { clientId, homer };
}

function parseCertificate(
  environment: NodeJS.ProcessEnv,
  pathName: string,
  passphraseName: string,
): SimulatedUserCertificateConfig | undefined {
  const path = environment[pathName];
  const passphrase = environment[passphraseName];
  if (path === undefined && passphrase === undefined) {
    return undefined;
  }
  if (!path || !passphrase) {
    throw new Error(`${pathName} and ${passphraseName} must be configured together`);
  }
  if (!isAbsolute(path)) {
    throw new Error(`${pathName} must be an absolute path`);
  }
  return { pfxPath: path, pfxPassphrase: passphrase };
}

function parseDelegatedUserObjectIds(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [...STUDENT_DELEGATED_USER_OBJECT_IDS];
  }
  const objectIds = value.split(",").map((objectId) => objectId.trim());
  if (
    objectIds.some((objectId) => objectId.length === 0) ||
    new Set(objectIds).size !== objectIds.length
  ) {
    throw new Error(
      "AUTH_DELEGATED_USER_OBJECT_IDS must be a comma-separated list of unique non-empty object IDs",
    );
  }
  return objectIds;
}

function parseAllowedOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CORS_ALLOWED_ORIGIN must be one exact HTTP(S) origin");
  }
  return url.origin;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer from 0 through 65535");
  }
  return port;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
