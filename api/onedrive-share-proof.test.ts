// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DelegatedGraphOneDriveShareProof,
  GRAPH_FILES_READ_SCOPE,
  GRAPH_FILES_READ_WRITE_SCOPE,
  ONEDRIVE_PROOF_CONTENT,
  ONEDRIVE_PROOF_FILE_NAME,
  ONEDRIVE_PROOF_PATH,
  OneDriveInviteFailureError,
  OneDriveProofBusyError,
  OneDriveProofConflictError,
  OneDriveVerifyFailureError,
  ProcessLocalOneDriveShareProofBoundary,
  type OneDriveShareProofOperation,
} from "./onedrive-share-proof.js";
import {
  HOMER_IDENTITY,
  MARGE_DISPLAY_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";

const MARGE_IDENTITY: SimulatedUserIdentity = {
  tenantId: HOMER_IDENTITY.tenantId,
  objectId: "22222222-2222-4222-8222-222222222222",
  displayName: MARGE_DISPLAY_NAME,
  userPrincipalName: MARGE_USER_PRINCIPAL_NAME,
};
const PROOF_SIZE = Buffer.byteLength(ONEDRIVE_PROOF_CONTENT);
const CLIENT_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ITEM = {
  id: "proof-item",
  name: ONEDRIVE_PROOF_FILE_NAME,
  size: PROOF_SIZE,
  file: { mimeType: "text/plain" },
  eTag: '"proof-etag"',
  parentReference: { driveId: "homer-drive" },
};
const UPDATED_ITEM = { ...ITEM, eTag: '"proof-etag-after-revoke"' };
const MARGE_READ_PERMISSION = {
  id: "marge-read-permission",
  roles: ["read"],
  invitation: {
    email: MARGE_USER_PRINCIPAL_NAME,
    signInRequired: true,
  },
  grantedToV2: {
    user: {
      id: MARGE_IDENTITY.objectId,
      displayName: MARGE_DISPLAY_NAME,
    },
  },
  inheritedFrom: null,
};
const OWNER_PERMISSION = {
  id: "owner-permission",
  roles: ["owner"],
  grantedToV2: { user: { id: HOMER_IDENTITY.objectId } },
};

function tokenProvider(identity: SimulatedUserIdentity, token: string) {
  return {
    getToken: vi.fn(async () => ({ token, identity })),
  } satisfies DelegatedGraphTokenProvider;
}

function operation(
  responses: readonly Response[],
): {
  operation: DelegatedGraphOneDriveShareProof;
  request: ReturnType<typeof vi.fn>;
  homer: ReturnType<typeof tokenProvider>;
  marge: ReturnType<typeof tokenProvider>;
  sleep: ReturnType<typeof vi.fn>;
} {
  const queue = [...responses];
  const request = vi.fn(async () => {
    const response = queue.shift();
    if (!response) {
      throw new Error("Unexpected Graph request");
    }
    return response;
  });
  const homer = tokenProvider(HOMER_IDENTITY, "homer-token");
  const marge = tokenProvider(MARGE_IDENTITY, "marge-token");
  let nowMs = 0;
  const sleep = vi.fn(async (milliseconds: number) => {
    nowMs += milliseconds;
  });
  return {
    operation: new DelegatedGraphOneDriveShareProof(
      homer,
      marge,
      MARGE_IDENTITY,
      request as typeof fetch,
      () => CLIENT_REQUEST_ID,
      {
        now: () => nowMs,
        sleep,
      },
    ),
    request,
    homer,
    marge,
    sleep,
  };
}

async function afterConfirmedShare(
  verificationResponses: readonly Response[],
) {
  const fixture = operation([
    new Response(undefined, { status: 404 }),
    Response.json({ id: "root-item" }),
    Response.json({ uploadUrl: "https://upload.example/proof" }),
    Response.json(ITEM, { status: 201 }),
    Response.json({ value: [MARGE_READ_PERMISSION] }),
    Response.json(ITEM),
    ...verificationResponses,
  ]);
  await fixture.operation.share();
  return fixture;
}

function deadlineHangFixture(steps: Array<Response | "hang">) {
  let startHang: () => void = () => undefined;
  const hangStarted = new Promise<void>((resolve) => {
    startHang = resolve;
  });
  let hungSignal: AbortSignal | undefined;
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    const step = steps.shift();
    if (step !== "hang") {
      if (!step) {
        throw new Error("Unexpected Graph request");
      }
      return step;
    }
    if (!init?.signal) {
      throw new Error("The deadline signal was not supplied.");
    }
    hungSignal = init.signal;
    startHang();
    return await new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Verification deadline", "AbortError")),
        { once: true },
      );
    });
  });
  const deadlineCallbacks: Array<() => void> = [];
  const scheduledMilliseconds: number[] = [];
  const cancelDeadline = vi.fn();
  let nowMs = 0;
  const realOperation = new DelegatedGraphOneDriveShareProof(
    tokenProvider(HOMER_IDENTITY, "homer-token"),
    tokenProvider(MARGE_IDENTITY, "marge-token"),
    MARGE_IDENTITY,
    request as typeof fetch,
    () => CLIENT_REQUEST_ID,
    {
      now: () => nowMs,
      sleep: vi.fn(),
      scheduleDeadline: (callback, milliseconds) => {
        deadlineCallbacks.push(callback);
        scheduledMilliseconds.push(milliseconds);
        return cancelDeadline;
      },
    },
  );
  return {
    boundary: new ProcessLocalOneDriveShareProofBoundary(realOperation),
    advanceTime: (milliseconds: number) => {
      nowMs += milliseconds;
    },
    hangStarted,
    fireDeadline: () => {
      const callback = deadlineCallbacks.at(0);
      if (!callback) {
        throw new Error("The verification deadline was not scheduled.");
      }
      callback();
    },
    hungSignal: () => hungSignal,
    scheduledMilliseconds,
    cancelDeadline,
    request,
  };
}

