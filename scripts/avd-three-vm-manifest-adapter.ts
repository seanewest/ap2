import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "../src/scenarios/scenario-manifest.ts";
import type {
  ScenarioAdapterCapabilityDeclaration,
} from "../src/scenarios/scenario-surface-capability.ts";
import {
  REQUIRED_TEMPORARY_ROLES,
  buildFrozenLabPlan,
  type FrozenLabPlan,
  type LabScenario,
} from "./avd-three-vm-runner.ts";

const EXPECTED_SCENARIO_ID = "avd-three-vm-substrate";
export const AVD_MANIFEST_ADAPTER_CAPABILITY = {
  schemaVersion: 1,
  adapter: "avd-manifest",
  scenarioId: EXPECTED_SCENARIO_ID,
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioAdapterCapabilityDeclaration;
const SAFE_ALIAS = /^[a-z][a-z0-9-]{2,63}$/;
const RAW_GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const RAW_UPN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PRIVATE_PATH = /(?:\/(?:home|Users|mnt\/c)\/|[A-Z]:\\)/i;
const FORBIDDEN_FIELD =
  /^(?:accessToken|refreshToken|idToken|token|tokens|password|secret|secrets|credential|credentials|certificate|certificates|cookie|browserState|session|sessionState|cache|response|rawResponse|responseBody|requestBody|privatePath)$/i;

const EXPECTED_RESOURCE_KINDS = [
  "avd-personal-host",
  "endpoint-lifecycle",
  "ephemeral-sensitive-artifacts",
  "expiry-schedule",
  "linux-auxiliary-pair",
  "shared-nat-egress",
] as const;

const REQUIRED_SETUP_CAPABILITIES = [
  "azure.three-vm.deploy",
  "endpoint.onboard",
  "expiry.schedule",
  "permission.grant",
  "sensitive-artifacts.prepare",
] as const;

const REQUIRED_CLEANUP_CAPABILITIES = [
  "azure.resource-group.delete",
  "endpoint.offboard",
  "expiry.remove",
  "permission.revoke",
  "sensitive-artifacts.remove",
] as const;

const EXPECTED_SEMANTIC_CLAIMS = [
  "avd-ready",
  "endpoint-managed",
  "endpoint-state-removed",
  "expiry-removed",
  "infrastructure-removed",
  "permissions-revoked",
  "private-three-vm-topology",
  "sensitive-artifacts-absent",
] as const;

export interface AvdManifestRunnerAdapterInput {
  manifest: unknown;
  actorAliases: Readonly<{
    evidenceProducer: string;
    workloadActor: string;
    learner: string;
    responder: string;
  }>;
  scopeAliases: Readonly<{
    tenant: string;
    subscription: string;
  }>;
  timing: Readonly<{
    runMarker: string;
    plannedAt: string;
    readinessObservedAt: string;
    expiryUtc: string;
  }>;
  readiness: Readonly<{
    windowsImage: string;
    linuxImage: string;
    windowsSku: "Standard_D2s_v3";
    linuxSku: "Standard_F1als_v7";
    linuxVmCount: 2;
    availableWindowsVmCount: number;
    availableLinuxVmCount: number;
    vmPublicIpCount: 0;
    explicitOutbound: true;
    sharedNatGatewayCount: 1;
    sharedNatPublicIpCount: 1;
    temporaryPermissionsExact: true;
  }>;
  costBasis: Readonly<{
    boundedDataGb: number;
    diskOperationsPerDisk: number;
  }>;
}

export function compileAvdManifestRunnerPlan(
  input: AvdManifestRunnerAdapterInput,
): FrozenLabPlan {
  assertNoRawRuntimeData(input);
  assertExactKeys(input, [
    "manifest",
    "actorAliases",
    "scopeAliases",
    "timing",
    "readiness",
    "costBasis",
  ], "adapter input");
  assertExactKeys(input.actorAliases, [
    "evidenceProducer",
    "workloadActor",
    "learner",
    "responder",
  ], "actor aliases");
  assertExactKeys(input.scopeAliases, [
    "tenant",
    "subscription",
  ], "scope aliases");
  assertExactKeys(input.timing, [
    "runMarker",
    "plannedAt",
    "readinessObservedAt",
    "expiryUtc",
  ], "timing");
  assertExactKeys(input.readiness, [
    "windowsImage",
    "linuxImage",
    "windowsSku",
    "linuxSku",
    "linuxVmCount",
    "availableWindowsVmCount",
    "availableLinuxVmCount",
    "vmPublicIpCount",
    "explicitOutbound",
    "sharedNatGatewayCount",
    "sharedNatPublicIpCount",
    "temporaryPermissionsExact",
  ], "readiness");
  assertExactKeys(input.costBasis, [
    "boundedDataGb",
    "diskOperationsPerDisk",
  ], "cost basis");

  const manifest = parseScenarioManifest(input.manifest);
  invariant(
    canonicalJson(manifest) === canonicalJson(input.manifest),
    "The manifest is not a canonical validated registry entry.",
  );
  validateManifestBinding(manifest, input);
  validateCallerSnapshot(input);

  const temporaryRoles = manifest.permissions
    .filter((permission) => permission.mode === "temporary")
    .map((permission) => permission.name);
  const scenario: LabScenario = {
    runMarker: input.timing.runMarker,
    tenantId: input.scopeAliases.tenant,
    subscriptionId: input.scopeAliases.subscription,
    learner: input.actorAliases.learner,
    plannedAt: input.timing.plannedAt,
    readinessObservedAt: input.timing.readinessObservedAt,
    expiryUtc: input.timing.expiryUtc,
    learnerWindowHours: 0,
    provisioningAllowanceHours: manifest.cost.conservativeDurationHours,
    laneCeilingUsd: manifest.cost.laneMaximum,
    boundedDataGb: input.costBasis.boundedDataGb,
    diskOperationsPerDisk: input.costBasis.diskOperationsPerDisk,
    cleanupOwner: `owner:${input.timing.runMarker}`,
    temporaryRoles,
    windowsImage: input.readiness.windowsImage,
    linuxImage: input.readiness.linuxImage,
    windowsSku: input.readiness.windowsSku,
    linuxSku: input.readiness.linuxSku,
    linuxVmCount: input.readiness.linuxVmCount,
    availableWindowsVmCount: input.readiness.availableWindowsVmCount,
    availableLinuxVmCount: input.readiness.availableLinuxVmCount,
    vmPublicIpCount: input.readiness.vmPublicIpCount,
    learnerSessionClaimed: false,
  };
  const plan = buildFrozenLabPlan(scenario, {
    expectedTenantId: input.scopeAliases.tenant,
    expectedSubscriptionId: input.scopeAliases.subscription,
    expectedLearner: input.actorAliases.learner,
  });
  validatePlanBinding(plan, manifest, input);
  return plan;
}

function validateManifestBinding(
  manifest: ScenarioManifest,
  input: AvdManifestRunnerAdapterInput,
): void {
  invariant(
    manifest.schemaVersion === 2 && manifest.id === EXPECTED_SCENARIO_ID,
    "The manifest is not the canonical three-VM AVD scenario.",
  );
  const actorById = new Map(manifest.actors.map((actor) => [actor.id, actor]));
  invariant(
    actorById.get(manifest.roles.evidenceProducer)?.kind === "application" &&
      actorById.get(manifest.roles.workloadActor)?.kind === "device" &&
      actorById.get(manifest.roles.learner)?.kind === "human" &&
      manifest.roles.responder === manifest.roles.evidenceProducer &&
      !manifest.authentication.some(
        (authentication) =>
          authentication.actorId === manifest.roles.learner,
      ),
    "The manifest actor roles do not match the lifecycle runner.",
  );
  invariant(
    input.actorAliases.evidenceProducer === input.actorAliases.responder &&
      input.actorAliases.evidenceProducer !== input.actorAliases.learner &&
      input.actorAliases.workloadActor !== input.actorAliases.learner,
    "The sanitized actor aliases collapse distinct scenario roles.",
  );

  const resourceKinds = manifest.resources.map((resource) => resource.kind);
  invariant(
    sameStringSet(resourceKinds, EXPECTED_RESOURCE_KINDS) &&
      resourceKinds.length === EXPECTED_RESOURCE_KINDS.length,
    "The manifest topology resources have drifted from the runner.",
  );
  invariant(
    manifest.resources.every(
      (resource) =>
        resource.ownerActorId === manifest.lifecycle.cleanupOwnerActorId,
    ),
    "A manifest resource is not owned by the cleanup actor.",
  );
  invariant(
    manifest.resources
      .filter((resource) => resource.billable)
      .every((resource) =>
        resource.expiresAt === manifest.lifecycle.expiresAt
      ),
    "Billable resource expiry differs from lifecycle expiry.",
  );
  invariant(
    manifest.prerequisites.some(
      (prerequisite) =>
        prerequisite.kind === "network" &&
        prerequisite.id === "private-network-contract",
    ) &&
      manifest.responseActions.some(
        (action) =>
          action.ownerActorId === manifest.roles.learner &&
          manifest.operations.some(
            (operation) =>
              operation.key === action.operationKey &&
              operation.capability === "learner.inspect" &&
              operation.effect === "read",
          ),
      ),
    "The private network or learner-facing personal desktop role is missing.",
  );

  const setupCapabilities = manifest.operations
    .filter((operation) => operation.phase === "setup")
    .map((operation) => operation.capability);
  const cleanupOperations = manifest.operations.filter(
    (operation) => operation.phase === "cleanup",
  );
  invariant(
    sameStringSet(setupCapabilities, REQUIRED_SETUP_CAPABILITIES) &&
      setupCapabilities.length === REQUIRED_SETUP_CAPABILITIES.length &&
      sameStringSet(
        cleanupOperations.map((operation) => operation.capability),
        REQUIRED_CLEANUP_CAPABILITIES,
      ) &&
      cleanupOperations.length === REQUIRED_CLEANUP_CAPABILITIES.length,
    "The manifest lifecycle operations have drifted from the runner.",
  );
  invariant(
    cleanupOperations.every(
      (operation) =>
        operation.ownerActorId === manifest.lifecycle.cleanupOwnerActorId &&
        manifest.lifecycle.cleanupOperationKeys.includes(operation.key),
    ),
    "Manifest cleanup ownership or declaration is incomplete.",
  );

  const temporaryPermissions = manifest.permissions.filter(
    (permission) => permission.mode === "temporary",
  );
  invariant(
    input.readiness.temporaryPermissionsExact &&
      sameStringSet(
        temporaryPermissions.map((permission) => permission.name),
        REQUIRED_TEMPORARY_ROLES,
      ) &&
      temporaryPermissions.length === REQUIRED_TEMPORARY_ROLES.length &&
      temporaryPermissions.every(
        (permission) =>
          permission.actorId === manifest.roles.evidenceProducer &&
          permission.revocationOwnerActorId ===
            manifest.lifecycle.cleanupOwnerActorId,
      ),
    "Temporary permission ownership or role set is not exact.",
  );

  const semanticClaims = manifest.evidence.artifacts.flatMap(
    (artifact) => artifact.semanticClaims,
  );
  invariant(
    sameStringSet(semanticClaims, EXPECTED_SEMANTIC_CLAIMS) &&
      semanticClaims.length === EXPECTED_SEMANTIC_CLAIMS.length &&
      manifest.evidence.artifacts.every(
        (artifact) =>
          artifact.state === "observed" &&
          artifact.authenticity === "platform-control-plane",
      ),
    "Manifest evidence expectations have drifted from runner readiness.",
  );
  invariant(
    manifest.learner.completionState === "not-run" &&
      manifest.learner.evidenceArtifactIds.every((artifactId) =>
        manifest.evidence.artifacts.some(
          (artifact) =>
            artifact.id === artifactId &&
            artifact.learnerVisibility === "not-proven",
        )
      ),
    "The manifest overclaims learner-session evidence.",
  );

  const retainedByArtifact = new Map(
    manifest.lifecycle.retainedArtifacts.map((item) => [
      item.artifactId,
      item,
    ]),
  );
  invariant(
    retainedByArtifact.size === manifest.evidence.artifacts.length &&
      manifest.evidence.artifacts.every((artifact) => {
        const retained = retainedByArtifact.get(artifact.id);
        return artifact.retention === "retained" &&
          retained?.disposition === "retain-audit-history" &&
          retained.cleanupOperationKey === undefined &&
          retained.custodianActorId ===
            manifest.lifecycle.cleanupOwnerActorId;
      }),
    "Manifest cleanup and retained evidence contradict each other.",
  );
  invariant(
    input.timing.expiryUtc === manifest.lifecycle.expiresAt,
    "The caller expiry differs from the manifest lifecycle.",
  );
}

function validateCallerSnapshot(input: AvdManifestRunnerAdapterInput): void {
  for (const alias of [
    ...Object.values(input.actorAliases),
    ...Object.values(input.scopeAliases),
  ]) {
    invariant(SAFE_ALIAS.test(alias), "A runtime alias is not sanitized.");
  }
  invariant(
    input.scopeAliases.tenant !== input.scopeAliases.subscription,
    "Tenant and subscription aliases must remain distinct.",
  );
  invariant(
    input.readiness.windowsSku === "Standard_D2s_v3" &&
      input.readiness.linuxSku === "Standard_F1als_v7" &&
      input.readiness.linuxVmCount === 2,
    "The caller topology does not represent the exact three VM roles.",
  );
  invariant(
    input.readiness.vmPublicIpCount === 0 &&
      input.readiness.explicitOutbound === true &&
      input.readiness.sharedNatGatewayCount === 1 &&
      input.readiness.sharedNatPublicIpCount === 1,
    "The caller topology is not private with explicit shared outbound.",
  );
  invariant(
    Number.isInteger(input.readiness.availableWindowsVmCount) &&
      Number.isInteger(input.readiness.availableLinuxVmCount) &&
      input.readiness.availableWindowsVmCount >= 1 &&
      input.readiness.availableLinuxVmCount >= 2,
    "The readiness snapshot cannot support the three VM roles.",
  );
  invariant(
    Number.isFinite(input.costBasis.boundedDataGb) &&
      input.costBasis.boundedDataGb >= 0 &&
      Number.isInteger(input.costBasis.diskOperationsPerDisk) &&
      input.costBasis.diskOperationsPerDisk >= 0,
    "The runner cost basis is invalid.",
  );
}

function validatePlanBinding(
  plan: FrozenLabPlan,
  manifest: ScenarioManifest,
  input: AvdManifestRunnerAdapterInput,
): void {
  invariant(
    plan.expiryUtc === manifest.lifecycle.expiresAt &&
      plan.cost.laneCeilingUsd === manifest.cost.laneMaximum &&
      plan.cost.billedHours === manifest.cost.conservativeDurationHours,
    "The frozen runner plan drifted from manifest cost or expiry.",
  );
  invariant(
    plan.topology.linuxVmCount === 2 &&
      plan.topology.vmPublicIpCount === 0 &&
      plan.topology.sharedNatGatewayCount ===
        input.readiness.sharedNatGatewayCount &&
      plan.topology.sharedPublicIpCount ===
        input.readiness.sharedNatPublicIpCount,
    "The frozen runner topology drifted from readiness.",
  );
  invariant(
    plan.learnerSessionClaimed === false &&
      sameStringSet(plan.temporaryRoles, REQUIRED_TEMPORARY_ROLES) &&
      plan.readinessGroups.flat().includes("learner-session") &&
      plan.mutations.every(
        (mutation) => mutation.owner === plan.cleanupOwner,
      ),
    "The frozen runner plan lost a learner, permission, or cleanup gate.",
  );
}

function assertNoRawRuntimeData(value: unknown): void {
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      invariant(
        !RAW_GUID.test(candidate) &&
          !RAW_UPN.test(candidate) &&
          !PRIVATE_PATH.test(candidate),
        "Raw identity or private path data is forbidden.",
      );
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      invariant(
        !FORBIDDEN_FIELD.test(key),
        "Sensitive runtime fields are forbidden.",
      );
      visit(child);
    }
  };
  visit(value);
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  invariant(
    sameStringSet(Object.keys(value), expected) &&
      Object.keys(value).length === expected.length,
    `The ${label} shape has drifted.`,
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) =>
          `${JSON.stringify(key)}:${canonicalJson(child)}`
        )
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    expected.every((value) => actual.includes(value));
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`AVD manifest adapter refused: ${message}`);
}
