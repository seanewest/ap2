import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_DEPLOYMENT_REPLICA_CONTRACT,
  parseApiDeploymentReplicaPlan,
} from "../api/api-replica-contract.ts";
import {
  apiContainerAppResourceId,
} from "../api/api-deployment-target.ts";
import {
  createApiContainerProvenance,
} from "./api-container-provenance.ts";
import {
  readApiContainerBaseLock,
} from "./api-container-base.ts";
import {
  applicationLayerDigests,
  createApiContainerDeploymentProvenanceBinding,
  imageConfigDigest,
  validateApiContainerDeploymentProvenanceBinding,
  type ApiContainerDeploymentProvenanceBinding,
  type ApiContainerOciEvidence,
} from "./api-container-deployment-provenance.ts";

const MAX_INPUT_BYTES = 16_384;
const MAX_OCI_DOCUMENT_BYTES = 64 * 1024;
const MAX_OCI_LAYER_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32_768;
const CONTAINER_APP_API_VERSION = "2025-07-01";
const TARGET_PORT = 3_000;
const REQUIRED_SECRET_BINDINGS = [
  ["AUTH_ISSUER", "authIssuer"],
  ["AUTH_AUDIENCE", "authAudience"],
  ["AUTH_JWKS_URL", "authJwksUrl"],
  ["CORS_ALLOWED_ORIGIN", "corsAllowedOrigin"],
] as const;

type SecretBindingKey = (typeof REQUIRED_SECRET_BINDINGS)[number][1];

export interface ApiContainerAppDeploymentInput {
  schemaVersion: 1;
  targetResourceId: string;
  location: string;
  managedEnvironmentResourceId: string;
  managedIdentity: "system";
  imageReference: string;
  registryServer: string;
  secretReferences: Record<
    SecretBindingKey,
    {
      name: string;
      keyVaultUrl: string;
      identity: "system";
    }
  >;
  metadata: {
    markerAlias: string;
    ownerAlias: string;
    plannedAt: string;
    expiresAt: string;
    cost: {
      currency: "USD";
      maximumIncrementalSpend: 0;
      classification: "existing-lab-runtime";
    };
  };
}

export interface ApiContainerAppDeploymentArtifact {
  schemaVersion: 2;
  kind: "ap2-api-container-app-deployment-artifact";
  provenance: ApiContainerDeploymentProvenanceBinding;
  target: typeof API_DEPLOYMENT_REPLICA_CONTRACT.target;
  apiVersion: typeof CONTAINER_APP_API_VERSION;
  resourceId: string;
  body: {
    location: string;
    tags: {
      "ap2-marker": string;
      "ap2-owner": string;
      "ap2-planned-at": string;
      "ap2-expires-at": string;
      "ap2-cost-classification": "existing-lab-runtime";
      "ap2-max-incremental-usd": "0";
    };
    identity: { type: "SystemAssigned" };
    properties: {
      managedEnvironmentId: string;
      configuration: {
        activeRevisionsMode: "Single";
        ingress: {
          external: true;
          allowInsecure: false;
          targetPort: 3000;
          transport: "auto";
        };
        registries: Array<{ server: string; identity: "system" }>;
        secrets: Array<{
          name: string;
          keyVaultUrl: string;
          identity: "system";
        }>;
      };
      template: {
        terminationGracePeriodSeconds: 10;
        containers: Array<{
          name: "api";
          image: string;
          env: Array<{ name: string; secretRef: string }>;
          resources: { cpu: 0.5; memory: "1Gi" };
          probes: Array<{
            type: "Liveness" | "Readiness";
            httpGet: { path: "/health"; port: 3000; scheme: "HTTP" };
            initialDelaySeconds: number;
            periodSeconds: 10;
            timeoutSeconds: 2;
            failureThreshold: 3;
          }>;
        }>;
        scale: { minReplicas: 1; maxReplicas: 1 };
      };
    };
  };
}

