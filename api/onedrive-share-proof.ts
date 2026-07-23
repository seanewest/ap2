import { randomUUID } from "node:crypto";
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

export class OneDriveProofBusyError extends Error {
  constructor() {
    super("Another OneDrive proof operation is already running.");
    this.name = "OneDriveProofBusyError";
  }
}

export interface OneDriveInviteFailure {
  state: "file-created-sharing-failed";
  stage: "invite" | "invite-reconciliation";
  upstreamStatus: number;
  graphErrorCode?: string;
  requestId?: string;
  clientRequestId: string;
  responseDate?: string;
  retryAfter?: string;
  responseShape:
    | "graph-error"
    | "non-json"
    | "permission-response-mismatch"
    | "permission-reconciliation-error"
    | "permission-reconciliation-mismatch";
}

export class OneDriveInviteFailureError extends Error {
  readonly diagnostic: OneDriveInviteFailure;

  constructor(diagnostic: OneDriveInviteFailure) {
    super("Homer's proof file was created, but sharing it with Marge failed.");
    this.name = "OneDriveInviteFailureError";
    this.diagnostic = diagnostic;
  }
}

export class ProcessLocalOneDriveShareProofBoundary
  implements OneDriveShareProofOperation
{
  readonly #operation: OneDriveShareProofOperation;
  #busy = false;

  constructor(operation: OneDriveShareProofOperation) {
    this.#operation = operation;
  }

  share(): ReturnType<OneDriveShareProofOperation["share"]> {
    return this.#run(() => this.#operation.share());
  }

  verify(): ReturnType<OneDriveShareProofOperation["verify"]> {
    return this.#run(() => this.#operation.verify());
  }

  remove(): ReturnType<OneDriveShareProofOperation["remove"]> {
    return this.#run(() => this.#operation.remove());
  }

  async #run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#busy) {
      throw new OneDriveProofBusyError();
    }
    this.#busy = true;
    try {
      return await operation();
    } finally {
      this.#busy = false;
    }
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
  readonly #createClientRequestId: () => string;

  constructor(
    homerTokens: DelegatedGraphTokenProvider,
    margeTokens: DelegatedGraphTokenProvider,
    margeIdentity: SimulatedUserIdentity,
    request: typeof fetch = fetch,
    createClientRequestId: () => string = randomUUID,
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
    this.#createClientRequestId = createClientRequestId;
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
    const originalItem = await this.#resolveProof(homer.token);
    await this.#requireExactContent(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(originalItem.id)}/content`,
      homer.token,
    );
    const permissionId = await this.#findMargeReadPermission(
      homer.token,
      originalItem.id,
    );
    if (permissionId) {
      await this.#revokeMargeReadPermission(
        homer.token,
        originalItem,
        permissionId,
      );
    }
    const item = await this.#resolveProof(homer.token);
    if (
      item.id !== originalItem.id ||
      item.driveId !== originalItem.driveId
    ) {
      throw new OneDriveProofConflictError(
        "The fixed OneDrive proof changed during cleanup.",
      );
    }
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

  async #findMargeReadPermission(
    accessToken: string,
    itemId: string,
  ): Promise<string | undefined> {
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(itemId)}/permissions` +
        "?$select=id,roles,link,invitation,grantedToV2,inheritedFrom",
      graphGet(accessToken),
    );
    const value = await readJson(response);
    if (!response.ok) {
      throw new OneDriveProofConflictError(
        "Microsoft Graph returned ambiguous proof permissions.",
      );
    }
    const inspection = inspectMargeReadPermissions(
      value,
      this.#margeIdentity.objectId,
    );
    if (inspection.kind === "ambiguous") {
      throw new OneDriveProofConflictError(
        "The Marge proof permission is ambiguous.",
      );
    }
    return inspection.kind === "exact" ? inspection.id : undefined;
  }

  async #revokeMargeReadPermission(
    accessToken: string,
    item: DriveItem,
    permissionId: string,
  ): Promise<void> {
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(item.id)}` +
        `/permissions/${encodeURIComponent(permissionId)}`,
      {
        method: "DELETE",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "If-Match": item.eTag,
        },
      },
    );
    if (response.status === 412) {
      throw new OneDriveProofConflictError(
        "The OneDrive proof changed before permission cleanup.",
      );
    }
    if (response.status !== 204) {
      throw new Error(
        `Microsoft Graph permission cleanup returned HTTP ${response.status}.`,
      );
    }
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
    const clientRequestId = this.#createClientRequestId();
    if (!safeGuid(clientRequestId)) {
      throw new Error("The OneDrive client request ID generator is invalid.");
    }
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(itemId)}/invite`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "client-request-id": clientRequestId,
          "return-client-request-id": "true",
        },
        body: JSON.stringify({
          recipients: [{ objectId: this.#margeIdentity.objectId }],
          requireSignIn: true,
          sendInvitation: false,
          roles: ["read"],
        }),
      },
    );
    const value = await readJson(response);
    if (response.status !== 200) {
      throw new OneDriveInviteFailureError(
        inviteFailureDiagnostic(
          response,
          value,
          clientRequestId,
          "invite",
          graphResponseShape(value),
        ),
      );
    }
    if (
      inspectMargeReadPermissions(value, this.#margeIdentity.objectId).kind ===
      "exact"
    ) {
      return;
    }
    await this.#reconcileMargeReadAccess(
      accessToken,
      itemId,
      clientRequestId,
    );
  }

  async #reconcileMargeReadAccess(
    accessToken: string,
    itemId: string,
    clientRequestId: string,
  ): Promise<void> {
    const response = await this.#request(
      `${GRAPH_ROOT}/me/drive/items/${encodeURIComponent(itemId)}/permissions` +
        "?$select=id,roles,link,invitation,grantedToV2,inheritedFrom",
      graphGet(accessToken),
    );
    const value = await readJson(response);
    if (!response.ok) {
      throw new OneDriveInviteFailureError(
        inviteFailureDiagnostic(
          response,
          value,
          clientRequestId,
          "invite-reconciliation",
          "permission-reconciliation-error",
        ),
      );
    }
    const inspection = inspectMargeReadPermissions(
      value,
      this.#margeIdentity.objectId,
    );
    if (inspection.kind !== "exact") {
      throw new OneDriveInviteFailureError(
        inviteFailureDiagnostic(
          response,
          value,
          clientRequestId,
          "invite-reconciliation",
          "permission-reconciliation-mismatch",
        ),
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

function inviteFailureDiagnostic(
  response: Response,
  value: unknown,
  clientRequestId: string,
  stage: OneDriveInviteFailure["stage"],
  responseShape: OneDriveInviteFailure["responseShape"],
): OneDriveInviteFailure {
  const graphErrors = graphErrorChain(value);
  const graphErrorCode = graphErrors
    .map((error) => safeGraphErrorCode(error.code))
    .filter((code): code is string => code !== undefined)
    .at(-1);
  const requestId = safeGuid(response.headers.get("request-id")) ??
    graphErrors
      .map((error) => safeGuid(error["request-id"]))
      .filter((id): id is string => id !== undefined)
      .at(-1);
  const responseDate = safeHttpDate(response.headers.get("date"));
  const retryAfter = safeRetryAfter(response.headers.get("retry-after"));
  return {
    state: "file-created-sharing-failed",
    stage,
    upstreamStatus: response.status,
    clientRequestId: clientRequestId.toLowerCase(),
    responseShape,
    ...(graphErrorCode ? { graphErrorCode } : {}),
    ...(requestId ? { requestId } : {}),
    ...(responseDate ? { responseDate } : {}),
    ...(retryAfter ? { retryAfter } : {}),
  };
}

function graphResponseShape(
  value: unknown,
): "graph-error" | "non-json" | "permission-response-mismatch" {
  if (isRecord(value) && isRecord(value.error)) {
    return "graph-error";
  }
  return value === undefined ? "non-json" : "permission-response-mismatch";
}

function graphErrorChain(value: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let error = isRecord(value) && isRecord(value.error)
    ? value.error
    : undefined;
  while (error && chain.length < 8) {
    chain.push(error);
    error = isRecord(error.innerError) ? error.innerError : undefined;
  }
  return chain;
}

function safeGraphErrorCode(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(value)
    ? value
    : undefined;
}

function safeHttpDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toUTCString() : undefined;
}

function safeRetryAfter(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (/^(?:0|[1-9][0-9]{0,5})$/.test(value)) {
    return value;
  }
  return safeHttpDate(value);
}

function safeGuid(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

type PermissionClassification =
  | { kind: "exact"; id: string }
  | { kind: "related-unrecognized" }
  | { kind: "other" };

type PermissionInspection =
  | { kind: "exact"; id: string }
  | { kind: "absent" }
  | { kind: "ambiguous" };

function inspectMargeReadPermissions(
  value: unknown,
  margeObjectId: string,
): PermissionInspection {
  if (
    !isRecord(value) ||
    !Array.isArray(value.value) ||
    value["@odata.nextLink"] !== undefined
  ) {
    return { kind: "ambiguous" };
  }
  const exact: string[] = [];
  let relatedButUnrecognized = false;
  for (const permission of value.value) {
    if (
      !isRecord(permission) ||
      !nonEmpty(permission.id) ||
      !Array.isArray(permission.roles)
    ) {
      return { kind: "ambiguous" };
    }
    const classification = classifyMargeReadPermission(
      permission,
      margeObjectId,
    );
    if (classification.kind === "exact") {
      exact.push(classification.id);
    } else if (classification.kind === "related-unrecognized") {
      relatedButUnrecognized = true;
    }
  }
  if (exact.length > 1 || relatedButUnrecognized) {
    return { kind: "ambiguous" };
  }
  return exact.length === 1
    ? { kind: "exact", id: exact[0]! }
    : { kind: "absent" };
}

function classifyMargeReadPermission(
  value: unknown,
  margeObjectId: string,
): PermissionClassification {
  if (!isRecord(value)) {
    return { kind: "related-unrecognized" };
  }
  const invitation = isRecord(value.invitation) ? value.invitation : undefined;
  const invitationEmail =
    invitation && typeof invitation.email === "string"
      ? invitation.email.toLowerCase()
      : undefined;
  const grantedUser =
    isRecord(value.grantedToV2) && isRecord(value.grantedToV2.user)
      ? value.grantedToV2.user
      : undefined;
  const grantedObjectId =
    grantedUser && typeof grantedUser.id === "string"
      ? grantedUser.id.toLowerCase()
      : undefined;
  const relatesToMarge =
    invitationEmail === MARGE_USER_PRINCIPAL_NAME.toLowerCase() ||
    grantedObjectId === margeObjectId.toLowerCase();
  if (!relatesToMarge) {
    return { kind: "other" };
  }

  const invitationIsExact =
    invitationEmail === undefined ||
    (invitationEmail === MARGE_USER_PRINCIPAL_NAME.toLowerCase() &&
      invitation?.signInRequired === true);
  const granteeIsExact =
    grantedObjectId === undefined ||
    grantedObjectId === margeObjectId.toLowerCase();
  if (
    nonEmpty(value.id) &&
    Array.isArray(value.roles) &&
    value.roles.length === 1 &&
    value.roles[0] === "read" &&
    (value.link === undefined || value.link === null) &&
    (value.inheritedFrom === undefined || value.inheritedFrom === null) &&
    invitationIsExact &&
    granteeIsExact
  ) {
    return { kind: "exact", id: value.id };
  }
  return { kind: "related-unrecognized" };
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
