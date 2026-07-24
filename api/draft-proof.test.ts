// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  DRAFT_BODY, DRAFT_RECIPIENTS, DRAFT_RUN_ID, DRAFT_RUN_PROPERTY_ID,
  DRAFT_SUBJECT, DelegatedGraphDraftProof, DraftProofConflictError,
  GRAPH_MAIL_READ_WRITE_SCOPE,
} from "./draft-proof.js";
import { coryIdentity, type DelegatedGraphTokenProvider } from "./simulated-user.js";

const cory = coryIdentity("11111111-1111-4111-8111-111111111111");
function recipient(address: string) { return { emailAddress: { address } }; }
function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft/id",
    isDraft: true,
    subject: DRAFT_SUBJECT,
    bodyPreview: DRAFT_BODY,
    body: { contentType: "html", content: "<p>Graph formatting</p>" },
    importance: "low",
    hasAttachments: false,
    toRecipients: DRAFT_RECIPIENTS.map(recipient),
    ccRecipients: [],
    bccRecipients: [],
    from: recipient("cory@corywest.onmicrosoft.com"),
    sender: recipient("cory@corywest.onmicrosoft.com"),
    singleValueExtendedProperties: [{ id: DRAFT_RUN_PROPERTY_ID, value: DRAFT_RUN_ID }],
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
  const tokens = {
    getToken: vi.fn(async () => ({ token: "cory-draft-token", identity: cory })),
  } satisfies DelegatedGraphTokenProvider;
  return { operation: new DelegatedGraphDraftProof(tokens, cory, request), request, tokens };
}

