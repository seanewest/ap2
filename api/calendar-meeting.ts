import {
  CORY_USER_PRINCIPAL_NAME,
  KOBE_USER_PRINCIPAL_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  type DelegatedGraphToken,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_EVENTS_URL = `${GRAPH_ROOT}/me/events`;

export const GRAPH_CALENDARS_READ_WRITE_SCOPE =
  "https://graph.microsoft.com/Calendars.ReadWrite";
export const CALENDAR_MEETING_RUN_ID = "ap2-calendar-20260724-002";
export const CALENDAR_MEETING_RUN_PROPERTY_ID =
  "String {c352ae90-352e-4c3f-8f7c-ab63d2ca32cc} Name AP2RunId";
export const CALENDAR_MEETING_TRANSACTION_ID =
  "cfc3b7d3-2ab8-4ec0-b93a-9ea24fcb5ba4";
export const CALENDAR_MEETING_SUBJECT =
  "AP2 Pass 3 calendar rehearsal — no action required";
export const CALENDAR_MEETING_BODY =
  "Harmless AP2 calendar rehearsal. No action or response is required. The organizer will cancel it after observation.";
export const CALENDAR_MEETING_START = "2026-07-24T19:00:00Z";
export const CALENDAR_MEETING_END = "2026-07-24T19:15:00Z";
export const CALENDAR_MEETING_TIME_ZONE = "UTC";
export const CALENDAR_MEETING_CANCEL_COMMENT =
  "AP2 Pass 3 calendar rehearsal complete. No action is required.";
export const CALENDAR_MEETING_ATTENDEES = [
  KOBE_USER_PRINCIPAL_NAME,
  MARGE_USER_PRINCIPAL_NAME,
] as const;

export type CalendarMeetingResult =
  | {
      state: "configured";
      organizer: typeof CORY_USER_PRINCIPAL_NAME;
      attendees: typeof CALENDAR_MEETING_ATTENDEES;
      subject: typeof CALENDAR_MEETING_SUBJECT;
      start: typeof CALENDAR_MEETING_START;
      end: typeof CALENDAR_MEETING_END;
    }
  | {
      state: "cancellation-accepted";
      organizer: typeof CORY_USER_PRINCIPAL_NAME;
      subject: typeof CALENDAR_MEETING_SUBJECT;
    };

export interface CalendarMeetingOperation {
  create(): Promise<Extract<CalendarMeetingResult, { state: "configured" }>>;
  cancel(): Promise<
    Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
  >;
}

export class CalendarMeetingConflictError extends Error {
  constructor() {
    super("The fixed calendar meeting is not in the expected state.");
    this.name = "CalendarMeetingConflictError";
  }
}

export class CalendarMeetingBusyError extends Error {
  constructor() {
    super("Another calendar meeting operation is already running.");
    this.name = "CalendarMeetingBusyError";
  }
}

type CalendarMeetingStage =
  | "not-started"
  | "uncertain"
  | "configured"
  | "cancellation-uncertain"
  | "cancellation-accepted";

export class ProcessLocalCalendarMeetingBoundary
  implements CalendarMeetingOperation
{
  readonly #operation: CalendarMeetingOperation;
  #stage: CalendarMeetingStage = "not-started";
  #busy = false;

  constructor(operation: CalendarMeetingOperation) {
    this.#operation = operation;
  }

  create(): ReturnType<CalendarMeetingOperation["create"]> {
    if (this.#busy) {
      throw new CalendarMeetingBusyError();
    }
    if (this.#stage !== "not-started") {
      throw new CalendarMeetingConflictError();
    }
    return this.#run(
      "uncertain",
      "configured",
      () => this.#operation.create(),
    );
  }

  cancel(): ReturnType<CalendarMeetingOperation["cancel"]> {
    if (this.#busy) {
      throw new CalendarMeetingBusyError();
    }
    if (
      this.#stage === "cancellation-uncertain" ||
      this.#stage === "cancellation-accepted"
    ) {
      throw new CalendarMeetingConflictError();
    }
    return this.#run(
      "cancellation-uncertain",
      "cancellation-accepted",
      () => this.#operation.cancel(),
    );
  }

  async #run<T>(
    attemptedStage: CalendarMeetingStage,
    completedStage: CalendarMeetingStage,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.#busy = true;
    this.#stage = attemptedStage;
    try {
      const result = await operation();
      this.#stage = completedStage;
      return result;
    } finally {
      this.#busy = false;
    }
  }
}

