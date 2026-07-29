import { describe, expect, it } from "vitest";
import {
  createScenarioPlan,
  parseScenarioManifest,
  ScenarioManifestError,
  type ScenarioManifest,
} from "./scenario-manifest";
import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from "./private-document-evidence";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from "./purview-audit-boundary";
import { SCENARIO_MANIFESTS } from "./scenarios";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

const marker = "test-scenario-001";
const separatedScenario = {
  schemaVersion: 2,
  id: "separated-scenario",
  title: "Separated scenario",
  summary: "A minimal runtime-valid separated scenario.",
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
      summary: "A separate delegated lab-user session.",
    },
  ],
  trigger: { kind: "staged" },
  detection: { kind: "none" },
  prerequisites: [
    {
      id: "fixed-identities",
      kind: "identity",
      summary: "Fixed lab identities exist.",
      requiredState: "Exact identities are enabled.",
    },
  ],
  operations: [
    {
      key: "stage-evidence",
      phase: "evidence",
      capability: "help-desk-email.send",
      effect: "mutation",
      ownerActorId: "producer",
      marker,
      summary: "Stage one fixed artifact.",
    },
    {
      key: "learner-inspect",
      phase: "response",
      capability: "learner.inspect",
      effect: "read",
      ownerActorId: "learner",
      summary: "Inspect the artifact.",
    },
    {
      key: "observe-evidence",
      phase: "evidence",
      capability: "artifact.read-exact",
      effect: "read",
      ownerActorId: "producer",
      summary: "Observe the exact staged artifact.",
    },
    {
      key: "clean-evidence",
      phase: "cleanup",
      capability: "mail.delete-exact",
      effect: "mutation",
      ownerActorId: "producer",
      marker,
      summary: "Clean only the fixed artifact.",
    },
  ],
  resources: [],
  permissions: [],
  evidence: {
    staging: "The instructor stages one event.",
    learnerReceives: "One bounded Outlook email.",
    artifacts: [
      {
        id: "email-evidence",
        kind: "outlook-email",
        authenticity: "platform-native",
        state: "observed",
        learnerVisibility: "observed",
        sourceOperationKey: "stage-evidence",
        claim: "One exact Outlook email is present.",
        semanticClaims: ["outlook-email"],
        retention: "retained",
        observation: {
          operationKey: "observe-evidence",
          proofReference: "canonical:test/evidence-result",
        },
      },
    ],
  },
  learner: {
    task: "Interpret the observation.",
    expectedInterpretation: "The artifact is an Outlook email.",
    completionState: "available",
    evidenceArtifactIds: ["email-evidence"],
  },
  responseActions: [
    {
      id: "report-observation",
      kind: "report",
      ownerActorId: "learner",
      operationKey: "learner-inspect",
      summary: "Report the interpretation.",
    },
  ],
  lifecycle: {
    expiresAt: "2026-08-31T23:59:59Z",
    cleanupOwnerActorId: "producer",
    cleanupOperationKeys: ["clean-evidence"],
    retainedArtifacts: [
      {
        artifactId: "email-evidence",
        custodianActorId: "producer",
        disposition: "cleanup-later",
        rationale: "Keep until the authorized cleanup lane.",
        cleanupOperationKey: "clean-evidence",
      },
    ],
  },
  cost: {
    currency: "USD",
    laneMaximum: 0,
    conservativeDurationHours: 1,
    assumption: "Existing lab licenses only.",
  },
} satisfies ScenarioManifest;

