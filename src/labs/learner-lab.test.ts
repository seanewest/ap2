import { describe, expect, it } from "vitest";
import {
  LearnerLabValidationError,
  parseLearnerLabDefinition,
} from "./learner-lab";

const capabilityIds = new Set(["capability-one", "capability-two"]);

function validLab(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "contract-test-lab",
    title: "Contract test learning experience",
    summary: "A non-published fixture used only to validate the lab shape.",
    humanLearner: {
      label: "Human learner",
      responsibility: "Investigate the connected evidence and make a decision.",
    },
    storyActors: [{
      label: "Fictional account",
      kind: "simulated-person",
      role: "evidence-source",
    }],
    learningObjective: "Connect two observations into one supported finding.",
    evidenceChain: [
      {
        capabilityId: "capability-one",
        learnerObservation: "First bounded observation.",
        whyItMatters: "Establishes the beginning of the evidence chain.",
      },
      {
        capabilityId: "capability-two",
        learnerObservation: "Second bounded observation.",
        whyItMatters: "Lets the learner correlate the observations.",
      },
    ],
    investigationPrompt: "Determine what the connected observations support.",
    permittedActions: ["Record one supported finding."],
    completionCriteria: ["The finding cites both observations."],
  };
}

describe("learner lab definition", () => {
  it("accepts one bounded composite learning contract", () => {
    const lab = parseLearnerLabDefinition(validLab(), capabilityIds);
    expect(lab.evidenceChain).toHaveLength(2);
    expect(lab.humanLearner.label).toBe("Human learner");
    expect(lab.storyActors[0]?.role).toBe("evidence-source");
  });

  it.each([
    {
      name: "unknown fields",
      mutate(lab: Record<string, unknown>) {
        lab.cleanup = "internal detail";
      },
      category: "LAB_SHAPE_INVALID",
    },
    {
      name: "human learner conflated with a story actor",
      mutate(lab: Record<string, unknown>) {
        (lab.storyActors as Array<Record<string, unknown>>)[0]!.label =
          "Human learner";
      },
      category: "ACTOR_CONFLATION",
    },
    {
      name: "single atomic capability",
      mutate(lab: Record<string, unknown>) {
        (lab.evidenceChain as unknown[]).pop();
      },
      category: "LAB_SHAPE_INVALID",
    },
    {
      name: "duplicate capability",
      mutate(lab: Record<string, unknown>) {
        (lab.evidenceChain as Array<Record<string, unknown>>)[1]!
          .capabilityId = "capability-one";
      },
      category: "CAPABILITY_DUPLICATE",
    },
    {
      name: "unknown capability",
      mutate(lab: Record<string, unknown>) {
        (lab.evidenceChain as Array<Record<string, unknown>>)[1]!
          .capabilityId = "capability-foreign";
      },
      category: "CAPABILITY_UNKNOWN",
    },
    {
      name: "missing permitted learner action",
      mutate(lab: Record<string, unknown>) {
        lab.permittedActions = [];
      },
      category: "EVIDENCE_CHAIN_INCOMPLETE",
    },
  ])("fails closed for $name", ({ mutate, category }) => {
    const lab = validLab();
    mutate(lab);
    expect(() => parseLearnerLabDefinition(lab, capabilityIds)).toThrow(
      expect.objectContaining({ category }),
    );
  });

  it("uses only categorical failures without echoing input", () => {
    let error: unknown;
    try {
      parseLearnerLabDefinition({ unsafe: "private detail" }, capabilityIds);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LearnerLabValidationError);
    expect((error as Error).message).toBe("LAB_SHAPE_INVALID");
    expect(JSON.stringify(error)).not.toContain("private detail");
  });
});
