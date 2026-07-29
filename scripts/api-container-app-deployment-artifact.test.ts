// @vitest-environment node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApiContainerAppDeploymentInput,
  compileApiContainerAppDeploymentArtifact,
  validateApiContainerAppDeploymentArtifact,
} from "./api-container-app-deployment-artifact.js";
import {
  createApiContainerProvenance,
  serializeApiContainerProvenance,
} from "./api-container-provenance.ts";
import { readApiContainerBaseLock } from "./api-container-base.ts";
import type { ApiContainerOciEvidence } from "./api-container-deployment-provenance.ts";
import {
  REHEARSAL_CONTAINER_APP_RESOURCE_ID,
  REHEARSAL_SUBSCRIPTION_ID,
} from "../api/rehearsal-status.js";

const syntheticSubscription = REHEARSAL_SUBSCRIPTION_ID;
const replicaPlan = {
  schemaVersion: 1,
  target: "ca-ap2-api",
  minReplicas: 1,
  maxReplicas: 1,
};
const temporaryDirectories: string[] = [];
const fixtureEvidence = createOciEvidence();
const fixtureImageReference =
  `example.azurecr.io/ap2-api@${digest(fixtureEvidence.imageManifest)}`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function deploymentInput(
  imageReference = fixtureImageReference,
): ApiContainerAppDeploymentInput {
  return {
    schemaVersion: 1,
    targetResourceId: REHEARSAL_CONTAINER_APP_RESOURCE_ID,
    location: "eastus",
    managedEnvironmentResourceId:
      `/subscriptions/${syntheticSubscription}/resourceGroups/rg-ap2-example` +
      "/providers/Microsoft.App/managedEnvironments/cae-ap2-example",
    managedIdentity: "system",
    imageReference,
    registryServer: "example.azurecr.io",
    secretReferences: {
      authIssuer: secret("auth-issuer", "a"),
      authAudience: secret("auth-audience", "b"),
      authJwksUrl: secret("auth-jwks-url", "c"),
      corsAllowedOrigin: secret("cors-allowed-origin", "d"),
    },
    metadata: {
      markerAlias: "ap2-api-example",
      ownerAlias: "api-operators",
      plannedAt: "2026-12-31T23:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      cost: {
        currency: "USD",
        maximumIncrementalSpend: 0,
        classification: "existing-lab-runtime",
      },
    },
  };
}

function secret(name: string, version: string) {
  return {
    name,
    keyVaultUrl:
      `https://example-vault.vault.azure.net/secrets/${name}/` +
      version.repeat(32),
    identity: "system" as const,
  };
}

function compileArtifact(
  plan: unknown = replicaPlan,
  input: unknown = deploymentInput(),
  evidence: ApiContainerOciEvidence = fixtureEvidence,
) {
  return compileApiContainerAppDeploymentArtifact(plan, input, evidence);
}

function createOciEvidence(
  bundle = Buffer.from("export const apiBundle = 'fixture';\n"),
  expectedProvenance = createApiContainerProvenance(process.cwd()),
): ApiContainerOciEvidence {
  const baseLock = readApiContainerBaseLock(process.cwd());
  const fileDigest = hexDigest(bundle);
  const builtProvenance = structuredClone(expectedProvenance);
  builtProvenance.buildArtifacts = {
    classification: "bound-build-output",
    count: 1,
    digest: hexDigest(
      `dist-api/index.js\0${bundle.length}\0${fileDigest}\n`,
    ),
    files: [{
      bytes: bundle.length,
      digest: fileDigest,
      path: "dist-api/index.js",
    }],
  };
  const uncompressedLayers = [
    tarFile("app/dist-api/index.js", bundle),
    tarFiles(
      builtProvenance.productionComponents.components.map(
        ({ name, version }) => ({
          path: `app/node_modules/${name}/package.json`,
          contents: Buffer.from(JSON.stringify({ name, version })),
        }),
      ),
    ),
    tarFile(
      "app/container-provenance.json",
      Buffer.from(serializeApiContainerProvenance(builtProvenance)),
    ),
  ];
  const applicationLayers = uncompressedLayers.map((layer) => gzipSync(layer));
  const imageConfig = Buffer.from(JSON.stringify({
    architecture: "amd64",
    os: "linux",
    rootfs: {
      type: "layers",
      diff_ids: [
        ...baseLock.rootfsDiffIds,
        ...uncompressedLayers.map(digest),
      ],
    },
  }));
  const imageManifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      size: imageConfig.length,
      digest: digest(imageConfig),
    },
    layers: [
      ...baseLock.layerDescriptors,
      ...applicationLayers.map((layer) => ({
        mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        size: layer.length,
        digest: digest(layer),
      })),
    ],
  }));
  return {
    applicationLayers,
    baseLock,
    imageConfig,
    imageManifest,
    repositoryProvenance: builtProvenance,
  };
}

