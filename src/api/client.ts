import {
  apiRouteContract,
  type ApiRouteOwnerKey,
} from "./api-route-contract.ts";
import {
  SERVER_SHUTTING_DOWN_MESSAGE,
  isExactServerShuttingDown,
} from "./server-shutdown.ts";
import {
  readApiSupportReference,
  type ApiSupportReferencedError,
} from "./support-reference.ts";
import { installation } from "../installation.ts";

export interface ApiCallerIdentity {
  callerType: "delegated" | "app-only";
  tenantId: string;
}

const runningStatuses = [
  "Progressing",
  "Running",
  "Stopped",
  "Suspended",
  "Ready",
] as const;

export interface RehearsalStatus {
  appName: string;
  region: string;
  runningStatus: (typeof runningStatuses)[number];
  latestReadyRevision: string;
}

export const OPERATION_EVENT_ORDERS = ["newest", "oldest"] as const;
export type OperationEventOrder = typeof OPERATION_EVENT_ORDERS[number];
export type OperationEventKind = "calendar.create" | "calendar.cancel";
export type OperationEventPhase = "execution" | "cleanup" | "recovery";
export type OperationEventOutcome =
  | "started"
  | "succeeded"
  | "refused"
  | "ambiguous";
export type OperationEventReason =
  | "none"
  | "precondition-refusal"
  | "upstream-refusal"
  | "upstream-unavailable"
  | "invalid-upstream-shape"
  | "unexpected";
export type OperationEventAmbiguity =
  | "none"
  | "possible-mutation"
  | "unresolved";
export type OperationEventRecovery =
  | "not-applicable"
  | "not-needed"
  | "in-progress"
  | "reconciled"
  | "unresolved";
export interface OperationEvent {
  schemaVersion: 1;
  markerHash: string;
  operationKind: OperationEventKind;
  phase: OperationEventPhase;
  outcome: OperationEventOutcome;
  durationMs: number;
  reason: OperationEventReason;
  ambiguityState: OperationEventAmbiguity;
  recoveryState: OperationEventRecovery;
  upstreamStatus?: number;
}
export interface RecentOperationEvents {
  schemaVersion: 1;
  order: OperationEventOrder;
  events: readonly OperationEvent[];
}

export interface SimulatedEmailResult {
  accepted: true;
  sender: string;
  recipient: string;
  subject: string;
}

export const HELP_DESK_SCENARIO_SENDER =
  installation.actors.kobe.userPrincipalName;
export const HELP_DESK_SCENARIO_RECIPIENT =
  installation.actors.cory.userPrincipalName;
export const HELP_DESK_SCENARIO_SUBJECT =
  "AP2 help desk follow-up [ap2-help-desk-email-20260729-001]";
export interface HelpDeskScenarioResult {
  accepted: true;
  artifact: "outlook-email";
  sender: typeof HELP_DESK_SCENARIO_SENDER;
  recipient: typeof HELP_DESK_SCENARIO_RECIPIENT;
  subject: typeof HELP_DESK_SCENARIO_SUBJECT;
  platformClaims: readonly ["email"];
}

export const CONTACT_PROOF_DISPLAY_NAME = "AP2 Kobe Contact Proof";
export const CONTACT_PROOF_EMAIL = installation.actors.kobe.userPrincipalName;
export const CONTACT_PROOF_RUN_ID = "ap2-contact-20260724-001";
type ConfiguredContact = {
  state: "configured";
  displayName: typeof CONTACT_PROOF_DISPLAY_NAME;
  email: typeof CONTACT_PROOF_EMAIL;
};
type RemovedContact = {
  state: "removed";
  displayName: typeof CONTACT_PROOF_DISPLAY_NAME;
};
export type ContactProofResult = ConfiguredContact | RemovedContact;

export const INBOX_RULE_PROOF_DISPLAY_NAME =
  "AP2 harmless disabled rule — ap2-rule-20260725-001";
export const INBOX_RULE_PROOF_RUN_ID = "ap2-rule-20260725-001";
export const INBOX_RULE_PROOF_SUBJECT =
  "AP2-NEVER-MATCH-ap2-rule-20260725-001";
export type InboxRuleProofResult =
  | {
      state: "configured";
      displayName: typeof INBOX_RULE_PROOF_DISPLAY_NAME;
    }
  | { state: "removed"; displayName: typeof INBOX_RULE_PROOF_DISPLAY_NAME };
export const CATEGORY_PROOF_DISPLAY_NAME =
  "AP2 Category Proof [ap2-category-20260725-001]";
