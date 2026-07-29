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
  MSAL_BROWSER_CONFIGURATION,
  mapAccountIdentity,
  normalizeAccessTokenError,
  normalizeAuthenticationError,
  type MsalClient,
} from "./msal-authentication";
import { API_ACCESS_SCOPES } from "../api/config";

describe("MSAL authentication adapter", () => {
  it("keeps the operator token cache in memory only", () => {
    expect(MSAL_BROWSER_CONFIGURATION.cache).toEqual({
      cacheLocation: "memoryStorage",
    });
    expect(JSON.stringify(MSAL_BROWSER_CONFIGURATION.cache)).not.toContain(
      "localStorage",
    );
    expect(JSON.stringify(MSAL_BROWSER_CONFIGURATION.cache)).not.toContain(
      "sessionStorage",
    );
  });

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

  it("deduplicates concurrent acquisition for the exact account and scopes", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    const deferred = createDeferred<AuthenticationResult>();
    client.acquireTokenSilent.mockReturnValue(deferred.promise);
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    const first = authentication.acquireAccessToken(API_ACCESS_SCOPES);
    const second = authentication.acquireAccessToken(API_ACCESS_SCOPES);
    expect(client.acquireTokenSilent).toHaveBeenCalledOnce();

    deferred.resolve({ accessToken: "shared-access-token" } as AuthenticationResult);
    await expect(Promise.all([first, second])).resolves.toEqual([
      "shared-access-token",
      "shared-access-token",
    ]);
    expect(client.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("bounds a concurrent request with a different scope", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    const deferred = createDeferred<AuthenticationResult>();
    client.acquireTokenSilent.mockReturnValue(deferred.promise);
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    const first = authentication.acquireAccessToken(API_ACCESS_SCOPES);
    await expect(
      authentication.acquireAccessToken(["api://fixture/other"]),
    ).rejects.toEqual(
      new AccessTokenError("Another API access request is already in progress."),
    );
    deferred.resolve({ accessToken: "shared-access-token" } as AuthenticationResult);
    await expect(first).resolves.toBe("shared-access-token");
    expect(client.acquireTokenSilent).toHaveBeenCalledOnce();
  });

  it("clears the session before logout and refuses a stale token completion", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    const deferred = createDeferred<AuthenticationResult>();
    client.acquireTokenSilent.mockReturnValue(deferred.promise);
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    const pending = authentication.acquireAccessToken(API_ACCESS_SCOPES);
    await authentication.signOut();
    expect(client.setActiveAccount).toHaveBeenLastCalledWith(null);
    expect(client.logoutRedirect).toHaveBeenCalledWith({
      account,
      postLogoutRedirectUri: "http://localhost:3000/",
    });
    await expect(
      authentication.acquireAccessToken(API_ACCESS_SCOPES),
    ).rejects.toEqual(new AccessTokenError("Sign in before checking API access."));

    deferred.resolve({ accessToken: "stale-access-token" } as AuthenticationResult);
    await expect(pending).rejects.toEqual(
      new AccessTokenError("The operator session changed."),
    );
  });

  it("does not open interactive fallback for a session invalidated by logout", async () => {
    const account = fixtureAccount();
    const client = fakeClient(account);
    const deferred = createDeferred<AuthenticationResult>();
    client.acquireTokenSilent.mockReturnValue(deferred.promise);
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();

    const pending = authentication.acquireAccessToken(API_ACCESS_SCOPES);
    await authentication.signOut();
    deferred.reject(
      new InteractionRequiredAuthError(
        "interaction_required",
        "stale-correlation-id",
      ),
    );

    await expect(pending).rejects.toEqual(
      new AccessTokenError("The operator session changed."),
    );
    expect(client.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("invalidates an old account acquisition when a redirect selects a new user", async () => {
    const firstAccount = fixtureAccount();
    const secondAccount = {
      ...fixtureAccount(),
      homeAccountId: "second-home-id",
      localAccountId: "second-object-id",
      username: "second@example.com",
    };
    const client = fakeClient(firstAccount);
    const deferred = createDeferred<AuthenticationResult>();
    client.acquireTokenSilent.mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce({
        accessToken: "second-access-token",
      } as AuthenticationResult);
    const authentication = new MsalAuthentication(client);
    await authentication.initialize();
    const first = authentication.acquireAccessToken(API_ACCESS_SCOPES);

    client.handleRedirectPromise.mockResolvedValueOnce({
      account: secondAccount,
    } as AuthenticationResult);
    await expect(authentication.initialize()).resolves.toMatchObject({
      kind: "signed-in",
      account: { accountId: "second-object-id" },
      source: "redirect",
    });
    deferred.resolve({ accessToken: "first-access-token" } as AuthenticationResult);
    await expect(first).rejects.toEqual(
      new AccessTokenError("The operator session changed."),
    );
    await expect(
      authentication.acquireAccessToken(API_ACCESS_SCOPES),
    ).resolves.toBe("second-access-token");
  });

  it("starts a reloaded adapter signed out when no account is cached", async () => {
    const client = fakeClient(null);
    await expect(new MsalAuthentication(client).initialize()).resolves.toEqual({
      kind: "signed-out",
    });
    expect(client.setActiveAccount).toHaveBeenCalledWith(null);
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
    handleRedirectPromise:
      vi.fn<MsalClient["handleRedirectPromise"]>(async () => null),
    getActiveAccount: vi.fn(() => null),
    getAllAccounts: vi.fn(() => (account ? [account] : [])),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn(async () => undefined),
    logoutRedirect: vi.fn(async () => undefined),
    acquireTokenSilent: vi.fn(),
    acquireTokenPopup: vi.fn(),
  } satisfies MsalClient;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
