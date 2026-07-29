import { createHash } from "node:crypto";
import {
  GRAPH_APPLICATION_SCOPE,
  SHAREPOINT_DRIVE_ID,
  type GraphApplicationTokenCredential,
} from "./sharepoint-file-proof.js";

export const TRUSTED_VERSION_ONE_CONTENT =
  "AP2 harmless SharePoint baseline.\nstate=original\n";
export const TRUSTED_VERSION_TWO_CONTENT =
  "AP2 harmless SharePoint baseline.\nstate=overwritten-for-version-proof\n";
export const TRUSTED_VERSION_ONE_SIZE = 49;
export const TRUSTED_VERSION_TWO_SIZE = 70;
export const TRUSTED_VERSION_FILE_NAME = "trusted-version.txt";
export const TRUSTED_VERSION_MAX_LIFETIME_MS = 30 * 60 * 1_000;

const GRAPH = "https://graph.microsoft.com/v1.0";
const SAFE_MARKER = /^ap2-spv-[a-z0-9]{12}$/;
const AMBIGUOUS_MUTATION_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface SharePointTrustedVersionLifecycleInput {
  schemaVersion: 1;
  marker: string;
  expiresAt: string;
}

export interface TrustedVersionJournalEntry {
  sequence: number;
  operation:
    | "expiry"
    | "folder-create"
    | "file-create"
    | "version-write"
    | "version-read"
    | "file-delete"
    | "folder-delete"
    | "terminal-absence";
  transition: "prepared" | "intent" | "succeeded" | "reconciled" | "observed" | "removed";
}

export interface SharePointTrustedVersionLifecycleResult {
  schemaVersion: 1;
  kind: "sharepoint-trusted-version-lifecycle-result";
  status: "completed-cleaned";
  scenarioId: "sharepoint-trusted-version-lifecycle";
  producer: "sharepoint-producer-app";
  cleanupOwner: "trusted-version-cleanup-owner";
  learnerVisibility: "uninspected";
  detectorObservation: "uninspected";
  learnerInterpretation: "uninspected";
  response: "uninspected";
  markerDigestSha256: string;
  fileIdentityDigestSha256: string;
  startedAt: string;
  completedAt: string;
  expiresAt: string;
  versions: readonly [
    {
      ordinal: "changed-v2";
      platformVersionDigestSha256: string;
      contentDigestSha256: string;
      size: 70;
      lastModifiedAt: string;
    },
    {
      ordinal: "trusted-v1";
      platformVersionDigestSha256: string;
      contentDigestSha256: string;
      size: 49;
      lastModifiedAt: string;
    },
  ];
  journal: readonly TrustedVersionJournalEntry[];
  journalDigestSha256: string;
  terminal: {
    activeFile: "absent";
    activeFolder: "absent";
    recycleAndAuditHistory: "ordinary-platform-history-retained";
    expiry: "removed";
  };
}

export interface SharePointTrustedVersionLifecycleOperation {
  run(value: unknown): Promise<SharePointTrustedVersionLifecycleResult>;
}

export type TrustedVersionLifecycleErrorCode =
  | "invalid-input"
  | "marker-reused"
  | "state-conflict"
  | "platform-refusal"
  | "ambiguous"
  | "cleanup-incomplete";

export class TrustedVersionLifecycleError extends Error {
  constructor(
    readonly code: TrustedVersionLifecycleErrorCode,
    message: string,
  ) {
    super(`SharePoint trusted-version lifecycle failed [${code}]: ${message}`);
    this.name = "TrustedVersionLifecycleError";
  }
}

interface ExactItem {
  id: string;
  name: string;
  eTag: string;
  size: number;
  parentReference: { driveId: string };
  file?: Record<string, unknown>;
  folder?: Record<string, unknown>;
}

interface VersionRow {
  id: string;
  size: number;
  lastModifiedAt: string;
}

export class ProcessLocalTrustedVersionJournal {
  private readonly used = new Set<string>();

  begin(markerDigestSha256: string): TrustedVersionJournalWriter {
    if (this.used.has(markerDigestSha256)) {
      throw failure("marker-reused", "the process-local marker was already reserved.");
    }
    this.used.add(markerDigestSha256);
    return new TrustedVersionJournalWriter();
  }
}