export const CATEGORY_PROOF_RUN_ID = "ap2-category-20260725-001";
export const CATEGORY_PROOF_COLOR = "preset7";
export type CategoryProofResult =
  | { state: "configured"; displayName: typeof CATEGORY_PROOF_DISPLAY_NAME }
  | { state: "removed"; displayName: typeof CATEGORY_PROOF_DISPLAY_NAME };
export const SHAREPOINT_FILE_PROOF_NAME =
  "AP2 SharePoint File Proof [ap2-sharepoint-file-20260725-001].txt";
export const SHAREPOINT_FILE_PROOF_RUN_ID =
  "ap2-sharepoint-file-20260725-001";
export type SharePointFileProofResult =
  | { state: "configured"; name: typeof SHAREPOINT_FILE_PROOF_NAME }
  | { state: "removed"; name: typeof SHAREPOINT_FILE_PROOF_NAME };
export const DRAFT_PROOF_RUN_ID = "ap2-draft-20260725-001";
export const DRAFT_PROOF_SUBJECT =
  "AP2 Pass 3 harmless draft — ap2-draft-20260725-001";
export const DRAFT_PROOF_BODY =
  "Harmless AP2 draft. This message must not be sent.";
export const DRAFT_PROOF_RECIPIENTS = [
  installation.actors.kobe.userPrincipalName,
  installation.actors.marge.userPrincipalName,
] as const;
export type DraftProofResult =
  | { state: "configured"; subject: typeof DRAFT_PROOF_SUBJECT }
  | { state: "removed"; subject: typeof DRAFT_PROOF_SUBJECT };
export const TODO_TASK_PROOF_RUN_ID = "ap2-todo-task-20260725-002";
export const TODO_TASK_PROOF_TITLE =
  "AP2 harmless task [ap2-todo-task-20260725-002]";
export type TodoTaskProofResult =
  | { state: "configured"; title: typeof TODO_TASK_PROOF_TITLE }
  | { state: "removed"; title: typeof TODO_TASK_PROOF_TITLE };

export const CALENDAR_MEETING_ORGANIZER =
  installation.actors.cory.userPrincipalName;
export const CALENDAR_MEETING_ATTENDEES = [
  installation.actors.kobe.userPrincipalName,
  installation.actors.marge.userPrincipalName,
] as const;
export const CALENDAR_MEETING_SUBJECT =
  "AP2 Pass 3 calendar rehearsal — no action required";
export const CALENDAR_MEETING_RUN_ID = "ap2-calendar-20260724-002";
export const CALENDAR_MEETING_START = "2026-07-24T19:00:00Z";
export const CALENDAR_MEETING_END = "2026-07-24T19:15:00Z";

export type CalendarMeetingResult =
  | {
      state: "configured";
      organizer: typeof CALENDAR_MEETING_ORGANIZER;
      attendees: typeof CALENDAR_MEETING_ATTENDEES;
      subject: typeof CALENDAR_MEETING_SUBJECT;
      start: typeof CALENDAR_MEETING_START;
      end: typeof CALENDAR_MEETING_END;
    }
  | {
      state: "cancellation-accepted";
      organizer: typeof CALENDAR_MEETING_ORGANIZER;
      subject: typeof CALENDAR_MEETING_SUBJECT;
    };

export const ONEDRIVE_PROOF_PATH = "/AP2-OneDrive-share-proof.txt";
const ONEDRIVE_PROOF_OWNER =
  installation.actors.homer.userPrincipalName;
const ONEDRIVE_PROOF_RECIPIENT =
  installation.actors.marge.userPrincipalName;

export type OneDriveProofResult =
  | {
      state: "configured";
      path: typeof ONEDRIVE_PROOF_PATH;
      owner: typeof ONEDRIVE_PROOF_OWNER;
      recipient: typeof ONEDRIVE_PROOF_RECIPIENT;
      access: "read";
    }
  | {
      state: "removed";
      path: typeof ONEDRIVE_PROOF_PATH;
    };

export interface OneDriveInviteFailure {
  state: "file-created-sharing-failed";
  stage: "invite" | "invite-reconciliation";
  upstreamStatus: number;
  graphErrorCode?: string;
  requestId?: string;
  clientRequestId: string;
  responseDate?: string;
  retryAfter?: string;
  responseShape:
    | "graph-error"
    | "non-json"
    | "permission-response-mismatch"
    | "permission-reconciliation-error"
    | "permission-reconciliation-mismatch";
}

const SIMULATED_EMAIL_SENDER =
  installation.actors.homer.userPrincipalName;
const SIMULATED_EMAIL_RECIPIENT =
  installation.actors.marge.userPrincipalName;
const SIMULATED_EMAIL_SUBJECT = "Dinner tonight";

