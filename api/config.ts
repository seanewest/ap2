import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_DELEGATED_USER_OBJECT_IDS,
  STUDENT_TENANT_ID,
} from "./identity.js";
import type { CallerPolicy } from "./auth-policy.js";

export interface ApiConfig {
  host: string;
  port: number;
  issuer: string;
  audience: string;
  jwksUrl: string;
  allowInsecureJwks: boolean;
  allowedOrigin?: string;
  callerPolicy: CallerPolicy;
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
  };
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
