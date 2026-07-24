export const GRAPH_APPLICATION_SCOPE = "https://graph.microsoft.com/.default";
export const SHAREPOINT_DRIVE_ID =
  "b!cwlHh29-hku7ujsOQjtYrJgMdCJB4uxPjCIGTA7Dne3i9BWF2f9zS6QFr8wTSu0Z";
export const SHAREPOINT_FILE_RUN_ID = "ap2-sharepoint-file-20260725-001";
export const SHAREPOINT_FILE_NAME =
  "AP2 SharePoint File Proof [ap2-sharepoint-file-20260725-001].txt";
export const SHAREPOINT_FILE_CONTENT =
  "Harmless AP2 SharePoint file proof.\nAP2RunId=ap2-sharepoint-file-20260725-001\n";
export const SHAREPOINT_FILE_SIZE = 78;

const DRIVE_URL =
  `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(SHAREPOINT_DRIVE_ID)}`;
const PATH_URL = `${DRIVE_URL}/root:/${encodeURIComponent(SHAREPOINT_FILE_NAME)}`;
const CONTENT_URL =
  `${PATH_URL}:/content?@microsoft.graph.conflictBehavior=fail`;

export type SharePointFileProofResult = {
  state: "configured" | "removed";
  name: typeof SHAREPOINT_FILE_NAME;
};
export interface SharePointFileProofOperation {
  create(): Promise<SharePointFileProofResult>;
  remove(): Promise<SharePointFileProofResult>;
}
export interface GraphApplicationTokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}
export class SharePointFileProofConflictError extends Error {}

type ExactItem = { id: string; eTag: string };

export class GraphSharePointFileProof implements SharePointFileProofOperation {
  private retained?: ExactItem;

  constructor(
    private readonly credential: GraphApplicationTokenCredential,
    private readonly request: typeof fetch = fetch.bind(globalThis),
  ) {
    if (new TextEncoder().encode(SHAREPOINT_FILE_CONTENT).byteLength !==
      SHAREPOINT_FILE_SIZE) {
      throw new TypeError("The fixed SharePoint proof content is not 78 bytes.");
    }
  }

  async create(): Promise<SharePointFileProofResult> {
    const token = await this.token();
    const lookup = await this.pathLookup(token);
    if (lookup.status !== 404) {
      throw new SharePointFileProofConflictError();
    }
    const response = await this.request(CONTENT_URL, {
      method: "PUT",
      redirect: "error",
      headers: graphHeaders(token, { "Content-Type": "text/plain" }),
      body: SHAREPOINT_FILE_CONTENT,
    });
    const item = await readJson(response);
    if (response.status !== 201 || !isExactCreatedItem(item)) {
      throw new Error(
        `Microsoft Graph SharePoint file creation returned an unconfirmed HTTP ${response.status} result.`,
      );
    }
    this.retained = { id: item.id, eTag: item.eTag };
    return result("configured");
  }

  async remove(): Promise<SharePointFileProofResult> {
    const token = await this.token();
    const lookup = await this.pathLookup(token);
    if (lookup.status === 404) {
      this.retained = undefined;
      return result("removed");
    }
    const body = await readJson(lookup);
    if (lookup.status !== 200 || !isExactMarkedItem(body)) {
      throw new SharePointFileProofConflictError();
    }
    if (this.retained && this.retained.id !== body.id) {
      throw new SharePointFileProofConflictError();
    }
    const response = await this.request(
      `${DRIVE_URL}/items/${encodeURIComponent(body.id)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: graphHeaders(token, { "If-Match": body.eTag }),
      },
    );
    if (response.status === 404 || response.status === 412) {
      throw new SharePointFileProofConflictError();
    }
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph SharePoint file removal returned HTTP ${response.status}.`,
      );
    }
    this.retained = undefined;
    return result("removed");
  }

  private async pathLookup(token: string): Promise<Response> {
    return this.request(PATH_URL, {
      method: "GET",
      redirect: "error",
      headers: graphHeaders(token),
    });
  }

  private async token(): Promise<string> {
    const access = await this.credential.getToken(GRAPH_APPLICATION_SCOPE);
    if (!access?.token) {
      throw new Error("The API managed identity could not acquire a Graph token.");
    }
    return access.token;
  }
}

function isExactCreatedItem(value: unknown): value is ExactItem {
  return isExactMarkedItem(value) &&
    value.size === SHAREPOINT_FILE_SIZE;
}

function isExactMarkedItem(
  value: unknown,
): value is Record<string, unknown> & ExactItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.eTag === "string" &&
    value.eTag.length > 0 &&
    value.name === SHAREPOINT_FILE_NAME &&
    isRecord(value.file) &&
    isRecord(value.parentReference) &&
    value.parentReference.driveId === SHAREPOINT_DRIVE_ID
  );
}

function graphHeaders(
  token: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
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
function result(
  state: SharePointFileProofResult["state"],
): SharePointFileProofResult {
  return { state, name: SHAREPOINT_FILE_NAME };
}
