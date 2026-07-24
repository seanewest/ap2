import {
  HOMER_IDENTITY,
  MARGE_USER_PRINCIPAL_NAME,
  type DelegatedGraphTokenProvider,
} from "./simulated-user.js";

export const HOMER_OBJECT_ID = HOMER_IDENTITY.objectId;
export const HOMER_USER_PRINCIPAL_NAME = HOMER_IDENTITY.userPrincipalName;
export const HOMER_DISPLAY_NAME = HOMER_IDENTITY.displayName;
export { MARGE_USER_PRINCIPAL_NAME };
export type {
  DelegatedGraphToken,
  DelegatedGraphTokenProvider,
} from "./simulated-user.js";
export const SIMULATED_EMAIL_SUBJECT = "Dinner tonight";

export const GRAPH_MAIL_SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";
const GRAPH_SEND_MAIL_URL = "https://graph.microsoft.com/v1.0/me/sendMail";
const SIMULATED_EMAIL_BODY =
  "Hi Marge,\n\nI'm running a few minutes late. Could you start dinner without me?\n\nHomer";

export interface SimulatedEmailResult {
  accepted: true;
  sender: typeof HOMER_USER_PRINCIPAL_NAME;
  recipient: typeof MARGE_USER_PRINCIPAL_NAME;
  subject: typeof SIMULATED_EMAIL_SUBJECT;
}

export interface SimulatedEmailOperation {
  send(): Promise<SimulatedEmailResult>;
}

export class DelegatedGraphSimulatedEmailOperation
  implements SimulatedEmailOperation
{
  readonly #tokenProvider: DelegatedGraphTokenProvider;
  readonly #request: typeof fetch;

  constructor(
    tokenProvider: DelegatedGraphTokenProvider,
    request: typeof fetch = fetch,
  ) {
    this.#tokenProvider = tokenProvider;
    this.#request = request.bind(globalThis);
  }

  async send(): Promise<SimulatedEmailResult> {
    const delegatedToken = await this.#tokenProvider.getToken(
      GRAPH_MAIL_SEND_SCOPE,
    );
    if (!delegatedToken?.token) {
      throw new Error("Token provider returned no delegated Graph token");
    }
    if (
      delegatedToken.identity.tenantId !== HOMER_IDENTITY.tenantId ||
      delegatedToken.identity.objectId !== HOMER_OBJECT_ID ||
      delegatedToken.identity.userPrincipalName !==
        HOMER_USER_PRINCIPAL_NAME
    ) {
      throw new Error("Delegated Graph token is not for Homer Simpson");
    }

    const response = await this.#request(GRAPH_SEND_MAIL_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${delegatedToken.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: SIMULATED_EMAIL_SUBJECT,
          body: {
            contentType: "Text",
            content: SIMULATED_EMAIL_BODY,
          },
          toRecipients: [
            {
              emailAddress: {
                address: MARGE_USER_PRINCIPAL_NAME,
              },
            },
          ],
        },
      }),
    });
    if (response.status !== 202) {
      throw new Error(
        `Microsoft Graph sendMail returned HTTP ${response.status}`,
      );
    }

    return {
      accepted: true,
      sender: HOMER_USER_PRINCIPAL_NAME,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      subject: SIMULATED_EMAIL_SUBJECT,
    };
  }
}
