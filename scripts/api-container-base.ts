import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { get } from "node:https";
import { join } from "node:path";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INDEX_MEDIA_TYPE =
  "application/vnd.docker.distribution.manifest.list.v2+json";
const MANIFEST_MEDIA_TYPE =
  "application/vnd.docker.distribution.manifest.v2+json";
const MAX_REGISTRY_BYTES = 1024 * 1024;

export interface ApiContainerBaseLock {
  schemaVersion: 1;
  kind: "ap2-api-container-base-lock";
  registry: "mcr.microsoft.com";
  repository: "playwright";
  tag: string;
  indexDigest: string;
  manifestDigest: string;
  platform: {
    os: "linux";
    architecture: "amd64";
  };
}

export interface RegistryResponse {
  body: Buffer;
  contentDigest?: string;
  contentType: string;
  status: number;
}

export type RegistryRead = (
  path: string,
  accept: string,
  redirectPolicy: RegistryRedirectPolicy,
) => Promise<RegistryResponse>;

export type RegistryRedirectPolicy = "direct" | "mcr-content-addressed";

interface ManifestIndex {
  schemaVersion?: number;
  mediaType?: string;
  manifests?: Array<{
    digest?: string;
    mediaType?: string;
    platform?: {
      architecture?: string;
      os?: string;
      variant?: string;
    };
    size?: number;
  }>;
}

interface ImageManifest {
  schemaVersion?: number;
  mediaType?: string;
  config?: {
    digest?: string;
    mediaType?: string;
    size?: number;
  };
}

interface ImageConfig {
  architecture?: string;
  os?: string;
}

export function readApiContainerBaseLock(
  repositoryRoot: string,
): ApiContainerBaseLock {
  const path = join(repositoryRoot, "container-base-lock.json");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("API_CONTAINER_BASE_LOCK_PARSE");
  }
  return validateApiContainerBaseLock(value);
}

export function validateApiContainerBaseLock(
  value: unknown,
): ApiContainerBaseLock {
  if (!isRecord(value)) {
    throw new Error("API_CONTAINER_BASE_LOCK_SCHEMA");
  }
  const expectedKeys = [
    "indexDigest",
    "kind",
    "manifestDigest",
    "platform",
    "registry",
    "repository",
    "schemaVersion",
    "tag",
  ];
  if (
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
    value.schemaVersion !== 1 ||
    value.kind !== "ap2-api-container-base-lock" ||
    value.registry !== "mcr.microsoft.com" ||
    value.repository !== "playwright" ||
    typeof value.tag !== "string" ||
    !/^v\d+\.\d+\.\d+-noble$/u.test(value.tag) ||
    typeof value.indexDigest !== "string" ||
    !DIGEST_PATTERN.test(value.indexDigest) ||
    typeof value.manifestDigest !== "string" ||
    !DIGEST_PATTERN.test(value.manifestDigest) ||
    !isRecord(value.platform) ||
    JSON.stringify(Object.keys(value.platform).sort()) !==
      JSON.stringify(["architecture", "os"]) ||
    value.platform.os !== "linux" ||
    value.platform.architecture !== "amd64"
  ) {
    throw new Error("API_CONTAINER_BASE_LOCK_SCHEMA");
  }
  return value as unknown as ApiContainerBaseLock;
}

export function serializeApiContainerBaseLock(
  lock: ApiContainerBaseLock,
): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function pinnedApiContainerBaseReference(
  lock: ApiContainerBaseLock,
): string {
  return `${lock.registry}/${lock.repository}:${lock.tag}@${lock.manifestDigest}`;
}

