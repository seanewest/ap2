import { describe, expect, it } from "vitest";
import {
  createScenarioPlan,
  parseScenarioManifest,
  ScenarioManifestError,
  type ScenarioManifest,
} from "./scenario-manifest";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

const separatedScenario = {
  schemaVersion: 1,
  id: "separated-scenario",
  title: "Separated scenario",
  summary: "A minimal separated scenario.",
  actors: [
    {
      id: "producer",
      label: "Instructor",
      kind: "orchestrator",
      summary: "Stages evidence.",
    },
    {
      id: "workload",
      label: "Simulated user",
      kind: "simulated-user",
      summary: "Performs the operation.",
    },
    {
      id: "learner",
      label: "Learner",
      kind: "human",
      summary: "Inspects evidence.",
    },
  ],
  roles: {
    evidenceProducer: "producer",
    workloadActor: "workload",
    learner: "learner",
  },
  authentication: [
    {
      actorId: "workload",
      transport: "delegated-user",
      summary: "A separate delegated lab-user session",
    },
  ],
  trigger: { kind: "staged" },
  evidence: {
    staging: "The instructor stages one event.",
    learnerReceives: "One bounded observation.",
    learnerTask: "Interpret the observation.",
  },
} satisfies ScenarioManifest;

describe("scenario manifest role contract", () => {
  it("accepts a staged scenario with distinct producer and learner roles", () => {
    const manifest = parseScenarioManifest(separatedScenario);

    expect(manifest.roles).toEqual({
      evidenceProducer: "producer",
      workloadActor: "workload",
      learner: "learner",
    });
    expect(manifest.authentication).toEqual([
      {
        actorId: "workload",
        transport: "delegated-user",
        summary: "A separate delegated lab-user session",
      },
    ]);
  });

  it("accepts an explicit, explained self-triggered exercise", () => {
    const manifest = parseScenarioManifest({
      ...separatedScenario,
      roles: {
        ...separatedScenario.roles,
        evidenceProducer: "learner",
      },
      trigger: {
        kind: "self-triggered",
        rationale:
          "The learner action is intentionally the event being investigated.",
      },
    });

    expect(manifest.trigger).toEqual({
      kind: "self-triggered",
      rationale:
        "The learner action is intentionally the event being investigated.",
    });
  });

  it("rejects a scenario with a missing required role", () => {
    const { learner: _learner, ...incompleteRoles } =
      separatedScenario.roles;

    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        roles: incompleteRoles,
      })
    ).toThrowError(
      new ScenarioManifestError(
        "roles.learner must be a non-empty string.",
      ),
    );
  });

  it("fails closed on accidental producer and learner conflation", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        roles: {
          ...separatedScenario.roles,
          evidenceProducer: "learner",
        },
      })
    ).toThrowError(
      new ScenarioManifestError(
        "evidence producer and learner must differ unless trigger.kind is self-triggered.",
      ),
    );
  });

  it("requires a typed detector for an independent-detection claim", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        detection: { kind: "independent" },
      })
    ).toThrowError(
      new ScenarioManifestError(
        "roles.detector is required when detection.kind is independent.",
      ),
    );
  });

  it("fails closed on detector and workload-actor conflation", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        roles: {
          ...separatedScenario.roles,
          detector: "workload",
        },
        detection: { kind: "independent" },
      })
    ).toThrowError(
      new ScenarioManifestError(
        "independent detector and workload actor must differ.",
      ),
    );
  });

  it("rejects an unexplained self-trigger exception", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        roles: {
          ...separatedScenario.roles,
          evidenceProducer: "learner",
        },
        trigger: { kind: "self-triggered", rationale: " " },
      })
    ).toThrowError(
      new ScenarioManifestError(
        "trigger.rationale must be a non-empty string.",
      ),
    );
  });

  it("presents who stages evidence and what the learner receives", () => {
    const panel = createScenarioPlan(TEAMS_MISSED_CALL_SCENARIO);

    expect(panel.dataset.scenarioId).toBe(
      "teams-missed-call-observation",
    );
    expect(panel.textContent).toContain("Evidence producerAP2 instructor");
    expect(panel.textContent).toContain("Workload actorKobe lab user");
    expect(panel.textContent).toContain(
      "Learner / observerLearner using Cory's lab Teams view",
    );
    expect(panel.textContent).toContain(
      "Trigger modelStaged — the evidence producer and learner are separate",
    );
    expect(panel.textContent).toContain(
      "Who stages evidenceThe instructor uses Kobe's lab session",
    );
    expect(panel.textContent).toContain(
      "What the learner receivesOne Missed incoming call entry",
    );
    expect(panel.textContent).toContain(
      "Authentication — Kobe lab userKobe's licensed lab Teams client session",
    );
    expect(panel.textContent).not.toContain("credential");
    expect(panel.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });

  it("presents the reconnaissance workload and detector as separate apps", () => {
    const panel = createScenarioPlan(OAUTH_APPLICATION_RECON_SCENARIO);

    expect(panel.dataset.scenarioId).toBe(
      "oauth-application-reconnaissance",
    );
    expect(panel.textContent).toContain(
      "Workload actorReconnaissance workload application",
    );
    expect(panel.textContent).toContain(
      "Detector / observerIndependent audit observer application",
    );
    expect(panel.textContent).toContain(
      "Authentication — Independent audit observer application" +
        "A separate application-only session with bounded audit-read authority",
    );
    expect(panel.textContent).toContain(
      "What the learner receivesCounts and reachability for the four checks",
    );
    expect(OAUTH_APPLICATION_RECON_SCENARIO.detection).toEqual({
      kind: "independent",
    });
    expect(OAUTH_APPLICATION_RECON_SCENARIO.roles.detector).toBe(
      "audit-observer-app",
    );
    expect(OAUTH_APPLICATION_RECON_SCENARIO.roles.detector).not.toBe(
      OAUTH_APPLICATION_RECON_SCENARIO.roles.workloadActor,
    );
    expect(panel.textContent).not.toContain("credential");
    expect(panel.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });
});
