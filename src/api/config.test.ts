import { describe, expect, it } from "vitest";
import {
  API_ACCESS_SCOPE,
  API_ACCESS_SCOPES,
  DEFAULT_API_BASE_URL,
  resolveApiBaseUrl,
} from "./config";

describe("SPA API configuration", () => {
  it("uses the agreed Product application delegated scope", () => {
    expect(API_ACCESS_SCOPE).toBe(
      "api://c91c7af4-b1b8-4730-a240-4a1c6137ab15/access_as_user",
    );
    expect(API_ACCESS_SCOPES).toEqual([API_ACCESS_SCOPE]);
  });

  it("defaults to the local API and normalizes a configured base URL", () => {
    expect(resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl(" https://student-api.example/base/ ")).toBe(
      "https://student-api.example/base",
    );
  });

  it.each([
    "ftp://student-api.example",
    "https://user:password@student-api.example",
    "https://student-api.example?target=other",
    "https://student-api.example/#fragment",
  ])("rejects an unsafe API base URL: %s", (value) => {
    expect(() => resolveApiBaseUrl(value)).toThrow(
      "VITE_API_BASE_URL must be an HTTP(S) URL",
    );
  });
});
