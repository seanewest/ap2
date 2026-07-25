import { createHash } from "node:crypto";
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from "@azure/msal-node";
import { describe, expect, it, vi } from "vitest";

const playwright = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({
  chromium: { launch: playwright.launch },
}));

import {
  SimulatedUserDelegatedTokenProvider,
  SimulatedUserCbaError,
  SIMULATED_USER_REDIRECT_URI,
  type AuthorizationCodeBrowser,
  type SimulatedUserMsalClient,
} from "./simulated-user-cba.js";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  GRAPH_MAIL_SEND_SCOPE,
  HOMER_DISPLAY_NAME,
  HOMER_OBJECT_ID,
  HOMER_USER_PRINCIPAL_NAME,
} from "./simulated-email.js";
import {
  CORY_DISPLAY_NAME,
  CORY_USER_PRINCIPAL_NAME,
  HOMER_IDENTITY,
  coryIdentity,
} from "./simulated-user.js";
import { GRAPH_CALENDARS_READ_WRITE_SCOPE } from "./calendar-meeting.js";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const PASSPHRASE = "private-passphrase";
const AUTHORITY =
  `https://login.microsoftonline.com/${STUDENT_TENANT_ID}`;

const HOMER_ACCOUNT: AccountInfo = {
  homeAccountId: `${HOMER_OBJECT_ID}.${STUDENT_TENANT_ID}`,
  environment: "login.microsoftonline.com",
  tenantId: STUDENT_TENANT_ID,
  username: HOMER_USER_PRINCIPAL_NAME,
  localAccountId: HOMER_OBJECT_ID,
  name: HOMER_DISPLAY_NAME,
};

function authenticationResult(
  accessToken: string,
  options: {
    account?: AccountInfo | null;
    scopes?: string[];
    fromCache?: boolean;
  } = {},
): AuthenticationResult {
  return {
    authority: AUTHORITY,
    uniqueId: HOMER_OBJECT_ID,
    tenantId: STUDENT_TENANT_ID,
    scopes: options.scopes ?? ["User.Read", "Mail.Send"],
    account: options.account === undefined ? HOMER_ACCOUNT : options.account,
    idToken: "opaque-id-token",
    idTokenClaims: {},
    accessToken,
    fromCache: options.fromCache ?? false,
    expiresOn: new Date(Date.now() + 60 * 60 * 1_000),
    tokenType: "Bearer",
    correlationId: "11111111-2222-4333-8444-555555555555",
  };
}

function homerResponse(): Response {
  return Response.json({
    id: HOMER_OBJECT_ID,
    displayName: HOMER_DISPLAY_NAME,
    userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
  });
}

function createBrowser(codes = ["authorization-code"]): {
  browser: AuthorizationCodeBrowser;
  acquire: ReturnType<typeof vi.fn>;
} {
  const remaining = [...codes];
  const acquire = vi.fn(async () => remaining.shift() ?? "authorization-code");
  return {
    browser: { acquireAuthorizationCode: acquire },
    acquire,
  };
}

function createMsalClient(options: {
  interactive?: AuthenticationResult[];
  silent?: Array<AuthenticationResult | Error>;
} = {}): {
  client: SimulatedUserMsalClient;
  acquireTokenByCode: ReturnType<typeof vi.fn>;
  acquireTokenSilent: ReturnType<typeof vi.fn>;
} {
  const interactive = [
    ...(options.interactive ?? [authenticationResult("opaque-mail-token")]),
  ];
  const silent = [
    ...(options.silent ?? [
      authenticationResult("opaque-mail-token", { fromCache: true }),
    ]),
  ];
  const acquireTokenByCode = vi.fn(async () => {
    const result = interactive.shift();
    if (!result) {
      throw new Error("Unexpected interactive MSAL request");
    }
    return result;
  });
  const acquireTokenSilent = vi.fn(async () => {
    const result = silent.shift();
    if (result instanceof Error) {
      throw result;
    }
    if (!result) {
      throw new Error("Unexpected silent MSAL request");
    }
    return result;
  });
  return {
    client: { acquireTokenByCode, acquireTokenSilent },
    acquireTokenByCode,
    acquireTokenSilent,
  };
}

