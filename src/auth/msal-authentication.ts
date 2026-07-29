import {
  BrowserAuthErrorCodes,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
  type HandleRedirectPromiseOptions,
  type PopupRequest,
  type RedirectRequest,
  type SilentRequest,
} from "@azure/msal-browser";
import {
  AccessTokenCancelledError,
  AccessTokenError,
  AuthenticationCancelledError,
  AuthenticationError,
  type AccountIdentity,
  type Authentication,
  type AuthenticationStartup,
} from "./authentication";
import {
  AFTER_PARTY_CLIENT_ID,
  getApplicationUrl,
  ORGANIZATIONS_AUTHORITY,
  SIGN_IN_SCOPES,
} from "./config";

export const MSAL_BROWSER_CONFIGURATION: Configuration = {
  auth: {
    clientId: AFTER_PARTY_CLIENT_ID,
    authority: ORGANIZATIONS_AUTHORITY,
    redirectUri: getApplicationUrl(),
    postLogoutRedirectUri: getApplicationUrl(),
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

export interface MsalClient {
  initialize(): Promise<void>;
  handleRedirectPromise(
    options?: HandleRedirectPromiseOptions,
  ): Promise<AuthenticationResult | null>;
  getActiveAccount(): AccountInfo | null;
  getAllAccounts(): AccountInfo[];
  setActiveAccount(account: AccountInfo | null): void;
  loginRedirect(request: RedirectRequest): Promise<void>;
  logoutRedirect(request: { account?: AccountInfo; postLogoutRedirectUri?: string }): Promise<void>;
  acquireTokenSilent(request: SilentRequest): Promise<AuthenticationResult>;
  acquireTokenPopup(request: PopupRequest): Promise<AuthenticationResult>;
}

export class MsalAuthentication implements Authentication {
  private readonly client: MsalClient;
  private activeAccount: AccountInfo | null = null;
  private sessionRevision = 0;
  private tokenAcquisition: {
    key: string;
    promise: Promise<string>;
  } | null = null;

  constructor(
    client: MsalClient = new PublicClientApplication(
      MSAL_BROWSER_CONFIGURATION,
    ),
  ) {
    this.client = client;
  }

  async initialize(): Promise<AuthenticationStartup> {
    try {
      await this.client.initialize();
      const result = await this.client.handleRedirectPromise({
        navigateToLoginRequestUrl: false,
      });
      const account = this.findAccount(result);

      if (!account) {
        this.clearSession();
        return { kind: "signed-out" };
      }

      this.activateAccount(account);

      return {
        kind: "signed-in",
        account: mapAccountIdentity(account),
        source: result?.account ? "redirect" : "cache",
      };
    } catch (error) {
      throw normalizeAuthenticationError(error);
    }
  }

  async signIn(): Promise<void> {
    try {
      await this.client.loginRedirect({
        scopes: [...SIGN_IN_SCOPES],
        prompt: "select_account",
      });
    } catch (error) {
      throw normalizeAuthenticationError(error);
    }
  }

  async signOut(): Promise<void> {
    const account = this.activeAccount;
    this.clearSession();
    try {
      await this.client.logoutRedirect({
        account: account ?? undefined,
        postLogoutRedirectUri: getApplicationUrl(),
      });
    } catch (error) {
      throw normalizeAuthenticationError(error);
    }
  }

  async acquireAccessToken(scopes: readonly string[]): Promise<string> {
    const account = this.activeAccount;
    if (!account) {
      throw new AccessTokenError("Sign in before checking API access.");
    }

    const key = tokenRequestKey(account, scopes);
    if (this.tokenAcquisition) {
      if (this.tokenAcquisition.key === key) {
        return this.tokenAcquisition.promise;
      }
      throw new AccessTokenError(
        "Another API access request is already in progress.",
      );
    }

    const revision = this.sessionRevision;
    const promise = this.acquireToken(
      account,
      scopes,
      revision,
    ).then((accessToken) => {
      if (
        revision !== this.sessionRevision ||
        !sameAccount(this.activeAccount, account)
      ) {
        throw new AccessTokenError("The operator session changed.");
      }
      return accessToken;
    }).catch((error: unknown) => {
      throw normalizeAccessTokenError(error);
    });
    const guarded = promise.finally(() => {
      if (this.tokenAcquisition?.promise === guarded) {
        this.tokenAcquisition = null;
      }
    });
    this.tokenAcquisition = { key, promise: guarded };
    return guarded;
  }

  private findAccount(result: AuthenticationResult | null): AccountInfo | null {
    if (result?.account) {
      return result.account;
    }

    const activeAccount = this.client.getActiveAccount();
    if (activeAccount) {
      return activeAccount;
    }

    const cachedAccounts = this.client.getAllAccounts();
    return cachedAccounts.length === 1 ? (cachedAccounts[0] ?? null) : null;
  }

  private activateAccount(account: AccountInfo): void {
    if (!sameAccount(this.activeAccount, account)) {
      this.sessionRevision += 1;
      this.tokenAcquisition = null;
    }
    this.activeAccount = account;
    this.client.setActiveAccount(account);
  }

  private clearSession(): void {
    this.sessionRevision += 1;
    this.tokenAcquisition = null;
    this.activeAccount = null;
    this.client.setActiveAccount(null);
  }

  private async acquireToken(
    account: AccountInfo,
    scopes: readonly string[],
    revision: number,
  ): Promise<string> {
    let result: AuthenticationResult;
    try {
      result = await this.client.acquireTokenSilent({
        account,
        scopes: [...scopes],
      });
    } catch (error) {
      if (!(error instanceof InteractionRequiredAuthError)) {
        throw error;
      }
      if (
        revision !== this.sessionRevision ||
        !sameAccount(this.activeAccount, account)
      ) {
        throw new AccessTokenError("The operator session changed.");
      }
      result = await this.client.acquireTokenPopup({
        account,
        scopes: [...scopes],
      });
    }

    if (!result.accessToken) {
      throw new AccessTokenError();
    }
    return result.accessToken;
  }
}

export function mapAccountIdentity(account: AccountInfo): AccountIdentity {
  return {
    accountId: account.localAccountId,
    name: account.name || "Name unavailable",
    username: account.username || "Username unavailable",
    tenantId: account.tenantId,
  };
}

export function normalizeAuthenticationError(error: unknown): Error {
  if (
    error instanceof AuthenticationCancelledError ||
    error instanceof AuthenticationError
  ) {
    return error;
  }

  const errorCode = readStringProperty(error, "errorCode");
  const subError = readStringProperty(error, "subError");
  if (
    errorCode === BrowserAuthErrorCodes.userCancelled ||
    errorCode === "access_denied" ||
    subError === "user_cancelled"
  ) {
    return new AuthenticationCancelledError();
  }

  return new AuthenticationError();
}

export function normalizeAccessTokenError(error: unknown): Error {
  if (
    error instanceof AccessTokenCancelledError ||
    error instanceof AccessTokenError
  ) {
    return error;
  }

  const errorCode = readStringProperty(error, "errorCode");
  const subError = readStringProperty(error, "subError");
  if (
    errorCode === BrowserAuthErrorCodes.userCancelled ||
    errorCode === "access_denied" ||
    subError === "user_cancelled"
  ) {
    return new AccessTokenCancelledError();
  }

  return new AccessTokenError();
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" ? candidate : undefined;
}

function tokenRequestKey(
  account: AccountInfo,
  scopes: readonly string[],
): string {
  return [
    account.homeAccountId,
    account.localAccountId,
    account.tenantId,
    ...scopes,
  ].join("\u0000");
}

function sameAccount(
  current: AccountInfo | null,
  expected: AccountInfo,
): boolean {
  return current !== null &&
    current.homeAccountId === expected.homeAccountId &&
    current.localAccountId === expected.localAccountId &&
    current.tenantId === expected.tenantId;
}
