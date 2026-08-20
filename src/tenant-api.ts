import { HttpAfterPartyApi, type AfterPartyApi } from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";
import type {
  AccountIdentity,
  Authentication,
} from "./auth/authentication";
import {
  discoverTenantInstallation,
  INSTALLATION_DISCOVERY_SCOPES,
  InstallationDiscoveryError,
} from "./installation-discovery";

export async function connectTenantApi(
  account: AccountIdentity,
  authentication: Authentication,
  request: typeof fetch = fetch,
): Promise<AfterPartyApi> {
  const graphToken = await authentication.acquireAccessToken(
    INSTALLATION_DISCOVERY_SCOPES,
  );
  const discovered = await discoverTenantInstallation(
    account,
    graphToken,
    request,
  );
  const api = new HttpAfterPartyApi(discovered.apiBaseUrl, request);
  const apiToken = await authentication.acquireAccessToken(API_ACCESS_SCOPES);
  const caller = await api.checkAccess(apiToken);
  if (caller.callerType !== "delegated" || caller.tenantId !== account.tenantId) {
    throw new InstallationDiscoveryError();
  }
  return api;
}
