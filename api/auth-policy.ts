export const STUDENT_TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
export const STUDENT_OPERATOR_OBJECT_ID = "ba97e987-da4c-43e1-ab79-3daa8014440e";
export const DEVELOPMENT_AUTOMATION_CLIENT_ID = "7eb78f18-b49c-495c-a571-af03f06b58a9";

export interface CallerPolicy {
  tenantId: string;
  operatorObjectId: string;
  automationClientId: string;
}

export const defaultCallerPolicy: CallerPolicy = {
  tenantId: STUDENT_TENANT_ID,
  operatorObjectId: STUDENT_OPERATOR_OBJECT_ID,
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

  requiredSpaceSeparatedClaim(claims, "scp");
  const objectId = requiredString(claims, "oid");
  if (objectId !== policy.operatorObjectId) {
    throw new CallerNotAllowedError("Delegated caller is not allowed");
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

  requiredStringArray(claims, "roles");
  const clientId = requiredString(claims, "azp");
  if (clientId !== policy.automationClientId) {
    throw new CallerNotAllowedError("App-only caller is not allowed");
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
): void {
  const value = requiredString(claims, name);
  if (value.split(" ").some((part) => part.length === 0)) {
    throw new InvalidClaimsError(`Invalid ${name} claim`);
  }
}

function requiredStringArray(
  claims: Readonly<Record<string, unknown>>,
  name: string,
): void {
  const value = claims[name];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new InvalidClaimsError(`Missing or invalid ${name} claim`);
  }
}
