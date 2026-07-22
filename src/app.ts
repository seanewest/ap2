import {
  AuthenticationCancelledError,
  AuthenticationError,
  type AccountIdentity,
  type Authentication,
} from "./auth/authentication";

type ViewState =
  | { kind: "initial" }
  | { kind: "processing"; message: string }
  | { kind: "signed-out" }
  | { kind: "signed-in"; account: AccountIdentity }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export interface AfterPartyApp {
  start(): Promise<void>;
}

export function createAfterPartyApp(
  root: HTMLElement,
  authentication: Authentication,
): AfterPartyApp {
  let state: ViewState = { kind: "initial" };

  const setState = (nextState: ViewState): void => {
    state = nextState;
    render();
  };

  const handleAuthenticationFailure = (error: unknown): void => {
    if (error instanceof AuthenticationCancelledError) {
      setState({ kind: "cancelled" });
      return;
    }

    const message =
      error instanceof AuthenticationError
        ? error.message
        : "Microsoft sign-in could not be completed. Try again.";
    setState({ kind: "error", message });
  };

  const signIn = async (): Promise<void> => {
    setState({ kind: "processing", message: "Opening Microsoft sign-in…" });
    try {
      await authentication.signIn();
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  const signOut = async (): Promise<void> => {
    setState({ kind: "processing", message: "Signing out…" });
    try {
      await authentication.signOut();
      setState({ kind: "signed-out" });
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  const render = (): void => {
    root.replaceChildren(createShell(state));
    root
      .querySelector<HTMLButtonElement>("[data-action='sign-in']")
      ?.addEventListener("click", () => void signIn());
    root
      .querySelector<HTMLButtonElement>("[data-action='sign-out']")
      ?.addEventListener("click", () => void signOut());
  };

  const start = async (): Promise<void> => {
    setState({
      kind: "processing",
      message: "Completing Microsoft sign-in…",
    });
    try {
      const startup = await authentication.initialize();
      setState(
        startup.kind === "signed-in"
          ? { kind: "signed-in", account: startup.account }
          : { kind: "signed-out" },
      );
    } catch (error) {
      handleAuthenticationFailure(error);
    }
  };

  render();
  return { start };
}

function createShell(state: ViewState): HTMLElement {
  const shell = document.createElement("main");
  shell.className = "shell";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "AFTER PARTY";
  shell.append(eyebrow);

  const heading = document.createElement("h1");
  heading.textContent = "Your tenant. Your operations.";
  shell.append(heading);

  const introduction = document.createElement("p");
  introduction.className = "introduction";
  introduction.textContent =
    "Sign in with your Microsoft work or school account to continue.";
  shell.append(introduction, createStatePanel(state));

  return shell;
}

function createStatePanel(state: ViewState): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "auth-panel";
  panel.setAttribute("aria-live", "polite");

  switch (state.kind) {
    case "initial":
      panel.append(createStatus("Preparing sign-in…"));
      break;
    case "processing":
      panel.setAttribute("aria-busy", "true");
      panel.append(createStatus(state.message));
      break;
    case "signed-out":
      panel.append(
        createStatus("You are signed out."),
        createButton("Sign in with Microsoft", "sign-in", "primary"),
      );
      break;
    case "signed-in":
      panel.append(
        createStatus(`Signed in as ${state.account.name}`),
        createIdentityList(state.account),
        createButton("Sign out", "sign-out", "secondary"),
      );
      break;
    case "cancelled":
      panel.append(
        createStatus("Microsoft sign-in was cancelled.", "notice"),
        createButton("Try sign-in again", "sign-in", "primary"),
      );
      break;
    case "error":
      panel.append(
        createStatus(state.message, "error"),
        createButton("Try sign-in again", "sign-in", "primary"),
      );
      break;
  }

  return panel;
}

function createStatus(message: string, className = "status"): HTMLElement {
  const status = document.createElement("p");
  status.className = className;
  status.textContent = message;
  return status;
}

function createButton(
  label: string,
  action: "sign-in" | "sign-out",
  className: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

function createIdentityList(account: AccountIdentity): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "identity-list";

  appendIdentity(list, "Account", account.username);
  appendIdentity(list, "Tenant ID", account.tenantId);
  appendIdentity(list, "Account ID", account.accountId);

  return list;
}

function appendIdentity(
  list: HTMLDListElement,
  label: string,
  value: string,
): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}
