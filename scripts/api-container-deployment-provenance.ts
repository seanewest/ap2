import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  serializeApiContainerProvenance,
  type ApiContainerProvenance,
} from "./api-container-provenance.ts";
import {
  digestLayerDescriptors,
  type ApiContainerBaseLock,
  type ApiContainerLayerDescriptor,
} from "./api-container-base.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_LAYER_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_LAYER_BYTES = 128 * 1024 * 1024;
const MAX_APPLICATION_LAYERS = 8;
const BUNDLE_PATH = "app/dist-api/index.js";
const PROVENANCE_PATH = "app/container-provenance.json";

interface Descriptor {
  digest: string;
  mediaType: string;
  size: number;
}

export interface ApiContainerOciEvidence {
  applicationLayers: readonly Uint8Array[];
  baseLock: ApiContainerBaseLock;
  imageConfig: Uint8Array;
  imageManifest: Uint8Array;
  repositoryProvenance: ApiContainerProvenance;
}

export interface ApiContainerDeploymentProvenanceBinding {
  schemaVersion: 1;
  kind: "ap2-api-container-deployment-provenance-binding";
  classification: "verified-oci-image-contents";
  imageDigest: string;
  imageConfigDigest: string;
  applicationLayersDigest: string;
  provenanceDocumentDigest: string;
  buildInputsDigest: string;
  lockfileDigest: string;
  productionComponentsDigest: string;
  buildArtifactDigest: string;
  baseManifestDigest: string;
  baseConfigDigest: string;
  baseLayerDescriptorsDigest: string;
  baseRootfsDiffIdsDigest: string;
  platform: "linux/amd64";
  bindingDigest: string;
}

export class ApiContainerDeploymentProvenanceError extends Error {
  constructor() {
    super("API_CONTAINER_DEPLOYMENT_PROVENANCE_REFUSED");
    this.name = "ApiContainerDeploymentProvenanceError";
  }
}

export function applicationLayerDigests(
  imageManifest: Uint8Array,
  baseLayerCount: number,
): string[] {
  try {
    const manifest = parseManifest(imageManifest);
    if (
      !Number.isSafeInteger(baseLayerCount) ||
      baseLayerCount <= 0 ||
      baseLayerCount >= manifest.layers.length
    ) {
      refuse();
    }
    const layers = manifest.layers.slice(baseLayerCount);
    if (layers.length === 0 || layers.length > MAX_APPLICATION_LAYERS) {
      refuse();
    }
    return layers.map(({ digest }) => digest);
  } catch {
    refuse();
  }
}

export function imageConfigDigest(imageManifest: Uint8Array): string {
  try {
    return parseManifest(imageManifest).config.digest;
  } catch {
    refuse();
  }
}

