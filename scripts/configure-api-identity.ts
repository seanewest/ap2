import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  AFTER_PARTY_CLIENT_ID,
  DEVELOPMENT_AUTOMATION_CLIENT_ID as AUTOMATION_CLIENT_ID,
  PRODUCT_TENANT_ID,
  REQUIRED_APPLICATION_ROLE as APPLICATION_ROLE,
  REQUIRED_DELEGATED_SCOPE as DELEGATED_SCOPE,
  STUDENT_TENANT_ID,
} from "../api/identity.ts";

const APPLICATION_ID_URI = `api://${AFTER_PARTY_CLIENT_ID}`;
const DELEGATED_SCOPE_ID = "59c976f0-118f-436f-8938-e0f2f0f1c84b";
const APPLICATION_ROLE_ID = "b6e481bc-9bf3-4faf-8b11-5d3e80ba1724";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

type JsonObject = Record<string, unknown>;

const [command, artifactDirectoryArgument] = process.argv.slice(2);
if (!command || !artifactDirectoryArgument) {
  fail(
    "Usage: node scripts/configure-api-identity.ts " +
      "<product-apply|student-apply|verify-product|verify-student> <artifact-directory>",
  );
}

const artifactDirectory = resolve(artifactDirectoryArgument);
ensureIsolatedAzureConfig();
ensureArtifactDirectory();

switch (command) {
  case "product-apply":
    applyProductConfiguration();
    break;
  case "student-apply":
    applyStudentConfiguration();
    break;
  case "verify-product":
    verifyProduct();
    break;
  case "verify-student":
    verifyStudent();
    break;
  default:
    fail(`Unknown command: ${command}`);
}

function applyProductConfiguration(): void {
  assertTenantAndGraphToken(PRODUCT_TENANT_ID);
  const application = uniqueByAppId("applications", AFTER_PARTY_CLIENT_ID);
  const patch = buildProductPatch(application);
  writeJsonOnce("product-before.json", {
    capturedAt: new Date().toISOString(),
    tenantId: PRODUCT_TENANT_ID,
    applicationObjectId: requiredString(application, "id"),
    applicationId: AFTER_PARTY_CLIENT_ID,
    rollbackPatch: {
      identifierUris: application.identifierUris ?? [],
      api: application.api ?? null,
      appRoles: application.appRoles ?? [],
      optionalClaims: application.optionalClaims ?? null,
      requiredResourceAccess: application.requiredResourceAccess ?? [],
    },
  });

  assertTenantAndGraphToken(PRODUCT_TENANT_ID);
  graphRequest(
    "PATCH",
    `/applications/${requiredString(application, "id")}`,
    patch,
  );
  console.log("Applied Product API resource configuration");
  verifyProduct();
}

