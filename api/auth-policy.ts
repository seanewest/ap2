import {
  DEVELOPMENT_AUTOMATION_CLIENT_ID,
  REQUIRED_APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_DELEGATED_USER_OBJECT_IDS,
  STUDENT_TENANT_ID,
} from "./identity.js";

export interface CallerPolicy {
  tenantId: string;
  delegatedUserObjectIds: readonly string[];
  automationClientId: string;
}

export const defaultCallerPolicy: CallerPolicy = {
  tenantId: STUDENT_TENANT_ID,
  delegatedUserObjectIds: STUDENT_DELEGATED_USER_OBJECT_IDS,
  automationClientId: DEVELOPMENT_AUTOMATION_CLIENT_ID,
};

export type AuthorizedCaller =
  | {
      callerType: "delegated";
      objectId: string;
      tenantId: string;
    }
  | {
      callerType: "app-only";
      clientId: string;
      tenantId: string;
    };

export class InvalidClaimsError extends Error {}
export class CallerNotAllowedError extends Error {}

export function authorizeClaims(
  claims: Readonly<Record<string, unknown>>,
  policy: CallerPolicy,
): AuthorizedCaller {
  const tenantId = requiredString(claims, "tid");
  if (tenantId !== policy.tenantId) {
    throw new CallerNotAllowedError("Token tenant is not allowed");
  }

  if (claims.idtyp === "app") {
    return authorizeAppOnly(claims, policy, tenantId);
  }

  if (claims.idtyp !== undefined && claims.idtyp !== "user") {
    throw new InvalidClaimsError("Unsupported token identity type");
  }

  return authorizeDelegated(claims, policy, tenantId);
}

function authorizeDelegated(
  claims: Readonly<Record<string, unknown>>,
  policy: CallerPolicy,
  tenantId: string,
): AuthorizedCaller {
  if (claims.roles !== undefined) {
    throw new InvalidClaimsError("Delegated tokens must not contain app roles");
  }

  const scopes = requiredSpaceSeparatedClaim(claims, "scp");
  const objectId = requiredString(claims, "oid");
  if (!policy.delegatedUserObjectIds.includes(objectId)) {
    throw new CallerNotAllowedError("Delegated caller is not allowed");
  }
  if (!scopes.includes(REQUIRED_DELEGATED_SCOPE)) {
    throw new CallerNotAllowedError("Delegated token lacks the required scope");
  }

  return { callerType: "delegated", objectId, tenantId };
}

function authorizeAppOnly(
  claims: Readonly<Record<string, unknown>>,
  policy: CallerPolicy,
  tenantId: string,
): AuthorizedCaller {
  if (claims.scp !== undefined) {
    throw new InvalidClaimsError("App-only tokens must not contain delegated scopes");
  }

  const roles = requiredStringArray(claims, "roles");
  const clientId = requiredString(claims, "azp");
  if (clientId !== policy.automationClientId) {
    throw new CallerNotAllowedError("App-only caller is not allowed");
  }
  if (!roles.includes(REQUIRED_APPLICATION_ROLE)) {
    throw new CallerNotAllowedError("App-only token lacks the required role");
  }

  return { callerType: "app-only", clientId, tenantId };
}

function requiredString(
  claims: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = claims[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidClaimsError(`Missing or invalid ${name} claim`);
  }
  return value;
}

function requiredSpaceSeparatedClaim(
  claims: Readonly<Record<string, unknown>>,
  name: string,
): string[] {
  const value = requiredString(claims, name);
  const values = value.split(" ");
  if (values.some((part) => part.length === 0)) {
    throw new InvalidClaimsError(`Invalid ${name} claim`);
  }
  return values;
}

function requiredStringArray(
  claims: Readonly<Record<string, unknown>>,
  name: string,
): string[] {
  const value = claims[name];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new InvalidClaimsError(`Missing or invalid ${name} claim`);
  }
  return value;
}
