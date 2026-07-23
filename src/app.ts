import {
  AccessTokenCancelledError,
  AccessTokenError,
  AuthenticationCancelledError,
  AuthenticationError,
  type AccountIdentity,
  type Authentication,
} from "./auth/authentication";
import {
  ApiAccessError,
  type AfterPartyApi,
  type ApiCallerIdentity,
  type RehearsalStatus,
  type SimulatedEmailResult,
} from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";

type ApiAccessState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; caller: ApiCallerIdentity }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type RehearsalStatusState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; status: RehearsalStatus }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type SimulatedEmailState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: SimulatedEmailResult }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type ViewState =
  | { kind: "initial" }
  | { kind: "processing"; message: string }
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      account: AccountIdentity;
      apiAccess: ApiAccessState;
      rehearsalStatus: RehearsalStatusState;
      simulatedEmail: SimulatedEmailState;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface AfterPartyApp {
  start(): Promise<void>;
}

export function createAfterPartyApp(
  root: HTMLElement,
  authentication: Authentication,
  api: AfterPartyApi,
): AfterPartyApp {
  let state: ViewState = { kind: "initial" };

  const setState = (nextState: ViewState): void => {
    state = nextState;
    render();
  };

  const handleAuthenticationFailure = (error: unknown): void => {
    if (error instanceof AuthenticationCancelledError) {
      setState({ kind: "cancelled" });
      return;
    }

    const message =
      error instanceof AuthenticationError
        ? error.message
        : "Microsoft sign-in could not be completed. Try again.";
    setState({ kind: "error", message });
  };

  const signIn = async (): Promise<void> => {
    setState({ kind: "processing", message: "Opening Microsoft sign-in…" });
    try {
      await authentication.signIn();
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  const signOut = async (): Promise<void> => {
    setState({ kind: "processing", message: "Signing out…" });
    try {
      await authentication.signOut();
      setState({ kind: "signed-out" });
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  const checkApiAccess = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.apiAccess.kind === "loading" ||
      state.rehearsalStatus.kind === "loading" ||
      state.simulatedEmail.kind === "loading"
    ) {
      return;
    }
    const account = state.account;
    const rehearsalStatus = state.rehearsalStatus;
    const simulatedEmail = state.simulatedEmail;
    setState({
      kind: "signed-in",
      account,
      apiAccess: { kind: "loading" },
      rehearsalStatus,
      simulatedEmail,
    });

    try {
      const accessToken = await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const caller = await api.checkAccess(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        setState({
          kind: "signed-in",
          account,
          apiAccess: { kind: "success", caller },
          rehearsalStatus,
          simulatedEmail,
        });
      }
    } catch (error) {
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      if (error instanceof AccessTokenCancelledError) {
        setState({
          kind: "signed-in",
          account,
          apiAccess: { kind: "cancelled" },
          rehearsalStatus,
          simulatedEmail,
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : "API access could not be checked. Try again.";
      setState({
        kind: "signed-in",
        account,
        apiAccess: { kind: "error", message },
        rehearsalStatus,
        simulatedEmail,
      });
    }
  };

  const checkRehearsalStatus = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.rehearsalStatus.kind === "loading" ||
      state.apiAccess.kind === "loading" ||
      state.simulatedEmail.kind === "loading"
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const simulatedEmail = state.simulatedEmail;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus: { kind: "loading" },
      simulatedEmail,
    });

    try {
      const accessToken = await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const status = await api.getRehearsalStatus(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus: { kind: "success", status },
          simulatedEmail,
        });
      }
    } catch (error) {
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      if (error instanceof AccessTokenCancelledError) {
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus: { kind: "cancelled" },
          simulatedEmail,
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : "Rehearsal status could not be checked. Try again.";
      setState({
        kind: "signed-in",
        account,
        apiAccess,
        rehearsalStatus: { kind: "error", message },
        simulatedEmail,
      });
    }
  };

  const sendSimulatedEmail = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.apiAccess.kind === "loading" ||
      state.rehearsalStatus.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.simulatedEmail.kind === "success"
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const rehearsalStatus = state.rehearsalStatus;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus,
      simulatedEmail: { kind: "loading" },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const result = await api.sendSimulatedEmail(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail: { kind: "success", result },
        });
      }
    } catch (error) {
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      if (error instanceof AccessTokenCancelledError) {
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail: { kind: "cancelled" },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : "The internal email could not be submitted. Try again.";
      setState({
        kind: "signed-in",
        account,
        apiAccess,
        rehearsalStatus,
        simulatedEmail: { kind: "error", message },
      });
    }
  };

  const render = (): void => {
    root.replaceChildren(createShell(state));
    root
      .querySelector<HTMLButtonElement>("[data-action='sign-in']")
      ?.addEventListener("click", () => void signIn());
    root
      .querySelector<HTMLButtonElement>("[data-action='sign-out']")
      ?.addEventListener("click", () => void signOut());
    root
      .querySelector<HTMLButtonElement>("[data-action='check-api']")
      ?.addEventListener("click", () => void checkApiAccess());
    root
      .querySelector<HTMLButtonElement>("[data-action='check-rehearsal']")
      ?.addEventListener("click", () => void checkRehearsalStatus());
    root
      .querySelector<HTMLButtonElement>("[data-action='send-simulated-email']")
      ?.addEventListener("click", () => void sendSimulatedEmail());
  };

  const start = async (): Promise<void> => {
    setState({
      kind: "processing",
      message: "Completing Microsoft sign-in…",
    });
    try {
      const startup = await authentication.initialize();
      setState(
        startup.kind === "signed-in"
          ? {
              kind: "signed-in",
              account: startup.account,
              apiAccess: { kind: "idle" },
              rehearsalStatus: { kind: "idle" },
              simulatedEmail: { kind: "idle" },
            }
          : { kind: "signed-out" },
      );
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  render();
  return { start };
}

function createShell(state: ViewState): HTMLElement {
  const shell = document.createElement("main");
  shell.className = "shell";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "AFTER PARTY";
  shell.append(eyebrow);

  const heading = document.createElement("h1");
  heading.textContent = "Your tenant. Your operations.";
  shell.append(heading);

  const introduction = document.createElement("p");
  introduction.className = "introduction";
  introduction.textContent =
    "Sign in with your Microsoft work or school account to continue.";
  shell.append(introduction, createStatePanel(state));

  return shell;
}

function createStatePanel(state: ViewState): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "auth-panel";
  panel.setAttribute("aria-live", "polite");

  switch (state.kind) {
    case "initial":
      panel.append(createStatus("Preparing sign-in…"));
      break;
    case "processing":
      panel.setAttribute("aria-busy", "true");
      panel.append(createStatus(state.message));
      break;
    case "signed-out":
      panel.append(
        createStatus("You are signed out."),
        createButton("Sign in with Microsoft", "sign-in", "primary"),
      );
      break;
    case "signed-in":
      const apiOperationLoading =
        state.apiAccess.kind === "loading" ||
        state.rehearsalStatus.kind === "loading" ||
        state.simulatedEmail.kind === "loading";
      panel.append(
        createStatus(`Signed in as ${state.account.name}`),
        createIdentityList(state.account),
        createApiAccessPanel(state.apiAccess, apiOperationLoading),
        createRehearsalStatusPanel(
          state.rehearsalStatus,
          apiOperationLoading,
        ),
        createSimulatedEmailPanel(
          state.simulatedEmail,
          apiOperationLoading,
        ),
        createButton("Sign out", "sign-out", "secondary"),
      );
      break;
    case "cancelled":
      panel.append(
        createStatus("Microsoft sign-in was cancelled.", "notice"),
        createButton("Try sign-in again", "sign-in", "primary"),
      );
      break;
    case "error":
      panel.append(
        createStatus(state.message, "error"),
        createButton("Try sign-in again", "sign-in", "primary"),
      );
      break;
  }

  return panel;
}

