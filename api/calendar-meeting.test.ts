// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  CALENDAR_MEETING_ATTENDEES,
  CALENDAR_MEETING_BODY,
  CALENDAR_MEETING_CANCEL_COMMENT,
  CALENDAR_MEETING_END,
  CALENDAR_MEETING_START,
  CALENDAR_MEETING_SUBJECT,
  CALENDAR_MEETING_TRANSACTION_ID,
  CalendarMeetingBusyError,
  CalendarMeetingConflictError,
  DelegatedGraphCalendarMeetingOperation,
  GRAPH_CALENDARS_READ_WRITE_SCOPE,
  ProcessLocalCalendarMeetingBoundary,
  type CalendarMeetingOperation,
  type CalendarMeetingResult,
} from "./calendar-meeting.js";
import {
  CORY_USER_PRINCIPAL_NAME,
  coryIdentity,
  type DelegatedGraphToken,
} from "./simulated-user.js";

const CORY_OBJECT_ID = "11111111-1111-4111-8111-111111111111";
const cory = coryIdentity(CORY_OBJECT_ID);
const coryToken: DelegatedGraphToken = {
  token: "cory-calendar-token",
  identity: {
    tenantId: STUDENT_TENANT_ID,
    objectId: CORY_OBJECT_ID,
    userPrincipalName: CORY_USER_PRINCIPAL_NAME,
  },
};

const configuredResult = {
  state: "configured",
  organizer: CORY_USER_PRINCIPAL_NAME,
  attendees: CALENDAR_MEETING_ATTENDEES,
  subject: CALENDAR_MEETING_SUBJECT,
  start: CALENDAR_MEETING_START,
  end: CALENDAR_MEETING_END,
} as const satisfies CalendarMeetingResult;

const cancellationResult = {
  state: "cancellation-accepted",
  organizer: CORY_USER_PRINCIPAL_NAME,
  subject: CALENDAR_MEETING_SUBJECT,
} as const satisfies CalendarMeetingResult;

function createdMeeting(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "event/id",
    subject: CALENDAR_MEETING_SUBJECT,
    body: {
      contentType: "text",
      content: CALENDAR_MEETING_BODY,
    },
    start: {
      dateTime: "2026-07-24T18:00:00.0000000",
      timeZone: "UTC",
    },
    end: {
      dateTime: "2026-07-24T18:15:00.0000000",
      timeZone: "UTC",
    },
    attendees: CALENDAR_MEETING_ATTENDEES.map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
    organizer: {
      emailAddress: { address: CORY_USER_PRINCIPAL_NAME },
    },
    isOrganizer: true,
    type: "singleInstance",
    showAs: "free",
    isReminderOn: false,
    responseRequested: false,
    allowNewTimeProposals: false,
    importance: "low",
    sensitivity: "normal",
    isOnlineMeeting: false,
    hasAttachments: false,
    recurrence: null,
    location: { displayName: "", locationUri: "" },
    transactionId: CALENDAR_MEETING_TRANSACTION_ID,
    ...overrides,
  };
}

function graphNormalizedHtml(
  content = CALENDAR_MEETING_BODY,
  documentedAsciiMeta = false,
): string {
  return [
    "<html>",
    "<head>",
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    ...(documentedAsciiMeta
      ? ['<meta content="text/html; charset=us-ascii">']
      : []),
    "</head>",
    "<body>",
    `<div>${content}</div>`,
    "</body>",
    "</html>",
  ].join("\r\n");
}

function broaderGraphHtml(): string {
  return [
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    "<style>p { margin: 0; }</style></head>",
    '<body dir="ltr"><div style="font-family: Aptos, sans-serif">',
    `<p><span>${CALENDAR_MEETING_BODY}</span></p>`,
    "</div></body></html>",
  ].join("");
}