function tarFile(path: string, contents: Buffer): Buffer {
  return tarFiles([{ path, contents }]);
}

function tarFiles(
  files: Array<{ contents: Buffer; path: string }>,
): Buffer {
  const records: Buffer[] = [];
  for (const { path, contents } of files) {
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, "utf8");
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, contents.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    const paddedContents = Buffer.alloc(
      Math.ceil(contents.length / 512) * 512,
    );
    contents.copy(paddedContents);
    records.push(header, paddedContents);
  }
  return Buffer.concat([...records, Buffer.alloc(1024)]);
}

function writeOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  target.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1);
}

function digest(value: string | Uint8Array): string {
  return `sha256:${hexDigest(value)}`;
}

function hexDigest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeOciLayout(root: string, evidence: ApiContainerOciEvidence): void {
  const blobRoot = join(root, "blobs", "sha256");
  mkdirSync(blobRoot, { recursive: true });
  for (const value of [
    evidence.imageManifest,
    evidence.imageConfig,
    ...evidence.applicationLayers,
  ]) {
    writeFileSync(join(blobRoot, digest(value).slice(7)), value);
  }
}

describe("API Container Apps deployment artifact compiler", () => {
  it("compiles the exact replica plan into one deterministic declarative artifact", () => {
    const first = compileArtifact();
    const second = compileArtifact(
      structuredClone(replicaPlan),
      structuredClone(deploymentInput()),
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 2,
      kind: "ap2-api-container-app-deployment-artifact",
      target: "ca-ap2-api",
      apiVersion: "2025-07-01",
      body: {
        identity: { type: "SystemAssigned" },
        properties: {
          configuration: {
            activeRevisionsMode: "Single",
            ingress: {
              external: true,
              allowInsecure: false,
              targetPort: 3000,
            },
          },
          template: {
            terminationGracePeriodSeconds: 10,
            scale: { minReplicas: 1, maxReplicas: 1 },
            containers: [{
              name: "api",
              image: fixtureImageReference,
              resources: { cpu: 0.5, memory: "1Gi" },
            }],
          },
        },
      },
    });
    expect(first.body.properties.configuration.secrets).toHaveLength(4);
    expect(
      first.body.properties.configuration.secrets.every(
        (value) =>
          !Object.hasOwn(value, "value") &&
          value.identity === "system" &&
          value.keyVaultUrl.startsWith("https://"),
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain("secretValue");
    expect(
      validateApiContainerAppDeploymentArtifact(first, fixtureEvidence),
    ).toBe(first);
  });

  it.each([
    ["different immutable image", () => ({
      input: deploymentInput(
        `example.azurecr.io/ap2-api@sha256:${"f".repeat(64)}`,
      ),
      evidence: fixtureEvidence,
    })],
    ["tampered manifest", () => ({
      input: deploymentInput(),
      evidence: {
        ...fixtureEvidence,
        imageManifest: Buffer.concat([
          Buffer.from(fixtureEvidence.imageManifest),
          Buffer.from(" "),
        ]),
      },
    })],
    ["tampered config", () => ({
      input: deploymentInput(),
      evidence: {
        ...fixtureEvidence,
        imageConfig: Buffer.from("{}"),
      },
    })],
    ["wrong base rootfs", () => {
      const evidence = structuredClone(fixtureEvidence);
      evidence.baseLock.rootfsDiffIds[0] = `sha256:${"f".repeat(64)}`;
      return { input: deploymentInput(), evidence };
    }],
    ["wrong base layer descriptor", () => {
      const evidence = structuredClone(fixtureEvidence);
      const manifest = JSON.parse(
        Buffer.from(evidence.imageManifest).toString("utf8"),
      ) as { layers: Array<{ digest: string }> };
      manifest.layers[0]!.digest = `sha256:${"f".repeat(64)}`;
      evidence.imageManifest = Buffer.from(JSON.stringify(manifest));
      return {
        input: deploymentInput(
          `example.azurecr.io/ap2-api@${digest(evidence.imageManifest)}`,
        ),
        evidence,
      };
    }],
    ["tampered application layer", () => ({
      input: deploymentInput(),
      evidence: {
        ...fixtureEvidence,
        applicationLayers: [
          Buffer.from("tampered"),
          ...fixtureEvidence.applicationLayers.slice(1),
        ],
      },
    })],
    ["missing application layer", () => ({
      input: deploymentInput(),
      evidence: {
        ...fixtureEvidence,
        applicationLayers: [fixtureEvidence.applicationLayers[0]!],
      },
    })],
    ["reordered application layers", () => ({
      input: deploymentInput(),
      evidence: {
        ...fixtureEvidence,
        applicationLayers: [
          fixtureEvidence.applicationLayers[1]!,
          fixtureEvidence.applicationLayers[0]!,
          fixtureEvidence.applicationLayers[2]!,
        ],
      },
    })],
    ["stale repository provenance", () => {
      const evidence = structuredClone(fixtureEvidence);
      evidence.repositoryProvenance.buildInputs.digest = "f".repeat(64);
      return { input: deploymentInput(), evidence };
    }],
  ])("refuses %s provenance before emitting an artifact", (_name, fixture) => {
    const { input, evidence } = fixture();
    expect(() => compileArtifact(replicaPlan, input, evidence)).toThrow(
      "API_CONTAINER_DEPLOYMENT_PROVENANCE_REFUSED",
    );
  });

  it.each([
    ["two replicas", (plan: any) => { plan.maxReplicas = 2; }],
    ["wrong target", (plan: any) => { plan.target = "other-api"; }],
    ["extra plan authority", (plan: any) => { plan.sharedJournalReady = true; }],
  ])("refuses %s before compilation", (_name, mutate) => {
    const plan = structuredClone(replicaPlan);
    mutate(plan);
    expect(() =>
      compileArtifact(plan)
    ).toThrow("required single-replica shape");
  });

  it.each([
    ["missing input", (input: any) => { delete input.location; }],
    ["extra input", (input: any) => { input.execute = true; }],
    ["wrong app", (input: any) => {
      input.targetResourceId = input.targetResourceId.replace(
        "ca-ap2-api",
        "other-api",
      );
    }],
    ["wrong subscription", (input: any) => {
      input.targetResourceId = input.targetResourceId.replace(
        syntheticSubscription,
        "22222222-2222-4222-8222-222222222222",
      );
    }],
    ["wrong resource group", (input: any) => {
      input.targetResourceId = input.targetResourceId.replace(
        "rg-ap2-rehearsal",
        "rg-ap2-other",
      );
    }],
    ["mutable image tag", (input: any) => {
      input.imageReference = "example.azurecr.io/ap2-api:latest";
    }],
    ["registry drift", (input: any) => {
      input.registryServer = "other.azurecr.io";
    }],
    ["cross-subscription environment", (input: any) => {
      input.managedEnvironmentResourceId =
        input.managedEnvironmentResourceId.replace(
          syntheticSubscription,
          "22222222-2222-4222-8222-222222222222",
        );
    }],
    ["non-system identity", (input: any) => {
      input.managedIdentity = "user";
    }],
    ["secret value", (input: any) => {
      input.secretReferences.authIssuer.value = "not-allowed";
    }],
    ["unversioned secret", (input: any) => {
      input.secretReferences.authIssuer.keyVaultUrl =
        "https://example-vault.vault.azure.net/secrets/auth-issuer";
    }],
    ["mismatched secret reference", (input: any) => {
      input.secretReferences.authIssuer.keyVaultUrl =
        "https://example-vault.vault.azure.net/secrets/other-secret/" +
        "a".repeat(32);
    }],
    ["duplicate secret name", (input: any) => {
      input.secretReferences.authAudience.name =
        input.secretReferences.authIssuer.name;
    }],
    ["duplicate secret URL", (input: any) => {
      input.secretReferences.authAudience.keyVaultUrl =
        input.secretReferences.authIssuer.keyVaultUrl;
      input.secretReferences.authAudience.name =
        input.secretReferences.authIssuer.name;
    }],
    ["nonzero cost", (input: any) => {
      input.metadata.cost.maximumIncrementalSpend = 1;
    }],
    ["unsafe marker", (input: any) => {
      input.metadata.markerAlias = "/private/path";
    }],
    ["timestamp offset", (input: any) => {
      input.metadata.expiresAt = "2027-01-01T00:00:00-05:00";
    }],
    ["unbounded expiry", (input: any) => {
      input.metadata.expiresAt = "2027-01-02T00:00:00.000Z";
    }],
  ])("refuses deployment input with %s", (_name, mutate) => {
    const input = structuredClone(deploymentInput());
    mutate(input);
    expect(() =>
      compileArtifact(replicaPlan, input)
    ).toThrow("API_CONTAINER_APP_DEPLOYMENT_ARTIFACT_REFUSED");
  });

  it.each([
    ["extra field", (artifact: any) => { artifact.execute = true; }],
    ["scale drift", (artifact: any) => {
      artifact.body.properties.template.scale.maxReplicas = 2;
    }],
    ["TLS weakening", (artifact: any) => {
      artifact.body.properties.configuration.ingress.allowInsecure = true;
    }],
    ["port drift", (artifact: any) => {
      artifact.body.properties.configuration.ingress.targetPort = 8080;
    }],
    ["health drift", (artifact: any) => {
      artifact.body.properties.template.containers[0].probes[1].httpGet.path =
        "/ready";
    }],
    ["resource drift", (artifact: any) => {
      artifact.body.properties.template.containers[0].resources.cpu = 1;
    }],
    ["mutable image", (artifact: any) => {
      artifact.body.properties.template.containers[0].image =
        "example.azurecr.io/ap2-api:latest";
    }],
    ["literal secret", (artifact: any) => {
      artifact.body.properties.configuration.secrets[0].value = "unsafe";
    }],
    ["environment reorder", (artifact: any) => {
      artifact.body.properties.template.containers[0].env.reverse();
    }],
    ["secret reorder", (artifact: any) => {
      artifact.body.properties.configuration.secrets.reverse();
    }],
    ["cost overclaim", (artifact: any) => {
      artifact.body.tags["ap2-max-incremental-usd"] = "1";
    }],
    ["expiry drift", (artifact: any) => {
      artifact.body.tags["ap2-expires-at"] = "2027-01-02T00:00:00.000Z";
    }],
    ["provenance drift", (artifact: any) => {
      artifact.provenance.imageDigest = `sha256:${"f".repeat(64)}`;
    }],
  ])("rejects mutated output with %s", (_name, mutate) => {
    const artifact = structuredClone(
      compileArtifact(),
    );
    mutate(artifact);
    expect(() =>
      validateApiContainerAppDeploymentArtifact(artifact, fixtureEvidence)
    ).toThrow("API_CONTAINER_APP_DEPLOYMENT_ARTIFACT_REFUSED");
  });

  it("offers only a bounded network-free compiler CLI", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-api-artifact-"));
    temporaryDirectories.push(directory);
    const planPath = join(directory, "plan.json");
    const inputPath = join(directory, "input.json");
    const layoutPath = join(directory, "oci-layout");
    const build = spawnSync("npm", ["run", "build:api"], {
      encoding: "utf8",
    });
    expect(build.status).toBe(0);
    rmSync("dist-api/index.js.map", { force: true });
    const cliEvidence = createOciEvidence(
      readFileSync("dist-api/index.js"),
      createApiContainerProvenance(process.cwd(), {
        bindBuildArtifacts: true,
      }),
    );
    const cliInput = deploymentInput(
      `example.azurecr.io/ap2-api@${digest(cliEvidence.imageManifest)}`,
    );
    writeFileSync(planPath, JSON.stringify(replicaPlan));
    writeFileSync(inputPath, JSON.stringify(cliInput));
    writeOciLayout(layoutPath, cliEvidence);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/api-container-app-deployment-artifact.ts",
        planPath,
        inputPath,
        layoutPath,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(
      compileArtifact(replicaPlan, cliInput, cliEvidence),
    );

    const refused = spawnSync(
      process.execPath,
      ["scripts/api-container-app-deployment-artifact.ts", inputPath],
      { encoding: "utf8" },
    );
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr.trim()).toBe("API deployment artifact refused.");
  });
});
