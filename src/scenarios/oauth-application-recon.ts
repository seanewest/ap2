import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest.ts";

const marker = "ap2-application-recon-window";

export const OAUTH_APPLICATION_RECON_SCENARIO = parseScenarioManifest({
  schemaVersion: 2,
  id: "oauth-application-reconnaissance",
  title: "Application reconnaissance and audit observation",
  summary:
    "A lab harness runs four bounded read-only checks through one workload application while a different application observes the resulting sign-in evidence for the learner.",
  actors: [
    {
      id: "recon-lab-harness",
      label: "AP2 reconnaissance lab harness",
      kind: "lab-harness",
      summary: "Controls the read-only workload and evidence window.",
    },
    {
      id: "recon-workload-app",
      label: "Reconnaissance workload application",
      kind: "application",
      summary: "Performs the four fixed Microsoft Graph reads.",
    },
    {
      id: "audit-observer-app",
      label: "Independent audit observer application",
      kind: "application",
      summary: "Reads only the bounded service-principal sign-in evidence.",
    },
    {
      id: "security-learner",
      label: "Security learner",
      kind: "human",
      summary: "Interprets the safe workload and sign-in summaries.",
    },
  ],
  roles: {
    evidenceProducer: "recon-lab-harness",
    workloadActor: "recon-workload-app",
    learner: "security-learner",
    detector: "audit-observer-app",
  },
  authentication: [
    {
      actorId: "recon-workload-app",
      transport: "application-only",
      summary: "A fixed lab application-only Microsoft Graph session.",
    },
    {
      actorId: "audit-observer-app",
      transport: "application-only",
      summary:
        "A separate application-only session with bounded audit-read authority.",
    },
    {
      actorId: "security-learner",
      transport: "operator-session",
      summary: "The learner receives sanitized scenario output only.",
    },
  ],
  trigger: { kind: "staged" },
  detection: { kind: "independent" },
  prerequisites: [
    {
      id: "fixed-recon-applications",
      kind: "identity",
      summary: "The workload and audit observer are distinct fixed lab apps.",
      requiredState: "Exact application identities and roles are verified.",
    },
  ],
  operations: [
    {
      key: "run-bounded-recon-reads",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "recon-workload-app",
      summary: "Run only the four fixed read-only Graph checks.",
    },
    {
      key: "observe-bounded-sign-in",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "audit-observer-app",
      summary: "Collect the bounded service-principal sign-in summary.",
    },
    {
      key: "interpret-recon-summary",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "security-learner",
      summary: "Interpret the sanitized reachability and sign-in summary.",
    },
    {
      key: "close-evidence-window",
      phase: "cleanup",
      capability: "evidence-window.close",
      effect: "mutation",
      ownerActorId: "recon-lab-harness",
      marker,
      summary: "Close the exact in-memory evidence window.",
    },
  ],
  resources: [],
  permissions: [
    {
      id: "recon-read-authority",
      kind: "graph-app-role",
      name: "Existing bounded reconnaissance reads",
      actorId: "recon-workload-app",
      scope: "Microsoft Graph application",
      purpose: "Run the four fixed read-only checks.",
      mode: "retained",
      retentionRationale: "Existing lab application authority.",
    },
    {
      id: "audit-read-authority",
      kind: "graph-app-role",
      name: "Existing bounded audit read",
      actorId: "audit-observer-app",
      scope: "Microsoft Graph application",
      purpose: "Observe the bounded service-principal sign-in evidence.",
      mode: "retained",
      retentionRationale: "Existing lab observer authority.",
    },
  ],
  evidence: {
    staging:
      "The lab harness runs four fixed reads, then the separate observer collects the bounded sign-in result.",
    learnerReceives:
      "Sanitized reachability counts and a successful service-principal sign-in summary without secrets or internal IDs.",
    artifacts: [
      {
        id: "application-recon-summary",
        kind: "application-recon-summary",
        authenticity: "platform-control-plane",
        state: "observed",
        learnerVisibility: "observed",
        sourceOperationKey: "run-bounded-recon-reads",
        claim:
          "The learner receives bounded read results plus a separately observed sign-in summary.",
        semanticClaims: ["application-reconnaissance"],
        retention: "ephemeral",
        observation: {
          operationKey: "observe-bounded-sign-in",
          proofReference:
            "canonical:proven-capabilities/application-reconnaissance",
        },
      },
    ],
  },
  learner: {
    task:
      "Explain what the application could survey, distinguish the workload actor from the detector, and state why a sign-in event does not prove each individual read.",
    expectedInterpretation:
      "The workload and detector are distinct, and one sign-in summary does not prove every individual Graph read.",
    completionState: "available",
    evidenceArtifactIds: ["application-recon-summary"],
  },
  responseActions: [
    {
      id: "report-recon-interpretation",
      kind: "report",
      ownerActorId: "security-learner",
      operationKey: "interpret-recon-summary",
      summary: "Report the bounded interpretation.",
    },
  ],
  lifecycle: {
    expiresAt: "2026-08-31T23:59:59Z",
    cleanupOwnerActorId: "recon-lab-harness",
    cleanupOperationKeys: ["close-evidence-window"],
    retainedArtifacts: [],
  },
  cost: {
    currency: "USD",
    laneMaximum: 0,
    conservativeDurationHours: 1,
    assumption: "Existing AP2 lab applications only.",
  },
} satisfies ScenarioManifest);
