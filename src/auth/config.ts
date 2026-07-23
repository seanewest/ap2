import { AFTER_PARTY_CLIENT_ID } from "../../api/identity";

export { AFTER_PARTY_CLIENT_ID };
export const ORGANIZATIONS_AUTHORITY =
  "https://login.microsoftonline.com/organizations";
export const SIGN_IN_SCOPES = ["openid", "profile"] as const;

export function getApplicationUrl(): string {
  return resolveApplicationUrl(window.location.origin, import.meta.env.BASE_URL);
}

export function resolveApplicationUrl(origin: string, baseUrl: string): string {
  return new URL(baseUrl, origin).toString();
}
