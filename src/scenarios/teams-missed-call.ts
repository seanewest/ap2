import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest.ts";

const marker = "teams-missed-call-controlled-20260729";

export const TEAMS_MISSED_CALL_SCENARIO = parseScenarioManifest({
  schemaVersion: 2,
  id: "teams-missed-call-observation",
  title: "Controlled Teams missed-call observation",
  summary:
    "An instructor stages one unanswered lab call through Kobe; the learner inspects the resulting Cory-side Teams evidence.",
  actors: [
    {
      id: "ap2-instructor",
      label: "AP2 instructor",
      kind: "orchestrator",
      summary: "Controls the one-attempt staging boundary and cleanup.",
    },
    {
      id: "kobe-lab-user",
      label: "Kobe lab user",
      kind: "simulated-user",
      summary: "Places the controlled Teams call.",
    },
    {
      id: "learner-in-cory-view",
      label: "Learner using Cory's lab Teams view",
      kind: "human",
      summary: "Inspects and interprets the resulting evidence.",
    },
  ],
  roles: {
    evidenceProducer: "ap2-instructor",
    workloadActor: "kobe-lab-user",
    learner: "learner-in-cory-view",
  },
  authentication: [
    {
      actorId: "kobe-lab-user",
      transport: "teams-client",
      summary: "Kobe's licensed lab Teams client session",
    },
    {
      actorId: "learner-in-cory-view",
      transport: "teams-client",
      summary: "Cory's separate lab Teams client view",
    },
  ],
  trigger: { kind: "staged" },
  prerequisites: [
    {
      id: "licensed-lab-users",
      kind: "license",
      summary: "Kobe and Cory are fixed licensed fictional lab users.",
      requiredState: "Private Teams calling is allowed for both users.",
    },
  ],
  operations: [
    {
      key: "stage-one-audio-call",
      phase: "evidence",
      capability: "teams.audio-call.manual",
      effect: "mutation",
      ownerActorId: "ap2-instructor",
      marker,
      summary: "Place one bounded Kobe-to-Cory audio call without retry.",
    },
    {
      key: "read-cory-call-history",
      phase: "evidence",
      capability: "teams.call-history.read",
      effect: "read",
      ownerActorId: "learner-in-cory-view",
      summary: "Inspect Cory's missed-call history and Activity.",
    },
    {
      key: "interpret-missed-call",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "learner-in-cory-view",
      summary: "Correlate the two native Teams surfaces.",
    },
    {
      key: "clean-retained-call-history",
      phase: "cleanup",
      capability: "teams.history.cleanup",
      effect: "mutation",
      ownerActorId: "ap2-instructor",
      marker,
      summary: "Reconcile and clean only the retained lab call artifact.",
    },
  ],
  resources: [],
  permissions: [
    {
      id: "kobe-private-calling",
      kind: "teams-policy",
      name: "Private calling",
      actorId: "kobe-lab-user",
      scope: "Fixed AP2 lab user",
      purpose: "Permit the controlled user-to-user call.",
      mode: "retained",
      retentionRationale: "Existing lab policy, not created for this scenario.",
    },
  ],
  evidence: {
    staging:
      "The instructor uses Kobe's lab session to place one unanswered call to Cory, then stops.",
    learnerReceives:
      "One Missed incoming call entry and one matching Teams activity item in Cory's lab view.",
    artifacts: [
      {
        id: "cory-missed-call",
        kind: "teams-missed-call",
        authenticity: "platform-native",
        state: "observed",
        learnerVisibility: "observed",
        sourceOperationKey: "stage-one-audio-call",
        claim:
          "Cory's Teams view contains one Kobe Missed incoming entry and matching Activity notification.",
        semanticClaims: ["teams-missed-call"],
        retention: "retained",
        observation: {
          operationKey: "read-cory-call-history",
          proofReference:
            "canonical:proven-capabilities/controlled-teams-missed-call",
        },
      },
    ],
  },
  learner: {
    task:
      "Correlate the two Teams surfaces and explain what they prove without returning the call.",
    expectedInterpretation:
      "The two entries are evidence of one missed Teams call; they do not prove voicemail.",
    completionState: "available",
    evidenceArtifactIds: ["cory-missed-call"],
  },
  responseActions: [
    {
      id: "report-observation",
      kind: "report",
      ownerActorId: "learner-in-cory-view",
      operationKey: "interpret-missed-call",
      summary: "Report the bounded interpretation without calling back.",
    },
  ],
  lifecycle: {
    expiresAt: "2026-08-31T23:59:59Z",
    cleanupOwnerActorId: "ap2-instructor",
    cleanupOperationKeys: ["clean-retained-call-history"],
    retainedArtifacts: [
      {
        artifactId: "cory-missed-call",
        custodianActorId: "ap2-instructor",
        disposition: "cleanup-later",
        rationale: "Native history is retained until the authorized cleanup lane.",
        cleanupOperationKey: "clean-retained-call-history",
      },
    ],
  },
  cost: {
    currency: "USD",
    laneMaximum: 0,
    conservativeDurationHours: 0.25,
    assumption: "Existing licensed lab users and clients only.",
  },
} satisfies ScenarioManifest);
