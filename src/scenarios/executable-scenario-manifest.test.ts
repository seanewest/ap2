import { describe, expect, it } from "vitest";
import {
  compileExecutableScenarioManifest,
  ExecutableScenarioManifestError,
  type ExecutableScenarioManifestRequest,
} from "./executable-scenario-manifest";
import type {
  EvidenceReceiptClaim,
  ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt";
import { verifyScenarioEvidenceReceipt } from "./scenario-evidence-receipt";
import type {
  LifecycleCostEnvelopeRequest,
  LifecycleCostUsageLine,
  LifecycleRateCard,
} from "./lifecycle-cost-envelope";
import { PLANNED_AVD_THREE_NODE_LAB } from "./planned-avd-three-node-lab";
import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioExecutionPlan,
} from "./scenario-plan";
import type { ScenarioManifest } from "./scenario-manifest";

const GENERATED_AT = "2026-07-29T08:45:37Z";
const EXPIRES_AT = "2026-07-29T13:45:37Z";

function plan(
  manifest: ScenarioManifest = PLANNED_AVD_THREE_NODE_LAB,
): ScenarioExecutionPlan {
  return compileScenarioExecutionPlan(
    {
      scenarioId: manifest.id,
      actorAliases: {
        evidenceProducer: "orchestrator",
        workloadActor: "endpoint",
        learner: "learner",
        responder: "orchestrator",
        cleanupOwner: "orchestrator",
      },
      now: GENERATED_AT,
      expiresAt: EXPIRES_AT,
      maximumBudgetUsd: 10,
      selectedResponseId: manifest.responseActions[0]!.id,
    },
    [manifest],
  );
}

function rateCard(): LifecycleRateCard {
  return {
    schemaVersion: 1,
    kind: "supplied-lifecycle-rate-card",
    currency: "USD",
    region: "example-region",
    effectiveAt: "2026-07-29T00:00:00Z",
    expiresAt: "2026-07-30T00:00:00Z",
    meters: [
      meter("windows-compute", "vm-compute", "compute", "example-win-vm", "resource-hour", 0.2),
      meter("linux-compute", "vm-compute", "compute", "example-linux-vm", "resource-hour", 0.05),
      meter("windows-disk", "os-disk", "disk-capacity", "example-win-disk", "resource-hour", 0.01),
      meter("linux-disk", "os-disk", "disk-capacity", "example-linux-disk", "resource-hour", 0.005),
      meter("shared-nat", "nat-gateway", "shared-service", "example-nat", "resource-hour", 0.02),
      meter("shared-ip", "public-ip", "shared-service", "example-ip", "resource-hour", 0.01),
      meter("nat-data", "nat-data", "network", "example-nat-data", "gb", 0.03),
      meter("egress-data", "internet-egress", "network", "example-egress", "gb", 0.04),
      meter("disk-operations", "disk-operations", "disk-operations", "example-disk-ops", "operation", 0.000001),
    ],
  };
}

function meter(
  id: string,
  component: LifecycleRateCard["meters"][number]["component"],
  category: LifecycleRateCard["meters"][number]["category"],
  sku: string,
  billingUnit: LifecycleRateCard["meters"][number]["billingUnit"],
  rateUsdPerUnit: number,
): LifecycleRateCard["meters"][number] {
  return {
    id,
    component,
    category,
    sku,
    billingUnit,
    rateUsdPerUnit,
    billingIncrementUnits: 1,
    minimumBillableUnits: billingUnit === "resource-hour" ? 1 : 0,
  };
}

function line(
  id: string,
  resourceId: string,
  meterId: string,
  resourceCount: number,
  basis: "lifecycle-hours" | "fixed-units",
  unitsPerResource?: number,
): LifecycleCostUsageLine {
  return {
    id,
    resourceId,
    meterId,
    resourceCount,
    basis,
    ...(unitsPerResource === undefined ? {} : { unitsPerResource }),
  };
}

