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

  it("allows a later explicit send after a definite Graph refusal", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(kobeToken) },
      request,
    );

    await expect(operation.send()).rejects.toThrow(
      "Microsoft Graph sendMail returned HTTP 429",
    );
    await expect(operation.send()).resolves.toMatchObject({ accepted: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("allows a later explicit send after a confirmed acceptance", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(kobeToken) },
      request,
    );

    await operation.send();
    await expect(operation.send()).resolves.toMatchObject({ accepted: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refuses a concurrent send while one is in progress", async () => {
    let resolveToken!: (token: DelegatedGraphToken) => void;
    const token = new Promise<DelegatedGraphToken>((resolve) => {
      resolveToken = resolve;
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockReturnValue(token) },
      request,
    );

    const firstSend = operation.send();
    await expect(operation.send()).rejects.toThrow(
      "Help desk scenario send is already in progress",
    );
    resolveToken(kobeToken);
    await expect(firstSend).resolves.toMatchObject({ accepted: true });
    expect(request).toHaveBeenCalledOnce();
  });

  it("allows a later explicit send after a pre-Graph identity failure", async () => {
    const tokenProvider = {
      getToken: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(kobeToken),
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      tokenProvider,
      request,
    );

    await expect(operation.send()).rejects.toThrow(
      "Token provider returned no delegated Graph token",
    );
    await expect(operation.send()).resolves.toMatchObject({ accepted: true });
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
      "Previous help desk scenario send outcome is uncertain",
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not repeat an ambiguous Graph server failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const operation = new DelegatedGraphHelpDeskScenarioOperation(
      { getToken: vi.fn().mockResolvedValue(kobeToken) },
      request,
    );

    await expect(operation.send()).rejects.toThrow(
      "Microsoft Graph sendMail returned HTTP 500",
    );
    await expect(operation.send()).rejects.toThrow(
      "Previous help desk scenario send outcome is uncertain",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
