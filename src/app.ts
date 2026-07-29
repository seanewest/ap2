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
  BatchFeasibilityClientError,
  CALENDAR_MEETING_ATTENDEES,
  CALENDAR_MEETING_END,
  CALENDAR_MEETING_ORGANIZER,
  CALENDAR_MEETING_RUN_ID,
  CALENDAR_MEETING_START,
  CALENDAR_MEETING_SUBJECT,
  CONTACT_PROOF_DISPLAY_NAME,
  CONTACT_PROOF_EMAIL,
  CONTACT_PROOF_RUN_ID,
  HelpDeskEmailRehearsalVerificationClientError,
  OneDriveInviteFailureError,
  PrivateDocumentRehearsalVerificationClientError,
  RehearsalOutputVerificationClientError,
  ScenarioEvidenceVerificationClientError,
  ScenarioPlanClientError,
  TeamsMissedCallRehearsalVerificationClientError,
  type AfterPartyApi,
  type ApiCallerIdentity,
  type CalendarMeetingResult,
  type HelpDeskScenarioResult,
  type OneDriveInviteFailure,
  type OneDriveProofResult,
  type RecentOperationEvents,
  type RehearsalStatus,
  type SimulatedEmailResult,
} from "./api/client";
import { API_ACCESS_SCOPES } from "./api/config";
import {
  isBoundedRehearsalOutputRequest,
} from "./api/rehearsal-output-verification-contract";
import {
  isBoundedPrivateDocumentRehearsalRequest,
} from "./api/private-document-rehearsal-verification-contract";
import {
  isBoundedHelpDeskEmailRehearsalRequest,
} from "./api/help-desk-email-rehearsal-verification-contract";
import {
  isBoundedTeamsMissedCallRehearsalRequest,
} from "./api/teams-missed-call-rehearsal-verification-contract";
import {
  FIXED_PROOF_BY_ID,
  bindFixedProofActions,
  createFixedProofPanels,
  fixedProofStorageKey,
  hasBusyFixedProof,
  isAllowedFixedProofAction,
  persistFixedProofStage,
  readFixedProofStates,
  type FixedProofId,
  type FixedProofStates,
} from "./operations/fixed-proofs";
import {
  createRecentOperationsPanel,
  type RecentOperationsState,
} from "./operations/recent-operations";
import {
  appendIdentity,
  createButton,
  createStatus,
} from "./ui/elements";
import { createScenarioCatalog } from "./scenarios/scenario-catalog";
import {
  createScenarioSurfaceMatrix,
} from "./scenarios/scenario-surface-matrix";
import {
  createBatchFeasibilityPanel,
  type BatchFeasibilityPanelClient,
  type BatchFeasibilityPanelFailure,
} from "./scenarios/batch-feasibility-panel";
import {
  createAvdRehearsalVerificationPanel,
  type AvdRehearsalVerificationFailure,
  type AvdRehearsalVerificationPanelClient,
} from "./scenarios/avd-rehearsal-verification-panel";
import {
  createPrivateDocumentRehearsalVerificationPanel,
  type PrivateDocumentRehearsalPanelClient,
  type PrivateDocumentRehearsalPanelFailure,
} from "./scenarios/private-document-rehearsal-verification-panel";
import {
  createHelpDeskRehearsalVerificationPanel,
  type HelpDeskRehearsalPanelClient,
  type HelpDeskRehearsalPanelFailure,
} from "./scenarios/help-desk-rehearsal-verification-panel";
import {
  createTeamsRehearsalVerificationPanel,
  type TeamsRehearsalPanelClient,
  type TeamsRehearsalPanelFailure,
} from "./scenarios/teams-rehearsal-verification-panel";
import {
  createScenarioEvidenceVerificationPanel,
  type ScenarioEvidenceVerificationFailure,
  type ScenarioEvidenceVerificationPanelClient,
} from "./scenarios/scenario-evidence-verification-panel";
import {
  createScenarioPlanPreviewController,
  type ScenarioPlanPreviewClient,
  type ScenarioPlanPreviewFailure,
} from "./scenarios/scenario-plan-preview";
import { SCENARIO_MANIFESTS } from "./scenarios/scenarios";

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

type HelpDeskScenarioState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: HelpDeskScenarioResult }
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