function costRequest(
  manifest: ScenarioManifest = PLANNED_AVD_THREE_NODE_LAB,
): LifecycleCostEnvelopeRequest {
  return {
    schemaVersion: 1,
    kind: "lifecycle-cost-envelope-request",
    asOf: GENERATED_AT,
    region: "example-region",
    manifest,
    plan: plan(manifest),
    rateCard: rateCard(),
    learnerDurationHours: 4,
    provisioningWaves: [
      { id: "control", parallelDurationsHours: [0.25] },
      { id: "parallel-compute", parallelDurationsHours: [0.25, 0.25, 0.25] },
    ],
    startupGraceHours: 0.25,
    cleanupGraceHours: 0.25,
    contingencyPercent: 20,
    suppliedCeilingUsd: 10,
    usageLines: [
      line("windows-vm", "windows-avd-host", "windows-compute", 1, "lifecycle-hours"),
      line("linux-vms", "ubuntu-auxiliary-pair", "linux-compute", 2, "lifecycle-hours"),
      line("windows-disk", "windows-avd-host", "windows-disk", 1, "lifecycle-hours"),
      line("linux-disks", "ubuntu-auxiliary-pair", "linux-disk", 2, "lifecycle-hours"),
      line("nat", "shared-nat-egress", "shared-nat", 1, "lifecycle-hours"),
      line("ip", "shared-nat-egress", "shared-ip", 1, "lifecycle-hours"),
      line("nat-gb", "shared-nat-egress", "nat-data", 1, "fixed-units", 10),
      line("egress-gb", "shared-nat-egress", "egress-data", 1, "fixed-units", 10),
      line("windows-ops", "windows-avd-host", "disk-operations", 1, "fixed-units", 1_000),
      line("linux-ops", "ubuntu-auxiliary-pair", "disk-operations", 2, "fixed-units", 1_000),
    ],
  };
}

function uninspectedReceipt(
  manifest: ScenarioManifest = PLANNED_AVD_THREE_NODE_LAB,
): ScenarioEvidenceReceipt {
  const uninspected = (
    id: string,
    category: EvidenceReceiptClaim["category"],
    subjectKind: EvidenceReceiptClaim["subject"]["kind"],
    subjectId: string,
    assertion: EvidenceReceiptClaim["assertion"],
    artifact?: EvidenceReceiptClaim["artifact"],
  ): EvidenceReceiptClaim => ({
    id,
    category,
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state: "uninspected",
    ...(artifact === undefined ? {} : { artifact }),
  });
  return {
    schemaVersion: 1,
    scenario: { id: manifest.id, manifestSchemaVersion: 2 },
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: manifest.roles.workloadActor,
      learner: manifest.roles.learner,
      ...(manifest.roles.detector === undefined
        ? {}
        : { detector: manifest.roles.detector }),
      ...(manifest.roles.responder === undefined
        ? {}
        : { responder: manifest.roles.responder }),
    },
    claims: [
      ...manifest.operations.map((operation) =>
        uninspected(
          `operation-${operation.key}`,
          "operation",
          "operation",
          operation.key,
          "operation-completed",
        )
      ),
      ...manifest.evidence.artifacts.map((artifact) =>
        uninspected(
          `artifact-${artifact.id}`,
          "artifact",
          "artifact",
          artifact.id,
          "artifact-authentic",
          { kind: artifact.kind, authenticity: artifact.authenticity },
        )
      ),
      ...manifest.learner.evidenceArtifactIds.map((artifactId) =>
        uninspected(
          `visibility-${artifactId}`,
          "learner-visibility",
          "artifact",
          artifactId,
          "learner-visible",
        )
      ),
      uninspected(
        "learner-interpretation",
        "learner-interpretation",
        "scenario",
        manifest.id,
        "learner-interpreted",
      ),
      ...manifest.responseActions.map((action) =>
        uninspected(
          `response-${action.id}`,
          "response",
          "response-action",
          action.id,
          "response-completed",
        )
      ),
      ...manifest.lifecycle.cleanupOperationKeys.map((operationKey) =>
        uninspected(
          `cleanup-${operationKey}`,
          "cleanup",
          "operation",
          operationKey,
          "cleanup-completed",
        )
      ),
      ...manifest.evidence.artifacts.map((artifact) =>
        uninspected(
          `retention-${artifact.id}`,
          "retention",
          "artifact",
          artifact.id,
          "retention-confirmed",
        )
      ),
      uninspected(
        "terminal-infrastructure-ready",
        "terminal-proof",
        "scenario",
        manifest.id,
        "infrastructure-ready",
      ),
    ],
  };
}

function request(
  manifest: ScenarioManifest = PLANNED_AVD_THREE_NODE_LAB,
): ExecutableScenarioManifestRequest {
  return {
    schemaVersion: 1,
    kind: "executable-scenario-manifest-request",
    costRequest: costRequest(manifest),
    receipt: uninspectedReceipt(manifest),
  };
}

