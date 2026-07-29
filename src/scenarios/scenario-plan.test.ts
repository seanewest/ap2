// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
  type ScenarioPlanningRequest,
} from "./scenario-plan";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

const REQUESTS = {
  "help-desk-email-observation": {
    scenarioId: "help-desk-email-observation",
    actorAliases: {
      evidenceProducer: "producer",
      workloadActor: "sender",
      learner: "learner",
      cleanupOwner: "producer",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T06:15:00Z",
    maximumBudgetUsd: 0,
  },
  "avd-three-vm-substrate": {
    scenarioId: "avd-three-vm-substrate",
    actorAliases: {
      evidenceProducer: "orchestrator",
      workloadActor: "endpoint",
      learner: "learner",
      responder: "orchestrator",
      cleanupOwner: "orchestrator",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T11:00:00Z",
    maximumBudgetUsd: 10,
  },
  "teams-missed-call-observation": {
    scenarioId: "teams-missed-call-observation",
    actorAliases: {
      evidenceProducer: "instructor",
      workloadActor: "caller",
      learner: "learner",
      cleanupOwner: "instructor",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T06:15:00Z",
    maximumBudgetUsd: 0,
  },
  "oauth-application-reconnaissance": {
    scenarioId: "oauth-application-reconnaissance",
    actorAliases: {
      evidenceProducer: "harness",
      workloadActor: "workload",
      learner: "learner",
      detector: "observer",
      cleanupOwner: "harness",
    },
    now: "2026-07-29T06:00:00Z",
    expiresAt: "2026-07-29T07:00:00Z",
    maximumBudgetUsd: 0,
  },
} as const satisfies Record<string, ScenarioPlanningRequest>;

describe("scenario execution-plan compiler", () => {
  it.each(Object.entries(REQUESTS))(
    "compiles canonical fixture %s through every required plan phase",
    (_scenarioId, request) => {
      const plan = compileScenarioExecutionPlan(request);
      const phases = plan.steps.map(({ phase }) => phase);

      expect(plan.kind).toBe("scenario-execution-plan");
      expect(phases).toContain("preflight");
      expect(phases).toContain("producer-operation");
      expect(phases).toContain("authentic-evidence");
      expect(phases).toContain("learner-interpretation");
      expect(phases).toContain("expiry");
      expect(phases).toContain("cleanup");
      expect(phases).toContain("terminal-verification");
      expect(plan.terminalProof.cleanupOperationKeys.length).toBeGreaterThan(0);
      expect(plan.terminalProof.evidenceArtifactIds.length).toBeGreaterThan(0);
      expect(plan.digestSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(plan.steps.map(({ sequence }) => sequence)).toEqual(
        plan.steps.map((_step, index) => index + 1),
      );
    },
  );

  it("is deterministic and hashes only canonical sanitized plan content", () => {
    const request = REQUESTS["help-desk-email-observation"];
    const first = compileScenarioExecutionPlan(request);
    const second = compileScenarioExecutionPlan(structuredClone(request));
    const output = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(first.digestSha256).toBe(second.digestSha256);
    expect(output).not.toMatch(/@|onmicrosoft|protected:|\/home\//i);
    expect(output).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(output).not.toMatch(
      /tenant|subscription|messageId|objectId|credential|certificate|token|session/i,
    );
  });

  it("distinguishes automated, human-only, learner, and detector steps", () => {
    const teams = compileScenarioExecutionPlan(
      REQUESTS["teams-missed-call-observation"],
    );
    const call = teams.steps.find(
      ({ operationCategory }) =>
        operationCategory === "teams.audio-call.manual",
    );
    expect(call).toMatchObject({
      owningRole: "evidenceProducer",
      actorAlias: "instructor",
      execution: "pre-seeded-reference",
      humanOnlyGate: false,
      ambiguityBehavior: "not-applicable",
      recoveryBehavior: "none",
    });

    const plannedTeams = {
      ...TEAMS_MISSED_CALL_SCENARIO,
      id: "planned-teams-missed-call",
      evidence: {
        ...TEAMS_MISSED_CALL_SCENARIO.evidence,
        artifacts: TEAMS_MISSED_CALL_SCENARIO.evidence.artifacts.map(
          (artifact) => ({
            ...artifact,
            state: "planned",
            learnerVisibility: "not-proven",
            observation: undefined,
          }),
        ),
      },
      learner: {
        ...TEAMS_MISSED_CALL_SCENARIO.learner,
        completionState: "not-run",
      },
    };
    const planned = compileScenarioExecutionPlan(
      {
        ...REQUESTS["teams-missed-call-observation"],
        scenarioId: "planned-teams-missed-call",
      },
      [plannedTeams],
    );
    expect(
      planned.steps.find(
        ({ operationCategory }) =>
          operationCategory === "teams.audio-call.manual",
      ),
    ).toMatchObject({
      execution: "human-only",
      humanOnlyGate: true,
      ambiguityBehavior: "stop-and-reconcile",
      recoveryBehavior: "read-only-reconcile-no-replay",
    });

    const recon = compileScenarioExecutionPlan(
      REQUESTS["oauth-application-reconnaissance"],
    );
    expect(
      recon.steps.find(({ operationKey }) =>
        operationKey === "run-bounded-recon-reads"
      ),
    ).toMatchObject({
      owningRole: "workloadActor",
      actorAlias: "workload",
      execution: "automated",
    });
    expect(
      recon.steps.find(({ operationKey }) =>
        operationKey === "observe-bounded-sign-in"
      ),
    ).toMatchObject({
      owningRole: "detector",
      actorAlias: "observer",
    });
  });

  it("orders final cleanup observation after every cleanup mutation", () => {
    const plan = compileScenarioExecutionPlan(
      REQUESTS["avd-three-vm-substrate"],
    );
    const finalObservation = plan.steps.findIndex(
      ({ operationKey }) => operationKey === "observe-final-cleanup",
    );
    const cleanupReferences = plan.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) =>
        step.phase === "cleanup" &&
        step.operationCategory !== "artifact.read-exact"
      );

    expect(finalObservation).toBeGreaterThan(
      Math.max(...cleanupReferences.map(({ index }) => index)),
    );
    expect(
      cleanupReferences.every(({ step }) =>
        step.execution === "pre-seeded-reference" &&
        step.ambiguityBehavior === "not-applicable"
      ),
    ).toBe(true);
    expect(plan.steps[finalObservation]).toMatchObject({
      phase: "cleanup",
      owningRole: "cleanupOwner",
      operationCategory: "artifact.read-exact",
      ambiguityBehavior: "bounded-read-retry",
    });

    const plannedCleanup = {
      ...AVD_THREE_VM_SCENARIO,
      id: "planned-avd-cleanup",
      evidence: {
        ...AVD_THREE_VM_SCENARIO.evidence,
        artifacts: AVD_THREE_VM_SCENARIO.evidence.artifacts.map(
          (artifact) =>
            artifact.kind === "cleanup-state"
              ? {
                ...artifact,
                state: "planned",
                observation: undefined,
              }
              : artifact,
        ),
      },
    };
    const planned = compileScenarioExecutionPlan(
      {
        ...REQUESTS["avd-three-vm-substrate"],
        scenarioId: "planned-avd-cleanup",
      },
      [plannedCleanup],
    );
    const plannedObservation = planned.steps.findIndex(
      ({ operationKey }) => operationKey === "observe-final-cleanup",
    );
    const lastPlannedCleanup = Math.max(
      ...planned.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) =>
          step.phase === "cleanup" &&
          step.ambiguityBehavior === "stop-and-reconcile"
        )
        .map(({ index }) => index),
    );
    expect(plannedObservation).toBeGreaterThan(lastPlannedCleanup);
    expect(
      planned.steps.find(({ operationKey }) =>
        operationKey === "deploy-private-three-vm-topology"
      ),
    ).toMatchObject({ execution: "pre-seeded-reference" });

    const plannedProducer = {
      ...AVD_THREE_VM_SCENARIO,
      id: "planned-avd-producer",
      evidence: {
        ...AVD_THREE_VM_SCENARIO.evidence,
        artifacts: AVD_THREE_VM_SCENARIO.evidence.artifacts.map(
          (artifact) =>
            artifact.id === "avd-host-readiness"
              ? {
                ...artifact,
                state: "planned",
                learnerVisibility: "not-proven",
                observation: undefined,
              }
              : artifact,
        ),
      },
    };
    const producerRun = compileScenarioExecutionPlan(
      {
        ...REQUESTS["avd-three-vm-substrate"],
        scenarioId: "planned-avd-producer",
      },
      [plannedProducer],
    );
    expect(
      producerRun.steps.find(({ operationKey }) =>
        operationKey === "deploy-private-three-vm-topology"
      ),
    ).toMatchObject({
      execution: "automated",
      ambiguityBehavior: "stop-and-reconcile",
    });
    expect(
      producerRun.steps.find(({ operationKey }) =>
        operationKey === "delete-three-vm-resource-group"
      ),
    ).toMatchObject({
      execution: "automated",
      ambiguityBehavior: "stop-and-reconcile",
    });
  });

  it("includes only a selected manifest response", () => {
    const request = {
      ...REQUESTS["help-desk-email-observation"],
      selectedResponseId: "report-help-desk-interpretation",
    };
    const selected = compileScenarioExecutionPlan(request);
    const omitted = compileScenarioExecutionPlan(
      REQUESTS["help-desk-email-observation"],
    );

    expect(selected.selectedResponseId).toBe(
      "report-help-desk-interpretation",
    );
    expect(
      selected.steps.filter(({ phase }) => phase === "optional-response"),
    ).toHaveLength(1);
    expect(
      omitted.steps.filter(({ phase }) => phase === "optional-response"),
    ).toHaveLength(0);
    expect(
      omitted.steps.find(({ phase }) => phase === "retention"),
    ).toMatchObject({
      owningRole: "cleanupOwner",
      actorAlias: "producer",
      retention: {
        disposition: "cleanup-later",
        cleanupOperationKey: "delete-retained-help-desk-email",
      },
    });
  });

  it("fails closed on missing or conflated actor aliases", () => {
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        actorAliases: {
          evidenceProducer: "shared",
          workloadActor: "sender",
          learner: "shared",
          cleanupOwner: "shared",
        },
      },
      "ROLE_CONFLATION",
    );
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        actorAliases: {
          evidenceProducer: "producer",
          workloadActor: "sender",
          cleanupOwner: "producer",
        },
      },
      "ACTOR_BINDING_INVALID",
    );
  });

  it("rejects undeclared self-triggering in a runtime manifest", () => {
    const invalid = {
      ...HELP_DESK_EMAIL_SCENARIO,
      id: "undeclared-self-trigger",
      roles: {
        ...HELP_DESK_EMAIL_SCENARIO.roles,
        evidenceProducer: HELP_DESK_EMAIL_SCENARIO.roles.learner,
      },
    };
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        scenarioId: "undeclared-self-trigger",
      },
      "SELF_TRIGGER_UNDECLARED",
      [invalid],
    );
  });

  it("rejects learner and independent-detector conflation before planning", () => {
    const invalid = {
      ...OAUTH_APPLICATION_RECON_SCENARIO,
      id: "learner-detector-conflation",
      roles: {
        ...OAUTH_APPLICATION_RECON_SCENARIO.roles,
        detector: OAUTH_APPLICATION_RECON_SCENARIO.roles.learner,
      },
    };
    expectCategory(
      {
        ...REQUESTS["oauth-application-reconnaissance"],
        scenarioId: "learner-detector-conflation",
      },
      "ROLE_CONFLATION",
      [invalid],
    );
  });

  it("rejects missing cleanup, evidence, and interpretation", () => {
    const missingCleanup = {
      ...HELP_DESK_EMAIL_SCENARIO,
      id: "missing-cleanup",
      lifecycle: {
        ...HELP_DESK_EMAIL_SCENARIO.lifecycle,
        cleanupOperationKeys: [],
      },
    };
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        scenarioId: "missing-cleanup",
      },
      "CLEANUP_MISSING",
      [missingCleanup],
    );

    const missingEvidence = {
      ...HELP_DESK_EMAIL_SCENARIO,
      id: "missing-evidence",
      evidence: {
        ...HELP_DESK_EMAIL_SCENARIO.evidence,
        artifacts: [],
      },
    };
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        scenarioId: "missing-evidence",
      },
      "TERMINAL_PROOF_MISSING",
      [missingEvidence],
    );

    const missingInterpretation = {
      ...HELP_DESK_EMAIL_SCENARIO,
      id: "missing-interpretation",
      learner: {
        ...HELP_DESK_EMAIL_SCENARIO.learner,
        expectedInterpretation: "",
      },
    };
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        scenarioId: "missing-interpretation",
      },
      "INTERPRETATION_MISSING",
      [missingInterpretation],
    );
  });

  it("rejects expired or overlong windows and insufficient budgets", () => {
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        expiresAt: "2026-07-29T06:00:00Z",
      },
      "EXPIRY_INVALID",
    );
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        expiresAt: "2026-07-29T08:00:00Z",
      },
      "EXPIRY_INVALID",
    );
    expectCategory(
      {
        ...REQUESTS["avd-three-vm-substrate"],
        maximumBudgetUsd: 9,
      },
      "BUDGET_EXCEEDED",
    );
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        now: "2026-02-30T06:00:00Z",
      },
      "INPUT_INVALID",
    );
  });

  it("validates the complete catalog and rejects duplicate IDs", () => {
    expectCategory(
      REQUESTS["help-desk-email-observation"],
      "MANIFEST_INVALID",
      [
        HELP_DESK_EMAIL_SCENARIO,
        { ...HELP_DESK_EMAIL_SCENARIO },
      ],
    );
    expectCategory(
      REQUESTS["help-desk-email-observation"],
      "MANIFEST_INVALID",
      [
        HELP_DESK_EMAIL_SCENARIO,
        {
          ...OAUTH_APPLICATION_RECON_SCENARIO,
          title: "",
        },
      ],
    );
  });

  it("rejects unsupported responses and contradictory retention", () => {
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        selectedResponseId: "undeclared-response",
      },
      "RESPONSE_NOT_ALLOWED",
    );

    const contradictoryRetention = {
      ...HELP_DESK_EMAIL_SCENARIO,
      id: "contradictory-retention",
      lifecycle: {
        ...HELP_DESK_EMAIL_SCENARIO.lifecycle,
        retainedArtifacts:
          HELP_DESK_EMAIL_SCENARIO.lifecycle.retainedArtifacts.map(
            (artifact) => ({
              ...artifact,
              disposition: "retain-audit-history",
            }),
          ),
      },
    };
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        scenarioId: "contradictory-retention",
      },
      "RETENTION_CONFLICT",
      [contradictoryRetention],
    );
  });

  it.each([
    "learner@example.invalid",
    "deadbeef-dead-4eef-8ead-deadbeefdead",
    "unsafe/path",
    "tenant-observer",
    "session-owner",
  ])("rejects raw or sensitive alias value %s", (learner) => {
    expectCategory(
      {
        ...REQUESTS["help-desk-email-observation"],
        actorAliases: {
          ...REQUESTS["help-desk-email-observation"].actorAliases,
          learner,
        },
      },
      "RAW_IDENTIFIER_REJECTED",
    );
  });

  it("runs the real local CLI path without network or file mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-scenario-plan-"));
    const input = join(directory, "request.json");
    try {
      const serialized = JSON.stringify(
        REQUESTS["oauth-application-reconnaissance"],
      );
      writeFileSync(input, serialized, { encoding: "utf8", mode: 0o600 });
      const before = readdirSync(directory);
      const result = spawnSync(
        process.execPath,
        ["scripts/compile-scenario-plan.ts", input],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "", HTTP_PROXY: "" },
        },
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        plan: {
          kind: "scenario-execution-plan",
          scenarioId: "oauth-application-reconnaissance",
        },
      });
      expect(result.stderr).toBe("");
      expect(readdirSync(directory)).toEqual(before);
      expect(readFileSync(input, "utf8")).toBe(serialized);
      const cliSource = readFileSync(
        "scripts/compile-scenario-plan.ts",
        "utf8",
      );
      expect(cliSource).not.toMatch(
        /\bfetch\b|node:https|node:http|@azure|playwright|child_process/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints one categorical CLI failure without echoing rejected input", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-scenario-refusal-"));
    const input = join(directory, "request.json");
    try {
      writeFileSync(
        input,
        JSON.stringify({
          ...REQUESTS["help-desk-email-observation"],
          actorAliases: {
            ...REQUESTS["help-desk-email-observation"].actorAliases,
            learner: "learner@example.invalid",
          },
        }),
        { encoding: "utf8", mode: 0o600 },
      );
      const result = spawnSync(
        process.execPath,
        ["scripts/compile-scenario-plan.ts", input],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "", HTTP_PROXY: "" },
        },
      );

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        ok: false,
        error: { category: "RAW_IDENTIFIER_REJECTED" },
      });
      expect(result.stderr).not.toContain("learner@example.invalid");
      expect(readdirSync(directory)).toEqual(["request.json"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function expectCategory(
  request: unknown,
  category: ScenarioPlanError["category"],
  catalog?: readonly unknown[],
): void {
  expect(() => compileScenarioExecutionPlan(request, catalog))
    .toThrowError(expect.objectContaining({ category }));
}

void AVD_THREE_VM_SCENARIO;
void OAUTH_APPLICATION_RECON_SCENARIO;
void TEAMS_MISSED_CALL_SCENARIO;