export class TrustedVersionJournalWriter {
  readonly entries: TrustedVersionJournalEntry[] = [];

  record(
    operation: TrustedVersionJournalEntry["operation"],
    transition: TrustedVersionJournalEntry["transition"],
  ): void {
    this.entries.push({
      sequence: this.entries.length + 1,
      operation,
      transition,
    });
  }
}

export class GraphSharePointTrustedVersionLifecycle
  implements SharePointTrustedVersionLifecycleOperation {
  constructor(
    private readonly credential: GraphApplicationTokenCredential,
    private readonly journal = new ProcessLocalTrustedVersionJournal(),
    private readonly request: typeof fetch = fetch.bind(globalThis),
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      byteLength(TRUSTED_VERSION_ONE_CONTENT) !== TRUSTED_VERSION_ONE_SIZE ||
      byteLength(TRUSTED_VERSION_TWO_CONTENT) !== TRUSTED_VERSION_TWO_SIZE
    ) {
      throw new TypeError("The fixed trusted-version payload sizes changed.");
    }
  }

  async run(value: unknown): Promise<SharePointTrustedVersionLifecycleResult> {
    const input = parseInput(value, this.now());
    const markerDigestSha256 = digest(input.marker);
    const journal = this.journal.begin(markerDigestSha256);
    const startedAt = this.now().toISOString();
    journal.record("expiry", "prepared");

    const folderName = `AP2 Trusted Version [${input.marker}]`;
    const folderPath = encodeURIComponent(folderName);
    const filePath = `${folderPath}/${encodeURIComponent(TRUSTED_VERSION_FILE_NAME)}`;
    const driveUrl = `${GRAPH}/drives/${encodeURIComponent(SHAREPOINT_DRIVE_ID)}`;
    const folderPathUrl = `${driveUrl}/root:/${folderPath}`;
    const filePathUrl = `${driveUrl}/root:/${filePath}`;
    let token = "";
    let folder: ExactItem | undefined;
    let file: ExactItem | undefined;
    let fileDeleteAttempted = false;
    let folderDeleteAttempted = false;
    let primaryError: unknown;

    try {
      token = await this.token();
      if ((await this.lookup(folderPathUrl, token)).status !== 404) {
        throw failure("state-conflict", "the exact run folder path is not absent.");
      }

      this.requireBeforeExpiry(input.expiresAt);
      journal.record("folder-create", "intent");
      folder = await this.createFolder(driveUrl, folderName, folderPathUrl, token);
      journal.record("folder-create", "succeeded");

      this.requireBeforeExpiry(input.expiresAt);
      journal.record("file-create", "intent");
      file = await this.writeFile(
        `${driveUrl}/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(TRUSTED_VERSION_FILE_NAME)}:/content?@microsoft.graph.conflictBehavior=fail`,
        TRUSTED_VERSION_ONE_CONTENT,
        201,
        filePathUrl,
        token,
      );
      journal.record("file-create", "succeeded");
      await this.requireBytes(`${driveUrl}/items/${encodeURIComponent(file.id)}/content`, token, TRUSTED_VERSION_ONE_CONTENT);
      journal.record("file-create", "reconciled");

      this.requireBeforeExpiry(input.expiresAt);
      journal.record("version-write", "intent");
      file = await this.writeFile(
        `${driveUrl}/items/${encodeURIComponent(file.id)}/content`,
        TRUSTED_VERSION_TWO_CONTENT,
        200,
        filePathUrl,
        token,
        file.id,
        file.eTag,
      );
      journal.record("version-write", "succeeded");
      await this.requireBytes(`${driveUrl}/items/${encodeURIComponent(file.id)}/content`, token, TRUSTED_VERSION_TWO_CONTENT);
      journal.record("version-write", "reconciled");

      const versions = await this.readVersions(driveUrl, file.id, token);
      journal.record("version-read", "observed");
      const changed = versions[0]!;
      const trusted = versions[1]!;
      const current = await this.readCurrentVersion(
        driveUrl,
        file.id,
        token,
      );
      if (
        current.id !== changed.id ||
        current.size !== changed.size ||
        current.lastModifiedAt !== changed.lastModifiedAt
      ) {
        throw failure(
          "state-conflict",
          "the newest listed version was not the exact current version.",
        );
      }
      await this.requireBytes(
        `${driveUrl}/items/${encodeURIComponent(file.id)}/content`,
        token,
        TRUSTED_VERSION_TWO_CONTENT,
      );
      await this.requireBytes(
        `${driveUrl}/items/${encodeURIComponent(file.id)}/versions/${encodeURIComponent(trusted.id)}/content`,
        token,
        TRUSTED_VERSION_ONE_CONTENT,
      );
      journal.record("version-read", "reconciled");

      const identityDigest = digest([
        SHAREPOINT_DRIVE_ID,
        folder.id,
        file.id,
        input.marker,
      ].join("\n"));

      fileDeleteAttempted = true;
      await this.deleteOwnedFile(driveUrl, file, filePathUrl, token, journal);
      file = undefined;
      folderDeleteAttempted = true;
      await this.deleteOwnedFolder(driveUrl, folder, folderPathUrl, token, journal);
      folder = undefined;
      await this.requireAbsent(filePathUrl, token);
      await this.requireAbsent(folderPathUrl, token);
      journal.record("expiry", "removed");
      journal.record("terminal-absence", "observed");

      const completedAt = this.now().toISOString();
      const safeJournal = journal.entries.map((entry) => ({ ...entry }));
      return deepFreeze({
        schemaVersion: 1,
        kind: "sharepoint-trusted-version-lifecycle-result",
        status: "completed-cleaned",
        scenarioId: "sharepoint-trusted-version-lifecycle",
        producer: "sharepoint-producer-app",
        cleanupOwner: "trusted-version-cleanup-owner",
        learnerVisibility: "uninspected",
        detectorObservation: "uninspected",
        learnerInterpretation: "uninspected",
        response: "uninspected",
        markerDigestSha256,
        fileIdentityDigestSha256: identityDigest,
        startedAt,
        completedAt,
        expiresAt: input.expiresAt,
        versions: [
          {
            ordinal: "changed-v2",
            platformVersionDigestSha256: digest(changed.id),
            contentDigestSha256: digest(TRUSTED_VERSION_TWO_CONTENT),
            size: TRUSTED_VERSION_TWO_SIZE,
            lastModifiedAt: changed.lastModifiedAt,
          },
          {
            ordinal: "trusted-v1",
            platformVersionDigestSha256: digest(trusted.id),
            contentDigestSha256: digest(TRUSTED_VERSION_ONE_CONTENT),
            size: TRUSTED_VERSION_ONE_SIZE,
            lastModifiedAt: trusted.lastModifiedAt,
          },
        ],
        journal: safeJournal,
        journalDigestSha256: digest(JSON.stringify(safeJournal)),
        terminal: {
          activeFile: "absent",
          activeFolder: "absent",
          recycleAndAuditHistory: "ordinary-platform-history-retained",
          expiry: "removed",
        },
      } satisfies SharePointTrustedVersionLifecycleResult);
    } catch (error) {
      primaryError = error;
      try {
        if (token) {
          if (file && !fileDeleteAttempted) {
            fileDeleteAttempted = true;
            await this.deleteOwnedFile(driveUrl, file, filePathUrl, token, journal);
          }
          if (folder && !folderDeleteAttempted) {
            folderDeleteAttempted = true;
            await this.deleteOwnedFolder(driveUrl, folder, folderPathUrl, token, journal);
          }
          await this.requireAbsent(filePathUrl, token);
          await this.requireAbsent(folderPathUrl, token);
          journal.record("expiry", "removed");
          journal.record("terminal-absence", "observed");
        }
      } catch {
        throw failure("cleanup-incomplete", "exact run-owned cleanup could not be proven.");
      }
      throw primaryError;
    }
  }

  private async createFolder(
    driveUrl: string,
    name: string,
    pathUrl: string,
    token: string,
  ): Promise<ExactItem> {
    let response: Response;
    try {
      response = await this.request(`${driveUrl}/root/children`, {
        method: "POST",
        redirect: "error",
        headers: graphHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      });
    } catch {
      const reconciled = await this.exactOwnedFolder(pathUrl, token);
      if (reconciled) return reconciled;
      throw failure("ambiguous", "folder creation transport failed and exact reconciliation did not prove success.");
    }
    if (response.status === 201) {
      try {
        const item = parseItem(await readJson(response));
        if (item.name === name && item.folder) return item;
      } catch {
        // A success status with an unusable body is reconciled by exact path.
      }
      const reconciled = await this.exactOwnedFolder(pathUrl, token);
      if (reconciled) return reconciled;
      throw failure(
        "ambiguous",
        "folder creation succeeded without a reconcilable exact item.",
      );
    }
    if (AMBIGUOUS_MUTATION_STATUSES.has(response.status)) {
      const reconciled = await this.exactOwnedFolder(pathUrl, token);
      if (reconciled) return reconciled;
      throw failure("ambiguous", "folder creation response was ambiguous.");
    }
    throw failure("platform-refusal", `folder creation returned HTTP ${response.status}.`);
  }

  private async writeFile(
    url: string,
    content: string,
    expectedStatus: 200 | 201,
    pathUrl: string,
    token: string,
    expectedId?: string,
    expectedETag?: string,
  ): Promise<ExactItem> {
    let response: Response;
    try {
      response = await this.request(url, {
        method: "PUT",
        redirect: "error",
        headers: graphHeaders(token, {
          "Content-Type": "text/plain",
          ...(expectedETag === undefined ? {} : { "If-Match": expectedETag }),
        }),
        body: content,
      });
    } catch {
      return this.reconcileFileWrite(pathUrl, token, content, expectedId);
    }
    if (response.status === expectedStatus || (expectedStatus === 200 && response.status === 201)) {
      try {
        const item = parseItem(await readJson(response));
        if (
          item.name === TRUSTED_VERSION_FILE_NAME &&
          item.file &&
          item.size === byteLength(content) &&
          (expectedId === undefined || item.id === expectedId)
        ) return item;
      } catch {
        // A success status with an unusable body is reconciled by exact path.
      }
      return this.reconcileFileWrite(pathUrl, token, content, expectedId);
    }
    if (AMBIGUOUS_MUTATION_STATUSES.has(response.status)) {
      return this.reconcileFileWrite(pathUrl, token, content, expectedId);
    }
    throw failure("platform-refusal", `file write returned HTTP ${response.status}.`);
  }

  private async reconcileFileWrite(
    pathUrl: string,
    token: string,
    content: string,
    expectedId?: string,
  ): Promise<ExactItem> {
    const item = await this.exactOwnedFile(pathUrl, token);
    if (!item || (expectedId !== undefined && item.id !== expectedId)) {
      throw failure("ambiguous", "file write was not proven by exact reconciliation.");
    }
    await this.requireBytes(
      `${GRAPH}/drives/${encodeURIComponent(SHAREPOINT_DRIVE_ID)}/items/${encodeURIComponent(item.id)}/content`,
      token,
      content,
    );
    return item;
  }

  private async readVersions(
    driveUrl: string,
    fileId: string,
    token: string,
  ): Promise<readonly [VersionRow, VersionRow]> {
    const response = await this.request(
      `${driveUrl}/items/${encodeURIComponent(fileId)}/versions?$top=3&$select=id,size,lastModifiedDateTime`,
      { method: "GET", redirect: "error", headers: graphHeaders(token) },
    );
    const body = asRecord(await readJson(response));
    if (
      response.status !== 200 ||
      "@odata.nextLink" in body ||
      !Array.isArray(body.value) ||
      body.value.length !== 2
    ) {
      throw failure("state-conflict", "the capped version history was incomplete or not exactly two rows.");
    }
    const rows = body.value.map(parseVersion);
    if (
      rows[0]!.size !== TRUSTED_VERSION_TWO_SIZE ||
      rows[1]!.size !== TRUSTED_VERSION_ONE_SIZE ||
      rows[0]!.id === rows[1]!.id ||
      Date.parse(rows[0]!.lastModifiedAt) < Date.parse(rows[1]!.lastModifiedAt)
    ) {
      throw failure("state-conflict", "the ordered version sizes or identities did not match the fixed contract.");
    }
    return [rows[0]!, rows[1]!];
  }

  private async readCurrentVersion(
    driveUrl: string,
    fileId: string,
    token: string,
  ): Promise<VersionRow> {
    const response = await this.request(
      `${driveUrl}/items/${encodeURIComponent(fileId)}/versions/current?$select=id,size,lastModifiedDateTime`,
      { method: "GET", redirect: "error", headers: graphHeaders(token) },
    );
    if (response.status !== 200) {
      throw failure(
        "state-conflict",
        "the exact current-version metadata read failed.",
      );
    }
    return parseVersion(await readJson(response));
  }

  private async deleteOwnedFile(
    driveUrl: string,
    item: ExactItem,
    pathUrl: string,
    token: string,
    journal: TrustedVersionJournalWriter,
  ): Promise<void> {
    journal.record("file-delete", "intent");
    await this.deleteOnce(`${driveUrl}/items/${encodeURIComponent(item.id)}`, item.eTag, pathUrl, token);
    journal.record("file-delete", "succeeded");
  }

  private async deleteOwnedFolder(
    driveUrl: string,
    item: ExactItem,
    pathUrl: string,
    token: string,
    journal: TrustedVersionJournalWriter,
  ): Promise<void> {
    const children = await this.request(
      `${driveUrl}/items/${encodeURIComponent(item.id)}/children?$top=1&$select=id`,
      { method: "GET", redirect: "error", headers: graphHeaders(token) },
    );
    const body = asRecord(await readJson(children));
    if (
      children.status !== 200 ||
      "@odata.nextLink" in body ||
      !Array.isArray(body.value) ||
      body.value.length !== 0
    ) {
      throw failure("state-conflict", "the exact run folder was not proven empty.");
    }
    journal.record("folder-delete", "intent");
    await this.deleteOnce(`${driveUrl}/items/${encodeURIComponent(item.id)}`, item.eTag, pathUrl, token);
    journal.record("folder-delete", "succeeded");
  }

  private async deleteOnce(
    itemUrl: string,
    eTag: string,
    pathUrl: string,
    token: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.request(itemUrl, {
        method: "DELETE",
        redirect: "error",
        headers: graphHeaders(token, { "If-Match": eTag }),
      });
    } catch {
      if ((await this.lookup(pathUrl, token)).status === 404) return;
      throw failure("ambiguous", "delete transport failed and absence was not proven.");
    }
    if (response.status === 204) return;
    if (AMBIGUOUS_MUTATION_STATUSES.has(response.status) || response.status === 404) {
      if ((await this.lookup(pathUrl, token)).status === 404) return;
      throw failure("ambiguous", "delete response was ambiguous and absence was not proven.");
    }
    throw failure("platform-refusal", `delete returned HTTP ${response.status}.`);
  }

  private async exactOwnedFile(pathUrl: string, token: string): Promise<ExactItem | undefined> {
    const response = await this.lookup(pathUrl, token);
    if (response.status === 404) return undefined;
    const item = parseItem(await readJson(response));
    if (
      response.status !== 200 ||
      item.name !== TRUSTED_VERSION_FILE_NAME ||
      !item.file
    ) throw failure("state-conflict", "the exact file path resolved to an unowned object.");
    return item;
  }

  private async exactOwnedFolder(pathUrl: string, token: string): Promise<ExactItem | undefined> {
    const response = await this.lookup(pathUrl, token);
    if (response.status === 404) return undefined;
    const item = parseItem(await readJson(response));
    if (response.status !== 200 || !item.folder) {
      throw failure("state-conflict", "the exact folder path resolved to an unowned object.");
    }
    return item;
  }

  private lookup(pathUrl: string, token: string): Promise<Response> {
    return this.request(pathUrl, {
      method: "GET",
      redirect: "error",
      headers: graphHeaders(token),
    });
  }

  private async requireAbsent(pathUrl: string, token: string): Promise<void> {
    if ((await this.lookup(pathUrl, token)).status !== 404) {
      throw failure("cleanup-incomplete", "active path absence was not proven.");
    }
  }

  private async requireBytes(url: string, token: string, expected: string): Promise<void> {
    const first = await this.request(url, {
      method: "GET",
      redirect: "manual",
      headers: graphHeaders(token),
    });
    let response = first;
    if (first.status === 302) {
      const location = first.headers.get("location");
      if (!location || !location.startsWith("https://")) {
        throw failure("state-conflict", "content redirect was not a bounded HTTPS location.");
      }
      response = await this.request(location, { method: "GET", redirect: "error" });
    }
    if (
      response.status !== 200 ||
      await readBoundedText(response, 128) !== expected
    ) {
      throw failure("state-conflict", "exact version bytes did not match the fixed payload.");
    }
  }

  private async token(): Promise<string> {
    const access = await this.credential.getToken(GRAPH_APPLICATION_SCOPE);
    if (!access?.token) {
      throw failure("platform-refusal", "the API managed identity could not acquire a Graph token.");
    }
    return access.token;
  }

  private requireBeforeExpiry(expiresAt: string): void {
    if (this.now().getTime() >= Date.parse(expiresAt)) {
      throw failure(
        "platform-refusal",
        "the frozen expiry elapsed before a producer mutation.",
      );
    }
  }
}