export class ApiDeploymentArtifactError extends Error {
  constructor() {
    super("API_CONTAINER_APP_DEPLOYMENT_ARTIFACT_REFUSED");
    this.name = "ApiDeploymentArtifactError";
  }
}

export function compileApiContainerAppDeploymentArtifact(
  replicaPlanValue: unknown,
  inputValue: unknown,
  provenanceEvidence: ApiContainerOciEvidence,
): ApiContainerAppDeploymentArtifact {
  const replicaPlan = parseApiDeploymentReplicaPlan(replicaPlanValue);
  const input = parseDeploymentInput(inputValue);
  const secrets = REQUIRED_SECRET_BINDINGS.map(([, key]) => ({
    name: input.secretReferences[key].name,
    keyVaultUrl: input.secretReferences[key].keyVaultUrl,
    identity: "system" as const,
  })).sort((left, right) => left.name.localeCompare(right.name));
  const artifact: ApiContainerAppDeploymentArtifact = {
    schemaVersion: 2,
    kind: "ap2-api-container-app-deployment-artifact",
    provenance: createApiContainerDeploymentProvenanceBinding(
      input.imageReference,
      provenanceEvidence,
    ),
    target: replicaPlan.target,
    apiVersion: CONTAINER_APP_API_VERSION,
    resourceId: input.targetResourceId,
    body: {
      location: input.location,
      tags: {
        "ap2-marker": input.metadata.markerAlias,
        "ap2-owner": input.metadata.ownerAlias,
        "ap2-planned-at": input.metadata.plannedAt,
        "ap2-expires-at": input.metadata.expiresAt,
        "ap2-cost-classification": input.metadata.cost.classification,
        "ap2-max-incremental-usd": "0",
      },
      identity: { type: "SystemAssigned" },
      properties: {
        managedEnvironmentId: input.managedEnvironmentResourceId,
        configuration: {
          activeRevisionsMode: "Single",
          ingress: {
            external: true,
            allowInsecure: false,
            targetPort: TARGET_PORT,
            transport: "auto",
          },
          registries: [{ server: input.registryServer, identity: "system" }],
          secrets,
        },
        template: {
          terminationGracePeriodSeconds: 10,
          containers: [{
            name: "api",
            image: input.imageReference,
            env: REQUIRED_SECRET_BINDINGS.map(([name, key]) => ({
              name,
              secretRef: input.secretReferences[key].name,
            })),
            resources: { cpu: 0.5, memory: "1Gi" },
            probes: [
              {
                type: "Liveness",
                httpGet: { path: "/health", port: TARGET_PORT, scheme: "HTTP" },
                initialDelaySeconds: 10,
                periodSeconds: 10,
                timeoutSeconds: 2,
                failureThreshold: 3,
              },
              {
                type: "Readiness",
                httpGet: { path: "/health", port: TARGET_PORT, scheme: "HTTP" },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                timeoutSeconds: 2,
                failureThreshold: 3,
              },
            ],
          }],
          scale: {
            minReplicas: replicaPlan.minReplicas,
            maxReplicas: replicaPlan.maxReplicas,
          },
        },
      },
    },
  };
  return validateApiContainerAppDeploymentArtifact(
    artifact,
    provenanceEvidence,
  );
}

