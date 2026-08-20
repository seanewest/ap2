export interface InstallationConfig {
  schemaVersion: 1;
  installationId: string;
  student: {
    tenantId: string;
    initialDomain: string;
    delegatedOperatorObjectIds: readonly string[];
    automationClientId: string;
  };
  actors: {
    cory: InstallationActor;
    homer: InstallationActor;
    kobe: InstallationActor;
    marge: InstallationActor;
  };
  azure: {
    subscriptionId: string;
    apiResourceGroup: string;
    apiContainerApp: string;
  };
  spa: {
    apiBaseUrl: string;
    allowedOrigin: string;
  };
}

export interface InstallationActor {
  objectId: string;
  displayName: string;
  userPrincipalName: string;
}

export function parseInstallationConfig(value: unknown): InstallationConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("AP2 installation configuration must use schemaVersion 1");
  }
  const installationId = nonEmpty(value.installationId, "installationId");
  const student = record(value.student, "student");
  const tenantId = uuid(student.tenantId, "student.tenantId");
  const initialDomain = domain(student.initialDomain, "student.initialDomain");
  const delegatedOperatorObjectIds = uuidList(
    student.delegatedOperatorObjectIds,
    "student.delegatedOperatorObjectIds",
  );
  const actors = record(value.actors, "actors");
  const parsedActors = {
    cory: actor(actors.cory, "actors.cory", initialDomain),
    homer: actor(actors.homer, "actors.homer", initialDomain),
    kobe: actor(actors.kobe, "actors.kobe", initialDomain),
    marge: actor(actors.marge, "actors.marge", initialDomain),
  };
  const azure = record(value.azure, "azure");
  const spa = record(value.spa, "spa");

  return Object.freeze({
    schemaVersion: 1,
    installationId,
    student: Object.freeze({
      tenantId,
      initialDomain,
      delegatedOperatorObjectIds: Object.freeze(delegatedOperatorObjectIds),
      automationClientId: uuid(
        student.automationClientId,
        "student.automationClientId",
      ),
    }),
    actors: Object.freeze(parsedActors),
    azure: Object.freeze({
      subscriptionId: uuid(azure.subscriptionId, "azure.subscriptionId"),
      apiResourceGroup: nonEmpty(
        azure.apiResourceGroup,
        "azure.apiResourceGroup",
      ),
      apiContainerApp: nonEmpty(
        azure.apiContainerApp,
        "azure.apiContainerApp",
      ),
    }),
    spa: Object.freeze({
      apiBaseUrl: httpUrl(spa.apiBaseUrl, "spa.apiBaseUrl", true),
      allowedOrigin: httpUrl(spa.allowedOrigin, "spa.allowedOrigin", false),
    }),
  });
}

function actor(
  value: unknown,
  name: string,
  initialDomain: string,
): InstallationActor {
  const input = record(value, name);
  const userPrincipalName = nonEmpty(
    input.userPrincipalName,
    `${name}.userPrincipalName`,
  ).toLowerCase();
  if (!userPrincipalName.endsWith(`@${initialDomain.toLowerCase()}`)) {
    throw new Error(`${name}.userPrincipalName must belong to the Student domain`);
  }
  return Object.freeze({
    objectId: uuid(input.objectId, `${name}.objectId`),
    displayName: nonEmpty(input.displayName, `${name}.displayName`),
    userPrincipalName,
  });
}

function httpUrl(value: unknown, name: string, allowPath: boolean): string {
  const url = new URL(nonEmpty(value, name));
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || url.search || url.hash ||
    (!allowPath && url.pathname !== "/")
  ) {
    throw new Error(`${name} must be an absolute HTTP(S) ${allowPath ? "URL" : "origin"}`);
  }
  return allowPath ? url.toString().replace(/\/$/, "") : url.origin;
}

function domain(value: unknown, name: string): string {
  const result = nonEmpty(value, name).toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(result) || !result.includes(".")) {
    throw new Error(`${name} must be a DNS domain`);
  }
  return result;
}

function uuidList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty UUID list`);
  }
  const result = value.map((item, index) => uuid(item, `${name}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`${name} must not contain duplicates`);
  }
  return result;
}

function uuid(value: unknown, name: string): string {
  const result = nonEmpty(value, name).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) {
    throw new Error(`${name} must be a UUID`);
  }
  return result;
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
