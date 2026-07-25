import { createHash, randomBytes } from "node:crypto";
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type AuthorizationCodeRequest as MsalAuthorizationCodeRequest,
  type SilentFlowRequest,
} from "@azure/msal-node";
import { chromium, type BrowserContext, type Page } from "playwright";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  type DelegatedGraphToken,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const CERTIFICATE_AUTHENTICATION_ORIGINS = [
  "https://certauth.login.microsoftonline.com",
  `https://t${STUDENT_TENANT_ID}.certauth.login.microsoftonline.com`,
] as const;
export const SIMULATED_USER_REDIRECT_URI =
  "http://localhost/ap2-simulated-user-callback";
const GRAPH_USER_READ_SCOPE = `${GRAPH_ORIGIN}/User.Read`;
const STUDENT_AUTHORITY =
  `https://login.microsoftonline.com/${STUDENT_TENANT_ID}`;

interface AuthorizationCodeRequest {
  authorizeUrl: URL;
  expectedState: string;
  redirectUri: string;
  pfxPath: string;
  pfxPassphrase: string;
  userPrincipalName: string;
  timeoutMs: number;
}

export interface AuthorizationCodeBrowser {
  acquireAuthorizationCode(request: AuthorizationCodeRequest): Promise<string>;
}

export interface SimulatedUserDelegatedTokenProviderOptions {
  clientId: string;
  pfxPath: string;
  pfxPassphrase: string;
  identity: SimulatedUserIdentity;
  allowedScopes: readonly string[];
  browser?: AuthorizationCodeBrowser;
  msalClient?: SimulatedUserMsalClient;
  request?: typeof fetch;
  timeoutMs?: number;
}

export interface SimulatedUserMsalClient {
  acquireTokenByCode(
    request: MsalAuthorizationCodeRequest,
  ): Promise<AuthenticationResult>;
  acquireTokenSilent(request: SilentFlowRequest): Promise<AuthenticationResult>;
}

export class SimulatedUserCbaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulatedUserCbaError";
  }
}

