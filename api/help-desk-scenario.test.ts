// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DelegatedGraphHelpDeskScenarioOperation,
  GRAPH_MAIL_SEND_SCOPE,
  HELP_DESK_SCENARIO_BODY,
  HELP_DESK_SCENARIO_SUBJECT,
} from "./help-desk-scenario.js";
import {
  CORY_USER_PRINCIPAL_NAME,
  KOBE_IDENTITY,
  type DelegatedGraphToken,
} from "./simulated-user.js";

const kobeToken: DelegatedGraphToken = {
  token: "delegated-kobe-token",
  identity: {
    tenantId: KOBE_IDENTITY.tenantId,
    objectId: KOBE_IDENTITY.objectId,
    userPrincipalName: KOBE_IDENTITY.userPrincipalName,
  },
};

describe("delegated Graph help desk scenario", () => {
  it("submits one fixed Kobe-to-Cory email with an explicit non-call label", async () => {
    const tokenProvider = {
      getToken: vi.fn().mockResolvedValue(kobeToken),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));

    const result = await new DelegatedGraphHelpDeskScenarioOperation(
      tokenProvider,
      request,
    ).send();

    expect(tokenProvider.getToken).toHaveBeenCalledWith(GRAPH_MAIL_SEND_SCOPE);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/sendMail",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify({
          message: {
            subject: HELP_DESK_SCENARIO_SUBJECT,
            body: {
              contentType: "Text",
              content: HELP_DESK_SCENARIO_BODY,
            },
            toRecipients: [
              {
                emailAddress: {
                  address: CORY_USER_PRINCIPAL_NAME,
                },
              },
            ],
          },
        }),
      }),
    );
    expect(result).toEqual({
      accepted: true,
      artifact: "outlook-email",
      sender: KOBE_IDENTITY.userPrincipalName,
      recipient: CORY_USER_PRINCIPAL_NAME,
      subject: HELP_DESK_SCENARIO_SUBJECT,
      platformClaims: ["email"],
    });
    expect(HELP_DESK_SCENARIO_BODY).toContain(
      "this is an email, not a Teams call or voicemail",
    );
    expect(JSON.stringify(result)).not.toContain("delegated-kobe-token");
  });

  it.each([
    ["no token", null],
    [
      "another tenant",
      {
        ...kobeToken,
        identity: { ...kobeToken.identity, tenantId: "another-tenant" },
      },
    ],
    [
      "another object",
      {
        ...kobeToken,
        identity: { ...kobeToken.identity, objectId: "another-object" },
      },
    ],
    [
      "another UPN",
      {
        ...kobeToken,
        identity: {
          ...kobeToken.identity,
          userPrincipalName: "not-kobe@corywest.onmicrosoft.com",
        },
      },
    ],
  ])("stops before Graph for %s", async (_label, token) => {
    const request = vi.fn<typeof fetch>();
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(token) },
      request,
    );

    await expect(operation.send()).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not retry a refused submission", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(kobeToken) },
      request,
    );

    await expect(operation.send()).rejects.toThrow(
      "Microsoft Graph sendMail returned HTTP 429",
    );
    await expect(operation.send()).rejects.toThrow(
      "Help desk scenario was already attempted",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not issue a second request after success", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(kobeToken) },
      request,
    );

    await operation.send();
    await expect(operation.send()).rejects.toThrow(
      "Help desk scenario was already attempted",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not retry an ambiguous transport failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ambiguous transport failure"));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(kobeToken) },
      request,
    );

    await expect(operation.send()).rejects.toThrow(
      "ambiguous transport failure",
    );
    await expect(operation.send()).rejects.toThrow(
      "Help desk scenario was already attempted",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
