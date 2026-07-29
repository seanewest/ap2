import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAfterPartyApp } from "./app";
import {
  AccessTokenCancelledError,
  AccessTokenError,
  AuthenticationCancelledError,
  AuthenticationError,
  type AccountIdentity,
  type Authentication,
  type AuthenticationStartup,
} from "./auth/authentication";
import {
  ApiAccessError,
  BatchFeasibilityClientError,
  OneDriveInviteFailureError,
  PrivateDocumentRehearsalVerificationClientError,
  RehearsalOutputVerificationClientError,
  ScenarioEvidenceVerificationClientError,
  ScenarioPlanClientError,
  type AfterPartyApi,
  type ApiCallerIdentity,
  type CalendarMeetingResult,
  type CategoryProofResult,
  type ContactProofResult,
  type DraftProofResult,
  type HelpDeskScenarioResult,
  type InboxRuleProofResult,
  type OneDriveProofResult,
  type RecentOperationEvents,
  type RehearsalStatus,
  type SharePointFileProofResult,
  type SimulatedEmailResult,
  type TodoTaskProofResult,
} from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";
import {
  parsePrivateDocumentRehearsalVerificationRequest,
} from "./api/private-document-rehearsal-verification-contract";
import { compileScenarioExecutionPlan } from "./scenarios/scenario-plan";
import { CANONICAL_RECEIPT_FIXTURES } from "./scenarios/scenario-evidence-receipt.fixtures";
import { verifyCanonicalScenarioEvidenceReceipt } from "./scenarios/scenario-evidence-verification";
import { SCENARIO_MANIFESTS } from "./scenarios/scenarios";
import {
  canonicalAvdThreeVmRehearsalOutput,
  verifyAvdThreeVmRehearsalOutput,
} from "../scripts/verify-avd-three-vm-rehearsal-output";
import {
  verifyPrivateDocumentRehearsalOutput,
} from "../scripts/verify-private-document-rehearsal-output";

const privateDocumentRehearsalOutput =
  parsePrivateDocumentRehearsalVerificationRequest(JSON.parse(readFileSync(
    resolve("scripts/fixtures/private-document-rehearsal-output-learner.json"),
    "utf8",
  )) as unknown);
const privateDocumentRehearsalSummary =
  verifyPrivateDocumentRehearsalOutput(privateDocumentRehearsalOutput);

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
const draftStorageKey =
  "ap2.draft-proof.ap2-draft-20260725-001.student-tenant-id.student-object-id";
const todoTaskStorageKey =
  "ap2.todo-task-proof.ap2-todo-task-20260725-002.student-tenant-id.student-object-id";

class FakeAuthentication implements Authentication {
  initialize = vi.fn<() => Promise<AuthenticationStartup>>();
  signIn = vi.fn<() => Promise<void>>();
  signOut = vi.fn<() => Promise<void>>();
  acquireAccessToken =
    vi.fn<(scopes: readonly string[]) => Promise<string>>();
}