export function validateApiContainerAppDeploymentArtifact(
  value: unknown,
  provenanceEvidence: ApiContainerOciEvidence,
): ApiContainerAppDeploymentArtifact {
  try {
    const artifact = requireRecord(value);
    exactKeys(artifact, [
      "apiVersion",
      "body",
      "kind",
      "provenance",
      "resourceId",
      "schemaVersion",
      "target",
    ]);
    if (
      artifact.schemaVersion !== 2 ||
      artifact.kind !== "ap2-api-container-app-deployment-artifact" ||
      artifact.target !== API_DEPLOYMENT_REPLICA_CONTRACT.target ||
      artifact.apiVersion !== CONTAINER_APP_API_VERSION
    ) {
      refuse();
    }
    const body = requireRecord(artifact.body);
    exactKeys(body, ["identity", "location", "properties", "tags"]);
    requireLocation(body.location);
    const artifactImage = requireRecord(
      requireArray(
        requireRecord(requireRecord(body.properties).template).containers,
        1,
      )[0],
    ).image;
    if (typeof artifactImage !== "string") {
      refuse();
    }
    validateApiContainerDeploymentProvenanceBinding(
      artifact.provenance,
      artifactImage,
      provenanceEvidence,
    );
    const targetScope = parseResourceId(
      artifact.resourceId,
      "Microsoft.App",
      "containerApps",
      API_DEPLOYMENT_REPLICA_CONTRACT.target,
    );
    if (
      artifact.resourceId !==
        apiContainerAppResourceId(API_DEPLOYMENT_REPLICA_CONTRACT.target)
    ) {
      refuse();
    }
    const tags = requireRecord(body.tags);
    exactKeys(tags, [
      "ap2-cost-classification",
      "ap2-expires-at",
      "ap2-marker",
      "ap2-max-incremental-usd",
      "ap2-owner",
      "ap2-planned-at",
    ]);
    requireAlias(tags["ap2-marker"]);
    requireAlias(tags["ap2-owner"]);
    requireUtc(tags["ap2-planned-at"]);
    requireUtc(tags["ap2-expires-at"]);
    requireExpiryWindow(
      tags["ap2-planned-at"] as string,
      tags["ap2-expires-at"] as string,
    );
    if (
      tags["ap2-cost-classification"] !== "existing-lab-runtime" ||
      tags["ap2-max-incremental-usd"] !== "0"
    ) {
      refuse();
    }
    const identity = requireRecord(body.identity);
    exactKeys(identity, ["type"]);
    if (identity.type !== "SystemAssigned") {
      refuse();
    }
    const properties = requireRecord(body.properties);
    exactKeys(properties, ["configuration", "managedEnvironmentId", "template"]);
    const environmentScope = parseResourceId(
      properties.managedEnvironmentId,
      "Microsoft.App",
      "managedEnvironments",
    );
    if (targetScope.subscriptionId !== environmentScope.subscriptionId) {
      refuse();
    }
    const configurationContract = validateConfiguration(
      properties.configuration,
    );
    validateTemplate(
      properties.template,
      configurationContract.registry,
      configurationContract.secretNames,
    );
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) {
      refuse();
    }
    return value as ApiContainerAppDeploymentArtifact;
  } catch {
    refuse();
  }
}

