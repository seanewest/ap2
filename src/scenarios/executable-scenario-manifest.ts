import {
  compileLifecycleCostEnvelope,
  type LifecycleCostEnvelope,
} from "./lifecycle-cost-envelope";
import {
  verifyScenarioEvidenceReceipt,
  type VerifiedScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt";
import {
  parseScenarioManifest,
  type ScenarioManifest,
  type ScenarioOperation,
} from "./scenario-manifest";
import type { ScenarioExecutionPlan } from "./scenario-plan";

const MAX_INPUT_BYTES = 512 * 1024;
const INPUT_KEYS = ["schemaVersion", "kind", "costRequest", "receipt"] as const;

export type ExecutableScenarioManifestFailure =
  | "COST_INVALID"
  | "DEPENDENCY_INVALID"
  | "INPUT_INVALID"
  | "PLAN_ORDER_INVALID"
  | "RECEIPT_INVALID"
  | "TOPOLOGY_INVALID";

export class ExecutableScenarioManifestError extends Error {
  readonly category: ExecutableScenarioManifestFailure;

  constructor(category: ExecutableScenarioManifestFailure) {
    super(category);
    this.name = "ExecutableScenarioManifestError";
    this.category = category;
  }
}

export interface ExecutableScenarioManifestRequest {
  schemaVersion: 1;
  kind: "executable-scenario-manifest-request";
  costRequest: unknown;
  receipt: unknown;
}

export interface ExecutableScenarioManifestResult {
  schemaVersion: 1;
  label: "EXECUTABLE_MANIFEST_CONTRACT";
  status: "contract-ready";
  proof: "not-executed";
  scenarioId: string;
  planDigestSha256: string;
  roles: Readonly<{
    evidenceProducer: string;
    workloadActor: string;
    learner: string;
    detector: string | "none";
    responder: string | "none";
    responseOwners: readonly string[];
    cleanupOwner: string;
  }>;
  topology: Readonly<{
    billableResourceCount: number;
    avdPersonalHostCount: number;
    linuxAuxiliaryNodeCount: number;
    sharedNatEgressCount: number;
    privateConnectivity: "required" | "not-declared";
  }>;
  phases: Readonly<{
    setupOperations: number;
    evidenceOperations: number;
    learnerEvidenceArtifacts: number;
    responseOperations: number;
    cleanupOperations: number;
    terminalReadbackArtifacts: number;
  }>;
  receipt: Readonly<{
    claimCount: number;
    provenCount: number;
    absentCount: number;
    refusedCount: number;
    ambiguousCount: number;
    licensingOrLatencyBlockedCount: number;
    uninspectedCount: number;
  }>;
  cost: LifecycleCostEnvelope;
}

/**
 * Compiles already-existing scenario, plan, receipt, and supplied-rate
 * contracts into one deterministic lifecycle summary. It performs no action
 * represented by the manifest and emits no runtime marker or resource ID.
 */
export function compileExecutableScenarioManifest(
  value: unknown,
): ExecutableScenarioManifestResult {
  assertBounded(value);
  const request = exactRecord(value, INPUT_KEYS);
  if (
    request.schemaVersion !== 1 ||
    request.kind !== "executable-scenario-manifest-request"
  ) {
    fail("INPUT_INVALID");
  }

  const costRequest = record(request.costRequest);
  let manifest: ScenarioManifest;
  let plan: ScenarioExecutionPlan;
  let cost: LifecycleCostEnvelope;
  try {
    manifest = parseScenarioManifest(costRequest.manifest);
    plan = costRequest.plan as ScenarioExecutionPlan;
    cost = compileLifecycleCostEnvelope(request.costRequest);
  } catch {
    fail("COST_INVALID");
  }

  let verifiedReceipt: VerifiedScenarioEvidenceReceipt;
  try {
    verifiedReceipt = verifyScenarioEvidenceReceipt(
      request.receipt,
      manifest,
    );
  } catch {
    fail("RECEIPT_INVALID");
  }

  if (verifiedReceipt.claims.some(({ state }) => state !== "uninspected")) {
    fail("RECEIPT_INVALID");
  }
  validateDependencySemantics(manifest, plan);
  validatePlanOrdering(manifest, plan);
  const topology = summarizeTopology(manifest);
  const claimStates = verifiedReceipt.claims.map(({ state }) => state);

  return deepFreeze({
    schemaVersion: 1,
    label: "EXECUTABLE_MANIFEST_CONTRACT",
    status: "contract-ready",
    proof: "not-executed",
    scenarioId: manifest.id,
    planDigestSha256: plan.digestSha256,
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: manifest.roles.workloadActor,
      learner: manifest.roles.learner,
      detector: manifest.roles.detector ?? "none",
      responder: manifest.roles.responder ?? "none",
      responseOwners: [
        ...new Set(
          manifest.responseActions.map(({ ownerActorId }) => ownerActorId),
        ),
      ].sort(),
      cleanupOwner: manifest.lifecycle.cleanupOwnerActorId,
    },
    topology,
    phases: {
      setupOperations: countPhase(manifest, "setup"),
      evidenceOperations: countPhase(manifest, "evidence"),
      learnerEvidenceArtifacts: manifest.learner.evidenceArtifactIds.length,
      responseOperations: countPhase(manifest, "response"),
      cleanupOperations: countPhase(manifest, "cleanup"),
      terminalReadbackArtifacts: manifest.evidence.artifacts.filter(
        ({ kind }) => kind === "cleanup-state",
      ).length,
    },
    receipt: {
      claimCount: claimStates.length,
      provenCount: claimStates.filter((state) => state === "proven").length,
      absentCount: claimStates.filter((state) => state === "absent").length,
      refusedCount: claimStates.filter((state) => state === "refused").length,
      ambiguousCount:
        claimStates.filter((state) => state === "ambiguous").length,
      licensingOrLatencyBlockedCount: claimStates.filter(
        (state) => state === "licensing-or-latency-blocked",
      ).length,
      uninspectedCount:
        claimStates.filter((state) => state === "uninspected").length,
    },
    cost,
  });
}

