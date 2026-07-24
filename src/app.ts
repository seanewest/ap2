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
  OneDriveInviteFailureError,
  OneDriveVerifyFailureError,
  type AfterPartyApi,
  type ApiCallerIdentity,
  type OneDriveInviteFailure,
  type OneDriveProofResult,
  type OneDriveVerifyFailure,
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

type OneDriveProofStage =
  | "not-started"
  | "uncertain"
  | "shared"
  | "verified"
  | "removed";

type OneDriveProofState = {
  stage: OneDriveProofStage;
  activity: "idle" | "sharing" | "verifying" | "removing";
  message?: string;
  notice?: string;
  inviteFailure?: OneDriveInviteFailure;
  verifyFailure?: OneDriveVerifyFailure;
};

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
      oneDriveProof: OneDriveProofState;
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
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
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
      state.simulatedEmail.kind === "loading" ||
      state.oneDriveProof.activity !== "idle"
    ) {
      return;
    }
    const account = state.account;
    const rehearsalStatus = state.rehearsalStatus;
    const simulatedEmail = state.simulatedEmail;
    const oneDriveProof = state.oneDriveProof;
    setState({
      kind: "signed-in",
      account,
      apiAccess: { kind: "loading" },
      rehearsalStatus,
      simulatedEmail,
      oneDriveProof,
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
          oneDriveProof,
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
          oneDriveProof,
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
        oneDriveProof,
      });
    }
  };

  const checkRehearsalStatus = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.rehearsalStatus.kind === "loading" ||
      state.apiAccess.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.oneDriveProof.activity !== "idle"
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const simulatedEmail = state.simulatedEmail;
    const oneDriveProof = state.oneDriveProof;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus: { kind: "loading" },
      simulatedEmail,
      oneDriveProof,
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
          oneDriveProof,
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
          oneDriveProof,
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
        oneDriveProof,
      });
    }
  };

  const sendSimulatedEmail = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.apiAccess.kind === "loading" ||
      state.rehearsalStatus.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.simulatedEmail.kind === "success" ||
      state.oneDriveProof.activity !== "idle"
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const rehearsalStatus = state.rehearsalStatus;
    const oneDriveProof = state.oneDriveProof;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus,
      simulatedEmail: { kind: "loading" },
      oneDriveProof,
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
          oneDriveProof,
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
          oneDriveProof,
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
        oneDriveProof,
      });
    }
  };

  const runOneDriveProofAction = async (
    action: "share" | "verify" | "remove",
  ): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.apiAccess.kind === "loading" ||
      state.rehearsalStatus.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.oneDriveProof.activity !== "idle" ||
      !isAllowedOneDriveAction(state.oneDriveProof.stage, action)
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const rehearsalStatus = state.rehearsalStatus;
    const simulatedEmail = state.simulatedEmail;
    const previousStage = state.oneDriveProof.stage;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus,
      simulatedEmail,
      oneDriveProof: {
        stage: previousStage,
        activity:
          action === "share"
            ? "sharing"
            : action === "verify"
              ? "verifying"
              : "removing",
      },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      if (action !== "verify") {
        persistOneDriveStage(storage, account, "uncertain");
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail,
          oneDriveProof: {
            stage: "uncertain",
            activity: action === "share" ? "sharing" : "removing",
          },
        });
      }
      const result =
        action === "share"
          ? await api.shareOneDriveProof(accessToken)
          : action === "verify"
            ? await api.verifyOneDriveProof(accessToken)
            : await api.removeOneDriveProof(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        const nextStage = oneDriveStage(result);
        persistOneDriveStage(storage, account, nextStage);
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail,
          oneDriveProof: {
            stage: nextStage,
            activity: "idle",
            ...(result.state === "pending"
              ? {
                  notice:
                    "Marge access is still being confirmed. Try Verify again later. The proof file was not changed.",
                }
              : {}),
          },
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
          simulatedEmail,
          oneDriveProof: {
            stage: previousStage,
            activity: "idle",
            message: "The OneDrive action was cancelled before it started.",
          },
        });
        return;
      }
      if (action === "share" && error instanceof OneDriveInviteFailureError) {
        persistOneDriveStage(storage, account, "uncertain");
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail,
          oneDriveProof: {
            stage: "uncertain",
            activity: "idle",
            message: error.message,
            inviteFailure: error.diagnostic,
          },
        });
        return;
      }
      if (action === "verify" && error instanceof OneDriveVerifyFailureError) {
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail,
          oneDriveProof: {
            stage: previousStage,
            activity: "idle",
            message: error.message,
            verifyFailure: error.diagnostic,
          },
        });
        return;
      }
      const stage = action === "verify" ? previousStage : "uncertain";
      const fallback =
        action === "verify"
          ? "Marge access could not be verified. No file was changed."
          : "The OneDrive change was not confirmed. Do not repeat sharing; verify or clean up explicitly.";
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : fallback;
      setState({
        kind: "signed-in",
        account,
        apiAccess,
        rehearsalStatus,
        simulatedEmail,
        oneDriveProof: { stage, activity: "idle", message },
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
    root
      .querySelector<HTMLButtonElement>("[data-action='share-onedrive-proof']")
      ?.addEventListener("click", () => void runOneDriveProofAction("share"));
    root
      .querySelector<HTMLButtonElement>("[data-action='verify-onedrive-proof']")
      ?.addEventListener("click", () => void runOneDriveProofAction("verify"));
    root
      .querySelector<HTMLButtonElement>("[data-action='remove-onedrive-proof']")
      ?.addEventListener("click", () => void runOneDriveProofAction("remove"));
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
              oneDriveProof: {
                stage: readOneDriveStage(storage, startup.account),
                activity: "idle",
              },
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
        state.simulatedEmail.kind === "loading" ||
        state.oneDriveProof.activity !== "idle";
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
        createOneDriveProofPanel(
          state.oneDriveProof,
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
    | "send-simulated-email"
    | "share-onedrive-proof"
    | "verify-onedrive-proof"
    | "remove-onedrive-proof",
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

function createOneDriveProofPanel(
  state: OneDriveProofState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";
  panel.append(
    createStatus(
      "Real tenant activity: Homer creates one fixed harmless file, shares it read-only with Marge, and cleanup moves it to Homer's recycle bin.",
      "notice",
    ),
  );

  if (state.activity !== "idle") {
    panel.setAttribute("aria-busy", "true");
    panel.append(
      createStatus(
        state.activity === "sharing"
          ? "Creating and sharing the fixed OneDrive proof…"
          : state.activity === "verifying"
            ? "Signing in as Marge and verifying the exact file bytes…"
            : "Validating and removing the fixed OneDrive proof…",
      ),
    );
  } else {
    const message =
      state.stage === "not-started"
        ? "OneDrive proof: not started in this browser."
        : state.stage === "shared"
          ? "OneDrive proof: shared read-only with Marge. Access is not yet verified."
          : state.stage === "verified"
            ? "OneDrive proof: Marge access and exact file bytes verified."
            : state.stage === "removed"
              ? "OneDrive proof: removed to Homer's recycle bin."
              : "OneDrive proof: the last change outcome is uncertain. Do not share again; verify or clean up explicitly.";
    panel.append(createStatus(message, state.stage === "uncertain" ? "notice" : "status"));
  }
  if (state.message) {
    panel.append(createStatus(state.message, "error"));
  }
  if (state.notice) {
    panel.append(createStatus(state.notice, "notice"));
  }
  if (state.inviteFailure) {
    panel.append(createOneDriveInviteFailureList(state.inviteFailure));
  }
  if (state.verifyFailure) {
    panel.append(createOneDriveVerifyFailureList(state.verifyFailure));
  }

  panel.append(
    createButton(
      "Create and share OneDrive proof",
      "share-onedrive-proof",
      "primary",
      apiOperationLoading || state.stage !== "not-started",
    ),
    createButton(
      "Verify as Marge",
      "verify-onedrive-proof",
      "secondary",
      apiOperationLoading ||
        (state.stage !== "shared" && state.stage !== "uncertain"),
    ),
    createButton(
      "Clean up OneDrive proof",
      "remove-onedrive-proof",
      "secondary",
      apiOperationLoading ||
        !["shared", "verified", "uncertain"].includes(state.stage),
    ),
  );
  return panel;
}

function createOneDriveInviteFailureList(
  failure: OneDriveInviteFailure,
): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(
    list,
    "Failed stage",
    failure.stage === "invite"
      ? "Invite Marge with read access"
      : "Reconcile Marge read access after invite",
  );
  appendIdentity(list, "Microsoft Graph status", String(failure.upstreamStatus));
  appendIdentity(
    list,
    "Microsoft Graph error code",
    failure.graphErrorCode ?? "Not provided",
  );
  if (failure.requestId) {
    appendIdentity(list, "Microsoft Graph request ID", failure.requestId);
  }
  appendIdentity(list, "Client request ID", failure.clientRequestId);
  if (failure.responseDate) {
    appendIdentity(list, "Microsoft Graph response date", failure.responseDate);
  }
  if (failure.retryAfter) {
    appendIdentity(list, "Microsoft Graph retry after", failure.retryAfter);
  }
  appendIdentity(list, "Response shape", inviteResponseShape(failure.responseShape));
  return list;
}

function inviteResponseShape(
  value: OneDriveInviteFailure["responseShape"],
): string {
  switch (value) {
    case "graph-error":
      return "Microsoft Graph error";
    case "non-json":
      return "No JSON response";
    case "permission-response-mismatch":
      return "Invite permission shape did not match";
    case "permission-reconciliation-error":
      return "Permission reconciliation failed";
    case "permission-reconciliation-mismatch":
      return "Permission reconciliation was ambiguous";
  }
}

function createOneDriveVerifyFailureList(
  failure: OneDriveVerifyFailure,
): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(
    list,
    "Failed stage",
    "Read the exact file bytes as Marge",
  );
  appendIdentity(list, "Microsoft Graph status", String(failure.upstreamStatus));
  appendIdentity(
    list,
    "Microsoft Graph error code",
    failure.graphErrorCode ?? "Not provided",
  );
  if (failure.requestId) {
    appendIdentity(list, "Microsoft Graph request ID", failure.requestId);
  }
  appendIdentity(list, "Client request ID", failure.clientRequestId);
  if (failure.responseDate) {
    appendIdentity(list, "Microsoft Graph response date", failure.responseDate);
  }
  if (failure.retryAfter) {
    appendIdentity(list, "Microsoft Graph retry after", failure.retryAfter);
  }
  appendIdentity(list, "Response shape", verifyResponseShape(failure.responseShape));
  return list;
}

function verifyResponseShape(
  value: OneDriveVerifyFailure["responseShape"],
): string {
  switch (value) {
    case "graph-error":
      return "Microsoft Graph error";
    case "non-json":
      return "No JSON response";
    case "invalid-download-redirect":
      return "Download redirect was not accepted";
    case "content-response-error":
      return "File content response could not be used";
    case "content-mismatch":
      return "File bytes did not match";
  }
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

function isAllowedOneDriveAction(
  stage: OneDriveProofStage,
  action: "share" | "verify" | "remove",
): boolean {
  if (action === "share") {
    return stage === "not-started";
  }
  if (action === "verify") {
    return stage === "shared" || stage === "uncertain";
  }
  return stage === "shared" || stage === "verified" || stage === "uncertain";
}

function oneDriveStage(result: OneDriveProofResult): OneDriveProofStage {
  return result.state === "pending" ? "shared" : result.state;
}

function oneDriveStorageKey(account: AccountIdentity): string {
  return `ap2.onedrive-share-proof.${account.tenantId}.${account.accountId}`;
}

function readOneDriveStage(
  storage: Pick<Storage, "getItem">,
  account: AccountIdentity,
): OneDriveProofStage {
  const value = storage.getItem(oneDriveStorageKey(account));
  return value === "uncertain" ||
    value === "shared" ||
    value === "verified" ||
    value === "removed"
    ? value
    : "not-started";
}

function persistOneDriveStage(
  storage: Pick<Storage, "setItem">,
  account: AccountIdentity,
  stage: OneDriveProofStage,
): void {
  storage.setItem(oneDriveStorageKey(account), stage);
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
