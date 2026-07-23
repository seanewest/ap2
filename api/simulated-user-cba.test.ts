import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HomerDelegatedTokenProvider,
  SimulatedUserCbaError,
  type AuthorizationCodeBrowser,
} from "./simulated-user-cba.js";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  GRAPH_MAIL_SEND_SCOPE,
  HOMER_DISPLAY_NAME,
  HOMER_OBJECT_ID,
  HOMER_USER_PRINCIPAL_NAME,
} from "./simulated-email.js";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 6, 23, 12);
const PASSPHRASE = "private-passphrase";

function accessToken(
  overrides: Record<string, unknown> = {},
  expiresAt = NOW + 60 * 60 * 1_000,
): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      tid: STUDENT_TENANT_ID,
      oid: HOMER_OBJECT_ID,
      scp: "Mail.Send User.Read",
      exp: expiresAt / 1_000,
      ...overrides,
    }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

function homerResponse(): Response {
  return Response.json({
    id: HOMER_OBJECT_ID,
    displayName: HOMER_DISPLAY_NAME,
    userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
  });
}

function createBrowser(code = "authorization-code"): {
  browser: AuthorizationCodeBrowser;
  acquire: ReturnType<typeof vi.fn>;
} {
  const acquire = vi.fn(async () => code);
  return {
    browser: { acquireAuthorizationCode: acquire },
    acquire,
  };
}

function createRequest(token: string): {
  request: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, init });
    if (url.includes("/oauth2/v2.0/token")) {
      return Response.json({ access_token: token });
    }
    return homerResponse();
  }) as unknown as typeof fetch;
  return { request, calls };
}

function createProvider(options: {
  browser?: AuthorizationCodeBrowser;
  request?: typeof fetch;
  now?: () => number;
}): HomerDelegatedTokenProvider {
  return new HomerDelegatedTokenProvider({
    clientId: CLIENT_ID,
    pfxPath: "/run/secrets/homer.pfx",
    pfxPassphrase: PASSPHRASE,
    browser: options.browser,
    request: options.request,
    now: options.now ?? (() => NOW),
  });
}

