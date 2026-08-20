import "./styles.css";
import { createAfterPartyApp } from "./app";
import { HttpAfterPartyApi } from "./api/client";
import { getApiBaseUrl } from "./api/config";
import { MsalAuthentication } from "./auth/msal-authentication";
import { connectTenantApi } from "./tenant-api";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("The application root element is missing.");
}

const authentication = new MsalAuthentication();
const configuredDevelopmentApi = import.meta.env.VITE_API_BASE_URL;
const app = createAfterPartyApp(
  root,
  authentication,
  configuredDevelopmentApi
    ? new HttpAfterPartyApi(getApiBaseUrl())
    : (account) => connectTenantApi(account, authentication),
);
void app.start();
