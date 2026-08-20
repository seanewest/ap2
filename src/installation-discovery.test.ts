import { describe, expect, it, vi } from "vitest";
import { AP2_INSTALLATION_EXTENSION_NAME } from "../product-identity";
import type { AccountIdentity } from "./auth/authentication";
import { installation } from "./installation";
import {
  discoverTenantInstallation,
  InstallationDiscoveryError,
} from "./installation-discovery";

const account: AccountIdentity = {
  accountId: "operator-object-id",
  name: "Operator",
  username: "operator@example.test",
  tenantId: installation.student.tenantId,
};

function response(
  overrides: Record<string, unknown> = {},
  status = 200,
): Response {
  return new Response(JSON.stringify({
    extensionName: AP2_INSTALLATION_EXTENSION_NAME,
    schemaVersion: 1,
    installationId: installation.installationId,
    apiBaseUrl: "https://student-api.example/base/",
    ...overrides,
  }), { status, headers: { "Content-Type": "application/json" } });
}

describe("tenant installation discovery", () => {
  it("reads and validates the selected tenant's named organization extension", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response());

    await expect(
      discoverTenantInstallation(account, "graph-token", request),
    ).resolves.toEqual({
      schemaVersion: 1,
      installationId: installation.installationId,
      apiBaseUrl: "https://student-api.example/base",
    });
    expect(request).toHaveBeenCalledWith(
      `https://graph.microsoft.com/v1.0/organization/${account.tenantId}` +
        `/extensions/${AP2_INSTALLATION_EXTENSION_NAME}`,
      {
        method: "GET",
        headers: { Authorization: "Bearer graph-token" },
        cache: "no-store",
        redirect: "error",
      },
    );
  });

  it.each([
    [{ schemaVersion: 2 }, 200],
    [{ installationId: "another-installation" }, 200],
    [{ apiBaseUrl: "http://student-api.example" }, 200],
    [{ apiBaseUrl: "https://user:password@student-api.example" }, 200],
    [{ apiBaseUrl: "https://student-api.example/?secret=value" }, 200],
    [{}, 404],
  ])("rejects an absent or unusable tenant record", async (overrides, status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response(overrides, status),
    );

    await expect(
      discoverTenantInstallation(account, "graph-token", request),
    ).rejects.toBeInstanceOf(InstallationDiscoveryError);
  });

  it("refuses another tenant before making a request", async () => {
    const request = vi.fn<typeof fetch>();

    await expect(discoverTenantInstallation(
      { ...account, tenantId: "11111111-1111-4111-8111-111111111111" },
      "graph-token",
      request,
    )).rejects.toBeInstanceOf(InstallationDiscoveryError);
    expect(request).not.toHaveBeenCalled();
  });
});