describe("DelegatedGraphOneDriveShareProof", () => {
  it.each([1, 55_000])(
    "accepts an integer verification window within bounds: %s",
    (verificationWindowMs) => {
      expect(() =>
        new DelegatedGraphOneDriveShareProof(
          tokenProvider(HOMER_IDENTITY, "homer-token"),
          tokenProvider(MARGE_IDENTITY, "marge-token"),
          MARGE_IDENTITY,
          vi.fn() as typeof fetch,
          () => CLIENT_REQUEST_ID,
          { verificationWindowMs },
        )
      ).not.toThrow();
    },
  );

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    1.5,
    55_001,
  ])(
    "rejects an invalid verification window: %s",
    (verificationWindowMs) => {
      expect(() =>
        new DelegatedGraphOneDriveShareProof(
          tokenProvider(HOMER_IDENTITY, "homer-token"),
          tokenProvider(MARGE_IDENTITY, "marge-token"),
          MARGE_IDENTITY,
          vi.fn() as typeof fetch,
          () => CLIENT_REQUEST_ID,
          { verificationWindowMs },
        )
      ).toThrow("The OneDrive verification window is invalid.");
    },
  );

  it("creates the fixed bytes once and grants only Marge read access", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({
        value: [
          {
            id: "marge-read-permission",
            roles: ["read"],
            invitation: {
              email: MARGE_USER_PRINCIPAL_NAME,
              signInRequired: true,
            },
          },
        ],
      }),
    ]);

    await expect(fixture.operation.share()).resolves.toEqual({
      state: "shared",
      path: ONEDRIVE_PROOF_PATH,
      owner: HOMER_IDENTITY.userPrincipalName,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      access: "read",
    });
    expect(fixture.homer.getToken).toHaveBeenCalledWith(
      GRAPH_FILES_READ_WRITE_SCOPE,
    );
    expect(fixture.marge.getToken).not.toHaveBeenCalled();
    expect(fixture.request).toHaveBeenCalledTimes(5);
    const calls = fixture.request.mock.calls as Array<[string, RequestInit]>;
    const pathCheck = requiredCall(calls, 0);
    const createSession = requiredCall(calls, 2);
    const upload = requiredCall(calls, 3);
    const invite = requiredCall(calls, 4);
    expect(pathCheck[0]).toBe(
      `https://graph.microsoft.com/v1.0/me/drive/root:/${ONEDRIVE_PROOF_FILE_NAME}?$select=id,name,size,file,eTag,parentReference`,
    );
    expect(createSession[0]).toBe(
      `https://graph.microsoft.com/v1.0/me/drive/items/root-item:/${ONEDRIVE_PROOF_FILE_NAME}:/createUploadSession`,
    );
    expect(JSON.parse(createSession[1].body as string)).toEqual({
      item: {
        "@microsoft.graph.conflictBehavior": "fail",
        name: ONEDRIVE_PROOF_FILE_NAME,
      },
    });
    expect(upload).toEqual([
      "https://upload.example/proof",
      {
        method: "PUT",
        redirect: "error",
        headers: {
          "Content-Length": String(PROOF_SIZE),
          "Content-Range": `bytes 0-${PROOF_SIZE - 1}/${PROOF_SIZE}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: ONEDRIVE_PROOF_CONTENT,
      },
    ]);
    expect(JSON.parse(invite[1].body as string)).toEqual({
      recipients: [{ objectId: MARGE_IDENTITY.objectId }],
      requireSignIn: true,
      sendInvitation: false,
      roles: ["read"],
    });
    expect(invite[1].headers).toEqual({
      Authorization: "Bearer homer-token",
      "Content-Type": "application/json",
      "client-request-id": CLIENT_REQUEST_ID,
      "return-client-request-id": "true",
    });
  });

  it("aborts before mutation when the fixed path exists", async () => {
    const fixture = operation([Response.json(ITEM)]);

    await expect(fixture.operation.share()).rejects.toBeInstanceOf(
      OneDriveProofConflictError,
    );
    expect(fixture.request).toHaveBeenCalledOnce();
  });

  it("does not retry after an ambiguous mutating response", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      new Response("ambiguous", { status: 503 }),
    ]);

    await expect(fixture.operation.share()).rejects.toThrow(
      "upload session returned HTTP 503",
    );
    expect(fixture.request).toHaveBeenCalledTimes(3);
  });

  it("reports an upload-session race as a collision without retry", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      new Response(undefined, { status: 409 }),
    ]);

    await expect(fixture.operation.share()).rejects.toBeInstanceOf(
      OneDriveProofConflictError,
    );
    expect(fixture.request).toHaveBeenCalledTimes(3);
  });

  it("reports the exact invite failure without retaining Graph's raw body", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json(
        {
          error: {
            code: "badRequest",
            message: "provider detail must not escape",
            innerError: {
              code: "invalidRequest",
              "request-id": requestId,
              accessToken: "must-not-escape",
            },
          },
          rawGraphResponse: "must-not-escape",
        },
        {
          status: 400,
          headers: {
            Date: "Thu, 23 Jul 2026 23:00:00 GMT",
            "Retry-After": "30",
          },
        },
      ),
    ]);

    const error = await fixture.operation.share().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveInviteFailureError);
    expect(error.diagnostic).toEqual({
      state: "file-created-sharing-failed",
      stage: "invite",
      upstreamStatus: 400,
      graphErrorCode: "invalidRequest",
      requestId,
      clientRequestId: CLIENT_REQUEST_ID,
      responseDate: "Thu, 23 Jul 2026 23:00:00 GMT",
      retryAfter: "30",
      responseShape: "graph-error",
    });
    expect(fixture.request).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(error)).not.toContain("provider detail");
    expect(JSON.stringify(error)).not.toContain("must-not-escape");
    expect(JSON.stringify(error)).not.toContain("proof-item");
    expect(JSON.stringify(error)).not.toContain("homer-drive");
    expect(JSON.stringify(error)).not.toContain("marge-read-permission");
  });

  it("omits missing or malformed Graph invite diagnostics safely", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json(
        {
          error: {
            code: "invalid code with unsafe detail",
            innerError: {
              "request-id": "not-a-guid",
              "client-request-id": 42,
            },
          },
        },
        {
          status: 503,
          headers: { "request-id": "Bearer must-not-escape" },
        },
      ),
    ]);

    const error = await fixture.operation.share().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveInviteFailureError);
    expect(error.diagnostic).toEqual({
      state: "file-created-sharing-failed",
      stage: "invite",
      upstreamStatus: 503,
      clientRequestId: CLIENT_REQUEST_ID,
      responseShape: "graph-error",
    });
    expect(fixture.request).toHaveBeenCalledTimes(5);
  });

  it("does not retry an ambiguous successful invitation response", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [] }),
      Response.json({ value: [] }),
    ]);

    const error = await fixture.operation.share().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveInviteFailureError);
    expect(error.diagnostic).toEqual({
      state: "file-created-sharing-failed",
      stage: "invite-reconciliation",
      upstreamStatus: 200,
      clientRequestId: CLIENT_REQUEST_ID,
      responseShape: "permission-reconciliation-mismatch",
    });
    expect(fixture.request).toHaveBeenCalledTimes(6);
    expect(fixture.request.mock.calls[5]).toEqual([
      "https://graph.microsoft.com/v1.0/me/drive/items/proof-item/permissions?$select=id,roles,link,invitation,grantedToV2,inheritedFrom",
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: "Bearer homer-token" },
      },
    ]);
    expect(
      fixture.request.mock.calls.filter(
        ([url, init]) => url.endsWith("/invite") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("reconciles one exact direct Marge read grant after a 200 shape mismatch", async () => {
    const directGrant = {
      id: "marge-read-permission",
      roles: ["read"],
      grantedToV2: {
        user: {
          id: MARGE_IDENTITY.objectId,
          displayName: MARGE_DISPLAY_NAME,
        },
      },
      inheritedFrom: null,
    };
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [{ roles: ["read"] }] }),
      Response.json({ value: [OWNER_PERMISSION, directGrant] }),
    ]);

    await expect(fixture.operation.share()).resolves.toMatchObject({
      state: "shared",
    });
    expect(fixture.request).toHaveBeenCalledTimes(6);
    expect(
      fixture.request.mock.calls.filter(
        ([url, init]) => url.endsWith("/invite") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("accepts the exact direct Marge grant without reconciliation", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({
        value: [
          {
            id: "marge-read-permission",
            roles: ["read"],
            grantedToV2: {
              user: { id: MARGE_IDENTITY.objectId },
            },
          },
        ],
      }),
    ]);

    await expect(fixture.operation.share()).resolves.toMatchObject({
      state: "shared",
    });
    expect(fixture.request).toHaveBeenCalledTimes(5);
  });

  it("rejects unknown, linked, write, inherited, or duplicate reconciled grants", async () => {
    const exact = {
      id: "marge-read-permission",
      roles: ["read"],
      grantedToV2: { user: { id: MARGE_IDENTITY.objectId } },
    };
    for (const permissions of [
      [{ ...exact, grantedToV2: { user: { id: "another-user" } } }],
      [{ ...exact, link: { type: "view" } }],
      [{ ...exact, roles: ["write"] }],
      [{ ...exact, inheritedFrom: { id: "parent" } }],
      [exact, { ...exact, id: "duplicate" }],
    ]) {
      const fixture = operation([
        new Response(undefined, { status: 404 }),
        Response.json({ id: "root-item" }),
        Response.json({ uploadUrl: "https://upload.example/proof" }),
        Response.json(ITEM, { status: 201 }),
        Response.json({ value: [] }),
        Response.json({ value: permissions }),
      ]);

      const error = await fixture.operation.share().catch((value) => value);

      expect(error).toBeInstanceOf(OneDriveInviteFailureError);
      expect(error.diagnostic).toMatchObject({
        stage: "invite-reconciliation",
        responseShape: "permission-reconciliation-mismatch",
      });
      expect(
        fixture.request.mock.calls.filter(
          ([url, init]) => url.endsWith("/invite") && init?.method === "POST",
        ),
      ).toHaveLength(1);
    }
  });

  it("reports a failed read-only reconciliation without repeating the invite", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [] }),
      Response.json(
        {
          error: {
            code: "serviceUnavailable",
            innerError: { code: "transientError" },
          },
        },
        { status: 503 },
      ),
    ]);

    const error = await fixture.operation.share().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveInviteFailureError);
    expect(error.diagnostic).toMatchObject({
      stage: "invite-reconciliation",
      upstreamStatus: 503,
      graphErrorCode: "transientError",
      responseShape: "permission-reconciliation-error",
    });
    expect(
      fixture.request.mock.calls.filter(
        ([url, init]) => url.endsWith("/invite") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("uses only Graph's safe preauthenticated redirect without forwarding authorization", async () => {
    const fixture = await afterConfirmedShare([
      new Response(undefined, {
        status: 302,
        headers: { Location: "https://download.example/proof" },
      }),
      new Response(ONEDRIVE_PROOF_CONTENT),
    ]);

    await expect(fixture.operation.verify()).resolves.toEqual({
      state: "verified",
      path: ONEDRIVE_PROOF_PATH,
      verifiedAs: MARGE_USER_PRINCIPAL_NAME,
      contentMatches: true,
    });
    expect(fixture.marge.getToken).toHaveBeenCalledWith(GRAPH_FILES_READ_SCOPE);
    const calls = fixture.request.mock.calls as Array<[string, RequestInit]>;
    const graphContent = requiredCall(calls, 6);
    const directContent = requiredCall(calls, 7);
    expect(graphContent[0]).toBe(
      "https://graph.microsoft.com/v1.0/drives/homer-drive/items/proof-item/content",
    );
    expect(graphContent[1].headers).toEqual({
      Authorization: "Bearer marge-token",
      "client-request-id": CLIENT_REQUEST_ID,
      "return-client-request-id": "true",
    });
    expect(graphContent[1].redirect).toBe("manual");
    expect(graphContent[1].signal).toBeInstanceOf(AbortSignal);
    expect(directContent[0]).toBe("https://download.example/proof");
    expect(directContent[1].redirect).toBe("error");
    expect(directContent[1].headers).toBeUndefined();
    expect(
      calls.some(([url]) =>
        url.includes("/drives/homer-drive/items/proof-item?$select=")
      ),
    ).toBe(false);
  });

  it("accepts direct 200 exact bytes without a redirect or metadata read", async () => {
    const fixture = await afterConfirmedShare([
      new Response(ONEDRIVE_PROOF_CONTENT),
    ]);

    await expect(fixture.operation.verify()).resolves.toMatchObject({
      state: "verified",
      contentMatches: true,
    });
    expect(fixture.request).toHaveBeenCalledTimes(7);
  });

  it("retries 403 and 404 propagation responses before exact bytes succeed", async () => {
    const fixture = await afterConfirmedShare([
      Response.json({ error: { code: "accessDenied" } }, { status: 403 }),
      Response.json({ error: { code: "itemNotFound" } }, { status: 404 }),
      new Response(ONEDRIVE_PROOF_CONTENT),
    ]);

    await expect(fixture.operation.verify()).resolves.toMatchObject({
      state: "verified",
    });
    expect(fixture.sleep.mock.calls.map(([milliseconds]) => milliseconds))
      .toEqual([1_000, 2_000]);
  });

  it("honors 429 Retry-After and retries 503 before success", async () => {
    const fixture = await afterConfirmedShare([
      Response.json(
        { error: { code: "tooManyRequests" } },
        { status: 429, headers: { "Retry-After": "2" } },
      ),
      Response.json({ error: { code: "serviceUnavailable" } }, { status: 503 }),
      new Response(ONEDRIVE_PROOF_CONTENT),
    ]);

    await expect(fixture.operation.verify()).resolves.toMatchObject({
      state: "verified",
    });
    expect(fixture.sleep.mock.calls.map(([milliseconds]) => milliseconds))
      .toEqual([2_000, 2_000]);
  });

  it("returns pending at the 55-second propagation deadline", async () => {
    const fixture = await afterConfirmedShare([
      ...Array.from(
        { length: 10 },
        () => Response.json({ error: { code: "accessDenied" } }, { status: 403 }),
      ),
    ]);

    await expect(fixture.operation.verify()).resolves.toEqual({
      state: "pending",
      path: ONEDRIVE_PROOF_PATH,
      verifiedAs: MARGE_USER_PRINCIPAL_NAME,
      reason: "access-propagation",
    });
    expect(fixture.sleep.mock.calls.map(([milliseconds]) => milliseconds))
      .toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      8_000,
      8_000,
      8_000,
      8_000,
      8_000,
      ]);
  });

  it("aborts an in-flight Graph GET at the deadline and releases Share", async () => {
    const fixture = deadlineHangFixture([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [MARGE_READ_PERMISSION] }),
      "hang",
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [MARGE_READ_PERMISSION] }),
    ]);
    await fixture.boundary.share();
    fixture.advanceTime(9_000);

    const verification = fixture.boundary.verify();
    await fixture.hangStarted;
    fixture.fireDeadline();

    await expect(verification).resolves.toMatchObject({
      state: "pending",
      reason: "access-propagation",
    });
    expect(fixture.hungSignal()?.aborted).toBe(true);
    expect(fixture.scheduledMilliseconds).toEqual([46_000]);
    await expect(fixture.boundary.share()).resolves.toMatchObject({
      state: "shared",
    });
    expect(fixture.cancelDeadline).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight download GET at the deadline and releases cleanup", async () => {
    const fixture = deadlineHangFixture([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [MARGE_READ_PERMISSION] }),
      Response.json(ITEM),
      new Response(undefined, {
        status: 302,
        headers: { Location: "https://download.example/proof" },
      }),
      "hang",
      Response.json(ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      Response.json({ value: [OWNER_PERMISSION] }),
      Response.json(UPDATED_ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      new Response(undefined, { status: 204 }),
    ]);
    await fixture.boundary.share();

    const verification = fixture.boundary.verify();
    await fixture.hangStarted;
    fixture.fireDeadline();

    await expect(verification).resolves.toMatchObject({
      state: "pending",
      reason: "access-propagation",
    });
    expect(fixture.hungSignal()?.aborted).toBe(true);
    expect(fixture.scheduledMilliseconds).toEqual([55_000]);
    await expect(fixture.boundary.remove()).resolves.toEqual({
      state: "removed",
      path: ONEDRIVE_PROOF_PATH,
    });
    expect(fixture.cancelDeadline).toHaveBeenCalledOnce();
  });

  it("does not start a new retry window for an explicit later Verify", async () => {
    const fixture = operation([
      Response.json(ITEM),
      Response.json({ error: { code: "itemNotFound" } }, { status: 404 }),
    ]);

    await expect(fixture.operation.verify()).resolves.toMatchObject({
      state: "pending",
      reason: "access-propagation",
    });
    expect(fixture.sleep).not.toHaveBeenCalled();
    expect(fixture.request).toHaveBeenCalledTimes(2);
  });

  it("returns safe terminal diagnostics for 401 without retry", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const fixture = await afterConfirmedShare([
      Response.json(
        {
          error: {
            code: "unauthorized",
            message: "raw provider detail",
            innerError: {
              code: "invalidAuthenticationToken",
              "request-id": requestId,
              itemId: "must-not-escape",
            },
          },
        },
        {
          status: 401,
          headers: {
            Date: "Thu, 23 Jul 2026 23:00:00 GMT",
            "Retry-After": "5",
          },
        },
      ),
    ]);
    const error = await fixture.operation.verify().catch((value) => value);
    expect(error).toBeInstanceOf(OneDriveVerifyFailureError);
    expect(error.diagnostic).toEqual({
      state: "marge-access-not-confirmed",
      stage: "verify-content",
      upstreamStatus: 401,
      graphErrorCode: "invalidAuthenticationToken",
      requestId,
      clientRequestId: CLIENT_REQUEST_ID,
      responseDate: "Thu, 23 Jul 2026 23:00:00 GMT",
      retryAfter: "5",
      responseShape: "graph-error",
    });
    expect(fixture.sleep).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain("raw provider detail");
    expect(JSON.stringify(error)).not.toContain("must-not-escape");
    expect(JSON.stringify(error)).not.toContain("proof-item");
    expect(JSON.stringify(error)).not.toContain("homer-drive");
    expect(JSON.stringify(error)).not.toContain(ONEDRIVE_PROOF_CONTENT);
  });

  it("fails immediately for a 400 Graph response", async () => {
    const fixture = await afterConfirmedShare([
      Response.json(
        { error: { code: "invalidRequest" } },
        { status: 400 },
      ),
    ]);

    const error = await fixture.operation.verify().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveVerifyFailureError);
    expect(error.diagnostic).toMatchObject({
      upstreamStatus: 400,
      graphErrorCode: "invalidRequest",
      responseShape: "graph-error",
    });
    expect(fixture.sleep).not.toHaveBeenCalled();
  });

  it.each(
    [403, 404, 429, 503].flatMap((status) =>
      [
        [status, "non-json", "non-json"],
        [status, "malformed-schema", "malformed-response"],
        [status, "unexpected-body", "malformed-response"],
      ] as const
    ),
  )(
    "does not retry malformed %i %s responses",
    async (status, bodyKind, responseShape) => {
      const response = bodyKind === "non-json"
        ? new Response("{not-json", { status })
        : bodyKind === "malformed-schema"
          ? Response.json({ error: { code: 123 } }, { status })
          : Response.json({ value: [] }, { status });
      const fixture = await afterConfirmedShare([response]);

      const error = await fixture.operation.verify().catch((value) => value);

      expect(error).toBeInstanceOf(OneDriveVerifyFailureError);
      expect(error.diagnostic).toMatchObject({
        upstreamStatus: status,
        responseShape,
      });
      expect(fixture.sleep).not.toHaveBeenCalled();
      expect(fixture.request).toHaveBeenCalledTimes(7);
    },
  );

  it.each([
    undefined,
    "http://unsafe.example/proof",
    "ftp://unsafe.example/proof",
    "https://user:password@download.example/proof",
  ])(
    "fails immediately for missing or unsafe download location %s",
    async (location) => {
      const fixture = await afterConfirmedShare([
        new Response(undefined, {
          status: 302,
          headers: location ? { Location: location } : {},
        }),
      ]);

      const error = await fixture.operation.verify().catch((value) => value);

      expect(error).toBeInstanceOf(OneDriveVerifyFailureError);
      expect(error.diagnostic).toMatchObject({
        stage: "verify-content",
        upstreamStatus: 302,
        responseShape: "invalid-download-redirect",
      });
      expect(fixture.sleep).not.toHaveBeenCalled();
    },
  );

  it("fails immediately when the preauthenticated download fails", async () => {
    const fixture = await afterConfirmedShare([
      new Response(undefined, {
        status: 302,
        headers: { Location: "https://download.example/proof" },
      }),
      new Response("provider detail", { status: 502 }),
    ]);

    const error = await fixture.operation.verify().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveVerifyFailureError);
    expect(error.diagnostic).toMatchObject({
      stage: "verify-content",
      upstreamStatus: 502,
      responseShape: "content-response-error",
    });
    expect(JSON.stringify(error)).not.toContain("provider detail");
  });

  it("fails immediately for wrong bytes without returning either content value", async () => {
    const changed = "Marge shared this harmless AP2 rehearsal file with Marge.\n";
    expect(Buffer.byteLength(changed)).toBe(PROOF_SIZE);
    const fixture = await afterConfirmedShare([new Response(changed)]);

    const error = await fixture.operation.verify().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveVerifyFailureError);
    expect(error.diagnostic).toMatchObject({
      stage: "verify-content",
      upstreamStatus: 200,
      responseShape: "content-mismatch",
    });
    expect(fixture.sleep).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain(changed);
    expect(JSON.stringify(error)).not.toContain(ONEDRIVE_PROOF_CONTENT);
  });

  it("rejects malformed metadata and mismatched content", async () => {
    const malformed = operation([Response.json({ ...ITEM, size: 1 })]);
    await expect(malformed.operation.verify()).rejects.toThrow(
      "invalid OneDrive proof file",
    );

    const changed = operation([
      Response.json(ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      Response.json({ value: [OWNER_PERMISSION] }),
      Response.json(ITEM),
      new Response("changed"),
    ]);
    await expect(changed.operation.remove()).rejects.toBeInstanceOf(
      OneDriveProofConflictError,
    );
    expect(changed.request).toHaveBeenCalledTimes(5);
  });

  it("does not revoke or delete when same-length proof bytes differ", async () => {
    const differentBytes =
      "Marge shared this harmless AP2 rehearsal file with Marge.\n";
    expect(Buffer.byteLength(differentBytes)).toBe(PROOF_SIZE);
    const fixture = operation([
      Response.json(ITEM),
      new Response(differentBytes),
      Response.json({ value: [MARGE_READ_PERMISSION] }),
    ]);

    const error = await fixture.operation.remove().catch((value) => value);

    expect(error).toBeInstanceOf(OneDriveProofConflictError);
    expect(error.message).toBe("The fixed OneDrive proof content does not match.");
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(
      fixture.request.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    expect(JSON.stringify(error)).not.toContain("homer-token");
    expect(JSON.stringify(error)).not.toContain("marge-read-permission");
  });

  it("revokes only Marge's direct read permission, then revalidates and deletes", async () => {
    const fixture = operation([
      Response.json(ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      Response.json({
        value: [OWNER_PERMISSION, MARGE_READ_PERMISSION],
      }),
      new Response(undefined, { status: 204 }),
      Response.json(UPDATED_ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      new Response(undefined, { status: 204 }),
    ]);

    await expect(fixture.operation.remove()).resolves.toEqual({
      state: "removed",
      path: ONEDRIVE_PROOF_PATH,
    });
    expect(fixture.request).toHaveBeenCalledTimes(7);
    expect(fixture.request.mock.calls[2]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/me/drive/items/proof-item/permissions?$select=id,roles,link,invitation,grantedToV2,inheritedFrom",
    );
    expect(fixture.request.mock.calls[3]).toEqual([
      "https://graph.microsoft.com/v1.0/me/drive/items/proof-item/permissions/marge-read-permission",
      {
        method: "DELETE",
        redirect: "error",
        headers: {
          Authorization: "Bearer homer-token",
          "If-Match": '"proof-etag"',
        },
      },
    ]);
    expect(fixture.request.mock.calls[6]).toEqual([
      "https://graph.microsoft.com/v1.0/me/drive/items/proof-item",
      {
        method: "DELETE",
        redirect: "error",
        headers: {
          Authorization: "Bearer homer-token",
          "If-Match": '"proof-etag-after-revoke"',
        },
      },
    ]);
  });

  it("resumes cleanup safely when the exact permission is already absent", async () => {
    const fixture = operation([
      Response.json(ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      Response.json({ value: [OWNER_PERMISSION] }),
      Response.json(UPDATED_ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      new Response(undefined, { status: 204 }),
    ]);

    await expect(fixture.operation.remove()).resolves.toEqual({
      state: "removed",
      path: ONEDRIVE_PROOF_PATH,
    });
    expect(fixture.request).toHaveBeenCalledTimes(6);
    expect(
      fixture.request.mock.calls.filter(
        ([, init]) => init?.method === "DELETE",
      ),
    ).toHaveLength(1);
  });

  it("refuses ambiguous or unrecognized Marge permissions without deleting", async () => {
    for (const permissions of [
      [MARGE_READ_PERMISSION, { ...MARGE_READ_PERMISSION, id: "duplicate" }],
      [{ ...MARGE_READ_PERMISSION, roles: ["write"] }],
      [{ ...MARGE_READ_PERMISSION, link: { type: "view" } }],
      [{ ...MARGE_READ_PERMISSION, inheritedFrom: { id: "parent" } }],
    ]) {
      const fixture = operation([
        Response.json(ITEM),
        new Response(ONEDRIVE_PROOF_CONTENT),
        Response.json({ value: permissions }),
      ]);
      await expect(fixture.operation.remove()).rejects.toBeInstanceOf(
        OneDriveProofConflictError,
      );
      expect(fixture.request).toHaveBeenCalledTimes(3);
    }
  });

  it("does not retry an ambiguous permission revoke", async () => {
    const fixture = operation([
      Response.json(ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      Response.json({ value: [MARGE_READ_PERMISSION] }),
      new Response(undefined, { status: 503 }),
    ]);

    await expect(fixture.operation.remove()).rejects.toThrow(
      "permission cleanup returned HTTP 503",
    );
    expect(fixture.request).toHaveBeenCalledTimes(4);
  });

  it("does not retry cleanup after an eTag conflict", async () => {
    const fixture = operation([
      Response.json(ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      Response.json({ value: [OWNER_PERMISSION] }),
      Response.json(UPDATED_ITEM),
      new Response(ONEDRIVE_PROOF_CONTENT),
      new Response(undefined, { status: 412 }),
    ]);

    await expect(fixture.operation.remove()).rejects.toBeInstanceOf(
      OneDriveProofConflictError,
    );
    expect(fixture.request).toHaveBeenCalledTimes(6);
  });
});

describe("ProcessLocalOneDriveShareProofBoundary", () => {
  it("rejects a concurrent caller and releases the lock after success", async () => {
    const pending = deferred<
      Awaited<ReturnType<OneDriveShareProofOperation["share"]>>
    >();
    const inner: OneDriveShareProofOperation = {
      share: vi.fn(() => pending.promise),
      verify: vi.fn(async () => ({
        state: "verified",
        path: ONEDRIVE_PROOF_PATH,
        verifiedAs: MARGE_USER_PRINCIPAL_NAME,
        contentMatches: true,
      } as const)),
      remove: vi.fn(),
    };
    const boundary = new ProcessLocalOneDriveShareProofBoundary(inner);

    const first = boundary.share();
    await expect(boundary.verify()).rejects.toBeInstanceOf(
      OneDriveProofBusyError,
    );
    pending.resolve({
      state: "shared",
      path: ONEDRIVE_PROOF_PATH,
      owner: HOMER_IDENTITY.userPrincipalName,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      access: "read",
    });
    await expect(first).resolves.toMatchObject({ state: "shared" });
    await expect(boundary.verify()).resolves.toMatchObject({
      state: "verified",
    });
  });

  it("releases the lock after an operation error", async () => {
    const inner: OneDriveShareProofOperation = {
      share: vi.fn(async () => {
        throw new Error("fixture failure");
      }),
      verify: vi.fn(),
      remove: vi.fn(async () => ({
        state: "removed",
        path: ONEDRIVE_PROOF_PATH,
      } as const)),
    };
    const boundary = new ProcessLocalOneDriveShareProofBoundary(inner);

    await expect(boundary.share()).rejects.toThrow("fixture failure");
    await expect(boundary.remove()).resolves.toEqual({
      state: "removed",
      path: ONEDRIVE_PROOF_PATH,
    });
  });
});

function requiredCall(
  calls: Array<[string, RequestInit]>,
  index: number,
): [string, RequestInit] {
  const call = calls.at(index);
  if (!call) {
    throw new Error(`Expected request ${index + 1}.`);
  }
  return call;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
