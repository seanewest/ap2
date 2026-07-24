import {
  CORY_USER_PRINCIPAL_NAME,
  type DelegatedGraphToken,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";
const CONTACTS_URL = "https://graph.microsoft.com/v1.0/me/contacts";
const CONTACT_SELECT = [
  "id", "displayName", "givenName", "surname", "emailAddresses",
  "businessPhones", "homePhones", "mobilePhone", "businessAddress",
  "homeAddress", "otherAddress", "companyName", "personalNotes",
].join(",");
const EMPTY_CONTACT_FIELDS = [
  "businessPhones", "homePhones", "mobilePhone", "businessAddress",
  "homeAddress", "otherAddress", "companyName", "personalNotes",
] as const;
export const GRAPH_CONTACTS_READ_WRITE_SCOPE = "https://graph.microsoft.com/Contacts.ReadWrite";
export const CONTACT_RUN_ID = "ap2-contact-20260724-001";
export const CONTACT_RUN_PROPERTY_ID = "String {95bf4d13-9a68-485d-92cf-7883b578f1a3} Name AP2RunId";
export const CONTACT_DISPLAY_NAME = "AP2 Kobe Contact Proof";
export const CONTACT_EMAIL = "kobe@corywest.onmicrosoft.com";
type ConfiguredContact = {
  state: "configured";
  displayName: typeof CONTACT_DISPLAY_NAME;
  email: typeof CONTACT_EMAIL;
};
type RemovedContact = {
  state: "removed";
  displayName: typeof CONTACT_DISPLAY_NAME;
};
export type ContactProofResult = ConfiguredContact | RemovedContact;
export interface ContactProofOperation {
  create(): Promise<ConfiguredContact>;
  remove(): Promise<RemovedContact>;
}
export class ContactProofConflictError extends Error {}
export class DelegatedGraphContactProof implements ContactProofOperation {
  constructor(
    private readonly tokenProvider: DelegatedGraphTokenProvider,
    private readonly cory: SimulatedUserIdentity,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {
    if (cory.userPrincipalName !== CORY_USER_PRINCIPAL_NAME) {
      throw new TypeError("The contact owner must be Cory West.");
    }
  }
  async create(): Promise<ConfiguredContact> {
    const token = await this.coryToken();
    if (await this.findExact(token.token)) {
      return configuredResult();
    }
    const response = await this.request(CONTACTS_URL, {
      method: "POST",
      redirect: "error",
      headers: graphHeaders(token.token, true),
      body: JSON.stringify({
        displayName: CONTACT_DISPLAY_NAME,
        givenName: "AP2",
        surname: "Kobe Contact Proof",
        emailAddresses: [{ address: CONTACT_EMAIL }],
        singleValueExtendedProperties: [
          { id: CONTACT_RUN_PROPERTY_ID, value: CONTACT_RUN_ID },
        ],
      }),
    });
    if (response.status !== 201 || !hasFixedIdentity(await readJson(response))) {
      throw new Error(
        `Microsoft Graph contact creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    return configuredResult();
  }
  async remove(): Promise<RemovedContact> {
    const token = await this.coryToken();
    const contact = await this.findExact(token.token);
    if (!contact) {
      return removedResult();
    }
    const response = await this.request(
      `${CONTACTS_URL}/${encodeURIComponent(contact.id)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: graphHeaders(token.token),
      },
    );
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph contact removal returned HTTP ${response.status}.`,
      );
    }
    return removedResult();
  }
  private async coryToken(): Promise<DelegatedGraphToken> {
    const token = await this.tokenProvider.getToken(
      GRAPH_CONTACTS_READ_WRITE_SCOPE,
    );
    if (
      !token?.token ||
      token.identity.tenantId !== this.cory.tenantId ||
      token.identity.objectId !== this.cory.objectId ||
      token.identity.userPrincipalName.toLowerCase() !==
        CORY_USER_PRINCIPAL_NAME
    ) {
      throw new Error("Delegated Graph token is not for Cory West.");
    }
    return token;
  }
  private async findExact(accessToken: string): Promise<{ id: string } | undefined> {
    const url = new URL(CONTACTS_URL);
    url.searchParams.set(
      "$filter",
      `singleValueExtendedProperties/Any(ep: ep/id eq '${CONTACT_RUN_PROPERTY_ID}' and ep/value eq '${CONTACT_RUN_ID}')`,
    );
    url.searchParams.set("$top", "2");
    url.searchParams.set("$select", CONTACT_SELECT);
    url.searchParams.set(
      "$expand",
      `singleValueExtendedProperties($filter=id eq '${CONTACT_RUN_PROPERTY_ID}')`,
    );
    const response = await this.request(url, {
      method: "GET",
      redirect: "error",
      headers: graphHeaders(accessToken),
    });
    const body = await readJson(response);
    if (
      response.status !== 200 ||
      !isRecord(body) ||
      "@odata.nextLink" in body ||
      !Array.isArray(body.value)
    ) {
      throw new ContactProofConflictError();
    }
    if (body.value.length === 0) {
      return undefined;
    }
    if (body.value.length !== 1 || !isExactStoredContact(body.value[0])) {
      throw new ContactProofConflictError();
    }
    return { id: body.value[0].id };
  }
}
function graphHeaders(token: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
function hasFixedIdentity(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.displayName === CONTACT_DISPLAY_NAME &&
    value.givenName === "AP2" &&
    value.surname === "Kobe Contact Proof" &&
    Array.isArray(value.emailAddresses) &&
    value.emailAddresses.length === 1 &&
    isRecord(value.emailAddresses[0]) &&
    value.emailAddresses[0].address === CONTACT_EMAIL
  );
}
function isExactStoredContact(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  if (!hasFixedIdentity(value) || !EMPTY_CONTACT_FIELDS.every(
    (field) => isEmptyContactValue(value[field]),
  )) {
    return false;
  }
  const properties = value.singleValueExtendedProperties;
  return (
    Array.isArray(properties) &&
    properties.length === 1 &&
    isRecord(properties[0]) &&
    properties[0].id === CONTACT_RUN_PROPERTY_ID &&
    properties[0].value === CONTACT_RUN_ID
  );
}
function isEmptyContactValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.values(value).every(
      (part) => part === null || part === "",
    ))
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function configuredResult(): ConfiguredContact {
  return { state: "configured", displayName: CONTACT_DISPLAY_NAME, email: CONTACT_EMAIL };
}
function removedResult(): RemovedContact {
  return { state: "removed", displayName: CONTACT_DISPLAY_NAME };
}
