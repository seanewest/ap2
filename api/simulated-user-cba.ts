import { createHash, randomBytes } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { decodeJwt } from "jose";
import { STUDENT_TENANT_ID } from "./identity.js";
import {
  GRAPH_MAIL_SEND_SCOPE,
  HOMER_DISPLAY_NAME,
  HOMER_OBJECT_ID,
  HOMER_USER_PRINCIPAL_NAME,
  type DelegatedGraphToken,
  type DelegatedGraphTokenProvider,
} from "./simulated-email.js";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const CERTIFICATE_AUTHENTICATION_ORIGINS = [
  "https://certauth.login.microsoftonline.com",
  `https://t${STUDENT_TENANT_ID}.certauth.login.microsoftonline.com`,
] as const;
const DEFAULT_REDIRECT_URI = "http://localhost";
const CACHE_SKEW_MS = 120_000;
const REQUIRED_GRAPH_SCOPES = ["User.Read", "Mail.Send"] as const;
const AUTHORIZATION_SCOPES = [
  "openid",
  "profile",
  ...REQUIRED_GRAPH_SCOPES.map((scope) => `${GRAPH_ORIGIN}/${scope}`),
] as const;

interface AuthorizationCodeRequest {
  authorizeUrl: URL;
  expectedState: string;
  redirectUri: string;
  pfxPath: string;
  pfxPassphrase: string;
  timeoutMs: number;
}

export interface AuthorizationCodeBrowser {
  acquireAuthorizationCode(request: AuthorizationCodeRequest): Promise<string>;
}

export interface HomerDelegatedTokenProviderOptions {
  clientId: string;
  pfxPath: string;
  pfxPassphrase: string;
  browser?: AuthorizationCodeBrowser;
  request?: typeof fetch;
  now?: () => number;
  redirectUri?: string;
  timeoutMs?: number;
}

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

export class SimulatedUserCbaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulatedUserCbaError";
  }
}

