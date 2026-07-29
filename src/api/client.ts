import type {
  ScenarioExecutionPlan,
  ScenarioPlanErrorCategory,
  ScenarioPlanningRequest,
} from "../scenarios/scenario-plan";
import type {
  EvidenceReceiptErrorCode,
  ScenarioEvidenceReceipt,
} from "../scenarios/scenario-evidence-receipt";
import type {
  SafeVerifiedScenarioEvidenceReceipt,
} from "../scenarios/scenario-evidence-verification";
import {
  EVIDENCE_RECEIPT_ERROR_CODES,
  isExactSafeVerifiedReceipt,
  parseScenarioEvidenceReceiptRequest,
  ScenarioEvidenceContractError,
} from "./scenario-evidence-verification-contract.ts";
import {
  REHEARSAL_OUTPUT_MAX_REQUEST_BYTES,
  REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES,
  REHEARSAL_OUTPUT_VERIFICATION_FAILURES,
  isBoundedRehearsalOutputRequest,
  isVerifiedRehearsalOutputSummary,
  type RehearsalOutputVerificationFailure,
  type RehearsalOutputVerificationRequest,
  type VerifiedRehearsalOutputSummary,
} from "./rehearsal-output-verification-contract.ts";
import type {
  ScenarioSurfaceCapabilityDeclaration,
} from "../scenarios/scenario-surface-capability";
import {
  BATCH_FEASIBILITY_MAX_REQUEST_BYTES,
  BATCH_FEASIBILITY_MAX_RESPONSE_BYTES,
  isBoundedBatchFeasibilityRequest,
  isSafeBatchFeasibilityResult,
  type BatchFeasibilityRequest,
} from "./multi-scenario-feasibility-contract.ts";
import {
  FEASIBILITY_INPUT_FAILURES,
  type FeasibilityInputFailure,
  type MultiScenarioFeasibilityResult,
} from "../scenarios/multi-scenario-feasibility-contract.ts";

export const SCENARIO_API_CLIENT_CAPABILITIES = [
  {
    schemaVersion: 1,
    surface: "authenticated-batch-feasibility-client",
    scenarioScope: "canonical-registry",
    manifestSchemaVersion: 2,
    repositoryBoundary: "contract-only",
  },
  {
    schemaVersion: 1,
    surface: "authenticated-plan-client",
    scenarioScope: "canonical-registry",
    manifestSchemaVersion: 2,
    repositoryBoundary: "contract-only",
  },
  {
    schemaVersion: 1,
    surface: "authenticated-receipt-client",
    scenarioScope: "canonical-registry",
    manifestSchemaVersion: 2,
    repositoryBoundary: "contract-only",
  },
  {
    schemaVersion: 1,
    surface: "authenticated-rehearsal-verification-client",
    scenarioScope: "explicit-scenarios",
    manifestSchemaVersion: 2,
    repositoryBoundary: "contract-only",
    scenarioIds: ["avd-three-vm-substrate"],
  },
] as const satisfies readonly ScenarioSurfaceCapabilityDeclaration[];

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
  "kobe@corywest.onmicrosoft.com";
export const HELP_DESK_SCENARIO_RECIPIENT =
  "cory@corywest.onmicrosoft.com";
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
export const CONTACT_PROOF_EMAIL = "kobe@corywest.onmicrosoft.com";
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
  "kobe@corywest.onmicrosoft.com",
  "marge.simpson@corywest.onmicrosoft.com",
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
  "cory@corywest.onmicrosoft.com";
