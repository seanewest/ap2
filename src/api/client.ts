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

export interface SimulatedEmailResult {
  accepted: true;
  sender: string;
  recipient: string;
  subject: string;
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
  sendSimulatedEmail(accessToken: string): Promise<SimulatedEmailResult>;
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
}

export class ApiAccessError extends Error {
  constructor(message = "The API could not complete the access check. Try again.") {
    super(message);
    this.name = "ApiAccessError";
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
  private readonly simulatedEmailUrl: string;
  private readonly oneDriveProofUrl: string;
  private readonly calendarMeetingUrl: string;
  private readonly calendarMeetingCancelUrl: string;
  private readonly contactProofUrl: string;
  private readonly inboxRuleProofUrl: string;
  private readonly categoryProofUrl: string;
  private readonly request: typeof fetch;

  constructor(baseUrl: string, request: typeof fetch = fetch) {
    this.whoAmIUrl = new URL("api/whoami", `${baseUrl}/`).toString();
    this.rehearsalStatusUrl = new URL(
      "api/rehearsal-status",
      `${baseUrl}/`,
    ).toString();
    this.simulatedEmailUrl = new URL(
      "api/simulated-email",
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
