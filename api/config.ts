import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
  type CallerPolicy,
} from "./auth-policy.js";

export interface ApiConfig {
  host: string;
  port: number;
  issuer: string;
  audience: string;
  jwksUrl: string;
  allowInsecureJwks: boolean;
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
    callerPolicy: {
      tenantId: STUDENT_TENANT_ID,
      operatorObjectId: environment.AUTH_OPERATOR_OBJECT_ID ?? STUDENT_OPERATOR_OBJECT_ID,
      automationClientId:
        environment.AUTH_AUTOMATION_CLIENT_ID ?? DEVELOPMENT_AUTOMATION_CLIENT_ID,
    },
  };
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