export const CALENDAR_MEETING_ATTENDEES = [
  "kobe@corywest.onmicrosoft.com",
  "marge.simpson@corywest.onmicrosoft.com",
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
  "homer.simpson@corywest.onmicrosoft.com";
const ONEDRIVE_PROOF_RECIPIENT =
  "marge.simpson@corywest.onmicrosoft.com";

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
  "homer.simpson@corywest.onmicrosoft.com";
const SIMULATED_EMAIL_RECIPIENT =
  "marge.simpson@corywest.onmicrosoft.com";
const SIMULATED_EMAIL_SUBJECT = "Dinner tonight";

export interface AfterPartyApi {
  checkAccess(accessToken: string): Promise<ApiCallerIdentity>;
  getRehearsalStatus(accessToken: string): Promise<RehearsalStatus>;
  getRecentOperationEvents?(
    accessToken: string,
    order?: OperationEventOrder,
  ): Promise<RecentOperationEvents>;
  compileScenarioPlan(
    accessToken: string,
    request: ScenarioPlanningRequest,
  ): Promise<ScenarioExecutionPlan>;
  verifyScenarioEvidenceReceipt(
    accessToken: string,
    receipt: ScenarioEvidenceReceipt,
  ): Promise<SafeVerifiedScenarioEvidenceReceipt>;
  verifyRehearsalOutput(
    accessToken: string,
    output: RehearsalOutputVerificationRequest,
  ): Promise<VerifiedRehearsalOutputSummary>;
  calculateMultiScenarioFeasibility(
    accessToken: string,
    request: BatchFeasibilityRequest,
  ): Promise<MultiScenarioFeasibilityResult>;
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

export class ApiAccessError extends Error {
  constructor(message = "The API could not complete the access check. Try again.") {
    super(message);
    this.name = "ApiAccessError";
  }
}

export type ScenarioPlanClientErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "validation-refused"
  | "request-too-large"
  | "safe-failure";

export class ScenarioPlanClientError extends Error {
  readonly category: ScenarioPlanClientErrorCategory;
  readonly refusalCategory?: ScenarioPlanErrorCategory;

  constructor(
    category: ScenarioPlanClientErrorCategory,
    refusalCategory?: ScenarioPlanErrorCategory,
  ) {
    super(`Scenario plan request failed: ${category}`);
    this.name = "ScenarioPlanClientError";
    this.category = category;
    this.refusalCategory = refusalCategory;
  }
}

export type ScenarioEvidenceVerificationClientErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "validation-refused"
  | "request-too-large"
  | "response-too-large"
  | "safe-failure";

export class ScenarioEvidenceVerificationClientError extends Error {
  readonly category: ScenarioEvidenceVerificationClientErrorCategory;
  readonly refusalCategory?: EvidenceReceiptErrorCode;

  constructor(
    category: ScenarioEvidenceVerificationClientErrorCategory,
    refusalCategory?: EvidenceReceiptErrorCode,
  ) {
    super(`Scenario evidence receipt request failed: ${category}`);
    this.name = "ScenarioEvidenceVerificationClientError";
    this.category = category;
    this.refusalCategory = refusalCategory;
  }
}

export type RehearsalOutputVerificationClientErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "validation-refused"
  | "request-too-large"
  | "response-too-large"
  | "safe-failure";

export class RehearsalOutputVerificationClientError extends Error {
  readonly category: RehearsalOutputVerificationClientErrorCategory;
  readonly refusalCategory?: RehearsalOutputVerificationFailure;

  constructor(
    category: RehearsalOutputVerificationClientErrorCategory,
    refusalCategory?: RehearsalOutputVerificationFailure,
  ) {
    super(`Rehearsal output verification request failed: ${category}`);
    this.name = "RehearsalOutputVerificationClientError";
    this.category = category;
    this.refusalCategory = refusalCategory;
  }
}

export type BatchFeasibilityClientErrorCategory =
  | "unauthorized"
  | "forbidden"
  | "validation-refused"
  | "request-too-large"
  | "response-too-large"
  | "safe-failure";

export class BatchFeasibilityClientError extends Error {
  readonly category: BatchFeasibilityClientErrorCategory;
  readonly refusalCategory?:
    | ScenarioPlanErrorCategory
    | FeasibilityInputFailure;

  constructor(
    category: BatchFeasibilityClientErrorCategory,
    refusalCategory?: ScenarioPlanErrorCategory | FeasibilityInputFailure,
  ) {
    super(`Batch feasibility request failed: ${category}`);
    this.name = "BatchFeasibilityClientError";
    this.category = category;
    this.refusalCategory = refusalCategory;
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
  private readonly whoAmIUrl: string;
  private readonly rehearsalStatusUrl: string;
  private readonly operationEventsUrl: string;
  private readonly scenarioPlanUrl: string;
  private readonly scenarioEvidenceVerificationUrl: string;
  private readonly rehearsalOutputVerificationUrl: string;
  private readonly multiScenarioFeasibilityUrl: string;
  private readonly simulatedEmailUrl: string;
  private readonly helpDeskScenarioUrl: string;
  private readonly oneDriveProofUrl: string;
  private readonly calendarMeetingUrl: string;
  private readonly calendarMeetingCancelUrl: string;
  private readonly contactProofUrl: string;
  private readonly inboxRuleProofUrl: string;
  private readonly categoryProofUrl: string;
  private readonly sharePointFileProofUrl: string;
  private readonly draftProofUrl: string;
  private readonly todoTaskProofUrl: string;
  private readonly request: typeof fetch;

  constructor(baseUrl: string, request: typeof fetch = fetch) {
    this.whoAmIUrl = new URL("api/whoami", `${baseUrl}/`).toString();
    this.rehearsalStatusUrl = new URL(
      "api/rehearsal-status",
      `${baseUrl}/`,
    ).toString();
    this.operationEventsUrl = new URL(
      "api/operation-events",
      `${baseUrl}/`,
    ).toString();
    this.scenarioPlanUrl = new URL(
      "api/scenario-plan",
      `${baseUrl}/`,
    ).toString();
    this.scenarioEvidenceVerificationUrl = new URL(
      "api/scenario-evidence-verification",
      `${baseUrl}/`,
    ).toString();
    this.rehearsalOutputVerificationUrl = new URL(
      "api/rehearsal-output-verification",
      `${baseUrl}/`,
    ).toString();
    this.multiScenarioFeasibilityUrl = new URL(
      "api/multi-scenario-feasibility",
      `${baseUrl}/`,
    ).toString();
    this.simulatedEmailUrl = new URL(
      "api/simulated-email",
      `${baseUrl}/`,
    ).toString();
    this.helpDeskScenarioUrl = new URL(
      "api/help-desk-scenario",
      `${baseUrl}/`,
    ).toString();
    this.oneDriveProofUrl = new URL(
      "api/onedrive-share-proof",
      `${baseUrl}/`,
    ).toString();
    this.calendarMeetingUrl = new URL(
      "api/calendar-meeting",
      `${baseUrl}/`,
    ).toString();
    this.calendarMeetingCancelUrl = new URL(
      "api/calendar-meeting/cancel",
      `${baseUrl}/`,
    ).toString();
    this.contactProofUrl = new URL(
      "api/contact-proof",
      `${baseUrl}/`,
    ).toString();
    this.inboxRuleProofUrl = new URL("api/inbox-rule-proof", `${baseUrl}/`)
      .toString();
    this.categoryProofUrl = new URL("api/category-proof", `${baseUrl}/`)
      .toString();
    this.sharePointFileProofUrl = new URL(
      "api/sharepoint-file-proof",
      `${baseUrl}/`,
    ).toString();
    this.draftProofUrl = new URL("api/draft-proof", `${baseUrl}/`).toString();
    this.todoTaskProofUrl = new URL(
      "api/todo-task-proof",
      `${baseUrl}/`,
    ).toString();
    this.request = request.bind(globalThis);
  }

  async checkAccess(accessToken: string): Promise<ApiCallerIdentity> {
    const value = await this.getAuthorizedJson(this.whoAmIUrl, accessToken);
    if (!isSafeCallerIdentity(value)) {
      throw new ApiAccessError();
    }

    return {
      callerType: value.callerType,
      tenantId: value.tenantId,
    };
  }

  async getRehearsalStatus(accessToken: string): Promise<RehearsalStatus> {
    const value = await this.getAuthorizedJson(
      this.rehearsalStatusUrl,
      accessToken,
    );
    if (!isSafeRehearsalStatus(value)) {
      throw new ApiAccessError();
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
    const value = await this.getAuthorizedJson(url.toString(), accessToken);
    if (!isSafeRecentOperationEvents(value) || value.order !== order) {
      throw new ApiAccessError();
    }
    return {
      schemaVersion: 1,
      order,
      events: value.events.map(copyOperationEvent),
    };
  }

  async compileScenarioPlan(
    accessToken: string,
    planningRequest: ScenarioPlanningRequest,
  ): Promise<ScenarioExecutionPlan> {
    if (!isSafeScenarioPlanningRequest(planningRequest)) {
      throw new ScenarioPlanClientError("validation-refused");
    }
    const body = JSON.stringify(planningRequest);
    if (new TextEncoder().encode(body).byteLength > 8_192) {
      throw new ScenarioPlanClientError("request-too-large");
    }

    let response: Response;
    try {
      response = await this.request(this.scenarioPlanUrl, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw new ScenarioPlanClientError("safe-failure");
    }

    if (response.status === 401) {
      throw new ScenarioPlanClientError("unauthorized");
    }
    if (response.status === 403) {
      throw new ScenarioPlanClientError("forbidden");
    }
    if (response.status === 413) {
      throw new ScenarioPlanClientError("request-too-large");
    }
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      throw new ScenarioPlanClientError("safe-failure");
    }

    let responseText: string;
    try {
      responseText = await readBoundedJsonResponse(response, 65_536);
    } catch {
      throw new ScenarioPlanClientError("safe-failure");
    }
    let value: unknown;
    try {
      value = JSON.parse(responseText) as unknown;
    } catch {
      throw new ScenarioPlanClientError("safe-failure");
    }
    if (!response.ok) {
      if (
        response.status === 400 &&
        isScenarioRecord(value) &&
        value.error === "scenario_plan_refused" &&
        typeof value.category === "string" &&
        SCENARIO_PLAN_REFUSAL_CATEGORIES.includes(
          value.category as ScenarioPlanErrorCategory,
        )
      ) {
        throw new ScenarioPlanClientError(
          "validation-refused",
          value.category as ScenarioPlanErrorCategory,
        );
      }
      throw new ScenarioPlanClientError("safe-failure");
    }
    if (
      response.status !== 200 ||
      !isSafeScenarioExecutionPlan(value, planningRequest)
    ) {
      throw new ScenarioPlanClientError("safe-failure");
    }
    return value;
  }

  async verifyScenarioEvidenceReceipt(
    accessToken: string,
    receipt: ScenarioEvidenceReceipt,
  ): Promise<SafeVerifiedScenarioEvidenceReceipt> {
    let parsedReceipt: ScenarioEvidenceReceipt;
    try {
      parsedReceipt = parseScenarioEvidenceReceiptRequest(receipt);
    } catch (error) {
      if (error instanceof ScenarioEvidenceContractError) {
        throw new ScenarioEvidenceVerificationClientError(
          "validation-refused",
          error.code,
        );
      }
      throw new ScenarioEvidenceVerificationClientError("safe-failure");
    }
    const body = JSON.stringify(receipt);
    if (new TextEncoder().encode(body).byteLength > 131_072) {
      throw new ScenarioEvidenceVerificationClientError("request-too-large");
    }

    let response: Response;
    try {
      response = await this.request(this.scenarioEvidenceVerificationUrl, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw new ScenarioEvidenceVerificationClientError("safe-failure");
    }
    if (response.status === 401) {
      throw new ScenarioEvidenceVerificationClientError("unauthorized");
    }
    if (response.status === 403) {
      throw new ScenarioEvidenceVerificationClientError("forbidden");
    }
    if (response.status === 413) {
      throw new ScenarioEvidenceVerificationClientError("request-too-large");
    }
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      throw new ScenarioEvidenceVerificationClientError("safe-failure");
    }

    let responseText: string;
    try {
      responseText = await readBoundedJsonResponse(response, 131_072);
    } catch (error) {
      throw new ScenarioEvidenceVerificationClientError(
        error instanceof BoundedResponseTooLargeError
          ? "response-too-large"
          : "safe-failure",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(responseText) as unknown;
    } catch {
      throw new ScenarioEvidenceVerificationClientError("safe-failure");
    }
    if (!response.ok) {
      if (
        response.status === 400 &&
        isScenarioRecord(value) &&
        value.error === "scenario_evidence_receipt_refused" &&
        typeof value.category === "string" &&
        EVIDENCE_RECEIPT_ERROR_CODES.includes(
          value.category as EvidenceReceiptErrorCode,
        )
      ) {
        throw new ScenarioEvidenceVerificationClientError(
          "validation-refused",
          value.category as EvidenceReceiptErrorCode,
        );
      }
      if (
        response.status === 500 &&
        isScenarioRecord(value) &&
        value.error === "scenario_evidence_receipt_response_too_large"
      ) {
        throw new ScenarioEvidenceVerificationClientError(
          "response-too-large",
        );
      }
      throw new ScenarioEvidenceVerificationClientError("safe-failure");
    }
    if (
      response.status !== 200 ||
      !isExactSafeVerifiedReceipt(value, parsedReceipt)
    ) {
      throw new ScenarioEvidenceVerificationClientError("safe-failure");
    }
    return value;
  }

  async verifyRehearsalOutput(
    accessToken: string,
    output: RehearsalOutputVerificationRequest,
  ): Promise<VerifiedRehearsalOutputSummary> {
    if (!isBoundedRehearsalOutputRequest(output)) {
      throw new RehearsalOutputVerificationClientError(
        "validation-refused",
        "INPUT_SHAPE",
      );
    }
    let body: string;
    try {
      body = JSON.stringify(output);
    } catch {
      throw new RehearsalOutputVerificationClientError("validation-refused");
    }
    if (
      new TextEncoder().encode(body).byteLength >
      REHEARSAL_OUTPUT_MAX_REQUEST_BYTES
    ) {
      throw new RehearsalOutputVerificationClientError("request-too-large");
    }

    let response: Response;
    try {
      response = await this.request(this.rehearsalOutputVerificationUrl, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw new RehearsalOutputVerificationClientError("safe-failure");
    }
    if (response.status === 401) {
      throw new RehearsalOutputVerificationClientError("unauthorized");
    }
    if (response.status === 403) {
      throw new RehearsalOutputVerificationClientError("forbidden");
    }
    if (response.status === 413) {
      throw new RehearsalOutputVerificationClientError("request-too-large");
    }
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      throw new RehearsalOutputVerificationClientError("safe-failure");
    }

    let responseText: string;
    try {
      responseText = await readBoundedJsonResponse(
        response,
        REHEARSAL_OUTPUT_MAX_RESPONSE_BYTES,
      );
    } catch (error) {
      throw new RehearsalOutputVerificationClientError(
        error instanceof BoundedResponseTooLargeError
          ? "response-too-large"
          : "safe-failure",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(responseText) as unknown;
    } catch {
      throw new RehearsalOutputVerificationClientError("safe-failure");
    }
    if (!response.ok) {
      if (
        response.status === 400 &&
        isScenarioRecord(value) &&
        value.error === "rehearsal_output_refused" &&
        typeof value.category === "string" &&
        REHEARSAL_OUTPUT_VERIFICATION_FAILURES.includes(
          value.category as RehearsalOutputVerificationFailure,
        )
      ) {
        throw new RehearsalOutputVerificationClientError(
          "validation-refused",
          value.category as RehearsalOutputVerificationFailure,
        );
      }
      if (
        response.status === 500 &&
        isScenarioRecord(value) &&
        value.error === "rehearsal_output_response_too_large"
      ) {
        throw new RehearsalOutputVerificationClientError(
          "response-too-large",
        );
      }
      throw new RehearsalOutputVerificationClientError("safe-failure");
    }
    if (
      response.status !== 200 ||
      !isVerifiedRehearsalOutputSummary(value, output)
    ) {
      throw new RehearsalOutputVerificationClientError("safe-failure");
    }
    return value;
  }

  async calculateMultiScenarioFeasibility(
    accessToken: string,
    request: BatchFeasibilityRequest,
  ): Promise<MultiScenarioFeasibilityResult> {
    if (
      !isBoundedBatchFeasibilityRequest(
        request,
        isSafeScenarioPlanningRequest,
      )
    ) {
      throw new BatchFeasibilityClientError("validation-refused");
    }
    let body: string;
    try {
      body = JSON.stringify(request);
    } catch {
      throw new BatchFeasibilityClientError("validation-refused");
    }
    if (
      new TextEncoder().encode(body).byteLength >
      BATCH_FEASIBILITY_MAX_REQUEST_BYTES
    ) {
      throw new BatchFeasibilityClientError("request-too-large");
    }

    let response: Response;
    try {
      response = await this.request(this.multiScenarioFeasibilityUrl, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw new BatchFeasibilityClientError("safe-failure");
    }
    if (response.status === 401) {
      throw new BatchFeasibilityClientError("unauthorized");
    }
    if (response.status === 403) {
      throw new BatchFeasibilityClientError("forbidden");
    }
    if (response.status === 413) {
      throw new BatchFeasibilityClientError("request-too-large");
    }
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        response.headers.get("content-type") ?? "",
      )
    ) {
      throw new BatchFeasibilityClientError("safe-failure");
    }

    let responseText: string;
    try {
      responseText = await readBoundedJsonResponse(
        response,
        BATCH_FEASIBILITY_MAX_RESPONSE_BYTES,
      );
    } catch (error) {
      throw new BatchFeasibilityClientError(
        error instanceof BoundedResponseTooLargeError
          ? "response-too-large"
          : "safe-failure",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(responseText) as unknown;
    } catch {
      throw new BatchFeasibilityClientError("safe-failure");
    }
    if (!response.ok) {
      if (
        response.status === 400 &&
        isScenarioRecord(value) &&
        hasExactScenarioKeys(value, ["error", "category"]) &&
        value.error === "batch_feasibility_refused" &&
        typeof value.category === "string" &&
        (
          SCENARIO_PLAN_REFUSAL_CATEGORIES.includes(
            value.category as ScenarioPlanErrorCategory,
          ) ||
          FEASIBILITY_INPUT_FAILURES.includes(
            value.category as FeasibilityInputFailure,
          )
        )
      ) {
        throw new BatchFeasibilityClientError(
          "validation-refused",
          value.category as
            | ScenarioPlanErrorCategory
            | FeasibilityInputFailure,
        );
      }
      if (
        response.status === 500 &&
        isScenarioRecord(value) &&
        hasExactScenarioKeys(value, ["error"]) &&
        value.error === "batch_feasibility_response_too_large"
      ) {
        throw new BatchFeasibilityClientError("response-too-large");
      }
      throw new BatchFeasibilityClientError("safe-failure");
    }
    if (
      response.status !== 200 ||
      !isSafeBatchFeasibilityResult(value, request)
    ) {
      throw new BatchFeasibilityClientError("safe-failure");
    }
    return value;
  }

  async sendSimulatedEmail(
    accessToken: string,
  ): Promise<SimulatedEmailResult> {
    const value = await this.getAuthorizedJson(
      this.simulatedEmailUrl,
      accessToken,
      "POST",
      202,
    );
    if (!isSafeSimulatedEmailResult(value)) {
      throw new ApiAccessError();
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
    const value = await this.getAuthorizedJson(
      this.helpDeskScenarioUrl,
      accessToken,
      "POST",
      202,
    );
    if (!isSafeHelpDeskScenarioResult(value)) {
      throw new ApiAccessError();
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
      "POST",
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
      "DELETE",
      200,
      "removed",
    );
    return { state: "removed", path: result.path };
  }

  async createCalendarMeeting(
    accessToken: string,
  ): Promise<Extract<CalendarMeetingResult, { state: "configured" }>> {
    const value = await this.getAuthorizedJson(
      this.calendarMeetingUrl,
      accessToken,
      "POST",
      201,
      "calendar",
    );
    if (!isSafeCalendarMeetingResult(value) || value.state !== "configured") {
      throw new ApiAccessError();
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
    const value = await this.getAuthorizedJson(
      this.calendarMeetingCancelUrl,
      accessToken,
      "POST",
      202,
      "calendar",
    );
    if (
      !isSafeCalendarMeetingResult(value) ||
      value.state !== "cancellation-accepted"
    ) {
      throw new ApiAccessError();
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
      this.contactProofUrl,
      accessToken,
      "POST",
      201,
      "configured",
      isSafeContactProofResult,
    );
  }

  async removeContactProof(
    accessToken: string,
  ): Promise<Extract<ContactProofResult, { state: "removed" }>> {
    return this.fixedProofRequest(
      this.contactProofUrl,
      accessToken,
      "DELETE",
      200,
      "removed",
      isSafeContactProofResult,
    );
  }

  private async fixedProofRequest<
    R extends { state: string },
    S extends R["state"],
  >(
    url: string,
    accessToken: string,
    method: "POST" | "DELETE",
    status: number,
    state: S,
    validate: (value: unknown) => value is R,
  ): Promise<Extract<R, { state: S }>> {
    const value = await this.getAuthorizedJson(url, accessToken, method, status);
    if (!validate(value) || value.state !== state) {
      throw new ApiAccessError();
    }
    return value as Extract<R, { state: S }>;
  }

  async createInboxRuleProof(accessToken: string) {
    return this.fixedProofRequest(
      this.inboxRuleProofUrl,
      accessToken,
      "POST",
      201,
      "configured",
      isSafeInboxRuleProofResult,
    );
  }

  async removeInboxRuleProof(accessToken: string) {
    return this.fixedProofRequest(
      this.inboxRuleProofUrl,
      accessToken,
      "DELETE",
      200,
      "removed",
      isSafeInboxRuleProofResult,
    );
  }

  async createCategoryProof(accessToken: string) {
    return this.fixedProofRequest(
      this.categoryProofUrl,
      accessToken,
      "POST",
      201,
      "configured",
      isSafeCategoryProofResult,
    );
  }

  async removeCategoryProof(accessToken: string) {
    return this.fixedProofRequest(
      this.categoryProofUrl,
      accessToken,
      "DELETE",
      200,
      "removed",
      isSafeCategoryProofResult,
    );
  }

  async createSharePointFileProof(accessToken: string) {
    await this.fixedProofRequest(
      this.sharePointFileProofUrl,
      accessToken,
      "POST",
      201,
      "configured",
      isSafeSharePointFileProofResult,
    );
    return { state: "configured", name: SHAREPOINT_FILE_PROOF_NAME } as const;
  }

  async removeSharePointFileProof(accessToken: string) {
    await this.fixedProofRequest(
      this.sharePointFileProofUrl,
      accessToken,
      "DELETE",
      200,
      "removed",
      isSafeSharePointFileProofResult,
    );
    return { state: "removed", name: SHAREPOINT_FILE_PROOF_NAME } as const;
  }

  async createDraftProof(accessToken: string) {
    await this.fixedProofRequest(
      this.draftProofUrl,
      accessToken,
      "POST",
      201,
      "configured",
      isSafeDraftProofResult,
    );
    return { state: "configured", subject: DRAFT_PROOF_SUBJECT } as const;
  }

  async removeDraftProof(accessToken: string) {
    await this.fixedProofRequest(
      this.draftProofUrl,
      accessToken,
      "DELETE",
      200,
      "removed",
      isSafeDraftProofResult,
    );
    return { state: "removed", subject: DRAFT_PROOF_SUBJECT } as const;
  }

  async createTodoTaskProof(accessToken: string) {
    await this.fixedProofRequest(
      this.todoTaskProofUrl,
      accessToken,
      "POST",
      201,
      "configured",
      isSafeTodoTaskProofResult,
    );
    return { state: "configured", title: TODO_TASK_PROOF_TITLE } as const;
  }

  async removeTodoTaskProof(accessToken: string) {
    await this.fixedProofRequest(
      this.todoTaskProofUrl,
      accessToken,
      "DELETE",
      200,
      "removed",
      isSafeTodoTaskProofResult,
    );
    return { state: "removed", title: TODO_TASK_PROOF_TITLE } as const;
  }

  private async oneDriveProofRequest<T extends OneDriveProofResult["state"]>(
    accessToken: string,
    method: "POST" | "DELETE",
    expectedStatus: number,
    expectedState: T,
  ): Promise<Extract<OneDriveProofResult, { state: T }>> {
    const value = await this.getAuthorizedJson(
      this.oneDriveProofUrl,
      accessToken,
      method,
      expectedStatus,
      expectedState === "configured"
        ? "onedrive-invite"
        : undefined,
    );
    if (!isSafeOneDriveProofResult(value) || value.state !== expectedState) {
      throw new ApiAccessError();
    }
    return value as Extract<OneDriveProofResult, { state: T }>;
  }

  private async getAuthorizedJson(
    url: string,
    accessToken: string,
    method = "GET",
    expectedStatus?: number,
    failureContext?: "onedrive-invite" | "calendar",
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(url, {
        method,
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      throw new ApiAccessError();
    }

    if (response.status === 401) {
      throw new ApiAccessError("API access needs Microsoft authorization. Try again.");
    }
    if (response.status === 403) {
      throw new ApiAccessError("This account is not allowed to use the API.");
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
    return value;
  }
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

const SCENARIO_PLAN_ACTOR_ROLES = [
  "evidenceProducer",
  "workloadActor",
  "learner",
  "detector",
  "responder",
  "cleanupOwner",
] as const;
const SCENARIO_PLAN_ROLES = [
  "system",
  ...SCENARIO_PLAN_ACTOR_ROLES,
] as const;
const SCENARIO_PLAN_PHASES = [
  "preflight",
  "producer-operation",
  "authentic-evidence",
  "learner-interpretation",
  "optional-response",
  "expiry",
  "cleanup",
  "retention",
  "terminal-verification",
] as const;
const SCENARIO_PLAN_EXECUTIONS = [
  "automated",
  "declarative",
  "human-only",
  "pre-seeded-reference",
] as const;
const SCENARIO_PLAN_REFUSAL_CATEGORIES = [
  "ACTOR_BINDING_INVALID",
  "BUDGET_EXCEEDED",
  "CLEANUP_MISSING",
  "EXPIRY_INVALID",
  "INPUT_INVALID",
  "INTERPRETATION_MISSING",
  "MANIFEST_INVALID",
  "RAW_IDENTIFIER_REJECTED",
  "RESPONSE_NOT_ALLOWED",
  "RETENTION_CONFLICT",
  "ROLE_CONFLATION",
  "SELF_TRIGGER_UNDECLARED",
  "TERMINAL_PROOF_MISSING",
  "UNKNOWN_SCENARIO",
] as const satisfies readonly ScenarioPlanErrorCategory[];
const SAFE_SCENARIO_VALUE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_SCENARIO_ALIAS = /^[a-z][a-z0-9-]{1,63}$/;
const RAW_SCENARIO_IDENTIFIER =
  /(?:@|[\\/]|onmicrosoft|tenant|subscription|object-?id|message-?id|userprincipal|credential|certificate|access-?token|refresh-?token|session|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

export function isSafeScenarioPlanningRequest(
  value: unknown,
): value is ScenarioPlanningRequest {
  if (
    !isScenarioRecord(value) ||
    !hasOnlyKeys(value, [
      "scenarioId",
      "actorAliases",
      "now",
      "expiresAt",
      "maximumBudgetUsd",
      "selectedResponseId",
    ]) ||
    !isSafeScenarioValue(value.scenarioId) ||
    !isUtcTimestamp(value.now) ||
    !isUtcTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.now) ||
    typeof value.maximumBudgetUsd !== "number" ||
    !Number.isFinite(value.maximumBudgetUsd) ||
    value.maximumBudgetUsd < 0 ||
    value.maximumBudgetUsd > 1_000_000 ||
    !isScenarioRecord(value.actorAliases)
  ) {
    return false;
  }
  const aliases = Object.entries(value.actorAliases);
  if (
    aliases.length === 0 ||
    aliases.length > 6 ||
    aliases.some(
      ([role, alias]) =>
        !SCENARIO_PLAN_ACTOR_ROLES.includes(
          role as (typeof SCENARIO_PLAN_ACTOR_ROLES)[number],
        ) ||
        typeof alias !== "string" ||
        !SAFE_SCENARIO_ALIAS.test(alias) ||
        RAW_SCENARIO_IDENTIFIER.test(alias),
    )
  ) {
    return false;
  }
  return (
    value.selectedResponseId === undefined ||
    isSafeScenarioValue(value.selectedResponseId)
  );
}

function isSafeScenarioExecutionPlan(
  value: unknown,
  request: ScenarioPlanningRequest,
): value is ScenarioExecutionPlan {
  if (
    !isScenarioRecord(value) ||
    !hasExactScenarioKeys(value, [
      "schemaVersion",
      "kind",
      "scenarioId",
      "generatedAt",
      "expiresAt",
      "actorAliases",
      "budget",
      "selectedResponseId",
      "steps",
      "terminalProof",
      "digestSha256",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "scenario-execution-plan" ||
    value.scenarioId !== request.scenarioId ||
    value.generatedAt !== request.now ||
    value.expiresAt !== request.expiresAt ||
    value.selectedResponseId !== (request.selectedResponseId ?? null) ||
    !/^[0-9a-f]{64}$/.test(String(value.digestSha256)) ||
    !hasMatchingScenarioAliases(value.actorAliases, request.actorAliases)
  ) {
    return false;
  }
  if (
    !isScenarioRecord(value.budget) ||
    !hasExactScenarioKeys(value.budget, [
      "currency",
      "plannedMaximum",
      "suppliedCeiling",
    ]) ||
    value.budget.currency !== "USD" ||
    value.budget.suppliedCeiling !== request.maximumBudgetUsd ||
    typeof value.budget.plannedMaximum !== "number" ||
    !Number.isFinite(value.budget.plannedMaximum) ||
    value.budget.plannedMaximum < 0 ||
    value.budget.plannedMaximum > request.maximumBudgetUsd
  ) {
    return false;
  }
  if (
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    value.steps.length > 256 ||
    !value.steps.every((step, index) =>
      isSafeScenarioPlanStep(step, index + 1, request.actorAliases)
    )
  ) {
    return false;
  }
  const proof = value.terminalProof;
  return (
    isScenarioRecord(proof) &&
    hasExactScenarioKeys(proof, [
      "cleanupOperationKeys",
      "evidenceArtifactIds",
      "observationOperationKeys",
      "retainedArtifactIds",
      "requiredResult",
    ]) &&
    proof.requiredResult === "reconciled" &&
    ["cleanupOperationKeys", "evidenceArtifactIds", "observationOperationKeys",
      "retainedArtifactIds"].every((key) =>
        isSafeScenarioStringArray(proof[key]),
      )
  );
}

function isSafeScenarioPlanStep(
  value: unknown,
  sequence: number,
  actorAliases: ScenarioPlanningRequest["actorAliases"],
): boolean {
  if (
    !isScenarioRecord(value) ||
    !hasOnlyKeys(value, [
      "sequence",
      "id",
      "phase",
      "owningRole",
      "actorAlias",
      "operationCategory",
      "operationKey",
      "execution",
      "humanOnlyGate",
      "ambiguityBehavior",
      "recoveryBehavior",
      "evidenceExpectation",
      "retention",
    ]) ||
    value.sequence !== sequence ||
    !isSafeScenarioValue(value.id) ||
    !SCENARIO_PLAN_PHASES.includes(
      value.phase as (typeof SCENARIO_PLAN_PHASES)[number],
    ) ||
    !SCENARIO_PLAN_ROLES.includes(
      value.owningRole as (typeof SCENARIO_PLAN_ROLES)[number],
    ) ||
    !isSafeScenarioValue(value.operationCategory) ||
    !isSafeScenarioValue(value.operationKey) ||
    !SCENARIO_PLAN_EXECUTIONS.includes(
      value.execution as (typeof SCENARIO_PLAN_EXECUTIONS)[number],
    ) ||
    typeof value.humanOnlyGate !== "boolean" ||
    ![
      "bounded-read-retry",
      "fail-closed",
      "not-applicable",
      "stop-and-reconcile",
    ].includes(String(value.ambiguityBehavior)) ||
    ![
      "none",
      "read-only-reconcile-no-replay",
      "retry-within-read-budget",
      "stop-on-mismatch",
    ].includes(String(value.recoveryBehavior))
  ) {
    return false;
  }
  const owningRole = value.owningRole as
    (typeof SCENARIO_PLAN_ROLES)[number];
  const expectedAlias = owningRole === "system"
    ? undefined
    : actorAliases[owningRole];
  if (
    value.actorAlias !== expectedAlias ||
    (value.actorAlias !== undefined &&
      (typeof value.actorAlias !== "string" ||
        !SAFE_SCENARIO_ALIAS.test(value.actorAlias) ||
        RAW_SCENARIO_IDENTIFIER.test(value.actorAlias)))
  ) {
    return false;
  }
  return (
    (value.evidenceExpectation === undefined ||
      isSafeEvidenceExpectation(value.evidenceExpectation)) &&
    (value.retention === undefined || isSafeRetention(value.retention))
  );
}

function hasMatchingScenarioAliases(
  value: unknown,
  expected: ScenarioPlanningRequest["actorAliases"],
): boolean {
  if (!isScenarioRecord(value)) {
    return false;
  }
  const expectedRoles = SCENARIO_PLAN_ACTOR_ROLES.filter(
    (role) => expected[role] !== undefined,
  );
  return (
    Object.keys(value).length === expectedRoles.length &&
    expectedRoles.every((role) => value[role] === expected[role])
  );
}

function isSafeEvidenceExpectation(value: unknown): boolean {
  return (
    isScenarioRecord(value) &&
    hasExactScenarioKeys(value, [
      "artifactId",
      "artifactKind",
      "authenticity",
      "evidenceMode",
      "learnerVisibility",
      "semanticClaims",
    ]) &&
    isSafeScenarioValue(value.artifactId) &&
    isSafeScenarioValue(value.artifactKind) &&
    isSafeScenarioValue(value.authenticity) &&
    (value.evidenceMode === "planned" ||
      value.evidenceMode === "pre-seeded") &&
    isSafeScenarioValue(value.learnerVisibility) &&
    isSafeScenarioStringArray(value.semanticClaims)
  );
}

function isSafeRetention(value: unknown): boolean {
  return (
    isScenarioRecord(value) &&
    hasOnlyKeys(value, [
      "artifactId",
      "disposition",
      "cleanupOperationKey",
    ]) &&
    isSafeScenarioValue(value.artifactId) &&
    isSafeScenarioValue(value.disposition) &&
    (value.cleanupOperationKey === undefined ||
      isSafeScenarioValue(value.cleanupOperationKey))
  );
}

function isSafeScenarioStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(isSafeScenarioValue)
  );
}

function isSafeScenarioValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_SCENARIO_VALUE.test(value) &&
    !RAW_SCENARIO_IDENTIFIER.test(value)
  );
}

function isUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isScenarioRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactScenarioKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    hasOnlyKeys(value, expected)
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
