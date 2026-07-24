import { GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE } from "./inbox-rule-proof.js";
import {
  CORY_USER_PRINCIPAL_NAME,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";

const CATEGORIES_URL =
  "https://graph.microsoft.com/v1.0/me/outlook/masterCategories";
const MAX_CATEGORIES = 256;
export { GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE };
export const CATEGORY_RUN_ID = "ap2-category-20260725-001";
export const CATEGORY_DISPLAY_NAME =
  "AP2 Category Proof [ap2-category-20260725-001]";
export const CATEGORY_COLOR = "preset7";
export type CategoryProofResult = {
  state: "configured" | "removed";
  displayName: typeof CATEGORY_DISPLAY_NAME;
};
export interface CategoryProofOperation {
  create(): Promise<CategoryProofResult>;
  remove(): Promise<CategoryProofResult>;
}
export class CategoryProofConflictError extends Error {}

export class DelegatedGraphCategoryProof implements CategoryProofOperation {
  private retainedId?: string;

  constructor(
    private readonly tokens: DelegatedGraphTokenProvider,
    private readonly cory: SimulatedUserIdentity,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {
    if (cory.userPrincipalName !== CORY_USER_PRINCIPAL_NAME) {
      throw new TypeError("The category owner must be Cory West.");
    }
  }

  async create(): Promise<CategoryProofResult> {
    const token = await this.coryToken();
    const exact = await this.listExact(token);
    if (exact) {
      this.retainedId = exact.id;
      return result("configured");
    }
    const response = await this.request(CATEGORIES_URL, {
      method: "POST",
      redirect: "error",
      headers: graphHeaders(token, true),
      body: JSON.stringify({
        displayName: CATEGORY_DISPLAY_NAME,
        color: CATEGORY_COLOR,
      }),
    });
    const created = await readJson(response);
    if (response.status !== 201 || !isExactCategory(created)) {
      throw new Error(
        `Microsoft Graph category creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    this.retainedId = created.id;
    return result("configured");
  }

  async remove(): Promise<CategoryProofResult> {
    const token = await this.coryToken();
    const exact = await this.listExact(token);
    if (this.retainedId && exact && this.retainedId !== exact.id) {
      throw new CategoryProofConflictError();
    }
    const id = this.retainedId ?? exact?.id;
    if (!id) {
      return result("removed");
    }
    const response = await this.request(
      `${CATEGORIES_URL}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: graphHeaders(token),
      },
    );
    if (response.status !== 204) {
      throw new Error(`Microsoft Graph category removal returned HTTP ${response.status}.`);
    }
    this.retainedId = undefined;
    return result("removed");
  }

  private async coryToken(): Promise<string> {
    const delegated = await this.tokens.getToken(
      GRAPH_MAILBOX_SETTINGS_READ_WRITE_SCOPE,
    );
    if (
      !delegated?.token ||
      delegated.identity.tenantId !== this.cory.tenantId ||
      delegated.identity.objectId !== this.cory.objectId ||
      delegated.identity.userPrincipalName.toLowerCase() !==
        CORY_USER_PRINCIPAL_NAME
    ) {
      throw new Error("Delegated Graph token is not for Cory West.");
    }
    return delegated.token;
  }

  private async listExact(token: string): Promise<{ id: string } | undefined> {
    const url = new URL(CATEGORIES_URL);
    url.searchParams.set("$top", String(MAX_CATEGORIES + 1));
    const response = await this.request(url, {
      method: "GET",
      redirect: "error",
      headers: graphHeaders(token),
    });
    const body = await readJson(response);
    if (
      response.status !== 200 ||
      !isRecord(body) ||
      "@odata.nextLink" in body ||
      !Array.isArray(body.value) ||
      body.value.length > MAX_CATEGORIES ||
      !body.value.every(
        (category) =>
          isRecord(category) && typeof category.displayName === "string",
      )
    ) {
      throw new CategoryProofConflictError();
    }
    const matches = body.value.filter(
      (category) => category.displayName === CATEGORY_DISPLAY_NAME,
    );
    if (matches.length > 1) {
      throw new CategoryProofConflictError();
    }
    if (matches.length === 1 && !isExactCategory(matches[0])) {
      throw new CategoryProofConflictError();
    }
    return matches[0] as { id: string } | undefined;
  }
}

function isExactCategory(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.displayName === CATEGORY_DISPLAY_NAME &&
    value.color === CATEGORY_COLOR
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
function result(state: CategoryProofResult["state"]): CategoryProofResult {
  return { state, displayName: CATEGORY_DISPLAY_NAME };
}
