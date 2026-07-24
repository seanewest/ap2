// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DelegatedGraphOneDriveShareProof,
  GRAPH_FILES_READ_WRITE_SCOPE,
  ONEDRIVE_PROOF_CONTENT,
  ONEDRIVE_PROOF_FILE_NAME,
  ONEDRIVE_PROOF_PATH,
  OneDriveInviteFailureError,
  OneDriveProofBusyError,
  OneDriveProofConflictError,
  ProcessLocalOneDriveShareProofBoundary,
  type OneDriveShareProofOperation,
} from "./onedrive-share-proof.js";
import {
  HOMER_IDENTITY,
  MARGE_IDENTITY,
  MARGE_DISPLAY_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";

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
  return {
    operation: new DelegatedGraphOneDriveShareProof(
      homer,
      request as typeof fetch,
      () => CLIENT_REQUEST_ID,
    ),
    request,
    homer,
  };
}

describe("DelegatedGraphOneDriveShareProof", () => {
  it("creates the fixed bytes once and grants only Marge read access", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({
        value: [MARGE_READ_PERMISSION],
      }),
    ]);

    await expect(fixture.operation.share()).resolves.toEqual({
      state: "configured",
      path: ONEDRIVE_PROOF_PATH,
      owner: HOMER_IDENTITY.userPrincipalName,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      access: "read",
    });
    expect(fixture.homer.getToken).toHaveBeenCalledWith(
      GRAPH_FILES_READ_WRITE_SCOPE,
    );
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
      "https://graph.microsoft.com/v1.0/me/drive/items/proof-item/permissions?$select=id,roles,link,invitation,grantedToV2",
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

  it("reconciles one exact Marge read grant after a 200 shape mismatch", async () => {
    const effectiveGrant = {
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
      Response.json({ value: [OWNER_PERMISSION, effectiveGrant] }),
    ]);

    await expect(fixture.operation.share()).resolves.toMatchObject({
      state: "configured",
    });
    expect(fixture.request).toHaveBeenCalledTimes(6);
    expect(
      fixture.request.mock.calls.filter(
        ([url, init]) => url.endsWith("/invite") && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("accepts the exact Marge grant without reconciliation", async () => {
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
      state: "configured",
    });
    expect(fixture.request).toHaveBeenCalledTimes(5);
  });

  it("does not accept invitation email alone without exact object identity", async () => {
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
      Response.json({ value: [OWNER_PERMISSION, MARGE_READ_PERMISSION] }),
    ]);

    await expect(fixture.operation.share()).resolves.toMatchObject({
      state: "configured",
    });
    expect(fixture.request).toHaveBeenCalledTimes(6);
  });

  it("rejects unknown, linked, write, or duplicate reconciled grants", async () => {
    const exact = {
      id: "marge-read-permission",
      roles: ["read"],
      grantedToV2: { user: { id: MARGE_IDENTITY.objectId } },
    };
    for (const permissions of [
      [{ ...exact, grantedToV2: { user: { id: "another-user" } } }],
      [{ ...exact, link: { type: "view" } }],
      [{ ...exact, roles: ["write"] }],
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

  it("rejects malformed metadata and mismatched content", async () => {
    const malformed = operation([Response.json({ ...ITEM, size: 1 })]);
    await expect(malformed.operation.remove()).rejects.toThrow(
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

  it("revokes only Marge's exact read permission, then revalidates and deletes", async () => {
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
      "https://graph.microsoft.com/v1.0/me/drive/items/proof-item/permissions?$select=id,roles,link,invitation,grantedToV2",
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
      [{
        id: "invitation-only",
        roles: ["read"],
        invitation: { email: MARGE_USER_PRINCIPAL_NAME },
      }],
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
      remove: vi.fn(async () => ({
        state: "removed",
        path: ONEDRIVE_PROOF_PATH,
      } as const)),
    };
    const boundary = new ProcessLocalOneDriveShareProofBoundary(inner);

    const first = boundary.share();
    await expect(boundary.remove()).rejects.toBeInstanceOf(
      OneDriveProofBusyError,
    );
    pending.resolve({
      state: "configured",
      path: ONEDRIVE_PROOF_PATH,
      owner: HOMER_IDENTITY.userPrincipalName,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      access: "read",
    });
    await expect(first).resolves.toMatchObject({ state: "configured" });
    await expect(boundary.remove()).resolves.toMatchObject({
      state: "removed",
    });
  });

  it("releases the lock after an operation error", async () => {
    const inner: OneDriveShareProofOperation = {
      share: vi.fn(async () => {
        throw new Error("fixture failure");
      }),
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