export interface AfterPartyApi {
  checkAccess(accessToken: string): Promise<ApiCallerIdentity>;
  getRehearsalStatus(accessToken: string): Promise<RehearsalStatus>;
  getRecentOperationEvents?(
    accessToken: string,
    order?: OperationEventOrder,
  ): Promise<RecentOperationEvents>;
    sendSimulatedEmail(accessToken: string): Promise<SimulatedEmailResult>;
  sendHelpDeskScenario(accessToken: string): Promise<HelpDeskScenarioResult>;
  shareOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "configured" }>>;
  removeOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "removed" }>>;
  createCalendarMeeting(
    accessToken: string,
  ): Promise<Extract<CalendarMeetingResult, { state: "configured" }>>;
  cancelCalendarMeeting(
    accessToken: string,
  ): Promise<
    Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
  >;
  createContactProof(
    accessToken: string,
  ): Promise<Extract<ContactProofResult, { state: "configured" }>>;
  removeContactProof(
    accessToken: string,
  ): Promise<Extract<ContactProofResult, { state: "removed" }>>;
  createInboxRuleProof(accessToken: string): Promise<
    Extract<InboxRuleProofResult, { state: "configured" }>
  >;
  removeInboxRuleProof(accessToken: string): Promise<
    Extract<InboxRuleProofResult, { state: "removed" }>
  >;
  createCategoryProof(accessToken: string): Promise<
    Extract<CategoryProofResult, { state: "configured" }>
  >;
  removeCategoryProof(accessToken: string): Promise<
    Extract<CategoryProofResult, { state: "removed" }>
  >;
  createSharePointFileProof(accessToken: string): Promise<
    Extract<SharePointFileProofResult, { state: "configured" }>
  >;
  removeSharePointFileProof(accessToken: string): Promise<
    Extract<SharePointFileProofResult, { state: "removed" }>
  >;
  createDraftProof(accessToken: string): Promise<
    Extract<DraftProofResult, { state: "configured" }>
  >;
  removeDraftProof(accessToken: string): Promise<
    Extract<DraftProofResult, { state: "removed" }>
  >;
  createTodoTaskProof(accessToken: string): Promise<
    Extract<TodoTaskProofResult, { state: "configured" }>
  >;
  removeTodoTaskProof(accessToken: string): Promise<
    Extract<TodoTaskProofResult, { state: "removed" }>
  >;
}

export type ApiAccessErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "server-shutting-down"
  | "safe-failure";

abstract class SupportReferencedApiClientError
  extends Error
  implements ApiSupportReferencedError {
  readonly supportReference?: string;

  bindSupportReference(response: Response): this {
    const supportReference = readApiSupportReference(response.headers);
    if (supportReference !== undefined) {
      Object.defineProperty(this, "supportReference", {
        configurable: false,
        enumerable: true,
        value: supportReference,
        writable: false,
      });
    }
    return this;
  }
}

export class ApiAccessError extends SupportReferencedApiClientError {
  readonly category: ApiAccessErrorCategory;

  constructor(
    message = "The API could not complete the access check. Try again.",
    category: ApiAccessErrorCategory = "safe-failure",
  ) {
    super(message);
    this.name = "ApiAccessError";
    this.category = category;
  }
}

export class OneDriveInviteFailureError extends ApiAccessError {
  readonly diagnostic: OneDriveInviteFailure;

  constructor(diagnostic: OneDriveInviteFailure) {
    super(
      "Homer's file was created, but sharing it with Marge failed. Clean up the OneDrive proof before trying again.",
    );
    this.name = "OneDriveInviteFailureError";
    this.diagnostic = diagnostic;
  }
}

export class HttpAfterPartyApi implements AfterPartyApi {
  private readonly baseUrl: string;
  private readonly whoAmIUrl: string;
  private readonly rehearsalStatusUrl: string;
  private readonly operationEventsUrl: string;
  private readonly simulatedEmailUrl: string;
  private readonly helpDeskScenarioUrl: string;
  private readonly calendarMeetingUrl: string;
  private readonly calendarMeetingCancelUrl: string;
  private readonly request: typeof fetch;

  constructor(baseUrl: string, request: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.whoAmIUrl = routeUrl(baseUrl, "whoami");
    this.rehearsalStatusUrl = routeUrl(baseUrl, "rehearsal-status");
    this.operationEventsUrl = routeUrl(baseUrl, "operation-events");
    this.simulatedEmailUrl = routeUrl(baseUrl, "simulated-email-send");
    this.helpDeskScenarioUrl = routeUrl(baseUrl, "help-desk-scenario-send");
    this.calendarMeetingUrl = routeUrl(baseUrl, "calendar-meeting-create");
    this.calendarMeetingCancelUrl = routeUrl(
      baseUrl,
      "calendar-meeting-cancel",
    );
    this.request = request.bind(globalThis);
  }