describe("generalized scenario manifest contract", () => {
  it("accepts the generalized separated-role contract", () => {
    const manifest = parseScenarioManifest(separatedScenario);

    expect(manifest.roles).toEqual({
      evidenceProducer: "producer",
      workloadActor: "workload",
      learner: "learner",
    });
    expect(manifest.lifecycle.cleanupOperationKeys).toEqual([
      "clean-evidence",
    ]);
    expect(manifest.cost).toEqual({
      currency: "USD",
      laneMaximum: 0,
      conservativeDurationHours: 1,
      assumption: "Existing lab licenses only.",
    });
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

    expect(manifest.trigger.kind).toBe("self-triggered");
  });

  it("fails closed on producer and learner conflation", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        roles: {
          ...separatedScenario.roles,
          evidenceProducer: "learner",
        },
      })
    ).toThrowError(
      "evidence producer and learner must differ unless trigger.kind is self-triggered",
    );
  });

  it("requires a detector for an independent-detection claim", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        detection: { kind: "independent" },
      })
    ).toThrowError(
      "roles.detector is required when detection.kind is independent",
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
      "independent detector and workload actor must differ",
    );
  });

  it("fails closed when the learner is assigned as an independent detector", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        roles: {
          ...separatedScenario.roles,
          detector: "learner",
        },
        detection: { kind: "independent" },
      })
    ).toThrowError(
      "independent detector and learner must differ",
    );
  });

  it("classifies every runnable and receipt-facing canonical role boundary", () => {
    const manifests = [
      ...SCENARIO_MANIFESTS,
      PURVIEW_AUDIT_BOUNDARY_SCENARIO,
    ];

    for (const manifest of manifests) {
      const actorIds = new Set(manifest.actors.map(({ id }) => id));
      expect(actorIds).toContain(manifest.roles.evidenceProducer);
      expect(actorIds).toContain(manifest.roles.workloadActor);
      expect(actorIds).toContain(manifest.roles.learner);
      expect(manifest.roles.evidenceProducer).not.toBe(manifest.roles.learner);

      if (manifest.detection?.kind === "independent") {
        expect(manifest.roles.detector).toBeDefined();
        expect(manifest.roles.detector).not.toBe(manifest.roles.workloadActor);
        expect(manifest.roles.detector).not.toBe(manifest.roles.learner);
      } else {
        expect(manifest.roles.detector).toBeUndefined();
      }
      for (const response of manifest.responseActions) {
        expect([
          manifest.roles.learner,
          manifest.roles.responder,
        ]).toContain(response.ownerActorId);
      }
    }

    const controlledHuman = TEAMS_MISSED_CALL_SCENARIO;
    const learner = controlledHuman.actors.find(
      ({ id }) => id === controlledHuman.roles.learner,
    );
    const observation = controlledHuman.evidence.artifacts[0]?.observation;
    const observationOperation = controlledHuman.operations.find(
      ({ key }) => key === observation?.operationKey,
    );
    expect(controlledHuman.detection).toEqual({ kind: "none" });
    expect(learner?.kind).toBe("human");
    expect(observationOperation?.ownerActorId).toBe(
      controlledHuman.roles.learner,
    );
  });

  it("rejects Teams semantics on an Outlook email artifact", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        evidence: {
          ...separatedScenario.evidence,
          artifacts: [
            {
              ...separatedScenario.evidence.artifacts[0],
              semanticClaims: ["teams-missed-call"],
            },
          ],
        },
      })
    ).toThrowError(
      "semanticClaims includes unsupported 'teams-missed-call' for outlook-email",
    );
  });

  it.each([
    ["expiry", { expiresAt: undefined }],
    ["cleanup", { cleanupOperationKeys: undefined }],
  ])("rejects missing lifecycle %s", (_label, lifecyclePatch) => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        lifecycle: {
          ...separatedScenario.lifecycle,
          ...lifecyclePatch,
        },
      })
    ).toThrow(ScenarioManifestError);
  });

  it("rejects missing cost", () => {
    const { cost: _cost, ...withoutCost } = separatedScenario;
    expect(() => parseScenarioManifest(withoutCost)).toThrowError(
      "cost must be an object",
    );
  });

  it("rejects a billable resource without expiry", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: [
          {
            key: "create-billable",
            phase: "setup",
            capability: "azure.three-vm.deploy",
            effect: "mutation",
            ownerActorId: "producer",
            marker,
            summary: "Create one billable resource.",
          },
          ...separatedScenario.operations,
        ],
        resources: [
          {
            id: "billable-resource",
            kind: "avd-personal-host",
            summary: "One billable host.",
            ownerActorId: "producer",
            createOperationKey: "create-billable",
            cleanupOperationKey: "clean-evidence",
            billable: true,
          },
        ],
      })
    ).toThrowError("expiresAt is required for a billable resource");
  });

  it("rejects a zero-cost lane containing a billable resource", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: [
          {
            key: "create-billable",
            phase: "setup",
            capability: "azure.three-vm.deploy",
            effect: "mutation",
            ownerActorId: "producer",
            marker,
            summary: "Create one billable resource.",
          },
          ...separatedScenario.operations,
        ],
        resources: [
          {
            id: "billable-resource",
            kind: "avd-personal-host",
            summary: "One billable host.",
            ownerActorId: "producer",
            createOperationKey: "create-billable",
            cleanupOperationKey: "clean-evidence",
            billable: true,
            expiresAt: "2026-08-31T23:59:59Z",
          },
        ],
      })
    ).toThrowError(
      "cost.laneMaximum must be greater than zero when resources are billable",
    );
  });

  it("rejects a resource whose cleanup marker differs from creation", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: [
          {
            key: "create-resource",
            phase: "setup",
            capability: "azure.three-vm.deploy",
            effect: "mutation",
            ownerActorId: "producer",
            marker: "resource-a",
            summary: "Create one marked resource.",
          },
          ...separatedScenario.operations,
        ],
        resources: [
          {
            id: "marked-resource",
            kind: "avd-personal-host",
            summary: "One marked resource.",
            ownerActorId: "producer",
            createOperationKey: "create-resource",
            cleanupOperationKey: "clean-evidence",
            billable: false,
          },
        ],
      })
    ).toThrowError(
      "create and cleanup operations must use the same marker",
    );
  });

  it("rejects a temporary permission without revocation ownership", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        permissions: [
          {
            id: "temporary-role",
            kind: "graph-app-role",
            name: "Temporary role",
            actorId: "producer",
            scope: "Lab tenant",
            purpose: "Bounded setup.",
            mode: "temporary",
            grantOperationKey: "stage-evidence",
            revocationOperationKey: "clean-evidence",
          },
        ],
      })
    ).toThrowError("revocationOwnerActorId must be a non-empty string");
  });

  it("rejects temporary permission revocation under a different marker", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: [
          {
            key: "grant-temporary",
            phase: "setup",
            capability: "permission.grant",
            effect: "mutation",
            ownerActorId: "producer",
            marker: "grant-marker",
            summary: "Grant one temporary permission.",
          },
          {
            key: "revoke-temporary",
            phase: "cleanup",
            capability: "permission.revoke",
            effect: "mutation",
            ownerActorId: "producer",
            marker: "revoke-marker",
            summary: "Revoke one temporary permission.",
          },
          ...separatedScenario.operations,
        ],
        permissions: [
          {
            id: "temporary-role",
            kind: "graph-app-role",
            name: "Temporary role",
            actorId: "producer",
            scope: "Lab tenant",
            purpose: "Bounded setup.",
            mode: "temporary",
            grantOperationKey: "grant-temporary",
            revocationOperationKey: "revoke-temporary",
            revocationOwnerActorId: "producer",
          },
        ],
        lifecycle: {
          ...separatedScenario.lifecycle,
          cleanupOperationKeys: [
            ...separatedScenario.lifecycle.cleanupOperationKeys,
            "revoke-temporary",
          ],
        },
      })
    ).toThrowError(
      "grant and revocation operations must use the same marker",
    );
  });

  it("rejects retained evidence without a custodian and disposition", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        lifecycle: {
          ...separatedScenario.lifecycle,
          retainedArtifacts: [],
        },
      })
    ).toThrowError(
      "retained evidence artifact 'email-evidence' requires a lifecycle inventory entry",
    );
  });

  it("rejects retained-artifact cleanup under a different marker", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: separatedScenario.operations.map((operation) =>
          operation.key === "clean-evidence"
            ? { ...operation, marker: "different-marker" }
            : operation
        ),
      })
    ).toThrowError(
      "source and cleanup operations must use the same marker",
    );
  });

  it("rejects a cleanup mutation without a marker", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: separatedScenario.operations.map((operation) =>
          operation.key === "clean-evidence"
            ? { ...operation, marker: undefined }
            : operation
        ),
      })
    ).toThrowError(
      "operations[3].marker is required for a mutating operation",
    );
  });

  it("rejects cleanup owned by anyone other than the lifecycle owner", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        operations: separatedScenario.operations.map((operation) =>
          operation.key === "clean-evidence"
            ? { ...operation, ownerActorId: "learner" }
            : operation
        ),
      })
    ).toThrowError(
      "lifecycle cleanup operation 'clean-evidence' must be owned by lifecycle.cleanupOwnerActorId",
    );
  });

  it("rejects claimed learner completion without learner-completed evidence", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        learner: {
          ...separatedScenario.learner,
          completionState: "completed",
        },
      })
    ).toThrowError(
      "completionState completed requires learner-completed visible evidence",
    );
  });

  it("rejects observed evidence without an exact read and proof reference", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        evidence: {
          ...separatedScenario.evidence,
          artifacts: [
            {
              ...separatedScenario.evidence.artifacts[0],
              observation: undefined,
            },
          ],
        },
      })
    ).toThrowError("observation must be an object for observed evidence");
  });

  it("rejects an unsanitized observation proof reference", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        evidence: {
          ...separatedScenario.evidence,
          artifacts: [
            {
              ...separatedScenario.evidence.artifacts[0],
              observation: {
                operationKey: "observe-evidence",
                proofReference: "unsafe-free-form-reference",
              },
            },
          ],
        },
      })
    ).toThrowError("must be a sanitized canonical evidence reference");
  });

  it("rejects platform acceptance presented as learner-visible evidence", () => {
    expect(() =>
      parseScenarioManifest({
        ...separatedScenario,
        evidence: {
          ...separatedScenario.evidence,
          artifacts: [
            {
              ...separatedScenario.evidence.artifacts[0],
              state: "platform-accepted",
              observation: undefined,
            },
          ],
        },
      })
    ).toThrowError(
      "cannot claim learner visibility from planned or platform-accepted evidence",
    );
  });

  it("validates the help-desk fixture without Teams or voicemail semantics", () => {
    const manifest = parseScenarioManifest(HELP_DESK_EMAIL_SCENARIO);
    expect(manifest.roles).toMatchObject({
      evidenceProducer: "ap2-orchestrator",
      workloadActor: "kobe-lab-user",
      learner: "cory-learner",
    });
    expect(manifest.evidence.artifacts).toMatchObject([
      { semanticClaims: ["outlook-email"] },
    ]);
    expect(manifest.lifecycle.retainedArtifacts).toMatchObject([
      { disposition: "cleanup-later" },
    ]);
  });

  it("validates the three-VM fixture without claiming learner completion", () => {
    const manifest = parseScenarioManifest(AVD_THREE_VM_SCENARIO);
    expect(manifest.resources).toHaveLength(6);
    expect(manifest.cost.laneMaximum).toBe(10);
    expect(manifest.learner.completionState).toBe("not-run");
    expect(manifest.evidence.artifacts).toHaveLength(4);
    expect(
      manifest.evidence.artifacts.every(
        (artifact) => artifact.learnerVisibility === "not-proven",
      ),
    ).toBe(true);
  });

  it("keeps private-document platform acceptance separate from learner visibility", () => {
    const manifest = parseScenarioManifest(
      PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
    );
    expect(manifest.roles).toMatchObject({
      evidenceProducer: "ap2-orchestrator",
      workloadActor: "document-producer",
      learner: "document-learner",
    });
    expect(manifest.evidence.artifacts).toMatchObject([
      {
        state: "platform-accepted",
        learnerVisibility: "not-proven",
        semanticClaims: ["private-document-staged"],
        retention: "ephemeral",
      },
    ]);
    expect(manifest.learner.completionState).toBe("not-run");
    expect(manifest.lifecycle.cleanupOperationKeys).toEqual([
      "delete-direct-learner-read",
      "delete-private-text-file",
      "delete-private-run-folder",
    ]);
  });

  it("renders roles, learner interpretation, expiry, and cost", () => {
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
      "What the learner receivesOne Missed incoming call entry",
    );
    expect(panel.textContent).toContain(
      "Expected interpretationThe two entries are evidence of one missed Teams call",
    );
    expect(panel.textContent).toContain("Maximum costUSD 0");
    expect(panel.textContent).not.toContain("credential");
    expect(panel.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });

  it("preserves the separate reconnaissance workload and detector", () => {
    const panel = createScenarioPlan(OAUTH_APPLICATION_RECON_SCENARIO);

    expect(panel.textContent).toContain(
      "Workload actorReconnaissance workload application",
    );
    expect(panel.textContent).toContain(
      "Detector / observerIndependent audit observer application",
    );
  });
});