function applyStudentConfiguration(): void {
  assertTenantAndGraphToken(STUDENT_TENANT_ID);
  const productServicePrincipal = uniqueByAppId(
    "servicePrincipals",
    AFTER_PARTY_CLIENT_ID,
  );
  const automationApplication = uniqueByAppId(
    "applications",
    AUTOMATION_CLIENT_ID,
  );
  const automationServicePrincipal = uniqueByAppId(
    "servicePrincipals",
    AUTOMATION_CLIENT_ID,
  );
  assertAutomationCertificate(automationApplication);
  const propagatedProductServicePrincipal = waitForProductPermissions(
    requiredString(productServicePrincipal, "id"),
  );

  const productServicePrincipalId = requiredString(
    propagatedProductServicePrincipal,
    "id",
  );
  const automationServicePrincipalId = requiredString(
    automationServicePrincipal,
    "id",
  );
  const grants = listValues(
    `/oauth2PermissionGrants?$filter=${encodeURIComponent(
      `clientId eq '${productServicePrincipalId}'`,
    )}`,
  );
  const matchingGrants = grants.filter(
    (grant) => grant.resourceId === productServicePrincipalId,
  );
  refuseDuplicates(matchingGrants, "self-resource delegated permission grants");

  const assignments = listValues(
    `/servicePrincipals/${automationServicePrincipalId}/appRoleAssignments`,
  );
  const matchingAssignments = assignments.filter(
    (assignment) =>
      assignment.resourceId === productServicePrincipalId &&
      assignment.appRoleId === APPLICATION_ROLE_ID,
  );
  refuseDuplicates(
    matchingAssignments,
    "automation API application-role assignments",
  );

  writeJsonOnce("student-before.json", {
    capturedAt: new Date().toISOString(),
    tenantId: STUDENT_TENANT_ID,
    productServicePrincipal: propagatedProductServicePrincipal,
    automationApplication,
    automationServicePrincipal,
    matchingDelegatedGrant: matchingGrants[0] ?? null,
    matchingApplicationRoleAssignment: matchingAssignments[0] ?? null,
  });

  const changes: JsonObject[] = [];
  const existingGrant = matchingGrants[0];
  if (!existingGrant) {
    assertTenantAndGraphToken(STUDENT_TENANT_ID);
    const created = graphRequest("POST", "/oauth2PermissionGrants", {
      clientId: productServicePrincipalId,
      consentType: "AllPrincipals",
      resourceId: productServicePrincipalId,
      scope: DELEGATED_SCOPE,
    });
    changes.push({
      kind: "createdDelegatedGrant",
      id: requiredString(created, "id"),
      rollback: `DELETE /oauth2PermissionGrants/${requiredString(created, "id")}`,
    });
  } else {
    if (
      existingGrant.consentType !== "AllPrincipals" ||
      (existingGrant.principalId !== null &&
        existingGrant.principalId !== undefined)
    ) {
      fail("Existing self-resource delegated grant has an unexpected shape");
    }
    const existingScopes = spaceSeparatedValues(existingGrant.scope);
    if (!existingScopes.includes(DELEGATED_SCOPE)) {
      assertTenantAndGraphToken(STUDENT_TENANT_ID);
      const grantId = requiredString(existingGrant, "id");
      graphRequest("PATCH", `/oauth2PermissionGrants/${grantId}`, {
        scope: [...existingScopes, DELEGATED_SCOPE].join(" "),
      });
      changes.push({
        kind: "updatedDelegatedGrant",
        id: grantId,
        rollbackPatch: { scope: existingGrant.scope },
      });
    }
  }

  if (!matchingAssignments[0]) {
    assertTenantAndGraphToken(STUDENT_TENANT_ID);
    const created = graphRequest(
      "POST",
      `/servicePrincipals/${automationServicePrincipalId}/appRoleAssignments`,
      {
        principalId: automationServicePrincipalId,
        resourceId: productServicePrincipalId,
        appRoleId: APPLICATION_ROLE_ID,
      },
    );
    changes.push({
      kind: "createdApplicationRoleAssignment",
      id: requiredString(created, "id"),
      rollback:
        `DELETE /servicePrincipals/${automationServicePrincipalId}` +
        `/appRoleAssignments/${requiredString(created, "id")}`,
    });
  }

  writeJsonOnce("student-changes.json", {
    appliedAt: new Date().toISOString(),
    tenantId: STUDENT_TENANT_ID,
    changes,
  });
  console.log(`Applied ${changes.length} Student permission change(s)`);
  verifyStudent();
}

function verifyProduct(): void {
  assertTenantAndGraphToken(PRODUCT_TENANT_ID);
  const application = uniqueByAppId("applications", AFTER_PARTY_CLIENT_ID);
  const expectedPatch = buildProductPatch(application);

  if (
    JSON.stringify(application.identifierUris) !==
      JSON.stringify(expectedPatch.identifierUris) ||
    JSON.stringify(application.appRoles) !==
      JSON.stringify(expectedPatch.appRoles) ||
    JSON.stringify(application.api) !== JSON.stringify(expectedPatch.api) ||
    JSON.stringify(application.optionalClaims) !==
      JSON.stringify(expectedPatch.optionalClaims) ||
    JSON.stringify(application.requiredResourceAccess) !==
      JSON.stringify(expectedPatch.requiredResourceAccess)
  ) {
    fail("Product application verification failed");
  }
  console.log("Verified Product API resource configuration");
}