function validateDependencySemantics(
  manifest: ScenarioManifest,
  plan: ScenarioExecutionPlan,
): void {
  const operationByKey = new Map(
    manifest.operations.map((operation) => [operation.key, operation]),
  );
  const expiryOperations = manifest.operations.filter(
    ({ capability }) => capability === "expiry.schedule",
  );
  if (
    expiryOperations.length !== 1 ||
    (expiryOperations[0]!.dependsOnOperationKeys?.length ?? 0) !== 0
  ) {
    fail("DEPENDENCY_INVALID");
  }
  const expiryOperation = expiryOperations[0]!;

  for (const operation of manifest.operations) {
    if (
      operation.key !== expiryOperation.key &&
      (operation.dependsOnOperationKeys?.length ?? 0) === 0
    ) {
      fail("DEPENDENCY_INVALID");
    }
  }

  for (
    const createOperationKey of new Set(
      manifest.resources
        .filter(({ billable }) => billable)
        .map(({ createOperationKey }) => createOperationKey),
    )
  ) {
    if (
      !transitivelyDependsOn(
        operationByKey,
        createOperationKey,
        expiryOperation.key,
      )
    ) {
      fail("DEPENDENCY_INVALID");
    }
  }
  const billableCleanupOperationKeys = new Set(
    manifest.resources
      .filter(({ billable }) => billable)
      .map(({ cleanupOperationKey }) => cleanupOperationKey),
  );
  const expiryRemovalOperations = manifest.operations.filter(
    ({ capability }) => capability === "expiry.remove",
  );
  if (expiryRemovalOperations.length !== 1) fail("DEPENDENCY_INVALID");
  for (const cleanupOperationKey of billableCleanupOperationKeys) {
    if (
      !transitivelyDependsOn(
        operationByKey,
        expiryRemovalOperations[0]!.key,
        cleanupOperationKey,
      )
    ) {
      fail("DEPENDENCY_INVALID");
    }
  }

  for (const artifact of manifest.evidence.artifacts) {
    if (artifact.kind === "cleanup-state") continue;
    const source = operationByKey.get(artifact.sourceOperationKey);
    if (
      source?.phase !== "evidence" ||
      !hasTransitivePhaseDependency(operationByKey, source.key, "setup")
    ) {
      fail("DEPENDENCY_INVALID");
    }
  }

  const learnerSourceOperations = manifest.learner.evidenceArtifactIds.map(
    (artifactId) =>
      manifest.evidence.artifacts.find(({ id }) => id === artifactId)!
        .sourceOperationKey,
  );
  for (const action of manifest.responseActions) {
    for (const sourceOperationKey of learnerSourceOperations) {
      if (
        !transitivelyDependsOn(
          operationByKey,
          action.operationKey,
          sourceOperationKey,
        )
      ) {
        fail("DEPENDENCY_INVALID");
      }
    }
  }

  for (const cleanupOperationKey of manifest.lifecycle.cleanupOperationKeys) {
    if (
      !hasTransitivePhaseDependency(
        operationByKey,
        cleanupOperationKey,
        "evidence",
      )
    ) {
      fail("DEPENDENCY_INVALID");
    }
  }
  const selectedResponseOperationKey = plan.selectedResponseId === null
    ? undefined
    : manifest.responseActions.find(({ id }) => id === plan.selectedResponseId)
      ?.operationKey;
  if (
    plan.selectedResponseId !== null &&
    selectedResponseOperationKey === undefined
  ) {
    fail("DEPENDENCY_INVALID");
  }
  if (selectedResponseOperationKey !== undefined) {
    for (
      const cleanupOperationKey of manifest.lifecycle.cleanupOperationKeys
    ) {
      if (
        !transitivelyDependsOn(
          operationByKey,
          cleanupOperationKey,
          selectedResponseOperationKey,
        )
      ) {
        fail("DEPENDENCY_INVALID");
      }
    }
  }

  const cleanupReadbacks = manifest.evidence.artifacts.filter(
    ({ kind }) => kind === "cleanup-state",
  );
  if (cleanupReadbacks.length !== 1) fail("DEPENDENCY_INVALID");
  const cleanupReadbackOperation = operationByKey.get(
    cleanupReadbacks[0]!.sourceOperationKey,
  );
  if (
    cleanupReadbackOperation?.phase !== "evidence" ||
    cleanupReadbackOperation.effect !== "read" ||
    cleanupReadbackOperation.capability !== "artifact.read-exact"
  ) {
    fail("DEPENDENCY_INVALID");
  }
  for (const cleanupOperationKey of manifest.lifecycle.cleanupOperationKeys) {
    if (
      !transitivelyDependsOn(
        operationByKey,
        cleanupReadbacks[0]!.sourceOperationKey,
        cleanupOperationKey,
      )
    ) {
      fail("DEPENDENCY_INVALID");
    }
  }
}

