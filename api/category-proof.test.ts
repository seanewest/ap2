// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CATEGORY_COLOR,
  CATEGORY_DISPLAY_NAME,
  CategoryProofConflictError,
  DelegatedGraphCategoryProof,
  GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
} from "./category-proof.js";
import {
  coryIdentity,
  type DelegatedGraphTokenProvider,
} from "./simulated-user.js";
const cory = coryIdentity("11111111-1111-4111-8111-111111111111");
function category(overrides: Record<string, unknown> = {}) {
  return {
    id: "category/id",
    displayName: CATEGORY_DISPLAY_NAME,
    color: CATEGORY_COLOR,
    ...overrides,
  };
}
function fixture(responses: readonly Response[]) {
  const queue = [...responses];
  const request = vi.fn<typeof fetch>(async () => {
    const response = queue.shift();
    if (!response) {
      throw new Error("Unexpected Graph request");
    }
    return response;
  });
  const tokens = {
    getToken: vi.fn(async () => ({
      token: "cory-category-token",
      identity: cory,
    })),
  } satisfies DelegatedGraphTokenProvider;
  return {
    operation: new DelegatedGraphCategoryProof(tokens, cory, request),
    request,
    tokens,
  };
}
describe("DelegatedGraphCategoryProof", () => {
  it("lists once, then creates only the exact category", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(category(), { status: 201 }),
    ]);
    await expect(test.operation.create()).resolves.toEqual({
      state: "configured",
      displayName: CATEGORY_DISPLAY_NAME,
    });
    expect(test.tokens.getToken).toHaveBeenCalledWith(
      GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
    );
    expect(test.request).toHaveBeenCalledTimes(2);
    const listUrl = new URL(String(test.request.mock.calls[0]![0]));
    expect(listUrl.pathname).toBe("/v1.0/me/outlook/masterCategories");
    expect(listUrl.searchParams.get("$top")).toBe("257");
    expect(listUrl.searchParams.has("$filter")).toBe(false);
    const [createUrl, createInit] = test.request.mock.calls[1]!;
    expect(String(createUrl)).toBe(
      "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
    );
    expect(createInit).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-category-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(createInit?.body))).toEqual({
      displayName: CATEGORY_DISPLAY_NAME,
      color: CATEGORY_COLOR,
    });
  });
  it("accepts one exact existing category without creating", async () => {
    const test = fixture([Response.json({ value: [category()] })]);
    await expect(test.operation.create()).resolves.toMatchObject({
      state: "configured",
    });
    expect(test.request).toHaveBeenCalledOnce();
  });
  it.each([
    ["duplicate", { value: [category(), category({ id: "two" })] }],
    ["wrong color", { value: [category({ color: "preset8" })] }],
    ["pagination", { value: [], "@odata.nextLink": "next" }],
    ["malformed collection", { value: "wrong" }],
    ["malformed category", { value: [{ displayName: 42 }] }],
  ])("refuses %s without mutating", async (_name, body) => {
    const test = fixture([Response.json(body)]);
    await expect(test.operation.create()).rejects.toBeInstanceOf(
      CategoryProofConflictError,
    );
    expect(test.request).toHaveBeenCalledOnce();
  });
  it("does not retry an unconfirmed create", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(category({ color: "preset8" }), { status: 201 }),
    ]);
    await expect(test.operation.create()).rejects.toThrow("unconfirmed");
    expect(test.request).toHaveBeenCalledTimes(2);
  });
  it("removes one exact category after retained or stateless reconciliation", async () => {
    const retained = fixture([
      Response.json({ value: [] }),
      Response.json(category(), { status: 201 }),
      Response.json({ value: [] }),
      new Response(undefined, { status: 204 }),
    ]);
    await retained.operation.create();
    await expect(retained.operation.remove()).resolves.toEqual({
      state: "removed",
      displayName: CATEGORY_DISPLAY_NAME,
    });
    expect(retained.request).toHaveBeenCalledTimes(4);
    const stateless = fixture([
      Response.json({ value: [category()] }),
      new Response(undefined, { status: 204 }),
    ]);
    await expect(stateless.operation.remove()).resolves.toMatchObject({
      state: "removed",
    });
    expect(stateless.request.mock.calls[1]).toEqual([
      "https://graph.microsoft.com/v1.0/me/outlook/masterCategories/category%2Fid",
      expect.objectContaining({ method: "DELETE", redirect: "error" }),
    ]);
  });
  it("treats absence as removed and refuses a retained-ID mismatch", async () => {
    const absent = fixture([Response.json({ value: [] })]);
    await expect(absent.operation.remove()).resolves.toMatchObject({
      state: "removed",
    });
    expect(absent.request).toHaveBeenCalledOnce();
    const mismatch = fixture([
      Response.json({ value: [] }),
      Response.json(category(), { status: 201 }),
      Response.json({ value: [category({ id: "different" })] }),
    ]);
    await mismatch.operation.create();
    await expect(mismatch.operation.remove()).rejects.toBeInstanceOf(
      CategoryProofConflictError,
    );
    expect(mismatch.request).toHaveBeenCalledTimes(3);
  });
  it("does not retry a failed removal or query with the wrong identity", async () => {
    const failed = fixture([
      Response.json({ value: [category()] }),
      new Response(undefined, { status: 503 }),
    ]);
    await expect(failed.operation.remove()).rejects.toThrow("HTTP 503");
    expect(failed.request).toHaveBeenCalledTimes(2);
    const wrong = fixture([]);
    wrong.tokens.getToken.mockResolvedValue({
      token: "wrong",
      identity: { ...cory, objectId: "wrong" },
    });
    await expect(wrong.operation.create()).rejects.toThrow(
      "not for Cory West",
    );
    expect(wrong.request).not.toHaveBeenCalled();
  });
});