type ContactProofState = {
  stage: "not-started" | "uncertain" | "configured" | "removed";
  activity: "idle" | "creating" | "removing";
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
      recentOperations: RecentOperationsState;
      rehearsalStatus: RehearsalStatusState;
      simulatedEmail: SimulatedEmailState;
      helpDeskScenario: HelpDeskScenarioState;
      oneDriveProof: OneDriveProofState;
      calendarMeeting: CalendarMeetingState;
      fixedProofs: FixedProofStates;
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
  api: AfterPartyApi,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): AfterPartyApp {
  let state: ViewState = { kind: "initial" };
  const scenarioPlanPreviewClient: ScenarioPlanPreviewClient = {
    preview: async (request) => {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      return await api.compileScenarioPlan(accessToken, request);
    },
    classifyError: classifyScenarioPlanPreviewFailure,
  };
  const scenarioEvidenceVerificationClient:
    ScenarioEvidenceVerificationPanelClient = {
      verify: async (receipt) => {
        const accessToken =
          await authentication.acquireAccessToken(API_ACCESS_SCOPES);
        return await api.verifyScenarioEvidenceReceipt(accessToken, receipt);
      },
      classifyError: classifyScenarioEvidenceVerificationFailure,
    };
  const avdRehearsalVerificationClient:
    AvdRehearsalVerificationPanelClient = {
      parse: (value) =>
        isBoundedRehearsalOutputRequest(value) ? value : undefined,
      verify: async (output) => {
        const accessToken =
          await authentication.acquireAccessToken(API_ACCESS_SCOPES);
        return await api.verifyRehearsalOutput(accessToken, output);
      },
      classifyError: classifyAvdRehearsalVerificationFailure,
    };
  const privateDocumentRehearsalVerificationClient:
    PrivateDocumentRehearsalPanelClient = {
      parse: (value) =>
        isBoundedPrivateDocumentRehearsalRequest(value) ? value : undefined,
      verify: async (output) => {
        const accessToken =
          await authentication.acquireAccessToken(API_ACCESS_SCOPES);
        return await api.verifyPrivateDocumentRehearsalOutput(
          accessToken,
          output,
        );
      },
      classifyError: classifyPrivateDocumentRehearsalFailure,
    };
  const helpDeskRehearsalVerificationClient:
    HelpDeskRehearsalPanelClient = {
      parse: (value) =>
        isBoundedHelpDeskEmailRehearsalRequest(value) ? value : undefined,
      verify: async (output) => {
        const accessToken =
          await authentication.acquireAccessToken(API_ACCESS_SCOPES);
        return await api.verifyHelpDeskEmailRehearsalOutput(
          accessToken,
          output,
        );
      },
      classifyError: classifyHelpDeskRehearsalFailure,
    };
  const teamsRehearsalVerificationClient: TeamsRehearsalPanelClient = {
    parse: (value) =>
      isBoundedTeamsMissedCallRehearsalRequest(value) ? value : undefined,
    verify: async (output) => {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      if (!api.verifyTeamsMissedCallRehearsalOutput) {
        throw new TeamsMissedCallRehearsalVerificationClientError(
          "safe-failure",
        );
      }
      return await api.verifyTeamsMissedCallRehearsalOutput(
        accessToken,
        output,
      );
    },
    classifyError: classifyTeamsRehearsalFailure,
  };
  const batchFeasibilityClient: BatchFeasibilityPanelClient = {
    evaluate: async (request) => {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      return await api.calculateMultiScenarioFeasibility(
        accessToken,
        request,
      );
    },
    classifyError: classifyBatchFeasibilityFailure,
  };
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
      isApiOperationBusy(state, contactProof)
    ) {
      return;
    }
    const account = state.account;
    setSignedInPatch(account, {
      apiAccess: { kind: "loading" },
    });

    try {
      const accessToken = await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const caller = await api.checkAccess(accessToken);
      setSignedInPatch(account, {
        apiAccess: { kind: "success", caller },
      });
    } catch (error) {
      if (error instanceof AccessTokenCancelledError) {
        setSignedInPatch(account, {
          apiAccess: { kind: "cancelled" },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : "API access could not be checked. Try again.";
      setSignedInPatch(account, {
        apiAccess: { kind: "error", message },
      });
    }
  };

  const checkRehearsalStatus = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      isApiOperationBusy(state, contactProof)
    ) {
      return;
    }
    const account = state.account;
    setSignedInPatch(account, {
      rehearsalStatus: { kind: "loading" },
    });

    try {
      const accessToken = await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const status = await api.getRehearsalStatus(accessToken);
      setSignedInPatch(account, {
        rehearsalStatus: { kind: "success", status },
      });
    } catch (error) {
      if (error instanceof AccessTokenCancelledError) {
        setSignedInPatch(account, {
          rehearsalStatus: { kind: "cancelled" },
        });
        return;
      }
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : "Rehearsal status could not be checked. Try again.";
      setSignedInPatch(account, {
        rehearsalStatus: { kind: "error", message },
      });
    }
  };

  const refreshRecentOperations = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      isApiOperationBusy(state, contactProof)
    ) {
      return;
    }
    const account = state.account;
    setSignedInPatch(account, {
      recentOperations: { kind: "loading" },
    });

    try {
      const accessToken =
        await authentication.acquireAccessToken(API_ACCESS_SCOPES);
      const getRecentOperationEvents = api.getRecentOperationEvents;
      if (!getRecentOperationEvents) {
        throw new Error("Recent operations client is not configured.");
      }
      const snapshot: RecentOperationEvents =
        await getRecentOperationEvents.call(api, accessToken, "newest");
      setSignedInPatch(account, {
        recentOperations: { kind: "success", snapshot },
      });
    } catch (error) {
      if (error instanceof AccessTokenCancelledError) {
        setSignedInPatch(account, {
          recentOperations: { kind: "cancelled" },
        });
        return;
      }
      const unauthorized =
        error instanceof AccessTokenError ||
        (
          error instanceof ApiAccessError &&
          (
            error.message ===
              "API access needs Microsoft authorization. Try again." ||
            error.message === "This account is not allowed to use the API."
          )
        );
      setSignedInPatch(account, {
        recentOperations: {
          kind: unauthorized ? "unauthorized" : "error",
        },
      });
    }
  };

  const sendSimulatedEmail = async (): Promise<void> => {
    if (
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
      const result = await api.sendSimulatedEmail(accessToken);
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
          ? error.message
          : "The internal email could not be submitted. Try again.";
      setSignedInPatch(account, {
        simulatedEmail: { kind: "error", message },
      });
    }
  };

  const sendHelpDeskScenario = async (): Promise<void> => {
    if (
      state.kind !== "signed-in" ||
      state.helpDeskScenario.kind !== "idle" ||
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
      const result = await api.sendHelpDeskScenario(accessToken);
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
          ? error.message
          : "The help desk email was not confirmed. Do not repeat it.";
      setSignedInPatch(account, {
        helpDeskScenario: { kind: "error", message },
      });
    }
  };

  const runOneDriveProofAction = async (
    action: "share" | "remove",
  ): Promise<void> => {
    if (
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
          ? await api.shareOneDriveProof(accessToken)
          : await api.removeOneDriveProof(accessToken);
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
            message: error.message,
            inviteFailure: error.diagnostic,
          },
        });
        return;
      }
      const fallback =
        "The OneDrive change was not confirmed. Do not repeat sharing; clean up explicitly.";
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
          : fallback;
      setSignedInPatch(account, {
        oneDriveProof: { stage: "uncertain", activity: "idle", message },
      });
    }
  };

  const runCalendarMeetingAction = async (
    action: "create" | "cancel",
  ): Promise<void> => {
    if (
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
          ? await api.createCalendarMeeting(accessToken)
          : await api.cancelCalendarMeeting(accessToken);
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
      const message =
        error instanceof AccessTokenError || error instanceof ApiAccessError
          ? error.message
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
    if (
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
          ? await api.createContactProof(accessToken)
          : await api.removeContactProof(accessToken);
      if (isCurrentSignedInAccount(state, account)) {
        setContactProof({ stage: result.state, activity: "idle" }, account);
      }
    } catch (error) {
      if (!isCurrentSignedInAccount(state, account)) {
        return;
      }
      const cancelled = error instanceof AccessTokenCancelledError;
      setContactProof({
        stage: cancelled ? previousStage : "uncertain",
        activity: "idle",
        message: cancelled
          ? "The contact action was cancelled before it started."
          : error instanceof AccessTokenError || error instanceof ApiAccessError
            ? error.message
            : "The contact change was not confirmed. Remove it explicitly; do not create again.",
      }, cancelled ? undefined : account);
    }
  };

  const runFixedProofAction = async (
    proof: FixedProofId,
    action: "create" | "remove",
  ): Promise<void> => {
    const definition = FIXED_PROOF_BY_ID[proof];
    if (
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
      const result = await definition[action](api, accessToken);
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
      const failureStage = cancelled ? previousStage : attemptedStage;
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
                ? error.message
                : `The ${definition.label} change was not confirmed. Do not repeat it.`,
          },
        },
      });
    }
  };

  const render = (): void => {
    root.replaceChildren(
      createShell(
        state,
        contactProof,
        scenarioPlanPreviewClient,
        scenarioEvidenceVerificationClient,
        avdRehearsalVerificationClient,
        privateDocumentRehearsalVerificationClient,
        helpDeskRehearsalVerificationClient,
        teamsRehearsalVerificationClient,
        batchFeasibilityClient,
      ),
    );
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
      .querySelector<HTMLButtonElement>(
        "[data-action='refresh-recent-operations']",
      )
      ?.addEventListener("click", () => void refreshRecentOperations());
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
      if (startup.kind === "signed-in") {
        contactProof = {
          stage: readContactStage(storage, startup.account),
          activity: "idle",
        };
      }
      setState(
        startup.kind === "signed-in"
          ? {
              kind: "signed-in",
              account: startup.account,
              apiAccess: { kind: "idle" },
              recentOperations: { kind: "idle" },
              rehearsalStatus: { kind: "idle" },
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
  scenarioPlanPreviewClient: ScenarioPlanPreviewClient,
  scenarioEvidenceVerificationClient: ScenarioEvidenceVerificationPanelClient,
  avdRehearsalVerificationClient: AvdRehearsalVerificationPanelClient,
  privateDocumentRehearsalVerificationClient:
    PrivateDocumentRehearsalPanelClient,
  helpDeskRehearsalVerificationClient: HelpDeskRehearsalPanelClient,
  teamsRehearsalVerificationClient: TeamsRehearsalPanelClient,
  batchFeasibilityClient: BatchFeasibilityPanelClient,
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
    "Sign in with your Microsoft work or school account to continue.";
  shell.append(
    introduction,
    createStatePanel(
      state,
      contactProof,
      scenarioPlanPreviewClient,
      scenarioEvidenceVerificationClient,
      avdRehearsalVerificationClient,
      privateDocumentRehearsalVerificationClient,
      helpDeskRehearsalVerificationClient,
      teamsRehearsalVerificationClient,
      batchFeasibilityClient,
    ),
  );

  return shell;
}

function createStatePanel(
  state: ViewState,
  contactProof: ContactProofState,
  scenarioPlanPreviewClient: ScenarioPlanPreviewClient,
  scenarioEvidenceVerificationClient: ScenarioEvidenceVerificationPanelClient,
  avdRehearsalVerificationClient: AvdRehearsalVerificationPanelClient,
  privateDocumentRehearsalVerificationClient:
    PrivateDocumentRehearsalPanelClient,
  helpDeskRehearsalVerificationClient: HelpDeskRehearsalPanelClient,
  teamsRehearsalVerificationClient: TeamsRehearsalPanelClient,
  batchFeasibilityClient: BatchFeasibilityPanelClient,
): HTMLElement {
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
      const apiOperationLoading = isApiOperationBusy(state, contactProof);
      panel.append(
        createStatus(`Signed in as ${state.account.name}`),
        createIdentityList(state.account),
        createApiAccessPanel(state.apiAccess, apiOperationLoading),
        createRecentOperationsPanel(
          state.recentOperations,
          apiOperationLoading,
        ),
        createRehearsalStatusPanel(
          state.rehearsalStatus,
          apiOperationLoading,
        ),
        createSimulatedEmailPanel(
          state.simulatedEmail,
          apiOperationLoading,
        ),
        createHelpDeskScenarioPanel(
          state.helpDeskScenario,
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
        createContactProofPanel(contactProof, apiOperationLoading),
        ...createFixedProofPanels(state.fixedProofs, apiOperationLoading),
        ...createScenarioPlanningFlow(scenarioPlanPreviewClient),
        createScenarioSurfaceMatrix(),
        createBatchFeasibilityPanel({
          registry: SCENARIO_MANIFESTS,
          client: batchFeasibilityClient,
        }),
        createScenarioEvidenceVerificationPanel({
          client: scenarioEvidenceVerificationClient,
        }),
        createAvdRehearsalVerificationPanel({
          client: avdRehearsalVerificationClient,
        }),
        createPrivateDocumentRehearsalVerificationPanel({
          client: privateDocumentRehearsalVerificationClient,
        }),
        createHelpDeskRehearsalVerificationPanel({
          client: helpDeskRehearsalVerificationClient,
        }),
        createTeamsRehearsalVerificationPanel({
          client: teamsRehearsalVerificationClient,
        }),
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

function createScenarioPlanningFlow(
  client: ScenarioPlanPreviewClient,
): HTMLElement[] {
  const preview = createScenarioPlanPreviewController({
    registry: SCENARIO_MANIFESTS,
    client,
  });
  const catalog = createScenarioCatalog(SCENARIO_MANIFESTS, {
    onPlanPreview: (selection) => {
      preview.selectScenario(selection);
    },
  });
  return [catalog, preview.element];
}

function classifyScenarioPlanPreviewFailure(
  error: unknown,
): ScenarioPlanPreviewFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (!(error instanceof ScenarioPlanClientError)) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "compiler-refused";
    case "request-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
}

function classifyScenarioEvidenceVerificationFailure(
  error: unknown,
): ScenarioEvidenceVerificationFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (!(error instanceof ScenarioEvidenceVerificationClientError)) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "verification-refused";
    case "request-too-large":
      return "request-too-large";
    case "response-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
}

function classifyBatchFeasibilityFailure(
  error: unknown,
): BatchFeasibilityPanelFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (!(error instanceof BatchFeasibilityClientError)) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "planner-refused";
    case "request-too-large":
      return "request-too-large";
    case "response-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
}

function classifyAvdRehearsalVerificationFailure(
  error: unknown,
): AvdRehearsalVerificationFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (!(error instanceof RehearsalOutputVerificationClientError)) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "verification-refused";
    case "request-too-large":
      return "request-too-large";
    case "response-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
}

function classifyPrivateDocumentRehearsalFailure(
  error: unknown,
): PrivateDocumentRehearsalPanelFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (
    !(error instanceof PrivateDocumentRehearsalVerificationClientError)
  ) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "verification-refused";
    case "request-too-large":
      return "request-too-large";
    case "response-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
}

