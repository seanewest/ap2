import { isAbsolute } from "node:path";
import {
  AFTER_PARTY_CLIENT_ID,
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_DELEGATED_USER_OBJECT_IDS,
  STUDENT_TENANT_ID,
} from "./identity.js";
import { installation } from "../installation/server.ts";
import type { CallerPolicy } from "./auth-policy.js";

export interface SimulatedUserCertificateConfig {
  pfxPath: string;
  pfxPassphrase: string;
}

export interface SimulatedUsersCbaConfig {
  clientId: string;
  homer?: SimulatedUserCertificateConfig;
  cory?: SimulatedUserCertificateConfig & { objectId: string };
  kobe?: SimulatedUserCertificateConfig;
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
    issuer: environment.AUTH_ISSUER ??
      `https://login.microsoftonline.com/${STUDENT_TENANT_ID}/v2.0`,
    audience: environment.AUTH_AUDIENCE ?? AFTER_PARTY_CLIENT_ID,
    jwksUrl: environment.AUTH_JWKS_URL ??
      `https://login.microsoftonline.com/${STUDENT_TENANT_ID}/discovery/v2.0/keys`,
    allowInsecureJwks: environment.AUTH_ALLOW_INSECURE_JWKS === "true",
    allowedOrigin: parseAllowedOrigin(
      environment.CORS_ALLOWED_ORIGIN ?? installation.spa.allowedOrigin,
    ),
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
  const configuredClientId = environment.SIMULATED_USER_CLIENT_ID;
  const clientId = configuredClientId ?? AFTER_PARTY_CLIENT_ID;
  const homer = parseCertificate(
    environment,
    "HOMER_CBA_PFX_PATH",
    "HOMER_CBA_PFX_PASSPHRASE",
  );
  const cory = parseCertificate(
    environment,
    "CORY_CBA_PFX_PATH",
    "CORY_CBA_PFX_PASSPHRASE",
  );
  const configuredCoryObjectId = environment.CORY_CBA_OBJECT_ID;
  const coryObjectId = configuredCoryObjectId ?? installation.actors.cory.objectId;
  const kobe = parseCertificate(
    environment,
    "KOBE_CBA_PFX_PATH",
    "KOBE_CBA_PFX_PASSPHRASE",
  );

  if (
    !homer && !cory && !kobe &&
    configuredClientId === undefined &&
    configuredCoryObjectId === undefined
  ) {
    return undefined;
  }
  if (!homer && !cory && !kobe) {
    throw new Error(
      "SIMULATED_USER_CLIENT_ID and at least one complete simulated-user certificate must be configured together",
    );
  }
  if (!isUuid(clientId)) {
    throw new Error("SIMULATED_USER_CLIENT_ID must be a UUID");
  }
  if (configuredCoryObjectId && !cory) {
    throw new Error(
      "CORY_CBA_OBJECT_ID and Cory's complete certificate must be configured together",
    );
  }
  if (!isUuid(coryObjectId)) {
    throw new Error("CORY_CBA_OBJECT_ID must be a UUID");
  }
  return {
    clientId,
    ...(homer ? { homer } : {}),
    ...(kobe ? { kobe } : {}),
    ...(cory
      ? { cory: { ...cory, objectId: coryObjectId } }
      : {}),
  };
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
