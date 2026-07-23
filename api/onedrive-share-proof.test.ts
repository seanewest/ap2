// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DelegatedGraphOneDriveShareProof,
  GRAPH_FILES_READ_SCOPE,
  GRAPH_FILES_READ_WRITE_SCOPE,
  ONEDRIVE_PROOF_CONTENT,
  ONEDRIVE_PROOF_FILE_NAME,
  ONEDRIVE_PROOF_PATH,
  OneDriveProofBusyError,
  OneDriveProofConflictError,
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
  return {
    operation: new DelegatedGraphOneDriveShareProof(
      homer,
      marge,
      MARGE_IDENTITY,
      request as typeof fetch,
    ),
    request,
    homer,
    marge,
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
        value: [
          {
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
      recipients: [{ email: MARGE_USER_PRINCIPAL_NAME }],
      requireSignIn: true,
      sendInvitation: false,
      roles: ["read"],
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

  it("does not retry an ambiguous invitation result", async () => {
    const fixture = operation([
      new Response(undefined, { status: 404 }),
      Response.json({ id: "root-item" }),
      Response.json({ uploadUrl: "https://upload.example/proof" }),
      Response.json(ITEM, { status: 201 }),
      Response.json({ value: [] }),
    ]);

    await expect(fixture.operation.share()).rejects.toThrow(
      "sharing returned HTTP 200",
    );
    expect(fixture.request).toHaveBeenCalledTimes(5);
  });

  it("verifies exact bytes through Marge's direct drive/item content path", async () => {
    const fixture = operation([
      Response.json(ITEM),
      Response.json(ITEM),
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
    const directMetadata = requiredCall(calls, 1);
    const graphContent = requiredCall(calls, 2);
    const directContent = requiredCall(calls, 3);
    expect(directMetadata[0]).toBe(
      "https://graph.microsoft.com/v1.0/drives/homer-drive/items/proof-item?$select=id,name,size,file,eTag,parentReference",
    );
    expect(graphContent[0]).toBe(
      "https://graph.microsoft.com/v1.0/drives/homer-drive/items/proof-item/content",
    );
    expect(graphContent[1].headers).toEqual({
      Authorization: "Bearer marge-token",
    });
    expect(directContent[1].headers).toBeUndefined();
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
