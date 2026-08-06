import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAfterPartyApp } from "./app";
import type {
  AccountIdentity,
  Authentication,
  AuthenticationStartup,
} from "./auth/authentication";
import { AuthenticationCancelledError } from "./auth/authentication";
import type { AfterPartyApi } from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";

const account: AccountIdentity = {
  accountId: "student-object-id",
  name: "Test Student",
  username: "student@example.com",
  tenantId: "student-tenant-id",
};

const capabilityDescriptions = [
  "Send an email from Homer to Marge.",
  "Send a help-desk email from Kobe to Cory.",
  "Create and remove a contact in Cory's account.",
  "Create and remove a disabled Inbox rule in Cory's account.",
  "Create and remove an Outlook category in Cory's account.",
  "Create and remove an unsent draft in Cory's account.",
  "Create and cancel a meeting from Cory to Kobe and Marge.",
  "Create and remove a Microsoft To Do task in Cory's account.",
  "Create a OneDrive file as Homer, share it read-only with Marge, and remove it.",
  "Create and remove a SharePoint file.",
];

const otherProvenItems = [
  "Read directory memberships and basic mailbox, OneDrive, and SharePoint information through an application.",
  "Observe that application's Microsoft Graph sign-in through a separate audit-reading application.",
  "Read users' registered authentication methods and MFA/SSPR registration status.",
  "Check whether the simulated users hold Entra directory roles.",
  "Read basic Entra device-registration information.",
  "Create and delete an empty Azure resource group.",
  "Deploy, join, enroll, secure, use, and remove a personal Azure Virtual Desktop Windows machine.",
  "Deploy and remove a private environment containing one Windows machine and two Linux machines.",
  "Create and remove a security group and change its membership.",
  "Change and restore a user profile field.",
  "Set and remove a user's manager.",
  "Create and remove a disabled Conditional Access policy.",
  "Read Exchange configuration and message-trace information.",
  "Read Microsoft Defender Secure Score information.",
  "Create and remove a mail folder.",
  "Create and remove temporary Microsoft To Do lists and tasks.",
  "Stage a private OneDrive document for another fictional user and remove it.",
  "Produce a real Teams missed-call entry through a controlled user-to-user call.",
  "Confirm that Microsoft Graph ignored If-Match on the tested calendar-event deletion.",
  "Create an application-owned unsent draft and observe it separately.",
];

const provenScenarios = [
  "SharePoint document tampering and recovery: Create a document, change its contents, observe versions and audit evidence, restore the original, and clean it up.",
  "Inbox-rule persistence and effect: Create an enabled rule, send a matching email, and observe that the rule marked the message as read.",
  "Dormant OAuth application remediation: Create an inert application with a temporary credential, discover it through inventory, remove it, and confirm its absence.",
  "Defender email-attachment prevention: Send Microsoft's EICAR test attachment and observe Defender block and quarantine it through message trace and security evidence.",
  "Teams group-chat membership remediation: Create a group chat, add an unexpected participant, post a warning message, and have Cory remove that participant.",
];

class FakeAuthentication implements Authentication {
  initialize = vi.fn<() => Promise<AuthenticationStartup>>();
  signIn = vi.fn<() => Promise<void>>();
  signOut = vi.fn<() => Promise<void>>();
  acquireAccessToken =
    vi.fn<(scopes: readonly string[]) => Promise<string>>();
}

function fakeApi(): { api: AfterPartyApi; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const api = new Proxy({} as AfterPartyApi, {
    get(target, property) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property);
      }
      if (!methods.has(property)) {
        methods.set(property, (...args: unknown[]) => request(property, args));
      }
      return methods.get(property);
    },
  });
  return { api, request };
}

function action(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  );
}

