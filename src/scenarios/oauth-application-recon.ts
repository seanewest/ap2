import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";

export const OAUTH_APPLICATION_RECON_SCENARIO = parseScenarioManifest({
  schemaVersion: 1,
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
      summary: "A fixed lab application-only Microsoft Graph session",
    },
    {
      actorId: "audit-observer-app",
      transport: "application-only",
      summary:
        "A separate application-only session with bounded audit-read authority",
    },
    {
      actorId: "security-learner",
      transport: "operator-session",
      summary: "The learner receives sanitized scenario output only",
    },
  ],
  trigger: { kind: "staged" },
  detection: { kind: "independent" },
  evidence: {
    staging:
      "The lab harness runs four fixed read-only checks through the workload application, then uses the separate observer application to collect the bounded sign-in result.",
    learnerReceives:
      "Counts and reachability for the four checks plus a sanitized successful service-principal sign-in summary that names the producer and observer roles without secrets or internal IDs.",
    learnerTask:
      "Explain what the application could survey, distinguish the workload actor from the detector, and state why a sign-in event does not prove each individual read.",
  },
} satisfies ScenarioManifest);