  async checkAccess(accessToken: string): Promise<ApiCallerIdentity> {
    const { value, response } = await this.getAuthorizedJson(
      this.whoAmIUrl,
      accessToken,
      "whoami",
    );
    if (!isSafeCallerIdentity(value)) {
      throw new ApiAccessError().bindSupportReference(response);
    }

    return {
      callerType: value.callerType,
      tenantId: value.tenantId,
    };
  }

  async getRehearsalStatus(accessToken: string): Promise<RehearsalStatus> {
    const { value, response } = await this.getAuthorizedJson(
      this.rehearsalStatusUrl,
      accessToken,
      "rehearsal-status",
    );
    if (!isSafeRehearsalStatus(value)) {
      throw new ApiAccessError().bindSupportReference(response);
    }

    return {
      appName: value.appName,
      region: value.region,
      runningStatus: value.runningStatus,
      latestReadyRevision: value.latestReadyRevision,
    };
  }

  async getRecentOperationEvents(
    accessToken: string,
    order: OperationEventOrder = "newest",
  ): Promise<RecentOperationEvents> {
    if (!OPERATION_EVENT_ORDERS.includes(order)) {
      throw new ApiAccessError();
    }
    const url = new URL(this.operationEventsUrl);
    url.searchParams.set("order", order);
    const { value, response } = await this.getAuthorizedJson(
      url.toString(),
      accessToken,
      "operation-events",
    );
    if (!isSafeRecentOperationEvents(value) || value.order !== order) {
      throw new ApiAccessError().bindSupportReference(response);
    }
    return {
      schemaVersion: 1,
      order,
      events: value.events.map(copyOperationEvent),
    };
  }

  async sendSimulatedEmail(
    accessToken: string,
  ): Promise<SimulatedEmailResult> {
    const { value, response } = await this.getAuthorizedJson(
      this.simulatedEmailUrl,
      accessToken,
      "simulated-email-send",
      202,
    );
    if (!isSafeSimulatedEmailResult(value)) {
      throw new ApiAccessError().bindSupportReference(response);
    }

    return {
      accepted: true,
      sender: value.sender,
      recipient: value.recipient,
      subject: value.subject,
    };
  }

  async sendHelpDeskScenario(
    accessToken: string,
  ): Promise<HelpDeskScenarioResult> {
    const { value, response } = await this.getAuthorizedJson(
      this.helpDeskScenarioUrl,
      accessToken,
      "help-desk-scenario-send",
      202,
    );
    if (!isSafeHelpDeskScenarioResult(value)) {
      throw new ApiAccessError().bindSupportReference(response);
    }
    return {
      accepted: true,
      artifact: "outlook-email",
      sender: value.sender,
      recipient: value.recipient,
      subject: value.subject,
      platformClaims: ["email"],
    };
  }

