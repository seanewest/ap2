import { describe, expect, it } from "vitest";
import {
  CANONICAL_RECEIPT_FIXTURES,
} from "./scenario-evidence-receipt.fixtures";
import { compileScenarioExecutionPlan } from "./scenario-plan";
import {
  LEARNER_BRIEFING_EXPECTED_ALIAS,
  LEARNER_BRIEFING_RESPONSE_ID,
  LearnerEvidenceBriefingError,
  buildLearnerEvidenceBriefing,
} from "./learner-evidence-briefing";
import type { ScenarioEvidenceReceipt } from "./scenario-evidence-receipt";
import type { ScenarioExecutionPlan } from "./scenario-plan";

const fixture = CANONICAL_RECEIPT_FIXTURES.find(
  ({ name }) => name === "help-desk-email",
)!;
const planningRequest = {
  scenarioId: "help-desk-email-observation",
  actorAliases: {
    evidenceProducer: "producer-service",
    workloadActor: "sender-kobe",
    learner: LEARNER_BRIEFING_EXPECTED_ALIAS,
    cleanupOwner: "producer-service",
  },
  now: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-07-29T13:00:00.000Z",
  maximumBudgetUsd: 0,
  selectedResponseId: LEARNER_BRIEFING_RESPONSE_ID,
} as const;

function canonicalInput(): {
  schemaVersion: 1;
  plan: ScenarioExecutionPlan;
  receipt: ScenarioEvidenceReceipt;
  expectedLearnerAlias: string;
  now: string;
} {
  return {
    schemaVersion: 1,
    plan: compileScenarioExecutionPlan(planningRequest),
    receipt: structuredClone(fixture.receipt),
    expectedLearnerAlias: LEARNER_BRIEFING_EXPECTED_ALIAS,
    now: "2026-07-29T12:05:00.000Z",
  };
}

