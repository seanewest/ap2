import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";

const OPERATION_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "schedule-expiry-cleanup": [],
  "grant-temporary-endpoint-roles": ["schedule-expiry-cleanup"],
  "prepare-ephemeral-run-material": ["schedule-expiry-cleanup"],
  "deploy-private-three-vm-topology": [
    "schedule-expiry-cleanup",
    "grant-temporary-endpoint-roles",
    "prepare-ephemeral-run-material",
  ],
  "onboard-windows-endpoint": [
    "deploy-private-three-vm-topology",
    "grant-temporary-endpoint-roles",
  ],
  "observe-three-vm-topology": ["deploy-private-three-vm-topology"],
  "observe-avd-endpoint": ["onboard-windows-endpoint"],
  "inspect-future-substrate": [
    "observe-three-vm-topology",
    "observe-avd-endpoint",
  ],
  "offboard-windows-endpoint": [
    "observe-avd-endpoint",
    "inspect-future-substrate",
  ],
  "delete-three-vm-resource-group": [
    "offboard-windows-endpoint",
    "observe-three-vm-topology",
  ],
  "revoke-temporary-endpoint-roles": ["offboard-windows-endpoint"],
  "remove-expiry-cleanup": [
    "delete-three-vm-resource-group",
    "revoke-temporary-endpoint-roles",
  ],
  "remove-ephemeral-run-material": [
    "delete-three-vm-resource-group",
    "revoke-temporary-endpoint-roles",
  ],
  "observe-final-cleanup": [
    "offboard-windows-endpoint",
    "delete-three-vm-resource-group",
    "revoke-temporary-endpoint-roles",
    "remove-expiry-cleanup",
    "remove-ephemeral-run-material",
  ],
};

const OPERATION_ORDER = [
  "schedule-expiry-cleanup",
  "grant-temporary-endpoint-roles",
  "prepare-ephemeral-run-material",
  "deploy-private-three-vm-topology",
  "onboard-windows-endpoint",
  "observe-three-vm-topology",
  "observe-avd-endpoint",
  "inspect-future-substrate",
  "offboard-windows-endpoint",
  "delete-three-vm-resource-group",
  "revoke-temporary-endpoint-roles",
  "remove-expiry-cleanup",
  "remove-ephemeral-run-material",
  "observe-final-cleanup",
] as const;

const operationByKey = new Map(
  AVD_THREE_VM_SCENARIO.operations.map((operation) => [
    operation.key,
    operation,
  ]),
);

/**
 * A plan-only fixture derived from the repository-backed three-VM AVD
 * lifecycle. It deliberately carries no historical observation and is not
 * registered as a runnable product scenario.
 */
export const PLANNED_AVD_THREE_NODE_LAB = parseScenarioManifest({
  ...AVD_THREE_VM_SCENARIO,
  id: "planned-avd-three-node-lab",
  title: "Planned private three-node AVD lab",
  summary:
    "Contract-only plan for one personal Windows 11 AVD desktop and two private Ubuntu nodes behind shared NAT.",
  actors: AVD_THREE_VM_SCENARIO.actors.map((actor) =>
    actor.id === AVD_THREE_VM_SCENARIO.roles.learner
      ? {
        ...actor,
        summary:
          "Fixed learner may inspect the prepared personal desktop only after exact readiness evidence.",
      }
      : actor
  ),
  operations: OPERATION_ORDER.map((key) => {
    const operation = operationByKey.get(key);
    if (!operation) throw new Error(`missing backed operation '${key}'`);
    const dependencies = OPERATION_DEPENDENCIES[key];
    if (dependencies === undefined) {
      throw new Error(`missing dependency contract for '${key}'`);
    }
    return {
      ...operation,
      ...(dependencies.length === 0
        ? {}
        : { dependsOnOperationKeys: dependencies }),
    };
  }),
  evidence: {
    staging:
      "The orchestrator must prepare and verify the private three-node substrate before learner activity and expiry cleanup.",
    learnerReceives:
      "Learner-visible desktop evidence is planned but remains unproven until a separate learner observation is supplied.",
    artifacts: AVD_THREE_VM_SCENARIO.evidence.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      authenticity: artifact.authenticity,
      state: "planned" as const,
      learnerVisibility: "not-proven" as const,
      sourceOperationKey: artifact.sourceOperationKey,
      claim: artifact.claim,
      semanticClaims: artifact.semanticClaims,
      retention: artifact.retention,
    })),
  },
  learner: {
    ...AVD_THREE_VM_SCENARIO.learner,
    task:
      "After exact readiness evidence, inspect the personal desktop and reason about the two private auxiliary services.",
    expectedInterpretation:
      "The topology is a prepared private lab substrate; planning does not prove a learner session or task completion.",
    completionState: "not-run",
    evidenceArtifactIds:
      AVD_THREE_VM_SCENARIO.learner.evidenceArtifactIds.filter(
        (artifactId) => artifactId !== "final-cleanup-state",
      ),
  },
  responseActions: AVD_THREE_VM_SCENARIO.responseActions.map((action) => ({
    ...action,
    summary:
      "Permitted learner inspection after the declared readiness observations.",
  })),
  cost: {
    ...AVD_THREE_VM_SCENARIO.cost,
    assumption:
      "A fresh immutable supplied-rate envelope is required; this fixture embeds no current price claim.",
  },
} satisfies ScenarioManifest);
