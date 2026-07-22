import "./styles.css";
import { createAfterPartyApp } from "./app";
import { MsalAuthentication } from "./auth/msal-authentication";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("The application root element is missing.");
}

const app = createAfterPartyApp(root, new MsalAuthentication());
void app.start();