class FakeApi implements AfterPartyApi {
  checkAccess = vi.fn<(accessToken: string) => Promise<ApiCallerIdentity>>();
  compileScenarioPlan = vi.fn<AfterPartyApi["compileScenarioPlan"]>();
  verifyScenarioEvidenceReceipt =
    vi.fn<AfterPartyApi["verifyScenarioEvidenceReceipt"]>();
  verifyRehearsalOutput =
    vi.fn<AfterPartyApi["verifyRehearsalOutput"]>();
  verifyPrivateDocumentRehearsalOutput =
    vi.fn<AfterPartyApi["verifyPrivateDocumentRehearsalOutput"]>();
  verifyHelpDeskEmailRehearsalOutput =
    vi.fn<AfterPartyApi["verifyHelpDeskEmailRehearsalOutput"]>();
  calculateMultiScenarioFeasibility =
    vi.fn<AfterPartyApi["calculateMultiScenarioFeasibility"]>();
  getRecentOperationEvents =
    vi.fn<
      (
        accessToken: string,
        order?: "newest" | "oldest",
      ) => Promise<RecentOperationEvents>
    >();
  getRehearsalStatus =
    vi.fn<(accessToken: string) => Promise<RehearsalStatus>>();
  sendSimulatedEmail =
    vi.fn<(accessToken: string) => Promise<SimulatedEmailResult>>();
  sendHelpDeskScenario =
    vi.fn<(accessToken: string) => Promise<HelpDeskScenarioResult>>();
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
  createDraftProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<DraftProofResult, { state: "configured" }>>
    >();
  removeDraftProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<DraftProofResult, { state: "removed" }>>
    >();
  createTodoTaskProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<TodoTaskProofResult, { state: "configured" }>>
    >();
  removeTodoTaskProof =
    vi.fn<
      (
        accessToken: string,
      ) => Promise<Extract<TodoTaskProofResult, { state: "removed" }>>
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
    expect(root.querySelector(".avd-rehearsal-verification")).toBeNull();
    expect(root.querySelector(".batch-feasibility")).toBeNull();
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
    expect(draftCreateButton()).toBeNull();
    expect(draftRemoveButton()).toBeNull();
    expect(todoTaskCreateButton()).toBeNull();
    expect(todoTaskRemoveButton()).toBeNull();
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
    expect(root.textContent).toContain(
      "Controlled Teams missed-call observation",
    );
    expect(root.textContent).toContain("Evidence producerAP2 instructor");
    expect(root.textContent).toContain("Workload actorKobe lab user");
    expect(root.textContent).toContain(
      "LearnerLearner using Cory's lab Teams view",
    );
    expect(root.textContent).toContain(
      "Learner observesOne Missed incoming call entry",
    );
    expect(root.textContent).toContain(
      "Application reconnaissance and audit observation",
    );
    expect(root.textContent).toContain(
      "Workload actorReconnaissance workload application",
    );
    expect(root.textContent).toContain(
      "DetectorIndependent audit observer application",
    );
    expect(root.textContent).toContain(
      "Authentication — Independent audit observer application" +
        "Application Only. A separate application-only session with bounded audit-read authority",
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

  it("labels the Kobe-to-Cory help desk artifact as email-only and submits once", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("sensitive-access-token");
    api.sendHelpDeskScenario.mockResolvedValue({
      accepted: true,
      artifact: "outlook-email",
      sender: "kobe@corywest.onmicrosoft.com",
      recipient: "cory@corywest.onmicrosoft.com",
      subject: "AP2 help desk follow-up [ap2-help-desk-email-20260729-001]",
      platformClaims: ["email"],
    });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain(
      "This is not a Teams call, missed call, or voicemail.",
    );
    helpDeskScenarioButton()?.click();
    await nextTask();

    expect(api.sendHelpDeskScenario).toHaveBeenCalledOnce();
    expect(api.sendHelpDeskScenario).toHaveBeenCalledWith(
      "sensitive-access-token",
    );
    expect(root.textContent).toContain("Outlook email");
    expect(root.textContent).toContain("kobe@corywest.onmicrosoft.com");
    expect(root.textContent).toContain("cory@corywest.onmicrosoft.com");
    expect(root.textContent).toContain("Platform claimEmail only");
    expect(helpDeskScenarioButton()?.disabled).toBe(true);

    helpDeskScenarioButton()?.click();
    await nextTask();
    expect(api.sendHelpDeskScenario).toHaveBeenCalledOnce();
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
    expect(
      oneDriveRemoveButton()?.closest(".api-access")?.textContent,
    ).not.toContain("verified");
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

  it("creates and removes the fixed To Do task only through explicit clicks", async () => {
    const create = createDeferred<
      Extract<TodoTaskProofResult, { state: "configured" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createTodoTaskProof.mockReturnValue(create.promise);
    api.removeTodoTaskProof.mockResolvedValue({
      state: "removed",
      title: "AP2 harmless task [ap2-todo-task-20260725-002]",
    });
    await createAfterPartyApp(root, authentication, api).start();

    expect(root.textContent).toContain(
      "AP2 harmless task [ap2-todo-task-20260725-002]",
    );
    expect(root.textContent).toContain("never completed or shared");
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.createTodoTaskProof).not.toHaveBeenCalled();

    todoTaskCreateButton()?.click();
    await nextTask();
    expect(localStorage.getItem(todoTaskStorageKey)).toBe("uncertain");
    expect(api.createTodoTaskProof).toHaveBeenCalledOnce();
    todoTaskCreateButton()?.click();
    expect(api.createTodoTaskProof).toHaveBeenCalledOnce();

    create.resolve({
      state: "configured",
      title: "AP2 harmless task [ap2-todo-task-20260725-002]",
    });
    await nextTask();
    expect(root.textContent).toContain("To Do task rehearsal: Configured.");
    expect(todoTaskCreateButton()?.disabled).toBe(true);
    expect(todoTaskRemoveButton()?.disabled).toBe(false);

    todoTaskRemoveButton()?.click();
    await nextTask();
    expect(api.removeTodoTaskProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(todoTaskStorageKey)).toBe("removed");
    expect(root.textContent).toContain("To Do task rehearsal: Removed.");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it("creates and removes the fixed unsent draft through explicit clicks", async () => {
    const create = createDeferred<
      Extract<DraftProofResult, { state: "configured" }>
    >();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.createDraftProof.mockReturnValue(create.promise);
    api.removeDraftProof.mockResolvedValue({
      state: "removed",
      subject: "AP2 Pass 3 harmless draft — ap2-draft-20260725-001",
    });
    await createAfterPartyApp(root, authentication, api).start();

    expect(root.textContent).toContain("This operation never sends mail.");
    expect(root.textContent).toContain(
      "Harmless AP2 draft. This message must not be sent.",
    );
    expect(root.textContent).toContain("kobe@corywest.onmicrosoft.com");
    expect(root.textContent).toContain("marge.simpson@corywest.onmicrosoft.com");
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();

    draftCreateButton()?.click();
    await nextTask();
    expect(localStorage.getItem(draftStorageKey)).toBe("uncertain");
    expect(api.createDraftProof).toHaveBeenCalledOnce();
    draftCreateButton()?.click();
    expect(api.createDraftProof).toHaveBeenCalledOnce();
    create.resolve({
      state: "configured",
      subject: "AP2 Pass 3 harmless draft — ap2-draft-20260725-001",
    });
    await nextTask();
    expect(root.textContent).toContain(
      "Draft rehearsal: Configured as an unsent draft.",
    );
    expect(draftRemoveButton()?.disabled).toBe(false);

    draftRemoveButton()?.click();
    await nextTask();
    expect(api.removeDraftProof).toHaveBeenCalledOnce();
    expect(localStorage.getItem(draftStorageKey)).toBe("removed");
    expect(root.textContent).toContain("Draft rehearsal: Removed.");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it.each([
    ["uncertain", true, false],
    ["configured", true, false],
    ["removal-uncertain", true, true],
  ] as const)(
    "restores draft stage %s without an automatic call",
    async (stage, createDisabled, removeDisabled) => {
      localStorage.setItem(draftStorageKey, stage);
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      await createAfterPartyApp(root, authentication, api).start();
      expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
      expect(api.createDraftProof).not.toHaveBeenCalled();
      expect(api.removeDraftProof).not.toHaveBeenCalled();
      expect(draftCreateButton()?.disabled).toBe(createDisabled);
      expect(draftRemoveButton()?.disabled).toBe(removeDisabled);
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

  it("shows recent operations only after a signed-in operator manually refreshes", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.getRecentOperationEvents.mockResolvedValue({
      schemaVersion: 1,
      order: "newest",
      events: [{
        schemaVersion: 1,
        markerHash: "m1_0123456789abcdef01234567",
        operationKind: "calendar.create",
        phase: "execution",
        outcome: "succeeded",
        durationMs: 25,
        reason: "none",
        ambiguityState: "none",
        recoveryState: "not-needed",
        upstreamStatus: 201,
      }],
    });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain("Recent operations");
    expect(root.textContent).toContain("Select Refresh");
    expect(api.getRecentOperationEvents).not.toHaveBeenCalled();

    recentOperationsButton()?.click();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.getRecentOperationEvents).toHaveBeenCalledWith(
      "temporary-token",
      "newest",
    );
    expect(root.textContent).toContain("Calendar create");
    expect(root.textContent).toContain("Succeeded");
    expect(root.textContent).not.toContain("m1_0123456789abcdef01234567");
    expect(root.textContent).not.toContain("temporary-token");
  });

  it("does not expose the scenario catalog outside the signed-in shell", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain("You are signed out");
    expect(root.querySelector(".scenario-catalog")).toBeNull();
    expect(root.querySelector(".scenario-plan-preview")).toBeNull();
    expect(root.querySelector(".scenario-evidence-verification")).toBeNull();
  });

  it("moves a catalog scenario into bounded local preview inputs without authentication or API calls", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    await createAfterPartyApp(root, authentication, api).start();

    const manifest = SCENARIO_MANIFESTS[2];
    const action = [...root.querySelectorAll<HTMLButtonElement>(
      ".scenario-catalog-plan-link",
    )][2]!;
    action.click();

    const preview = root.querySelector<HTMLElement>(
      ".scenario-plan-preview",
    )!;
    const scenario = preview.querySelector<HTMLSelectElement>(
      "select[name='scenario']",
    )!;
    expect(scenario.value).toBe("2");
    expect(document.activeElement).toBe(scenario);
    expect(preview.textContent).toContain(
      `Selected ${manifest.title}, registry version ${manifest.schemaVersion}`,
    );
    expect(
      preview.querySelector<HTMLInputElement>(
        "input[name='maximumBudgetUsd']",
      )!.value,
    ).toBe(String(manifest.cost.laneMaximum));
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.compileScenarioPlan).not.toHaveBeenCalled();

    action.click();
    expect(scenario.value).toBe("2");
    expect(document.activeElement).toBe(scenario);
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.compileScenarioPlan).not.toHaveBeenCalled();
  });

  it("requests a scenario preview only after the signed-in operator submits it", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.compileScenarioPlan.mockImplementation(async (_token, request) =>
      compileScenarioExecutionPlan(request)
    );
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();
    const preview = root.querySelector<HTMLElement>(
      ".scenario-plan-preview",
    )!;
    expect(preview.textContent).toContain("No preview requested");
    expect(api.compileScenarioPlan).not.toHaveBeenCalled();

    preview.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.compileScenarioPlan).toHaveBeenCalledOnce();
    expect(api.compileScenarioPlan).toHaveBeenCalledWith(
      "temporary-token",
      expect.objectContaining({
        scenarioId: "teams-missed-call-observation",
      }),
    );
    expect(preview.textContent).toContain("Deterministic preview");
    expect(preview.textContent).not.toContain("temporary-token");
  });

