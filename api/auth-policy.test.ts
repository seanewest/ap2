import { describe, expect, it } from "vitest";
import {
  CallerNotAllowedError,
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  InvalidClaimsError,
  STUDENT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
  authorizeClaims,
  defaultCallerPolicy,
} from "./auth-policy.js";

describe("authorizeClaims", () => {
  it("allows only the dedicated operator as a delegated caller", () => {
    expect(
      authorizeClaims(
        {
          tid: STUDENT_TENANT_ID,
          oid: STUDENT_OPERATOR_OBJECT_ID,
          scp: "access_as_user",
        },
        defaultCallerPolicy,
      ),
    ).toEqual({
      callerType: "delegated",
      objectId: STUDENT_OPERATOR_OBJECT_ID,
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
          roles: ["Api.Access"],
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
    ["another tenant", { tid: "another", oid: STUDENT_OPERATOR_OBJECT_ID, scp: "scope" }],
    ["unknown user", { tid: STUDENT_TENANT_ID, oid: "unknown", scp: "scope" }],
    [
      "unknown app",
      { tid: STUDENT_TENANT_ID, idtyp: "app", azp: "unknown", roles: ["Api.Access"] },
    ],
  ])("rejects %s", (_label, claims) => {
    expect(() => authorizeClaims(claims, defaultCallerPolicy)).toThrow(CallerNotAllowedError);
  });

  it.each([
    ["missing tenant", { oid: STUDENT_OPERATOR_OBJECT_ID, scp: "scope" }],
    ["missing delegated object ID", { tid: STUDENT_TENANT_ID, scp: "scope" }],
    ["missing delegated scopes", { tid: STUDENT_TENANT_ID, oid: STUDENT_OPERATOR_OBJECT_ID }],
    [
      "delegated claims with app roles",
      { tid: STUDENT_TENANT_ID, oid: STUDENT_OPERATOR_OBJECT_ID, scp: "scope", roles: ["role"] },
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