export async function resolveApiContainerBase(
  tag: string,
  read: RegistryRead = readMicrosoftContainerRegistry,
): Promise<ApiContainerBaseLock> {
  if (!/^v\d+\.\d+\.\d+-noble$/u.test(tag)) {
    throw new Error("API_CONTAINER_BASE_UPDATE_TAG");
  }
  const index = await read(
    `/v2/playwright/manifests/${tag}`,
    INDEX_MEDIA_TYPE,
    "direct",
  );
  assertRegistryDocument(index, INDEX_MEDIA_TYPE);
  const indexDigest = digest(index.body);
  if (index.contentDigest !== indexDigest) {
    throw new Error("API_CONTAINER_BASE_UPDATE_INDEX_DIGEST");
  }
  const indexDocument = parseJson<ManifestIndex>(
    index.body,
    "API_CONTAINER_BASE_UPDATE_INDEX_PARSE",
  );
  if (
    indexDocument.schemaVersion !== 2 ||
    indexDocument.mediaType !== INDEX_MEDIA_TYPE ||
    !Array.isArray(indexDocument.manifests)
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_INDEX_SCHEMA");
  }
  const candidates = indexDocument.manifests.filter((entry) =>
    entry.mediaType === MANIFEST_MEDIA_TYPE &&
    entry.platform?.os === "linux" &&
    entry.platform.architecture === "amd64" &&
    entry.platform.variant === undefined &&
    typeof entry.digest === "string" &&
    DIGEST_PATTERN.test(entry.digest) &&
    Number.isSafeInteger(entry.size) &&
    (entry.size ?? 0) > 0
  );
  if (candidates.length !== 1) {
    throw new Error("API_CONTAINER_BASE_UPDATE_PLATFORM");
  }
  const manifestDigest = candidates[0]!.digest!;
  const manifest = await read(
    `/v2/playwright/manifests/${manifestDigest}`,
    MANIFEST_MEDIA_TYPE,
    "direct",
  );
  assertRegistryDocument(manifest, MANIFEST_MEDIA_TYPE);
  if (
    manifest.contentDigest !== manifestDigest ||
    digest(manifest.body) !== manifestDigest ||
    candidates[0]!.size !== manifest.body.length
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_MANIFEST_DIGEST");
  }
  const manifestDocument = parseJson<ImageManifest>(
    manifest.body,
    "API_CONTAINER_BASE_UPDATE_MANIFEST_PARSE",
  );
  if (
    manifestDocument.schemaVersion !== 2 ||
    manifestDocument.mediaType !== MANIFEST_MEDIA_TYPE ||
    manifestDocument.config?.mediaType !==
      "application/vnd.docker.container.image.v1+json" ||
    typeof manifestDocument.config.digest !== "string" ||
    !DIGEST_PATTERN.test(manifestDocument.config.digest) ||
    !Number.isSafeInteger(manifestDocument.config.size) ||
    (manifestDocument.config.size ?? 0) <= 0
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_MANIFEST_SCHEMA");
  }
  const configDigest = manifestDocument.config.digest;
  const config = await read(
    `/v2/playwright/blobs/${configDigest}`,
    "application/octet-stream",
    "mcr-content-addressed",
  );
  if (
    config.status !== 200 ||
    config.body.length === 0 ||
    config.body.length > MAX_REGISTRY_BYTES ||
    config.body.length !== manifestDocument.config.size ||
    digest(config.body) !== configDigest
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_CONFIG_DIGEST");
  }
  const configDocument = parseJson<ImageConfig>(
    config.body,
    "API_CONTAINER_BASE_UPDATE_CONFIG_PARSE",
  );
  if (
    configDocument.os !== "linux" ||
    configDocument.architecture !== "amd64"
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_CONFIG_PLATFORM");
  }
  return {
    schemaVersion: 1,
    kind: "ap2-api-container-base-lock",
    registry: "mcr.microsoft.com",
    repository: "playwright",
    tag,
    indexDigest,
    manifestDigest,
    platform: {
      os: "linux",
      architecture: "amd64",
    },
  };
}

async function readMicrosoftContainerRegistry(
  path: string,
  accept: string,
  redirectPolicy: RegistryRedirectPolicy,
): Promise<RegistryResponse> {
  if (!/^\/v2\/playwright\/(?:manifests|blobs)\/[A-Za-z0-9:._-]+$/u.test(path)) {
    throw new Error("API_CONTAINER_BASE_UPDATE_PATH");
  }
  return await readHttps(
    `https://mcr.microsoft.com${path}`,
    accept,
    redirectPolicy,
    0,
  );
}

async function readHttps(
  url: string,
  accept: string,
  redirectPolicy: RegistryRedirectPolicy,
  redirects: number,
): Promise<RegistryResponse> {
  const parsed = validateMicrosoftRegistryUrl(url, redirectPolicy, redirects);
  return await new Promise((resolve, reject) => {
    const request = get(
      parsed,
      {
        headers: { accept },
        timeout: 30_000,
      },
      (response) => {
        if (
          [301, 302, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          response.resume();
          readHttps(
            new URL(response.headers.location, parsed).href,
            accept,
            redirectPolicy,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_REGISTRY_BYTES) {
            request.destroy(new Error("API_CONTAINER_BASE_UPDATE_OVERSIZE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks),
            contentDigest: headerValue(
              response.headers["docker-content-digest"],
            ),
            contentType: headerValue(response.headers["content-type"]) ?? "",
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("API_CONTAINER_BASE_UPDATE_TIMEOUT"));
    });
    request.on("error", reject);
  });
}

export function validateMicrosoftRegistryUrl(
  url: string,
  redirectPolicy: RegistryRedirectPolicy,
  redirects: number,
): URL {
  const parsed = new URL(url);
  const isInitial =
    redirects === 0 && parsed.hostname === "mcr.microsoft.com";
  const isApprovedContentRedirect =
    redirects === 1 &&
    redirectPolicy === "mcr-content-addressed" &&
    parsed.hostname.endsWith(".data.mcr.microsoft.com");
  if (
    parsed.protocol !== "https:" ||
    (!isInitial && !isApprovedContentRedirect) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_REDIRECT");
  }
  return parsed;
}

function assertRegistryDocument(
  response: RegistryResponse,
  expectedContentType: string,
): void {
  if (
    response.status !== 200 ||
    response.contentType.split(";", 1)[0] !== expectedContentType ||
    response.body.length === 0 ||
    response.body.length > MAX_REGISTRY_BYTES
  ) {
    throw new Error("API_CONTAINER_BASE_UPDATE_RESPONSE");
  }
}

function parseJson<T>(body: Buffer, category: string): T {
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new Error(category);
  }
}

function digest(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