function validatePlanOrdering(
  manifest: ScenarioManifest,
  plan: ScenarioExecutionPlan,
): void {
  const selectedResponseOperationKey = plan.selectedResponseId === null
    ? undefined
    : manifest.responseActions.find(({ id }) => id === plan.selectedResponseId)
      ?.operationKey;
  if (
    plan.selectedResponseId !== null &&
    selectedResponseOperationKey === undefined
  ) {
    fail("PLAN_ORDER_INVALID");
  }
  const expectedOperationKeys = new Set(
    manifest.operations.flatMap((operation) =>
      operation.phase !== "response" ||
        operation.key === selectedResponseOperationKey
        ? [operation.key]
        : []
    ),
  );
  const stepIndexes = new Map<string, number>();
  plan.steps.forEach((step, index) => {
    if (expectedOperationKeys.has(step.operationKey)) {
      if (stepIndexes.has(step.operationKey)) fail("PLAN_ORDER_INVALID");
      stepIndexes.set(step.operationKey, index);
    }
  });
  if (stepIndexes.size !== expectedOperationKeys.size) {
    fail("PLAN_ORDER_INVALID");
  }
  for (const operation of manifest.operations) {
    if (!expectedOperationKeys.has(operation.key)) continue;
    const operationIndex = stepIndexes.get(operation.key);
    if (operationIndex === undefined) fail("PLAN_ORDER_INVALID");
    for (const dependency of operation.dependsOnOperationKeys ?? []) {
      const dependencyIndex = stepIndexes.get(dependency);
      if (
        dependencyIndex === undefined ||
        dependencyIndex >= operationIndex
      ) {
        fail("PLAN_ORDER_INVALID");
      }
    }
  }
}

