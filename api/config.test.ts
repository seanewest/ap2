import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "./identity.js";
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
    expect(config.simulatedUsersCba).toBeUndefined();
  });

  it("accepts complete per-user CBA configuration under one client", () => {
    const config = loadApiConfig({
      AUTH_ISSUER: "https://issuer.example/",
      AUTH_AUDIENCE: "api://audience",
      AUTH_JWKS_URL: "https://issuer.example/keys",
      SIMULATED_USER_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
      HOMER_CBA_PFX_PATH: "/run/secrets/homer.pfx",
      HOMER_CBA_PFX_PASSPHRASE: "secret-passphrase",
      MARGE_CBA_OBJECT_ID: "22222222-2222-4222-8222-222222222222",
      MARGE_CBA_PFX_PATH: "/run/secrets/marge.pfx",
      MARGE_CBA_PFX_PASSPHRASE: "another-secret",
    });

    expect(config.simulatedUsersCba).toEqual({
      clientId: "11111111-1111-4111-8111-111111111111",
      homer: {
        pfxPath: "/run/secrets/homer.pfx",
        pfxPassphrase: "secret-passphrase",
      },
      marge: {
        objectId: "22222222-2222-4222-8222-222222222222",
        pfxPath: "/run/secrets/marge.pfx",
        pfxPassphrase: "another-secret",
      },
    });
  });

  it.each([
    ["SIMULATED_USER_CLIENT_ID", "11111111-1111-4111-8111-111111111111"],
    ["HOMER_CBA_PFX_PATH", "/run/secrets/homer.pfx"],
    ["HOMER_CBA_PFX_PASSPHRASE", "secret-passphrase"],
  ])("rejects partial Homer CBA configuration with only %s", (name, value) => {
    expect(() =>
      loadApiConfig({
        AUTH_ISSUER: "https://issuer.example/",
        AUTH_AUDIENCE: "api://audience",
        AUTH_JWKS_URL: "https://issuer.example/keys",
        [name]: value,
      }),
    ).toThrow("must be configured together");
  });

  it("rejects an invalid Homer client ID or non-absolute PFX path", () => {
    const environment = {
      AUTH_ISSUER: "https://issuer.example/",
      AUTH_AUDIENCE: "api://audience",
      AUTH_JWKS_URL: "https://issuer.example/keys",
      SIMULATED_USER_CLIENT_ID: "not-a-client-id",
      HOMER_CBA_PFX_PATH: "/run/secrets/homer.pfx",
      HOMER_CBA_PFX_PASSPHRASE: "secret-passphrase",
    };
    expect(() => loadApiConfig(environment)).toThrow(
      "SIMULATED_USER_CLIENT_ID must be a UUID",
    );
    expect(() =>
      loadApiConfig({
        ...environment,
        SIMULATED_USER_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
        HOMER_CBA_PFX_PATH: "homer.pfx",
      }),
    ).toThrow("HOMER_CBA_PFX_PATH must be an absolute path");
  });

  it("rejects partial or invalid Marge configuration independently", () => {
    const base = {
      AUTH_ISSUER: "https://issuer.example/",
      AUTH_AUDIENCE: "api://audience",
      AUTH_JWKS_URL: "https://issuer.example/keys",
      SIMULATED_USER_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
    };
    expect(() =>
      loadApiConfig({
        ...base,
        MARGE_CBA_PFX_PATH: "/run/secrets/marge.pfx",
      }),
    ).toThrow(
      "MARGE_CBA_PFX_PATH and MARGE_CBA_PFX_PASSPHRASE must be configured together",
    );
    expect(() =>
      loadApiConfig({
        ...base,
        MARGE_CBA_OBJECT_ID: "not-a-uuid",
        MARGE_CBA_PFX_PATH: "/run/secrets/marge.pfx",
        MARGE_CBA_PFX_PASSPHRASE: "secret",
      }),
    ).toThrow("MARGE_CBA_OBJECT_ID must be a UUID");
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
