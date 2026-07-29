import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest.ts";

const marker = "ap2-purview-audit-boundary";

export const PURVIEW_AUDIT_BOUNDARY_SCENARIO = parseScenarioManifest({
  schemaVersion: 2,
  id: "purview-sharepoint-audit-boundary",
  title: "Purview SharePoint operation-audit boundary",
  summary:
    "A distinct detector reaches Microsoft Graph Purview Audit Search and observes exact operation-level producer attribution.",
  actors: [
    {
      id: "purview-lab-harness",
      label: "Purview lab harness",
      kind: "lab-harness",
      summary: "Owns the bounded historical evidence window.",
    },
    {
      id: "sharepoint-workload-app",
      label: "SharePoint workload application",
      kind: "application",
      summary: "Performed the historical harmless SharePoint operation.",
    },
    {
      id: "purview-detector-app",
      label: "Independent Purview detector application",
      kind: "application",
      summary: "Submitted and observed only bounded audit searches.",
    },
    {
      id: "security-learner",
      label: "Security learner",
      kind: "human",
      summary: "Receives only the sanitized capability boundary.",
    },
  ],
  roles: {
    evidenceProducer: "purview-lab-harness",
    workloadActor: "sharepoint-workload-app",
    learner: "security-learner",
    detector: "purview-detector-app",
  },
  authentication: [
    {
      actorId: "sharepoint-workload-app",
      transport: "managed-identity",
      summary: "The historical operation used the fixed API managed identity.",
    },
    {
      actorId: "purview-detector-app",
      transport: "application-only",
      summary: "A distinct fixed detector used Microsoft Graph app-only.",
    },
  ],
  trigger: { kind: "staged" },
  detection: { kind: "independent" },
  prerequisites: [
    {
      id: "historical-sharepoint-event",
      kind: "evidence",
      summary: "One harmless historical SharePoint event is already retained.",
      requiredState: "No new workload event is needed.",
    },
  ],
  operations: [
    {
      key: "submit-bounded-audit-query",
      phase: "evidence",
      capability: "purview.audit-query",
      effect: "mutation",
      ownerActorId: "purview-detector-app",
      marker,
      summary: "Submit one bounded marker-owned audit search without replay.",
    },
    {
      key: "read-bounded-audit-status",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "purview-detector-app",
      summary: "Read only the bounded query status or capped result page.",
    },
    {
      key: "interpret-audit-boundary",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "security-learner",
      summary: "Distinguish reachability from operation attribution.",
    },
    {
      key: "close-purview-evidence-window",
      phase: "cleanup",
      capability: "evidence-window.close",
      effect: "mutation",
      ownerActorId: "purview-lab-harness",
      marker,
      summary: "Close the local sanitized evidence window.",
    },
  ],
  resources: [],
  permissions: [
    {
      id: "existing-purview-audit-read",
      kind: "graph-app-role",
      name: "Existing diagnostic audit read",
      actorId: "purview-detector-app",
      scope: "Microsoft Graph application",
      purpose: "Reach the bounded Purview Audit Search surface.",
      mode: "retained",
      retentionRationale: "No authority was created by this scenario.",
    },
  ],
  evidence: {
    staging:
      "The detector queries only the already-retained historical evidence window.",
    learnerReceives:
      "A sanitized result that separates surface reachability from exact operation-level producer attribution.",
    artifacts: [
      {
        id: "purview-query-boundary",
        kind: "purview-audit-summary",
        authenticity: "platform-control-plane",
        state: "observed",
        learnerVisibility: "not-proven",
        sourceOperationKey: "submit-bounded-audit-query",
        claim:
          "Microsoft Graph returned exact producer-attributed operation records to the distinct detector.",
        semanticClaims: ["purview-surface-reachability"],
        retention: "retained",
        observation: {
          operationKey: "read-bounded-audit-status",
          proofReference:
            "canonical:purview-audit-contract/live-proven",
        },
      },
    ],
  },
  learner: {
    task:
      "Explain why accepted or empty audit searches do not prove producer attribution.",
    expectedInterpretation:
      "Surface reachability alone is insufficient; exact operation, producer application, target, time, and correlation fields prove this bounded attribution.",
    completionState: "not-run",
    evidenceArtifactIds: ["purview-query-boundary"],
  },
  responseActions: [
    {
      id: "report-purview-boundary",
      kind: "report",
      ownerActorId: "security-learner",
      operationKey: "interpret-audit-boundary",
      summary: "Report the bounded result without promoting attribution.",
    },
  ],
  lifecycle: {
    expiresAt: "2026-08-31T23:59:59Z",
    cleanupOwnerActorId: "purview-lab-harness",
    cleanupOperationKeys: ["close-purview-evidence-window"],
    retainedArtifacts: [
      {
        artifactId: "purview-query-boundary",
        custodianActorId: "purview-lab-harness",
        disposition: "retain-audit-history",
        rationale: "Normal audit-search history is accepted residue.",
      },
    ],
  },
  cost: {
    currency: "USD",
    laneMaximum: 0,
    conservativeDurationHours: 1,
    assumption: "Existing identities and Microsoft 365 audit service only.",
  },
} satisfies ScenarioManifest);
