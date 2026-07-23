export const REHEARSAL_SUBSCRIPTION_ID =
  "6d8ebd0e-017f-401e-950d-e5a35de93dc6";
export const REHEARSAL_RESOURCE_GROUP = "rg-ap2-rehearsal";
export const REHEARSAL_CONTAINER_APP = "ca-ap2-api";

const AZURE_MANAGEMENT_SCOPE = "https://management.azure.com/.default";
const CONTAINER_APP_API_VERSION = "2025-07-01";
const runningStatuses = [
  "Progressing",
  "Running",
  "Stopped",
  "Suspended",
  "Ready",
] as const;

export interface RehearsalStatus {
  appName: string;
  region: string;
  runningStatus: (typeof runningStatuses)[number];
  activeRevision: string;
}

export interface RehearsalStatusProvider {
  getStatus(): Promise<RehearsalStatus>;
}

export interface AzureTokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

export class AzureRehearsalStatusProvider
  implements RehearsalStatusProvider
{
  readonly #credential: AzureTokenCredential;
  readonly #request: typeof fetch;

  constructor(
    credential: AzureTokenCredential,
    request: typeof fetch = fetch,
  ) {
    this.#credential = credential;
    this.#request = request.bind(globalThis);
  }

  async getStatus(): Promise<RehearsalStatus> {
    const accessToken = await this.#credential.getToken(AZURE_MANAGEMENT_SCOPE);
    if (!accessToken) {
      throw new Error("Managed identity returned no Azure access token");
    }

    const response = await this.#request(containerAppUrl(), {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${accessToken.token}` },
    });
    if (!response.ok) {
      throw new Error(`Azure Container Apps returned HTTP ${response.status}`);
    }

    return parseContainerApp(await response.json());
  }
}

function containerAppUrl(): string {
  const resourcePath =
    `/subscriptions/${REHEARSAL_SUBSCRIPTION_ID}` +
    `/resourceGroups/${REHEARSAL_RESOURCE_GROUP}` +
    `/providers/Microsoft.App/containerApps/${REHEARSAL_CONTAINER_APP}`;
  const url = new URL(resourcePath, "https://management.azure.com");
  url.searchParams.set("api-version", CONTAINER_APP_API_VERSION);
  return url.toString();
}

function parseContainerApp(value: unknown): RehearsalStatus {
  if (!isRecord(value) || !isRecord(value.properties)) {
    throw new Error("Azure returned an invalid Container App");
  }

  const runningStatus = value.properties.runningStatus;
  if (
    typeof value.name !== "string" ||
    value.name !== REHEARSAL_CONTAINER_APP ||
    typeof value.location !== "string" ||
    value.location.length === 0 ||
    !isRunningStatus(runningStatus) ||
    typeof value.properties.latestReadyRevisionName !== "string" ||
    value.properties.latestReadyRevisionName.length === 0
  ) {
    throw new Error("Azure returned an invalid Container App");
  }

  return {
    appName: value.name,
    region: value.location,
    runningStatus,
    activeRevision: value.properties.latestReadyRevisionName,
  };
}

function isRunningStatus(
  value: unknown,
): value is RehearsalStatus["runningStatus"] {
  return runningStatuses.some((candidate) => candidate === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
