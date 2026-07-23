export interface AccountIdentity {
  accountId: string;
  name: string;
  username: string;
  tenantId: string;
}

export type AuthenticationStartup =
  | { kind: "signed-out" }
  | {
      kind: "signed-in";
      account: AccountIdentity;
      source: "redirect" | "cache";
    };

export interface Authentication {
  initialize(): Promise<AuthenticationStartup>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  acquireAccessToken(scopes: readonly string[]): Promise<string>;
}

export class AuthenticationCancelledError extends Error {
  constructor() {
    super("Microsoft sign-in was cancelled.");
    this.name = "AuthenticationCancelledError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "Microsoft sign-in could not be completed. Try again.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AccessTokenCancelledError extends Error {
  constructor() {
    super("API access request was cancelled.");
    this.name = "AccessTokenCancelledError";
  }
}

export class AccessTokenError extends Error {
  constructor(message = "Microsoft could not provide API access. Try again.") {
    super(message);
    this.name = "AccessTokenError";
  }
}