function parseDeploymentInput(value: unknown): ApiContainerAppDeploymentInput {
  try {
    const input = requireRecord(value);
    exactKeys(input, [
      "imageReference",
      "location",
      "managedEnvironmentResourceId",
      "managedIdentity",
      "metadata",
      "registryServer",
      "schemaVersion",
      "secretReferences",
      "targetResourceId",
    ]);
    if (input.schemaVersion !== 1 || input.managedIdentity !== "system") {
      refuse();
    }
    const targetScope = parseResourceId(
      input.targetResourceId,
      "Microsoft.App",
      "containerApps",
      API_DEPLOYMENT_REPLICA_CONTRACT.target,
    );
    if (
      input.targetResourceId !==
        apiContainerAppResourceId(API_DEPLOYMENT_REPLICA_CONTRACT.target)
    ) {
      refuse();
    }
    const environmentScope = parseResourceId(
      input.managedEnvironmentResourceId,
      "Microsoft.App",
      "managedEnvironments",
    );
    if (targetScope.subscriptionId !== environmentScope.subscriptionId) {
      refuse();
    }
    requireLocation(input.location);
    requireRegistryServer(input.registryServer);
    requireImageReference(input.imageReference, input.registryServer);
    const secretReferences = requireRecord(input.secretReferences);
    exactKeys(secretReferences, REQUIRED_SECRET_BINDINGS.map(([, key]) => key));
    for (const [, key] of REQUIRED_SECRET_BINDINGS) {
      const secret = requireRecord(secretReferences[key]);
      exactKeys(secret, ["identity", "keyVaultUrl", "name"]);
      requireSecretName(secret.name);
      requireKeyVaultSecretUrl(secret.keyVaultUrl, secret.name as string);
      if (secret.identity !== "system") {
        refuse();
      }
    }
    const secretNames = REQUIRED_SECRET_BINDINGS.map(([, key]) =>
      requireRecord(secretReferences[key]).name
    );
    const secretUrls = REQUIRED_SECRET_BINDINGS.map(([, key]) =>
      requireRecord(secretReferences[key]).keyVaultUrl
    );
    if (
      new Set(secretNames).size !== secretNames.length ||
      new Set(secretUrls).size !== secretUrls.length
    ) {
      refuse();
    }
    const metadata = requireRecord(input.metadata);
    exactKeys(metadata, [
      "cost",
      "expiresAt",
      "markerAlias",
      "ownerAlias",
      "plannedAt",
    ]);
    requireAlias(metadata.markerAlias);
    requireAlias(metadata.ownerAlias);
    requireUtc(metadata.plannedAt);
    requireUtc(metadata.expiresAt);
    requireExpiryWindow(
      metadata.plannedAt as string,
      metadata.expiresAt as string,
    );
    const cost = requireRecord(metadata.cost);
    exactKeys(cost, [
      "classification",
      "currency",
      "maximumIncrementalSpend",
    ]);
    if (
      cost.currency !== "USD" ||
      cost.maximumIncrementalSpend !== 0 ||
      cost.classification !== "existing-lab-runtime"
    ) {
      refuse();
    }
    return value as ApiContainerAppDeploymentInput;
  } catch {
    refuse();
  }
}

function validateConfiguration(value: unknown): {
  registry: string;
  secretNames: string[];
} {
  const configuration = requireRecord(value);
  exactKeys(configuration, [
    "activeRevisionsMode",
    "ingress",
    "registries",
    "secrets",
  ]);
  if (configuration.activeRevisionsMode !== "Single") {
    refuse();
  }
  const ingress = requireRecord(configuration.ingress);
  exactKeys(ingress, [
    "allowInsecure",
    "external",
    "targetPort",
    "transport",
  ]);
  if (
    ingress.external !== true ||
    ingress.allowInsecure !== false ||
    ingress.targetPort !== TARGET_PORT ||
    ingress.transport !== "auto"
  ) {
    refuse();
  }
  const registries = requireArray(configuration.registries, 1);
  const registry = requireRecord(registries[0]);
  exactKeys(registry, ["identity", "server"]);
  requireRegistryServer(registry.server);
  if (registry.identity !== "system") {
    refuse();
  }
  const secrets = requireArray(configuration.secrets, REQUIRED_SECRET_BINDINGS.length);
  const names = new Set<string>();
  const urls = new Set<string>();
  let previousName = "";
  for (const value of secrets) {
    const secret = requireRecord(value);
    exactKeys(secret, ["identity", "keyVaultUrl", "name"]);
    requireSecretName(secret.name);
    requireKeyVaultSecretUrl(secret.keyVaultUrl, secret.name as string);
    if (
      secret.identity !== "system" ||
      names.has(secret.name as string) ||
      urls.has(secret.keyVaultUrl as string) ||
      (previousName !== "" &&
        previousName.localeCompare(secret.name as string) >= 0)
    ) {
      refuse();
    }
    names.add(secret.name as string);
    urls.add(secret.keyVaultUrl as string);
    previousName = secret.name as string;
  }
  return {
    registry: registry.server as string,
    secretNames: [...names],
  };
}

