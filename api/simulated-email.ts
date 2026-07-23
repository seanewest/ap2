import { STUDENT_TENANT_ID } from "./identity.js";

export const HOMER_OBJECT_ID = "6e54e3a9-7651-4520-a331-047550ae6fca";
export const HOMER_USER_PRINCIPAL_NAME =
  "homer.simpson@corywest.onmicrosoft.com";
export const MARGE_USER_PRINCIPAL_NAME =
  "marge.simpson@corywest.onmicrosoft.com";
export const SIMULATED_EMAIL_SUBJECT = "Dinner tonight";

const GRAPH_MAIL_SEND_SCOPE = "https://graph.microsoft.com/Mail.Send";
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

export interface DelegatedGraphToken {
  token: string;
  identity: {
    tenantId: string;
    objectId: string;
    userPrincipalName: string;
  };
}

export interface DelegatedGraphTokenProvider {
  getToken(scope: string): Promise<DelegatedGraphToken | null>;
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
      delegatedToken.identity.tenantId !== STUDENT_TENANT_ID ||
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