export class SimulatedUserDelegatedTokenProvider
  implements DelegatedGraphTokenProvider
{
  readonly #clientId: string;
  readonly #pfxPath: string;
  readonly #pfxPassphrase: string;
  readonly #identity: SimulatedUserIdentity;
  readonly #allowedScopes: ReadonlySet<string>;
  readonly #browser: AuthorizationCodeBrowser;
  readonly #msalClient: SimulatedUserMsalClient;
  readonly #request: typeof fetch;
  readonly #timeoutMs: number;
  readonly #acquisitions = new Map<string, Promise<string>>();
  #account?: AccountInfo;
  #interactiveAcquisition?: Promise<InteractiveAcquisition>;

  constructor(options: SimulatedUserDelegatedTokenProviderOptions) {
    if (
      !isUuid(options.clientId) ||
      options.pfxPath.length === 0 ||
      options.pfxPassphrase.length === 0 ||
      options.identity.tenantId !== STUDENT_TENANT_ID ||
      !isUuid(options.identity.objectId) ||
      options.identity.displayName.length === 0 ||
      options.identity.userPrincipalName.length === 0 ||
      options.allowedScopes.length === 0 ||
      options.allowedScopes.some((scope) => !isGraphScope(scope))
    ) {
      throw new TypeError("The simulated-user CBA configuration is incomplete.");
    }

    const timeoutMs = options.timeoutMs ?? 90_000;
    if (timeoutMs <= 0) {
      throw new TypeError("The simulated-user CBA configuration is invalid.");
    }

    this.#clientId = options.clientId;
    this.#pfxPath = options.pfxPath;
    this.#pfxPassphrase = options.pfxPassphrase;
    this.#identity = options.identity;
    this.#allowedScopes = new Set(options.allowedScopes);
    this.#browser = options.browser ?? new PlaywrightAuthorizationCodeBrowser();
    this.#msalClient = options.msalClient ??
      new PublicClientApplication({
        auth: {
          clientId: options.clientId,
          authority: STUDENT_AUTHORITY,
        },
      });
    this.#request = (options.request ?? fetch).bind(globalThis);
    this.#timeoutMs = timeoutMs;
  }

  async getToken(scope: string): Promise<DelegatedGraphToken> {
    if (!this.#allowedScopes.has(scope)) {
      throw new SimulatedUserCbaError(
        "The simulated user token scope is not allowed.",
      );
    }

    const token = await this.#getAccessToken(scope);
    return {
      token,
      identity: {
        tenantId: this.#identity.tenantId,
        objectId: this.#identity.objectId,
        userPrincipalName: this.#identity.userPrincipalName,
      },
    };
  }

  async #getAccessToken(scope: string): Promise<string> {
    let acquisition = this.#acquisitions.get(scope);
    if (!acquisition) {
      acquisition = this.#acquireAccessToken(scope).finally(() => {
        this.#acquisitions.delete(scope);
      });
      this.#acquisitions.set(scope, acquisition);
    }
    return acquisition;
  }

  async #acquireAccessToken(scope: string): Promise<string> {
    try {
      if (!this.#account) {
        const interactive = await this.#acquireInteractive(scope);
        if (interactive.scope === scope) {
          return interactive.accessToken;
        }
      }

      while (true) {
        try {
          return await this.#acquireSilent(scope);
        } catch (error) {
          if (!(error instanceof InteractionRequiredAuthError)) {
            throw error;
          }
          const interactive = await this.#acquireInteractive(scope);
          if (interactive.scope === scope) {
            return interactive.accessToken;
          }
        }
      }
    } catch (error) {
      if (error instanceof SimulatedUserCbaError) {
        throw error;
      }
      throw new SimulatedUserCbaError(
        "Simulated user authentication could not be completed.",
      );
    }
  }

  async #acquireSilent(scope: string): Promise<string> {
    if (!this.#account) {
      throw new SimulatedUserCbaError(
        "The simulated-user MSAL account is unavailable.",
      );
    }
    const result = await this.#msalClient.acquireTokenSilent({
      account: this.#account,
      authority: STUDENT_AUTHORITY,
      scopes: buildTokenScopes(scope),
    });
    return this.#acceptAuthenticationResult(result, scope);
  }

  #acquireInteractive(scope: string): Promise<InteractiveAcquisition> {
    if (!this.#interactiveAcquisition) {
      this.#interactiveAcquisition = this.#runInteractive(scope).finally(() => {
        this.#interactiveAcquisition = undefined;
      });
    }
    return this.#interactiveAcquisition;
  }

  async #runInteractive(scope: string): Promise<InteractiveAcquisition> {
    const authorizationScopes = buildAuthorizationScopes(scope);
    const pkce = createPkce();
    const state = base64Url(randomBytes(32));
    const authorizeUrl = createAuthorizeUrl({
      clientId: this.#clientId,
      redirectUri: SIMULATED_USER_REDIRECT_URI,
      state,
      challenge: pkce.challenge,
      scopes: authorizationScopes,
      userPrincipalName: this.#identity.userPrincipalName,
    });
    const code = await this.#browser.acquireAuthorizationCode({
      authorizeUrl,
      expectedState: state,
      redirectUri: SIMULATED_USER_REDIRECT_URI,
      pfxPath: this.#pfxPath,
      pfxPassphrase: this.#pfxPassphrase,
      userPrincipalName: this.#identity.userPrincipalName,
      timeoutMs: this.#timeoutMs,
    });
    const result = await this.#msalClient.acquireTokenByCode({
      authority: STUDENT_AUTHORITY,
      code,
      codeVerifier: pkce.verifier,
      redirectUri: SIMULATED_USER_REDIRECT_URI,
      scopes: [...authorizationScopes],
    });
    if (!result.account) {
      throw new SimulatedUserCbaError(
        "Microsoft did not return a simulated-user account.",
      );
    }
    const accessToken = await this.#acceptAuthenticationResult(result, scope);
    this.#account = result.account;
    return { scope, accessToken };
  }

  async #acceptAuthenticationResult(
    result: AuthenticationResult,
    requestedScope: string,
  ): Promise<string> {
    if (
      !result.accessToken ||
      !hasGraphScope(result.scopes, GRAPH_USER_READ_SCOPE) ||
      !hasGraphScope(result.scopes, requestedScope)
    ) {
      throw new SimulatedUserCbaError(
        "Microsoft did not return the requested simulated-user access.",
      );
    }
    await this.#verifyIdentity(result.accessToken);
    return result.accessToken;
  }

  async #verifyIdentity(accessToken: string): Promise<void> {
    let response: Response;
    try {
      response = await this.#request(
        `${GRAPH_ORIGIN}/v1.0/me?$select=id,displayName,userPrincipalName`,
        {
          method: "GET",
          redirect: "error",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
    } catch {
      throw new SimulatedUserCbaError(
        "Microsoft Graph identity verification could not be reached.",
      );
    }

    const value = await readJson(response);
    if (
      !response.ok ||
      !isRecord(value) ||
      value.id !== this.#identity.objectId ||
      value.displayName !== this.#identity.displayName ||
      typeof value.userPrincipalName !== "string" ||
      value.userPrincipalName.toLowerCase() !==
        this.#identity.userPrincipalName.toLowerCase()
    ) {
      throw new SimulatedUserCbaError(
        "Microsoft Graph did not confirm the fixed simulated user.",
      );
    }
  }
}

