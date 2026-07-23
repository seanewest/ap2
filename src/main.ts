import "./styles.css";
import { createAfterPartyApp } from "./app";
import { MsalAuthentication } from "./auth/msal-authentication";
import { HttpAfterPartyApi } from "./api/client";
import { getApiBaseUrl } from "./api/config";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("The application root element is missing.");
}

const app = createAfterPartyApp(
  root,
  new MsalAuthentication(),
  new HttpAfterPartyApi(getApiBaseUrl()),
);
void app.start();
