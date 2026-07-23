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
  OneDriveInviteFailureError,
  type AfterPartyApi,
  type ApiCallerIdentity,
  type OneDriveProofResult,
  type RehearsalStatus,
  type SimulatedEmailResult,
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
  getRehearsalStatus =
    vi.fn<(accessToken: string) => Promise<RehearsalStatus>>();
  sendSimulatedEmail =
    vi.fn<(accessToken: string) => Promise<SimulatedEmailResult>>();
  shareOneDriveProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<OneDriveProofResult, { state: "shared" }>>
    >();
  verifyOneDriveProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<OneDriveProofResult, { state: "verified" }>>
    >();
  removeOneDriveProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<OneDriveProofResult, { state: "removed" }>>
    >();
}

describe("After Party authentication UI", () => {
  let root: HTMLElement;
  let authentication: FakeAuthentication;
  let api: FakeApi;

  beforeEach(() => {
    localStorage.clear();
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
    expect(rehearsalButton()).toBeNull();
    expect(simulatedEmailButton()).toBeNull();
    expect(oneDriveShareButton()).toBeNull();
    expect(oneDriveVerifyButton()).toBeNull();
    expect(oneDriveRemoveButton()).toBeNull();
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
    expect(simulatedEmailButton()?.textContent).toBe(
      "Send one internal email: Homer → Marge",
    );
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
    expect(rehearsalButton()).toBeNull();
    expect(simulatedEmailButton()).toBeNull();
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

  it("runs only one API operation at a time", async () => {
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

    expect(apiButton()?.disabled).toBe(true);
    expect(rehearsalButton()?.disabled).toBe(true);
    expect(simulatedEmailButton()?.disabled).toBe(true);
    rehearsalButton()?.click();
    simulatedEmailButton()?.click();
    await nextTask();
    expect(authentication.acquireAccessToken).toHaveBeenCalledTimes(1);
    expect(api.getRehearsalStatus).not.toHaveBeenCalled();
    expect(api.sendSimulatedEmail).not.toHaveBeenCalled();

    deferred.resolve({ callerType: "delegated", tenantId: "student-tenant" });
    await nextTask();
    expect(apiButton()?.disabled).toBe(false);
    expect(rehearsalButton()?.disabled).toBe(false);
    expect(simulatedEmailButton()?.disabled).toBe(false);
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

  it("requests the exact scope and renders only safe rehearsal status", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("sensitive-access-token");
    api.getRehearsalStatus.mockResolvedValue({
      appName: "ca-ap2-api",
      region: "East US",
      runningStatus: "Running",
      latestReadyRevision: "ca-ap2-api--revision",
      secret: "must-not-render",
    } as RehearsalStatus);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    rehearsalButton()?.click();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.getRehearsalStatus).toHaveBeenCalledWith(
      "sensitive-access-token",
    );
    expect(root.textContent).toContain("Rehearsal status received");
    expect(root.textContent).toContain("ca-ap2-api");
    expect(root.textContent).toContain("East US");
    expect(root.textContent).toContain("Running");
    expect(root.textContent).toContain("ca-ap2-api--revision");
    expect(root.textContent).not.toContain("sensitive-access-token");
    expect(root.textContent).not.toContain("must-not-render");
  });

  it("shows rehearsal loading without exposing the token", async () => {
    const deferred = createDeferred<RehearsalStatus>();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.getRehearsalStatus.mockReturnValue(deferred.promise);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    rehearsalButton()?.click();
    await nextTask();

    expect(root.textContent).toContain("Checking rehearsal status");
    expect(rehearsalButton()?.disabled).toBe(true);
    expect(root.textContent).not.toContain("temporary-token");

    deferred.resolve({
      appName: "ca-ap2-api",
      region: "East US",
      runningStatus: "Running",
      latestReadyRevision: "ca-ap2-api--revision",
    });
    await nextTask();
    expect(root.textContent).toContain("Rehearsal status received");
    expect(rehearsalButton()?.disabled).toBe(false);
  });

  it("shows a safe rehearsal failure and allows retry", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.getRehearsalStatus
      .mockRejectedValueOnce(
        new ApiAccessError("Rehearsal status is unavailable. Try again."),
      )
      .mockResolvedValueOnce({
        appName: "ca-ap2-api",
        region: "East US",
        runningStatus: "Running",
        latestReadyRevision: "ca-ap2-api--revision",
      });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    rehearsalButton()?.click();
    await nextTask();
    expect(root.textContent).toContain(
      "Rehearsal status is unavailable. Try again.",
    );

    rehearsalButton()?.click();
    await nextTask();
    expect(api.getRehearsalStatus).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain("Rehearsal status received");
  });

  it("submits one fixed internal email and disables it after Microsoft accepts it", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("sensitive-access-token");
    api.sendSimulatedEmail.mockResolvedValue({
      accepted: true,
      sender: "homer.simpson@corywest.onmicrosoft.com",
      recipient: "marge.simpson@corywest.onmicrosoft.com",
      subject: "Dinner tonight",
      secret: "must-not-render",
    } as SimulatedEmailResult);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain(
      "one internal email from Homer Simpson to Marge Simpson",
    );
    simulatedEmailButton()?.click();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.sendSimulatedEmail).toHaveBeenCalledWith(
      "sensitive-access-token",
    );
    expect(root.textContent).toContain(
      "Microsoft accepted the email request (202). Delivery is not confirmed.",
    );
    expect(root.textContent).toContain(
      "homer.simpson@corywest.onmicrosoft.com",
    );
    expect(root.textContent).toContain(
      "marge.simpson@corywest.onmicrosoft.com",
    );
    expect(root.textContent).toContain("Dinner tonight");
    expect(root.textContent).not.toContain("sensitive-access-token");
    expect(root.textContent).not.toContain("must-not-render");
    expect(simulatedEmailButton()?.disabled).toBe(true);
    expect(
      simulatedEmailButton()?.closest('[aria-busy="true"]'),
    ).toBeNull();

    simulatedEmailButton()?.click();
    await nextTask();
    expect(api.sendSimulatedEmail).toHaveBeenCalledTimes(1);
  });

  it("serializes the internal email with the other API operations", async () => {
    const deferred = createDeferred<SimulatedEmailResult>();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.sendSimulatedEmail.mockReturnValue(deferred.promise);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    simulatedEmailButton()?.click();
    await nextTask();

    expect(root.textContent).toContain("Submitting the internal email");
    expect(apiButton()?.disabled).toBe(true);
    expect(rehearsalButton()?.disabled).toBe(true);
    expect(simulatedEmailButton()?.disabled).toBe(true);
    expect(
      simulatedEmailButton()?.closest('[aria-busy="true"]'),
    ).not.toBeNull();
    apiButton()?.click();
    rehearsalButton()?.click();
    await nextTask();
    expect(authentication.acquireAccessToken).toHaveBeenCalledTimes(1);
    expect(api.checkAccess).not.toHaveBeenCalled();
    expect(api.getRehearsalStatus).not.toHaveBeenCalled();

    deferred.resolve({
      accepted: true,
      sender: "homer.simpson@corywest.onmicrosoft.com",
      recipient: "marge.simpson@corywest.onmicrosoft.com",
      subject: "Dinner tonight",
    });
    await nextTask();
    expect(apiButton()?.disabled).toBe(false);
    expect(rehearsalButton()?.disabled).toBe(false);
    expect(simulatedEmailButton()?.disabled).toBe(true);
  });

  it("runs share, Marge verification, and cleanup only on separate clicks", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.shareOneDriveProof.mockResolvedValue({
      state: "shared",
      path: "/AP2-OneDrive-share-proof.txt",
      owner: "homer.simpson@corywest.onmicrosoft.com",
      recipient: "marge.simpson@corywest.onmicrosoft.com",
      access: "read",
    });
    api.verifyOneDriveProof.mockResolvedValue({
      state: "verified",
      path: "/AP2-OneDrive-share-proof.txt",
      verifiedAs: "marge.simpson@corywest.onmicrosoft.com",
      contentMatches: true,
    });
    api.removeOneDriveProof.mockResolvedValue({
      state: "removed",
      path: "/AP2-OneDrive-share-proof.txt",
    });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain("not started in this browser");
    expect(root.textContent).toContain("Real tenant activity");
    oneDriveShareButton()?.click();
    await nextTask();
    expect(api.shareOneDriveProof).toHaveBeenCalledWith("temporary-token");
    expect(api.verifyOneDriveProof).not.toHaveBeenCalled();
    expect(api.removeOneDriveProof).not.toHaveBeenCalled();
    expect(root.textContent).toContain("shared read-only with Marge");

    oneDriveVerifyButton()?.click();
    await nextTask();
    expect(api.verifyOneDriveProof).toHaveBeenCalledWith("temporary-token");
    expect(api.removeOneDriveProof).not.toHaveBeenCalled();
    expect(root.textContent).toContain("exact file bytes verified");

    oneDriveRemoveButton()?.click();
    await nextTask();
    expect(api.removeOneDriveProof).toHaveBeenCalledWith("temporary-token");
    expect(root.textContent).toContain("removed to Homer's recycle bin");
    expect(oneDriveShareButton()?.disabled).toBe(true);
    expect(oneDriveVerifyButton()?.disabled).toBe(true);
    expect(oneDriveRemoveButton()?.disabled).toBe(true);
    expect(root.textContent).not.toContain("temporary-token");
  });

  it("records an uncertain mutation before the request and restores it after reload", async () => {
    const deferred = createDeferred<
      Extract<OneDriveProofResult, { state: "shared" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.shareOneDriveProof.mockReturnValue(deferred.promise);
    let app = createAfterPartyApp(root, authentication, api);
    await app.start();

    oneDriveShareButton()?.click();
    await nextTask();
    expect(localStorage.getItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
    )).toBe("uncertain");
    expect(oneDriveShareButton()?.disabled).toBe(true);
    expect(simulatedEmailButton()?.disabled).toBe(true);

    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    app = createAfterPartyApp(root, authentication, api);
    await app.start();
    expect(root.textContent).toContain("last change outcome is uncertain");
    expect(oneDriveShareButton()?.disabled).toBe(true);
    expect(oneDriveVerifyButton()?.disabled).toBe(false);
    expect(oneDriveRemoveButton()?.disabled).toBe(false);
  });

  it("plainly reports file-created invite failure and directs cleanup", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.shareOneDriveProof.mockRejectedValue(
      new OneDriveInviteFailureError({
        state: "file-created-sharing-failed",
        stage: "invite",
        upstreamStatus: 400,
        graphErrorCode: "invalidRequest",
        requestId: "11111111-1111-4111-8111-111111111111",
        clientRequestId: "22222222-2222-4222-8222-222222222222",
        responseDate: "Thu, 23 Jul 2026 23:00:00 GMT",
        retryAfter: "30",
        responseShape: "graph-error",
      }),
    );
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    oneDriveShareButton()?.click();
    await nextTask();

    expect(root.textContent).toContain(
      "Homer's file was created, but sharing it with Marge failed.",
    );
    expect(root.textContent).toContain(
      "Clean up the OneDrive proof before trying again.",
    );
    expect(root.textContent).toContain("Invite Marge with read access");
    expect(root.textContent).toContain("Microsoft Graph status400");
    expect(root.textContent).toContain("Microsoft Graph error codeinvalidRequest");
    expect(root.textContent).toContain(
      "Microsoft Graph request ID11111111-1111-4111-8111-111111111111",
    );
    expect(root.textContent).toContain(
      "Client request ID22222222-2222-4222-8222-222222222222",
    );
    expect(root.textContent).toContain(
      "Microsoft Graph response dateThu, 23 Jul 2026 23:00:00 GMT",
    );
    expect(root.textContent).toContain("Microsoft Graph retry after30");
    expect(root.textContent).toContain("Response shapeMicrosoft Graph error");
    expect(oneDriveShareButton()?.disabled).toBe(true);
    expect(oneDriveRemoveButton()?.disabled).toBe(false);
    expect(localStorage.getItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
    )).toBe("uncertain");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it("preserves the prior stage when read-only verification fails", async () => {
    localStorage.setItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
      "shared",
    );
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.verifyOneDriveProof.mockRejectedValue(
      new ApiAccessError("Marge access could not be verified."),
    );
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    oneDriveVerifyButton()?.click();
    await nextTask();
    expect(root.textContent).toContain("Marge access could not be verified.");
    expect(oneDriveVerifyButton()?.disabled).toBe(false);
    expect(oneDriveRemoveButton()?.disabled).toBe(false);
    expect(localStorage.getItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
    )).toBe("shared");
  });

  function signInButton(): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>("[data-action='sign-in']")!;
  }

  function apiButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>("[data-action='check-api']");
  }

  function rehearsalButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='check-rehearsal']",
    );
  }

  function simulatedEmailButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='send-simulated-email']",
    );
  }

  function oneDriveShareButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='share-onedrive-proof']",
    );
  }

  function oneDriveVerifyButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='verify-onedrive-proof']",
    );
  }

  function oneDriveRemoveButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='remove-onedrive-proof']",
    );
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
