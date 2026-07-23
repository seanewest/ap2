// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  AzureRehearsalStatusProvider,
  REHEARSAL_CONTAINER_APP,
  REHEARSAL_RESOURCE_GROUP,
  REHEARSAL_SUBSCRIPTION_ID,
} from "./rehearsal-status.js";

describe("Azure rehearsal status provider", () => {
  it("uses the runtime credential for the one fixed Container App and returns safe fields", async () => {
    const credential = {
      getToken: vi
        .fn()
        .mockResolvedValue({ token: "managed-identity-token" }),
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "must-not-escape",
        name: REHEARSAL_CONTAINER_APP,
        location: "East US",
        properties: {
          runningStatus: "Running",
          latestReadyRevisionName: "ca-ap2-api--revision",
          configuration: { secrets: ["must-not-escape"] },
        },
      }),
    );

    const status = await new AzureRehearsalStatusProvider(
      credential,
      request,
    ).getStatus();

    expect(credential.getToken).toHaveBeenCalledWith(
      "https://management.azure.com/.default",
    );
    expect(request).toHaveBeenCalledWith(
      `https://management.azure.com/subscriptions/${REHEARSAL_SUBSCRIPTION_ID}` +
        `/resourceGroups/${REHEARSAL_RESOURCE_GROUP}` +
        `/providers/Microsoft.App/containerApps/${REHEARSAL_CONTAINER_APP}` +
        "?api-version=2025-07-01",
      {
        method: "GET",
        redirect: "error",
        headers: { Authorization: "Bearer managed-identity-token" },
      },
    );
    expect(status).toEqual({
      appName: "ca-ap2-api",
      region: "East US",
      runningStatus: "Running",
      latestReadyRevision: "ca-ap2-api--revision",
    });
    expect(JSON.stringify(status)).not.toContain("managed-identity-token");
    expect(JSON.stringify(status)).not.toContain("must-not-escape");
  });

  it("fails closed on missing credentials, Azure errors, or malformed data", async () => {
    await expect(
      new AzureRehearsalStatusProvider({
        getToken: vi.fn().mockResolvedValue(null),
      }).getStatus(),
    ).rejects.toThrow("no Azure access token");

    await expect(
      new AzureRehearsalStatusProvider(
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 403 })),
      ).getStatus(),
    ).rejects.toThrow("HTTP 403");

    await expect(
      new AzureRehearsalStatusProvider(
        { getToken: vi.fn().mockResolvedValue({ token: "token" }) },
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            name: REHEARSAL_CONTAINER_APP,
            location: "East US",
            properties: { runningStatus: "Unknown" },
          }),
        ),
      ).getStatus(),
    ).rejects.toThrow("invalid Container App");
  });
});
