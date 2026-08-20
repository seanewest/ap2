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
  CALENDAR_MEETING_RUN_ID,
  CALENDAR_MEETING_START,
  CONTACT_PROOF_DISPLAY_NAME,
  CONTACT_PROOF_EMAIL,
  CONTACT_PROOF_RUN_ID,
  OneDriveInviteFailureError,
  type AfterPartyApi,
  type CalendarMeetingResult,
  type HelpDeskScenarioResult,
  type OneDriveInviteFailure,
  type OneDriveProofResult,
  type SimulatedEmailResult,
} from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";
import { installation } from "./installation";
import { withApiSupportReference } from "./api/support-reference";
import {
  FIXED_PROOF_BY_ID,
  bindFixedProofActions,
  fixedProofStorageKey,
  hasBusyFixedProof,
  isAllowedFixedProofAction,
  persistFixedProofStage,
  readFixedProofStates,
  type FixedProofId,
  type FixedProofStates,
} from "./operations/fixed-proofs";
import { createFixedProofPanel } from "./operations/fixed-proof";
import {
  appendIdentity,
  createButton,
  createStatus,
} from "./ui/elements";

type SimulatedEmailState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: SimulatedEmailResult }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type HelpDeskScenarioState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: HelpDeskScenarioResult }
  | { kind: "cancelled" }
  | { kind: "server-shutting-down"; message: string }
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

type ContactProofState = {
  stage: "not-started" | "uncertain" | "configured" | "removed";
  activity: "idle" | "creating" | "removing";
  message?: string;
};

type ApiConnection =
  | { kind: "connected" }
  | { kind: "unavailable"; message: string };
type ApiResolver = (account: AccountIdentity) => Promise<AfterPartyApi>;

type ViewState =
  | { kind: "initial" }
  | { kind: "processing"; message: string }
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      account: AccountIdentity;
      simulatedEmail: SimulatedEmailState;
      helpDeskScenario: HelpDeskScenarioState;
      oneDriveProof: OneDriveProofState;
      calendarMeeting: CalendarMeetingState;
      fixedProofs: FixedProofStates;
      apiConnection: ApiConnection;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type SignedInState = Extract<ViewState, { kind: "signed-in" }>;
type SignedInPatch = Partial<Omit<SignedInState, "kind" | "account">>;

export interface AfterPartyApp {
  start(): Promise<void>;
}

