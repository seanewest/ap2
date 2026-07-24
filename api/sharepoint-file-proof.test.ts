// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  GRAPH_APPLICATION_SCOPE,
  GraphSharePointFileProof,
  SHAREPOINT_DRIVE_ID,
  SHAREPOINT_FILE_CONTENT,
  SHAREPOINT_FILE_NAME,
  SHAREPOINT_FILE_SIZE,
  SharePointFileProofConflictError,
  type GraphApplicationTokenCredential,
} from "./sharepoint-file-proof.js";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "sharepoint/item",
    eTag: '"etag-1"',
    name: SHAREPOINT_FILE_NAME,
    size: SHAREPOINT_FILE_SIZE,
    file: { mimeType: "text/plain" },
    parentReference: { driveId: SHAREPOINT_DRIVE_ID },
    ...overrides,
  };
}
function fixture(responses: readonly Response[]) {
  const queue = [...responses];
  const request = vi.fn<typeof fetch>(async () => {
    const response = queue.shift();
    if (!response) throw new Error("Unexpected Graph request");
    return response;
  });
  const credential = {
    getToken: vi.fn<
      (scope: string) => Promise<{ token: string } | null>
    >(async () => ({ token: "managed-identity-token" })),
  } satisfies GraphApplicationTokenCredential;
  return {
    operation: new GraphSharePointFileProof(credential, request),
    request,
    credential,
  };
}

describe("GraphSharePointFileProof", () => {
  it("uses the API managed identity and creates the exact 78-byte file once", async () => {
    const test = fixture([
      new Response(undefined, { status: 404 }),
      Response.json(item(), { status: 201 }),
    ]);
    await expect(test.operation.create()).resolves.toEqual({
      state: "configured",
      name: SHAREPOINT_FILE_NAME,
    });
    expect(test.credential.getToken).toHaveBeenCalledWith(
      GRAPH_APPLICATION_SCOPE,
    );
    expect(test.request).toHaveBeenCalledTimes(2);
    const [lookupUrl, lookupInit] = test.request.mock.calls[0]!;
    expect(decodeURIComponent(String(lookupUrl))).toContain(
      `/drives/${SHAREPOINT_DRIVE_ID}/root:/${SHAREPOINT_FILE_NAME}`,
    );
    expect(lookupInit).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer managed-identity-token" },
    });
    const [putUrl, putInit] = test.request.mock.calls[1]!;
    expect(new URL(String(putUrl)).searchParams.get(
      "@microsoft.graph.conflictBehavior",
    )).toBe("fail");
    expect(putInit).toMatchObject({
      method: "PUT",
      redirect: "error",
      headers: {
        Authorization: "Bearer managed-identity-token",
        "Content-Type": "text/plain",
      },
      body: SHAREPOINT_FILE_CONTENT,
    });
    expect(new TextEncoder().encode(String(putInit?.body))).toHaveLength(78);
  });

  it("refuses path collisions and malformed lookups without a PUT", async () => {
    for (const response of [
      Response.json(item()),
      Response.json({ name: SHAREPOINT_FILE_NAME }),
      new Response(undefined, { status: 503 }),
    ]) {
      const test = fixture([response]);
      await expect(test.operation.create()).rejects.toBeInstanceOf(
        SharePointFileProofConflictError,
      );
      expect(test.request).toHaveBeenCalledOnce();
    }
  });

  it.each([
    ["wrong status", item(), 200],
    ["wrong name", item({ name: "other.txt" }), 201],
    ["wrong size", item({ size: 77 }), 201],
    ["missing file", item({ file: undefined }), 201],
    ["wrong drive", item({ parentReference: { driveId: "other" } }), 201],
    ["missing id", item({ id: "" }), 201],
    ["missing eTag", item({ eTag: "" }), 201],
  ])("does not retry an unconfirmed create: %s", async (_case, body, status) => {
    const test = fixture([
      new Response(undefined, { status: 404 }),
      Response.json(body, { status }),
    ]);
    await expect(test.operation.create()).rejects.toThrow("unconfirmed");
    expect(test.request).toHaveBeenCalledTimes(2);
  });

  it("removes a stateless exact marked path with its current eTag", async () => {
    const test = fixture([
      Response.json(item({ size: 900, eTag: '"current"' })),
      new Response(undefined, { status: 204 }),
    ]);
    await expect(test.operation.remove()).resolves.toEqual({
      state: "removed",
      name: SHAREPOINT_FILE_NAME,
    });
    expect(test.request).toHaveBeenCalledTimes(2);
    const [url, init] = test.request.mock.calls[1]!;
    expect(decodeURIComponent(String(url))).toContain(
      `/drives/${SHAREPOINT_DRIVE_ID}/items/sharepoint/item`,
    );
    expect(init).toMatchObject({
      method: "DELETE",
      redirect: "error",
      headers: {
        Authorization: "Bearer managed-identity-token",
        "If-Match": '"current"',
      },
    });
  });

  it("treats a 404 path as already removed without deleting", async () => {
    const test = fixture([new Response(undefined, { status: 404 })]);
    await expect(test.operation.remove()).resolves.toMatchObject({
      state: "removed",
    });
    expect(test.request).toHaveBeenCalledOnce();
  });

  it("refuses malformed or ambiguous reconciliation without deleting", async () => {
    for (const response of [
      Response.json(item({ name: "wrong" })),
      Response.json(item({ eTag: "" })),
      new Response(undefined, { status: 503 }),
    ]) {
      const test = fixture([response]);
      await expect(test.operation.remove()).rejects.toBeInstanceOf(
        SharePointFileProofConflictError,
      );
      expect(test.request).toHaveBeenCalledOnce();
    }
    const retained = fixture([
      new Response(undefined, { status: 404 }),
      Response.json(item(), { status: 201 }),
      Response.json(item({ id: "different" })),
    ]);
    await retained.operation.create();
    await expect(retained.operation.remove()).rejects.toBeInstanceOf(
      SharePointFileProofConflictError,
    );
    expect(retained.request).toHaveBeenCalledTimes(3);
  });

  it.each([404, 412])("does not retry a conflicting HTTP %s delete", async (status) => {
    const test = fixture([
      Response.json(item()),
      new Response(undefined, { status }),
    ]);
    await expect(test.operation.remove()).rejects.toBeInstanceOf(
      SharePointFileProofConflictError,
    );
    expect(test.request).toHaveBeenCalledTimes(2);
  });

  it("does not call Graph without a managed-identity token", async () => {
    const test = fixture([]);
    test.credential.getToken.mockResolvedValue(null);
    await expect(test.operation.create()).rejects.toThrow("managed identity");
    expect(test.request).not.toHaveBeenCalled();
  });
});
