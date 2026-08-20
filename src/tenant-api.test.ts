import { describe, expect, it, vi } from "vitest";
import { API_ACCESS_SCOPES } from "./api/config";
import type {
  AccountIdentity,
  Authentication,
} from "./auth/authentication";
import { installation } from "./installation";
import {
  INSTALLATION_DISCOVERY_SCOPES,
  InstallationDiscoveryError,
} from "./installation-discovery";
import { connectTenantApi } from "./tenant-api";

const account: AccountIdentity = {
  accountId: "operator-object-id",
  name: "Operator",
  username: "operator@example.test",
  tenantId: installation.student.tenantId,
};

function authentication(): Authentication {
  return {
    initialize: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireAccessToken: vi.fn()
      .mockResolvedValueOnce("graph-token")
      .mockResolvedValueOnce("api-token"),
  };
}

describe("tenant API connection", () => {
  it("uses the tenant-discovered URL for a delegated read before returning the API", async () => {
    const auth = authentication();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        extensionName: "com.seanewest.ap2.installation",
        schemaVersion: 1,
        installationId: installation.installationId,
        apiBaseUrl: "https://discovered-api.example",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        callerType: "delegated",
        objectId: account.accountId,
        tenantId: account.tenantId,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(connectTenantApi(account, auth, request)).resolves.toBeDefined();
    expect(auth.acquireAccessToken).toHaveBeenNthCalledWith(
      1,
      INSTALLATION_DISCOVERY_SCOPES,
    );
    expect(auth.acquireAccessToken).toHaveBeenNthCalledWith(
      2,
      API_ACCESS_SCOPES,
    );
    expect(request.mock.calls[1]?.[0]).toBe(
      "https://discovered-api.example/api/whoami",
    );
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer api-token" },
    });
  });

  it("rejects an API that does not confirm the signed-in tenant", async () => {
    const auth = authentication();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        extensionName: "com.seanewest.ap2.installation",
        schemaVersion: 1,
        installationId: installation.installationId,
        apiBaseUrl: "https://discovered-api.example",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        callerType: "delegated",
        tenantId: "11111111-1111-4111-8111-111111111111",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(connectTenantApi(account, auth, request)).rejects
      .toBeInstanceOf(InstallationDiscoveryError);
  });
});