describe("DelegatedGraphDraftProof", () => {
  it("queries the exact Drafts marker, then creates one unsent draft", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(draft({ singleValueExtendedProperties: undefined }), { status: 201 }),
    ]);
    await expect(test.operation.create()).resolves.toEqual(
      { state: "configured", subject: DRAFT_SUBJECT },
    );
    expect(test.tokens.getToken).toHaveBeenCalledWith(GRAPH_MAIL_READ_WRITE_SCOPE);
    expect(test.request).toHaveBeenCalledTimes(2);
    const list = new URL(String(test.request.mock.calls[0]![0]));
    expect(list.pathname).toBe("/v1.0/me/mailFolders/drafts/messages");
    expect(list.searchParams.get("$filter")).toBe(
      `singleValueExtendedProperties/Any(ep: ep/id eq '${DRAFT_RUN_PROPERTY_ID}' and ep/value eq '${DRAFT_RUN_ID}')`,
    );
    expect(list.searchParams.get("$top")).toBe("2");
    expect(list.searchParams.get("$select")).not.toContain("body,");
    const [url, init] = test.request.mock.calls[1]!;
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-draft-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      subject: DRAFT_SUBJECT,
      body: { contentType: "Text", content: DRAFT_BODY },
      toRecipients: DRAFT_RECIPIENTS.map(recipient),
      ccRecipients: [],
      bccRecipients: [],
      importance: "low",
      singleValueExtendedProperties: [{ id: DRAFT_RUN_PROPERTY_ID, value: DRAFT_RUN_ID }],
    });
    expect(String(url)).not.toMatch(/send|reply|forward/i);
  });

  it("accepts one exact existing marked draft without another mutation", async () => {
    const test = fixture([Response.json({ value: [draft()] })]);
    await expect(test.operation.create()).resolves.toMatchObject({ state: "configured" });
    expect(test.request).toHaveBeenCalledOnce();
  });

  it.each([
    ["pagination", { value: [], "@odata.nextLink": "next" }],
    ["duplicates", { value: [draft(), draft({ id: "second" })] }],
    ["not a draft", { value: [draft({ isDraft: false })] }],
    ["wrong subject", { value: [draft({ subject: "wrong" })] }],
    ["wrong preview", { value: [draft({ bodyPreview: "wrong" })] }],
    ["wrong recipient", { value: [draft({
      toRecipients: [recipient(DRAFT_RECIPIENTS[0])],
    })] }],
    ["cc present", { value: [draft({
      ccRecipients: [recipient("other@example.com")],
    })] }],
    ["attachment", { value: [draft({ hasAttachments: true })] }],
    ["wrong marker", { value: [draft({
      singleValueExtendedProperties: [{ id: DRAFT_RUN_PROPERTY_ID, value: "wrong" }],
    })] }],
    ["malformed", { value: "wrong" }],
  ])("refuses %s query state without mutation", async (_case, body) => {
    const test = fixture([Response.json(body)]);
    await expect(test.operation.create()).rejects.toBeInstanceOf(
      DraftProofConflictError,
    );
    expect(test.request).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong status", draft(), 200],
    ["not draft", draft({ isDraft: false }), 201],
    ["wrong preview", draft({ bodyPreview: "wrong" }), 201],
    ["wrong importance", draft({ importance: "normal" }), 201],
    ["attachment", draft({ hasAttachments: true }), 201],
    ["wrong sender", draft({ sender: recipient("other@example.com") }), 201],
    ["bad marker echo", draft({
      singleValueExtendedProperties: [{ id: DRAFT_RUN_PROPERTY_ID, value: "wrong" }],
    }), 201],
  ])("does not retry unconfirmed create: %s", async (_case, body, status) => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(body, { status }),
    ]);
    await expect(test.operation.create()).rejects.toThrow("unconfirmed");
    expect(test.request).toHaveBeenCalledTimes(2);
  });

  it("ignores Graph HTML body presentation when exact preview is retained", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(draft({
        body: { contentType: "html", content: "<p>Graph can normalize this.</p>" },
        singleValueExtendedProperties: undefined,
      }), { status: 201 }),
    ]);
    await expect(test.operation.create()).resolves.toMatchObject({ state: "configured" });
  });

  it("removes one exact retained or stateless draft and treats absence as removed", async () => {
    const retained = fixture([
      Response.json({ value: [] }),
      Response.json(draft({ singleValueExtendedProperties: undefined }), { status: 201 }),
      Response.json({ value: [draft()] }),
      new Response(undefined, { status: 204 }),
    ]);
    await retained.operation.create();
    await expect(retained.operation.remove()).resolves.toMatchObject({ state: "removed" });
    const [url, init] = retained.request.mock.calls[3]!;
    expect(String(url)).toBe(
      "https://graph.microsoft.com/v1.0/me/messages/draft%2Fid",
    );
    expect(init).toMatchObject({ method: "DELETE", redirect: "error" });
    expect(String(url)).not.toMatch(/send|reply|forward/i);

    const stateless = fixture([
      Response.json({ value: [draft()] }),
      new Response(undefined, { status: 204 }),
    ]);
    await expect(stateless.operation.remove()).resolves.toMatchObject({ state: "removed" });
    const absent = fixture([Response.json({ value: [] })]);
    await expect(absent.operation.remove()).resolves.toMatchObject({ state: "removed" });
    expect(absent.request).toHaveBeenCalledOnce();
  });

  it("refuses retained ID mismatch and does not retry failed deletion", async () => {
    const mismatch = fixture([
      Response.json({ value: [] }),
      Response.json(draft({ singleValueExtendedProperties: undefined }), { status: 201 }),
      Response.json({ value: [draft({ id: "different" })] }),
    ]);
    await mismatch.operation.create();
    await expect(mismatch.operation.remove()).rejects.toBeInstanceOf(
      DraftProofConflictError,
    );
    expect(mismatch.request).toHaveBeenCalledTimes(3);

    const failed = fixture([
      Response.json({ value: [draft()] }),
      new Response(undefined, { status: 503 }),
    ]);
    await expect(failed.operation.remove()).rejects.toThrow("HTTP 503");
    expect(failed.request).toHaveBeenCalledTimes(2);
  });

  it("does not query Graph with a token for another identity", async () => {
    const test = fixture([]);
    test.tokens.getToken.mockResolvedValue({
      token: "wrong",
      identity: { ...cory, objectId: "wrong" },
    });
    await expect(test.operation.create()).rejects.toThrow("not for Cory");
    expect(test.request).not.toHaveBeenCalled();
  });
});
