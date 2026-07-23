import {
  HOMER_IDENTITY,
  MARGE_DISPLAY_NAME,
  MARGE_USER_PRINCIPAL_NAME,
  type DelegatedGraphToken,
  type DelegatedGraphTokenProvider,
  type SimulatedUserIdentity,
} from "./simulated-user.js";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_ROOT = `${GRAPH_ORIGIN}/v1.0`;

export const ONEDRIVE_PROOF_FILE_NAME = "AP2-OneDrive-share-proof.txt";
export const ONEDRIVE_PROOF_PATH = `/${ONEDRIVE_PROOF_FILE_NAME}`;
export const ONEDRIVE_PROOF_CONTENT =
  "Homer shared this harmless AP2 rehearsal file with Marge.\n";
export const GRAPH_FILES_READ_WRITE_SCOPE =
  `${GRAPH_ORIGIN}/Files.ReadWrite`;
export const GRAPH_FILES_READ_SCOPE = `${GRAPH_ORIGIN}/Files.Read`;

const PROOF_SIZE = Buffer.byteLength(ONEDRIVE_PROOF_CONTENT);
const PROOF_PATH_METADATA_URL =
  `${GRAPH_ROOT}/me/drive/root:/${ONEDRIVE_PROOF_FILE_NAME}` +
  "?$select=id,name,size,file,eTag,parentReference";
const ROOT_METADATA_URL = `${GRAPH_ROOT}/me/drive/root?$select=id`;

export type OneDriveProofResult =
  | {
      state: "shared";
      path: typeof ONEDRIVE_PROOF_PATH;
      owner: typeof HOMER_IDENTITY.userPrincipalName;
      recipient: typeof MARGE_USER_PRINCIPAL_NAME;
      access: "read";
    }
  | {
      state: "verified";
      path: typeof ONEDRIVE_PROOF_PATH;
      verifiedAs: typeof MARGE_USER_PRINCIPAL_NAME;
      contentMatches: true;
    }
  | {
      state: "removed";
      path: typeof ONEDRIVE_PROOF_PATH;
    };

export interface OneDriveShareProofOperation {
  share(): Promise<Extract<OneDriveProofResult, { state: "shared" }>>;
  verify(): Promise<Extract<OneDriveProofResult, { state: "verified" }>>;
  remove(): Promise<Extract<OneDriveProofResult, { state: "removed" }>>;
}

export class OneDriveProofConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OneDriveProofConflictError";
  }
}

interface DriveItem {
  id: string;
  name: typeof ONEDRIVE_PROOF_FILE_NAME;
  size: typeof PROOF_SIZE;
  eTag: string;
  driveId: string;
}

