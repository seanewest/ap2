// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ApiAccessError, HttpAfterPartyApi } from "./client";

describe("HTTP After Party API client", () => {
  it("sends the Bearer token only to the configured whoami URL and returns safe fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          callerType: "delegated",
          tenantId: "student-tenant",
          objectId: "operator-object-id",
          accessToken: "response-must-not-escape",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new HttpAfterPartyApi(
      "https://student-api.example/base",
      request,
    );

    const caller = await client.checkAccess("sensitive-access-token");

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "https://student-api.example/base/api/whoami",
      {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        headers: {
          Authorization: "Bearer sensitive-access-token",
        },
      },
    );
    expect(caller).toEqual({
      callerType: "delegated",
      tenantId: "student-tenant",
    });
    expect(JSON.stringify(caller)).not.toContain("sensitive-access-token");
    expect(JSON.stringify(caller)).not.toContain("operator-object-id");
    expect(JSON.stringify(caller)).not.toContain("response-must-not-escape");
  });

  it("invokes browser fetch with the global receiver", async () => {
    const request = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            callerType: "delegated",
            tenantId: "student-tenant",
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch;
    const client = new HttpAfterPartyApi(
      "https://student-api.example",
      request,
    );

    await expect(client.checkAccess("token")).resolves.toEqual({
      callerType: "delegated",
      tenantId: "student-tenant",
    });
  });

  it.each([
    [401, "API access needs Microsoft authorization. Try again."],
    [403, "This account is not allowed to use the API."],
    [500, "The API could not complete the access check. Try again."],
  ])("returns a safe error for HTTP %i", async (status, message) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider detail", { status }));
    const client = new HttpAfterPartyApi("https://student-api.example", request);

    await expect(client.checkAccess("sensitive-access-token")).rejects.toEqual(
      new ApiAccessError(message),
    );
  });

  it("rejects malformed success data and network failure safely", async () => {
    const malformedRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ callerType: "delegated" }), { status: 200 }),
    );
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        malformedRequest,
      ).checkAccess("token"),
    ).rejects.toEqual(new ApiAccessError());

    const failedRequest = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("raw network detail"));
    await expect(
      new HttpAfterPartyApi(
        "https://student-api.example",
        failedRequest,
      ).checkAccess("token"),
    ).rejects.toEqual(new ApiAccessError());
  });
});
