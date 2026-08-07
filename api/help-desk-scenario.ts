import {
  CORY_USER_PRINCIPAL_NAME,
  KOBE_IDENTITY,
  type DelegatedGraphTokenProvider,
} from "./simulated-user.js";

export const HELP_DESK_SCENARIO_RUN_ID =
  "ap2-help-desk-email-20260729-001";
export const HELP_DESK_SCENARIO_SUBJECT =
  `AP2 help desk follow-up [${HELP_DESK_SCENARIO_RUN_ID}]`;
export const HELP_DESK_SCENARIO_BODY = [
  "AP2 lab scenario — this is an email, not a Teams call or voicemail.",
  "",
  "Cory, please review the fictional help desk request in this lab.",
  "",
  "Kobe",
].join("\n");
export const GRAPH_MAIL_SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";
const GRAPH_SEND_MAIL_URL = "https://graph.microsoft.com/v1.0/me/sendMail";

export interface HelpDeskScenarioResult {
  accepted: true;
  artifact: "outlook-email";
  sender: typeof KOBE_IDENTITY.userPrincipalName;
  recipient: typeof CORY_USER_PRINCIPAL_NAME;
  subject: typeof HELP_DESK_SCENARIO_SUBJECT;
  platformClaims: readonly ["email"];
}

export interface HelpDeskScenarioOperation {
  send(): Promise<HelpDeskScenarioResult>;
}

export class DelegatedGraphHelpDeskScenarioOperation
  implements HelpDeskScenarioOperation
{
  readonly #tokenProvider: DelegatedGraphTokenProvider;
  readonly #request: typeof fetch;
  #state: "ready" | "sending" | "uncertain" = "ready";

  constructor(
    tokenProvider: DelegatedGraphTokenProvider,
    request: typeof fetch = fetch,
  ) {
    this.#tokenProvider = tokenProvider;
    this.#request = request.bind(globalThis);
  }

  async send(): Promise<HelpDeskScenarioResult> {
    if (this.#state === "sending") {
      throw new Error("Help desk scenario send is already in progress");
    }
    if (this.#state === "uncertain") {
      throw new Error("Previous help desk scenario send outcome is uncertain");
    }
    this.#state = "sending";

    let delegatedToken;
    try {
      delegatedToken = await this.#tokenProvider.getToken(
        GRAPH_MAIL_SEND_SCOPE,
      );
      if (!delegatedToken?.token) {
        throw new Error("Token provider returned no delegated Graph token");
      }
      if (
        delegatedToken.identity.tenantId !== KOBE_IDENTITY.tenantId ||
        delegatedToken.identity.objectId !== KOBE_IDENTITY.objectId ||
        delegatedToken.identity.userPrincipalName !==
          KOBE_IDENTITY.userPrincipalName
      ) {
        throw new Error("Delegated Graph token is not for Kobe West");
      }
    } catch (error) {
      this.#state = "ready";
      throw error;
    }

    let response: Response;
    try {
      response = await this.#request(GRAPH_SEND_MAIL_URL, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${delegatedToken.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: HELP_DESK_SCENARIO_SUBJECT,
            body: {
              contentType: "Text",
              content: HELP_DESK_SCENARIO_BODY,
            },
            toRecipients: [
              {
                emailAddress: {
                  address: CORY_USER_PRINCIPAL_NAME,
                },
              },
            ],
          },
        }),
      });
    } catch (error) {
      this.#state = "uncertain";
      throw error;
    }

    if (response.status !== 202) {
      this.#state =
        response.status === 408 || response.status >= 500
          ? "uncertain"
          : "ready";
      throw new Error(
        `Microsoft Graph sendMail returned HTTP ${response.status}`,
      );
    }
    this.#state = "ready";

    return {
      accepted: true,
      artifact: "outlook-email",
      sender: KOBE_IDENTITY.userPrincipalName,
      recipient: CORY_USER_PRINCIPAL_NAME,
      subject: HELP_DESK_SCENARIO_SUBJECT,
      platformClaims: ["email"],
    };
  }
}