  it("evaluates one locally validated batch only after explicit signed submission", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.calculateMultiScenarioFeasibility.mockResolvedValue({
      schemaVersion: 1,
      label: "FEASIBILITY_ONLY",
      status: "feasible",
      planCount: 1,
      maximumConcurrency: 1,
      conservativeAggregateUsdCeiling: "0.00",
      requestedSessionDurationMinutes: 10,
      earliestExpiryMarginMinutes: 5,
      humanGateCount: 0,
      blockers: [],
    });
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(".batch-feasibility")!;

    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.calculateMultiScenarioFeasibility).not.toHaveBeenCalled();
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.calculateMultiScenarioFeasibility).toHaveBeenCalledOnce();
    const [token, request] =
      api.calculateMultiScenarioFeasibility.mock.calls[0]!;
    expect(token).toBe("temporary-token");
    expect(request.label).toBe("SCENARIO_FEASIBILITY_COMPILE_REQUEST");
    expect(request.plans).toHaveLength(1);
    expect(panel.textContent).toContain("arithmetically feasible");
    expect(panel.textContent).not.toContain("temporary-token");
    expect(panel.textContent).not.toContain(
      request.plans[0]!.instanceAlias,
    );
  });

  it("refuses duplicate batch aliases before acquiring operator authorization", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(".batch-feasibility")!;
    panel.querySelector<HTMLButtonElement>("[data-action='add-scenario']")!
      .click();
    const aliases = panel.querySelectorAll<HTMLInputElement>(
      "input[name='batchAlias']",
    );
    aliases[1]!.value = aliases[0]!.value;
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();

    expect(panel.textContent).toContain("distinct local alias");
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.calculateMultiScenarioFeasibility).not.toHaveBeenCalled();
  });

  it.each([
    [
      new AccessTokenError("raw expired session detail"),
      "operator session expired",
      false,
    ],
    [
      new BatchFeasibilityClientError("forbidden"),
      "not authorized",
      true,
    ],
    [
      new BatchFeasibilityClientError(
        "validation-refused",
        "BUDGET_EXCEEDED",
      ),
      "planner refused",
      true,
    ],
    [
      new BatchFeasibilityClientError("response-too-large"),
      "response-size limit",
      true,
    ],
    [
      new BatchFeasibilityClientError("safe-failure"),
      "evaluation is unavailable",
      true,
    ],
  ] as const)(
    "maps typed batch feasibility failure without rendering detail",
    async (failure, message, reachesApi) => {
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      authentication.acquireAccessToken.mockImplementation(async () => {
        if (!reachesApi) throw failure;
        return "temporary-token";
      });
      if (reachesApi) {
        api.calculateMultiScenarioFeasibility.mockRejectedValue(failure);
      }
      await createAfterPartyApp(root, authentication, api).start();
      const panel = root.querySelector<HTMLElement>(".batch-feasibility")!;
      panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await nextTask();

      expect(panel.textContent).toContain(message);
      expect(panel.textContent).not.toContain(failure.message);
      expect(api.calculateMultiScenarioFeasibility).toHaveBeenCalledTimes(
        reachesApi ? 1 : 0,
      );
    },
  );

  it("verifies private-document output only after explicit signed submission", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.verifyPrivateDocumentRehearsalOutput.mockResolvedValue(
      privateDocumentRehearsalSummary,
    );
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(
      ".private-document-rehearsal-verification",
    )!;
    const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = JSON.stringify(privateDocumentRehearsalOutput);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.verifyPrivateDocumentRehearsalOutput).not.toHaveBeenCalled();
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.verifyPrivateDocumentRehearsalOutput).toHaveBeenCalledWith(
      "temporary-token",
      privateDocumentRehearsalOutput,
    );
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).not.toContain("temporary-token");
    expect(panel.textContent).not.toContain(
      privateDocumentRehearsalSummary.planDigestSha256,
    );
  });

  it("refuses unsafe private-document output before acquiring authorization", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(
      ".private-document-rehearsal-verification",
    )!;
    const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = JSON.stringify({
      ...privateDocumentRehearsalOutput,
      unsafe: ["operator", "example.invalid"].join("@"),
    });
    input.dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();

    expect(panel.textContent).toContain("Local validation failed");
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.verifyPrivateDocumentRehearsalOutput).not.toHaveBeenCalled();
  });

  it.each([
    [
      new AccessTokenError("raw expired session detail"),
      "operator session expired",
      false,
    ],
    [
      new PrivateDocumentRehearsalVerificationClientError("forbidden"),
      "not authorized",
      true,
    ],
    [
      new PrivateDocumentRehearsalVerificationClientError(
        "validation-refused",
        "FAKE_CONTRACT_BINDING",
      ),
      "inconsistent or tampered",
      true,
    ],
    [
      new PrivateDocumentRehearsalVerificationClientError(
        "response-too-large",
      ),
      "response-size limit",
      true,
    ],
    [
      new PrivateDocumentRehearsalVerificationClientError("safe-failure"),
      "verification is unavailable",
      true,
    ],
  ] as const)(
    "maps typed private-document failure without rendering detail",
    async (failure, message, reachesApi) => {
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      authentication.acquireAccessToken.mockImplementation(async () => {
        if (!reachesApi) throw failure;
        return "temporary-token";
      });
      if (reachesApi) {
        api.verifyPrivateDocumentRehearsalOutput.mockRejectedValue(failure);
      }
      await createAfterPartyApp(root, authentication, api).start();
      const panel = root.querySelector<HTMLElement>(
        ".private-document-rehearsal-verification",
      )!;
      const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
      input.value = JSON.stringify(privateDocumentRehearsalOutput);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await nextTask();

      expect(panel.textContent).toContain(message);
      expect(panel.textContent).not.toContain(failure.message);
      expect(api.verifyPrivateDocumentRehearsalOutput).toHaveBeenCalledTimes(
        reachesApi ? 1 : 0,
      );
    },
  );

  it("verifies a locally validated receipt only after explicit signed submission", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    const receipt = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;
    api.verifyScenarioEvidenceReceipt.mockResolvedValue(
      verifyCanonicalScenarioEvidenceReceipt(receipt),
    );
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(
      ".scenario-evidence-verification",
    )!;
    const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = JSON.stringify(receipt);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.verifyScenarioEvidenceReceipt).not.toHaveBeenCalled();
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.verifyScenarioEvidenceReceipt).toHaveBeenCalledOnce();
    expect(api.verifyScenarioEvidenceReceipt).toHaveBeenCalledWith(
      "temporary-token",
      receipt,
    );
    expect(panel.textContent).toContain("Normalized verification result");
    expect(panel.textContent).not.toContain("temporary-token");
    expect(panel.textContent).not.toContain(receipt.claims[0]!.id);
  });

  it("refuses unsafe receipt text before acquiring operator authorization", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(
      ".scenario-evidence-verification",
    )!;
    const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = JSON.stringify({
      ...CANONICAL_RECEIPT_FIXTURES[0]!.receipt,
      rawSession: "access-token",
    });
    input.dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();

    expect(panel.textContent).toContain("Receipt validation failed");
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.verifyScenarioEvidenceReceipt).not.toHaveBeenCalled();
  });

  it("verifies one canonical rehearsal output only after explicit signed submission", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    const output = canonicalAvdThreeVmRehearsalOutput();
    api.verifyRehearsalOutput.mockResolvedValue(
      verifyAvdThreeVmRehearsalOutput(output),
    );
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(
      ".avd-rehearsal-verification",
    )!;
    const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = JSON.stringify(output);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.verifyRehearsalOutput).not.toHaveBeenCalled();
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(api.verifyRehearsalOutput).toHaveBeenCalledOnce();
    expect(api.verifyRehearsalOutput).toHaveBeenCalledWith(
      "temporary-token",
      output,
    );
    expect(panel.textContent).toContain("Network-free contract verified");
    expect(panel.textContent).toContain("All Uninspected");
    expect(panel.textContent).not.toContain(output.planDigestSha256);
    expect(panel.textContent).not.toContain("runnerJournal");
    expect(panel.textContent).not.toContain("temporary-token");
  });

  it("refuses unsafe rehearsal fields before acquiring operator authorization", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    await createAfterPartyApp(root, authentication, api).start();
    const panel = root.querySelector<HTMLElement>(
      ".avd-rehearsal-verification",
    )!;
    const output = canonicalAvdThreeVmRehearsalOutput();
    const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = JSON.stringify({
      ...output,
      observations: {
        ...output.observations,
        unexpectedField: ["operator", "example.invalid"].join("@"),
      },
    });
    input.dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector<HTMLFormElement>("form")!.requestSubmit();

    expect(panel.textContent).toContain("Local validation failed");
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(api.verifyRehearsalOutput).not.toHaveBeenCalled();
  });

  it.each([
    [
      new AccessTokenError("raw expired session detail"),
      "operator session expired",
      false,
    ],
    [
      new RehearsalOutputVerificationClientError("forbidden"),
      "not authorized",
      true,
    ],
    [
      new RehearsalOutputVerificationClientError(
        "validation-refused",
        "CLEANUP_GAP",
      ),
      "inconsistent or tampered",
      true,
    ],
    [
      new RehearsalOutputVerificationClientError("response-too-large"),
      "response-size limit",
      true,
    ],
    [
      new RehearsalOutputVerificationClientError("safe-failure"),
      "verification is unavailable",
      true,
    ],
  ] as const)(
    "maps typed rehearsal verification failure without rendering detail",
    async (failure, message, reachesApi) => {
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      authentication.acquireAccessToken.mockImplementation(async () => {
        if (!reachesApi) {
          throw failure;
        }
        return "temporary-token";
      });
      if (reachesApi) {
        api.verifyRehearsalOutput.mockRejectedValue(failure);
      }
      await createAfterPartyApp(root, authentication, api).start();
      const panel = root.querySelector<HTMLElement>(
        ".avd-rehearsal-verification",
      )!;
      const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
      input.value = JSON.stringify(canonicalAvdThreeVmRehearsalOutput());
      input.dispatchEvent(new Event("input", { bubbles: true }));
      panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await nextTask();

      expect(panel.textContent).toContain(message);
      expect(panel.textContent).not.toContain(failure.message);
      expect(api.verifyRehearsalOutput).toHaveBeenCalledTimes(
        reachesApi ? 1 : 0,
      );
    },
  );

  it.each([
    [
      new AccessTokenError("raw expired session detail"),
      "operator session expired",
      false,
    ],
    [
      new ScenarioEvidenceVerificationClientError("forbidden"),
      "not authorized",
      true,
    ],
    [
      new ScenarioEvidenceVerificationClientError(
        "validation-refused",
        "state-promotion",
      ),
      "claims do not satisfy",
      true,
    ],
    [
      new ScenarioEvidenceVerificationClientError("response-too-large"),
      "response-size limit",
      true,
    ],
    [
      new ScenarioEvidenceVerificationClientError("safe-failure"),
      "verification is unavailable",
      true,
    ],
  ] as const)(
    "maps typed receipt verification failure without rendering detail",
    async (failure, message, reachesApi) => {
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      authentication.acquireAccessToken.mockImplementation(async () => {
        if (!reachesApi) {
          throw failure;
        }
        return "temporary-token";
      });
      if (reachesApi) {
        api.verifyScenarioEvidenceReceipt.mockRejectedValue(failure);
      }
      await createAfterPartyApp(root, authentication, api).start();
      const panel = root.querySelector<HTMLElement>(
        ".scenario-evidence-verification",
      )!;
      const input = panel.querySelector<HTMLTextAreaElement>("textarea")!;
      input.value = JSON.stringify(CANONICAL_RECEIPT_FIXTURES[0]!.receipt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      panel.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await nextTask();

      expect(panel.textContent).toContain(message);
      expect(panel.textContent).not.toContain(failure.message);
      expect(api.verifyScenarioEvidenceReceipt).toHaveBeenCalledTimes(
        reachesApi ? 1 : 0,
      );
    },
  );

  it.each([
    [
      new AccessTokenError("raw expired session detail"),
      "session expired",
      false,
    ],
    [
      new ScenarioPlanClientError("forbidden"),
      "not authorized",
      true,
    ],
    [
      new ScenarioPlanClientError("validation-refused", "EXPIRY_INVALID"),
      "planner refused",
      true,
    ],
    [
      new ScenarioPlanClientError("safe-failure"),
      "preview is unavailable",
      true,
    ],
  ] as const)(
    "maps typed preview failure without rendering its detail",
    async (failure, message, reachesApi) => {
      authentication.initialize.mockResolvedValue({
        kind: "signed-in",
        account,
        source: "cache",
      });
      authentication.acquireAccessToken.mockImplementation(async () => {
        if (!reachesApi) {
          throw failure;
        }
        return "temporary-token";
      });
      if (reachesApi) {
        api.compileScenarioPlan.mockRejectedValue(failure);
      }
      const app = createAfterPartyApp(root, authentication, api);
      await app.start();

      root.querySelector<HTMLFormElement>(
        ".scenario-plan-preview form",
      )!.requestSubmit();
      await nextTask();

      const preview = root.querySelector(".scenario-plan-preview")!;
      expect(preview.textContent).toContain(message);
      expect(preview.textContent).not.toContain(failure.message);
      expect(api.compileScenarioPlan).toHaveBeenCalledTimes(
        reachesApi ? 1 : 0,
      );
    },
  );

  it("disables refresh and other API actions while loading", async () => {
    const deferred = createDeferred<RecentOperationEvents>();
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.getRecentOperationEvents.mockReturnValue(deferred.promise);
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    recentOperationsButton()?.click();
    await nextTask();

    expect(root.textContent).toContain("Loading recent operations");
    expect(recentOperationsButton()?.disabled).toBe(true);
    expect(apiButton()?.disabled).toBe(true);
    recentOperationsButton()?.click();
    expect(api.getRecentOperationEvents).toHaveBeenCalledOnce();

    deferred.resolve({ schemaVersion: 1, order: "newest", events: [] });
    await nextTask();
    expect(root.textContent).toContain("No recent operations");
    expect(recentOperationsButton()?.disabled).toBe(false);
  });

  it("allows one later manual refresh without automatic polling", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.getRecentOperationEvents.mockResolvedValue({
      schemaVersion: 1,
      order: "newest",
      events: [],
    });
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();
    await nextTask();
    expect(api.getRecentOperationEvents).not.toHaveBeenCalled();

    recentOperationsButton()?.click();
    await nextTask();
    expect(api.getRecentOperationEvents).toHaveBeenCalledTimes(1);

    recentOperationsButton()?.click();
    await nextTask();
    expect(api.getRecentOperationEvents).toHaveBeenCalledTimes(2);
  });

  it("shows a session-expired state without exposing authorization details", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockRejectedValue(
      new AccessTokenError("raw identity and tenant detail"),
    );
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    recentOperationsButton()?.click();
    await nextTask();

    expect(root.textContent).toContain(
      "session expired or this account is not authorized",
    );
    expect(root.textContent).not.toContain("raw identity and tenant detail");
    expect(api.getRecentOperationEvents).not.toHaveBeenCalled();
  });

  it("shows a fixed general failure without rendering an error body", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    api.getRecentOperationEvents.mockRejectedValue(
      new Error("raw upstream response body and secret"),
    );
    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    recentOperationsButton()?.click();
    await nextTask();

    const panel = root.querySelector(".recent-operations")!;
    expect(panel.textContent).toContain(
      "Recent operations could not be loaded. No event details were returned.",
    );
    expect(panel.textContent).not.toContain(
      "raw upstream response body and secret",
    );
  });

  function recentOperationsButton(): HTMLButtonElement | null {
    return root.querySelector(
      "[data-action='refresh-recent-operations']",
    );
  }

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

  function helpDeskScenarioButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>(
      "[data-action='send-help-desk-scenario']",
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

  function draftCreateButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='create-draft-proof']");
  }

  function draftRemoveButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='remove-draft-proof']");
  }

  function todoTaskCreateButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='create-todo-task-proof']");
  }

  function todoTaskRemoveButton(): HTMLButtonElement | null {
    return root.querySelector("[data-action='remove-todo-task-proof']");
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
