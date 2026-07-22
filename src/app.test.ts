import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAfterPartyApp } from "./app";
import {
  AuthenticationCancelledError,
  AuthenticationError,
  type AccountIdentity,
  type Authentication,
  type AuthenticationStartup,
} from "./auth/authentication";

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
}

describe("After Party authentication UI", () => {
  let root: HTMLElement;
  let authentication: FakeAuthentication;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    authentication = new FakeAuthentication();
  });

  it("shows initial and redirect-processing states before signed out", async () => {
    const deferred = createDeferred<AuthenticationStartup>();
    authentication.initialize.mockReturnValue(deferred.promise);
    const app = createAfterPartyApp(root, authentication);

    expect(root.textContent).toContain("Preparing sign-in");
    const started = app.start();
    expect(root.textContent).toContain("Completing Microsoft sign-in");

    deferred.resolve({ kind: "signed-out" });
    await started;
    expect(root.textContent).toContain("You are signed out");
    expect(signInButton().textContent).toBe("Sign in with Microsoft");
  });

  it("shows identity after a successful redirect", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "redirect",
    });
    const app = createAfterPartyApp(root, authentication);

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
    const app = createAfterPartyApp(root, authentication);

    await app.start();

    expect(root.textContent).toContain("Signed in as Test Student");
    expect(authentication.initialize).toHaveBeenCalledOnce();
  });

  it("shows cancellation and lets the user retry", async () => {
    authentication.initialize.mockRejectedValue(
      new AuthenticationCancelledError(),
    );
    const app = createAfterPartyApp(root, authentication);

    await app.start();

    expect(root.textContent).toContain("Microsoft sign-in was cancelled");
    expect(signInButton().textContent).toBe("Try sign-in again");
  });

  it("shows a safe visible authentication error", async () => {
    authentication.initialize.mockRejectedValue(
      new AuthenticationError("Microsoft sign-in is temporarily unavailable."),
    );
    const app = createAfterPartyApp(root, authentication);

    await app.start();

    expect(root.textContent).toContain(
      "Microsoft sign-in is temporarily unavailable.",
    );
    expect(signInButton()).toBeTruthy();
  });

  it("starts Microsoft sign-in from the product button", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    authentication.signIn.mockRejectedValue(new AuthenticationCancelledError());
    const app = createAfterPartyApp(root, authentication);
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
    const app = createAfterPartyApp(root, authentication);
    await app.start();

    root.querySelector<HTMLButtonElement>("[data-action='sign-out']")!.click();
    await nextTask();

    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("You are signed out");
  });

  function signInButton(): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>("[data-action='sign-in']")!;
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
