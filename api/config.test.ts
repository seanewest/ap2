import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "./auth-policy.js";
import { loadApiConfig } from "./config.js";

describe("loadApiConfig", () => {
  it.each(["AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_JWKS_URL"])(
    "fails closed without %s",
    (missing) => {
      const environment: NodeJS.ProcessEnv = {
        AUTH_ISSUER: "https://issuer.example/",
        AUTH_AUDIENCE: "api://audience",
        AUTH_JWKS_URL: "https://issuer.example/keys",
      };
      delete environment[missing];
      expect(() => loadApiConfig(environment)).toThrow(`${missing} is required`);
    },
  );

  it("uses the immutable tenant and configured caller IDs", () => {
    const config = loadApiConfig({
      AUTH_ISSUER: "https://issuer.example/",
      AUTH_AUDIENCE: "api://audience",
      AUTH_JWKS_URL: "https://issuer.example/keys",
      AUTH_OPERATOR_OBJECT_ID: "configured-user",
      AUTH_AUTOMATION_CLIENT_ID: "configured-app",
    });

    expect(config.callerPolicy).toEqual({
      tenantId: STUDENT_TENANT_ID,
      operatorObjectId: "configured-user",
      automationClientId: "configured-app",
    });
  });

  it("defaults the allowed callers to the dedicated Student identities", () => {
    const config = loadApiConfig({
      AUTH_ISSUER: "https://issuer.example/",
      AUTH_AUDIENCE: "api://audience",
      AUTH_JWKS_URL: "https://issuer.example/keys",
    });

    expect(config.callerPolicy.operatorObjectId).toBe(STUDENT_OPERATOR_OBJECT_ID);
    expect(config.callerPolicy.automationClientId).toBe(DEVELOPMENT_AUTOMATION_CLIENT_ID);
  });
});
