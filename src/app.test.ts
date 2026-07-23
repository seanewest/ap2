import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAfterPartyApp } from "./app";
import {
  AccessTokenCancelledError,
  AuthenticationCancelledError,
  AuthenticationError,
  type AccountIdentity,
  type Authentication,
  type AuthenticationStartup,
} from "./auth/authentication";
import {
  ApiAccessError,
  type AfterPartyApi,
  type ApiCallerIdentity,
} from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";

const account: AccountIdentity = {
  accountId: "student-object-id",
  name: "Test Student",
  username: "student@example.com",
  tenantId: "student-tenant-id",
};

class FakeAuthentication implements Authentication {
  initialize = vi.fn<() => Promise<AuthenticationStartup>>();
  signIn = vi.fn<() => Promise<void>>();
  signOut = vi.fn<() => Promise<void>>();
  acquireAccessToken =
    vi.fn<(scopes: readonly string[]) => Promise<string>>();
}

class FakeApi implements AfterPartyApi {
  checkAccess = vi.fn<(accessToken: string) => Promise<ApiCallerIdentity>>();
}

describe("After Party authentication UI", () => {
  let root: HTMLElement;
  let authentication: FakeAuthentication;
  let api: FakeApi;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    authentication = new FakeAuthentication();
    api = new FakeApi();
  });

  it("shows initial and redirect-processing states before signed out", async () => {
    const deferred = createDeferred<AuthenticationStartup>();
    authentication.initialize.mockReturnValue(deferred.promise);
    const app = createAfterPartyApp(root, authentication, api);

    expect(root.textContent).toContain("Preparing sign-in");
    const started = app.start();
    expect(root.textContent).toContain("Completing Microsoft sign-in");

    deferred.resolve({ kind: "signed-out" });
    await started;
    expect(root.textContent).toContain("You are signed out");
    expect(signInButton().textContent).toBe("Sign in with Microsoft");
    expect(apiButton()).toBeNull();
  });

  it("shows identity after a successful redirect", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "redirect",
    });
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(root.textContent).toContain("Signed in as Test Student");
    expect(root.textContent).toContain("student@example.com");
    expect(root.textContent).toContain("student-tenant-id");
    expect(root.textContent).toContain("student-object-id");
    expect(root.textContent).not.toContain("token");
  });

  it("restores a signed-in account from cached state", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(root.textContent).toContain("Signed in as Test Student");
    expect(authentication.initialize).toHaveBeenCalledOnce();
  });

  it("shows cancellation and lets the user retry", async () => {
    authentication.initialize.mockRejectedValue(
      new AuthenticationCancelledError(),
    );
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(root.textContent).toContain("Microsoft sign-in was cancelled");
    expect(signInButton().textContent).toBe("Try sign-in again");
  });

  it("shows a safe visible authentication error", async () => {
    authentication.initialize.mockRejectedValue(
      new AuthenticationError("Microsoft sign-in is temporarily unavailable."),
    );
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(root.textContent).toContain(
      "Microsoft sign-in is temporarily unavailable.",
    );
    expect(signInButton()).toBeTruthy();
  });

  it("starts Microsoft sign-in from the product button", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    authentication.signIn.mockRejectedValue(new AuthenticationCancelledError());
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    signInButton().click();
    await nextTask();

    expect(authentication.signIn).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("Microsoft sign-in was cancelled");
  });

  it("signs out through the boundary and returns to signed out", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.signOut.mockResolvedValue();
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    root.querySelector<HTMLButtonElement>("[data-action='sign-out']")!.click();
    await nextTask();

    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("You are signed out");
    expect(apiButton()).toBeNull();
  });

  it("requests the exact scope and renders only safe API identity fields", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("sensitive-access-token");
    api.checkAccess.mockResolvedValue({
      callerType: "delegated",
      tenantId: "student-api-tenant",
      objectId: "must-not-render",
    } as ApiCallerIdentity);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(apiButton()?.textContent).toBe("Check API access");
    apiButton()?.click();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.checkAccess).toHaveBeenCalledWith("sensitive-access-token");
    expect(root.textContent).toContain("API access confirmed");
    expect(root.textContent).toContain("delegated");
    expect(root.textContent).toContain("student-api-tenant");
    expect(root.textContent).not.toContain("sensitive-access-token");
    expect(root.textContent).not.toContain("must-not-render");
  });

  it("shows loading while the API check is in progress", async () => {
    const deferred = createDeferred<ApiCallerIdentity>();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.checkAccess.mockReturnValue(deferred.promise);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    apiButton()?.click();
    await nextTask();

    expect(root.textContent).toContain("Checking API access");
    expect(apiButton()?.disabled).toBe(true);
    expect(root.textContent).not.toContain("temporary-token");

    deferred.resolve({ callerType: "delegated", tenantId: "student-tenant" });
    await nextTask();
    expect(root.textContent).toContain("API access confirmed");
    expect(apiButton()?.disabled).toBe(false);
  });

  it("shows a safe failure and allows retry", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.checkAccess
      .mockRejectedValueOnce(new ApiAccessError("The API is unavailable. Try again."))
      .mockResolvedValueOnce({
        callerType: "delegated",
        tenantId: "student-tenant",
      });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    apiButton()?.click();
    await nextTask();
    expect(root.textContent).toContain("The API is unavailable. Try again.");
    expect(apiButton()?.textContent).toBe("Check API access");

    apiButton()?.click();
    await nextTask();
    expect(api.checkAccess).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain("API access confirmed");
  });

  it("shows API token acquisition cancellation without calling the API", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockRejectedValue(
      new AccessTokenCancelledError(),
    );
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    apiButton()?.click();
    await nextTask();

    expect(root.textContent).toContain("API access request was cancelled");
    expect(api.checkAccess).not.toHaveBeenCalled();
    expect(apiButton()?.textContent).toBe("Check API access");
  });

  function signInButton(): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>("[data-action='sign-in']")!;
  }

  function apiButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>("[data-action='check-api']");
  }
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
