import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";

const marker = "ap2-private-document-fixture";

export const PRIVATE_DOCUMENT_EVIDENCE_SCENARIO = parseScenarioManifest({
  schemaVersion: 2,
  id: "private-document-evidence",
  title: "Private document evidence staging",
  summary:
    "AP2 uses a distinct delegated producer to stage one harmless private text document and a direct learner-only read permission, then removes every active artifact.",
  actors: [
    {
      id: "ap2-orchestrator",
      label: "AP2 orchestrator",
      kind: "orchestrator",
      summary: "Owns the one-shot journal, claim boundary, and verification.",
    },
    {
      id: "document-producer",
      label: "Fictional document producer",
      kind: "simulated-user",
      summary: "Owns the tenant-local drive and performs exact mutations.",
    },
    {
      id: "document-learner",
      label: "Fictional document learner",
      kind: "simulated-user",
      summary: "Receives only the direct read permission and bounded read.",
    },
  ],
  roles: {
    evidenceProducer: "ap2-orchestrator",
    workloadActor: "document-producer",
    learner: "document-learner",
  },
  authentication: [
    {
      actorId: "document-producer",
      transport: "delegated-user",
      summary: "Existing delegated Files.ReadWrite scope and exact /me proof.",
    },
    {
      actorId: "document-learner",
      transport: "delegated-user",
      summary: "Existing delegated Files.Read scope and exact /me proof.",
    },
  ],
  trigger: { kind: "staged" },
  detection: { kind: "none" },
  prerequisites: [
    {
      id: "exact-distinct-actors",
      kind: "identity",
      summary: "The producer and learner are exact distinct tenant-local users.",
      requiredState: "Fresh delegated sessions and exact /me reads pass.",
    },
    {
      id: "private-producer-drive",
      kind: "resource",
      summary: "The producer owns the selected tenant-local business drive.",
      requiredState:
        "The complete root permission read contains only the exact owner.",
    },
    {
      id: "one-shot-run-journal",
      kind: "evidence",
      summary: "A unique marker and protected exclusive journal exist.",
      requiredState:
        "The exact run-folder path is absent and cleanup ownership is frozen.",
    },
  ],
  operations: [
    {
      key: "create-private-run-folder",
      phase: "evidence",
      capability: "private-document.folder-create",
      effect: "mutation",
      ownerActorId: "document-producer",
      marker,
      summary: "Create one exact marker-bound private run folder.",
    },
    {
      key: "create-private-text-file",
      phase: "evidence",
      capability: "private-document.file-create",
      effect: "mutation",
      ownerActorId: "document-producer",
      marker,
      summary: "Create the fixed harmless plain-text document once.",
    },
    {
      key: "grant-direct-learner-read",
      phase: "evidence",
      capability: "private-document.permission-create",
      effect: "mutation",
      ownerActorId: "document-producer",
      marker,
      summary:
        "Grant one direct signed-in learner read permission without a link or invitation.",
    },
    {
      key: "read-private-document-exact",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "document-learner",
      summary: "Attempt one bounded exact learner metadata or content read.",
    },
    {
      key: "inspect-private-document",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "document-learner",
      summary: "Future learner interpretation; not performed by the canary.",
    },
    {
      key: "delete-direct-learner-read",
      phase: "cleanup",
      capability: "private-document.permission-delete",
      effect: "mutation",
      ownerActorId: "document-producer",
      marker,
      summary: "Delete only the captured direct learner permission.",
    },
    {
      key: "delete-private-text-file",
      phase: "cleanup",
      capability: "private-document.file-delete",
      effect: "mutation",
      ownerActorId: "document-producer",
      marker,
      summary: "Delete only the exact run-owned document.",
    },
    {
      key: "delete-private-run-folder",
      phase: "cleanup",
      capability: "private-document.folder-delete",
      effect: "mutation",
      ownerActorId: "document-producer",
      marker,
      summary: "Delete the exact run folder only after proving it empty.",
    },
  ],
  resources: [],
  permissions: [
    {
      id: "producer-files-write",
      kind: "delegated-scope",
      name: "Files.ReadWrite",
      actorId: "document-producer",
      scope: "Microsoft Graph delegated",
      purpose: "Create, reconcile, and clean the exact private artifact.",
      mode: "retained",
      retentionRationale: "Pre-existing shared simulated-user consent.",
    },
    {
      id: "learner-files-read",
      kind: "delegated-scope",
      name: "Files.Read",
      actorId: "document-learner",
      scope: "Microsoft Graph delegated",
      purpose: "Attempt only the exact learner visibility read.",
      mode: "retained",
      retentionRationale: "Pre-existing shared simulated-user consent.",
    },
  ],
  evidence: {
    staging:
      "The producer creates one harmless private text file and one direct learner read grant through the one-shot journal.",
    learnerReceives:
      "A direct private-file permission is intended; learner-visible access must be observed separately.",
    artifacts: [
      {
        id: "private-text-document",
        kind: "private-document",
        authenticity: "platform-native",
        state: "platform-accepted",
        learnerVisibility: "not-proven",
        sourceOperationKey: "grant-direct-learner-read",
        claim:
          "The private document and exact direct read permission reached their producer-side desired state before cleanup.",
        semanticClaims: ["private-document-staged"],
        retention: "ephemeral",
      },
    ],
  },
  learner: {
    task: "Open and interpret the exact private text document.",
    expectedInterpretation:
      "This is an authentic private document artifact; no audit or detection attribution is implied.",
    completionState: "not-run",
    evidenceArtifactIds: ["private-text-document"],
  },
  responseActions: [],
  lifecycle: {
    expiresAt: "2026-08-31T23:59:59Z",
    cleanupOwnerActorId: "document-producer",
    cleanupOperationKeys: [
      "delete-direct-learner-read",
      "delete-private-text-file",
      "delete-private-run-folder",
    ],
    retainedArtifacts: [],
  },
  cost: {
    currency: "USD",
    laneMaximum: 0,
    conservativeDurationHours: 1,
    assumption: "Existing Microsoft 365 lab licenses only.",
  },
} satisfies ScenarioManifest);
