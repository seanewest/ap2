import { AFTER_PARTY_CLIENT_ID } from "../auth/config";

export const API_ACCESS_SCOPE =
  `api://${AFTER_PARTY_CLIENT_ID}/access_as_user` as const;
export const API_ACCESS_SCOPES = [API_ACCESS_SCOPE] as const;
export const DEFAULT_API_BASE_URL = "http://localhost:3000";

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
}

export function resolveApiBaseUrl(configuredUrl: string | undefined): string {
  const url = new URL(configuredUrl?.trim() || DEFAULT_API_BASE_URL);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "VITE_API_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.",
    );
  }
  return url.toString().replace(/\/$/, "");
}