export class HomerDelegatedTokenProvider
  implements DelegatedGraphTokenProvider
{
  readonly #clientId: string;
  readonly #pfxPath: string;
  readonly #pfxPassphrase: string;
  readonly #browser: AuthorizationCodeBrowser;
  readonly #request: typeof fetch;
  readonly #now: () => number;
  readonly #redirectUri: string;
  readonly #timeoutMs: number;
  #cachedAccessToken: CachedAccessToken | undefined;
  #acquisition: Promise<string> | undefined;

  constructor(options: HomerDelegatedTokenProviderOptions) {
    if (
      !isUuid(options.clientId) ||
      options.pfxPath.length === 0 ||
      options.pfxPassphrase.length === 0
    ) {
      throw new TypeError("The simulated-user CBA configuration is incomplete.");
    }

    const redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
    const timeoutMs = options.timeoutMs ?? 90_000;
    if (!isLoopbackRedirectUri(redirectUri) || timeoutMs <= 0) {
      throw new TypeError("The simulated-user CBA configuration is invalid.");
    }

    this.#clientId = options.clientId;
    this.#pfxPath = options.pfxPath;
    this.#pfxPassphrase = options.pfxPassphrase;
    this.#browser = options.browser ?? new PlaywrightAuthorizationCodeBrowser();
    this.#request = (options.request ?? fetch).bind(globalThis);
    this.#now = options.now ?? Date.now;
    this.#redirectUri = redirectUri;
    this.#timeoutMs = timeoutMs;
  }

  async getToken(scope: string): Promise<DelegatedGraphToken> {
    if (scope !== GRAPH_MAIL_SEND_SCOPE) {
      throw new SimulatedUserCbaError(
        "The simulated user token scope is not allowed.",
      );
    }

    const token = await this.#getAccessToken();
    return {
      token,
      identity: {
        tenantId: STUDENT_TENANT_ID,
        objectId: HOMER_OBJECT_ID,
        userPrincipalName: HOMER_USER_PRINCIPAL_NAME,
      },
    };
  }

  async #getAccessToken(): Promise<string> {
    if (
      this.#cachedAccessToken &&
      this.#now() < this.#cachedAccessToken.expiresAtMs - CACHE_SKEW_MS
    ) {
      return this.#cachedAccessToken.token;
    }

    if (!this.#acquisition) {
      this.#acquisition = this.#acquireAccessToken().finally(() => {
        this.#acquisition = undefined;
      });
    }
    return this.#acquisition;
  }

  async #acquireAccessToken(): Promise<string> {
    try {
      const pkce = createPkce();
      const state = base64Url(randomBytes(32));
      const authorizeUrl = createAuthorizeUrl({
        clientId: this.#clientId,
        redirectUri: this.#redirectUri,
        state,
        challenge: pkce.challenge,
      });
      const code = await this.#browser.acquireAuthorizationCode({
        authorizeUrl,
        expectedState: state,
        redirectUri: this.#redirectUri,
        pfxPath: this.#pfxPath,
        pfxPassphrase: this.#pfxPassphrase,
        timeoutMs: this.#timeoutMs,
      });
      const token = await this.#exchangeCode(code, pkce.verifier);
      const expiresAtMs = validateAccessToken(token, this.#now());
      await this.#verifyHomer(token);
      this.#cachedAccessToken = { token, expiresAtMs };
      return token;
    } catch (error) {
      this.#cachedAccessToken = undefined;
      if (error instanceof SimulatedUserCbaError) {
        throw error;
      }
      throw new SimulatedUserCbaError(
        "Simulated user authentication could not be completed.",
      );
    }
  }

  async #exchangeCode(code: string, verifier: string): Promise<string> {
    let response: Response;
    try {
      response = await this.#request(
        `https://login.microsoftonline.com/${STUDENT_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: this.#clientId,
            code,
            redirect_uri: this.#redirectUri,
            grant_type: "authorization_code",
            code_verifier: verifier,
            scope: AUTHORIZATION_SCOPES.join(" "),
          }),
        },
      );
    } catch {
      throw new SimulatedUserCbaError(
        "Microsoft token exchange could not be reached.",
      );
    }

    const value = await readJson(response);
    if (
      !response.ok ||
      !isRecord(value) ||
      typeof value.access_token !== "string" ||
      value.access_token.length === 0
    ) {
      throw new SimulatedUserCbaError(
        `Microsoft token exchange failed with HTTP ${response.status}.`,
      );
    }
    return value.access_token;
  }

  async #verifyHomer(accessToken: string): Promise<void> {
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
      value.id !== HOMER_OBJECT_ID ||
      value.displayName !== HOMER_DISPLAY_NAME ||
      typeof value.userPrincipalName !== "string" ||
      value.userPrincipalName.toLowerCase() !== HOMER_USER_PRINCIPAL_NAME
    ) {
      throw new SimulatedUserCbaError(
        "Microsoft Graph did not confirm the fixed simulated user.",
      );
    }
  }
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
        return await completeCertificateSignIn(page, callback, request.timeoutMs);
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
      await username.fill(HOMER_USER_PRINCIPAL_NAME);
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
}): URL {
  const url = new URL(
    `https://login.microsoftonline.com/${STUDENT_TENANT_ID}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: AUTHORIZATION_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    login_hint: HOMER_USER_PRINCIPAL_NAME,
  }).toString();
  return url;
}

function validateAccessToken(token: string, nowMs: number): number {
  let claims;
  try {
    claims = decodeJwt(token);
  } catch {
    throw new SimulatedUserCbaError(
      "Microsoft returned an invalid simulated-user access token.",
    );
  }

  const scopes =
    typeof claims.scp === "string" ? claims.scp.split(" ").filter(Boolean) : [];
  const expiresAtMs =
    typeof claims.exp === "number" ? claims.exp * 1_000 : Number.NaN;
  if (
    claims.tid !== STUDENT_TENANT_ID ||
    claims.oid !== HOMER_OBJECT_ID ||
    !REQUIRED_GRAPH_SCOPES.every((scope) => scopes.includes(scope)) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= nowMs + CACHE_SKEW_MS
  ) {
    throw new SimulatedUserCbaError(
      "Microsoft returned an invalid simulated-user access token.",
    );
  }
  return expiresAtMs;
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

function isLoopbackRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pause(milliseconds = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