  async shareOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "configured" }>> {
    const result = await this.oneDriveProofRequest(
      accessToken,
      "onedrive-proof-create",
      201,
      "configured",
    );
    return {
      state: "configured",
      path: result.path,
      owner: result.owner,
      recipient: result.recipient,
      access: result.access,
    };
  }

  async removeOneDriveProof(
    accessToken: string,
  ): Promise<Extract<OneDriveProofResult, { state: "removed" }>> {
    const result = await this.oneDriveProofRequest(
      accessToken,
      "onedrive-proof-remove",
      200,
      "removed",
    );
    return { state: "removed", path: result.path };
  }

  async createCalendarMeeting(
    accessToken: string,
  ): Promise<Extract<CalendarMeetingResult, { state: "configured" }>> {
    const { value, response } = await this.getAuthorizedJson(
      this.calendarMeetingUrl,
      accessToken,
      "calendar-meeting-create",
      201,
      "calendar",
    );
    if (!isSafeCalendarMeetingResult(value) || value.state !== "configured") {
      throw new ApiAccessError().bindSupportReference(response);
    }
    return {
      state: "configured",
      organizer: CALENDAR_MEETING_ORGANIZER,
      attendees: CALENDAR_MEETING_ATTENDEES,
      subject: CALENDAR_MEETING_SUBJECT,
      start: CALENDAR_MEETING_START,
      end: CALENDAR_MEETING_END,
    };
  }

  async cancelCalendarMeeting(
    accessToken: string,
  ): Promise<
    Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
  > {
    const { value, response } = await this.getAuthorizedJson(
      this.calendarMeetingCancelUrl,
      accessToken,
      "calendar-meeting-cancel",
      202,
      "calendar",
    );
    if (
      !isSafeCalendarMeetingResult(value) ||
      value.state !== "cancellation-accepted"
    ) {
      throw new ApiAccessError().bindSupportReference(response);
    }
    return {
      state: "cancellation-accepted",
      organizer: CALENDAR_MEETING_ORGANIZER,
      subject: CALENDAR_MEETING_SUBJECT,
    };
  }

  async createContactProof(
    accessToken: string,
  ): Promise<Extract<ContactProofResult, { state: "configured" }>> {
    return this.fixedProofRequest(
      accessToken,
      "contact-proof-create",
      201,
      "configured",
      isSafeContactProofResult,
    );
  }

  async removeContactProof(
    accessToken: string,
  ): Promise<Extract<ContactProofResult, { state: "removed" }>> {
    return this.fixedProofRequest(
      accessToken,
      "contact-proof-remove",
      200,
      "removed",
      isSafeContactProofResult,
    );
  }

  private async fixedProofRequest<
    R extends { state: string },
    S extends R["state"],
  >(
    accessToken: string,
    ownerKey: ApiRouteOwnerKey,
    status: number,
    state: S,
    validate: (value: unknown) => value is R,
  ): Promise<Extract<R, { state: S }>> {
    const { value, response } = await this.getAuthorizedJson(
      routeUrl(this.baseUrl, ownerKey),
      accessToken,
      ownerKey,
      status,
    );
    if (!validate(value) || value.state !== state) {
      throw new ApiAccessError().bindSupportReference(response);
    }
    return value as Extract<R, { state: S }>;
  }

  async createInboxRuleProof(accessToken: string) {
    return this.fixedProofRequest(
      accessToken,
      "inbox-rule-proof-create",
      201,
      "configured",
      isSafeInboxRuleProofResult,
    );
  }

  async removeInboxRuleProof(accessToken: string) {
    return this.fixedProofRequest(
      accessToken,
      "inbox-rule-proof-remove",
      200,
      "removed",
      isSafeInboxRuleProofResult,
    );
  }

  async createCategoryProof(accessToken: string) {
    return this.fixedProofRequest(
      accessToken,
      "category-proof-create",
      201,
      "configured",
      isSafeCategoryProofResult,
    );
  }

  async removeCategoryProof(accessToken: string) {
    return this.fixedProofRequest(
      accessToken,
      "category-proof-remove",
      200,
      "removed",
      isSafeCategoryProofResult,
    );
  }

  async createSharePointFileProof(accessToken: string) {
    await this.fixedProofRequest(
      accessToken,
      "sharepoint-file-proof-create",
      201,
      "configured",
      isSafeSharePointFileProofResult,
    );
    return { state: "configured", name: SHAREPOINT_FILE_PROOF_NAME } as const;
  }

  async removeSharePointFileProof(accessToken: string) {
    await this.fixedProofRequest(
      accessToken,
      "sharepoint-file-proof-remove",
      200,
      "removed",
      isSafeSharePointFileProofResult,
    );
    return { state: "removed", name: SHAREPOINT_FILE_PROOF_NAME } as const;
  }

  async createDraftProof(accessToken: string) {
    await this.fixedProofRequest(
      accessToken,
      "draft-proof-create",
      201,
      "configured",
      isSafeDraftProofResult,
    );
    return { state: "configured", subject: DRAFT_PROOF_SUBJECT } as const;
  }

  async removeDraftProof(accessToken: string) {
    await this.fixedProofRequest(
      accessToken,
      "draft-proof-remove",
      200,
      "removed",
      isSafeDraftProofResult,
    );
    return { state: "removed", subject: DRAFT_PROOF_SUBJECT } as const;
  }

  async createTodoTaskProof(accessToken: string) {
    await this.fixedProofRequest(
      accessToken,
      "todo-task-proof-create",
      201,
      "configured",
      isSafeTodoTaskProofResult,
    );
    return { state: "configured", title: TODO_TASK_PROOF_TITLE } as const;
  }

  async removeTodoTaskProof(accessToken: string) {
    await this.fixedProofRequest(
      accessToken,
      "todo-task-proof-remove",
      200,
      "removed",
      isSafeTodoTaskProofResult,
    );
    return { state: "removed", title: TODO_TASK_PROOF_TITLE } as const;
  }

  private async oneDriveProofRequest<T extends OneDriveProofResult["state"]>(
    accessToken: string,
    ownerKey: "onedrive-proof-create" | "onedrive-proof-remove",
    expectedStatus: number,
    expectedState: T,
  ): Promise<Extract<OneDriveProofResult, { state: T }>> {
    const { value, response } = await this.getAuthorizedJson(
      routeUrl(this.baseUrl, ownerKey),
      accessToken,
      ownerKey,
      expectedStatus,
      expectedState === "configured"
        ? "onedrive-invite"
        : undefined,
    );
    if (!isSafeOneDriveProofResult(value) || value.state !== expectedState) {
      throw new ApiAccessError().bindSupportReference(response);
    }
    return value as Extract<OneDriveProofResult, { state: T }>;
  }

  private async getAuthorizedJson(
    url: string,
    accessToken: string,
    ownerKey: ApiRouteOwnerKey,
    expectedStatus?: number,
    failureContext?: "onedrive-invite" | "calendar",
  ): Promise<{ value: unknown; response: Response }> {
    const contract = apiRouteContract(ownerKey);
    let response: Response;
    try {
      response = await this.request(url, {
        method: contract.method,
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      throw new ApiAccessError();
    }

    try {
    if (response.status === 401) {
      throw new ApiAccessError(
        "API access needs Microsoft authorization. Try again.",
        "unauthorized",
      );
    }
    if (response.status === 403) {
      throw new ApiAccessError(
        "This account is not allowed to use the API.",
        "forbidden",
      );
    }
    if (response.status === 503) {
      const isShuttingDown = await readServerShuttingDown(
        response,
        contract.errorMaxBytes,
      );
      if (isShuttingDown) {
        throw new ApiAccessError(
          SERVER_SHUTTING_DOWN_MESSAGE,
          "server-shutting-down",
        );
      }
      throw new ApiAccessError();
    }
    if (response.status === 409) {
      const error = await readErrorCode(response);
      if (error === "contact_state_conflict") {
        throw new ApiAccessError(
          "The contact proof is not in the expected state. Nothing was changed.",
        );
      }
      if (error === "inbox_rule_state_conflict") {
        throw new ApiAccessError(
          "The inbox-rule proof is not in the expected state. Nothing was changed.",
        );
      }
      if (error === "category_state_conflict") {
        throw new ApiAccessError(
          "The category proof is not in the expected state. Nothing was changed.",
        );
      }
      if (error === "sharepoint_file_state_conflict") {
        throw new ApiAccessError(
          "The SharePoint file proof is not in the expected state. Nothing was changed.",
        );
      }
      if (error === "draft_state_conflict") {
        throw new ApiAccessError(
          "The unsent-draft proof is not in the expected state. Nothing was changed.",
        );
      }
      if (error === "todo_task_state_conflict") {
        throw new ApiAccessError(
          "The To Do task proof is not in the expected state. Nothing was changed.",
        );
      }
      if (failureContext === "calendar") {
        if (error === "calendar_operation_busy") {
          throw new ApiAccessError(
            "Another calendar operation is running. Try again shortly.",
          );
        }
        throw new ApiAccessError(
          "The calendar rehearsal is not in the expected state. Nothing was repeated.",
        );
      }
      if (error === "proof_operation_busy") {
        throw new ApiAccessError(
          "Another OneDrive proof operation is running. Try again shortly.",
        );
      }
      throw new ApiAccessError(
        "The OneDrive proof file is not in the expected state. Nothing was changed.",
      );
    }
    if (response.status === 502 && failureContext) {
      if (failureContext === "onedrive-invite") {
        const failure = await readOneDriveInviteFailure(response);
        if (failure) {
          throw new OneDriveInviteFailureError(failure);
        }
      }
      throw new ApiAccessError();
    }
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new ApiAccessError();
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiAccessError();
    }
    return { value, response };
    } catch (error) {
      throw bindApiSupportReference(error, response);
    }
  }
}

