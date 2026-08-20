import { AP2_INSTALLATION_EXTENSION_NAME } from "../product-identity";
import type { AccountIdentity } from "./auth/authentication";
import { installation } from "./installation";

export const INSTALLATION_DISCOVERY_SCOPES = [
  "https://graph.microsoft.com/User.Read",
] as const;

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

export interface DiscoveredInstallation {
  schemaVersion: 1;
  installationId: string;
  apiBaseUrl: string;
}

export class InstallationDiscoveryError extends Error {
  constructor() {
    super("This tenant does not have a usable AP2 API connection.");
    this.name = "InstallationDiscoveryError";
  }
}

export async function discoverTenantInstallation(
  account: AccountIdentity,
  graphAccessToken: string,
  request: typeof fetch = fetch,
): Promise<DiscoveredInstallation> {
  if (
    account.tenantId !== installation.student.tenantId ||
    !graphAccessToken
  ) {
    throw new InstallationDiscoveryError();
  }

  const url =
    `${GRAPH_ROOT}/organization/${encodeURIComponent(account.tenantId)}` +
    `/extensions/${encodeURIComponent(AP2_INSTALLATION_EXTENSION_NAME)}`;
  let response: Response;
  try {
    response = await request(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${graphAccessToken}` },
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new InstallationDiscoveryError();
  }
  if (response.status !== 200) {
    throw new InstallationDiscoveryError();
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new InstallationDiscoveryError();
  }
  if (!isRecord(value)) {
    throw new InstallationDiscoveryError();
  }

  const apiBaseUrl = discoveredApiBaseUrl(value.apiBaseUrl);
  if (
    value.extensionName !== AP2_INSTALLATION_EXTENSION_NAME ||
    value.schemaVersion !== 1 ||
    value.installationId !== installation.installationId ||
    apiBaseUrl === undefined
  ) {
    throw new InstallationDiscoveryError();
  }

  return {
    schemaVersion: 1,
    installationId: value.installationId,
    apiBaseUrl,
  };
}

function discoveredApiBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  return url.toString().replace(/\/$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