export function createApiContainerDeploymentProvenanceBinding(
  imageReference: string,
  evidence: ApiContainerOciEvidence,
): ApiContainerDeploymentProvenanceBinding {
  try {
    const imageDigest = imageReference.match(/@(sha256:[0-9a-f]{64})$/u)?.[1];
    if (!imageDigest || digest(evidence.imageManifest) !== imageDigest) {
      refuse();
    }
    const manifest = parseManifest(evidence.imageManifest);
    if (
      manifest.config.size !== evidence.imageConfig.byteLength ||
      manifest.config.digest !== digest(evidence.imageConfig)
    ) {
      refuse();
    }
    const config = parseConfig(evidence.imageConfig);
    const base = evidence.baseLock;
    const baseDescriptors = manifest.layers.slice(
      0,
      base.rootfsDiffIds.length,
    );
    if (
      base.schemaVersion !== 2 ||
      base.platform.os !== "linux" ||
      base.platform.architecture !== "amd64" ||
      base.rootfsDiffIds.length === 0 ||
      base.layerDescriptors.length !== base.rootfsDiffIds.length ||
      baseDescriptors.some(({ mediaType }) =>
        mediaType !==
          "application/vnd.docker.image.rootfs.diff.tar.gzip"
      ) ||
      digestLayerDescriptors(
        baseDescriptors as ApiContainerLayerDescriptor[],
      ) !== base.layerDescriptorsDigest ||
      config.os !== "linux" ||
      config.architecture !== "amd64" ||
      config.diffIds.length !== manifest.layers.length ||
      config.diffIds.length <= base.rootfsDiffIds.length ||
      !equal(config.diffIds.slice(0, base.rootfsDiffIds.length), base.rootfsDiffIds)
    ) {
      refuse();
    }
    const descriptors = manifest.layers.slice(base.rootfsDiffIds.length);
    if (
      descriptors.length === 0 ||
      descriptors.length > MAX_APPLICATION_LAYERS ||
      descriptors.length !== evidence.applicationLayers.length
    ) {
      refuse();
    }
    const files = new Map<string, Buffer>();
    for (const [index, descriptor] of descriptors.entries()) {
      const compressed = Buffer.from(evidence.applicationLayers[index]!);
      if (
        compressed.length === 0 ||
        compressed.length > MAX_LAYER_BYTES ||
        descriptor.size !== compressed.length ||
        descriptor.digest !== digest(compressed)
      ) {
        refuse();
      }
      const layer = gunzipSync(compressed, {
        maxOutputLength: MAX_UNCOMPRESSED_LAYER_BYTES,
      });
      if (
        digest(layer) !==
          config.diffIds[base.rootfsDiffIds.length + index]
      ) {
        refuse();
      }
      applyLayer(layer, files);
    }
    const bundle = files.get(BUNDLE_PATH);
    const provenanceBytes = files.get(PROVENANCE_PATH);
    if (!bundle || !provenanceBytes || bundle.length > 2 * 1024 * 1024) {
      refuse();
    }
    validateProductionPackages(
      files,
      evidence.repositoryProvenance.productionComponents.components,
    );
    const builtProvenance = parseJson(provenanceBytes);
    const provenance = validateBuiltProvenance(
      builtProvenance,
      bundle,
      evidence.repositoryProvenance,
      base,
    );
    const provenanceDocumentDigest = hexDigest(
      serializeApiContainerProvenance(provenance),
    );
    const applicationLayersDigest = hexDigest(
      descriptors.map(({ digest: value }) => value).join("\n") + "\n",
    );
    const values = {
      schemaVersion: 1,
      kind: "ap2-api-container-deployment-provenance-binding",
      classification: "verified-oci-image-contents",
      imageDigest,
      imageConfigDigest: manifest.config.digest,
      applicationLayersDigest,
      provenanceDocumentDigest,
      buildInputsDigest: provenance.buildInputs.digest,
      lockfileDigest: provenance.lockfile.digest,
      productionComponentsDigest: provenance.productionComponents.digest,
      buildArtifactDigest: provenance.buildArtifacts.digest,
      baseManifestDigest: base.manifestDigest,
      baseConfigDigest: base.configDigest,
      baseLayerDescriptorsDigest: base.layerDescriptorsDigest,
      baseRootfsDiffIdsDigest: provenance.baseImage.rootfsDiffIdsDigest,
      platform: "linux/amd64",
    } as const;
    return {
      ...values,
      bindingDigest: `sha256:${hexDigest(
        Object.values(values).map(String).join("\0"),
      )}`,
    };
  } catch {
    refuse();
  }
}

export function validateApiContainerDeploymentProvenanceBinding(
  value: unknown,
  imageReference: string,
  evidence: ApiContainerOciEvidence,
): ApiContainerDeploymentProvenanceBinding {
  const expected = createApiContainerDeploymentProvenanceBinding(
    imageReference,
    evidence,
  );
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    refuse();
  }
  return value as ApiContainerDeploymentProvenanceBinding;
}

function parseManifest(value: Uint8Array): {
  config: Descriptor;
  layers: Descriptor[];
} {
  const manifest = record(parseJson(value));
  const config = descriptor(manifest.config);
  const layers = Array.isArray(manifest.layers)
    ? manifest.layers.map(descriptor)
    : [];
  if (
    manifest.schemaVersion !== 2 ||
    ![
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].includes(String(manifest.mediaType)) ||
    layers.length === 0 ||
    layers.length > 72 ||
    ![
      "application/vnd.oci.image.config.v1+json",
      "application/vnd.docker.container.image.v1+json",
    ].includes(config.mediaType) ||
    layers.some(({ mediaType }) =>
      ![
        "application/vnd.oci.image.layer.v1.tar+gzip",
        "application/vnd.docker.image.rootfs.diff.tar.gzip",
      ].includes(mediaType)
    )
  ) {
    refuse();
  }
  return { config, layers };
}