function validateTemplate(
  value: unknown,
  registry: string,
  secretNames: string[],
): void {
  const template = requireRecord(value);
  exactKeys(template, [
    "containers",
    "scale",
    "terminationGracePeriodSeconds",
  ]);
  if (template.terminationGracePeriodSeconds !== 10) {
    refuse();
  }
  const scale = requireRecord(template.scale);
  exactKeys(scale, ["maxReplicas", "minReplicas"]);
  parseApiDeploymentReplicaPlan({
    schemaVersion: 1,
    target: API_DEPLOYMENT_REPLICA_CONTRACT.target,
    minReplicas: scale.minReplicas,
    maxReplicas: scale.maxReplicas,
  });
  const containers = requireArray(template.containers, 1);
  const container = requireRecord(containers[0]);
  exactKeys(container, ["env", "image", "name", "probes", "resources"]);
  if (container.name !== "api") {
    refuse();
  }
  requireImageReference(container.image, registry);
  const env = requireArray(container.env, REQUIRED_SECRET_BINDINGS.length);
  for (const [index, [name]] of REQUIRED_SECRET_BINDINGS.entries()) {
    const binding = requireRecord(env[index]);
    exactKeys(binding, ["name", "secretRef"]);
    if (binding.name !== name) {
      refuse();
    }
    requireSecretName(binding.secretRef);
    if (
      !secretNames.includes(binding.secretRef as string) ||
      env.slice(0, index).some(
        (previous) =>
          requireRecord(previous).secretRef === binding.secretRef,
      )
    ) {
      refuse();
    }
  }
  const resources = requireRecord(container.resources);
  exactKeys(resources, ["cpu", "memory"]);
  if (resources.cpu !== 0.5 || resources.memory !== "1Gi") {
    refuse();
  }
  const probes = requireArray(container.probes, 2);
  validateProbe(probes[0], "Liveness", 10);
  validateProbe(probes[1], "Readiness", 5);
}

function validateProbe(
  value: unknown,
  type: "Liveness" | "Readiness",
  initialDelaySeconds: number,
): void {
  const probe = requireRecord(value);
  exactKeys(probe, [
    "failureThreshold",
    "httpGet",
    "initialDelaySeconds",
    "periodSeconds",
    "timeoutSeconds",
    "type",
  ]);
  const httpGet = requireRecord(probe.httpGet);
  exactKeys(httpGet, ["path", "port", "scheme"]);
  if (
    probe.type !== type ||
    probe.initialDelaySeconds !== initialDelaySeconds ||
    probe.periodSeconds !== 10 ||
    probe.timeoutSeconds !== 2 ||
    probe.failureThreshold !== 3 ||
    httpGet.path !== "/health" ||
    httpGet.port !== TARGET_PORT ||
    httpGet.scheme !== "HTTP"
  ) {
    refuse();
  }
}

function parseResourceId(
  value: unknown,
  provider: string,
  type: string,
  exactName?: string,
): { subscriptionId: string; resourceGroup: string; name: string } {
  if (typeof value !== "string" || value.length > 512) {
    refuse();
  }
  const match = value.match(
    /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/resourceGroups\/([a-zA-Z0-9._()-]{1,90})\/providers\/([A-Za-z.]{1,64})\/([A-Za-z]{1,64})\/([a-zA-Z0-9._()-]{1,64})$/u,
  );
  if (
    !match ||
    match[3]?.toLowerCase() !== provider.toLowerCase() ||
    match[4]?.toLowerCase() !== type.toLowerCase() ||
    (exactName !== undefined && match[5] !== exactName)
  ) {
    refuse();
  }
  return {
    subscriptionId: match[1]!,
    resourceGroup: match[2]!,
    name: match[5]!,
  };
}

function requireImageReference(value: unknown, registry: unknown): void {
  requireRegistryServer(registry);
  if (
    typeof value !== "string" ||
    value.length > 320 ||
    !value.startsWith(`${registry}/`) ||
    !/^[a-z0-9.-]+\.azurecr\.io\/[a-z0-9](?:[a-z0-9._/-]{0,127}[a-z0-9])?@sha256:[0-9a-f]{64}$/u.test(value)
  ) {
    refuse();
  }
}

