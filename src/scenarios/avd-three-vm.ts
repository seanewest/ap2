import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";

const marker = "ap2-avd-three-vm-fixture";
const expiry = "2026-07-29T13:45:37Z";

export const AVD_THREE_VM_SCENARIO = parseScenarioManifest({
  schemaVersion: 2,
  id: "avd-three-vm-substrate",
  title: "Private three-VM AVD lab substrate",
  summary:
    "AP2 provisions one personal Windows 11 AVD learner desktop and two private Ubuntu auxiliary nodes behind shared NAT, then verifies and cleans the bounded lifecycle.",
  actors: [
    {
      id: "ap2-dev-orchestrator",
      label: "AP2 Dev orchestrator",
      kind: "application",
      summary: "Owns infrastructure, endpoint lifecycle, evidence, and cleanup.",
    },
    {
      id: "windows-endpoint",
      label: "Windows 11 AVD endpoint",
      kind: "device",
      summary: "Joins Entra, enrolls in Intune, and onboards to Defender.",
    },
    {
      id: "fixed-learner",
      label: "Fixed AP2 learner",
      kind: "human",
      summary: "Is assigned the personal desktop but did not start a session.",
    },
  ],
  roles: {
    evidenceProducer: "ap2-dev-orchestrator",
    workloadActor: "windows-endpoint",
    learner: "fixed-learner",
    responder: "ap2-dev-orchestrator",
  },
  authentication: [
    {
      actorId: "ap2-dev-orchestrator",
      transport: "application-only",
      summary: "Existing Dev application and bounded temporary Graph roles.",
    },
    {
      actorId: "windows-endpoint",
      transport: "managed-identity",
      summary: "Deployment-time Entra join and VM extension lifecycle.",
    },
  ],
  trigger: { kind: "staged" },
  prerequisites: [
    {
      id: "east-us-images-quota",
      kind: "resource",
      summary: "Exact Windows and Ubuntu images and four vCPUs are available.",
      requiredState:
        "East US image, regional, DSv3, and Falsv7 quota checks pass.",
    },
    {
      id: "fixed-learner-assignment",
      kind: "identity",
      summary: "The personal AVD desktop targets the already proven learner.",
      requiredState: "Exact direct assignment is configured.",
    },
    {
      id: "private-network-contract",
      kind: "network",
      summary: "All three VM NICs are private behind one shared NAT egress.",
      requiredState:
        "No VM public IP or broad auxiliary inbound path exists.",
    },
  ],
  operations: [
    {
      key: "grant-temporary-endpoint-roles",
      phase: "setup",
      capability: "permission.grant",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Grant the two bounded temporary Graph roles.",
    },
    {
      key: "deploy-private-three-vm-topology",
      phase: "setup",
      capability: "azure.three-vm.deploy",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Deploy the resource group, AVD host, auxiliaries, and NAT.",
    },
    {
      key: "onboard-windows-endpoint",
      phase: "setup",
      capability: "endpoint.onboard",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Apply marker-bound Entra, Intune, and Defender lifecycle.",
    },
    {
      key: "schedule-expiry-cleanup",
      phase: "setup",
      capability: "expiry.schedule",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Create the marker-bound expiry cleanup schedule.",
    },
    {
      key: "prepare-ephemeral-run-material",
      phase: "setup",
      capability: "sensitive-artifacts.prepare",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary:
        "Prepare only ephemeral sensitive material required for the bounded run.",
    },
    {
      key: "observe-three-vm-topology",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "ap2-dev-orchestrator",
      summary: "Verify the exact private topology and auxiliary health markers.",
    },
    {
      key: "observe-avd-endpoint",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "ap2-dev-orchestrator",
      summary: "Verify AVD availability and endpoint posture without a session.",
    },
    {
      key: "observe-final-cleanup",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "ap2-dev-orchestrator",
      summary:
        "Verify expiry schedule and ephemeral sensitive material are absent.",
    },
    {
      key: "inspect-future-substrate",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "fixed-learner",
      summary: "Future learner inspection; not performed in this canary.",
    },
    {
      key: "offboard-windows-endpoint",
      phase: "cleanup",
      capability: "endpoint.offboard",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Offboard and remove exact marker-bound endpoint state.",
    },
    {
      key: "delete-three-vm-resource-group",
      phase: "cleanup",
      capability: "azure.resource-group.delete",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Delete the exact run-owned resource group once.",
    },
    {
      key: "revoke-temporary-endpoint-roles",
      phase: "cleanup",
      capability: "permission.revoke",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Revoke the two captured temporary Graph assignments.",
    },
    {
      key: "remove-expiry-cleanup",
      phase: "cleanup",
      capability: "expiry.remove",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary: "Remove the exact marker-bound expiry cleanup schedule.",
    },
    {
      key: "remove-ephemeral-run-material",
      phase: "cleanup",
      capability: "sensitive-artifacts.remove",
      effect: "mutation",
      ownerActorId: "ap2-dev-orchestrator",
      marker,
      summary:
        "Remove the exact run-owned certificates, secrets, journals, and temporary evidence material.",
    },
  ],
  resources: [
    {
      id: "windows-avd-host",
      kind: "avd-personal-host",
      summary: "One Standard_D2s_v3 Windows 11 Enterprise 24H2 personal host.",
      ownerActorId: "ap2-dev-orchestrator",
      createOperationKey: "deploy-private-three-vm-topology",
      cleanupOperationKey: "delete-three-vm-resource-group",
      billable: true,
      expiresAt: expiry,
    },
    {
      id: "ubuntu-auxiliary-pair",
      kind: "linux-auxiliary-pair",
      summary: "Two Standard_F1als_v7 Ubuntu 24.04 LTS private nodes.",
      ownerActorId: "ap2-dev-orchestrator",
      createOperationKey: "deploy-private-three-vm-topology",
      cleanupOperationKey: "delete-three-vm-resource-group",
      billable: true,
      expiresAt: expiry,
    },
    {
      id: "shared-nat-egress",
      kind: "shared-nat-egress",
      summary: "One Standard NAT Gateway and one Standard static IPv4 address.",
      ownerActorId: "ap2-dev-orchestrator",
      createOperationKey: "deploy-private-three-vm-topology",
      cleanupOperationKey: "delete-three-vm-resource-group",
      billable: true,
      expiresAt: expiry,
    },
    {
      id: "marker-endpoint-lifecycle",
      kind: "endpoint-lifecycle",
      summary: "Marker group plus Intune and Defender policies for Windows.",
      ownerActorId: "ap2-dev-orchestrator",
      createOperationKey: "onboard-windows-endpoint",
      cleanupOperationKey: "offboard-windows-endpoint",
      billable: false,
    },
    {
      id: "marker-expiry-schedule",
      kind: "expiry-schedule",
      summary: "One marker-bound cleanup schedule for the bounded run.",
      ownerActorId: "ap2-dev-orchestrator",
      createOperationKey: "schedule-expiry-cleanup",
      cleanupOperationKey: "remove-expiry-cleanup",
      billable: false,
      expiresAt: expiry,
    },
    {
      id: "ephemeral-sensitive-run-material",
      kind: "ephemeral-sensitive-artifacts",
      summary:
        "Run-owned credentials, journals, and detailed evidence retained only through reconciliation.",
      ownerActorId: "ap2-dev-orchestrator",
      createOperationKey: "prepare-ephemeral-run-material",
      cleanupOperationKey: "remove-ephemeral-run-material",
      billable: false,
      expiresAt: expiry,
    },
  ],
  permissions: [
    {
      id: "endpoint-configuration-write",
      kind: "graph-app-role",
      name: "DeviceManagementConfiguration.ReadWrite.All",
      actorId: "ap2-dev-orchestrator",
      scope: "Microsoft Graph application",
      purpose: "Create and remove the marker-bound endpoint policies.",
      mode: "temporary",
      grantOperationKey: "grant-temporary-endpoint-roles",
      revocationOperationKey: "revoke-temporary-endpoint-roles",
      revocationOwnerActorId: "ap2-dev-orchestrator",
    },
    {
      id: "managed-device-write",
      kind: "graph-app-role",
      name: "DeviceManagementManagedDevices.ReadWrite.All",
      actorId: "ap2-dev-orchestrator",
      scope: "Microsoft Graph application",
      purpose: "Remove the exact run-owned Intune managed-device record.",
      mode: "temporary",
      grantOperationKey: "grant-temporary-endpoint-roles",
      revocationOperationKey: "revoke-temporary-endpoint-roles",
      revocationOwnerActorId: "ap2-dev-orchestrator",
    },
    {
      id: "existing-azure-control-plane",
      kind: "azure-role",
      name: "Existing AP2 lab control-plane access",
      actorId: "ap2-dev-orchestrator",
      scope: "Dedicated AP2 lab subscription",
      purpose: "Create, verify, and remove exact run-owned Azure resources.",
      mode: "retained",
      retentionRationale: "Predates and is shared across bounded AP2 canaries.",
    },
  ],
  evidence: {
    staging:
      "The Dev orchestrator builds and verifies the private three-VM substrate before its expiry cleanup.",
    learnerReceives:
      "No learner-visible session evidence was produced in this canary; only protected control-plane and endpoint-readiness evidence exists.",
    artifacts: [
      {
        id: "avd-host-readiness",
        kind: "avd-topology",
        authenticity: "platform-control-plane",
        state: "observed",
        learnerVisibility: "not-proven",
        sourceOperationKey: "observe-avd-endpoint",
        claim:
          "The personal Windows 11 host was Available and directly assigned with zero user sessions.",
        semanticClaims: ["avd-ready"],
        retention: "retained",
        observation: {
          operationKey: "observe-avd-endpoint",
          proofReference:
            "canonical:proven-capabilities/private-three-vm-avd",
        },
      },
      {
        id: "private-three-vm-topology",
        kind: "private-network-topology",
        authenticity: "platform-control-plane",
        state: "observed",
        learnerVisibility: "not-proven",
        sourceOperationKey: "observe-three-vm-topology",
        claim:
          "One private Windows host and two private Ubuntu nodes shared NAT egress and exact marker health paths.",
        semanticClaims: ["private-three-vm-topology"],
        retention: "retained",
        observation: {
          operationKey: "observe-three-vm-topology",
          proofReference:
            "canonical:proven-capabilities/private-three-vm-avd",
        },
      },
      {
        id: "windows-endpoint-posture",
        kind: "endpoint-posture",
        authenticity: "platform-control-plane",
        state: "observed",
        learnerVisibility: "not-proven",
        sourceOperationKey: "observe-avd-endpoint",
        claim:
          "The Windows endpoint was Entra joined, Intune compliant, and Defender onboarded before offboarding.",
        semanticClaims: ["endpoint-managed"],
        retention: "retained",
        observation: {
          operationKey: "observe-avd-endpoint",
          proofReference:
            "canonical:proven-capabilities/private-three-vm-avd",
        },
      },
      {
        id: "final-cleanup-state",
        kind: "cleanup-state",
        authenticity: "platform-control-plane",
        state: "observed",
        learnerVisibility: "not-proven",
        sourceOperationKey: "observe-final-cleanup",
        claim:
          "Final reconciliation found infrastructure, endpoint records and marker policies/groups, temporary roles, the expiry schedule, and ephemeral sensitive run material absent.",
        semanticClaims: [
          "infrastructure-removed",
          "endpoint-state-removed",
          "permissions-revoked",
          "expiry-removed",
          "sensitive-artifacts-absent",
        ],
        retention: "retained",
        observation: {
          operationKey: "observe-final-cleanup",
          proofReference:
            "canonical:proven-capabilities/private-three-vm-avd",
        },
      },
    ],
  },
  learner: {
    task:
      "In a future authorized lab, inspect the personal desktop and reason about the two private auxiliary services.",
    expectedInterpretation:
      "The topology is a prepared private lab substrate; this canary did not prove a learner session or completed task.",
    completionState: "not-run",
    evidenceArtifactIds: [
      "avd-host-readiness",
      "private-three-vm-topology",
      "windows-endpoint-posture",
      "final-cleanup-state",
    ],
  },
  responseActions: [
    {
      id: "future-substrate-inspection",
      kind: "investigate",
      ownerActorId: "fixed-learner",
      operationKey: "inspect-future-substrate",
      summary: "Reserved for a later learner session; not completed here.",
    },
  ],
  lifecycle: {
    expiresAt: expiry,
    cleanupOwnerActorId: "ap2-dev-orchestrator",
    cleanupOperationKeys: [
      "offboard-windows-endpoint",
      "delete-three-vm-resource-group",
      "revoke-temporary-endpoint-roles",
      "remove-expiry-cleanup",
      "remove-ephemeral-run-material",
    ],
    retainedArtifacts: [
      {
        artifactId: "avd-host-readiness",
        custodianActorId: "ap2-dev-orchestrator",
        disposition: "retain-audit-history",
        rationale: "Reduced protected readiness evidence preserves the result.",
      },
      {
        artifactId: "private-three-vm-topology",
        custodianActorId: "ap2-dev-orchestrator",
        disposition: "retain-audit-history",
        rationale: "Reduced protected topology evidence preserves the result.",
      },
      {
        artifactId: "windows-endpoint-posture",
        custodianActorId: "ap2-dev-orchestrator",
        disposition: "retain-audit-history",
        rationale: "Reduced protected endpoint evidence preserves the result.",
      },
      {
        artifactId: "final-cleanup-state",
        custodianActorId: "ap2-dev-orchestrator",
        disposition: "retain-audit-history",
        rationale:
          "Reduced cleanup reconciliation preserves absence without retaining sensitive run material.",
      },
    ],
  },
  cost: {
    currency: "USD",
    laneMaximum: 10,
    conservativeDurationHours: 5,
    assumption:
      "Four-hour public-price projection USD 4.21490411 plus one full extra billed provisioning hour produced USD 4.59363014, below the USD 10 ceiling.",
  },
} satisfies ScenarioManifest);