describe("learner evidence briefing", () => {
  it("projects one valid plan and receipt into only learner-safe fields", () => {
    const briefing = buildLearnerEvidenceBriefing(canonicalInput());
    expect(briefing).toEqual({
      schemaVersion: 1,
      kind: "learner-evidence-briefing",
      scenario: {
        id: "help-desk-email-observation",
        title: "Kobe help-desk email for Cory",
        context:
          "AP2 stages one fixed Outlook email from Kobe so the learner can interpret a fictional help-desk follow-up.",
      },
      evidence: {
        type: "Outlook email",
        status: "Observed",
        briefingTime: planningRequest.now,
      },
      producer: {
        identityLabel: "AP2 orchestrator",
        roleLabel: "Evidence producer",
      },
      learner: {
        identityLabel: "Learner using Cory's mailbox",
        roleLabel: "Learner",
      },
      observationTask:
        "Inspect the email and explain the fictional help-desk follow-up it represents.",
      expectedInterpretation:
        "This is an authentic Outlook email artifact; it is not a Teams call, missed call, or voicemail.",
      permittedActions: [{
        id: "report-help-desk-interpretation",
        label: "Report the interpretation without replying or forwarding.",
      }],
      supportReference:
        "canonical:proven-capabilities/help-desk-email",
    });
    expect(Object.keys(briefing).sort()).toEqual([
      "evidence",
      "expectedInterpretation",
      "kind",
      "learner",
      "observationTask",
      "permittedActions",
      "producer",
      "scenario",
      "schemaVersion",
      "supportReference",
    ]);
    expect(JSON.stringify(briefing)).not.toMatch(
      /marker|cleanup|credential|token|object.?id|tenant|message.?id|request|operation|proofReference/i,
    );
  });

  it.each([
    {
      name: "learner-as-producer drift",
      mutate(input: ReturnType<typeof canonicalInput>) {
        (input.plan.actorAliases as Record<string, string | undefined>)
          .learner = input.plan.actorAliases.evidenceProducer;
      },
      category: "PLAN_INVALID",
    },
    {
      name: "wrong learner alias",
      mutate(input: ReturnType<typeof canonicalInput>) {
        input.expectedLearnerAlias = "learner-foreign";
      },
      category: "PLAN_INVALID",
    },
    {
      name: "expired briefing window",
      mutate(input: ReturnType<typeof canonicalInput>) {
        input.now = "2026-07-29T13:00:00.000Z";
      },
      category: "PLAN_INVALID",
    },
    {
      name: "unsupported response",
      mutate(input: ReturnType<typeof canonicalInput>) {
        input.plan.selectedResponseId = null;
      },
      category: "ACTION_UNSUPPORTED",
    },
    {
      name: "success without learner evidence",
      mutate(input: ReturnType<typeof canonicalInput>) {
        input.receipt.claims.find(({ id }) =>
          id === "visibility-cory-help-desk-email"
        )!.state = "uninspected";
        delete input.receipt.claims.find(({ id }) =>
          id === "visibility-cory-help-desk-email"
        )!.observation;
      },
      category: "EVIDENCE_MISSING",
    },
    {
      name: "email no longer retained",
      mutate(input: ReturnType<typeof canonicalInput>) {
        const retention = input.receipt.claims.find(({ id }) =>
          id === "retention-cory-help-desk-email"
        )!;
        retention.state = "absent";
        retention.observation = {
          source: "learner-view",
          outcome: "exact-reconciliation",
          observerActorId: "cory-learner",
          operationKey: "read-marker-after",
        };
      },
      category: "EVIDENCE_MISSING",
    },
    {
      name: "cleanup already completed",
      mutate(input: ReturnType<typeof canonicalInput>) {
        const operation = input.receipt.claims.find(({ id }) =>
          id === "operation-delete-retained-help-desk-email"
        )!;
        operation.state = "proven";
        operation.observation = {
          source: "local-reconciliation",
          outcome: "exact-reconciliation",
          observerActorId: "ap2-orchestrator",
          operationKey: "delete-retained-help-desk-email",
        };
        const cleanup = input.receipt.claims.find(({ id }) =>
          id === "cleanup-delete-retained-help-desk-email"
        )!;
        cleanup.state = "proven";
        cleanup.observation = {
          source: "learner-view",
          outcome: "exact-reconciliation",
          observerActorId: "cory-learner",
          operationKey: "read-marker-after",
        };
      },
      category: "EVIDENCE_MISSING",
    },
    {
      name: "learner response already completed",
      mutate(input: ReturnType<typeof canonicalInput>) {
        for (const id of [
          "operation-interpret-help-desk-email",
          `response-${LEARNER_BRIEFING_RESPONSE_ID}`,
        ]) {
          const claim = input.receipt.claims.find((candidate) =>
            candidate.id === id
          )!;
          claim.state = "proven";
          claim.observation = {
            source: "learner-view",
            outcome: "learner-inspection",
            observerActorId: "cory-learner",
            operationKey: "interpret-help-desk-email",
          };
        }
      },
      category: "EVIDENCE_MISSING",
    },
    {
      name: "wrong receipt learner",
      mutate(input: ReturnType<typeof canonicalInput>) {
        input.receipt.roles.learner = "foreign-learner";
      },
      category: "RECEIPT_INVALID",
    },
    {
      name: "foreign marker field",
      mutate(input: ReturnType<typeof canonicalInput> & { marker?: string }) {
        input.marker = "m1_0123456789abcdef01234567";
      },
      category: "INPUT_INVALID",
    },
  ])("fails closed for $name", ({ mutate, category }) => {
    const input = canonicalInput();
    mutate(input);
    expect(() => buildLearnerEvidenceBriefing(input)).toThrow(
      expect.objectContaining({ category }),
    );
  });

  it("rejects a malformed or foreign receipt without echoing details", () => {
    const input = canonicalInput();
    input.receipt.claims[0]!.id =
      "m1_0123456789abcdef01234567";
    let error: unknown;
    try {
      buildLearnerEvidenceBriefing(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LearnerEvidenceBriefingError);
    expect((error as Error).message).toBe("RECEIPT_INVALID");
    expect(JSON.stringify(error)).not.toContain(
      "m1_0123456789abcdef01234567",
    );
  });
});