function requireRegistryServer(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?\.azurecr\.io$/u.test(value)
  ) {
    refuse();
  }
}

function requireKeyVaultSecretUrl(
  value: unknown,
  expectedSecretName: string,
): void {
  if (typeof value !== "string" || value.length > 300) {
    refuse();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    refuse();
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9](?:[a-z0-9-]{1,22}[a-z0-9])?\.vault\.azure\.net$/u.test(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !new RegExp(
      `^/secrets/${escapeRegExp(expectedSecretName)}/[0-9a-f]{32}$`,
      "u",
    ).test(url.pathname)
  ) {
    refuse();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requireAlias(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9-]{2,39}$/u.test(value)
  ) {
    refuse();
  }
}

function requireSecretName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9-]{2,39}$/u.test(value)
  ) {
    refuse();
  }
}

function requireLocation(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z]+(?:[a-z0-9 ]{0,28}[a-z0-9])?$/u.test(value)
  ) {
    refuse();
  }
}

function requireUtc(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    refuse();
  }
}

function requireExpiryWindow(plannedAt: string, expiresAt: string): void {
  const duration = Date.parse(expiresAt) - Date.parse(plannedAt);
  if (duration < 60_000 || duration > 24 * 60 * 60 * 1_000) {
    refuse();
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse();
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, exactLength: number): unknown[] {
  if (!Array.isArray(value) || value.length !== exactLength) {
    refuse();
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    refuse();
  }
}

function refuse(): never {
  throw new ApiDeploymentArtifactError();
}

function readBoundedJson(pathValue: string): unknown {
  const path = realpathSync(pathValue);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_BYTES) {
    refuse();
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    refuse();
  }
}

function readBoundedFile(pathValue: string, maximumBytes: number): Buffer {
  const path = realpathSync(pathValue);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0 || stat.size > maximumBytes) {
    refuse();
  }
  return readFileSync(path);
}

function readOciBlob(
  layoutValue: string,
  digest: string,
  maximumBytes: number,
): Buffer {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    refuse();
  }
  const layout = realpathSync(layoutValue);
  const path = realpathSync(join(layout, "blobs", "sha256", digest.slice(7)));
  if (!path.startsWith(`${layout}${sep}`)) {
    refuse();
  }
  return readBoundedFile(path, maximumBytes);
}

function main(): void {
  if (process.argv.length !== 5) {
    refuse();
  }
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const input = readBoundedJson(process.argv[3]!);
  const inputRecord = requireRecord(input);
  if (typeof inputRecord.imageReference !== "string") {
    refuse();
  }
  const imageDigest = inputRecord.imageReference.match(
    /@(sha256:[0-9a-f]{64})$/u,
  )?.[1];
  if (!imageDigest) {
    refuse();
  }
  const baseLock = readApiContainerBaseLock(repositoryRoot);
  const imageManifest = readOciBlob(
    process.argv[4]!,
    imageDigest,
    MAX_OCI_DOCUMENT_BYTES,
  );
  const imageConfig = readOciBlob(
    process.argv[4]!,
    imageConfigDigest(imageManifest),
    MAX_OCI_DOCUMENT_BYTES,
  );
  const layers = applicationLayerDigests(
    imageManifest,
    baseLock.rootfsDiffIds.length,
  ).map((digest) =>
    readOciBlob(process.argv[4]!, digest, MAX_OCI_LAYER_BYTES)
  );
  const provenanceEvidence: ApiContainerOciEvidence = {
    applicationLayers: layers,
    baseLock,
    imageConfig,
    imageManifest,
    repositoryProvenance: createApiContainerProvenance(repositoryRoot, {
      bindBuildArtifacts: true,
    }),
  };
  const artifact = compileApiContainerAppDeploymentArtifact(
    readBoundedJson(process.argv[2]!),
    input,
    provenanceEvidence,
  );
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch {
    process.stderr.write("API deployment artifact refused.\n");
    process.exitCode = 1;
  }
}