function createStatus(message: string, className = "status"): HTMLElement {
  const status = document.createElement("p");
  status.className = className;
  status.textContent = message;
  return status;
}

function createButton(
  label: string,
  action:
    | "sign-in"
    | "sign-out"
    | "check-api"
    | "check-rehearsal"
    | "send-simulated-email",
  className: string,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

function createSimulatedEmailPanel(
  state: SimulatedEmailState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";

  panel.append(
    createStatus(
      "This creates real tenant activity: one internal email from Homer Simpson to Marge Simpson.",
      "notice",
    ),
  );

  if (state.kind === "loading") {
    panel.setAttribute("aria-busy", "true");
    panel.append(createStatus("Submitting the internal email…"));
  } else if (state.kind === "success") {
    panel.append(
      createStatus(
        "Microsoft accepted the email request (202). Delivery is not confirmed.",
      ),
      createSimulatedEmailResultList(state.result),
    );
  } else if (state.kind === "cancelled") {
    panel.append(
      createStatus(
        "The internal email request was cancelled. No acceptance was recorded.",
        "notice",
      ),
    );
  } else if (state.kind === "error") {
    panel.append(createStatus(state.message, "error"));
  }

  panel.append(
    createButton(
      "Send one internal email: Homer → Marge",
      "send-simulated-email",
      "primary",
      apiOperationLoading || state.kind === "success",
    ),
  );
  return panel;
}

function createRehearsalStatusPanel(
  state: RehearsalStatusState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";

  if (state.kind === "loading") {
    panel.setAttribute("aria-busy", "true");
    panel.append(createStatus("Checking rehearsal status…"));
  } else if (state.kind === "success") {
    panel.append(
      createStatus("Rehearsal status received."),
      createRehearsalStatusList(state.status),
    );
  } else if (state.kind === "cancelled") {
    panel.append(
      createStatus(
        "Rehearsal status request was cancelled. Try again when ready.",
        "notice",
      ),
    );
  } else if (state.kind === "error") {
    panel.append(createStatus(state.message, "error"));
  }

  panel.append(
    createButton(
      "Check rehearsal status",
      "check-rehearsal",
      "primary",
      apiOperationLoading,
    ),
  );
  return panel;
}

function createApiAccessPanel(
  state: ApiAccessState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";

  if (state.kind === "loading") {
    panel.setAttribute("aria-busy", "true");
    panel.append(createStatus("Checking API access…"));
  } else if (state.kind === "success") {
    panel.append(
      createStatus("API access confirmed."),
      createCallerList(state.caller),
    );
  } else if (state.kind === "cancelled") {
    panel.append(
      createStatus("API access request was cancelled. Try again when ready.", "notice"),
    );
  } else if (state.kind === "error") {
    panel.append(createStatus(state.message, "error"));
  }

  panel.append(
    createButton(
      "Check API access",
      "check-api",
      "primary",
      apiOperationLoading,
    ),
  );
  return panel;
}

function createIdentityList(account: AccountIdentity): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";

  appendIdentity(list, "Account", account.username);
  appendIdentity(list, "Tenant ID", account.tenantId);
  appendIdentity(list, "Account ID", account.accountId);

  return list;
}

function createCallerList(caller: ApiCallerIdentity): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(list, "Caller type", caller.callerType);
  appendIdentity(list, "API tenant ID", caller.tenantId);
  return list;
}

function createRehearsalStatusList(
  status: RehearsalStatus,
): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(list, "App", status.appName);
  appendIdentity(list, "Region", status.region);
  appendIdentity(list, "Running status", status.runningStatus);
  appendIdentity(list, "Latest ready revision", status.latestReadyRevision);
  return list;
}

function createSimulatedEmailResultList(
  result: SimulatedEmailResult,
): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(list, "Accepted", result.accepted ? "Yes" : "No");
  appendIdentity(list, "Sender", result.sender);
  appendIdentity(list, "Recipient", result.recipient);
  appendIdentity(list, "Subject", result.subject);
  return list;
}

function isCurrentSignedInAccount(
  state: ViewState,
  account: AccountIdentity,
): state is Extract<ViewState, { kind: "signed-in" }> {
  return state.kind === "signed-in" && state.account.accountId === account.accountId;
}

function appendIdentity(
  list: HTMLDListElement,
  label: string,
  value: string,
): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}
