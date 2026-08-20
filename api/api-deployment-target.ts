import { installation } from "../installation/server.ts";

export const API_DEPLOYMENT_SUBSCRIPTION_ID = installation.azure.subscriptionId;
export const API_DEPLOYMENT_RESOURCE_GROUP = installation.azure.apiResourceGroup;

export function apiContainerAppResourceId(target: string): string {
  return (
    `/subscriptions/${API_DEPLOYMENT_SUBSCRIPTION_ID}` +
    `/resourceGroups/${API_DEPLOYMENT_RESOURCE_GROUP}` +
    `/providers/Microsoft.App/containerApps/${target}`
  );
}