function verifyStudent(): void {
  assertTenantAndGraphToken(STUDENT_TENANT_ID);
  const productServicePrincipal = uniqueByAppId(
    "servicePrincipals",
    AFTER_PARTY_CLIENT_ID,
  );
  const automationApplication = uniqueByAppId(
    "applications",
    AUTOMATION_CLIENT_ID,
  );
  const automationServicePrincipal = uniqueByAppId(
    "servicePrincipals",
    AUTOMATION_CLIENT_ID,
  );
  assertAutomationCertificate(automationApplication);

  const productServicePrincipalId = requiredString(productServicePrincipal, "id");
  const propagatedProductServicePrincipal = waitForProductPermissions(
    productServicePrincipalId,
  );
  const automationServicePrincipalId = requiredString(
    automationServicePrincipal,
    "id",
  );
  assertProductPermissions(propagatedProductServicePrincipal);

  const grants = listValues(
    `/oauth2PermissionGrants?$filter=${encodeURIComponent(
      `clientId eq '${productServicePrincipalId}'`,
    )}`,
  ).filter((grant) => grant.resourceId === productServicePrincipalId);
  refuseDuplicates(grants, "self-resource delegated permission grants");
  const grant = grants[0];
  if (
    !grant ||
    grant.consentType !== "AllPrincipals" ||
    !spaceSeparatedValues(grant.scope).includes(DELEGATED_SCOPE)
  ) {
    fail("Student delegated permission grant verification failed");
  }

  const assignments = listValues(
    `/servicePrincipals/${automationServicePrincipalId}/appRoleAssignments`,
  ).filter(
    (assignment) =>
      assignment.resourceId === productServicePrincipalId &&
      assignment.appRoleId === APPLICATION_ROLE_ID,
  );
  refuseDuplicates(
    assignments,
    "automation API application-role assignments",
  );
  if (assignments.length !== 1) {
    fail("Student application-role assignment verification failed");
  }
  console.log("Verified Student API grants and exact automation certificate");
}

function buildProductPatch(application: JsonObject): JsonObject {
  const identifierUris = stringArray(application.identifierUris);
  refuseDuplicateStrings(identifierUris, APPLICATION_ID_URI, "Application ID URI");
  if (!identifierUris.includes(APPLICATION_ID_URI)) {
    identifierUris.push(APPLICATION_ID_URI);
  }

  const api = objectOrEmpty(application.api);
  const scopes = objectArray(api.oauth2PermissionScopes);
  const matchingScopes = scopes.filter((scope) => scope.value === DELEGATED_SCOPE);
  refuseDuplicates(matchingScopes, "delegated API scopes");
  refuseIdCollision(scopes, DELEGATED_SCOPE_ID, DELEGATED_SCOPE, "scope");
  if (!matchingScopes[0]) {
    scopes.push({
      id: DELEGATED_SCOPE_ID,
      value: DELEGATED_SCOPE,
      type: "Admin",
      isEnabled: true,
      adminConsentDisplayName: "Access After Party as the signed-in user",
      adminConsentDescription:
        "Allow the application to access After Party on behalf of the signed-in user.",
      userConsentDisplayName: null,
      userConsentDescription: null,
    });
  } else if (matchingScopes[0].id !== DELEGATED_SCOPE_ID) {
    fail("Existing delegated scope uses an unexpected immutable ID");
  }
  api.oauth2PermissionScopes = scopes;
  api.requestedAccessTokenVersion = 2;

  const appRoles = objectArray(application.appRoles);
  const matchingRoles = appRoles.filter((role) => role.value === APPLICATION_ROLE);
  refuseDuplicates(matchingRoles, "application API roles");
  refuseIdCollision(appRoles, APPLICATION_ROLE_ID, APPLICATION_ROLE, "app role");
  if (!matchingRoles[0]) {
    appRoles.push({
      id: APPLICATION_ROLE_ID,
      value: APPLICATION_ROLE,
      displayName: "Access After Party as an application",
      description: "Allow an application to access the After Party API.",
      isEnabled: true,
      allowedMemberTypes: ["Application"],
      origin: "Application",
    });
  } else if (matchingRoles[0].id !== APPLICATION_ROLE_ID) {
    fail("Existing application role uses an unexpected immutable ID");
  }

  const optionalClaims = objectOrEmpty(application.optionalClaims);
  const accessTokenClaims = objectArray(optionalClaims.accessToken);
  const identityTypeClaims = accessTokenClaims.filter(
    (claim) => claim.name === "idtyp",
  );
  refuseDuplicates(identityTypeClaims, "idtyp access-token optional claims");
  if (!identityTypeClaims[0]) {
    accessTokenClaims.push({
      name: "idtyp",
      source: null,
      essential: true,
      additionalProperties: [],
    });
  }
  optionalClaims.accessToken = accessTokenClaims;

  const requiredResourceAccess = objectArray(
    application.requiredResourceAccess,
  );
  const selfResources = requiredResourceAccess.filter(
    (resource) => resource.resourceAppId === AFTER_PARTY_CLIENT_ID,
  );
  refuseDuplicates(selfResources, "self required-resource entries");
  if (!selfResources[0]) {
    requiredResourceAccess.push({
      resourceAppId: AFTER_PARTY_CLIENT_ID,
      resourceAccess: [{ id: DELEGATED_SCOPE_ID, type: "Scope" }],
    });
  } else {
    const resourceAccess = objectArray(selfResources[0].resourceAccess);
    const matches = resourceAccess.filter(
      (permission) =>
        permission.id === DELEGATED_SCOPE_ID && permission.type === "Scope",
    );
    refuseDuplicates(matches, "self delegated required permissions");
    if (!matches[0]) {
      resourceAccess.push({ id: DELEGATED_SCOPE_ID, type: "Scope" });
    }
    selfResources[0].resourceAccess = resourceAccess;
  }

  return {
    identifierUris,
    api,
    appRoles,
    optionalClaims,
    requiredResourceAccess,
  };
}

