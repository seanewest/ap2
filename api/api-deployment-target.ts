export const API_DEPLOYMENT_SUBSCRIPTION_ID =
  "6d8ebd0e-017f-401e-950d-e5a35de93dc6";
export const API_DEPLOYMENT_RESOURCE_GROUP = "rg-ap2-rehearsal";

export function apiContainerAppResourceId(target: string): string {
  return (
    `/subscriptions/${API_DEPLOYMENT_SUBSCRIPTION_ID}` +
    `/resourceGroups/${API_DEPLOYMENT_RESOURCE_GROUP}` +
    `/providers/Microsoft.App/containerApps/${target}`
  );
}
