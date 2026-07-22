import { describe, expect, it } from "vitest";
import { type AccountInfo } from "@azure/msal-browser";
import {
  AuthenticationCancelledError,
  AuthenticationError,
} from "./authentication";
import {
  mapAccountIdentity,
  normalizeAuthenticationError,
} from "./msal-authentication";

describe("MSAL authentication adapter", () => {
  it("maps only understandable identity fields for the UI", () => {
    const account = {
      localAccountId: "operator-object-id",
      name: "Operator Name",
      username: "operator@example.com",
      tenantId: "operator-tenant-id",
    } as AccountInfo;

    expect(mapAccountIdentity(account)).toEqual({
      accountId: "operator-object-id",
      name: "Operator Name",
      username: "operator@example.com",
      tenantId: "operator-tenant-id",
    });
  });

  it("normalizes cancellation without exposing the provider error", () => {
    const error = normalizeAuthenticationError({
      errorCode: "access_denied",
      errorMessage: "provider details should stay internal",
    });

    expect(error).toBeInstanceOf(AuthenticationCancelledError);
    expect(error.message).toBe("Microsoft sign-in was cancelled.");
  });

  it("normalizes unexpected errors to a safe visible message", () => {
    const error = normalizeAuthenticationError(new Error("raw provider error"));

    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toBe(
      "Microsoft sign-in could not be completed. Try again.",
    );
  });
});