function waitForProductPermissions(servicePrincipalId: string): JsonObject {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const servicePrincipal = graphRequest(
      "GET",
      `/servicePrincipals/${servicePrincipalId}?$select=id,appId,displayName,appRoles,oauth2PermissionScopes`,
    );
    if (hasProductPermissions(servicePrincipal)) {
      return servicePrincipal;
    }
    if (attempt < 12) {
      console.log(`Waiting for Product permission propagation (${attempt}/12)`);
      execFileSync("sleep", ["5"]);
    }
  }
  fail("Product scopes and app roles did not propagate to Student within 60 seconds");
}

function assertProductPermissions(servicePrincipal: JsonObject): void {
  if (!hasProductPermissions(servicePrincipal)) {
    fail("Student Product service principal is missing the expected scope or role");
  }
}

function hasProductPermissions(servicePrincipal: JsonObject): boolean {
  const scopes = objectArray(servicePrincipal.oauth2PermissionScopes);
  const roles = objectArray(servicePrincipal.appRoles);
  return (
    scopes.some(
      (scope) =>
        scope.id === DELEGATED_SCOPE_ID &&
        scope.value === DELEGATED_SCOPE &&
        scope.isEnabled === true,
    ) &&
    roles.some(
      (role) =>
        role.id === APPLICATION_ROLE_ID &&
        role.value === APPLICATION_ROLE &&
        role.isEnabled === true,
    )
  );
}

function assertAutomationCertificate(application: JsonObject): void {
  const certificatePath = process.env.AP2_AUTOMATION_CERTIFICATE_PATH;
  if (!certificatePath) {
    fail("AP2_AUTOMATION_CERTIFICATE_PATH is required");
  }
  const resolvedPath = realpathSync(certificatePath);
  const mode = statSync(resolvedPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail("Automation certificate file must not be accessible by group or others");
  }
  const certificate = new X509Certificate(readFileSync(resolvedPath));
  const fingerprint = certificate.fingerprint.replaceAll(":", "").toUpperCase();
  const credentials = objectArray(application.keyCredentials);
  const matches = credentials.filter(
    (credential) =>
      credential.customKeyIdentifier === fingerprint &&
      credential.type === "AsymmetricX509Cert" &&
      credential.usage === "Verify",
  );
  refuseDuplicates(matches, "matching automation certificate credentials");
  const match = matches[0];
  if (matches.length !== 1 || !match) {
    fail("The local automation certificate does not match exactly one credential");
  }
  const end = match.endDateTime;
  if (typeof end !== "string" || Date.parse(end) <= Date.now()) {
    fail("The matching automation certificate credential is expired");
  }
}