interface InteractiveAcquisition {
  scope: string;
  accessToken: string;
}

class PlaywrightAuthorizationCodeBrowser implements AuthorizationCodeBrowser {
  async acquireAuthorizationCode(
    request: AuthorizationCodeRequest,
  ): Promise<string> {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        clientCertificates: CERTIFICATE_AUTHENTICATION_ORIGINS.map(
          (origin) => ({
            origin,
            pfxPath: request.pfxPath,
            passphrase: request.pfxPassphrase,
          }),
        ),
      });
      try {
        const callback = await observeCallback(
          context,
          request.redirectUri,
          request.expectedState,
        );
        const page = await context.newPage();
        await page.goto(request.authorizeUrl.toString(), {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        return await completeCertificateSignIn(
          page,
          callback,
          request.timeoutMs,
          request.userPrincipalName,
        );
      } finally {
        await context.close();
      }
    } catch (error) {
      if (error instanceof SimulatedUserCbaError) {
        throw error;
      }
      throw new SimulatedUserCbaError(
        "Microsoft certificate sign-in could not be completed.",
      );
    } finally {
      await browser?.close();
    }
  }
}

interface CallbackObserver {
  outcome(): CallbackOutcome | undefined;
}

type CallbackOutcome =
  | { kind: "code"; code: string }
  | { kind: "error"; message: string };

async function observeCallback(
  context: BrowserContext,
  redirectUri: string,
  expectedState: string,
): Promise<CallbackObserver> {
  let captured: CallbackOutcome | undefined;
  const capture = (value: string): void => {
    captured ??= callbackOutcome(value, redirectUri, expectedState);
  };
  context.on("request", (request) => capture(request.url()));
  context.on("framenavigated", (frame) => capture(frame.url()));
  await context.route(
    (url) => sameEndpoint(url, new URL(redirectUri)),
    async (route) => {
      capture(route.request().url());
      await route
        .fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Sign-in complete</title>",
        })
        .catch(() => route.abort().catch(() => undefined));
    },
  );
  return { outcome: () => captured };
}

async function completeCertificateSignIn(
  page: Page,
  callback: CallbackObserver,
  timeoutMs: number,
  userPrincipalName: string,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let accountSelectionHandled = false;
  let usernameSubmitted = false;
  let signInOptionsOpened = false;
  let certificateSelected = false;

  while (Date.now() < deadline) {
    const outcome = callback.outcome();
    if (outcome?.kind === "code") {
      return outcome.code;
    }
    if (outcome?.kind === "error") {
      throw new SimulatedUserCbaError(outcome.message);
    }

    const text = await visibleText(page);
    const aadsts = text.match(/\bAADSTS\d{5,}\b/i)?.[0];
    if (aadsts) {
      throw new SimulatedUserCbaError(
        `Microsoft certificate sign-in failed with ${aadsts.toUpperCase()}.`,
      );
    }
    if (isRegistrationInterruption(page.url(), text)) {
      throw new SimulatedUserCbaError(
        "Microsoft certificate sign-in requires account registration.",
      );
    }
    if (/permissions requested|accept the permissions request/i.test(text)) {
      throw new SimulatedUserCbaError(
        "Simulated-user permissions require administrator consent.",
      );
    }

    if (!accountSelectionHandled && isAccountSelection(text)) {
      const anotherAccount = page
        .getByText(/use another account|sign in with another account/i)
        .first();
      if (await anotherAccount.isVisible().catch(() => false)) {
        await anotherAccount.click();
        accountSelectionHandled = true;
        await pause();
        continue;
      }
    }

    const username = page.locator('input[name="loginfmt"]:visible');
    if (!usernameSubmitted && (await username.isVisible().catch(() => false))) {
      await username.fill(userPrincipalName);
      await page.locator("#idSIButton9").click();
      usernameSubmitted = true;
      await pause();
      continue;
    }

    const certificateOption = page
      .getByText(
        /use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i,
      )
      .first();
    if (
      !certificateSelected &&
      (await certificateOption.isVisible().catch(() => false))
    ) {
      await certificateOption.click();
      certificateSelected = true;
      await pause();
      continue;
    }

    if (!signInOptionsOpened) {
      const signInOptions = page
        .getByText(/sign-in options|sign in another way/i)
        .first();
      if (await signInOptions.isVisible().catch(() => false)) {
        await signInOptions.click();
        signInOptionsOpened = true;
        await pause();
        continue;
      }
    }

    if (/stay signed in/i.test(text)) {
      const decline = page
        .locator('#idBtn_Back, button:has-text("No")')
        .first();
      if (await decline.isVisible().catch(() => false)) {
        await decline.click();
        await pause();
        continue;
      }
    }

    await pause(250);
  }

  throw new SimulatedUserCbaError(
    "Microsoft certificate sign-in timed out.",
  );
}

function createAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scopes: readonly string[];
  userPrincipalName: string;
}): URL {
  const url = new URL(
    `https://login.microsoftonline.com/${STUDENT_TENANT_ID}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: input.scopes.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    login_hint: input.userPrincipalName,
  }).toString();
  return url;
}

function buildAuthorizationScopes(requestedScope: string): readonly string[] {
  return [
    "openid",
    "profile",
    "offline_access",
    GRAPH_USER_READ_SCOPE,
    requestedScope,
  ];
}

function buildTokenScopes(requestedScope: string): string[] {
  return [GRAPH_USER_READ_SCOPE, requestedScope];
}

function hasGraphScope(
  grantedScopes: readonly string[],
  requestedScope: string,
): boolean {
  const requested = graphScopeName(requestedScope);
  return grantedScopes.some((scope) => graphScopeName(scope) === requested);
}

function graphScopeName(scope: string): string | undefined {
  if (/^[A-Za-z][A-Za-z0-9.]*$/.test(scope)) {
    return scope.toLowerCase();
  }
  try {
    const url = new URL(scope);
    return url.origin === GRAPH_ORIGIN &&
        url.pathname.split("/").length === 2 &&
        url.pathname.length > 1 &&
        !url.search &&
        !url.hash
      ? url.pathname.slice(1).toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

function isGraphScope(scope: string): boolean {
  return scope.startsWith(`${GRAPH_ORIGIN}/`) &&
    graphScopeName(scope) !== undefined;
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  return {
    verifier,
    challenge: base64Url(createHash("sha256").update(verifier).digest()),
  };
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function callbackOutcome(
  value: string,
  redirectUri: string,
  expectedState: string,
): CallbackOutcome | undefined {
  let current: URL;
  try {
    current = new URL(value);
  } catch {
    return undefined;
  }
  if (!sameEndpoint(current, new URL(redirectUri))) {
    return undefined;
  }
  if (current.searchParams.get("state") !== expectedState) {
    return {
      kind: "error",
      message: "Microsoft certificate sign-in returned invalid state.",
    };
  }
  const code = current.searchParams.get("code");
  if (code) {
    return { kind: "code", code };
  }
  if (current.searchParams.has("error")) {
    return {
      kind: "error",
      message: "Microsoft certificate sign-in was rejected.",
    };
  }
  return undefined;
}

function sameEndpoint(left: URL, right: URL): boolean {
  return left.origin === right.origin && left.pathname === right.pathname;
}

function isAccountSelection(text: string): boolean {
  return /(?:pick|choose|select) an account|use another account|sign in with another account/i.test(
    text,
  );
}

function isRegistrationInterruption(url: string, text: string): boolean {
  return (
    /(?:mysignins\.microsoft\.com\/security-info|aka\.ms\/mfasetup)/i.test(
      url,
    ) ||
    /(?:more information required|keep your account secure|set up your account|security info|microsoft authenticator|add (?:a )?sign-in method)/i.test(
      text,
    )
  );
}

async function visibleText(page: Page): Promise<string> {
  return page
    .locator("body")
    .innerText()
    .then((value) => value.slice(0, 4_000))
    .catch(() => "");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pause(milliseconds = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
