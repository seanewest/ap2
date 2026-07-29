import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "./scenario-manifest";

export const TEAMS_MISSED_CALL_SCENARIO = parseScenarioManifest({
  schemaVersion: 1,
  id: "teams-missed-call-observation",
  title: "Controlled Teams missed-call observation",
  summary:
    "An instructor stages one unanswered lab call through Kobe; the learner inspects the resulting Cory-side Teams evidence.",
  actors: [
    {
      id: "ap2-instructor",
      label: "AP2 instructor",
      kind: "orchestrator",
      summary: "Controls the one-attempt staging boundary and stop rule.",
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
  evidence: {
    staging:
      "The instructor uses Kobe's lab session to place one unanswered call to Cory, then stops.",
    learnerReceives:
      "One Missed incoming call entry and one matching Teams activity item in Cory's lab view.",
    learnerTask:
      "Correlate the two Teams surfaces and explain what they prove without returning the call.",
  },
} satisfies ScenarioManifest);
