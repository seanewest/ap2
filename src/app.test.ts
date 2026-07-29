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

class FakeAuthentication implements Authentication {
  initialize = vi.fn<() => Promise<AuthenticationStartup>>();
  signIn = vi.fn<() => Promise<void>>();
  signOut = vi.fn<() => Promise<void>>();
  acquireAccessToken =
    vi.fn<(scopes: readonly string[]) => Promise<string>>();
}

function fakeApi(): AfterPartyApi {
  return new Proxy({} as AfterPartyApi, {
    get(target, property) {
      if (!(property in target)) {
        Object.defineProperty(target, property, {
          configurable: true,
          value: vi.fn(),
        });
      }
      return Reflect.get(target, property);
    },
  });
}

function action(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  );
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("After Party primary SPA", () => {
  let root: HTMLElement;
  let authentication: FakeAuthentication;
  let api: AfterPartyApi;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector("#app")!;
    window.localStorage.clear();
    authentication = new FakeAuthentication();
    api = fakeApi();
  });

  it("offers one understandable Microsoft sign-in action when signed out", async () => {
    authentication.initialize.mockResolvedValue({ kind: "signed-out" });

    const app = createAfterPartyApp(root, authentication, api);
    await app.start();

    expect(root.textContent).toContain("You are signed out.");
    action("Sign in with Microsoft")?.click();
    expect(authentication.signIn).toHaveBeenCalledOnce();
  });

  it("shows honest catalogs and explicit capability actions when signed in", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });

    await createAfterPartyApp(root, authentication, api).start();

    expect(root.textContent).toContain("Lab catalog");
    expect(root.textContent).toContain("No complete labs are published yet.");
    expect(root.textContent).toContain("Capability building blocks");
    expect(root.textContent).toContain(
      "Capability actions below make the specific Microsoft 365 change",
    );
    expect(action("Send one internal email: Homer → Marge")).toBeDefined();
    expect(action("Create one help desk email: Kobe → Cory")).toBeDefined();
    expect(action("Create and share OneDrive proof")).toBeDefined();
    expect(action("Create calendar meeting")).toBeDefined();
    expect(action("Create contact proof")).toBeDefined();
    expect(action("Create disabled Inbox rule")).toBeDefined();
    expect(action("Create Outlook category proof")).toBeDefined();
    expect(action("Create SharePoint file proof")).toBeDefined();
    expect(action("Create unsent draft proof")).toBeDefined();
    expect(action("Create To Do task proof")).toBeDefined();
    expect(action("Sign out")).toBeDefined();
  });

  it("does not render developer and operator contract controls", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });

    await createAfterPartyApp(root, authentication, api).start();

    expect(root.querySelector("textarea")).toBeNull();
    expect(root.textContent).not.toMatch(
      /REHEARSAL_ONLY|PR #\d+|Scenario plan preview|Scenario batch feasibility|Receipt verification|Scenario surface availability|Recent operations|Check API access|Check rehearsal status|support bundle/i,
    );
    expect(root.querySelector("[class*='rehearsal-verification']")).toBeNull();
    expect(root.querySelector(".scenario-evidence-verification")).toBeNull();
    expect(root.querySelector(".batch-feasibility")).toBeNull();
    expect(root.querySelector(".scenario-surface-matrix")).toBeNull();
    expect(root.querySelector(".operator-support-bundle")).toBeNull();
  });

  it("performs no API work merely by rendering the signed-in page", async () => {
    authentication.initialize.mockResolvedValue({
      kind: "signed-in",
      account,
      source: "cache",
    });

    await createAfterPartyApp(root, authentication, api).start();

    expect(authentication.acquireAccessToken).not.toHaveBeenCalled();
    for (const value of Object.values(api)) {
      if (typeof value === "function" && "mock" in value) {
        expect(value).not.toHaveBeenCalled();
      }
    }
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
