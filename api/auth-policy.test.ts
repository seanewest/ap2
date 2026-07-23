import { describe, expect, it } from "vitest";
import {
  CallerNotAllowedError,
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  InvalidClaimsError,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
  authorizeClaims,
  defaultCallerPolicy,
} from "./auth-policy.js";

describe("authorizeClaims", () => {
  it.each([
    ["human product operator", STUDENT_PRODUCT_OPERATOR_OBJECT_ID],
    ["dedicated CBA test operator", STUDENT_CBA_TEST_OPERATOR_OBJECT_ID],
  ])("allows the %s as a delegated caller", (_label, objectId) => {
    expect(
      authorizeClaims(
        {
          tid: STUDENT_TENANT_ID,
          oid: objectId,
          scp: REQUIRED_DELEGATED_SCOPE,
        },
        defaultCallerPolicy,
      ),
    ).toEqual({
      callerType: "delegated",
      objectId,
      tenantId: STUDENT_TENANT_ID,
    });
  });

  it("allows only the development automation client as an app-only caller", () => {
    expect(
      authorizeClaims(
        {
          tid: STUDENT_TENANT_ID,
          idtyp: "app",
          azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
          roles: [REQUIRED_APPLICATION_ROLE],
        },
        defaultCallerPolicy,
      ),
    ).toEqual({
      callerType: "app-only",
      clientId: DEVELOPMENT_AUTOMATION_CLIENT_ID,
      tenantId: STUDENT_TENANT_ID,
    });
  });

  it.each([
    [
      "another tenant",
      {
        tid: "another",
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: REQUIRED_DELEGATED_SCOPE,
      },
    ],
    [
      "unknown user",
      { tid: STUDENT_TENANT_ID, oid: "unknown", scp: REQUIRED_DELEGATED_SCOPE },
    ],
    [
      "unknown app",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: "unknown",
        roles: [REQUIRED_APPLICATION_ROLE],
      },
    ],
  ])("rejects %s", (_label, claims) => {
    expect(() => authorizeClaims(claims, defaultCallerPolicy)).toThrow(CallerNotAllowedError);
  });

  it.each([
    [
      "delegated caller without the exact scope",
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: "other_scope",
      },
    ],
    [
      "app-only caller without the exact role",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: ["other_role"],
      },
    ],
  ])("rejects %s", (_label, claims) => {
    expect(() => authorizeClaims(claims, defaultCallerPolicy)).toThrow(CallerNotAllowedError);
  });

  it.each([
    ["missing tenant", { oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID, scp: "scope" }],
    ["missing delegated object ID", { tid: STUDENT_TENANT_ID, scp: "scope" }],
    [
      "missing delegated scopes",
      { tid: STUDENT_TENANT_ID, oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID },
    ],
    [
      "delegated claims with app roles",
      {
        tid: STUDENT_TENANT_ID,
        oid: STUDENT_CBA_TEST_OPERATOR_OBJECT_ID,
        scp: "scope",
        roles: ["role"],
      },
    ],
    [
      "app claims with delegated scopes",
      {
        tid: STUDENT_TENANT_ID,
        idtyp: "app",
        azp: DEVELOPMENT_AUTOMATION_CLIENT_ID,
        roles: ["role"],
        scp: "scope",
      },
    ],
    [
      "app claims missing roles",
      { tid: STUDENT_TENANT_ID, idtyp: "app", azp: DEVELOPMENT_AUTOMATION_CLIENT_ID },
    ],
    [
      "app-like claims missing app identity type",
      { tid: STUDENT_TENANT_ID, azp: DEVELOPMENT_AUTOMATION_CLIENT_ID, roles: ["role"] },
    ],
  ])("rejects invalid shape: %s", (_label, claims) => {
    expect(() => authorizeClaims(claims, defaultCallerPolicy)).toThrow(InvalidClaimsError);
  });
});