function parseInput(value: unknown, now: Date): SharePointTrustedVersionLifecycleInput {
  const input = asRecord(value);
  exactKeys(input, ["schemaVersion", "marker", "expiresAt"]);
  if (
    input.schemaVersion !== 1 ||
    typeof input.marker !== "string" ||
    !SAFE_MARKER.test(input.marker) ||
    typeof input.expiresAt !== "string"
  ) throw failure("invalid-input", "input does not match the bounded lifecycle schema.");
  const expiry = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(expiry) ||
    new Date(expiry).toISOString() !== input.expiresAt ||
    expiry <= now.getTime() ||
    expiry - now.getTime() > TRUSTED_VERSION_MAX_LIFETIME_MS
  ) throw failure("invalid-input", "expiry must be canonical, future, and within 30 minutes.");
  return { schemaVersion: 1, marker: input.marker, expiresAt: input.expiresAt };
}

function parseItem(value: unknown): ExactItem {
  const item = asRecord(value);
  const parent = asRecord(item.parentReference);
  if (
    typeof item.id !== "string" || item.id.length === 0 ||
    typeof item.name !== "string" ||
    typeof item.eTag !== "string" || item.eTag.length === 0 ||
    typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0 ||
    parent.driveId !== SHAREPOINT_DRIVE_ID
  ) throw failure("state-conflict", "Graph returned an incomplete or wrong-drive item.");
  return {
    id: item.id,
    name: item.name,
    eTag: item.eTag,
    size: item.size,
    parentReference: { driveId: SHAREPOINT_DRIVE_ID },
    ...(isRecord(item.file) ? { file: item.file } : {}),
    ...(isRecord(item.folder) ? { folder: item.folder } : {}),
  };
}