function summarizeTopology(
  manifest: ScenarioManifest,
): ExecutableScenarioManifestResult["topology"] {
  const kinds = manifest.resources.map(({ kind }) => kind);
  const avdPersonalHostCount = kinds.filter(
    (kind) => kind === "avd-personal-host",
  ).length;
  const auxiliaryPairs = kinds.filter(
    (kind) => kind === "linux-auxiliary-pair",
  ).length;
  const sharedNatEgressCount = kinds.filter(
    (kind) => kind === "shared-nat-egress",
  ).length;
  const hasThreeNodeShape =
    avdPersonalHostCount > 0 ||
    auxiliaryPairs > 0 ||
    sharedNatEgressCount > 0;
  const networkPrerequisites = manifest.prerequisites.filter(
    ({ kind }) => kind === "network",
  );
  const hasPrivateNetworkContract =
    networkPrerequisites.length === 1 &&
    networkPrerequisites[0]!.id === "private-network-contract" &&
    networkPrerequisites[0]!.requiredState ===
      "No VM public IP or broad auxiliary inbound path exists.";
  if (
    hasThreeNodeShape &&
    (
      avdPersonalHostCount !== 1 ||
      auxiliaryPairs !== 1 ||
      sharedNatEgressCount !== 1 ||
      !hasPrivateNetworkContract
    )
  ) {
    fail("TOPOLOGY_INVALID");
  }
  if (hasThreeNodeShape) {
    const topologyResources = manifest.resources.filter(({ kind }) =>
      kind === "avd-personal-host" ||
      kind === "linux-auxiliary-pair" ||
      kind === "shared-nat-egress"
    );
    const createOperationKeys = new Set(
      topologyResources.map(({ createOperationKey }) => createOperationKey),
    );
    const cleanupOperationKeys = new Set(
      topologyResources.map(({ cleanupOperationKey }) => cleanupOperationKey),
    );
    if (
      createOperationKeys.size !== 1 ||
      cleanupOperationKeys.size !== 1 ||
      manifest.operations.find(
          ({ key }) => key === [...createOperationKeys][0],
        )?.capability !== "azure.three-vm.deploy" ||
      manifest.operations.find(
          ({ key }) => key === [...cleanupOperationKeys][0],
        )?.capability !== "azure.resource-group.delete"
    ) {
      fail("TOPOLOGY_INVALID");
    }
    const operations = new Map(
      manifest.operations.map((operation) => [operation.key, operation]),
    );
    for (
      const artifact of manifest.evidence.artifacts.filter(
        ({ kind }) => kind !== "cleanup-state",
      )
    ) {
      if (
        !transitivelyDependsOn(
          operations,
          artifact.sourceOperationKey,
          [...createOperationKeys][0]!,
        )
      ) {
        fail("DEPENDENCY_INVALID");
      }
    }
  }
  return {
    billableResourceCount:
      manifest.resources.filter(({ billable }) => billable).length,
    avdPersonalHostCount,
    linuxAuxiliaryNodeCount: auxiliaryPairs * 2,
    sharedNatEgressCount,
    privateConnectivity: hasPrivateNetworkContract
      ? "required"
      : "not-declared",
  };
}

function transitivelyDependsOn(
  operations: ReadonlyMap<string, ScenarioOperation>,
  operationKey: string,
  targetKey: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(operationKey)) return false;
  visited.add(operationKey);
  const dependencies =
    operations.get(operationKey)?.dependsOnOperationKeys ?? [];
  return dependencies.includes(targetKey) ||
    dependencies.some((dependency) =>
      transitivelyDependsOn(operations, dependency, targetKey, visited)
    );
}

function hasTransitivePhaseDependency(
  operations: ReadonlyMap<string, ScenarioOperation>,
  operationKey: string,
  phase: ScenarioOperation["phase"],
): boolean {
  const visited = new Set<string>();
  const queue = [
    ...(operations.get(operationKey)?.dependsOnOperationKeys ?? []),
  ];
  while (queue.length > 0) {
    const dependency = queue.shift()!;
    if (visited.has(dependency)) continue;
    visited.add(dependency);
    const operation = operations.get(dependency);
    if (operation?.phase === phase) return true;
    queue.push(...(operation?.dependsOnOperationKeys ?? []));
  }
  return false;
}

function countPhase(
  manifest: ScenarioManifest,
  phase: ScenarioOperation["phase"],
): number {
  return manifest.operations.filter((operation) => operation.phase === phase)
    .length;
}

function assertBounded(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("INPUT_INVALID");
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES
  ) {
    fail("INPUT_INVALID");
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const result = record(value);
  if (
    Object.keys(result).length !== keys.length ||
    Object.keys(result).some((key) => !keys.includes(key))
  ) {
    fail("INPUT_INVALID");
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("INPUT_INVALID");
  }
  return value as Record<string, unknown>;
}

function fail(category: ExecutableScenarioManifestFailure): never {
  throw new ExecutableScenarioManifestError(category);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