export function createAfterPartyApp(
  root: HTMLElement,
  authentication: Authentication,
  apiSource: AfterPartyApi | ApiResolver,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): AfterPartyApp {
  const resolveApi = typeof apiSource === "function" ? apiSource : undefined;
  const fixedApi = typeof apiSource === "function" ? undefined : apiSource;
  let api: AfterPartyApi | undefined;
  let state: ViewState = { kind: "initial" };
  let contactProof: ContactProofState = {
    stage: "not-started",
    activity: "idle",
  };
  const setContactProof = (
    next: ContactProofState,
    account?: AccountIdentity,
  ): void => {
    contactProof = next;
    if (account) {
      storage.setItem(contactStorageKey(account), next.stage);
    }
    render();
  };

  const setState = (nextState: ViewState): void => {
    state = nextState;
    render();
  };

  const setSignedInPatch = (
    account: AccountIdentity,
    patch: SignedInPatch,
  ): boolean => {
    if (!isCurrentSignedInAccount(state, account)) {
      return false;
    }
    setState({ ...state, ...patch });
    return true;
  };

  const handleAuthenticationFailure = (error: unknown): void => {
    if (error instanceof AuthenticationCancelledError) {
      setState({ kind: "cancelled" });
      return;
    }

    const message =
      error instanceof AuthenticationError
        ? withApiSupportReference(error.message, error)
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
    api = undefined;
    setState({ kind: "processing", message: "Signing out…" });
    try {
      await authentication.signOut();
      setState({ kind: "signed-out" });
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  const sendSimulatedEmail = async (): Promise<void> => {
    const connectedApi = api;
    if (
      !connectedApi ||
      state.kind !== "signed-in" ||
      state.simulatedEmail.kind === "success" ||
      isApiOperationBusy(state, contactProof)
    ) {
      return;
    }
    const account = state.account;
    setSignedInPatch(account, {
      simulatedEmail: { kind: "loading" },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const result = await connectedApi.sendSimulatedEmail(accessToken);
      setSignedInPatch(account, {
        simulatedEmail: { kind: "success", result },
      });
    } catch (error) {
      if (error instanceof AccessTokenCancelledError) {
        setSignedInPatch(account, {
          simulatedEmail: { kind: "cancelled" },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? withApiSupportReference(error.message, error)
          : "The internal email could not be submitted. Try again.";
      setSignedInPatch(account, {
        simulatedEmail: { kind: "error", message },
      });
    }
  };

  const sendHelpDeskScenario = async (): Promise<void> => {
    const connectedApi = api;
    if (
      !connectedApi ||
      state.kind !== "signed-in" ||
      !["idle", "server-shutting-down"].includes(
        state.helpDeskScenario.kind,
      ) ||
      isApiOperationBusy(state, contactProof)
    ) {
      return;
    }
    const account = state.account;
    setSignedInPatch(account, {
      helpDeskScenario: { kind: "loading" },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const result = await connectedApi.sendHelpDeskScenario(accessToken);
      setSignedInPatch(account, {
        helpDeskScenario: { kind: "success", result },
      });
    } catch (error) {
      if (error instanceof AccessTokenCancelledError) {
        setSignedInPatch(account, {
          helpDeskScenario: { kind: "cancelled" },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? withApiSupportReference(error.message, error)
          : "The help desk email was not confirmed. Do not repeat it.";
      setSignedInPatch(account, {
        helpDeskScenario: {
          kind: isServerShuttingDownError(error)
            ? "server-shutting-down"
            : "error",
          message,
        },
      });
    }
  };

  const runOneDriveProofAction = async (
    action: "share" | "remove",
  ): Promise<void> => {
    const connectedApi = api;
    if (
      !connectedApi ||
      state.kind !== "signed-in" ||
      isApiOperationBusy(state, contactProof) ||
      !isAllowedOneDriveAction(state.oneDriveProof.stage, action)
    ) {
      return;
    }
    const account = state.account;
    const previousStage = state.oneDriveProof.stage;
    setSignedInPatch(account, {
      oneDriveProof: {
        stage: previousStage,
        activity: action === "share" ? "sharing" : "removing",
      },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      persistOneDriveStage(storage, account, "uncertain");
      setSignedInPatch(account, {
        oneDriveProof: {
          stage: "uncertain",
          activity: action === "share" ? "sharing" : "removing",
        },
      });
      const result =
        action === "share"
          ? await connectedApi.shareOneDriveProof(accessToken)
          : await connectedApi.removeOneDriveProof(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        const nextStage = oneDriveStage(result);
        persistOneDriveStage(storage, account, nextStage);
        setSignedInPatch(account, {
          oneDriveProof: {
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
        setSignedInPatch(account, {
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
        setSignedInPatch(account, {
          oneDriveProof: {
            stage: "uncertain",
            activity: "idle",
            message: withApiSupportReference(error.message, error),
            inviteFailure: error.diagnostic,
          },
        });
        return;
      }
      if (isServerShuttingDownError(error)) {
        persistOneDriveStage(storage, account, previousStage);
        setSignedInPatch(account, {
          oneDriveProof: {
            stage: previousStage,
            activity: "idle",
            message: withApiSupportReference(error.message, error),
          },
        });
        return;
      }
      const fallback =
        "The OneDrive change was not confirmed. Do not repeat sharing; clean up explicitly.";
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? withApiSupportReference(error.message, error)
          : fallback;
      setSignedInPatch(account, {
        oneDriveProof: { stage: "uncertain", activity: "idle", message },
      });
    }
  };

  const runCalendarMeetingAction = async (
    action: "create" | "cancel",
  ): Promise<void> => {
    const connectedApi = api;
    if (
      !connectedApi ||
      state.kind !== "signed-in" ||
      isApiOperationBusy(state, contactProof) ||
      !isAllowedCalendarMeetingAction(state.calendarMeeting.stage, action)
    ) {
      return;
    }
    const account = state.account;
    const previousStage = state.calendarMeeting.stage;
    const attemptedStage =
      action === "create" ? "uncertain" : "cancellation-uncertain";
    setSignedInPatch(account, {
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
      setSignedInPatch(account, {
        calendarMeeting: {
          stage: attemptedStage,
          activity: action === "create" ? "creating" : "cancelling",
        },
      });
      const result =
        action === "create"
          ? await connectedApi.createCalendarMeeting(accessToken)
          : await connectedApi.cancelCalendarMeeting(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        const nextStage = calendarMeetingStage(result);
        persistCalendarMeetingStage(storage, account, nextStage);
        setSignedInPatch(account, {
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
        setSignedInPatch(account, {
          calendarMeeting: {
            stage: previousStage,
            activity: "idle",
            message: "The calendar action was cancelled before it started.",
          },
        });
        return;
      }
      if (isServerShuttingDownError(error)) {
        persistCalendarMeetingStage(storage, account, previousStage);
        setSignedInPatch(account, {
          calendarMeeting: {
            stage: previousStage,
            activity: "idle",
            message: withApiSupportReference(error.message, error),
          },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? withApiSupportReference(error.message, error)
          : "The calendar change was not confirmed. Do not repeat it.";
      persistCalendarMeetingStage(storage, account, attemptedStage);
      setSignedInPatch(account, {
        calendarMeeting: {
          stage: attemptedStage,
          activity: "idle",
          message,
        },
      });
    }
  };

  const runContactProofAction = async (
    action: "create" | "remove",
  ): Promise<void> => {
    const connectedApi = api;
    if (
      !connectedApi ||
      state.kind !== "signed-in" ||
      isApiOperationBusy(state, contactProof) ||
      !isAllowedContactAction(contactProof.stage, action)
    ) {
      return;
    }
    const account = state.account;
    const previousStage = contactProof.stage;
    setContactProof({
      stage: previousStage,
      activity: action === "create" ? "creating" : "removing",
    });
    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      setContactProof({
        stage: "uncertain",
        activity: action === "create" ? "creating" : "removing",
      }, account);
      const result =
        action === "create"
          ? await connectedApi.createContactProof(accessToken)
          : await connectedApi.removeContactProof(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        setContactProof({ stage: result.state, activity: "idle" }, account);
      }
    } catch (error) {
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      const cancelled = error instanceof AccessTokenCancelledError;
      const serverShuttingDown = isServerShuttingDownError(error);
      setContactProof({
        stage: cancelled || serverShuttingDown
          ? previousStage
          : "uncertain",
        activity: "idle",
        message: cancelled
          ? "The contact action was cancelled before it started."
          : error instanceof AccessTokenError || error instanceof ApiAccessError
            ? withApiSupportReference(error.message, error)
            : "The contact change was not confirmed. Remove it explicitly; do not create again.",
      }, cancelled ? undefined : account);
    }
  };

  const runFixedProofAction = async (
    proof: FixedProofId,
    action: "create" | "remove",
  ): Promise<void> => {
    const connectedApi = api;
    const definition = FIXED_PROOF_BY_ID[proof];
    if (
      !connectedApi ||
      state.kind !== "signed-in" ||
      isApiOperationBusy(state, contactProof) ||
      !isAllowedFixedProofAction(state.fixedProofs[proof].stage, action)
    ) {
      return;
    }
    const account = state.account;
    const previousStage = state.fixedProofs[proof].stage;
    const attemptedStage =
      action === "create" ? "uncertain" : "removal-uncertain";
    const activity = action === "create" ? "creating" : "removing";
    setSignedInPatch(account, {
      fixedProofs: {
        ...state.fixedProofs,
        [proof]: { stage: previousStage, activity },
      },
    });
    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      persistFixedProofStage(
        storage,
        fixedProofStorageKey(account, definition),
        attemptedStage,
      );
      setSignedInPatch(account, {
        fixedProofs: {
          ...state.fixedProofs,
          [proof]: { stage: attemptedStage, activity },
        },
      });
      const result = await definition[action](connectedApi, accessToken);
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      persistFixedProofStage(
        storage,
        fixedProofStorageKey(account, definition),
        result.state,
      );
      setSignedInPatch(account, {
        fixedProofs: {
          ...state.fixedProofs,
          [proof]: { stage: result.state, activity: "idle" },
        },
      });
    } catch (error) {
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      const cancelled = error instanceof AccessTokenCancelledError;
      const serverShuttingDown = isServerShuttingDownError(error);
      const failureStage = cancelled || serverShuttingDown
        ? previousStage
        : attemptedStage;
      if (!cancelled) {
        persistFixedProofStage(
          storage,
          fixedProofStorageKey(account, definition),
          failureStage,
        );
      }
      setSignedInPatch(account, {
        fixedProofs: {
          ...state.fixedProofs,
          [proof]: {
            stage: failureStage,
            activity: "idle",
            message: cancelled
              ? `The ${definition.label} action was cancelled before it started.`
              : error instanceof AccessTokenError ||
                  error instanceof ApiAccessError
                ? withApiSupportReference(error.message, error)
                : `The ${definition.label} change was not confirmed. Do not repeat it.`,
          },
        },
      });
    }
  };

  const render = (): void => {
    root.replaceChildren(createShell(state, contactProof));
    root
      .querySelector<HTMLButtonElement>("[data-action='sign-in']")
      ?.addEventListener("click", () => void signIn());
    root
      .querySelector<HTMLButtonElement>("[data-action='sign-out']")
      ?.addEventListener("click", () => void signOut());
    root
      .querySelector<HTMLButtonElement>("[data-action='send-simulated-email']")
      ?.addEventListener("click", () => void sendSimulatedEmail());
    root
      .querySelector<HTMLButtonElement>("[data-action='send-help-desk-scenario']")
      ?.addEventListener("click", () => void sendHelpDeskScenario());
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
    root
      .querySelector<HTMLButtonElement>("[data-action='create-contact-proof']")
      ?.addEventListener("click", () => void runContactProofAction("create"));
    root
      .querySelector<HTMLButtonElement>("[data-action='remove-contact-proof']")
      ?.addEventListener("click", () => void runContactProofAction("remove"));
    bindFixedProofActions(root, (proof, action) => {
      void runFixedProofAction(proof, action);
    });
  };

  const start = async (): Promise<void> => {
    setState({
      kind: "processing",
      message: "Completing Microsoft sign-in…",
    });
    try {
      const startup = await authentication.initialize();
      let apiConnection: ApiConnection | undefined;
      if (startup.kind === "signed-in") {
        contactProof = {
          stage: readContactStage(storage, startup.account),
          activity: "idle",
        };
        try {
          api = resolveApi
            ? await resolveApi(startup.account)
            : fixedApi;
          apiConnection = { kind: "connected" };
        } catch {
          api = undefined;
          apiConnection = {
            kind: "unavailable",
            message:
              "This tenant does not have a usable AP2 API connection. Actions are unavailable.",
          };
        }
      }
      setState(
        startup.kind === "signed-in"
          ? {
              kind: "signed-in",
              account: startup.account,
              simulatedEmail: { kind: "idle" },
              helpDeskScenario: { kind: "idle" },
              oneDriveProof: {
                stage: readOneDriveStage(storage, startup.account),
                activity: "idle",
              },
              calendarMeeting: {
                stage: readCalendarMeetingStage(storage, startup.account),
                activity: "idle",
              },
              fixedProofs: readFixedProofStates(storage, startup.account),
              apiConnection: apiConnection!,
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

function createShell(
  state: ViewState,
  contactProof: ContactProofState,
): HTMLElement {
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
    "Browse what AP2 can do and what it has already demonstrated. Sign in only when you want to use one of the available actions.";
  shell.append(
    introduction,
    createAuthenticationPanel(state),
    createCapabilitiesSection(state, contactProof),
    createOtherProvenSection(),
    createProvenScenariosSection(),
  );

  return shell;
}

function createAuthenticationPanel(state: ViewState): HTMLElement {
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
      panel.append(
        createStatus(`Signed in as ${state.account.name}`),
        createIdentityList(state.account),
        createStatus(
          state.apiConnection.kind === "connected"
            ? "Connected to this tenant's AP2 API."
            : state.apiConnection.message,
          state.apiConnection.kind === "connected" ? "notice" : "error",
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

function createCapabilitiesSection(
  state: ViewState,
  contactProof: ContactProofState,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "notebook-section";
  section.dataset.surface = "capabilities";
  const heading = document.createElement("h2");
  heading.textContent = "Capabilities";
  section.append(
    heading,
    createStatus(
      "These actions make the specific Microsoft 365 change described beside each button. Sign in to enable them, and review the stated effect before continuing.",
      "notice",
    ),
  );

  const signedIn = state.kind === "signed-in" ? state : undefined;
  const actionsDisabled = signedIn === undefined ||
    signedIn.apiConnection.kind !== "connected" ||
    isApiOperationBusy(signedIn, contactProof);
  const fixedProofs = signedIn?.fixedProofs ?? emptyFixedProofStates();

  section.append(
    createCapabilityGroup("Outlook", [
      createCapabilityItem(
        "Send an email from Homer to Marge.",
        createSimulatedEmailPanel(
          signedIn?.simulatedEmail ?? { kind: "idle" },
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Send a help-desk email from Kobe to Cory.",
        createHelpDeskScenarioPanel(
          signedIn?.helpDeskScenario ?? { kind: "idle" },
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Create and remove a contact in Cory's account.",
        createContactProofPanel(
          signedIn === undefined
            ? { stage: "not-started", activity: "idle" }
            : contactProof,
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Create and remove a disabled Inbox rule in Cory's account.",
        createFixedProofPanel(
          FIXED_PROOF_BY_ID.inboxRuleProof,
          fixedProofs.inboxRuleProof,
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Create and remove an Outlook category in Cory's account.",
        createFixedProofPanel(
          FIXED_PROOF_BY_ID.categoryProof,
          fixedProofs.categoryProof,
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Create and remove an unsent draft in Cory's account.",
        createFixedProofPanel(
          FIXED_PROOF_BY_ID.draftProof,
          fixedProofs.draftProof,
          actionsDisabled,
        ),
      ),
    ]),
    createCapabilityGroup("Calendar and tasks", [
      createCapabilityItem(
        "Create and cancel a meeting from Cory to Kobe and Marge.",
        createCalendarMeetingPanel(
          signedIn?.calendarMeeting ?? {
            stage: "not-started",
            activity: "idle",
          },
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Create and remove a Microsoft To Do task in Cory's account.",
        createFixedProofPanel(
          FIXED_PROOF_BY_ID.todoTaskProof,
          fixedProofs.todoTaskProof,
          actionsDisabled,
        ),
      ),
    ]),
    createCapabilityGroup("Files", [
      createCapabilityItem(
        "Create a OneDrive file as Homer, share it read-only with Marge, and remove it.",
        createOneDriveProofPanel(
          signedIn?.oneDriveProof ?? {
            stage: "not-started",
            activity: "idle",
          },
          actionsDisabled,
        ),
      ),
      createCapabilityItem(
        "Create and remove a SharePoint file.",
        createFixedProofPanel(
          FIXED_PROOF_BY_ID.sharePointFileProof,
          fixedProofs.sharePointFileProof,
          actionsDisabled,
        ),
      ),
    ]),
  );
  return section;
}

function emptyFixedProofStates(): FixedProofStates {
  return {
    inboxRuleProof: { stage: "not-started", activity: "idle" },
    categoryProof: { stage: "not-started", activity: "idle" },
    sharePointFileProof: { stage: "not-started", activity: "idle" },
    draftProof: { stage: "not-started", activity: "idle" },
    todoTaskProof: { stage: "not-started", activity: "idle" },
  };
}

function createCapabilityGroup(
  title: string,
  items: readonly HTMLElement[],
): HTMLElement {
  const section = document.createElement("section");
  section.className = "capability-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "capability-items";
  list.append(...items);
  section.append(heading, list);
  return section;
}

function createCapabilityItem(
  description: string,
  controls: HTMLElement,
): HTMLElement {
  const item = document.createElement("article");
  item.className = "capability-item";
  const summary = document.createElement("p");
  summary.className = "capability-description";
  summary.textContent = description;
  item.append(summary, controls);
  return item;
}

function createOtherProvenSection(): HTMLElement {
  return createStaticListSection("Other things AP2 has proven", "other-proven", [
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
  ]);
}

function createProvenScenariosSection(): HTMLElement {
  return createStaticListSection("Proven scenarios", "proven-scenarios", [
    "SharePoint document tampering and recovery: Create a document, change its contents, observe versions and audit evidence, restore the original, and clean it up.",
    "Inbox-rule persistence and effect: Create an enabled rule, send a matching email, and observe that the rule marked the message as read.",
    "Dormant OAuth application remediation: Create an inert application with a temporary credential, discover it through inventory, remove it, and confirm its absence.",
    "Defender email-attachment prevention: Send Microsoft's EICAR test attachment and observe Defender block and quarantine it through message trace and security evidence.",
    "Teams group-chat membership remediation: Create a group chat, add an unexpected participant, post a warning message, and have Cory remove that participant.",
    "Fake verification click through Win+R: Click Verify in guest Edge, paste the harmless command into Run, display Hello World, and observe the Defender alert.",
  ]);
}

function createStaticListSection(
  title: string,
  surface: string,
  items: readonly string[],
): HTMLElement {
  const section = document.createElement("section");
  section.className = "notebook-section";
  section.dataset.surface = surface;
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("ul");
  list.className = "notebook-list";
  for (const text of items) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function isServerShuttingDownError(
  error: unknown,
): error is ApiAccessError {
  return error instanceof ApiAccessError &&
    error.category === "server-shutting-down";
}

function createSimulatedEmailPanel(
  state: SimulatedEmailState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";

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

function createHelpDeskScenarioPanel(
  state: HelpDeskScenarioState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";

  if (state.kind === "loading") {
    panel.setAttribute("aria-busy", "true");
    panel.append(createStatus("Submitting the help desk email once…"));
  } else if (state.kind === "success") {
    panel.append(
      createStatus(
        "Microsoft accepted the email request (202). Delivery is not confirmed.",
      ),
      createHelpDeskScenarioResultList(state.result),
    );
  } else if (state.kind === "cancelled") {
    panel.append(
      createStatus(
        "The help desk email request was cancelled. No acceptance was recorded.",
        "notice",
      ),
    );
  } else if (
    state.kind === "error" ||
    state.kind === "server-shutting-down"
  ) {
    panel.append(createStatus(state.message, "error"));
  }

  panel.append(
    createButton(
      "Create one help desk email: Kobe → Cory",
      "send-help-desk-scenario",
      "primary",
      apiOperationLoading ||
        !["idle", "server-shutting-down"].includes(state.kind),
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

  if (state.activity !== "idle") {
    panel.setAttribute("aria-busy", "true");
    panel.append(
      createStatus(
        state.activity === "sharing"
          ? "Creating and sharing the fixed OneDrive file…"
          : "Validating and removing the fixed OneDrive file…",
      ),
    );
  } else {
    const message =
      state.stage === "not-started"
        ? "OneDrive file: not started in this browser."
        : state.stage === "configured"
          ? "OneDrive file: Microsoft accepted Marge's read permission and the request to send a sharing invitation. Email delivery and opening are not yet confirmed."
            : state.stage === "removed"
              ? "OneDrive file: removed to Homer's recycle bin."
              : "OneDrive file: the last change outcome is uncertain. Do not share again; remove it explicitly.";
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
      "Create and share OneDrive file",
      "share-onedrive-proof",
      "primary",
      apiOperationLoading ||
        (state.stage !== "not-started" && state.stage !== "removed"),
    ),
    createButton(
      "Remove OneDrive file",
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
  panel.append(createCalendarMeetingDetails());

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
        ? "Calendar meeting: not started in this browser."
        : state.stage === "configured"
          ? "Calendar meeting: configured. Microsoft accepted the meeting and invitations; attendee receipt or response is not confirmed."
          : state.stage === "cancellation-accepted"
            ? "Calendar meeting: cancellation accepted. Attendee receipt is not confirmed."
            : state.stage === "cancellation-uncertain"
              ? "Calendar meeting: cancellation is uncertain. Do not repeat it."
              : "Calendar meeting: creation is uncertain. Do not create again; Cancel can explicitly find and cancel one exact matching meeting.";
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
  appendIdentity(
    list,
    "Invitation content",
    "The fixed AP2 subject identifies a calendar test and says no action is required. The fixed harmless body says no action or response is required and says the organizer will cancel the meeting after observation.",
  );
  appendIdentity(
    list,
    "Time",
    `${CALENDAR_MEETING_START} to ${CALENDAR_MEETING_END} (3:00–3:15 PM EDT)`,
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
    `In a separate browser or profile, sign in to Outlook as ${installation.actors.marge.userPrincipalName}.`,
    "Open the Microsoft sharing invitation for AP2-OneDrive-share-proof.txt, then use its Open link.",
    "Do not treat an empty OneDrive Shared view as confirmation that access is absent.",
    "Return here and click Remove OneDrive file when finished.",
  ]) {
    const item = document.createElement("li");
    item.textContent = instruction;
    list.append(item);
  }
  return list;
}

function createContactProofPanel(
  state: ContactProofState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";
  const message =
    state.activity === "creating"
      ? "Creating the fixed contact…"
      : state.activity === "removing"
        ? "Removing the fixed contact…"
        : state.stage === "configured"
          ? "Contact: configured."
          : state.stage === "removed"
            ? "Contact: removed."
            : state.stage === "uncertain"
              ? "Contact: the last change is uncertain. Do not create again; Remove can reconcile it safely."
              : "Contact: not started in this browser.";
  if (state.activity !== "idle") {
    panel.setAttribute("aria-busy", "true");
  }
  panel.append(createStatus(message));
  if (state.message) {
    panel.append(createStatus(state.message, "error"));
  }
  const details = document.createElement("dl");
  details.className = "identity-list";
  appendIdentity(details, "Owner", installation.actors.cory.userPrincipalName);
  appendIdentity(details, "Display name", CONTACT_PROOF_DISPLAY_NAME);
  appendIdentity(details, "Email", CONTACT_PROOF_EMAIL);
  appendIdentity(details, "Other details", "None");
  panel.append(
    details,
    createButton(
      "Create contact",
      "create-contact-proof",
      "primary",
      apiOperationLoading || state.stage !== "not-started",
    ),
    createButton(
      "Remove contact",
      "remove-contact-proof",
      "secondary",
      apiOperationLoading ||
        !["configured", "uncertain"].includes(state.stage),
    ),
  );
  return panel;
}

function createIdentityList(account: AccountIdentity): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";

  appendIdentity(list, "Account", account.username);

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

function createHelpDeskScenarioResultList(
  result: HelpDeskScenarioResult,
): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";
  appendIdentity(list, "Artifact", "Outlook email");
  appendIdentity(list, "Sender", result.sender);
  appendIdentity(list, "Recipient", result.recipient);
  appendIdentity(list, "Subject", result.subject);
  appendIdentity(list, "Platform claim", "Email only");
  return list;
}

function isCurrentSignedInAccount(
  state: ViewState,
  account: AccountIdentity,
): state is Extract<ViewState, { kind: "signed-in" }> {
  return state.kind === "signed-in" && state.account.accountId === account.accountId;
}

function isApiOperationBusy(
  state: SignedInState,
  contactProof: ContactProofState,
): boolean {
  return (
    state.simulatedEmail.kind === "loading" ||
    state.helpDeskScenario.kind === "loading" ||
    state.oneDriveProof.activity !== "idle" ||
    state.calendarMeeting.activity !== "idle" ||
    hasBusyFixedProof(state.fixedProofs) ||
    contactProof.activity !== "idle"
  );
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
  return `ap2.calendar-meeting.${CALENDAR_MEETING_RUN_ID}.${account.tenantId}.${account.accountId}`;
}

function contactStorageKey(account: AccountIdentity): string {
  return `ap2.contact-proof.${CONTACT_PROOF_RUN_ID}.${account.tenantId}.${account.accountId}`;
}

function readContactStage(
  storage: Pick<Storage, "getItem">,
  account: AccountIdentity,
): ContactProofState["stage"] {
  const value = storage.getItem(contactStorageKey(account));
  return value === "uncertain" || value === "configured" || value === "removed"
    ? value
    : "not-started";
}

function isAllowedContactAction(
  stage: ContactProofState["stage"],
  action: "create" | "remove",
): boolean {
  return action === "create"
    ? stage === "not-started"
    : stage === "configured" || stage === "uncertain";
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