export class DelegatedGraphOneDriveShareProof
  implements OneDriveShareProofOperation
{
  readonly #homerTokens: DelegatedGraphTokenProvider;
  readonly #margeTokens: DelegatedGraphTokenProvider;
  readonly #margeIdentity: SimulatedUserIdentity;
  readonly #request: typeof fetch;

  constructor(
    homerTokens: DelegatedGraphTokenProvider,
    margeTokens: DelegatedGraphTokenProvider,
    margeIdentity: SimulatedUserIdentity,
    request: typeof fetch = fetch,
  ) {
    if (
      margeIdentity.userPrincipalName !== MARGE_USER_PRINCIPAL_NAME ||
      margeIdentity.displayName !== MARGE_DISPLAY_NAME
    ) {
      throw new TypeError("The Marge identity configuration is invalid.");
    }
    this.#homerTokens = homerTokens;
    this.#margeTokens = margeTokens;
    this.#margeIdentity = margeIdentity;
    this.#request = request.bind(globalThis);
  }

  async share(): Promise<Extract<OneDriveProofResult, { state: "shared" }>> {
    const homer = await this.#homerToken();
    await this.#requirePathAbsent(homer.token);
    const rootId = await this.#getRootId(homer.token);
    const uploadUrl = await this.#createUploadSession(homer.token, rootId);
    const item = await this.#uploadProof(uploadUrl);
    await this.#grantMargeReadAccess(homer.token, item.id);
    return {
      state: "shared",
      path: ONEDRIVE_PROOF_PATH,
      owner: HOMER_IDENTITY.userPrincipalName,
      recipient: MARGE_USER_PRINCIPAL_NAME,
      access: "read",
    };
  }

  async verify(): Promise<
    Extract<OneDriveProofResult, { state: "verified" }>
  > {
    const homer = await this.#homerToken();
    const item = await this.#resolveProof(homer.token);
    const marge = await this.#margeToken();
    const directUrl =
      `${GRAPH_ROOT}/drives/${encodeURIComponent(item.driveId)}` +
      `/items/${encodeURIComponent(item.id)}`;
    const metadataResponse = await this.#request(
      `${directUrl}?$select=id,name,size,file,eTag,parentReference`,
      graphGet(marge.token),
    );
    if (!metadataResponse.ok) {
      throw new Error(
        `Microsoft Graph could not verify Marge access (HTTP ${metadataResponse.status}).`,
      );
    }
    const directItem = parseProofItem(await readJson(metadataResponse));
    if (directItem.id !== item.id || directItem.driveId !== item.driveId) {
      throw new Error("Microsoft Graph returned an unexpected shared file.");
    }
    await this.#requireExactContent(`${directUrl}/content`, marge.token);
    return {
      state: "verified",
      path: ONEDRIVE_PROOF_PATH,
      verifiedAs: MARGE_USER_PRINCIPAL_NAME,
      contentMatches: true,
    };
  }

  async remove(): Promise<
    Extract<OneDriveProofResult, { state: "removed" }>
  > {
    const homer = await this.#homerToken();
    const item = await this.#resolveProof(homer.token);
    await this.#requireExactContent(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(item.id)}/content`,
      homer.token,
    );
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${homer.token}`,
          "If-Match": item.eTag,
        },
      },
    );
    if (response.status === 412) {
      throw new OneDriveProofConflictError(
        "The OneDrive proof changed before cleanup.",
      );
    }
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph cleanup returned HTTP ${response.status}.`,
      );
    }
    return { state: "removed", path: ONEDRIVE_PROOF_PATH };
  }

  async #homerToken(): Promise<DelegatedGraphToken> {
    const token = await this.#homerTokens.getToken(
      GRAPH_FILES_READ_WRITE_SCOPE,
    );
    requireIdentity(token, HOMER_IDENTITY);
    return token;
  }

  async #margeToken(): Promise<DelegatedGraphToken> {
    const token = await this.#margeTokens.getToken(GRAPH_FILES_READ_SCOPE);
    requireIdentity(token, this.#margeIdentity);
    return token;
  }

  async #requirePathAbsent(accessToken: string): Promise<void> {
    const response = await this.#request(
      PROOF_PATH_METADATA_URL,
      graphGet(accessToken),
    );
    if (response.status === 404) {
      return;
    }
    if (response.ok) {
      throw new OneDriveProofConflictError(
        "The fixed OneDrive proof path already exists.",
      );
    }
    throw new Error(
      `Microsoft Graph path check returned HTTP ${response.status}.`,
    );
  }

  async #getRootId(accessToken: string): Promise<string> {
    const response = await this.#request(
      ROOT_METADATA_URL,
      graphGet(accessToken),
    );
    const value = await readJson(response);
    if (!response.ok || !isRecord(value) || !nonEmpty(value.id)) {
      throw new Error("Microsoft Graph returned an invalid OneDrive root.");
    }
    return value.id;
  }

  async #createUploadSession(
    accessToken: string,
    rootId: string,
  ): Promise<string> {
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(rootId)}` +
        `:/${ONEDRIVE_PROOF_FILE_NAME}:/createUploadSession`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          item: {
            "@microsoft.graph.conflictBehavior": "fail",
            name: ONEDRIVE_PROOF_FILE_NAME,
          },
        }),
      },
    );
    if (response.status === 409) {
      throw new OneDriveProofConflictError(
        "The fixed OneDrive proof path already exists.",
      );
    }
    const value = await readJson(response);
    if (
      !response.ok ||
      !isRecord(value) ||
      !nonEmpty(value.uploadUrl) ||
      !isSafeUploadUrl(value.uploadUrl)
    ) {
      throw new Error(
        `Microsoft Graph upload session returned HTTP ${response.status}.`,
      );
    }
    return value.uploadUrl;
  }

  async #uploadProof(uploadUrl: string): Promise<DriveItem> {
    const response = await this.#request(uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: {
        "Content-Length": String(PROOF_SIZE),
        "Content-Range": `bytes 0-${PROOF_SIZE - 1}/${PROOF_SIZE}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: ONEDRIVE_PROOF_CONTENT,
    });
    if (response.status === 409) {
      throw new OneDriveProofConflictError(
        "The fixed OneDrive proof path already exists.",
      );
    }
    const value = await readJson(response);
    if (response.status !== 201) {
      throw new Error(
        `Microsoft Graph upload returned HTTP ${response.status}.`,
      );
    }
    return parseProofItem(value);
  }

  async #grantMargeReadAccess(
    accessToken: string,
    itemId: string,
  ): Promise<void> {
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(itemId)}/invite`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipients: [{ email: MARGE_USER_PRINCIPAL_NAME }],
          requireSignIn: true,
          sendInvitation: false,
          roles: ["read"],
        }),
      },
    );
    const value = await readJson(response);
    if (response.status !== 200 || !isExactMargeReadPermission(value)) {
      throw new Error(
        `Microsoft Graph sharing returned HTTP ${response.status}.`,
      );
    }
  }

  async #resolveProof(accessToken: string): Promise<DriveItem> {
    const response = await this.#request(
      PROOF_PATH_METADATA_URL,
      graphGet(accessToken),
    );
    if (response.status === 404) {
      throw new OneDriveProofConflictError(
        "The fixed OneDrive proof file does not exist.",
      );
    }
    if (!response.ok) {
      throw new Error(
        `Microsoft Graph proof lookup returned HTTP ${response.status}.`,
      );
    }
    return parseProofItem(await readJson(response));
  }

  async #requireExactContent(
    contentUrl: string,
    accessToken: string,
  ): Promise<void> {
    let response = await this.#request(contentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 302) {
      const location = response.headers.get("location");
      if (!location || !isSafeUploadUrl(location)) {
        throw new Error("Microsoft Graph returned an invalid download URL.");
      }
      response = await this.#request(location, {
        method: "GET",
        redirect: "error",
      });
    }
    if (!response.ok) {
      throw new Error(
        `Microsoft Graph content verification returned HTTP ${response.status}.`,
      );
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.equals(Buffer.from(ONEDRIVE_PROOF_CONTENT))) {
      throw new OneDriveProofConflictError(
        "The fixed OneDrive proof content does not match.",
      );
    }
  }
}

function graphGet(accessToken: string): RequestInit {
  return {
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Bearer ${accessToken}` },
  };
}

