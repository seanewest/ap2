import "../src/styles.css";
import { createAfterPartyApp } from "../src/app";
import { HttpAfterPartyApi } from "../src/api/client";
import {
  MsalAuthentication,
  type MsalClient,
} from "../src/auth/msal-authentication";
import type {
  AccountInfo,
  AuthenticationResult,
} from "@azure/msal-browser";

interface LocalOperatorFixture {
  apiBaseUrl: string;
  accessToken: string;
}

interface LocalOperatorMetrics {
  silentAcquisitions: number;
  popupAcquisitions: number;
}

const harnessWindow = window as Window & {
  __AP2_LOCAL_OPERATOR__?: LocalOperatorFixture;
  __AP2_LOCAL_OPERATOR_METRICS__?: LocalOperatorMetrics;
};
const fixture = harnessWindow.__AP2_LOCAL_OPERATOR__;
const root = document.querySelector<HTMLElement>("#app");
if (!fixture || !root) {
  throw new Error("The isolated operator fixture is not configured.");
}
const localFixture = fixture;
const metrics: LocalOperatorMetrics = {
  silentAcquisitions: 0,
  popupAcquisitions: 0,
};
Object.defineProperty(harnessWindow, "__AP2_LOCAL_OPERATOR_METRICS__", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: metrics,
});

class LocalOperatorMsalClient implements MsalClient {
  private activeAccount: AccountInfo | null = null;
  private readonly account = {
    homeAccountId: "fixture-home-account",
    localAccountId: "fixture-account",
    environment: "fixture.invalid",
    tenantId: "fixture-tenant",
    username: "fixture-operator@example.invalid",
    name: "Fixture Operator",
  } as AccountInfo;

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  handleRedirectPromise(): Promise<AuthenticationResult | null> {
    return Promise.resolve(null);
  }

  getActiveAccount(): AccountInfo | null {
    return this.activeAccount;
  }

  getAllAccounts(): AccountInfo[] {
    return [this.account];
  }

  setActiveAccount(account: AccountInfo | null): void {
    this.activeAccount = account;
  }

  loginRedirect(): Promise<void> {
    return Promise.resolve();
  }

  logoutRedirect(): Promise<void> {
    return Promise.resolve();
  }

  acquireTokenSilent(): Promise<AuthenticationResult> {
    metrics.silentAcquisitions += 1;
    return Promise.resolve({
      account: this.account,
      accessToken: localFixture.accessToken,
    } as AuthenticationResult);
  }

  acquireTokenPopup(): Promise<AuthenticationResult> {
    metrics.popupAcquisitions += 1;
    return Promise.reject(new Error("Interactive acquisition is not expected."));
  }
}

const app = createAfterPartyApp(
  root,
  new MsalAuthentication(new LocalOperatorMsalClient()),
  new HttpAfterPartyApi(localFixture.apiBaseUrl),
);
void app.start();