function routeUrl(baseUrl: string, ownerKey: ApiRouteOwnerKey): string {
  return new URL(
    apiRouteContract(ownerKey).path.slice(1),
    `${baseUrl}/`,
  ).toString();
}

function bindApiSupportReference(
  error: unknown,
  response: Response,
): unknown {
  return error instanceof SupportReferencedApiClientError
    ? error.bindSupportReference(response)
    : error;
}

async function readOneDriveInviteFailure(
  response: Response,
): Promise<OneDriveInviteFailure | undefined> {
  try {
    const value: unknown = await response.json();
    return isSafeOneDriveInviteFailure(value) ? {
      state: "file-created-sharing-failed",
      stage: value.stage,
      upstreamStatus: value.upstreamStatus,
      clientRequestId: value.clientRequestId,
      responseShape: value.responseShape,
      ...(value.graphErrorCode ? { graphErrorCode: value.graphErrorCode } : {}),
      ...(value.requestId ? { requestId: value.requestId } : {}),
      ...(value.responseDate ? { responseDate: value.responseDate } : {}),
      ...(value.retryAfter ? { retryAfter: value.retryAfter } : {}),
    } : undefined;
  } catch {
    return undefined;
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string"
      ? value.error
      : undefined;
  } catch {
    return undefined;
  }
}