function requireIdentity(
  token: DelegatedGraphToken | null,
  expected: SimulatedUserIdentity,
): asserts token is DelegatedGraphToken {
  if (
    !token?.token ||
    token.identity.tenantId !== expected.tenantId ||
    token.identity.objectId !== expected.objectId ||
    token.identity.userPrincipalName.toLowerCase() !==
      expected.userPrincipalName.toLowerCase()
  ) {
    throw new Error("The delegated Graph token has an unexpected identity.");
  }
}

function parseProofItem(value: unknown): DriveItem {
  if (
    !isRecord(value) ||
    !nonEmpty(value.id) ||
    value.name !== ONEDRIVE_PROOF_FILE_NAME ||
    value.size !== PROOF_SIZE ||
    !isRecord(value.file) ||
    !nonEmpty(value.eTag) ||
    !isRecord(value.parentReference) ||
    !nonEmpty(value.parentReference.driveId)
  ) {
    throw new Error("Microsoft Graph returned an invalid OneDrive proof file.");
  }
  return {
    id: value.id,
    name: ONEDRIVE_PROOF_FILE_NAME,
    size: PROOF_SIZE,
    eTag: value.eTag,
    driveId: value.parentReference.driveId,
  };
}

function isExactMargeReadPermission(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.value) || value.value.length !== 1) {
    return false;
  }
  const permission = value.value[0];
  return (
    isRecord(permission) &&
    Array.isArray(permission.roles) &&
    permission.roles.length === 1 &&
    permission.roles[0] === "read" &&
    permission.link === undefined &&
    isRecord(permission.invitation) &&
    typeof permission.invitation.email === "string" &&
    permission.invitation.email.toLowerCase() ===
      MARGE_USER_PRINCIPAL_NAME.toLowerCase() &&
    permission.invitation.signInRequired === true
  );
}

function isSafeUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
