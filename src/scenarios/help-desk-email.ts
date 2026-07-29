import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest.ts";

const marker = "ap2-help-desk-email-20260729-001";

export const HELP_DESK_EMAIL_SCENARIO = parseScenarioManifest({
  schemaVersion: 2,
  id: "help-desk-email-observation",
  title: "Kobe help-desk email for Cory",
  summary:
    "AP2 stages one fixed Outlook email from Kobe so the learner can interpret a fictional help-desk follow-up.",
  actors: [
    {
      id: "ap2-orchestrator",
      label: "AP2 orchestrator",
      kind: "orchestrator",
      summary: "Owns the one-shot journal, verification, and later cleanup.",
    },
    {
      id: "kobe-lab-user",
      label: "Kobe West",
      kind: "simulated-user",
      summary: "Appears as the distinct fictional email sender.",
    },
    {
      id: "cory-learner",
      label: "Learner using Cory's mailbox",
      kind: "human",
      summary: "Inspects and interprets the fixed lab email.",
    },
  ],
  roles: {
    evidenceProducer: "ap2-orchestrator",
    workloadActor: "kobe-lab-user",
    learner: "cory-learner",
  },
  authentication: [
    {
      actorId: "ap2-orchestrator",
      transport: "application-only",
      summary: "Exact AP2 API application role authorizes the product route.",
    },
    {
      actorId: "kobe-lab-user",
      transport: "delegated-user",
      summary: "Exact Kobe CBA session with Mail.Send.",
    },
    {
      actorId: "cory-learner",
      transport: "delegated-user",
      summary:
        "Exact Cory CBA session permits bounded mailbox observation and learner access.",
    },
  ],
  trigger: { kind: "staged" },
  prerequisites: [
    {
      id: "exact-kobe-cory-identities",
      kind: "identity",
      summary: "Kobe is the producer identity and Cory is the learner mailbox.",
      requiredState: "Both exact tenant-local fictional users are enabled.",
    },
    {
      id: "delegated-mail-send",
      kind: "permission",
      summary: "The shared simulated-user client has delegated Mail.Send.",
      requiredState: "Kobe CBA and exact /me verification pass.",
    },
    {
      id: "exclusive-one-shot-journal",
      kind: "evidence",
      summary: "The fixed marker has one private exclusive journal.",
      requiredState: "Zero exact pre-existing Cory message matches.",
    },
  ],
  operations: [
    {
      key: "verify-fixed-identities",
      phase: "setup",
      capability: "identity.verify",
      effect: "read",
      ownerActorId: "ap2-orchestrator",
      summary: "Verify exact Kobe, Cory, tenant, and API caller identities.",
    },
    {
      key: "read-marker-before",
      phase: "setup",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "cory-learner",
      summary: "Read Cory's mailbox for the exact fixed subject before dispatch.",
    },
    {
      key: "send-help-desk-email",
      phase: "evidence",
      capability: "help-desk-email.send",
      effect: "mutation",
      ownerActorId: "ap2-orchestrator",
      marker,
      summary: "Submit the fixed Kobe-to-Cory Outlook email once.",
    },
    {
      key: "read-marker-after",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "cory-learner",
      summary: "Verify the exact non-draft message in Cory's Inbox.",
    },
    {
      key: "interpret-help-desk-email",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "cory-learner",
      summary: "Interpret the fixed email without treating it as call evidence.",
    },
    {
      key: "delete-retained-help-desk-email",
      phase: "cleanup",
      capability: "mail.delete-exact",
      effect: "mutation",
      ownerActorId: "ap2-orchestrator",
      marker,
      summary: "Delete only the privately inventoried message when authorized.",
    },
  ],
  resources: [],
  permissions: [
    {
      id: "ap2-help-desk-route",
      kind: "graph-app-role",
      name: "Existing AP2 help-desk route authorization",
      actorId: "ap2-orchestrator",
      scope: "AP2 product API",
      purpose: "Authorize the fixed product operation.",
      mode: "retained",
      retentionRationale: "Pre-existing AP2 product authorization.",
    },
    {
      id: "kobe-mail-send",
      kind: "delegated-scope",
      name: "Mail.Send",
      actorId: "kobe-lab-user",
      scope: "Microsoft Graph delegated",
      purpose: "Submit the fixed help-desk email as Kobe.",
      mode: "retained",
      retentionRationale: "Pre-existing shared Pass 3 simulated-user consent.",
    },
    {
      id: "cory-mailbox-read",
      kind: "delegated-scope",
      name: "Mail.ReadWrite",
      actorId: "cory-learner",
      scope: "Microsoft Graph delegated",
      purpose:
        "Observe the exact marked learner-facing Inbox artifact and support later exact cleanup.",
      mode: "retained",
      retentionRationale: "Pre-existing shared Pass 3 simulated-user consent.",
    },
  ],
  evidence: {
    staging:
      "The AP2 API invokes the fixed one-shot Kobe-to-Cory send operation.",
    learnerReceives:
      "One non-draft Outlook email in Cory's Inbox with the fixed AP2 marker, subject, and body.",
    artifacts: [
      {
        id: "cory-help-desk-email",
        kind: "outlook-email",
        authenticity: "platform-native",
        state: "observed",
        learnerVisibility: "observed",
        sourceOperationKey: "send-help-desk-email",
        claim:
          "Cory's Inbox contains exactly one fixed email from Kobe to Cory.",
        semanticClaims: ["outlook-email"],
        retention: "retained",
        observation: {
          operationKey: "read-marker-after",
          proofReference:
            "canonical:proven-capabilities/help-desk-email",
        },
      },
    ],
  },
  learner: {
    task:
      "Inspect the email and explain the fictional help-desk follow-up it represents.",
    expectedInterpretation:
      "This is an authentic Outlook email artifact; it is not a Teams call, missed call, or voicemail.",
    completionState: "available",
    evidenceArtifactIds: ["cory-help-desk-email"],
  },
  responseActions: [
    {
      id: "report-help-desk-interpretation",
      kind: "report",
      ownerActorId: "cory-learner",
      operationKey: "interpret-help-desk-email",
      summary: "Report the interpretation without replying or forwarding.",
    },
  ],
  lifecycle: {
    expiresAt: "2026-08-31T23:59:59Z",
    cleanupOwnerActorId: "ap2-orchestrator",
    cleanupOperationKeys: ["delete-retained-help-desk-email"],
    retainedArtifacts: [
      {
        artifactId: "cory-help-desk-email",
        custodianActorId: "ap2-orchestrator",
        disposition: "cleanup-later",
        rationale:
          "The exact message is privately inventoried for the later retained-artifact cleanup lane.",
        cleanupOperationKey: "delete-retained-help-desk-email",
      },
    ],
  },
  cost: {
    currency: "USD",
    laneMaximum: 0,
    conservativeDurationHours: 1,
    assumption: "Existing Microsoft 365 lab licenses and AP2 resources only.",
  },
} satisfies ScenarioManifest);