describe("HomerDelegatedTokenProvider", () => {
  it("uses public-client PKCE, requests only the bounded scopes, and verifies Homer", async () => {
    const token = accessToken();
    const { browser, acquire } = createBrowser();
    const { request, calls } = createRequest(token);
    const provider = createProvider({ browser, request });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).resolves.toEqual(
      delegatedToken(token),
    );
    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).resolves.toEqual(
      delegatedToken(token),
    );

    expect(acquire).toHaveBeenCalledTimes(1);
    const browserCall = acquire.mock.calls.at(0);
    if (!browserCall) {
      throw new Error("Expected one browser acquisition.");
    }
    const browserRequest = browserCall[0];
    expect(browserRequest.pfxPath).toBe("/run/secrets/homer.pfx");
    expect(browserRequest.pfxPassphrase).toBe(PASSPHRASE);
    expect(browserRequest.authorizeUrl.searchParams.get("login_hint")).toBe(
      HOMER_USER_PRINCIPAL_NAME,
    );
    const scopes = browserRequest.authorizeUrl.searchParams
      .get("scope")
      ?.split(" ");
    expect(scopes).toEqual([
      "openid",
      "profile",
      "https://graph.microsoft.com/User.Read",
      "https://graph.microsoft.com/Mail.Send",
    ]);
    expect(scopes).not.toContain("offline_access");
    expect(
      browserRequest.authorizeUrl.searchParams.get("code_challenge_method"),
    ).toBe("S256");

    expect(calls).toHaveLength(2);
    const tokenCall = calls.at(0);
    const graphCall = calls.at(1);
    if (!tokenCall || !graphCall) {
      throw new Error("Expected token and Graph requests.");
    }
    const tokenBody = tokenCall.init?.body as URLSearchParams;
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("refresh_token")).toBeNull();
    expect(tokenBody.get("scope")).not.toContain("offline_access");
    expect(
      Buffer.from(
        createHash("sha256")
          .update(tokenBody.get("code_verifier") ?? "")
          .digest(),
      ).toString("base64url"),
    ).toBe(browserRequest.authorizeUrl.searchParams.get("code_challenge"));
    expect(graphCall.url).toBe(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName",
    );
    expect(graphCall.init?.headers).toEqual({
      Authorization: `Bearer ${token}`,
    });
  });

  it("shares one acquisition between concurrent callers", async () => {
    let release!: (code: string) => void;
    const code = new Promise<string>((resolve) => {
      release = resolve;
    });
    const acquire = vi.fn(() => code);
    const token = accessToken();
    const { request } = createRequest(token);
    const provider = createProvider({
      browser: { acquireAuthorizationCode: acquire },
      request,
    });

    const first = provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    const second = provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    release("authorization-code");

    await expect(Promise.all([first, second])).resolves.toEqual([
      delegatedToken(token),
      delegatedToken(token),
    ]);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("reacquires once the cached token reaches the two-minute boundary", async () => {
    let now = NOW;
    const firstToken = accessToken({}, NOW + 10 * 60 * 1_000);
    const secondToken = accessToken({}, NOW + 70 * 60 * 1_000);
    const { browser, acquire } = createBrowser();
    const tokens = [firstToken, secondToken];
    const request = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        if (input.toString().includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: tokens.shift() });
        }
        return homerResponse();
      },
    ) as unknown as typeof fetch;
    const provider = createProvider({ browser, request, now: () => now });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).resolves.toEqual(
      delegatedToken(firstToken),
    );
    now = NOW + 8 * 60 * 1_000;
    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).resolves.toEqual(
      delegatedToken(secondToken),
    );
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["another tenant", { tid: "22222222-2222-4222-8222-222222222222" }],
    ["another user", { oid: "33333333-3333-4333-8333-333333333333" }],
    ["missing Mail.Send", { scp: "User.Read" }],
  ])("rejects a token for %s", async (_label, claims) => {
    const { browser } = createBrowser();
    const { request } = createRequest(accessToken(claims));
    const provider = createProvider({ browser, request });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).rejects.toThrow(
      "Microsoft returned an invalid simulated-user access token.",
    );
  });

  it("rejects a Graph identity that is not exactly Homer", async () => {
    const { browser } = createBrowser();
    const token = accessToken();
    const request = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        if (input.toString().includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: token });
        }
        return Response.json({
          id: HOMER_OBJECT_ID,
          displayName: "Not Homer",
          userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
        });
      },
    ) as unknown as typeof fetch;
    const provider = createProvider({ browser, request });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).rejects.toThrow(
      "Microsoft Graph did not confirm the fixed simulated user.",
    );
  });

  it("does not expose browser errors or certificate secrets", async () => {
    const browser: AuthorizationCodeBrowser = {
      acquireAuthorizationCode: vi.fn(async () => {
        throw new Error(`browser failed with ${PASSPHRASE}`);
      }),
    };
    const provider = createProvider({ browser });

    const error = await provider
      .getToken(GRAPH_MAIL_SEND_SCOPE)
      .catch((value) => value);
    expect(error).toBeInstanceOf(SimulatedUserCbaError);
    expect(error.message).toBe(
      "Simulated user authentication could not be completed.",
    );
    expect(error.message).not.toContain(PASSPHRASE);
  });

  it("refuses any token scope except the fixed Mail.Send scope", async () => {
    const { browser, acquire } = createBrowser();
    const provider = createProvider({ browser });

    await expect(
      provider.getToken("https://graph.microsoft.com/User.Read"),
    ).rejects.toThrow("simulated user token scope is not allowed");
    expect(acquire).not.toHaveBeenCalled();
  });
});

function delegatedToken(token: string): {
  token: string;
  identity: {
    tenantId: string;
    objectId: string;
    userPrincipalName: string;
  };
} {
  return {
    token,
    identity: {
      tenantId: STUDENT_TENANT_ID,
      objectId: HOMER_OBJECT_ID,
      userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
    },
  };
}
