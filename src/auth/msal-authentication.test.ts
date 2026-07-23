import { describe, expect, it, vi } from "vitest";
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-browser";
import {
  AccessTokenCancelledError,
  AccessTokenError,
  AuthenticationCancelledError,
  AuthenticationError,
} from "./authentication";
import {
  MsalAuthentication,
  mapAccountIdentity,
  normalizeAccessTokenError,
  normalizeAuthenticationError,
  type MsalClient,
} from "./msal-authentication";
import { API_ACCESS_SCOPES } from "../api/config";

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

  it("requests the exact API scope silently for the active account", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    client.acquireTokenSilent.mockResolvedValue(
      { accessToken: "sensitive-access-token" } as AuthenticationResult,
    );
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    await expect(
      authentication.acquireAccessToken(API_ACCESS_SCOPES),
    ).resolves.toBe("sensitive-access-token");
    expect(client.acquireTokenSilent).toHaveBeenCalledWith({
      account,
      scopes: [
        "api://c91c7af4-b1b8-4730-a240-4a1c6137ab15/access_as_user",
      ],
    });
    expect(client.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("uses an interactive request only when MSAL requires it", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    client.acquireTokenSilent.mockRejectedValue(
      new InteractionRequiredAuthError("interaction_required", "correlation-id"),
    );
    client.acquireTokenPopup.mockResolvedValue(
      { accessToken: "interactive-access-token" } as AuthenticationResult,
    );
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    await expect(
      authentication.acquireAccessToken(API_ACCESS_SCOPES),
    ).resolves.toBe("interactive-access-token");
    expect(client.acquireTokenPopup).toHaveBeenCalledWith({
      account,
      scopes: [...API_ACCESS_SCOPES],
    });
  });

  it("normalizes cancellation from the interactive API access request", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    client.acquireTokenSilent.mockRejectedValue(
      new InteractionRequiredAuthError("interaction_required", "correlation-id"),
    );
    client.acquireTokenPopup.mockRejectedValue({
      errorCode: "user_cancelled",
      errorMessage: "provider detail",
    });
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    await expect(
      authentication.acquireAccessToken(API_ACCESS_SCOPES),
    ).rejects.toEqual(new AccessTokenCancelledError());
  });

  it("normalizes API access cancellation and missing signed-in state", async () => {
    expect(
      normalizeAccessTokenError({
        errorCode: "user_cancelled",
        errorMessage: "provider detail",
      }),
    ).toBeInstanceOf(AccessTokenCancelledError);

    const authentication = new MsalAuthentication(fakeClient(null));
    await expect(
      authentication.acquireAccessToken(API_ACCESS_SCOPES),
    ).rejects.toEqual(new AccessTokenError("Sign in before checking API access."));
  });
});

function fixtureAccount(): AccountInfo {
  return {
    localAccountId: "operator-object-id",
    homeAccountId: "operator-home-id",
    environment: "login.microsoftonline.com",
    tenantId: "student-tenant-id",
    username: "operator@example.com",
  };
}

function fakeClient(account: AccountInfo | null) {
  return {
    initialize: vi.fn(async () => undefined),
    handleRedirectPromise: vi.fn(async () => null),
    getActiveAccount: vi.fn(() => null),
    getAllAccounts: vi.fn(() => (account ? [account] : [])),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn(async () => undefined),
    logoutRedirect: vi.fn(async () => undefined),
    acquireTokenSilent: vi.fn(),
    acquireTokenPopup: vi.fn(),
  } satisfies MsalClient;
}
