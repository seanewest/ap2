export const AFTER_PARTY_CLIENT_ID = "c91c7af4-b1b8-4730-a240-4a1c6137ab15";
export const ORGANIZATIONS_AUTHORITY =
  "https://login.microsoftonline.com/organizations";
export const SIGN_IN_SCOPES = ["openid", "profile"] as const;

export function getApplicationUrl(): string {
  return resolveApplicationUrl(window.location.origin, import.meta.env.BASE_URL);
}

export function resolveApplicationUrl(origin: string, baseUrl: string): string {
  return new URL(baseUrl, origin).toString();
}
