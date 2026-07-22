import {
  BrowserAuthErrorCodes,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type Configuration,
} from "@azure/msal-browser";
import {
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

const configuration: Configuration = {
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

export class MsalAuthentication implements Authentication {
  private readonly client = new PublicClientApplication(configuration);
  private activeAccount: AccountInfo | null = null;

  async initialize(): Promise<AuthenticationStartup> {
    try {
      await this.client.initialize();
      const result = await this.client.handleRedirectPromise({
        navigateToLoginRequestUrl: false,
      });
      const account = this.findAccount(result);

      if (!account) {
        return { kind: "signed-out" };
      }

      this.activeAccount = account;
      this.client.setActiveAccount(account);

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
    try {
      await this.client.logoutRedirect({
        account: this.activeAccount ?? undefined,
        postLogoutRedirectUri: getApplicationUrl(),
      });
    } catch (error) {
      throw normalizeAuthenticationError(error);
    }
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

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null || !(property in value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" ? candidate : undefined;
}
