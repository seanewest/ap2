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
  type CalendarMeetingResult,
  type CategoryProofResult,
  type ContactProofResult,
  type InboxRuleProofResult,
  type OneDriveProofResult,
  type RehearsalStatus,
  type SharePointFileProofResult,
  type SimulatedEmailResult,
} from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";

const account: AccountIdentity = {
  accountId: "student-object-id",
  name: "Test Student",
  username: "student@example.com",
  tenantId: "student-tenant-id",
};
const calendarStorageKey =
  "ap2.calendar-meeting.ap2-calendar-20260724-002.student-tenant-id.student-object-id";
const contactStorageKey =
  "ap2.contact-proof.ap2-contact-20260724-001.student-tenant-id.student-object-id";
const inboxRuleStorageKey =
  "ap2.inbox-rule-proof.ap2-rule-20260725-001.student-tenant-id.student-object-id";
const categoryStorageKey =
  "ap2.category-proof.ap2-category-20260725-001.student-tenant-id.student-object-id";
const sharePointFileStorageKey =
  "ap2.sharepoint-file-proof.ap2-sharepoint-file-20260725-001.student-tenant-id.student-object-id";

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
      ) => Promise<Extract<OneDriveProofResult, { state: "configured" }>>
    >();
  removeOneDriveProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<OneDriveProofResult, { state: "removed" }>>
    >();
  createCalendarMeeting =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<CalendarMeetingResult, { state: "configured" }>>
    >();
  cancelCalendarMeeting =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<
        Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
      >
    >();
  createContactProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<ContactProofResult, { state: "configured" }>>
    >();
  removeContactProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<ContactProofResult, { state: "removed" }>>
    >();
  createInboxRuleProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<InboxRuleProofResult, { state: "configured" }>>
    >();
  removeInboxRuleProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<InboxRuleProofResult, { state: "removed" }>>
    >();
  createCategoryProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<CategoryProofResult, { state: "configured" }>>
    >();
  removeCategoryProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<CategoryProofResult, { state: "removed" }>>
    >();
  createSharePointFileProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<
        Extract<SharePointFileProofResult, { state: "configured" }>
      >
    >();
  removeSharePointFileProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<SharePointFileProofResult, { state: "removed" }>>
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
    expect(calendarCreateButton()).toBeNull();
    expect(calendarCancelButton()).toBeNull();
    expect(contactCreateButton()).toBeNull();
    expect(contactRemoveButton()).toBeNull();
    expect(inboxRuleCreateButton()).toBeNull();
    expect(inboxRuleRemoveButton()).toBeNull();
    expect(categoryCreateButton()).toBeNull();
    expect(categoryRemoveButton()).toBeNull();
    expect(sharePointFileCreateButton()).toBeNull();
    expect(sharePointFileRemoveButton()).toBeNull();
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

  it("configures access and cleans up only on separate clicks", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.shareOneDriveProof.mockResolvedValue({
      state: "configured",
      path: "/AP2-OneDrive-share-proof.txt",
      owner: "homer.simpson@corywest.onmicrosoft.com",
      recipient: "marge.simpson@corywest.onmicrosoft.com",
      access: "read",
    });
    api.removeOneDriveProof.mockResolvedValue({
      state: "removed",
      path: "/AP2-OneDrive-share-proof.txt",
    });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain("not started in this browser");
    expect(root.textContent).toContain(
      "Real tenant activity: Cory creates one fixed harmless 15-minute meeting inviting only Kobe and Marge, then explicitly cancels it.",
    );
    oneDriveShareButton()?.click();
    await nextTask();
    expect(api.shareOneDriveProof).toHaveBeenCalledWith("temporary-token");
    expect(api.removeOneDriveProof).not.toHaveBeenCalled();
    expect(root.textContent).toContain(
      "read-only access is configured for Marge",
    );
    expect(root.textContent).toContain(
      "sign in to OneDrive as marge.simpson@corywest.onmicrosoft.com",
    );
    expect(root.textContent).toContain("Open Shared, then Shared with you");
    expect(root.textContent).toContain("AP2-OneDrive-share-proof.txt");
    expect(root.textContent).toContain(
      "Return here and click Clean up OneDrive proof when finished",
    );
    expect(oneDriveVerifyButton()).toBeNull();
    expect(oneDriveShareButton()?.disabled).toBe(true);
    oneDriveShareButton()?.click();
    expect(api.shareOneDriveProof).toHaveBeenCalledTimes(1);

    oneDriveRemoveButton()?.click();
    await nextTask();
    expect(api.removeOneDriveProof).toHaveBeenCalledWith("temporary-token");
    expect(root.textContent).toContain("removed to Homer's recycle bin");
    expect(oneDriveShareButton()?.disabled).toBe(false);
    expect(oneDriveRemoveButton()?.disabled).toBe(true);

    const rerun = createDeferred<
      Extract<OneDriveProofResult, { state: "configured" }>
    >();
    api.shareOneDriveProof.mockReturnValueOnce(rerun.promise);
    oneDriveShareButton()?.click();
    await nextTask();
    expect(api.shareOneDriveProof).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
    )).toBe("uncertain");
    expect(oneDriveShareButton()?.disabled).toBe(true);
    oneDriveShareButton()?.click();
    expect(api.shareOneDriveProof).toHaveBeenCalledTimes(2);

    rerun.resolve({
      state: "configured",
      path: "/AP2-OneDrive-share-proof.txt",
      owner: "homer.simpson@corywest.onmicrosoft.com",
      recipient: "marge.simpson@corywest.onmicrosoft.com",
      access: "read",
    });
    await nextTask();
    expect(oneDriveShareButton()?.disabled).toBe(true);
    oneDriveShareButton()?.click();
    expect(api.shareOneDriveProof).toHaveBeenCalledTimes(2);
    expect(root.textContent).not.toContain("temporary-token");
  });

  it("records an uncertain mutation before the request and restores it after reload", async () => {
    const deferred = createDeferred<
      Extract<OneDriveProofResult, { state: "configured" }>
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
    oneDriveShareButton()?.click();
    expect(api.shareOneDriveProof).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    app = createAfterPartyApp(root, authentication, api);
    await app.start();
    expect(root.textContent).toContain("last change outcome is uncertain");
    expect(oneDriveShareButton()?.disabled).toBe(true);
    expect(oneDriveVerifyButton()).toBeNull();
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

  it("interprets the old shared stage as configured without claiming verification", async () => {
    localStorage.setItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
      "shared",
    );
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain(
      "read-only access is configured for Marge",
    );
    expect(root.textContent).not.toContain("verified");
    expect(oneDriveVerifyButton()).toBeNull();
    expect(oneDriveRemoveButton()?.disabled).toBe(false);
    expect(localStorage.getItem(
      "ap2.onedrive-share-proof.student-tenant-id.student-object-id",
    )).toBe("shared");
  });

  it("creates and cancels the fixed meeting only through separate explicit clicks", async () => {
    const create = createDeferred<
      Extract<CalendarMeetingResult, { state: "configured" }>
    >();
    const cancel = createDeferred<
      Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createCalendarMeeting.mockReturnValue(create.promise);
    api.cancelCalendarMeeting.mockReturnValue(cancel.promise);
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(api.createCalendarMeeting).not.toHaveBeenCalled();
    expect(api.cancelCalendarMeeting).not.toHaveBeenCalled();
    expect(calendarCreateButton()?.disabled).toBe(false);
    expect(calendarCancelButton()?.disabled).toBe(true);
    expect(root.textContent).toContain("not started in this browser");
    expect(root.textContent).toContain("cory@corywest.onmicrosoft.com");
    expect(root.textContent).toContain("kobe@corywest.onmicrosoft.com");
    expect(root.textContent).toContain(
      "marge.simpson@corywest.onmicrosoft.com",
    );
    expect(root.textContent).toContain(
      "AP2 Pass 3 calendar rehearsal — no action required",
    );
    expect(root.textContent).toContain(
      "Harmless AP2 calendar rehearsal. No action or response is required. The organizer will cancel it after observation.",
    );
    expect(root.textContent).toContain("Real tenant activity");
    expect(root.textContent).toContain("15 minutes");
    expect(root.textContent).toContain("Show asFree");
    expect(root.textContent).toContain("ReminderOff");
    expect(root.textContent).toContain("Teams / online meetingOff");
    expect(root.textContent).toContain("ResponsesNot requested");
    expect(root.textContent).toContain("2026-07-24T19:00:00Z");
    expect(root.textContent).toContain("2026-07-24T19:15:00Z");
    expect(root.textContent).toContain("3:00–3:15 PM EDT");

    calendarCreateButton()?.click();
    await nextTask();
    expect(api.createCalendarMeeting).toHaveBeenCalledOnce();
    expect(api.createCalendarMeeting).toHaveBeenCalledWith("temporary-token");
    expect(localStorage.getItem(
      calendarStorageKey,
    )).toBe("uncertain");
    expect(calendarCreateButton()?.disabled).toBe(true);
    expect(calendarCancelButton()?.disabled).toBe(true);
    calendarCreateButton()?.click();
    expect(api.createCalendarMeeting).toHaveBeenCalledOnce();

    create.resolve({
      state: "configured",
      organizer: "cory@corywest.onmicrosoft.com",
      attendees: [
        "kobe@corywest.onmicrosoft.com",
        "marge.simpson@corywest.onmicrosoft.com",
      ],
      subject: "AP2 Pass 3 calendar rehearsal — no action required",
      start: "2026-07-24T19:00:00Z",
      end: "2026-07-24T19:15:00Z",
    });
    await nextTask();
    expect(root.textContent).toContain("Calendar rehearsal: Configured");
    expect(root.textContent).toContain(
      "attendee receipt or response is not confirmed",
    );
    expect(calendarCreateButton()?.disabled).toBe(true);
    expect(calendarCancelButton()?.disabled).toBe(false);
    calendarCreateButton()?.click();
    expect(api.createCalendarMeeting).toHaveBeenCalledOnce();

    calendarCancelButton()?.click();
    await nextTask();
    expect(api.cancelCalendarMeeting).toHaveBeenCalledOnce();
    expect(api.cancelCalendarMeeting).toHaveBeenCalledWith("temporary-token");
    expect(localStorage.getItem(
      calendarStorageKey,
    )).toBe("cancellation-uncertain");
    expect(calendarCreateButton()?.disabled).toBe(true);
    expect(calendarCancelButton()?.disabled).toBe(true);
    calendarCancelButton()?.click();
    expect(api.cancelCalendarMeeting).toHaveBeenCalledOnce();

    cancel.resolve({
      state: "cancellation-accepted",
      organizer: "cory@corywest.onmicrosoft.com",
      subject: "AP2 Pass 3 calendar rehearsal — no action required",
    });
    await nextTask();
    expect(root.textContent).toContain(
      "Calendar rehearsal: Cancellation accepted",
    );
    expect(root.textContent).toContain("Attendee receipt is not confirmed");
    expect(calendarCreateButton()?.disabled).toBe(true);
    expect(calendarCancelButton()?.disabled).toBe(true);
    expect(root.textContent).not.toContain("temporary-token");
  });

  it("offers explicit cancellation recovery from an uncertain calendar state", async () => {
    localStorage.setItem(
      calendarStorageKey,
      "uncertain",
    );
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.cancelCalendarMeeting.mockResolvedValue({
      state: "cancellation-accepted",
      organizer: "cory@corywest.onmicrosoft.com",
      subject: "AP2 Pass 3 calendar rehearsal — no action required",
    });
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(api.cancelCalendarMeeting).not.toHaveBeenCalled();
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(root.textContent).toContain(
      "Do not create again; Cancel can explicitly find and cancel one exact matching meeting.",
    );
    expect(calendarCreateButton()?.disabled).toBe(true);
    expect(calendarCancelButton()?.disabled).toBe(false);

    calendarCancelButton()?.click();
    await nextTask();

    expect(api.createCalendarMeeting).not.toHaveBeenCalled();
    expect(api.cancelCalendarMeeting).toHaveBeenCalledOnce();
    expect(api.cancelCalendarMeeting).toHaveBeenCalledWith("temporary-token");
    expect(localStorage.getItem(
      calendarStorageKey,
    )).toBe("cancellation-accepted");
    expect(root.textContent).toContain(
      "Calendar rehearsal: Cancellation accepted",
    );
    expect(calendarCancelButton()?.disabled).toBe(true);
  });

  it("does not offer a second cancellation after an uncertain response", async () => {
    localStorage.setItem(
      calendarStorageKey,
      "uncertain",
    );
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.cancelCalendarMeeting.mockRejectedValue(
      new ApiAccessError("Cancellation was not confirmed."),
    );
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();
    calendarCancelButton()?.click();
    await nextTask();

    expect(api.cancelCalendarMeeting).toHaveBeenCalledOnce();
    expect(localStorage.getItem(
      calendarStorageKey,
    )).toBe("cancellation-uncertain");
    expect(root.textContent).toContain(
      "Calendar rehearsal: cancellation is uncertain. Do not repeat it.",
    );
    expect(calendarCancelButton()?.disabled).toBe(true);

    calendarCancelButton()?.click();
    expect(api.cancelCalendarMeeting).toHaveBeenCalledOnce();
  });

  it("starts the new run fresh when only the prior run cache exists", async () => {
    localStorage.setItem(
      "ap2.calendar-meeting.student-tenant-id.student-object-id",
      "cancellation-accepted",
    );
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();

    expect(root.textContent).toContain(
      "Calendar rehearsal: not started in this browser.",
    );
    expect(calendarCreateButton()?.disabled).toBe(false);
    expect(calendarCancelButton()?.disabled).toBe(true);
    expect(localStorage.getItem(calendarStorageKey)).toBeNull();
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.createCalendarMeeting).not.toHaveBeenCalled();
    expect(api.cancelCalendarMeeting).not.toHaveBeenCalled();
  });

  it.each([
    ["uncertain", true, false],
    ["configured", true, false],
    ["cancellation-uncertain", true, true],
    ["cancellation-accepted", true, true],
  ] as const)(
    "restores calendar stage %s without an automatic call",
    async (stage, createDisabled, cancelDisabled) => {
      localStorage.setItem(
        calendarStorageKey,
        stage,
      );
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      const app = createAfterPartyApp(root, authentication, api);

      await app.start();

      expect(api.createCalendarMeeting).not.toHaveBeenCalled();
      expect(api.cancelCalendarMeeting).not.toHaveBeenCalled();
      expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
      expect(calendarCreateButton()?.disabled).toBe(createDisabled);
      expect(calendarCancelButton()?.disabled).toBe(cancelDisabled);
    },
  );

  it("creates and removes the fixed SharePoint file through explicit clicks", async () => {
    const create = createDeferred<
      Extract<SharePointFileProofResult, { state: "configured" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createSharePointFileProof.mockReturnValue(create.promise);
    api.removeSharePointFileProof.mockResolvedValue({
      state: "removed",
      name: "AP2 SharePoint File Proof [ap2-sharepoint-file-20260725-001].txt",
    });
    await createAfterPartyApp(root, authentication, api).start();

    expect(root.textContent).toContain("API system managed identity");
    expect(root.textContent).toContain("78 ASCII bytes");
    expect(api.createSharePointFileProof).not.toHaveBeenCalled();
    sharePointFileCreateButton()?.click();
    await nextTask();
    expect(api.createSharePointFileProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(sharePointFileStorageKey)).toBe("uncertain");
    sharePointFileCreateButton()?.click();
    expect(api.createSharePointFileProof).toHaveBeenCalledOnce();
    create.resolve({
      state: "configured",
      name: "AP2 SharePoint File Proof [ap2-sharepoint-file-20260725-001].txt",
    });
    await nextTask();
    expect(localStorage.getItem(sharePointFileStorageKey)).toBe("configured");
    expect(root.textContent).toContain("SharePoint file rehearsal: Configured.");

    sharePointFileRemoveButton()?.click();
    await nextTask();
    expect(api.removeSharePointFileProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(sharePointFileStorageKey)).toBe("removed");
    expect(root.textContent).toContain("Removed to SharePoint recycle bin");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it.each([
    ["uncertain", true, false],
    ["configured", true, false],
    ["removal-uncertain", true, true],
  ] as const)(
    "restores SharePoint file stage %s without an automatic call",
    async (stage, createDisabled, removeDisabled) => {
      localStorage.setItem(sharePointFileStorageKey, stage);
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      await createAfterPartyApp(root, authentication, api).start();
      expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
      expect(api.createSharePointFileProof).not.toHaveBeenCalled();
      expect(api.removeSharePointFileProof).not.toHaveBeenCalled();
      expect(sharePointFileCreateButton()?.disabled).toBe(createDisabled);
      expect(sharePointFileRemoveButton()?.disabled).toBe(removeDisabled);
    },
  );

  it("creates and removes the fixed category through explicit clicks", async () => {
    const create = createDeferred<
      Extract<CategoryProofResult, { state: "configured" }>
    >();
    const remove = createDeferred<
      Extract<CategoryProofResult, { state: "removed" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createCategoryProof.mockReturnValue(create.promise);
    api.removeCategoryProof.mockReturnValue(remove.promise);
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();
    expect(api.createCategoryProof).not.toHaveBeenCalled();
    expect(root.textContent).toContain(
      "AP2 Category Proof [ap2-category-20260725-001]",
    );
    expect(root.textContent).toContain("preset7");
    expect(categoryCreateButton()?.disabled).toBe(false);
    expect(categoryRemoveButton()?.disabled).toBe(true);

    categoryCreateButton()?.click();
    await nextTask();
    expect(localStorage.getItem(categoryStorageKey)).toBe("uncertain");
    expect(api.createCategoryProof).toHaveBeenCalledOnce();
    categoryCreateButton()?.click();
    expect(api.createCategoryProof).toHaveBeenCalledOnce();

    create.resolve({
      state: "configured",
      displayName: "AP2 Category Proof [ap2-category-20260725-001]",
    });
    await nextTask();
    expect(root.textContent).toContain("Category rehearsal: Configured.");
    expect(categoryRemoveButton()?.disabled).toBe(false);

    categoryRemoveButton()?.click();
    await nextTask();
    expect(api.removeCategoryProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(categoryStorageKey)).toBe(
      "removal-uncertain",
    );
    categoryRemoveButton()?.click();
    expect(api.removeCategoryProof).toHaveBeenCalledOnce();
    remove.resolve({
      state: "removed",
      displayName: "AP2 Category Proof [ap2-category-20260725-001]",
    });
    await nextTask();
    expect(localStorage.getItem(categoryStorageKey)).toBe("removed");
    expect(root.textContent).toContain("Category rehearsal: Removed.");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it.each([
    ["uncertain", true, false],
    ["configured", true, false],
    ["removal-uncertain", true, true],
    ["removed", true, true],
  ] as const)(
    "restores category stage %s without an automatic call",
    async (stage, createDisabled, removeDisabled) => {
      localStorage.setItem(categoryStorageKey, stage);
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      const app = createAfterPartyApp(root, authentication, api);

      await app.start();
      expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
      expect(api.createCategoryProof).not.toHaveBeenCalled();
      expect(api.removeCategoryProof).not.toHaveBeenCalled();
      expect(categoryCreateButton()?.disabled).toBe(createDisabled);
      expect(categoryRemoveButton()?.disabled).toBe(removeDisabled);
    },
  );

  it("creates and removes the fixed disabled Inbox rule through explicit clicks", async () => {
    const create = createDeferred<
      Extract<InboxRuleProofResult, { state: "configured" }>
    >();
    const remove = createDeferred<
      Extract<InboxRuleProofResult, { state: "removed" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createInboxRuleProof.mockReturnValue(create.promise);
    api.removeInboxRuleProof.mockReturnValue(remove.promise);
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();
    expect(api.createInboxRuleProof).not.toHaveBeenCalled();
    expect(root.textContent).toContain("AP2-NEVER-MATCH-ap2-rule-20260725-001");
    expect(inboxRuleCreateButton()?.disabled).toBe(false);
    expect(inboxRuleRemoveButton()?.disabled).toBe(true);

    inboxRuleCreateButton()?.click();
    await nextTask();
    expect(localStorage.getItem(inboxRuleStorageKey)).toBe("uncertain");
    expect(api.createInboxRuleProof).toHaveBeenCalledOnce();
    inboxRuleCreateButton()?.click();
    expect(api.createInboxRuleProof).toHaveBeenCalledOnce();

    create.resolve({
      state: "configured",
      displayName: "AP2 harmless disabled rule — ap2-rule-20260725-001",
    });
    await nextTask();
    expect(root.textContent).toContain("Configured and disabled");
    expect(inboxRuleRemoveButton()?.disabled).toBe(false);

    inboxRuleRemoveButton()?.click();
    await nextTask();
    expect(api.removeInboxRuleProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(inboxRuleStorageKey)).toBe(
      "removal-uncertain",
    );
    inboxRuleRemoveButton()?.click();
    expect(api.removeInboxRuleProof).toHaveBeenCalledOnce();
    remove.resolve({
      state: "removed",
      displayName: "AP2 harmless disabled rule — ap2-rule-20260725-001",
    });
    await nextTask();
    expect(localStorage.getItem(inboxRuleStorageKey)).toBe("removed");
    expect(root.textContent).toContain("Inbox-rule rehearsal: Removed");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it.each([
    ["uncertain", true, false],
    ["configured", true, false],
    ["removal-uncertain", true, true],
    ["removed", true, true],
  ] as const)(
    "restores Inbox-rule stage %s without an automatic call",
    async (stage, createDisabled, removeDisabled) => {
      localStorage.setItem(inboxRuleStorageKey, stage);
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      const app = createAfterPartyApp(root, authentication, api);

      await app.start();
      expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
      expect(api.createInboxRuleProof).not.toHaveBeenCalled();
      expect(api.removeInboxRuleProof).not.toHaveBeenCalled();
      expect(inboxRuleCreateButton()?.disabled).toBe(createDisabled);
      expect(inboxRuleRemoveButton()?.disabled).toBe(removeDisabled);
    },
  );

  it("creates and removes the fixed contact through separate explicit clicks", async () => {
    const create = createDeferred<
      Extract<ContactProofResult, { state: "configured" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createContactProof.mockReturnValue(create.promise);
    api.removeContactProof.mockResolvedValue({
      state: "removed",
      displayName: "AP2 Kobe Contact Proof",
    });
    const app = createAfterPartyApp(root, authentication, api);

    await app.start();
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.createContactProof).not.toHaveBeenCalled();
    expect(api.removeContactProof).not.toHaveBeenCalled();
    expect(root.textContent).toContain("AP2 Kobe Contact Proof");
    expect(root.textContent).toContain("kobe@corywest.onmicrosoft.com");
    expect(contactCreateButton()?.disabled).toBe(false);
    expect(contactRemoveButton()?.disabled).toBe(true);

    contactCreateButton()?.click();
    await nextTask();
    expect(localStorage.getItem(contactStorageKey)).toBe("uncertain");
    expect(api.createContactProof).toHaveBeenCalledOnce();
    expect(api.createContactProof).toHaveBeenCalledWith("temporary-token");
    contactCreateButton()?.click();
    expect(api.createContactProof).toHaveBeenCalledOnce();

    create.resolve({
      state: "configured",
      displayName: "AP2 Kobe Contact Proof",
      email: "kobe@corywest.onmicrosoft.com",
    });
    await nextTask();
    expect(localStorage.getItem(contactStorageKey)).toBe("configured");
    expect(root.textContent).toContain("Contact rehearsal: Configured");
    expect(contactCreateButton()?.disabled).toBe(true);
    expect(contactRemoveButton()?.disabled).toBe(false);

    contactRemoveButton()?.click();
    await nextTask();
    expect(api.removeContactProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(contactStorageKey)).toBe("removed");
    expect(root.textContent).toContain("Contact rehearsal: Removed");
    expect(contactCreateButton()?.disabled).toBe(true);
    expect(contactRemoveButton()?.disabled).toBe(true);
    expect(root.textContent).not.toContain("temporary-token");
  });

  it.each([
    ["uncertain", true, false],
    ["configured", true, false],
    ["removed", true, true],
  ] as const)(
    "restores contact stage %s without an automatic call",
    async (stage, createDisabled, removeDisabled) => {
      localStorage.setItem(contactStorageKey, stage);
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      const app = createAfterPartyApp(root, authentication, api);

      await app.start();
      expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
      expect(api.createContactProof).not.toHaveBeenCalled();
      expect(api.removeContactProof).not.toHaveBeenCalled();
      expect(contactCreateButton()?.disabled).toBe(createDisabled);
      expect(contactRemoveButton()?.disabled).toBe(removeDisabled);
    },
  );

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

  function calendarCreateButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='create-calendar-meeting']",
    );
  }

  function calendarCancelButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='cancel-calendar-meeting']",
    );
  }

  function contactCreateButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='create-contact-proof']");
  }

  function contactRemoveButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='remove-contact-proof']");
  }

  function inboxRuleCreateButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='create-inbox-rule']");
  }

  function inboxRuleRemoveButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='remove-inbox-rule']");
  }

  function categoryCreateButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='create-category-proof']");
  }

  function categoryRemoveButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='remove-category-proof']");
  }

  function sharePointFileCreateButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='create-sharepoint-file-proof']");
  }

  function sharePointFileRemoveButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='remove-sharepoint-file-proof']");
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