function descriptor(value: unknown): Descriptor {
  const item = record(value);
  if (
    JSON.stringify(Object.keys(item).sort()) !==
      JSON.stringify(["digest", "mediaType", "size"]) ||
    typeof item.digest !== "string" ||
    !DIGEST.test(item.digest) ||
    typeof item.mediaType !== "string" ||
    !Number.isSafeInteger(item.size) ||
    (item.size as number) <= 0
  ) {
    refuse();
  }
  return item as unknown as Descriptor;
}

function parseConfig(value: Uint8Array): {
  architecture: string;
  diffIds: string[];
  os: string;
} {
  const config = record(parseJson(value));
  const rootfs = record(config.rootfs);
  const diffIds = Array.isArray(rootfs.diff_ids) ? rootfs.diff_ids : [];
  if (
    rootfs.type !== "layers" ||
    diffIds.length === 0 ||
    diffIds.length > 72 ||
    diffIds.some((entry) => typeof entry !== "string" || !DIGEST.test(entry))
  ) {
    refuse();
  }
  return {
    architecture: String(config.architecture),
    diffIds: diffIds as string[],
    os: String(config.os),
  };
}

function applyLayer(layer: Buffer, files: Map<string, Buffer>): void {
  let offset = 0;
  let paxPath: string | undefined;
  while (offset + 512 <= layer.length) {
    const header = layer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return;
    }
    const claimedChecksum = readOctal(header.subarray(148, 156));
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (
      checksumHeader.reduce((sum, byte) => sum + byte, 0) !== claimedChecksum
    ) {
      refuse();
    }
    const size = readOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] ?? 0);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > layer.length) {
      refuse();
    }
    const body = layer.subarray(bodyStart, bodyEnd);
    const headerPath = tarText(header.subarray(345, 500))
      ? `${tarText(header.subarray(345, 500))}/${tarText(header.subarray(0, 100))}`
      : tarText(header.subarray(0, 100));
    if (type === "L" || type === "g" || type === "S") {
      refuse();
    } else if (type === "x") {
      paxPath = parsePaxPath(body);
    } else {
      const path = normalizeTarPath(paxPath ?? headerPath);
      paxPath = undefined;
      applyEntry(path, type, body, files);
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  refuse();
}

function applyEntry(
  path: string,
  type: string,
  body: Buffer,
  files: Map<string, Buffer>,
): void {
  const slash = path.lastIndexOf("/");
  const basename = path.slice(slash + 1);
  const parent = slash < 0 ? "" : path.slice(0, slash);
  if (basename.startsWith(".wh.")) {
    if (basename === ".wh..wh..opq") {
      for (const key of files.keys()) {
        if (parent === "" || key.startsWith(`${parent}/`)) {
          files.delete(key);
        }
      }
    } else {
      const removed = `${parent ? `${parent}/` : ""}${basename.slice(4)}`;
      for (const key of files.keys()) {
        if (key === removed || key.startsWith(`${removed}/`)) {
          files.delete(key);
        }
      }
    }
    return;
  }
  if (
    ["1", "2"].includes(type) &&
    path.startsWith("app/node_modules/") &&
    !path.startsWith("app/node_modules/.bin/")
  ) {
    refuse();
  }
  for (const target of [BUNDLE_PATH, PROVENANCE_PATH]) {
    if (path === target) {
      if (type !== "0" && type !== "\0") {
        refuse();
      }
      files.set(target, Buffer.from(body));
    }
    if (
      target.startsWith(`${path}/`) &&
      ["1", "2"].includes(type)
    ) {
      refuse();
    }
  }
  if (isPackageManifestPath(path)) {
    if (
      (type !== "0" && type !== "\0") ||
      body.length === 0 ||
      body.length > 256 * 1024
    ) {
      refuse();
    }
    files.set(path, Buffer.from(body));
  }
}

