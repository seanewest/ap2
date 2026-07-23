// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  DelegatedGraphSimulatedEmailOperation,
  HOMER_OBJECT_ID,
  HOMER_USER_PRINCIPAL_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  SIMULATED_EMAIL_SUBJECT,
  type DelegatedGraphToken,
} from "./simulated-email.js";

const homerToken: DelegatedGraphToken = {
  token: "delegated-homer-token",
  identity: {
    tenantId: STUDENT_TENANT_ID,
    objectId: HOMER_OBJECT_ID,
    userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
  },
};

describe("delegated Graph simulated email operation", () => {
  it("atomically sends the one fixed plain-text message as Homer and returns only safe fields", async () => {
    const tokenProvider = {
      getToken: vi.fn().mockResolvedValue(homerToken),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));

    const result = await new DelegatedGraphSimulatedEmailOperation(
      tokenProvider,
      request,
    ).send();

    expect(tokenProvider.getToken).toHaveBeenCalledOnce();
    expect(tokenProvider.getToken).toHaveBeenCalledWith(
      "https://graph.microsoft.com/Mail.Send",
    );
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: "Bearer delegated-homer-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: SIMULATED_EMAIL_SUBJECT,
            body: {
              contentType: "Text",
              content:
                "Hi Marge,\n\nI'm running a few minutes late. Could you start dinner without me?\n\nHomer",
            },
            toRecipients: [
              {
                emailAddress: {
                  address: MARGE_USER_PRINCIPAL_NAME,
                },
              },
            ],
          },
        }),
      },
    );
    expect(result).toEqual({
      accepted: true,
      sender: HOMER_USER_PRINCIPAL_NAME,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      subject: SIMULATED_EMAIL_SUBJECT,
    });
    expect(JSON.stringify(result)).not.toContain("delegated-homer-token");
  });

  it.each([
    ["no token", null],
    [
      "another tenant",
      {
        ...homerToken,
        identity: { ...homerToken.identity, tenantId: "another-tenant" },
      },
    ],
    [
      "another object",
      {
        ...homerToken,
        identity: { ...homerToken.identity, objectId: "another-object" },
      },
    ],
    [
      "another UPN",
      {
        ...homerToken,
        identity: {
          ...homerToken.identity,
          userPrincipalName: "not-homer@corywest.onmicrosoft.com",
        },
      },
    ],
  ])("does not call Graph for %s", async (_label, token) => {
    const request = vi.fn<typeof fetch>();
    const operation = new DelegatedGraphSimulatedEmailOperation(
      { getToken: vi.fn().mockResolvedValue(token) },
      request,
    );

    await expect(operation.send()).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("requires Graph 202 and does not retry a rejected submission", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));
    const operation = new DelegatedGraphSimulatedEmailOperation(
      { getToken: vi.fn().mockResolvedValue(homerToken) },
      request,
    );

    await expect(operation.send()).rejects.toThrow(
      "Microsoft Graph sendMail returned HTTP 429",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
