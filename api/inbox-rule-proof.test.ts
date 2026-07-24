// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DelegatedGraphInboxRuleProof,
  GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
  INBOX_RULE_DISPLAY_NAME,
  INBOX_RULE_SUBJECT,
  InboxRuleProofConflictError,
} from "./inbox-rule-proof.js";
import {
  coryIdentity,
  type DelegatedGraphTokenProvider,
} from "./simulated-user.js";

const cory = coryIdentity("11111111-1111-4111-8111-111111111111");

function storedRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule/id",
    displayName: INBOX_RULE_DISPLAY_NAME,
    sequence: 4,
    isEnabled: false,
    isReadOnly: false,
    hasError: false,
    conditions: { subjectContains: [INBOX_RULE_SUBJECT] },
    exceptions: {},
    actions: { markAsRead: true, stopProcessingRules: false },
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
    getToken: vi.fn(async () => ({ token: "cory-rule-token", identity: cory })),
  } satisfies DelegatedGraphTokenProvider;
  return {
    operation: new DelegatedGraphInboxRuleProof(tokens, cory, request),
    request,
    tokens,
  };
}

describe("DelegatedGraphInboxRuleProof", () => {
  it("lists once, selects a safe sequence, and creates only the fixed disabled rule", async () => {
    const test = fixture([
      Response.json({ value: [storedRule({ displayName: "Other", sequence: 8 })] }),
      Response.json(storedRule({
        sequence: 9,
        actions: { markAsRead: true },
      }), { status: 201 }),
    ]);

    await expect(test.operation.create()).resolves.toEqual({
      state: "configured",
      displayName: INBOX_RULE_DISPLAY_NAME,
    });
    expect(test.tokens.getToken).toHaveBeenCalledWith(
      GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
    );
    expect(test.request).toHaveBeenCalledTimes(2);
    const listUrl = new URL(String(test.request.mock.calls[0]![0]));
    expect(listUrl.pathname).toBe(
      "/v1.0/me/mailFolders/inbox/messageRules",
    );
    expect(listUrl.searchParams.get("$top")).toBe("257");
    const [createUrl, createInit] = test.request.mock.calls[1]!;
    expect(String(createUrl)).toBe(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules",
    );
    expect(createInit).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer cory-rule-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(createInit?.body))).toEqual({
      displayName: INBOX_RULE_DISPLAY_NAME,
      sequence: 9,
      isEnabled: false,
      conditions: { subjectContains: [INBOX_RULE_SUBJECT] },
      actions: { markAsRead: true, stopProcessingRules: false },
    });
  });

  it("accepts one exact existing rule without creating", async () => {
    const test = fixture([Response.json({ value: [storedRule()] })]);
    await expect(test.operation.create()).resolves.toMatchObject({
      state: "configured",
    });
    expect(test.request).toHaveBeenCalledOnce();
  });

  it.each([
    ["duplicate", { value: [storedRule(), storedRule({ id: "two" })] }],
    ["wrong exact-name rule", { value: [storedRule({ isEnabled: true })] }],
    ["pagination", { value: [], "@odata.nextLink": "next" }],
    ["malformed collection", { value: "wrong" }],
    ["unsafe unrelated rule", { value: [{ displayName: "Other" }] }],
  ])("refuses %s without mutating", async (_name, body) => {
    const test = fixture([Response.json(body)]);
    await expect(test.operation.create()).rejects.toBeInstanceOf(
      InboxRuleProofConflictError,
    );
    expect(test.request).toHaveBeenCalledOnce();
  });

  it.each([
    { actions: { markAsRead: true, forwardTo: [{ emailAddress: {} }] } },
    { conditions: {
      subjectContains: [INBOX_RULE_SUBJECT],
      senderContains: ["someone"],
    } },
  ])("rejects a rule with any extra effect", async (override) => {
    const test = fixture([
      Response.json({ value: [storedRule(override)] }),
    ]);
    await expect(test.operation.remove()).rejects.toBeInstanceOf(
      InboxRuleProofConflictError,
    );
    expect(test.request).toHaveBeenCalledOnce();
  });

  it("does not retry an unconfirmed create", async () => {
    const test = fixture([
      Response.json({ value: [] }),
      Response.json(storedRule({ isEnabled: true }), { status: 201 }),
    ]);
    await expect(test.operation.create()).rejects.toThrow("unconfirmed");
    expect(test.request).toHaveBeenCalledTimes(2);
  });

  it("removes one exact rule once and treats absence as removed", async () => {
    const present = fixture([
      Response.json({ value: [storedRule()] }),
      new Response(undefined, { status: 204 }),
    ]);
    await expect(present.operation.remove()).resolves.toEqual({
      state: "removed",
      displayName: INBOX_RULE_DISPLAY_NAME,
    });
    expect(present.request).toHaveBeenCalledTimes(2);
    expect(present.request.mock.calls[1]).toEqual([
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules/rule%2Fid",
      expect.objectContaining({ method: "DELETE", redirect: "error" }),
    ]);

    const absent = fixture([Response.json({ value: [] })]);
    await expect(absent.operation.remove()).resolves.toMatchObject({
      state: "removed",
    });
    expect(absent.request).toHaveBeenCalledOnce();
  });

  it("does not retry a failed removal or use a token for another identity", async () => {
    const failed = fixture([
      Response.json({ value: [storedRule()] }),
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
