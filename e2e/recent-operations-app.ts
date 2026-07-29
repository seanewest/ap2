import "../src/styles.css";
import { createAfterPartyApp } from "../src/app";
import { HttpAfterPartyApi } from "../src/api/client";
import type {
  Authentication,
  AuthenticationStartup,
} from "../src/auth/authentication";

interface LocalOperatorFixture {
  apiBaseUrl: string;
  accessToken: string;
}

const fixture = (
  window as Window & { __AP2_LOCAL_OPERATOR__?: LocalOperatorFixture }
).__AP2_LOCAL_OPERATOR__;
const root = document.querySelector<HTMLElement>("#app");
if (!fixture || !root) {
  throw new Error("The isolated operator fixture is not configured.");
}
const localFixture = fixture;

class LocalOperatorAuthentication implements Authentication {
  initialize(): Promise<AuthenticationStartup> {
    return Promise.resolve({
      kind: "signed-in",
      source: "cache",
      account: {
        accountId: "fixture-account",
        name: "Fixture Operator",
        username: "fixture-operator@example.invalid",
        tenantId: "fixture-tenant",
      },
    });
  }

  signIn(): Promise<void> {
    return Promise.resolve();
  }

  signOut(): Promise<void> {
    return Promise.resolve();
  }

  acquireAccessToken(): Promise<string> {
    return Promise.resolve(localFixture.accessToken);
  }
}

const app = createAfterPartyApp(
  root,
  new LocalOperatorAuthentication(),
  new HttpAfterPartyApi(localFixture.apiBaseUrl),
);
void app.start();
