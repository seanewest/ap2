import {
  API_DEPLOYMENT_REPLICA_CONTRACT,
  requireSingleReplicaScale,
} from "./api-replica-contract.js";
import {
  API_DEPLOYMENT_RESOURCE_GROUP,
  API_DEPLOYMENT_SUBSCRIPTION_ID,
  apiContainerAppResourceId,
} from "./api-deployment-target.js";

export const REHEARSAL_SUBSCRIPTION_ID =
  API_DEPLOYMENT_SUBSCRIPTION_ID;
export const REHEARSAL_RESOURCE_GROUP = API_DEPLOYMENT_RESOURCE_GROUP;
export const REHEARSAL_CONTAINER_APP =
  API_DEPLOYMENT_REPLICA_CONTRACT.target;
export const REHEARSAL_CONTAINER_APP_RESOURCE_ID =
  apiContainerAppResourceId(REHEARSAL_CONTAINER_APP);

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
  latestReadyRevision: string;
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
  const url = new URL(
    REHEARSAL_CONTAINER_APP_RESOURCE_ID,
    "https://management.azure.com",
  );
  url.searchParams.set("api-version", CONTAINER_APP_API_VERSION);
  return url.toString();
}

function parseContainerApp(value: unknown): RehearsalStatus {
  if (!isRecord(value) || !isRecord(value.properties)) {
    throw new Error("Azure returned an invalid Container App");
  }

  const runningStatus = value.properties.runningStatus;
  const template = value.properties.template;
  if (
    typeof value.name !== "string" ||
    value.name !== REHEARSAL_CONTAINER_APP ||
    typeof value.location !== "string" ||
    value.location.length === 0 ||
    !isRunningStatus(runningStatus) ||
    typeof value.properties.latestReadyRevisionName !== "string" ||
    value.properties.latestReadyRevisionName.length === 0 ||
    !isRecord(template) ||
    !isRecord(template.scale)
  ) {
    throw new Error("Azure returned an invalid Container App");
  }
  try {
    requireSingleReplicaScale(template.scale);
  } catch {
    throw new Error("Azure returned an unsafe Container App replica topology");
  }

  return {
    appName: value.name,
    region: value.location,
    runningStatus,
    latestReadyRevision: value.properties.latestReadyRevisionName,
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
