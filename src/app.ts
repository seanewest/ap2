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
  CALENDAR_MEETING_ATTENDEES,
  CALENDAR_MEETING_END,
  CALENDAR_MEETING_ORGANIZER,
  CALENDAR_MEETING_START,
  CALENDAR_MEETING_SUBJECT,
  OneDriveInviteFailureError,
  type AfterPartyApi,
  type ApiCallerIdentity,
  type CalendarMeetingResult,
  type OneDriveInviteFailure,
  type OneDriveProofResult,
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
  | "configured"
  | "removed";

type OneDriveProofState = {
  stage: OneDriveProofStage;
  activity: "idle" | "sharing" | "removing";
  message?: string;
  inviteFailure?: OneDriveInviteFailure;
};

type CalendarMeetingStage =
  | "not-started"
  | "uncertain"
  | "configured"
  | "cancellation-uncertain"
  | "cancellation-accepted";

type CalendarMeetingState = {
  stage: CalendarMeetingStage;
  activity: "idle" | "creating" | "cancelling";
  message?: string;
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
      calendarMeeting: CalendarMeetingState;
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
      state.oneDriveProof.activity !== "idle" ||
      state.calendarMeeting.activity !== "idle"
    ) {
      return;
    }
    const account = state.account;
    const rehearsalStatus = state.rehearsalStatus;
    const simulatedEmail = state.simulatedEmail;
    const oneDriveProof = state.oneDriveProof;
    const calendarMeeting = state.calendarMeeting;
    setState({
      kind: "signed-in",
      account,
      apiAccess: { kind: "loading" },
      rehearsalStatus,
      simulatedEmail,
      oneDriveProof,
      calendarMeeting,
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
          calendarMeeting,
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
          calendarMeeting,
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
        calendarMeeting,
      });
    }
  };

  const checkRehearsalStatus = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.rehearsalStatus.kind === "loading" ||
      state.apiAccess.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.oneDriveProof.activity !== "idle" ||
      state.calendarMeeting.activity !== "idle"
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const simulatedEmail = state.simulatedEmail;
    const oneDriveProof = state.oneDriveProof;
    const calendarMeeting = state.calendarMeeting;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus: { kind: "loading" },
      simulatedEmail,
      oneDriveProof,
      calendarMeeting,
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
          calendarMeeting,
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
          calendarMeeting,
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
        calendarMeeting,
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
      state.oneDriveProof.activity !== "idle" ||
      state.calendarMeeting.activity !== "idle"
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const rehearsalStatus = state.rehearsalStatus;
    const oneDriveProof = state.oneDriveProof;
    const calendarMeeting = state.calendarMeeting;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus,
      simulatedEmail: { kind: "loading" },
      oneDriveProof,
      calendarMeeting,
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
          calendarMeeting,
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
          calendarMeeting,
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
        calendarMeeting,
      });
    }
  };

  const runOneDriveProofAction = async (
    action: "share" | "remove",
  ): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.apiAccess.kind === "loading" ||
      state.rehearsalStatus.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.calendarMeeting.activity !== "idle" ||
      state.oneDriveProof.activity !== "idle" ||
      !isAllowedOneDriveAction(state.oneDriveProof.stage, action)
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const rehearsalStatus = state.rehearsalStatus;
    const simulatedEmail = state.simulatedEmail;
    const calendarMeeting = state.calendarMeeting;
    const previousStage = state.oneDriveProof.stage;
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus,
      simulatedEmail,
      oneDriveProof: {
        stage: previousStage,
        activity: action === "share" ? "sharing" : "removing",
      },
      calendarMeeting,
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
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
        calendarMeeting,
      });
      const result =
        action === "share"
          ? await api.shareOneDriveProof(accessToken)
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
          },
          calendarMeeting,
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
          calendarMeeting,
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
          calendarMeeting,
        });
        return;
      }
      const fallback =
        "The OneDrive change was not confirmed. Do not repeat sharing; clean up explicitly.";
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
        oneDriveProof: { stage: "uncertain", activity: "idle", message },
        calendarMeeting,
      });
    }
  };

  const runCalendarMeetingAction = async (
    action: "create" | "cancel",
  ): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.apiAccess.kind === "loading" ||
      state.rehearsalStatus.kind === "loading" ||
      state.simulatedEmail.kind === "loading" ||
      state.oneDriveProof.activity !== "idle" ||
      state.calendarMeeting.activity !== "idle" ||
      !isAllowedCalendarMeetingAction(state.calendarMeeting.stage, action)
    ) {
      return;
    }
    const account = state.account;
    const apiAccess = state.apiAccess;
    const rehearsalStatus = state.rehearsalStatus;
    const simulatedEmail = state.simulatedEmail;
    const oneDriveProof = state.oneDriveProof;
    const previousStage = state.calendarMeeting.stage;
    const attemptedStage =
      action === "create" ? "uncertain" : "cancellation-uncertain";
    setState({
      kind: "signed-in",
      account,
      apiAccess,
      rehearsalStatus,
      simulatedEmail,
      oneDriveProof,
      calendarMeeting: {
        stage: previousStage,
        activity: action === "create" ? "creating" : "cancelling",
      },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      persistCalendarMeetingStage(storage, account, attemptedStage);
      setState({
        kind: "signed-in",
        account,
        apiAccess,
        rehearsalStatus,
        simulatedEmail,
        oneDriveProof,
        calendarMeeting: {
          stage: attemptedStage,
          activity: action === "create" ? "creating" : "cancelling",
        },
      });
      const result =
        action === "create"
          ? await api.createCalendarMeeting(accessToken)
          : await api.cancelCalendarMeeting(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        const nextStage = calendarMeetingStage(result);
        persistCalendarMeetingStage(storage, account, nextStage);
        setState({
          kind: "signed-in",
          account,
          apiAccess,
          rehearsalStatus,
          simulatedEmail,
          oneDriveProof,
          calendarMeeting: {
            stage: nextStage,
            activity: "idle",
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
          oneDriveProof,
          calendarMeeting: {
            stage: previousStage,
            activity: "idle",
            message: "The calendar action was cancelled before it started.",
          },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : "The calendar change was not confirmed. Do not repeat it.";
      persistCalendarMeetingStage(storage, account, attemptedStage);
      setState({
        kind: "signed-in",
        account,
        apiAccess,
        rehearsalStatus,
        simulatedEmail,
        oneDriveProof,
        calendarMeeting: {
          stage: attemptedStage,
          activity: "idle",
          message,
        },
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
      .querySelector<HTMLButtonElement>("[data-action='remove-onedrive-proof']")
      ?.addEventListener("click", () => void runOneDriveProofAction("remove"));
    root
      .querySelector<HTMLButtonElement>("[data-action='create-calendar-meeting']")
      ?.addEventListener("click", () => void runCalendarMeetingAction("create"));
    root
      .querySelector<HTMLButtonElement>("[data-action='cancel-calendar-meeting']")
      ?.addEventListener("click", () => void runCalendarMeetingAction("cancel"));
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
              calendarMeeting: {
                stage: readCalendarMeetingStage(storage, startup.account),
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
        state.oneDriveProof.activity !== "idle" ||
        state.calendarMeeting.activity !== "idle";
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
        createCalendarMeetingPanel(
          state.calendarMeeting,
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
    | "remove-onedrive-proof"
    | "create-calendar-meeting"
    | "cancel-calendar-meeting",
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
          : "Validating and removing the fixed OneDrive proof…",
      ),
    );
  } else {
    const message =
      state.stage === "not-started"
        ? "OneDrive proof: not started in this browser."
        : state.stage === "configured"
          ? "OneDrive proof: read-only access is configured for Marge."
            : state.stage === "removed"
              ? "OneDrive proof: removed to Homer's recycle bin."
              : "OneDrive proof: the last change outcome is uncertain. Do not share again; clean up explicitly.";
    panel.append(createStatus(message, state.stage === "uncertain" ? "notice" : "status"));
  }
  if (state.message) {
    panel.append(createStatus(state.message, "error"));
  }
  if (state.inviteFailure) {
    panel.append(createOneDriveInviteFailureList(state.inviteFailure));
  }
  if (state.stage === "configured" && state.activity === "idle") {
    panel.append(createOneDriveHumanVerificationInstructions());
  }

  panel.append(
    createButton(
      "Create and share OneDrive proof",
      "share-onedrive-proof",
      "primary",
      apiOperationLoading ||
        (state.stage !== "not-started" && state.stage !== "removed"),
    ),
    createButton(
      "Clean up OneDrive proof",
      "remove-onedrive-proof",
      "secondary",
      apiOperationLoading ||
        !["configured", "uncertain"].includes(state.stage),
    ),
  );
  return panel;
}

function createCalendarMeetingPanel(
  state: CalendarMeetingState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";
  panel.append(
    createStatus(
      "Real tenant activity: Cory creates one fixed harmless 15-minute meeting inviting only Kobe and Marge, then explicitly cancels it.",
      "notice",
    ),
    createCalendarMeetingDetails(),
  );

  if (state.activity !== "idle") {
    panel.setAttribute("aria-busy", "true");
    panel.append(
      createStatus(
        state.activity === "creating"
          ? "Creating the fixed calendar meeting…"
          : "Cancelling the fixed calendar meeting…",
      ),
    );
  } else {
    const message =
      state.stage === "not-started"
        ? "Calendar rehearsal: not started in this browser."
        : state.stage === "configured"
          ? "Calendar rehearsal: Configured. Microsoft accepted the meeting and invitations; attendee receipt or response is not confirmed."
          : state.stage === "cancellation-accepted"
            ? "Calendar rehearsal: Cancellation accepted. Attendee receipt is not confirmed."
            : state.stage === "cancellation-uncertain"
              ? "Calendar rehearsal: cancellation is uncertain. Do not repeat it."
              : "Calendar rehearsal: creation is uncertain. Do not create again; Cancel can explicitly find and cancel one exact matching meeting.";
    panel.append(
      createStatus(
        message,
        ["uncertain", "cancellation-uncertain"].includes(state.stage)
          ? "notice"
          : "status",
      ),
    );
  }
  if (state.message) {
    panel.append(createStatus(state.message, "error"));
  }

  panel.append(
    createButton(
      "Create calendar meeting",
      "create-calendar-meeting",
      "primary",
      apiOperationLoading || state.stage !== "not-started",
    ),
    createButton(
      "Cancel calendar meeting",
      "cancel-calendar-meeting",
      "secondary",
      apiOperationLoading ||
        !["configured", "uncertain"].includes(state.stage),
    ),
  );
  return panel;
}

function createCalendarMeetingDetails(): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(list, "Organizer", CALENDAR_MEETING_ORGANIZER);
  appendIdentity(list, "Required attendees", CALENDAR_MEETING_ATTENDEES.join(", "));
  appendIdentity(list, "Subject", CALENDAR_MEETING_SUBJECT);
  appendIdentity(
    list,
    "Body",
    "Harmless AP2 calendar rehearsal. No action or response is required. The organizer will cancel it after observation.",
  );
  appendIdentity(
    list,
    "Time",
    `${CALENDAR_MEETING_START} to ${CALENDAR_MEETING_END} (2:00–2:15 PM EDT)`,
  );
  appendIdentity(list, "Duration", "15 minutes");
  appendIdentity(list, "Show as", "Free");
  appendIdentity(list, "Reminder", "Off");
  appendIdentity(list, "Teams / online meeting", "Off");
  appendIdentity(list, "Responses", "Not requested");
  return list;
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

function createOneDriveHumanVerificationInstructions(): HTMLOListElement {
  const list = document.createElement("ol");
  for (const instruction of [
    "In a separate browser or profile, sign in to OneDrive as marge.simpson@corywest.onmicrosoft.com.",
    "Open Shared, then Shared with you.",
    "Find AP2-OneDrive-share-proof.txt.",
    "Return here and click Clean up OneDrive proof when finished.",
  ]) {
    const item = document.createElement("li");
    item.textContent = instruction;
    list.append(item);
  }
  return list;
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
  action: "share" | "remove",
): boolean {
  if (action === "share") {
    return stage === "not-started" || stage === "removed";
  }
  return stage === "configured" || stage === "uncertain";
}

function oneDriveStage(result: OneDriveProofResult): OneDriveProofStage {
  return result.state;
}

function isAllowedCalendarMeetingAction(
  stage: CalendarMeetingStage,
  action: "create" | "cancel",
): boolean {
  return action === "create"
    ? stage === "not-started"
    : stage === "configured" || stage === "uncertain";
}

function calendarMeetingStage(
  result: CalendarMeetingResult,
): CalendarMeetingStage {
  return result.state;
}

function oneDriveStorageKey(account: AccountIdentity): string {
  return `ap2.onedrive-share-proof.${account.tenantId}.${account.accountId}`;
}

function readOneDriveStage(
  storage: Pick<Storage, "getItem">,
  account: AccountIdentity,
): OneDriveProofStage {
  const value = storage.getItem(oneDriveStorageKey(account));
  if (value === "shared" || value === "verified") {
    return "configured";
  }
  return value === "uncertain" ||
      value === "configured" ||
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

function calendarMeetingStorageKey(account: AccountIdentity): string {
  return `ap2.calendar-meeting.${account.tenantId}.${account.accountId}`;
}

function readCalendarMeetingStage(
  storage: Pick<Storage, "getItem">,
  account: AccountIdentity,
): CalendarMeetingStage {
  const value = storage.getItem(calendarMeetingStorageKey(account));
  return value === "uncertain" ||
      value === "configured" ||
      value === "cancellation-uncertain" ||
      value === "cancellation-accepted"
    ? value
    : "not-started";
}

function persistCalendarMeetingStage(
  storage: Pick<Storage, "setItem">,
  account: AccountIdentity,
  stage: CalendarMeetingStage,
): void {
  storage.setItem(calendarMeetingStorageKey(account), stage);
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
