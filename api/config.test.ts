import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
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
      AUTH_DELEGATED_USER_OBJECT_IDS: "configured-user-one, configured-user-two",
      AUTH_AUTOMATION_CLIENT_ID: "configured-app",
    });

    expect(config.callerPolicy).toEqual({
      tenantId: STUDENT_TENANT_ID,
      delegatedUserObjectIds: ["configured-user-one", "configured-user-two"],
      automationClientId: "configured-app",
    });
  });

  it("defaults the allowed callers to the dedicated Student identities", () => {
    const config = loadApiConfig({
      AUTH_ISSUER: "https://issuer.example/",
      AUTH_AUDIENCE: "api://audience",
      AUTH_JWKS_URL: "https://issuer.example/keys",
    });

    expect(config.callerPolicy.delegatedUserObjectIds).toEqual([
      STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
      STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
    ]);
    expect(config.callerPolicy.automationClientId).toBe(DEVELOPMENT_AUTOMATION_CLIENT_ID);
  });

  it.each(["", "user-one,", "user-one,user-one"])(
    "rejects an invalid delegated-user allowlist: %j",
    (objectIds) => {
      expect(() =>
        loadApiConfig({
          AUTH_ISSUER: "https://issuer.example/",
          AUTH_AUDIENCE: "api://audience",
          AUTH_JWKS_URL: "https://issuer.example/keys",
          AUTH_DELEGATED_USER_OBJECT_IDS: objectIds,
        }),
      ).toThrow(
        "AUTH_DELEGATED_USER_OBJECT_IDS must be a comma-separated list of unique non-empty object IDs",
      );
    },
  );

  it("accepts one exact browser origin and otherwise leaves CORS disabled", () => {
    expect(
      loadApiConfig({
        AUTH_ISSUER: "https://issuer.example/",
        AUTH_AUDIENCE: "api://audience",
        AUTH_JWKS_URL: "https://issuer.example/keys",
        CORS_ALLOWED_ORIGIN: "http://localhost:5173/",
      }).allowedOrigin,
    ).toBe("http://localhost:5173");
    expect(
      loadApiConfig({
        AUTH_ISSUER: "https://issuer.example/",
        AUTH_AUDIENCE: "api://audience",
        AUTH_JWKS_URL: "https://issuer.example/keys",
      }).allowedOrigin,
    ).toBeUndefined();
  });

  it.each([
    "ftp://localhost:5173",
    "http://user:password@localhost:5173",
    "http://localhost:5173/path",
    "http://localhost:5173?query=value",
  ])("rejects an unsafe CORS origin: %s", (origin) => {
    expect(() =>
      loadApiConfig({
        AUTH_ISSUER: "https://issuer.example/",
        AUTH_AUDIENCE: "api://audience",
        AUTH_JWKS_URL: "https://issuer.example/keys",
        CORS_ALLOWED_ORIGIN: origin,
      }),
    ).toThrow("CORS_ALLOWED_ORIGIN must be one exact HTTP(S) origin");
  });
});
