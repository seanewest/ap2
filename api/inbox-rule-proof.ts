import {
  CORY_USER_PRINCIPAL_NAME,
  type DelegatedGraphToken,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";
const RULES_URL =
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules";
const MAX_RULES = 256;
const MAX_SEQUENCE = 2_147_483_646;
export const GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE =
  "https://graph.microsoft.com/MailboxSettings.ReadWrite";
export const INBOX_RULE_RUN_ID = "ap2-rule-20260725-001";
export const INBOX_RULE_DISPLAY_NAME =
  "AP2 harmless disabled rule — ap2-rule-20260725-001";
export const INBOX_RULE_SUBJECT =
  "AP2-NEVER-MATCH-ap2-rule-20260725-001";
export type InboxRuleProofResult =
  | {
      state: "configured";
      displayName: typeof INBOX_RULE_DISPLAY_NAME;
    }
  | { state: "removed"; displayName: typeof INBOX_RULE_DISPLAY_NAME };
export interface InboxRuleProofOperation {
  create(): Promise<
    Extract<InboxRuleProofResult, { state: "configured" }>
  >;
  remove(): Promise<Extract<InboxRuleProofResult, { state: "removed" }>>;
}
export class InboxRuleProofConflictError extends Error {}
export class DelegatedGraphInboxRuleProof
  implements InboxRuleProofOperation
{
  constructor(
    private readonly tokenProvider: DelegatedGraphTokenProvider,
    private readonly cory: SimulatedUserIdentity,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {
    if (cory.userPrincipalName !== CORY_USER_PRINCIPAL_NAME) {
      throw new TypeError("The inbox-rule owner must be Cory West.");
    }
  }
  async create(): Promise<
    Extract<InboxRuleProofResult, { state: "configured" }>
  > {
    const token = await this.coryToken();
    const listed = await this.listRules(token.token);
    if (listed.exact) {
      return configuredResult;
    }
    const response = await this.request(RULES_URL, {
      method: "POST",
      redirect: "error",
      headers: graphHeaders(token.token, true),
      body: JSON.stringify(fixedRuleRequest(listed.nextSequence)),
    });
    const body = await readJson(response);
    if (response.status !== 201 || !isExactRule(body)) {
      throw new Error(
        `Microsoft Graph inbox-rule creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    return configuredResult;
  }
  async remove(): Promise<
    Extract<InboxRuleProofResult, { state: "removed" }>
  > {
    const token = await this.coryToken();
    const listed = await this.listRules(token.token);
    if (!listed.exact) {
      return removedResult;
    }
    const response = await this.request(
      `${RULES_URL}/${encodeURIComponent(listed.exact.id)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: graphHeaders(token.token),
      },
    );
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph inbox-rule removal returned HTTP ${response.status}.`,
      );
    }
    return removedResult;
  }
  private async coryToken(): Promise<DelegatedGraphToken> {
    const token = await this.tokenProvider.getToken(
      GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
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
  private async listRules(accessToken: string): Promise<{
    exact?: { id: string };
    nextSequence: number;
  }> {
    const url = new URL(RULES_URL);
    url.searchParams.set("$top", String(MAX_RULES + 1));
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
      !Array.isArray(body.value) ||
      body.value.length > MAX_RULES
    ) {
      throw new InboxRuleProofConflictError();
    }
    const exact = body.value.filter(
      (rule) => isRecord(rule) && rule.displayName === INBOX_RULE_DISPLAY_NAME,
    );
    if (exact.length > 1) {
      throw new InboxRuleProofConflictError();
    }
    if (exact.length === 1) {
      if (!isExactRule(exact[0])) {
        throw new InboxRuleProofConflictError();
      }
      return { exact: { id: exact[0].id }, nextSequence: 1 };
    }
    const sequences = body.value.map((rule) => {
      if (
        !isRecord(rule) ||
        !Number.isSafeInteger(rule.sequence) ||
        Number(rule.sequence) < 0 ||
        Number(rule.sequence) > MAX_SEQUENCE
      ) {
        throw new InboxRuleProofConflictError();
      }
      return Number(rule.sequence);
    });
    return { nextSequence: Math.max(0, ...sequences) + 1 };
  }
}
function fixedRuleRequest(sequence: number): Record<string, unknown> {
  return {
    displayName: INBOX_RULE_DISPLAY_NAME,
    sequence,
    isEnabled: false,
    conditions: { subjectContains: [INBOX_RULE_SUBJECT] },
    actions: {
      markAsRead: true,
      stopProcessingRules: false,
    },
  };
}
function isExactRule(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.displayName !== INBOX_RULE_DISPLAY_NAME ||
    value.isEnabled !== false ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    value.isReadOnly === true ||
    value.hasError === true ||
    !isRecord(value.conditions) ||
    !isRecord(value.actions) ||
    !isInertRecord(value.exceptions)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.conditions.subjectContains) ||
    value.conditions.subjectContains.length !== 1 ||
    value.conditions.subjectContains[0] !== INBOX_RULE_SUBJECT ||
    !onlyInertExcept(value.conditions, ["subjectContains"])
  ) {
    return false;
  }
  return (
    value.actions.markAsRead === true &&
    (value.actions.stopProcessingRules === false ||
      value.actions.stopProcessingRules === undefined) &&
    onlyInertExcept(value.actions, ["markAsRead", "stopProcessingRules"])
  );
}
function onlyInertExcept(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.entries(value).every(
    ([key, field]) => allowed.includes(key) || isInert(field),
  );
}
function isInertRecord(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    (isRecord(value) && Object.values(value).every(isInert));
}
function isInert(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === false ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.values(value).every(isInert))
  );
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
const configuredResult = {
  state: "configured",
  displayName: INBOX_RULE_DISPLAY_NAME,
} as const;
const removedResult = {
  state: "removed",
  displayName: INBOX_RULE_DISPLAY_NAME,
} as const;
