// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  OAUTH_RECON_SIGNIN_CONFIGURATION,
  observeOauthReconSignin,
  requiredObservationWindow,
} from "./observe-oauth-recon-signin.js";

const START = "2026-07-26T12:00:00.000Z";
const END = "2026-07-26T12:15:00.000Z";
const CLIENT_ID = "7eb78f18-b49c-495c-a571-af03f06b58a9";
const GRAPH_RESOURCE_ID = "00000003-0000-0000-c000-000000000000";

function signIn(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "private-sign-in-id",
    appDisplayName: "private-app-name",
    createdDateTime: "2026-07-26T12:05:00.1234567Z",
    appId: CLIENT_ID,
    status: { errorCode: 0, failureReason: "private-status-body" },
    signInEventTypes: ["servicePrincipal"],
    resourceId: GRAPH_RESOURCE_ID,
    resourceDisplayName: "private-resource-name",
    ...overrides,
  };
}

describe("OAuth reconnaissance sign-in observer", () => {
  it("validates a canonical closed window of at most 15 minutes", () => {
    expect(requiredObservationWindow(START, END)).toMatchObject({
      start: START,
      end: END,
    });
    const invalidWindows: Array<[string, string, string]> = [
      ["2026-07-26T12:00:00Z", END, "canonical UTC"],
      ["2026-07-26T08:00:00.000-04:00", END, "canonical UTC"],
      ["bad", END, "canonical UTC"],
      [END, START, "must not follow"],
      [START, "2026-07-26T12:15:00.001Z", "15 minutes"],
    ];
    for (const [start, end, message] of invalidWindows) {
      expect(() => requiredObservationWindow(start, end)).toThrow(message);
    }
  });

  it("uses one token and one bounded GET with the exact fixed filter", async () => {
    expect(OAUTH_RECON_SIGNIN_CONFIGURATION).toEqual({
      tenantId: "92563293-315c-4b6c-9b90-bcb47ee8c970",
      clientId: CLIENT_ID,
    });
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: "private-token" }),
    };
    const request = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://graph.microsoft.com");
      expect(url.pathname).toBe("/beta/auditLogs/signIns");
      expect(url.searchParams.get("$top")).toBe("10");
      expect(url.searchParams.get("$filter")).toBe(
        `appId eq '${CLIENT_ID}' and ` +
          `createdDateTime ge ${START} and ` +
          `createdDateTime le ${END} and ` +
          "signInEventTypes/any(t:t eq 'servicePrincipal')",
      );
      expect([...url.searchParams.keys()].sort()).toEqual([
        "$filter",
        "$top",
      ]);
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        headers: { Authorization: "Bearer private-token" },
      });
      expect(init?.body).toBeUndefined();
      return Response.json({
        value: [signIn(), signIn({ id: "another-private-id" })],
        "@odata.nextLink": "https://graph.microsoft.com/private-next-page",
        privateRawBody: "must-not-escape",
      });
    }) as typeof fetch;

    const result = await observeOauthReconSignin(
      requiredObservationWindow(START, END),
      credential,
      request,
    );

    expect(credential.getToken).toHaveBeenCalledTimes(1);
    expect(credential.getToken).toHaveBeenCalledWith(
      "https://graph.microsoft.com/.default",
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      schema: "oauth-recon-signin-observer/v1",
      unit: "oauth-recon-signin",
      observer: "development-automation-app",
      count: 2,
      truncated: true,
      allMatchesInWindow: true,
      allMatchesExactApp: true,
      allMatchesSuccessful: true,
      allMatchesServicePrincipal: true,
      allMatchesGraphResource: true,
    });
    const output = JSON.stringify(result);
    for (const unsafe of [
      "private-token",
      "private-sign-in-id",
      "another-private-id",
      "private-app-name",
      "private-resource-name",
      "private-status-body",
      "private-next-page",
      "must-not-escape",
      CLIENT_ID,
      GRAPH_RESOURCE_ID,
      "graph.microsoft.com",
    ]) {
      expect(output).not.toContain(unsafe);
    }
  });

  it("reports mismatches and cap truncation without pagination", async () => {
    const values = Array.from({ length: 10 }, (_, index) =>
      signIn(index === 0
        ? {
            createdDateTime: "2026-07-26T12:15:00.0000001Z",
            appId: "00000000-0000-0000-0000-000000000000",
            status: { errorCode: 70001 },
            signInEventTypes: ["managedIdentity"],
            resourceId: "11111111-1111-1111-1111-111111111111",
          }
        : { id: `private-${index}` }));
    const request = vi.fn().mockResolvedValue(Response.json({ value: values }));

    const result = await observeOauthReconSignin(
      requiredObservationWindow(START, END),
      { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
      request,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      count: 10,
      truncated: true,
      allMatchesInWindow: false,
      allMatchesExactApp: false,
      allMatchesSuccessful: false,
      allMatchesServicePrincipal: false,
      allMatchesGraphResource: false,
    });
  });

  it("sanitizes authentication, transport, HTTP, and malformed failures", async () => {
    const window = requiredObservationWindow(START, END);
    const noRequest = vi.fn();
    await expect(
      observeOauthReconSignin(
        window,
        {
          getToken: vi.fn().mockRejectedValue(
            new Error("private-auth-detail"),
          ),
        },
        noRequest,
      ),
    ).rejects.toThrow("Observer authentication failed.");
    expect(noRequest).not.toHaveBeenCalled();

    await expect(
      observeOauthReconSignin(
        window,
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        vi.fn().mockRejectedValue(new Error("private-transport-detail")),
      ),
    ).rejects.toThrow("Observer transport failed.");

    await expect(
      observeOauthReconSignin(
        window,
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        vi.fn().mockResolvedValue(
          new Response("private-http-body", { status: 403 }),
        ),
      ),
    ).rejects.toThrow("Observer request failed with HTTP 403.");

    for (const response of [
      new Response("private-malformed-body", { status: 200 }),
      Response.json({ value: [{ appId: CLIENT_ID }] }),
      Response.json({ value: [], "@odata.nextLink": 7 }),
      Response.json({ value: Array.from({ length: 11 }, () => signIn()) }),
    ]) {
      await expect(
        observeOauthReconSignin(
          window,
          { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
          vi.fn().mockResolvedValue(response),
        ),
      ).rejects.toThrow("Observer response was malformed.");
    }
  });

  it("starts directly under Node and rejects missing arguments before auth", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/observe-oauth-recon-signin.ts"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