function assertTenantAndGraphToken(expectedTenantId: string): void {
  const account = azJson(["account", "show"]);
  if (requiredString(account, "tenantId") !== expectedTenantId) {
    fail(`Azure account tenant is not ${expectedTenantId}`);
  }
  const tokenResponse = azJson([
    "account",
    "get-access-token",
    "--resource-type",
    "ms-graph",
  ]);
  const claims = decodeClaims(requiredString(tokenResponse, "accessToken"));
  if (claims.tid !== expectedTenantId) {
    fail(`Microsoft Graph token tenant is not ${expectedTenantId}`);
  }
  console.log(`Asserted Azure account and Graph token tenant ${expectedTenantId}`);
}

function ensureIsolatedAzureConfig(): void {
  const configured = process.env.AZURE_CONFIG_DIR;
  if (!configured) {
    fail("AZURE_CONFIG_DIR must point to an isolated CLI context");
  }
  const normal = resolve(process.env.HOME ?? "", ".azure");
  if (realpathSync(configured) === realpathSync(normal)) {
    fail("Refusing to use the normal Azure CLI context");
  }
}

function ensureArtifactDirectory(): void {
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  chmodSync(artifactDirectory, 0o700);
}

function writeJsonOnce(name: string, value: unknown): void {
  const path = resolve(artifactDirectory, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Wrote rollback artifact ${path}`);
}

function uniqueByAppId(resource: "applications" | "servicePrincipals", appId: string): JsonObject {
  const values = listValues(
    `/${resource}?$filter=${encodeURIComponent(`appId eq '${appId}'`)}`,
  );
  const value = values[0];
  if (values.length !== 1 || !value) {
    fail(`Expected exactly one ${resource} object for appId ${appId}; found ${values.length}`);
  }
  return value;
}

function listValues(path: string): JsonObject[] {
  return objectArray(graphRequest("GET", path).value);
}

function graphRequest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: JsonObject,
): JsonObject {
  const args = [
    "rest",
    "--method",
    method,
    "--url",
    `${GRAPH_ROOT}${path}`,
    "--output",
    "json",
    "--only-show-errors",
  ];
  if (body) {
    args.push("--headers", "Content-Type=application/json", "--body", JSON.stringify(body));
  }
  const output = execFileSync("az", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
  return output ? asObject(JSON.parse(output)) : {};
}

function azJson(args: string[]): JsonObject {
  const output = execFileSync("az", [...args, "--output", "json", "--only-show-errors"], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return asObject(JSON.parse(output));
}

function decodeClaims(token: string): JsonObject {
  const payload = token.split(".")[1];
  if (!payload) {
    fail("Azure CLI returned a non-JWT access token");
  }
  return asObject(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Expected a JSON object");
  }
  return value as JsonObject;
}

function objectOrEmpty(value: unknown): JsonObject {
  return value === null || value === undefined
    ? {}
    : structuredClone(asObject(value));
}

function objectArray(value: unknown): JsonObject[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail("Expected a JSON array");
  }
  return structuredClone(value.map(asObject));
}

function stringArray(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("Expected a string array");
  }
  return [...value] as string[];
}

function requiredString(object: JsonObject, property: string): string {
  const value = object[property];
  if (typeof value !== "string" || value.length === 0) {
    fail(`Missing ${property}`);
  }
  return value;
}

function spaceSeparatedValues(value: unknown): string[] {
  if (typeof value !== "string") {
    fail("Expected a space-separated string");
  }
  return value.split(/\s+/).filter(Boolean);
}

function refuseDuplicates(values: unknown[], description: string): void {
  if (values.length > 1) {
    fail(`Refusing duplicate ${description}`);
  }
}

function refuseDuplicateStrings(
  values: string[],
  expected: string,
  description: string,
): void {
  if (values.filter((value) => value === expected).length > 1) {
    fail(`Refusing duplicate ${description}`);
  }
}

function refuseIdCollision(
  values: JsonObject[],
  id: string,
  expectedValue: string,
  description: string,
): void {
  if (values.some((value) => value.id === id && value.value !== expectedValue)) {
    fail(`Refusing ${description} immutable-ID collision`);
  }
}

function fail(message: string): never {
  throw new Error(message);
}
