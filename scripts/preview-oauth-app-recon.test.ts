// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { GRAPH_APPLICATION_SCOPE } from "../api/sharepoint-file-proof.js";
import { previewOauthAppRecon } from "./preview-oauth-app-recon.js";

const NOW = Date.parse("2026-07-26T03:00:00.000Z");

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("OAuth application reconnaissance preview", () => {
  it("runs four bounded GET-only steps with one token and safe output", async () => {
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: "sensitive-token" }),
    };
    const requests: { url: URL; init: RequestInit }[] = [];
    const bodies = [
      { value: [{ id: "membership-id" }] },
      {
        value: [{ id: "folder-id" }, { id: "folder-id-2" }],
        "@odata.nextLink": "https://graph.microsoft.com/redacted-next-page",
      },
      { id: "onedrive-id", name: "root", folder: {} },
      { id: "sharepoint-id", name: "root", folder: {} },
    ];
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: new URL(input.toString()), init: init ?? {} });
      return response(bodies.shift());
    }) as typeof fetch;

    const result = await previewOauthAppRecon(credential, request, NOW);

    expect(credential.getToken).toHaveBeenCalledTimes(1);
    expect(credential.getToken).toHaveBeenCalledWith(GRAPH_APPLICATION_SCOPE);
    expect(request).toHaveBeenCalledTimes(4);
    expect(requests.every(({ init }) =>
      init.method === "GET" &&
      init.body === undefined &&
      init.redirect === "error" &&
      new Headers(init.headers).get("Authorization") ===
        "Bearer sensitive-token")).toBe(true);
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/v1.0/users/1d102db5-eea8-48f0-9074-8a4847384770/memberOf",
      "/v1.0/users/1d102db5-eea8-48f0-9074-8a4847384770/mailFolders",
      "/v1.0/users/1d102db5-eea8-48f0-9074-8a4847384770/drive/root",
      expect.stringMatching(/^\/v1\.0\/drives\/.+\/root$/),
    ]);
    expect(requests.slice(0, 2).every(({ url }) =>
      url.searchParams.get("$select") === "id" &&
      url.searchParams.get("$top") === "25")).toBe(true);
    expect(requests.slice(2).every(({ url }) =>
      url.searchParams.get("$select") === "id,name,folder")).toBe(true);
    expect(result).toEqual({
      schemaVersion: 1,
      scenario: "oauth-application-reconnaissance",
      actor: "development-automation-app",
      observedAt: "2026-07-26T03:00:00.000Z",
      steps: {
        coryDirectoryMemberships: {
          observed: true,
          count: 1,
          truncated: false,
        },
        coryMailboxFolders: {
          observed: true,
          count: 2,
          truncated: true,
        },
        coryOneDriveRoot: { observed: true },
        sharePointDriveRoot: { observed: true },
      },
      completedSteps: 4,
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "sensitive-token",
      "membership-id",
      "folder-id",
      "onedrive-id",
      "sharepoint-id",
      "redacted-next-page",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("fails before Graph when no token is available", async () => {
    const request = vi.fn();
    await expect(
      previewOauthAppRecon(
        { getToken: vi.fn().mockResolvedValue(null) },
        request,
        NOW,
      ),
    ).rejects.toThrow("no Microsoft Graph access token");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not expose authentication or transport exception details", async () => {
    const request = vi.fn();
    await expect(
      previewOauthAppRecon(
        {
          getToken: vi
            .fn()
            .mockRejectedValue(new Error("private-authentication-detail")),
        },
        request,
        NOW,
      ),
    ).rejects.toThrow("Microsoft Graph authentication failed.");
    expect(request).not.toHaveBeenCalled();

    await expect(
      previewOauthAppRecon(
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        vi
          .fn()
          .mockRejectedValue(new Error("private-resource-url-or-network-detail")),
        NOW,
      ),
    ).rejects.toThrow(
      "Microsoft Graph directory memberships observation failed before receiving a response.",
    );
  });

  it("stops on Graph refusal without trying later steps", async () => {
    const request = vi.fn().mockResolvedValue(response({}, 403));
    await expect(
      previewOauthAppRecon(
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        request,
        NOW,
      ),
    ).rejects.toThrow("directory memberships observation failed with HTTP 403");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed collections and roots", async () => {
    const credential = {
      getToken: vi.fn().mockResolvedValue({ token: "token" }),
    };
    await expect(
      previewOauthAppRecon(
        credential,
        vi.fn().mockResolvedValue(response({ value: [{ name: "no-id" }] })),
        NOW,
      ),
    ).rejects.toThrow("directory memberships observation failed");

    const bodies = [
      { value: [] },
      { value: [] },
      { id: "root", name: "root" },
    ];
    await expect(
      previewOauthAppRecon(
        credential,
        vi.fn(async () => response(bodies.shift())),
        NOW,
      ),
    ).rejects.toThrow("OneDrive root observation failed");
  });

  it("starts directly under Node before validating configuration", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/preview-oauth-app-recon.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AP2_AUTOMATION_CERTIFICATE_PATH: "",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "AP2_AUTOMATION_CERTIFICATE_PATH is required.",
    );
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
