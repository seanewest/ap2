// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  ApiAccessError,
  CALENDAR_MEETING_ATTENDEES,
  CALENDAR_MEETING_END,
  CALENDAR_MEETING_ORGANIZER,
  CALENDAR_MEETING_START,
  CALENDAR_MEETING_SUBJECT,
  HttpAfterPartyApi,
  OneDriveInviteFailureError,
} from "./client";

describe("HTTP After Party API client", () => {
  it("sends the Bearer token only to the configured whoami URL and returns safe fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          callerType: "delegated",
          tenantId: "student-tenant",
          objectId: "operator-object-id",
          accessToken: "response-must-not-escape",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new HttpAfterPartyApi(
      "https://student-api.example/base",
      request,
    );

    const caller = await client.checkAccess("sensitive-access-token");

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "https://student-api.example/base/api/whoami",
      {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer sensitive-access-token",
        },
      },
    );
    expect(caller).toEqual({
      callerType: "delegated",
      tenantId: "student-tenant",
    });
    expect(JSON.stringify(caller)).not.toContain("sensitive-access-token");
    expect(JSON.stringify(caller)).not.toContain("operator-object-id");
    expect(JSON.stringify(caller)).not.toContain("response-must-not-escape");
  });

  it("invokes browser fetch with the global receiver", async () => {
    const request = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            callerType: "delegated",
            tenantId: "student-tenant",
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;
    const client = new HttpAfterPartyApi(
      "https://student-api.example",
      request,
    );

    await expect(client.checkAccess("token")).resolves.toEqual({
      callerType: "delegated",
      tenantId: "student-tenant",
    });
  });

  it("gets only safe rehearsal status from the configured API", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          appName: "ca-ap2-api",
          region: "East US",
          runningStatus: "Running",
          latestReadyRevision: "ca-ap2-api--revision",
          managedIdentity: "must-not-escape",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new HttpAfterPartyApi(
      "https://student-api.example/base",
      request,
    );

    const status = await client.getRehearsalStatus("sensitive-access-token");

    expect(request).toHaveBeenCalledWith(
      "https://student-api.example/base/api/rehearsal-status",
      {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer sensitive-access-token",
        },
      },
    );
    expect(status).toEqual({
      appName: "ca-ap2-api",
      region: "East US",
      runningStatus: "Running",
      latestReadyRevision: "ca-ap2-api--revision",
    });
    expect(JSON.stringify(status)).not.toContain("sensitive-access-token");
    expect(JSON.stringify(status)).not.toContain("managedIdentity");
  });

  it("posts one simulated email and returns only the safe accepted fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: true,
          sender: "homer.simpson@corywest.onmicrosoft.com",
          recipient: "marge.simpson@corywest.onmicrosoft.com",
          subject: "Dinner tonight",
          messageId: "must-not-escape",
          accessToken: "response-must-not-escape",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new HttpAfterPartyApi(
      "https://student-api.example/base",
      request,
    );

    const result = await client.sendSimulatedEmail("sensitive-access-token");

    expect(request).toHaveBeenCalledWith(
      "https://student-api.example/base/api/simulated-email",
      {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer sensitive-access-token",
        },
      },
    );
    expect(result).toEqual({
      accepted: true,
      sender: "homer.simpson@corywest.onmicrosoft.com",
      recipient: "marge.simpson@corywest.onmicrosoft.com",
      subject: "Dinner tonight",
    });
    expect(JSON.stringify(result)).not.toContain("messageId");
    expect(JSON.stringify(result)).not.toContain("sensitive-access-token");
    expect(JSON.stringify(result)).not.toContain("response-must-not-escape");
  });

  it.each([
    [
      "shareOneDriveProof",
      "POST",
      201,
      {
        state: "configured",
        path: "/AP2-OneDrive-share-proof.txt",
        owner: "homer.simpson@corywest.onmicrosoft.com",
        recipient: "marge.simpson@corywest.onmicrosoft.com",
        access: "read",
      },
    ],
    [
      "removeOneDriveProof",
      "DELETE",
      200,
      {
        state: "removed",
        path: "/AP2-OneDrive-share-proof.txt",
      },
    ],
  ] as const)(
    "%s uses the fixed API route and returns only safe fields",
    async (methodName, method, status, body) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { ...body, token: "must-not-escape", rawGraphResponse: {} },
          { status },
        ),
      );
      const client = new HttpAfterPartyApi(
        "https://student-api.example/base",
        request,
      );

      const result = await client[methodName]("sensitive-access-token");

      expect(request).toHaveBeenCalledWith(
        "https://student-api.example/base/api/onedrive-share-proof",
        {
          method,
          credentials: "omit",
          redirect: "error",
          headers: { Authorization: "Bearer sensitive-access-token" },
        },
      );
      expect(result).toEqual(body);
      expect(JSON.stringify(result)).not.toContain("token");
      expect(JSON.stringify(result)).not.toContain("rawGraphResponse");
    },
  );

  it("rejects a mismatched or malformed OneDrive proof response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          state: "configured",
          path: "/AP2-OneDrive-share-proof.txt",
          owner: "homer.simpson@corywest.onmicrosoft.com",
          recipient: "someone-else@corywest.onmicrosoft.com",
          access: "read",
        },
        { status: 201 },
      ),
    );
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.shareOneDriveProof("token")).rejects.toEqual(
      new ApiAccessError(),
    );
  });

  it.each([
    [
      "createCalendarMeeting",
      "https://student-api.example/base/api/calendar-meeting",
      201,
      {
        state: "configured",
        organizer: CALENDAR_MEETING_ORGANIZER,
        attendees: CALENDAR_MEETING_ATTENDEES,
        subject: CALENDAR_MEETING_SUBJECT,
        start: CALENDAR_MEETING_START,
        end: CALENDAR_MEETING_END,
      },
    ],
    [
      "cancelCalendarMeeting",
      "https://student-api.example/base/api/calendar-meeting/cancel",
      202,
      {
        state: "cancellation-accepted",
        organizer: CALENDAR_MEETING_ORGANIZER,
        subject: CALENDAR_MEETING_SUBJECT,
      },
    ],
  ] as const)(
    "%s posts only to its fixed route and returns safe fields",
    async (methodName, url, status, body) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            ...body,
            eventId: "must-not-escape",
            token: "must-not-escape",
          },
          { status },
        ),
      );
      const client = new HttpAfterPartyApi(
        "https://student-api.example/base",
        request,
      );

      const result = await client[methodName]("sensitive-access-token");

      expect(request).toHaveBeenCalledWith(url, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { Authorization: "Bearer sensitive-access-token" },
      });
      expect(result).toEqual(body);
      expect(JSON.stringify(result)).not.toContain("eventId");
      expect(JSON.stringify(result)).not.toContain("token");
    },
  );

  it("rejects a malformed or mismatched calendar response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          state: "configured",
          organizer: CALENDAR_MEETING_ORGANIZER,
          attendees: [
            "someone-else@corywest.onmicrosoft.com",
            "marge.simpson@corywest.onmicrosoft.com",
          ],
          subject: CALENDAR_MEETING_SUBJECT,
          start: CALENDAR_MEETING_START,
          end: CALENDAR_MEETING_END,
        },
        { status: 201 },
      ),
    );
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.createCalendarMeeting("token")).rejects.toEqual(
      new ApiAccessError(),
    );
  });

  it.each([
    [
      "calendar_operation_busy",
      "Another calendar operation is running. Try again shortly.",
    ],
    [
      "calendar_state_conflict",
      "The calendar rehearsal is not in the expected state. Nothing was repeated.",
    ],
  ])("returns a safe calendar conflict for %s", async (code, message) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: code, detail: "must-not-escape" }, { status: 409 }),
      );
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.createCalendarMeeting("token")).rejects.toEqual(
      new ApiAccessError(message),
    );
  });

  it("makes a OneDrive conflict understandable without leaking details", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider detail", { status: 409 }));
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.shareOneDriveProof("token")).rejects.toEqual(
      new ApiAccessError(
        "The OneDrive proof file is not in the expected state. Nothing was changed.",
      ),
    );
  });

  it("distinguishes a concurrent OneDrive operation from a state conflict", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: "proof_operation_busy", detail: "must-not-escape" }, {
        status: 409,
      }),
    );
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.removeOneDriveProof("token")).rejects.toEqual(
      new ApiAccessError(
        "Another OneDrive proof operation is running. Try again shortly.",
      ),
    );
  });

  it("returns only safe structured invite diagnostics after the file was created", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: "onedrive_invite_failed",
          state: "file-created-sharing-failed",
          stage: "invite",
          upstreamStatus: 400,
          graphErrorCode: "invalidRequest",
          requestId: "11111111-1111-4111-8111-111111111111",
          clientRequestId: "22222222-2222-4222-8222-222222222222",
          responseDate: "Thu, 23 Jul 2026 23:00:00 GMT",
          retryAfter: "30",
          responseShape: "graph-error",
          accessToken: "must-not-escape",
          rawGraphResponse: { message: "must-not-escape" },
        },
        { status: 502 },
      ),
    );
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    const error = await client
      .shareOneDriveProof("sensitive-access-token")
      .catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveInviteFailureError);
    expect(error.diagnostic).toEqual({
      state: "file-created-sharing-failed",
      stage: "invite",
      upstreamStatus: 400,
      graphErrorCode: "invalidRequest",
      requestId: "11111111-1111-4111-8111-111111111111",
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      responseDate: "Thu, 23 Jul 2026 23:00:00 GMT",
      retryAfter: "30",
      responseShape: "graph-error",
    });
    expect(JSON.stringify(error)).not.toContain("sensitive-access-token");
    expect(JSON.stringify(error)).not.toContain("must-not-escape");
    expect(JSON.stringify(error)).not.toContain("rawGraphResponse");
  });

  it("accepts missing optional invite fields and rejects malformed diagnostics", async () => {
    const minimal = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          error: "onedrive_invite_failed",
          state: "file-created-sharing-failed",
          stage: "invite",
          upstreamStatus: 503,
          clientRequestId: "33333333-3333-4333-8333-333333333333",
          responseShape: "graph-error",
        },
        { status: 502 },
      ),
    );
    const minimalClient = new HttpAfterPartyApi(
      "https://student-api.example",
      minimal,
    );
    const minimalError = await minimalClient
      .shareOneDriveProof("token")
      .catch((value) => value);
    expect(minimalError).toBeInstanceOf(OneDriveInviteFailureError);
    expect(minimalError.diagnostic).toEqual({
      state: "file-created-sharing-failed",
      stage: "invite",
      upstreamStatus: 503,
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      responseShape: "graph-error",
    });

    const malformed = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json(
        {
          error: "onedrive_invite_failed",
          state: "file-created-sharing-failed",
          stage: "invite",
          upstreamStatus: "503 and a secret",
          clientRequestId: "33333333-3333-4333-8333-333333333333",
          responseShape: "graph-error",
          requestId: "not-a-guid",
        },
        { status: 502 },
      ),
    );
    const malformedClient = new HttpAfterPartyApi(
      "https://student-api.example",
      malformed,
    );
    await expect(
      malformedClient.shareOneDriveProof("token"),
    ).rejects.toEqual(new ApiAccessError());
  });

  it.each([
    [401, "API access needs Microsoft authorization. Try again."],
    [403, "This account is not allowed to use the API."],
    [500, "The API could not complete the access check. Try again."],
  ])("returns a safe error for HTTP %i", async (status, message) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider detail", { status }));
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.checkAccess("sensitive-access-token")).rejects.toEqual(
      new ApiAccessError(message),
    );
  });

  it("rejects malformed success data and network failure safely", async () => {
    const malformedRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ callerType: "delegated" }), { status: 200 }),
    );
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        malformedRequest,
      ).checkAccess("token"),
    ).rejects.toEqual(new ApiAccessError());

    const failedRequest = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("raw network detail"));
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        failedRequest,
      ).checkAccess("token"),
    ).rejects.toEqual(new ApiAccessError());
  });

  it("rejects malformed rehearsal status safely", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          appName: "ca-ap2-api",
          region: "East US",
          runningStatus: "Unknown",
          latestReadyRevision: "revision",
        }),
        { status: 200 },
      ),
    );

    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        request,
      ).getRehearsalStatus("token"),
    ).rejects.toEqual(new ApiAccessError());
  });

  it("requires HTTP 202 and safe fields for a simulated email acceptance", async () => {
    const wrongStatus = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: true,
          sender: "homer.simpson@corywest.onmicrosoft.com",
          recipient: "marge.simpson@corywest.onmicrosoft.com",
          subject: "Dinner tonight",
        }),
        { status: 200 },
      ),
    );
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        wrongStatus,
      ).sendSimulatedEmail("token"),
    ).rejects.toEqual(new ApiAccessError());

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: false,
          sender: "homer.simpson@corywest.onmicrosoft.com",
          recipient: "marge.simpson@corywest.onmicrosoft.com",
          subject: "Dinner tonight",
        }),
        { status: 202 },
      ),
    );
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        malformed,
      ).sendSimulatedEmail("token"),
    ).rejects.toEqual(new ApiAccessError());

    const wrongRecipient = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          accepted: true,
          sender: "homer.simpson@corywest.onmicrosoft.com",
          recipient: "someone-else@corywest.onmicrosoft.com",
          subject: "Dinner tonight",
        },
        { status: 202 },
      ),
    );
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        wrongRecipient,
      ).sendSimulatedEmail("token"),
    ).rejects.toEqual(new ApiAccessError());
  });
});