function validateBuiltProvenance(
  value: unknown,
  bundle: Buffer,
  expected: ApiContainerProvenance,
  base: ApiContainerBaseLock,
): ApiContainerProvenance & {
  buildArtifacts: Extract<
    ApiContainerProvenance["buildArtifacts"],
    { classification: "bound-build-output" }
  >;
} {
  if (
    expected.buildArtifacts.classification !== "bound-build-output" ||
    expected.baseImage.manifestDigest !== base.manifestDigest ||
    expected.baseImage.configDigest !== base.configDigest
  ) {
    refuse();
  }
  const fileDigest = hexDigest(bundle);
  if (
    expected.buildArtifacts.count !== 1 ||
    expected.buildArtifacts.files[0]?.bytes !== bundle.length ||
    expected.buildArtifacts.files[0]?.digest !== fileDigest
  ) {
    refuse();
  }
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    refuse();
  }
  return expected as ApiContainerProvenance & {
    buildArtifacts: Extract<
      ApiContainerProvenance["buildArtifacts"],
      { classification: "bound-build-output" }
    >;
  };
}

function validateProductionPackages(
  files: ReadonlyMap<string, Buffer>,
  expected: ApiContainerProvenance["productionComponents"]["components"],
): void {
  const actual = [...files.entries()]
    .filter(([path]) => isPackageManifestPath(path))
    .map(([, contents]) => {
      const manifest = record(parseJson(contents));
      if (
        typeof manifest.name !== "string" ||
        manifest.name.length === 0 ||
        manifest.name.length > 214 ||
        typeof manifest.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
      ) {
        refuse();
      }
      return `${manifest.name}\0${manifest.version}`;
    })
    .sort();
  const required = expected
    .map(({ name, version }) => `${name}\0${version}`)
    .sort();
  if (!equal(actual, required)) {
    refuse();
  }
}

function isPackageManifestPath(path: string): boolean {
  if (
    !path.startsWith("app/node_modules/") ||
    !path.endsWith("/package.json")
  ) {
    return false;
  }
  const parts = path.slice("app/node_modules/".length, -"/package.json".length)
    .split("/");
  let offset = 0;
  while (offset < parts.length) {
    if (parts[offset]?.startsWith("@")) {
      if (!parts[offset + 1]) {
        return false;
      }
      offset += 2;
    } else {
      offset += 1;
    }
    if (offset === parts.length) {
      return true;
    }
    if (parts[offset] !== "node_modules") {
      return false;
    }
    offset += 1;
  }
  return false;
}

function parsePaxPath(value: Buffer): string | undefined {
  let offset = 0;
  let path: string | undefined;
  while (offset < value.length) {
    const space = value.indexOf(0x20, offset);
    const length = Number(value.subarray(offset, space).toString("ascii"));
    if (space <= offset || !Number.isSafeInteger(length) || length <= 0) {
      refuse();
    }
    const end = offset + length;
    if (end > value.length || value[end - 1] !== 0x0a) {
      refuse();
    }
    const recordText = value.subarray(space + 1, end - 1).toString("utf8");
    const equals = recordText.indexOf("=");
    const key = recordText.slice(0, equals);
    const recordValue = recordText.slice(equals + 1);
    const safeOverlayOrigin =
      key === "SCHILY.xattr.user.overlay.origin" && recordValue === "";
    if (
      equals <= 0 ||
      (
        !safeOverlayOrigin &&
        !["atime", "ctime", "mtime", "path"].includes(key)
      )
    ) {
      refuse();
    }
    if (key === "path") {
      path = recordValue;
    }
    offset = end;
  }
  return path;
}

function normalizeTarPath(value: string): string {
  const path = value.replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    refuse();
  }
  return path;
}

function readOctal(value: Buffer): number {
  const text = tarText(value).trim();
  if (!/^[0-7]+$/u.test(text)) {
    refuse();
  }
  const number = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(number) || number < 0) {
    refuse();
  }
  return number;
}

function tarText(value: Buffer): string {
  const end = value.indexOf(0);
  return value.subarray(0, end < 0 ? value.length : end).toString("utf8");
}

function parseJson(value: Uint8Array): unknown {
  if (value.byteLength === 0 || value.byteLength > 64 * 1024) {
    refuse();
  }
  return JSON.parse(Buffer.from(value).toString("utf8"));
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse();
  }
  return value as Record<string, unknown>;
}

function equal(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function digest(value: string | Uint8Array): string {
  return `sha256:${hexDigest(value)}`;
}

function hexDigest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function refuse(): never {
  throw new ApiContainerDeploymentProvenanceError();
}