async function readServerShuttingDown(
  response: Response,
  maximumBytes: number,
): Promise<boolean> {
  try {
    const text = await readBoundedJsonResponse(response, maximumBytes);
    const value: unknown = JSON.parse(text) as unknown;
    return isExactServerShuttingDown(value);
  } catch {
    return false;
  }
}

function isSafeOneDriveInviteFailure(
  value: unknown,
): value is OneDriveInviteFailure & { error: "onedrive_invite_failed" } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const failure = value as Record<string, unknown>;
  return (
    failure.error === "onedrive_invite_failed" &&
    failure.state === "file-created-sharing-failed" &&
    (failure.stage === "invite" ||
      failure.stage === "invite-reconciliation") &&
    Number.isInteger(failure.upstreamStatus) &&
    Number(failure.upstreamStatus) >= 100 &&
    Number(failure.upstreamStatus) <= 599 &&
    optionalGuid(failure.clientRequestId) &&
    failure.clientRequestId !== undefined &&
    isInviteResponseShape(failure.responseShape) &&
    optionalSafeCode(failure.graphErrorCode) &&
    optionalGuid(failure.requestId) &&
    optionalHttpDate(failure.responseDate) &&
    optionalRetryAfter(failure.retryAfter)
  );
}

function isInviteResponseShape(value: unknown): boolean {
  return value === "graph-error" ||
    value === "non-json" ||
    value === "permission-response-mismatch" ||
    value === "permission-reconciliation-error" ||
    value === "permission-reconciliation-mismatch";
}

function optionalSafeCode(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "string" &&
      /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value));
}

function optionalGuid(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function optionalHttpDate(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(Date.parse(value)).toUTCString() === value);
}

function optionalRetryAfter(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "string" &&
      (/^(?:0|[1-9][0-9]{0,5})$/.test(value) || optionalHttpDate(value)));
}

function isSafeCallerIdentity(value: unknown): value is ApiCallerIdentity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const caller = value as Record<string, unknown>;
  return (
    (caller.callerType === "delegated" || caller.callerType === "app-only") &&
    typeof caller.tenantId === "string" &&
    caller.tenantId.length > 0
  );
}

function isSafeRehearsalStatus(value: unknown): value is RehearsalStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = value as Record<string, unknown>;
  return (
    typeof status.appName === "string" &&
    status.appName.length > 0 &&
    typeof status.region === "string" &&
    status.region.length > 0 &&
    runningStatuses.some((candidate) => candidate === status.runningStatus) &&
    typeof status.latestReadyRevision === "string" &&
    status.latestReadyRevision.length > 0
  );
}

function isSafeRecentOperationEvents(
  value: unknown,
): value is RecentOperationEvents {
  if (!hasExactKeys(value, ["schemaVersion", "order", "events"])) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    OPERATION_EVENT_ORDERS.includes(value.order as OperationEventOrder) &&
    Array.isArray(value.events) &&
    value.events.length <= 64 &&
    value.events.every(isSafeOperationEvent)
  );
}

function isSafeOperationEvent(value: unknown): value is OperationEvent {
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "markerHash",
      "operationKind",
      "phase",
      "outcome",
      "durationMs",
      "reason",
      "ambiguityState",
      "recoveryState",
    ], ["upstreamStatus"])
  ) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    typeof value.markerHash === "string" &&
    /^m1_[0-9a-f]{24}$/.test(value.markerHash) &&
    (value.operationKind === "calendar.create" ||
      value.operationKind === "calendar.cancel") &&
    (value.phase === "execution" ||
      value.phase === "cleanup" ||
      value.phase === "recovery") &&
    (value.outcome === "started" ||
      value.outcome === "succeeded" ||
      value.outcome === "refused" ||
      value.outcome === "ambiguous") &&
    Number.isInteger(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    Number(value.durationMs) <= 86_400_000 &&
    (value.reason === "none" ||
      value.reason === "precondition-refusal" ||
      value.reason === "upstream-refusal" ||
      value.reason === "upstream-unavailable" ||
      value.reason === "invalid-upstream-shape" ||
      value.reason === "unexpected") &&
    (value.ambiguityState === "none" ||
      value.ambiguityState === "possible-mutation" ||
      value.ambiguityState === "unresolved") &&
    (value.recoveryState === "not-applicable" ||
      value.recoveryState === "not-needed" ||
      value.recoveryState === "in-progress" ||
      value.recoveryState === "reconciled" ||
      value.recoveryState === "unresolved") &&
    (
      value.upstreamStatus === undefined ||
      (
        Number.isInteger(value.upstreamStatus) &&
        Number(value.upstreamStatus) >= 100 &&
        Number(value.upstreamStatus) <= 599
      )
    )
  );
}