describe("delegated Graph calendar meeting operation", () => {
  it("creates the exact harmless meeting once and returns only safe fields", async () => {
    const tokenProvider = {
      getToken: vi.fn().mockResolvedValue(coryToken),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(createdMeeting(), { status: 201 }));
    const operation = new DelegatedGraphCalendarMeetingOperation(
      tokenProvider,
      cory,
      request,
    );

    await expect(operation.create()).resolves.toEqual(configuredResult);

    expect(tokenProvider.getToken).toHaveBeenCalledOnce();
    expect(tokenProvider.getToken).toHaveBeenCalledWith(
      GRAPH_CALENDARS_READ_WRITE_SCOPE,
    );
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/events");
    expect(init).toEqual({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-calendar-token",
        "Content-Type": "application/json",
        Prefer: 'outlook.timezone="UTC"',
      },
      body: expect.any(String),
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      subject: CALENDAR_MEETING_SUBJECT,
      body: {
        contentType: "text",
        content: CALENDAR_MEETING_BODY,
      },
      start: { dateTime: "2026-07-24T18:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-07-24T18:15:00", timeZone: "UTC" },
      attendees: [
        {
          emailAddress: { address: "kobe@corywest.onmicrosoft.com" },
          type: "required",
        },
        {
          emailAddress: {
            address: "marge.simpson@corywest.onmicrosoft.com",
          },
          type: "required",
        },
      ],
      showAs: "free",
      isReminderOn: false,
      responseRequested: false,
      allowNewTimeProposals: false,
      importance: "low",
      sensitivity: "normal",
      isOnlineMeeting: false,
      transactionId: CALENDAR_MEETING_TRANSACTION_ID,
    });
    expect(body).not.toHaveProperty("location");
    expect(body).not.toHaveProperty("recurrence");
    expect(body).not.toHaveProperty("attachments");
    expect(JSON.stringify(configuredResult)).not.toContain("event/id");
    expect(JSON.stringify(configuredResult)).not.toContain(
      "cory-calendar-token",
    );
  });

  it("accepts Graph HTML when the full approved body preview remains exact", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          createdMeeting({
            body: {
              contentType: "html",
              content: graphNormalizedHtml(),
            },
            bodyPreview: CALENDAR_MEETING_BODY,
          }),
          { status: 201 },
        ),
      );
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.create()).resolves.toEqual(configuredResult);
    expect(request).toHaveBeenCalledOnce();
  });

  it("accepts the broader valid HTML representation observed from Graph", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          createdMeeting({
            body: {
              contentType: "html",
              content: broaderGraphHtml(),
            },
            bodyPreview: CALENDAR_MEETING_BODY,
          }),
          { status: 201 },
        ),
      );
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.create()).resolves.toEqual(configuredResult);
    expect(request).toHaveBeenCalledOnce();
  });

  it("accepts the documented two-meta Graph wrapper and retains its event ID for cancellation", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          createdMeeting({
            body: {
              contentType: "html",
              content: graphNormalizedHtml(
                CALENDAR_MEETING_BODY,
                true,
              ),
            },
            bodyPreview: CALENDAR_MEETING_BODY,
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.create()).resolves.toEqual(configuredResult);
    await expect(operation.cancel()).resolves.toEqual(cancellationResult);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/me/events/event%2Fid/cancel",
    );
  });

  it.each([
    [
      "another tenant",
      { ...coryToken, identity: { ...coryToken.identity, tenantId: "other" } },
    ],
    [
      "another object",
      {
        ...coryToken,
        identity: { ...coryToken.identity, objectId: "another-object" },
      },
    ],
    [
      "another UPN",
      {
        ...coryToken,
        identity: {
          ...coryToken.identity,
          userPrincipalName: "not-cory@corywest.onmicrosoft.com",
        },
      },
    ],
  ])("does not call Graph for %s", async (_label, token) => {
    const request = vi.fn<typeof fetch>();
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(token) },
      cory,
      request,
    );

    await expect(operation.create()).rejects.toThrow(
      "Delegated Graph token is not for Cory West.",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong subject", { subject: "Another meeting" }],
    [
      "extra attendee",
      {
        attendees: [
          ...createdMeeting().attendees as unknown[],
          {
            emailAddress: { address: "other@corywest.onmicrosoft.com" },
            type: "required",
          },
        ],
      },
    ],
    ["wrong transaction", { transactionId: "another" }],
    ["online meeting", { isOnlineMeeting: true }],
    ["recurring meeting", { recurrence: { pattern: {} } }],
    ["wrong body", { body: { contentType: "text", content: "wrong" } }],
    [
      "wrong HTML preview",
      {
        body: {
          contentType: "html",
          content: graphNormalizedHtml(),
        },
        bodyPreview: "Different calendar content.",
      },
    ],
    [
      "missing HTML content",
      {
        body: {
          contentType: "html",
          content: undefined,
        },
        bodyPreview: CALENDAR_MEETING_BODY,
      },
    ],
    [
      "undocumented body content type",
      {
        body: {
          contentType: "markdown",
          content: CALENDAR_MEETING_BODY,
        },
        bodyPreview: CALENDAR_MEETING_BODY,
      },
    ],
  ])("fails closed on a 201 with %s", async (_label, overrides) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(createdMeeting(overrides), { status: 201 }),
      );
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.create()).rejects.toThrow("unconfirmed HTTP 201");
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not retry a rejected create", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "throttled" }, { status: 429 }));
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.create()).rejects.toThrow("unconfirmed HTTP 429");
    expect(request).toHaveBeenCalledOnce();
  });

  it("cancels only the retained validated event once with the fixed comment", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(createdMeeting(), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await operation.create();
    await expect(operation.cancel()).resolves.toEqual(cancellationResult);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "https://graph.microsoft.com/v1.0/me/events/event%2Fid/cancel",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer cory-calendar-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment: CALENDAR_MEETING_CANCEL_COMMENT }),
      },
    );
    expect(JSON.stringify(cancellationResult)).not.toContain("event/id");
  });

  it("recovers one exact existing event and cancels it once", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          value: [
            createdMeeting({
              body: {
                contentType: "html",
                content: broaderGraphHtml(),
              },
              bodyPreview: CALENDAR_MEETING_BODY,
              isCancelled: false,
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const tokenProvider = {
      getToken: vi.fn().mockResolvedValue(coryToken),
    };
    const operation = new DelegatedGraphCalendarMeetingOperation(
      tokenProvider,
      cory,
      request,
    );

    await expect(operation.cancel()).resolves.toEqual(cancellationResult);

    expect(tokenProvider.getToken).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    const [recoveryUrl, recoveryInit] = request.mock.calls[0]!;
    expect(recoveryUrl).toBeInstanceOf(URL);
    const url = recoveryUrl as URL;
    expect(url.origin + url.pathname).toBe(
      "https://graph.microsoft.com/v1.0/me/calendarView",
    );
    expect(url.searchParams.get("startDateTime")).toBe(
      CALENDAR_MEETING_START,
    );
    expect(url.searchParams.get("endDateTime")).toBe(CALENDAR_MEETING_END);
    expect(url.searchParams.get("$top")).toBe("2");
    expect(url.searchParams.get("$select")).toContain("transactionId");
    expect(url.searchParams.get("$select")).toContain("isCancelled");
    expect(recoveryInit).toEqual({
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-calendar-token",
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    expect(request.mock.calls[1]).toEqual([
      "https://graph.microsoft.com/v1.0/me/events/event%2Fid/cancel",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer cory-calendar-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          comment: CALENDAR_MEETING_CANCEL_COMMENT,
        }),
      },
    ]);
  });

  it.each([
    ["zero events", []],
    [
      "duplicate exact events",
      [
        createdMeeting({ id: "event-one", isCancelled: false }),
        createdMeeting({ id: "event-two", isCancelled: false }),
      ],
    ],
    [
      "one mismatched event",
      [
        createdMeeting({
          subject: "Another meeting",
          isCancelled: false,
        }),
      ],
    ],
    [
      "one cancelled event",
      [createdMeeting({ isCancelled: true })],
    ],
  ])("does not mutate when recovery finds %s", async (_label, events) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ value: events }));
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.cancel()).rejects.toBeInstanceOf(
      CalendarMeetingConflictError,
    );
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("does not mutate when recovery pagination makes the result ambiguous", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          value: [createdMeeting({ isCancelled: false })],
          "@odata.nextLink": "https://graph.microsoft.com/next",
        }),
      );
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await expect(operation.cancel()).rejects.toBeInstanceOf(
      CalendarMeetingConflictError,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not retry a rejected cancellation", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(createdMeeting(), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const operation = new DelegatedGraphCalendarMeetingOperation(
      { getToken: vi.fn().mockResolvedValue(coryToken) },
      cory,
      request,
    );

    await operation.create();
    await expect(operation.cancel()).rejects.toThrow("returned HTTP 503");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("process-local calendar meeting boundary", () => {
  it("serializes callers and permits only one create and one cancel", async () => {
    const create = deferred<
      Extract<CalendarMeetingResult, { state: "configured" }>
    >();
    const cancel = deferred<
      Extract<CalendarMeetingResult, { state: "cancellation-accepted" }>
    >();
    const inner: CalendarMeetingOperation = {
      create: vi.fn(() => create.promise),
      cancel: vi.fn(() => cancel.promise),
    };
    const boundary = new ProcessLocalCalendarMeetingBoundary(inner);

    const firstCreate = boundary.create();
    expect(() => boundary.create()).toThrow(CalendarMeetingBusyError);
    expect(() => boundary.cancel()).toThrow(CalendarMeetingBusyError);
    create.resolve(configuredResult);
    await expect(firstCreate).resolves.toEqual(configuredResult);

    expect(() => boundary.create()).toThrow(CalendarMeetingConflictError);
    const firstCancel = boundary.cancel();
    expect(() => boundary.create()).toThrow(CalendarMeetingBusyError);
    expect(() => boundary.cancel()).toThrow(CalendarMeetingBusyError);
    cancel.resolve(cancellationResult);
    await expect(firstCancel).resolves.toEqual(cancellationResult);

    expect(() => boundary.create()).toThrow(CalendarMeetingConflictError);
    expect(() => boundary.cancel()).toThrow(CalendarMeetingConflictError);
    expect(inner.create).toHaveBeenCalledOnce();
    expect(inner.cancel).toHaveBeenCalledOnce();
  });

  it("allows explicit cancellation recovery after an uncertain create", async () => {
    const inner: CalendarMeetingOperation = {
      create: vi.fn().mockRejectedValue(new Error("unknown outcome")),
      cancel: vi.fn().mockResolvedValue(cancellationResult),
    };
    const boundary = new ProcessLocalCalendarMeetingBoundary(inner);

    await expect(boundary.create()).rejects.toThrow("unknown outcome");
    expect(() => boundary.create()).toThrow(CalendarMeetingConflictError);
    await expect(boundary.cancel()).resolves.toEqual(cancellationResult);
    expect(inner.cancel).toHaveBeenCalledOnce();
  });

  it("allows deliberate cancellation recovery after process state loss", async () => {
    const inner: CalendarMeetingOperation = {
      create: vi.fn(),
      cancel: vi.fn().mockResolvedValue(cancellationResult),
    };
    const boundary = new ProcessLocalCalendarMeetingBoundary(inner);

    await expect(boundary.cancel()).resolves.toEqual(cancellationResult);
    expect(inner.create).not.toHaveBeenCalled();
    expect(inner.cancel).toHaveBeenCalledOnce();
    expect(() => boundary.cancel()).toThrow(CalendarMeetingConflictError);
  });

  it("does not repeat an uncertain cancellation", async () => {
    const inner: CalendarMeetingOperation = {
      create: vi.fn(),
      cancel: vi.fn().mockRejectedValue(new Error("unknown outcome")),
    };
    const boundary = new ProcessLocalCalendarMeetingBoundary(inner);

    await expect(boundary.cancel()).rejects.toThrow("unknown outcome");
    expect(() => boundary.cancel()).toThrow(CalendarMeetingConflictError);
    expect(inner.cancel).toHaveBeenCalledOnce();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