function createGraphRequest(
  response: () => Response = homerResponse,
): {
  request: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: input.toString(), init });
      return response();
    },
  ) as unknown as typeof fetch;
  return { request, calls };
}

function createProvider(options: {
  browser?: AuthorizationCodeBrowser;
  msalClient?: SimulatedUserMsalClient;
  request?: typeof fetch;
  allowedScopes?: readonly string[];
}): SimulatedUserDelegatedTokenProvider {
  return new SimulatedUserDelegatedTokenProvider({
    clientId: CLIENT_ID,
    identity: HOMER_IDENTITY,
    allowedScopes: options.allowedScopes ?? [GRAPH_MAIL_SEND_SCOPE],
    pfxPath: "/run/secrets/homer.pfx",
    pfxPassphrase: PASSPHRASE,
    browser: options.browser,
    msalClient: options.msalClient,
    request: options.request,
  });
}

describe("SimulatedUserDelegatedTokenProvider", () => {
  it("seeds MSAL with public-client PKCE and reuses its in-memory cache", async () => {
    const { browser, acquire } = createBrowser();
    const msal = createMsalClient();
    const { request, calls } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
    });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).resolves.toEqual(
      delegatedToken("opaque-mail-token"),
    );
    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).resolves.toEqual(
      delegatedToken("opaque-mail-token"),
    );

    expect(acquire).toHaveBeenCalledOnce();
    const browserRequest = acquire.mock.calls[0]?.[0];
    expect(browserRequest.pfxPath).toBe("/run/secrets/homer.pfx");
    expect(browserRequest.pfxPassphrase).toBe(PASSPHRASE);
    expect(browserRequest.redirectUri).toBe(
      "http://localhost/ap2-simulated-user-callback",
    );
    expect(SIMULATED_USER_REDIRECT_URI).toBe(
      "http://localhost/ap2-simulated-user-callback",
    );
    expect(browserRequest.authorizeUrl.searchParams.get("redirect_uri")).toBe(
      SIMULATED_USER_REDIRECT_URI,
    );
    expect(browserRequest.authorizeUrl.searchParams.get("login_hint")).toBe(
      HOMER_USER_PRINCIPAL_NAME,
    );
    expect(
      browserRequest.authorizeUrl.searchParams.get("scope")?.split(" "),
    ).toEqual([
      "openid",
      "profile",
      "offline_access",
      "https://graph.microsoft.com/User.Read",
      "https://graph.microsoft.com/Mail.Send",
    ]);
    expect(
      browserRequest.authorizeUrl.searchParams.get("code_challenge_method"),
    ).toBe("S256");

    expect(msal.acquireTokenByCode).toHaveBeenCalledOnce();
    const codeRequest = msal.acquireTokenByCode.mock.calls[0]?.[0];
    expect(codeRequest).toMatchObject({
      authority: AUTHORITY,
      code: "authorization-code",
      redirectUri: SIMULATED_USER_REDIRECT_URI,
      scopes: [
        "openid",
        "profile",
        "offline_access",
        "https://graph.microsoft.com/User.Read",
        GRAPH_MAIL_SEND_SCOPE,
      ],
    });
    expect(
      Buffer.from(
        createHash("sha256")
          .update(codeRequest.codeVerifier ?? "")
          .digest(),
      ).toString("base64url"),
    ).toBe(browserRequest.authorizeUrl.searchParams.get("code_challenge"));
    expect(msal.acquireTokenSilent).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      account: HOMER_ACCOUNT,
      authority: AUTHORITY,
      scopes: [
        "https://graph.microsoft.com/User.Read",
        GRAPH_MAIL_SEND_SCOPE,
      ],
    });

    expect(calls).toHaveLength(2);
    expect(calls.every(({ url }) =>
      url ===
        "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName"
    )).toBe(true);
    expect(calls.map(({ init }) => init?.headers)).toEqual([
      { Authorization: "Bearer opaque-mail-token" },
      { Authorization: "Bearer opaque-mail-token" },
    ]);
  });

  it("shares one initial CBA acquisition between concurrent callers", async () => {
    let release!: (code: string) => void;
    const code = new Promise<string>((resolve) => {
      release = resolve;
    });
    const acquire = vi.fn(() => code);
    const msal = createMsalClient();
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser: { acquireAuthorizationCode: acquire },
      msalClient: msal.client,
      request,
    });

    const first = provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    const second = provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    release("authorization-code");

    await expect(Promise.all([first, second])).resolves.toEqual([
      delegatedToken("opaque-mail-token"),
      delegatedToken("opaque-mail-token"),
    ]);
    expect(acquire).toHaveBeenCalledOnce();
    expect(msal.acquireTokenByCode).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it("uses one initial CBA when different scopes arrive concurrently", async () => {
    const filesScope = "https://graph.microsoft.com/Files.ReadWrite";
    let release!: (code: string) => void;
    const code = new Promise<string>((resolve) => {
      release = resolve;
    });
    const acquire = vi.fn(() => code);
    const msal = createMsalClient({
      silent: [
        authenticationResult("opaque-files-token", {
          scopes: ["User.Read", "Files.ReadWrite"],
        }),
      ],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser: { acquireAuthorizationCode: acquire },
      msalClient: msal.client,
      request,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, filesScope],
    });

    const mail = provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    const files = provider.getToken(filesScope);
    release("authorization-code");

    await expect(Promise.all([mail, files])).resolves.toEqual([
      delegatedToken("opaque-mail-token"),
      delegatedToken("opaque-files-token"),
    ]);
    expect(acquire).toHaveBeenCalledOnce();
    expect(msal.acquireTokenByCode).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      account: HOMER_ACCOUNT,
      authority: AUTHORITY,
      scopes: ["https://graph.microsoft.com/User.Read", filesScope],
    });
  });

  it("uses acquireTokenSilent for a later consented Graph scope", async () => {
    const filesScope = "https://graph.microsoft.com/Files.ReadWrite";
    const { browser, acquire } = createBrowser();
    const msal = createMsalClient({
      silent: [
        authenticationResult("opaque-files-token", {
          scopes: ["User.Read", "Files.ReadWrite"],
          fromCache: false,
        }),
      ],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, filesScope],
    });

    await provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    await expect(provider.getToken(filesScope)).resolves.toEqual(
      delegatedToken("opaque-files-token"),
    );

    expect(acquire).toHaveBeenCalledOnce();
    expect(msal.acquireTokenByCode).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      account: HOMER_ACCOUNT,
      authority: AUTHORITY,
      scopes: ["https://graph.microsoft.com/User.Read", filesScope],
    });
  });

  it("opens fresh Playwright only after silent acquisition requires interaction", async () => {
    const filesScope = "https://graph.microsoft.com/Files.ReadWrite";
    const { browser, acquire } = createBrowser(["mail-code", "files-code"]);
    const msal = createMsalClient({
      interactive: [
        authenticationResult("opaque-mail-token"),
        authenticationResult("opaque-files-token", {
          scopes: ["User.Read", "Files.ReadWrite"],
        }),
      ],
      silent: [
        new InteractionRequiredAuthError(
          "interaction_required",
          "11111111-2222-4333-8444-555555555555",
        ),
      ],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, filesScope],
    });

    await provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    await expect(provider.getToken(filesScope)).resolves.toEqual(
      delegatedToken("opaque-files-token"),
    );

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(msal.acquireTokenByCode).toHaveBeenCalledTimes(2);
    expect(msal.acquireTokenSilent).toHaveBeenCalledOnce();
  });

  it("shares one fallback interaction across concurrent silent failures", async () => {
    const filesScope = "https://graph.microsoft.com/Files.ReadWrite";
    const calendarScope = "https://graph.microsoft.com/Calendars.ReadWrite";
    let releaseFallback!: (code: string) => void;
    const fallbackCode = new Promise<string>((resolve) => {
      releaseFallback = resolve;
    });
    const acquire = vi.fn()
      .mockResolvedValueOnce("mail-code")
      .mockImplementationOnce(() => fallbackCode);
    const interactionRequired = () =>
      new InteractionRequiredAuthError(
        "interaction_required",
        "11111111-2222-4333-8444-555555555555",
      );
    const msal = createMsalClient({
      interactive: [
        authenticationResult("opaque-mail-token"),
        authenticationResult("opaque-files-token", {
          scopes: ["User.Read", "Files.ReadWrite"],
        }),
      ],
      silent: [
        interactionRequired(),
        interactionRequired(),
        authenticationResult("opaque-calendar-token", {
          scopes: ["User.Read", "Calendars.ReadWrite"],
        }),
      ],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser: { acquireAuthorizationCode: acquire },
      msalClient: msal.client,
      request,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, filesScope, calendarScope],
    });
    await provider.getToken(GRAPH_MAIL_SEND_SCOPE);

    const files = provider.getToken(filesScope);
    const calendar = provider.getToken(calendarScope);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(2));
    releaseFallback("files-code");

    await expect(Promise.all([files, calendar])).resolves.toEqual([
      delegatedToken("opaque-files-token"),
      delegatedToken("opaque-calendar-token"),
    ]);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(msal.acquireTokenByCode).toHaveBeenCalledTimes(2);
    expect(msal.acquireTokenSilent).toHaveBeenCalledTimes(3);
  });

  it("does not open Playwright for a non-interaction silent failure", async () => {
    const filesScope = "https://graph.microsoft.com/Files.ReadWrite";
    const { browser, acquire } = createBrowser();
    const msal = createMsalClient({
      silent: [new Error(`silent failed with ${PASSPHRASE}`)],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, filesScope],
    });

    await provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    const error = await provider.getToken(filesScope).catch((value) => value);

    expect(error).toBeInstanceOf(SimulatedUserCbaError);
    expect(error.message).toBe(
      "Simulated user authentication could not be completed.",
    );
    expect(error.message).not.toContain(PASSPHRASE);
    expect(acquire).toHaveBeenCalledOnce();
    expect(msal.acquireTokenByCode).toHaveBeenCalledOnce();
  });

  it("rejects a Graph identity that is not exactly Homer", async () => {
    const { browser } = createBrowser();
    const msal = createMsalClient();
    const { request } = createGraphRequest(() =>
      Response.json({
        id: HOMER_OBJECT_ID,
        displayName: "Not Homer",
        userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
      })
    );
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
    });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).rejects.toThrow(
      "Microsoft Graph did not confirm the fixed simulated user.",
    );
  });

  it.each([
    ["User.Read", ["Mail.Send"]],
    ["the requested operation scope", ["User.Read"]],
  ])("rejects an interactive result missing %s", async (_label, scopes) => {
    const { browser } = createBrowser();
    const msal = createMsalClient({
      interactive: [
        authenticationResult("opaque-mail-token", { scopes }),
      ],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
    });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).rejects.toThrow(
      "Microsoft did not return the requested simulated-user access.",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a silent result missing the later requested scope", async () => {
    const filesScope = "https://graph.microsoft.com/Files.ReadWrite";
    const { browser, acquire } = createBrowser();
    const msal = createMsalClient({
      silent: [
        authenticationResult("opaque-files-token", {
          scopes: ["User.Read"],
        }),
      ],
    });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
      allowedScopes: [GRAPH_MAIL_SEND_SCOPE, filesScope],
    });

    await provider.getToken(GRAPH_MAIL_SEND_SCOPE);
    await expect(provider.getToken(filesScope)).rejects.toThrow(
      "Microsoft did not return the requested simulated-user access.",
    );
    expect(acquire).toHaveBeenCalledOnce();
    expect(msal.acquireTokenByCode).toHaveBeenCalledOnce();
    expect(msal.acquireTokenSilent).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing account", authenticationResult("opaque-token", { account: null })],
    ["missing token", authenticationResult("", {})],
  ])("fails closed for an MSAL result with %s", async (_label, result) => {
    const { browser } = createBrowser();
    const msal = createMsalClient({ interactive: [result] });
    const { request } = createGraphRequest();
    const provider = createProvider({
      browser,
      msalClient: msal.client,
      request,
    });

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).rejects.toBeInstanceOf(
      SimulatedUserCbaError,
    );
  });

  it("does not expose browser errors or certificate secrets", async () => {
    const browser: AuthorizationCodeBrowser = {
      acquireAuthorizationCode: vi.fn(async () => {
        throw new Error(`browser failed with ${PASSPHRASE}`);
      }),
    };
    const msal = createMsalClient();
    const provider = createProvider({ browser, msalClient: msal.client });

    const error = await provider
      .getToken(GRAPH_MAIL_SEND_SCOPE)
      .catch((value) => value);
    expect(error).toBeInstanceOf(SimulatedUserCbaError);
    expect(error.message).toBe(
      "Simulated user authentication could not be completed.",
    );
    expect(error.message).not.toContain(PASSPHRASE);
  });

  it("refuses any token scope outside the configured Graph scopes", async () => {
    const { browser, acquire } = createBrowser();
    const msal = createMsalClient();
    const provider = createProvider({ browser, msalClient: msal.client });

    await expect(
      provider.getToken("https://graph.microsoft.com/User.Read"),
    ).rejects.toThrow("simulated user token scope is not allowed");
    expect(acquire).not.toHaveBeenCalled();
    expect(msal.acquireTokenByCode).not.toHaveBeenCalled();
  });

  it("supplies Homer certificate only to both approved CBA origins", async () => {
    const newContext = vi.fn().mockRejectedValue(new Error("captured"));
    const close = vi.fn();
    playwright.launch.mockResolvedValue({ newContext, close });
    const provider = createProvider({});

    await expect(provider.getToken(GRAPH_MAIL_SEND_SCOPE)).rejects.toThrow(
      "Microsoft certificate sign-in could not be completed.",
    );

    expect(newContext).toHaveBeenCalledOnce();
    expect(newContext).toHaveBeenCalledWith({
      clientCertificates: [
        {
          origin: "https://certauth.login.microsoftonline.com",
          pfxPath: "/run/secrets/homer.pfx",
          passphrase: PASSPHRASE,
        },
        {
          origin:
            "https://t92563293-315c-4b6c-9b90-bcb47ee8c970.certauth.login.microsoftonline.com",
          pfxPath: "/run/secrets/homer.pfx",
          passphrase: PASSPHRASE,
        },
      ],
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses an isolated Cory identity and MSAL client", async () => {
    const coryObjectId = "22222222-2222-4222-8222-222222222222";
    const coryAccount: AccountInfo = {
      ...HOMER_ACCOUNT,
      homeAccountId: `${coryObjectId}.${STUDENT_TENANT_ID}`,
      username: CORY_USER_PRINCIPAL_NAME,
      localAccountId: coryObjectId,
      name: CORY_DISPLAY_NAME,
    };
    const coryToken = authenticationResult("opaque-cory-token", {
      account: coryAccount,
      scopes: ["User.Read", "Calendars.ReadWrite"],
    });
    const { browser, acquire } = createBrowser();
    const msal = createMsalClient({ interactive: [coryToken] });
    const { request } = createGraphRequest(() =>
      Response.json({
        id: coryObjectId,
        displayName: CORY_DISPLAY_NAME,
        userPrincipalName: CORY_USER_PRINCIPAL_NAME,
      })
    );
    const provider = new SimulatedUserDelegatedTokenProvider({
      clientId: CLIENT_ID,
      identity: coryIdentity(coryObjectId),
      allowedScopes: [GRAPH_CALENDARS_READ_WRITE_SCOPE],
      pfxPath: "/run/secrets/cory.pfx",
      pfxPassphrase: PASSPHRASE,
      browser,
      msalClient: msal.client,
      request,
    });

    await expect(
      provider.getToken(GRAPH_CALENDARS_READ_WRITE_SCOPE),
    ).resolves.toEqual({
      token: "opaque-cory-token",
      identity: {
        tenantId: STUDENT_TENANT_ID,
        objectId: coryObjectId,
        userPrincipalName: CORY_USER_PRINCIPAL_NAME,
      },
    });
    expect(acquire.mock.calls[0]?.[0].pfxPath).toBe(
      "/run/secrets/cory.pfx",
    );
    expect(
      acquire.mock.calls[0]?.[0].authorizeUrl.searchParams
        .get("scope")
        ?.split(" "),
    ).toEqual([
      "openid",
      "profile",
      "offline_access",
      "https://graph.microsoft.com/User.Read",
      GRAPH_CALENDARS_READ_WRITE_SCOPE,
    ]);
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
