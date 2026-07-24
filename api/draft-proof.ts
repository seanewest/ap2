import {
  CORY_USER_PRINCIPAL_NAME, type DelegatedGraphToken,
  type DelegatedGraphTokenProvider, type SimulatedUserIdentity,
} from "./simulated-user.js";

const MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/messages";
const DRAFTS_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/drafts/messages";
const MESSAGE_SELECT = [
  "id", "isDraft", "subject", "bodyPreview", "importance", "hasAttachments",
  "toRecipients", "ccRecipients", "bccRecipients", "from", "sender",
].join(",");

export const GRAPH_MAIL_READ_WRITE_SCOPE =
  "https://graph.microsoft.com/Mail.ReadWrite";
export const DRAFT_RUN_ID = "ap2-draft-20260725-001";
export const DRAFT_RUN_PROPERTY_ID =
  "String {c352ae90-352e-4c3f-8f7c-ab63d2ca32cc} Name AP2RunId";
export const DRAFT_SUBJECT =
  "AP2 Pass 3 harmless draft — ap2-draft-20260725-001";
export const DRAFT_BODY = "Harmless AP2 draft. This message must not be sent.";
export const DRAFT_RECIPIENTS = ["kobe@corywest.onmicrosoft.com",
  "marge.simpson@corywest.onmicrosoft.com"] as const;

export type DraftProofResult =
  { state: "configured" | "removed"; subject: typeof DRAFT_SUBJECT };
export interface DraftProofOperation {
  create(): Promise<DraftProofResult>; remove(): Promise<DraftProofResult>;
}
export class DraftProofConflictError extends Error {}

export class DelegatedGraphDraftProof implements DraftProofOperation {
  private retainedId?: string;

  constructor(
    private readonly tokenProvider: DelegatedGraphTokenProvider,
    private readonly cory: SimulatedUserIdentity,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {
    if (cory.userPrincipalName !== CORY_USER_PRINCIPAL_NAME) {
      throw new TypeError("The draft owner must be Cory West.");
    }
  }

  async create(): Promise<DraftProofResult> {
    const token = await this.coryToken();
    const existing = await this.findExact(token.token);
    if (existing) {
      this.retainedId = existing.id;
      return result("configured");
    }
    const response = await this.request(MESSAGES_URL, {
      method: "POST",
      redirect: "error",
      headers: graphHeaders(token.token, true),
      body: JSON.stringify(fixedDraftRequest()),
    });
    const created = await readJson(response);
    if (response.status !== 201 || !isExactDraft(created, false)) {
      throw new Error(
        `Microsoft Graph draft creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    this.retainedId = created.id;
    return result("configured");
  }

  async remove(): Promise<DraftProofResult> {
    const token = await this.coryToken();
    const existing = await this.findExact(token.token);
    if (!existing) {
      this.retainedId = undefined;
      return result("removed");
    }
    if (this.retainedId && this.retainedId !== existing.id) {
      throw new DraftProofConflictError();
    }
    const response = await this.request(
      `${MESSAGES_URL}/${encodeURIComponent(existing.id)}`,
      { method: "DELETE", redirect: "error", headers: graphHeaders(token.token) },
    );
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph draft removal returned HTTP ${response.status}.`,
      );
    }
    this.retainedId = undefined;
    return result("removed");
  }

  private async coryToken(): Promise<DelegatedGraphToken> {
    const token = await this.tokenProvider.getToken(
      GRAPH_MAIL_READ_WRITE_SCOPE,
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
    const url = new URL(DRAFTS_URL);
    url.searchParams.set(
      "$filter",
      `singleValueExtendedProperties/Any(ep: ep/id eq '${DRAFT_RUN_PROPERTY_ID}' and ep/value eq '${DRAFT_RUN_ID}')`,
    );
    url.searchParams.set("$top", "2");
    url.searchParams.set("$select", MESSAGE_SELECT);
    url.searchParams.set(
      "$expand",
      `singleValueExtendedProperties($filter=id eq '${DRAFT_RUN_PROPERTY_ID}')`,
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
      throw new DraftProofConflictError();
    }
    if (body.value.length === 0) return undefined;
    if (body.value.length !== 1 || !isExactDraft(body.value[0], true)) {
      throw new DraftProofConflictError();
    }
    return { id: body.value[0].id };
  }
}

function fixedDraftRequest(): Record<string, unknown> {
  return {
    subject: DRAFT_SUBJECT,
    body: { contentType: "Text", content: DRAFT_BODY },
    toRecipients: DRAFT_RECIPIENTS.map((address) => ({
      emailAddress: { address },
    })),
    ccRecipients: [],
    bccRecipients: [],
    importance: "low",
    singleValueExtendedProperties: [
      { id: DRAFT_RUN_PROPERTY_ID, value: DRAFT_RUN_ID },
    ],
  };
}

function isExactDraft(
  value: unknown,
  requireMarker: boolean,
): value is Record<string, unknown> & { id: string } {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.isDraft !== true ||
    value.subject !== DRAFT_SUBJECT ||
    value.bodyPreview !== DRAFT_BODY ||
    value.importance !== "low" ||
    value.hasAttachments !== false ||
    !exactRecipients(value.toRecipients, DRAFT_RECIPIENTS) ||
    !exactRecipients(value.ccRecipients, []) ||
    !exactRecipients(value.bccRecipients, []) ||
    !optionalCoryRecipient(value.from) ||
    !optionalCoryRecipient(value.sender)
  ) {
    return false;
  }
  const marker = value.singleValueExtendedProperties;
  return marker === undefined
    ? !requireMarker
    : Array.isArray(marker) &&
      marker.length === 1 &&
      isRecord(marker[0]) &&
      marker[0].id === DRAFT_RUN_PROPERTY_ID &&
      marker[0].value === DRAFT_RUN_ID;
}

function exactRecipients(
  value: unknown,
  expected: readonly string[],
): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const actual = value.map((recipient) =>
    isRecord(recipient) &&
      isRecord(recipient.emailAddress) &&
      typeof recipient.emailAddress.address === "string"
      ? recipient.emailAddress.address.toLowerCase()
      : undefined
  );
  return !actual.includes(undefined) &&
    [...actual].sort().join("\n") === [...expected].sort().join("\n");
}

function optionalCoryRecipient(value: unknown): boolean {
  return value === undefined ||
    (isRecord(value) &&
      isRecord(value.emailAddress) &&
      typeof value.emailAddress.address === "string" &&
      value.emailAddress.address.toLowerCase() === CORY_USER_PRINCIPAL_NAME);
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function result(state: DraftProofResult["state"]): DraftProofResult {
  return { state, subject: DRAFT_SUBJECT };
}