function section(surface: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-surface='${surface}']`)!;
}

function listText(surface: string): string[] {
  return [...section(surface).querySelectorAll<HTMLLIElement>("li")].map(
    (item) => item.textContent ?? "",
  );
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("After Party primary SPA", () => {
  let root: HTMLElement;
  let authentication: FakeAuthentication;
  let api: AfterPartyApi;
  let apiRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector("#app")!;
    window.localStorage.clear();
    authentication = new FakeAuthentication();
    ({ api, request: apiRequest } = fakeApi());
  });

  it("renders the exact notebook sections and keeps actions inside Capabilities", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    await createAfterPartyApp(root, authentication, api).start();

    expect([...root.querySelectorAll(".notebook-section > h2")].map(
      (heading) => heading.textContent,
    )).toEqual([
      "Capabilities",
      "Other things AP2 has proven",
      "Proven scenarios",
    ]);
    expect([...section("capabilities").querySelectorAll(".capability-description")]
      .map((item) => item.textContent)).toEqual(capabilityDescriptions);
    expect([...section("capabilities").querySelectorAll(".capability-group > h3")]
      .map((heading) => heading.textContent)).toEqual([
        "Outlook",
        "Calendar and tasks",
        "Files",
      ]);
    expect(listText("other-proven")).toEqual(otherProvenItems);
    expect(listText("proven-scenarios")).toEqual(provenScenarios);
    expect(section("other-proven").querySelector("button")).toBeNull();
    expect(section("proven-scenarios").querySelector("button")).toBeNull();
  });

  it("shows every capability action disabled while signed out without API or token work", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    await createAfterPartyApp(root, authentication, api).start();

    const buttons = [...section("capabilities").querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons).toHaveLength(18);
    expect(buttons.every(({ disabled }) => disabled)).toBe(true);
    expect(action("Sign in with Microsoft")?.disabled).toBe(false);
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("omits static card notices while preserving status, details, and controls", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    await createAfterPartyApp(root, authentication, api).start();

    const cards = [...section("capabilities").querySelectorAll<HTMLElement>(
      ".capability-item",
    )];
    expect(cards).toHaveLength(10);
    expect(cards.every((card) => card.querySelector(".api-access > .notice") === null))
      .toBe(true);
    expect(section("capabilities").textContent).not.toMatch(
      /This creates real tenant activity|Prepared Outlook email action|Real tenant activity:/,
    );
    for (const status of [
      "Contact: not started in this browser.",
      "Inbox rule: not started in this browser.",
      "Outlook category: not started in this browser.",
      "Unsent draft: not started in this browser.",
      "Calendar meeting: not started in this browser.",
      "To Do task: not started in this browser.",
      "OneDrive file: not started in this browser.",
      "SharePoint file: not started in this browser.",
    ]) {
      expect(section("capabilities").textContent).toContain(status);
    }
    expect(section("capabilities").textContent).toContain("Required attendees");
    expect(section("capabilities").textContent).toContain("Color preset");
    expect(section("capabilities").querySelectorAll("button")).toHaveLength(18);
  });

  it("enables creation actions when signed in without API or token work during rendering", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    await createAfterPartyApp(root, authentication, api).start();

    const enabled = [...section("capabilities").querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    expect(enabled.map((button) => button.textContent)).toEqual([
      "Send one internal email: Homer → Marge",
      "Create one help desk email: Kobe → Cory",
      "Create contact",
      "Create disabled Inbox rule",
      "Create Outlook category",
      "Create unsent draft",
      "Create calendar meeting",
      "Create To Do task",
      "Create and share OneDrive file",
      "Create SharePoint file",
    ]);
    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("uses none of the disallowed product language", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    await createAfterPartyApp(root, authentication, api).start();

    expect(root.textContent).not.toMatch(
      /\b(?:lab|learner|capability building block|rehearsal|canary|workload|manifest)\b/i,
    );
  });

  it("describes the fixed meeting content without presenting altered field values", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });
    await createAfterPartyApp(root, authentication, api).start();

    const details = [...section("capabilities").querySelectorAll("dl")].find(
      (list) => list.textContent?.includes("Required attendees"),
    );
    expect(details?.textContent).toContain(
      "The fixed AP2 subject identifies a calendar test and says no action is required. The fixed harmless body says no action or response is required and says the organizer will cancel the meeting after observation.",
    );
    expect([...details!.querySelectorAll("dt")].map((item) => item.textContent))
      .not.toEqual(expect.arrayContaining(["Subject", "Body"]));
  });

  it("runs a plainly labeled real action only after its button is selected", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.acquireAccessToken.mockResolvedValue("temporary-token");
    const send = vi.fn().mockResolvedValue({
      accepted: true,
      sender: "Homer Simpson",
      recipient: "Marge Simpson",
      subject: "Harmless AP2 internal email",
    });
    api.sendSimulatedEmail = send;

    await createAfterPartyApp(root, authentication, api).start();
    expect(send).not.toHaveBeenCalled();
    action("Send one internal email: Homer → Marge")?.click();
    await nextTask();

    expect(authentication.acquireAccessToken).toHaveBeenCalledWith(
      API_ACCESS_SCOPES,
    );
    expect(send).toHaveBeenCalledWith("temporary-token");
    expect(root.textContent).toContain(
      "Microsoft accepted the email request (202). Delivery is not confirmed.",
    );
  });

  it("signs out and contains authentication cancellation", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });
    authentication.signOut.mockResolvedValue();

    await createAfterPartyApp(root, authentication, api).start();
    action("Sign out")?.click();
    await nextTask();
    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("You are signed out.");

    authentication.initialize.mockRejectedValue(
      new AuthenticationCancelledError(),
    );
    await createAfterPartyApp(root, authentication, api).start();
    expect(root.textContent).toContain("Microsoft sign-in was cancelled.");
    expect(action("Try sign-in again")).toBeDefined();
  });
});