function category(value: unknown): string {
  try {
    compileExecutableScenarioManifest(value);
    return "accepted";
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutableScenarioManifestError);
    return (error as ExecutableScenarioManifestError).category;
  }
}

describe("executable generalized scenario manifest", () => {
  it("binds the planned three-node lifecycle without claiming execution", () => {
    verifyScenarioEvidenceReceipt(
      uninspectedReceipt(),
      PLANNED_AVD_THREE_NODE_LAB,
    );
    const result = compileExecutableScenarioManifest(request());

    expect(result).toMatchObject({
      label: "EXECUTABLE_MANIFEST_CONTRACT",
      status: "contract-ready",
      proof: "not-executed",
      scenarioId: "planned-avd-three-node-lab",
      topology: {
        billableResourceCount: 3,
        avdPersonalHostCount: 1,
        linuxAuxiliaryNodeCount: 2,
        sharedNatEgressCount: 1,
        privateConnectivity: "required",
      },
      phases: {
        setupOperations: 5,
        evidenceOperations: 3,
        learnerEvidenceArtifacts: 3,
        responseOperations: 1,
        cleanupOperations: 5,
        terminalReadbackArtifacts: 1,
      },
      receipt: {
        provenCount: 0,
      },
      cost: {
        label: "FORECAST_ONLY",
        status: "fits-ceiling",
        classifications: {
          observedBill: "not-observed",
        },
      },
    });
    expect(result.receipt.uninspectedCount).toBe(result.receipt.claimCount);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cost)).toBe(true);
  });

  it("rejects missing, reordered, and cyclic phase dependencies", () => {
    const mutations = [
      (manifest: ScenarioManifest) => {
        const operation = manifest.operations.find(
          ({ key }) => key === "inspect-future-substrate",
        )!;
        (operation as { dependsOnOperationKeys?: readonly string[] })
          .dependsOnOperationKeys = ["observe-avd-endpoint"];
      },
      (manifest: ScenarioManifest) => {
        const operations = manifest.operations as Array<
          ScenarioManifest["operations"][number]
        >;
        const deployIndex = operations.findIndex(
          ({ key }) => key === "deploy-private-three-vm-topology",
        );
        const evidenceIndex = operations.findIndex(
          ({ key }) => key === "observe-three-vm-topology",
        );
        [operations[deployIndex], operations[evidenceIndex]] = [
          operations[evidenceIndex]!,
          operations[deployIndex]!,
        ];
      },
      (manifest: ScenarioManifest) => {
        const operation = manifest.operations.find(
          ({ key }) => key === "schedule-expiry-cleanup",
        )!;
        (operation as { dependsOnOperationKeys?: readonly string[] })
          .dependsOnOperationKeys = ["deploy-private-three-vm-topology"];
      },
    ];
    expect(
      mutations.map((mutate) => {
        const manifest = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
        mutate(manifest);
        try {
          return category(request(manifest));
        } catch {
          return "PLAN_COMPILE_REJECTED";
        }
      }),
    ).toEqual([
      "DEPENDENCY_INVALID",
      "PLAN_ORDER_INVALID",
      "PLAN_COMPILE_REJECTED",
    ]);
  });

  it.each([
    ["billable-before-expiry", "deploy-private-three-vm-topology", []],
    ["evidence-before-setup", "observe-three-vm-topology", []],
    ["evidence-after-expiry-only", "observe-three-vm-topology", [
      "schedule-expiry-cleanup",
    ]],
    ["response-before-observation", "inspect-future-substrate", [
      "observe-avd-endpoint",
    ]],
    ["cleanup-before-evidence", "offboard-windows-endpoint", []],
    ["cleanup-before-selected-response", "offboard-windows-endpoint", [
      "observe-avd-endpoint",
    ]],
    ["expiry-removed-before-billable-cleanup", "remove-expiry-cleanup", [
      "revoke-temporary-endpoint-roles",
    ]],
    ["terminal-readback-before-cleanup", "observe-final-cleanup", [
      "offboard-windows-endpoint",
    ]],
  ])("fails closed on %s dependency drift", (_name, key, dependencies) => {
    const manifest = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    const operation = manifest.operations.find(
      ({ key: operationKey }) => operationKey === key,
    )!;
    (operation as { dependsOnOperationKeys?: readonly string[] })
      .dependsOnOperationKeys = dependencies;

    try {
      expect(category(request(manifest))).toBe("DEPENDENCY_INVALID");
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioPlanError);
      expect((error as ScenarioPlanError).category).toBe("MANIFEST_INVALID");
    }
  });

  it("rejects role, topology, marker, cost-profile, and receipt drift", () => {
    const roleDrift = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    roleDrift.roles.learner = roleDrift.roles.evidenceProducer;

    const topologyDrift = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    topologyDrift.resources = topologyDrift.resources.filter(
      ({ kind }) => kind !== "shared-nat-egress",
    );

    const markerDrift = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    markerDrift.operations.find(
      ({ key }) => key === "onboard-windows-endpoint",
    )!.marker = "different-lifecycle-marker";

    const costProfileDrift = request();
    (costProfileDrift.costRequest as LifecycleCostEnvelopeRequest).usageLines =
      (costProfileDrift.costRequest as LifecycleCostEnvelopeRequest).usageLines
        .filter(({ resourceId }) => resourceId !== "shared-nat-egress");

    const receiptDrift = request();
    receiptDrift.receipt = {
      ...(receiptDrift.receipt as ScenarioEvidenceReceipt),
      scenario: {
        id: "different-scenario",
        manifestSchemaVersion: 2,
      },
    };

    expect([
      category({
        ...request(),
        costRequest: {
          ...costRequest(),
          manifest: roleDrift,
        },
      }),
      category({
        ...request(),
        costRequest: {
          ...costRequest(),
          manifest: topologyDrift,
        },
      }),
      category({
        ...request(),
        costRequest: {
          ...costRequest(),
          manifest: markerDrift,
        },
      }),
      category(costProfileDrift),
      category(receiptDrift),
    ]).toEqual([
      "COST_INVALID",
      "COST_INVALID",
      "COST_INVALID",
      "COST_INVALID",
      "RECEIPT_INVALID",
    ]);
  });

  it("rejects a declared three-node shape without the exact private topology contract", () => {
    const networkDrift = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    networkDrift.prerequisites.find(
      ({ id }) => id === "private-network-contract",
    )!.requiredState = "One VM public IP is allowed.";

    const actionDrift = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    actionDrift.operations.find(
      ({ key }) => key === "deploy-private-three-vm-topology",
    )!.capability = "sensitive-artifacts.prepare";

    const contradictoryNetwork = structuredClone(
      PLANNED_AVD_THREE_NODE_LAB,
    );
    (contradictoryNetwork.prerequisites as Array<
      ScenarioManifest["prerequisites"][number]
    >).push({
      id: "public-management-path",
      kind: "network",
      summary: "A contradictory public management path.",
      requiredState: "One VM public IP and broad inbound path are allowed.",
    });

    expect(category(request(networkDrift))).toBe("TOPOLOGY_INVALID");
    expect(category(request(actionDrift))).toBe("TOPOLOGY_INVALID");
    expect(category(request(contradictoryNetwork))).toBe("TOPOLOGY_INVALID");
  });

  it("rejects proof-bearing receipts until the authoritative receipt binds a plan", () => {
    const input = request();
    const receipt = structuredClone(input.receipt as ScenarioEvidenceReceipt);
    const operationClaim = receipt.claims.find(
      ({ id }) => id === "operation-schedule-expiry-cleanup",
    )!;
    operationClaim.state = "proven";
    operationClaim.observation = {
      source: "provider-response",
      outcome: "operation-result",
      observerActorId: PLANNED_AVD_THREE_NODE_LAB.roles.evidenceProducer,
      operationKey: "schedule-expiry-cleanup",
    };
    input.receipt = receipt;

    expect(category(input)).toBe("RECEIPT_INVALID");
  });

  it("requires terminal cleanup state to come from an exact read", () => {
    const manifest = structuredClone(PLANNED_AVD_THREE_NODE_LAB);
    manifest.operations.find(
      ({ key }) => key === "observe-final-cleanup",
    )!.capability = "learner.inspect";

    expect(category(request(manifest))).toBe("DEPENDENCY_INVALID");
  });

  it("rejects unknown fields and oversized input", () => {
    expect(category({ ...request(), unknown: true })).toBe("INPUT_INVALID");
    expect(category({ ...request(), padding: "x".repeat(600_000) })).toBe(
      "INPUT_INVALID",
    );
  });
});