export class DelegatedGraphCalendarMeetingOperation
  implements CalendarMeetingOperation
{
  readonly #tokenProvider: DelegatedGraphTokenProvider;
  readonly #coryIdentity: SimulatedUserIdentity;
  readonly #request: typeof fetch;
  #eventId: string | undefined;

  constructor(
    tokenProvider: DelegatedGraphTokenProvider,
    coryIdentity: SimulatedUserIdentity,
    request: typeof fetch = fetch,
  ) {
    if (coryIdentity.userPrincipalName !== CORY_USER_PRINCIPAL_NAME) {
      throw new TypeError("The calendar organizer must be Cory West.");
    }
    this.#tokenProvider = tokenProvider;
    this.#coryIdentity = coryIdentity;
    this.#request = request.bind(globalThis);
  }

  async create(): Promise<
    Extract<CalendarMeetingResult, { state: "configured" }>
  > {
    if (this.#eventId) {
      throw new CalendarMeetingConflictError();
    }
    const cory = await this.#coryToken();
    const response = await this.#request(GRAPH_EVENTS_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${cory.token}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.timezone="UTC"',
      },
      body: JSON.stringify(fixedMeetingRequest()),
    });
    const value = await readJson(response);
    if (response.status !== 201 || !isExactCreatedMeeting(value)) {
      throw new Error(
        `Microsoft Graph calendar creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    this.#eventId = value.id;
    return configuredResult();
  }

  async cancel(): Promise<
    Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
  > {
    const cory = await this.#coryToken();
    const eventId = this.#eventId ?? await this.#recoverEventId(cory);
    const response = await this.#request(
      `${GRAPH_EVENTS_URL}/${encodeURIComponent(eventId)}/cancel`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${cory.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment: CALENDAR_MEETING_CANCEL_COMMENT }),
      },
    );
    if (response.status !== 202) {
      throw new Error(
        `Microsoft Graph calendar cancellation returned HTTP ${response.status}.`,
      );
    }
    return {
      state: "cancellation-accepted",
      organizer: CORY_USER_PRINCIPAL_NAME,
      subject: CALENDAR_MEETING_SUBJECT,
    };
  }

  async #recoverEventId(cory: DelegatedGraphToken): Promise<string> {
    const url = new URL(GRAPH_EVENTS_URL);
    url.searchParams.set(
      "$filter",
      `singleValueExtendedProperties/Any(ep: ep/id eq '${CALENDAR_MEETING_RUN_PROPERTY_ID}' and ep/value eq '${CALENDAR_MEETING_RUN_ID}')`,
    );
    url.searchParams.set(
      "$select",
      [
        "id",
        "subject",
        "body",
        "bodyPreview",
        "start",
        "end",
        "attendees",
        "organizer",
        "isOrganizer",
        "type",
        "showAs",
        "isReminderOn",
        "responseRequested",
        "allowNewTimeProposals",
        "importance",
        "sensitivity",
        "isOnlineMeeting",
        "hasAttachments",
        "recurrence",
        "location",
        "transactionId",
        "isCancelled",
      ].join(","),
    );
    url.searchParams.set(
      "$expand",
      `singleValueExtendedProperties($filter=id eq '${CALENDAR_MEETING_RUN_PROPERTY_ID}')`,
    );
    url.searchParams.set("$top", "2");
    const response = await this.#request(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${cory.token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    const value = await readJson(response);
    if (
      response.status !== 200 ||
      !isRecord(value) ||
      !Array.isArray(value.value) ||
      value.value.length !== 1 ||
      value["@odata.nextLink"] !== undefined ||
      !isExactRecoverableMeeting(value.value[0])
    ) {
      throw new CalendarMeetingConflictError();
    }
    this.#eventId = value.value[0].id;
    return value.value[0].id;
  }

  async #coryToken(): Promise<DelegatedGraphToken> {
    const token = await this.#tokenProvider.getToken(
      GRAPH_CALENDARS_READ_WRITE_SCOPE,
    );
    if (
      !token?.token ||
      token.identity.tenantId !== this.#coryIdentity.tenantId ||
      token.identity.objectId !== this.#coryIdentity.objectId ||
      token.identity.userPrincipalName.toLowerCase() !==
        CORY_USER_PRINCIPAL_NAME
    ) {
      throw new Error("Delegated Graph token is not for Cory West.");
    }
    return token;
  }
}

function fixedMeetingRequest(): Record<string, unknown> {
  return {
    subject: CALENDAR_MEETING_SUBJECT,
    body: {
      contentType: "text",
      content: CALENDAR_MEETING_BODY,
    },
    start: {
      dateTime: CALENDAR_MEETING_START.slice(0, -1),
      timeZone: CALENDAR_MEETING_TIME_ZONE,
    },
    end: {
      dateTime: CALENDAR_MEETING_END.slice(0, -1),
      timeZone: CALENDAR_MEETING_TIME_ZONE,
    },
    attendees: CALENDAR_MEETING_ATTENDEES.map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
    showAs: "free",
    isReminderOn: false,
    responseRequested: false,
    allowNewTimeProposals: false,
    importance: "low",
    sensitivity: "normal",
    isOnlineMeeting: false,
    transactionId: CALENDAR_MEETING_TRANSACTION_ID,
    singleValueExtendedProperties: [
      {
        id: CALENDAR_MEETING_RUN_PROPERTY_ID,
        value: CALENDAR_MEETING_RUN_ID,
      },
    ],
  };
}

function configuredResult(): Extract<
  CalendarMeetingResult,
  { state: "configured" }
> {
  return {
    state: "configured",
    organizer: CORY_USER_PRINCIPAL_NAME,
    attendees: CALENDAR_MEETING_ATTENDEES,
    subject: CALENDAR_MEETING_SUBJECT,
    start: CALENDAR_MEETING_START,
    end: CALENDAR_MEETING_END,
  };
}

function isExactCreatedMeeting(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  if (!isRecord(value) || !nonEmpty(value.id)) {
    return false;
  }
  return (
    value.subject === CALENDAR_MEETING_SUBJECT &&
    isExactBody(value.body, value.bodyPreview) &&
    isExactDateTime(value.start, CALENDAR_MEETING_START) &&
    isExactDateTime(value.end, CALENDAR_MEETING_END) &&
    isExactAttendees(value.attendees) &&
    isExactOrganizer(value.organizer) &&
    value.isOrganizer === true &&
    value.type === "singleInstance" &&
    value.showAs === "free" &&
    value.isReminderOn === false &&
    value.responseRequested === false &&
    value.allowNewTimeProposals === false &&
    value.importance === "low" &&
    value.sensitivity === "normal" &&
    value.isOnlineMeeting === false &&
    value.hasAttachments === false &&
    (value.recurrence === null || value.recurrence === undefined) &&
    noLocation(value.location) &&
    value.transactionId === CALENDAR_MEETING_TRANSACTION_ID
  );
}

function isExactBody(value: unknown, bodyPreview: unknown): boolean {
  if (!isRecord(value) || typeof value.content !== "string") {
    return false;
  }
  if (value.contentType === "text") {
    return value.content === CALENDAR_MEETING_BODY;
  }
  return (
    value.contentType === "html" &&
    bodyPreview === CALENDAR_MEETING_BODY
  );
}

function isExactRecoverableMeeting(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return (
    isExactCreatedMeeting(value) &&
    value.isCancelled === false &&
    isExactRunMarker(value.singleValueExtendedProperties)
  );
}

function isExactRunMarker(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    isRecord(value[0]) &&
    value[0].id === CALENDAR_MEETING_RUN_PROPERTY_ID &&
    value[0].value === CALENDAR_MEETING_RUN_ID
  );
}

function isExactDateTime(value: unknown, expected: string): boolean {
  if (
    !isRecord(value) ||
    value.timeZone !== CALENDAR_MEETING_TIME_ZONE ||
    typeof value.dateTime !== "string"
  ) {
    return false;
  }
  const normalized = value.dateTime.endsWith("Z")
    ? value.dateTime
    : `${value.dateTime}Z`;
  return Date.parse(normalized) === Date.parse(expected);
}

function isExactAttendees(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== CALENDAR_MEETING_ATTENDEES.length) {
    return false;
  }
  const addresses = value.map((attendee) => {
    if (
      !isRecord(attendee) ||
      attendee.type !== "required" ||
      !isRecord(attendee.emailAddress) ||
      typeof attendee.emailAddress.address !== "string"
    ) {
      return undefined;
    }
    return attendee.emailAddress.address.toLowerCase();
  });
  return (
    addresses.every((address): address is string => address !== undefined) &&
    CALENDAR_MEETING_ATTENDEES.every((address) =>
      addresses.includes(address),
    )
  );
}

function isExactOrganizer(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.emailAddress) &&
    typeof value.emailAddress.address === "string" &&
    value.emailAddress.address.toLowerCase() === CORY_USER_PRINCIPAL_NAME
  );
}

function noLocation(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      (value.displayName === undefined || value.displayName === "") &&
      (value.locationUri === undefined || value.locationUri === ""))
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