function copyOperationEvent(event: OperationEvent): OperationEvent {
  return {
    schemaVersion: 1,
    markerHash: event.markerHash,
    operationKind: event.operationKind,
    phase: event.phase,
    outcome: event.outcome,
    durationMs: event.durationMs,
    reason: event.reason,
    ambiguityState: event.ambiguityState,
    recoveryState: event.recoveryState,
    ...(event.upstreamStatus === undefined
      ? {}
      : { upstreamStatus: event.upstreamStatus }),
  };
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isSafeSimulatedEmailResult(
  value: unknown,
): value is SimulatedEmailResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.accepted === true &&
    result.sender === SIMULATED_EMAIL_SENDER &&
    result.recipient === SIMULATED_EMAIL_RECIPIENT &&
    result.subject === SIMULATED_EMAIL_SUBJECT
  );
}

function isSafeHelpDeskScenarioResult(
  value: unknown,
): value is HelpDeskScenarioResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.accepted === true &&
    result.artifact === "outlook-email" &&
    result.sender === HELP_DESK_SCENARIO_SENDER &&
    result.recipient === HELP_DESK_SCENARIO_RECIPIENT &&
    result.subject === HELP_DESK_SCENARIO_SUBJECT &&
    Array.isArray(result.platformClaims) &&
    result.platformClaims.length === 1 &&
    result.platformClaims[0] === "email"
  );
}

function isSafeContactProofResult(value: unknown): value is ContactProofResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.displayName === CONTACT_PROOF_DISPLAY_NAME &&
    (result.state === "removed" ||
      (result.state === "configured" && result.email === CONTACT_PROOF_EMAIL))
  );
}

function isSafeInboxRuleProofResult(value: unknown): value is InboxRuleProofResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.displayName === INBOX_RULE_PROOF_DISPLAY_NAME &&
    (result.state === "removed" || result.state === "configured")
  );
}

function isSafeCategoryProofResult(value: unknown): value is CategoryProofResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return result.displayName === CATEGORY_PROOF_DISPLAY_NAME &&
    (result.state === "removed" || result.state === "configured");
}

function isSafeSharePointFileProofResult(
  value: unknown,
): value is SharePointFileProofResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return result.name === SHAREPOINT_FILE_PROOF_NAME &&
    (result.state === "removed" || result.state === "configured");
}

function isSafeDraftProofResult(value: unknown): value is DraftProofResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return result.subject === DRAFT_PROOF_SUBJECT &&
    (result.state === "removed" || result.state === "configured");
}

function isSafeTodoTaskProofResult(
  value: unknown,
): value is TodoTaskProofResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return result.title === TODO_TASK_PROOF_TITLE &&
    (result.state === "removed" || result.state === "configured");
}

function isSafeOneDriveProofResult(
  value: unknown,
): value is OneDriveProofResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.path !== ONEDRIVE_PROOF_PATH) {
    return false;
  }
  if (result.state === "configured") {
    return (
      result.owner === ONEDRIVE_PROOF_OWNER &&
      result.recipient === ONEDRIVE_PROOF_RECIPIENT &&
      result.access === "read"
    );
  }
  return result.state === "removed";
}

function isSafeCalendarMeetingResult(
  value: unknown,
): value is CalendarMeetingResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (
    result.organizer !== CALENDAR_MEETING_ORGANIZER ||
    result.subject !== CALENDAR_MEETING_SUBJECT
  ) {
    return false;
  }
  if (result.state === "cancellation-accepted") {
    return (
      !("attendees" in result) &&
      !("start" in result) &&
      !("end" in result)
    );
  }
  return (
    result.state === "configured" &&
    result.start === CALENDAR_MEETING_START &&
    result.end === CALENDAR_MEETING_END &&
    Array.isArray(result.attendees) &&
    result.attendees.length === CALENDAR_MEETING_ATTENDEES.length &&
    result.attendees.every(
      (attendee, index) => attendee === CALENDAR_MEETING_ATTENDEES[index],
    )
  );
}

async function readBoundedJsonResponse(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(declaredLength) ||
      Number(declaredLength) > maximumBytes)
  ) {
    throw new BoundedResponseTooLargeError();
  }
  try {
    if (response.body === null) {
      return "";
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new BoundedResponseTooLargeError();
      }
      chunks.push(value);
    }
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch (error) {
    if (error instanceof BoundedResponseTooLargeError) {
      throw error;
    }
    throw new BoundedResponseReadError();
  }
}

class BoundedResponseTooLargeError extends Error {}
class BoundedResponseReadError extends Error {}