function classifyHelpDeskRehearsalFailure(
  error: unknown,
): HelpDeskRehearsalPanelFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (!(error instanceof HelpDeskEmailRehearsalVerificationClientError)) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "verification-refused";
    case "request-too-large":
      return "request-too-large";
    case "response-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
}

function classifyTeamsRehearsalFailure(
  error: unknown,
): TeamsRehearsalPanelFailure {
  if (error instanceof AccessTokenError) {
    return "session-expired";
  }
  if (!(error instanceof TeamsMissedCallRehearsalVerificationClientError)) {
    return "unavailable";
  }
  switch (error.category) {
    case "unauthorized":
      return "session-expired";
    case "forbidden":
      return "unauthorized";
    case "validation-refused":
      return "verification-refused";
    case "request-too-large":
      return "request-too-large";
    case "response-too-large":
      return "response-too-large";
    case "safe-failure":
      return "unavailable";
  }
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

function createHelpDeskScenarioPanel(
  state: HelpDeskScenarioState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";
  panel.append(
    createStatus(
      "Prepared Outlook email action: one clearly labeled AP2 help desk email from Kobe to Cory. This is not a Teams call, missed call, or voicemail.",
      "notice",
    ),
  );

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
  } else if (state.kind === "error") {
    panel.append(createStatus(state.message, "error"));
  }

  panel.append(
    createButton(
      "Create one help desk email: Kobe → Cory",
      "send-help-desk-scenario",
      "primary",
      apiOperationLoading || state.kind !== "idle",
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

function createContactProofPanel(
  state: ContactProofState,
  apiOperationLoading: boolean,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "api-access";
  panel.append(
    createStatus(
      "Real tenant activity: Cory creates one fixed harmless Outlook contact for Kobe, then explicitly removes it.",
      "notice",
    ),
  );
  const message =
    state.activity === "creating"
      ? "Creating the fixed contact…"
      : state.activity === "removing"
        ? "Removing the fixed contact…"
        : state.stage === "configured"
          ? "Contact rehearsal: Configured."
          : state.stage === "removed"
            ? "Contact rehearsal: Removed."
            : state.stage === "uncertain"
              ? "Contact rehearsal: the last change is uncertain. Do not create again; Remove can reconcile it safely."
              : "Contact rehearsal: not started in this browser.";
  if (state.activity !== "idle") {
    panel.setAttribute("aria-busy", "true");
  }
  panel.append(createStatus(message));
  if (state.message) {
    panel.append(createStatus(state.message, "error"));
  }
  const details = document.createElement("dl");
  details.className = "identity-list";
  appendIdentity(details, "Owner", "cory@corywest.onmicrosoft.com");
  appendIdentity(details, "Display name", CONTACT_PROOF_DISPLAY_NAME);
  appendIdentity(details, "Email", CONTACT_PROOF_EMAIL);
  appendIdentity(details, "Other details", "None");
  panel.append(
    details,
    createButton(
      "Create contact proof",
      "create-contact-proof",
      "primary",
      apiOperationLoading || state.stage !== "not-started",
    ),
    createButton(
      "Remove contact proof",
      "remove-contact-proof",
      "secondary",
      apiOperationLoading ||
        !["configured", "uncertain"].includes(state.stage),
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
    state.apiAccess.kind === "loading" ||
    state.recentOperations.kind === "loading" ||
    state.rehearsalStatus.kind === "loading" ||
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
