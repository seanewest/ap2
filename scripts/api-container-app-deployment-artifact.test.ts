// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApiContainerAppDeploymentInput,
  compileApiContainerAppDeploymentArtifact,
  validateApiContainerAppDeploymentArtifact,
} from "./api-container-app-deployment-artifact.js";
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function deploymentInput(): ApiContainerAppDeploymentInput {
  return {
    schemaVersion: 1,
    targetResourceId: REHEARSAL_CONTAINER_APP_RESOURCE_ID,
    location: "eastus",
    managedEnvironmentResourceId:
      `/subscriptions/${syntheticSubscription}/resourceGroups/rg-ap2-example` +
      "/providers/Microsoft.App/managedEnvironments/cae-ap2-example",
    managedIdentity: "system",
    imageReference:
      "example.azurecr.io/ap2-api@sha256:" + "a".repeat(64),
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

describe("API Container Apps deployment artifact compiler", () => {
  it("compiles the exact replica plan into one deterministic declarative artifact", () => {
    const first = compileApiContainerAppDeploymentArtifact(
      replicaPlan,
      deploymentInput(),
    );
    const second = compileApiContainerAppDeploymentArtifact(
      structuredClone(replicaPlan),
      structuredClone(deploymentInput()),
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
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
              image:
                "example.azurecr.io/ap2-api@sha256:" + "a".repeat(64),
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
    expect(validateApiContainerAppDeploymentArtifact(first)).toBe(first);
  });

  it.each([
    ["two replicas", (plan: any) => { plan.maxReplicas = 2; }],
    ["wrong target", (plan: any) => { plan.target = "other-api"; }],
    ["extra plan authority", (plan: any) => { plan.sharedJournalReady = true; }],
  ])("refuses %s before compilation", (_name, mutate) => {
    const plan = structuredClone(replicaPlan);
    mutate(plan);
    expect(() =>
      compileApiContainerAppDeploymentArtifact(plan, deploymentInput())
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
      compileApiContainerAppDeploymentArtifact(replicaPlan, input)
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
  ])("rejects mutated output with %s", (_name, mutate) => {
    const artifact = structuredClone(
      compileApiContainerAppDeploymentArtifact(replicaPlan, deploymentInput()),
    );
    mutate(artifact);
    expect(() =>
      validateApiContainerAppDeploymentArtifact(artifact)
    ).toThrow("API_CONTAINER_APP_DEPLOYMENT_ARTIFACT_REFUSED");
  });

  it("offers only a bounded network-free compiler CLI", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-api-artifact-"));
    temporaryDirectories.push(directory);
    const planPath = join(directory, "plan.json");
    const inputPath = join(directory, "input.json");
    writeFileSync(planPath, JSON.stringify(replicaPlan));
    writeFileSync(inputPath, JSON.stringify(deploymentInput()));

    const result = spawnSync(
      process.execPath,
      [
        "scripts/api-container-app-deployment-artifact.ts",
        planPath,
        inputPath,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(
      compileApiContainerAppDeploymentArtifact(replicaPlan, deploymentInput()),
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