function parseVersion(value: unknown): VersionRow {
  const row = asRecord(value);
  if (
    typeof row.id !== "string" || row.id.length === 0 || row.id.length > 64 ||
    typeof row.size !== "number" || !Number.isSafeInteger(row.size) || row.size < 0 ||
    typeof row.lastModifiedDateTime !== "string" ||
    !Number.isFinite(Date.parse(row.lastModifiedDateTime)) ||
    new Date(Date.parse(row.lastModifiedDateTime)).toISOString() !==
      row.lastModifiedDateTime
  ) throw failure("state-conflict", "version metadata was incomplete.");
  return {
    id: row.id,
    size: row.size,
    lastModifiedAt: row.lastModifiedDateTime,
  };
}

function graphHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function readJson(response: Response): Promise<unknown> {
  const value = await readBoundedText(response, 65_536);
  if (value.length === 0) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    throw failure("state-conflict", "Graph response exceeded its byte bound.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw failure("state-conflict", "Graph response exceeded its byte bound.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw failure("invalid-input", "expected an object.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw failure("invalid-input", "input fields do not match the lifecycle schema.");
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function failure(
  code: TrustedVersionLifecycleErrorCode,
  message: string,
): TrustedVersionLifecycleError {
  return new TrustedVersionLifecycleError(code, message);
}
