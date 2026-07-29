// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email.ts";
import {
  adaptHelpDeskEmailOperationToReceipt,
  canonicalHelpDeskEmailReceiptAdapterInput,
  HelpDeskEmailReceiptAdapterError,
  type HelpDeskEmailReceiptAdapterInput,
} from "./help-desk-email-receipt-adapter.ts";
import {
  verifyScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";

type MutableInput = {
  -readonly [Key in keyof HelpDeskEmailReceiptAdapterInput]:
    HelpDeskEmailReceiptAdapterInput[Key];
};

function acceptedInput(): MutableInput {
  return structuredClone(
    canonicalHelpDeskEmailReceiptAdapterInput(),
  ) as MutableInput;
}

function learnerObservedInput(): MutableInput {
  return {
    ...acceptedInput(),
    learner: {
      artifact: {
        state: "observed",
        observerRole: "learner",
        operation: "read-marker-after",
        artifact: "outlook-email",
      },
      interpretation: { state: "uninspected" },
    },
  };
}

function cleanedInput(): MutableInput {
  return {
    ...learnerObservedInput(),
    cleanup: {
      state: "cleaned",
      mutationObserverRole: "evidenceProducer",
      mutationOperation: "delete-retained-help-desk-email",
      terminalObserverRole: "learner",
      terminalOperation: "read-marker-after",
      retention: "absent",
    },
  };
}

function clone(input: unknown): Record<string, unknown> {
  return structuredClone(input) as Record<string, unknown>;
}

function claim(
  receipt: ScenarioEvidenceReceipt,
  id: string,
) {
  return receipt.claims.find((candidate) => candidate.id === id);
}

function expectAdapterError(
  value: unknown,
  code: HelpDeskEmailReceiptAdapterError["code"],
): void {
  try {
    adaptHelpDeskEmailOperationToReceipt(value);
    throw new Error("Expected help-desk adapter failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(HelpDeskEmailReceiptAdapterError);
    expect((error as HelpDeskEmailReceiptAdapterError).code).toBe(code);
  }
}

describe("help-desk email operation receipt adapter", () => {
  it("maps send acceptance only to the exact operation claim", () => {
    const input = acceptedInput();
    const before = structuredClone(input);
    const request = vi.spyOn(globalThis, "fetch");
    const receipt = adaptHelpDeskEmailOperationToReceipt(input);
    const verified = verifyScenarioEvidenceReceipt(
      receipt,
      HELP_DESK_EMAIL_SCENARIO,
    );

    expect(input).toEqual(before);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(verified.scenarioId).toBe("help-desk-email-observation");
    expect(claim(receipt, "operation-send-help-desk-email")).toMatchObject({
      state: "proven",
      observation: {
        source: "provider-response",
        outcome: "operation-result",
        observerActorId: "ap2-orchestrator",
        operationKey: "send-help-desk-email",
      },
    });
    for (
      const id of [
        "artifact-cory-help-desk-email",
        "visibility-cory-help-desk-email",
        "learner-interpretation",
        "response-report-help-desk-interpretation",
        "cleanup-delete-retained-help-desk-email",
        "retention-cory-help-desk-email",
        "terminal-outlook-email",
        "terminal-teams-call",
        "terminal-teams-voicemail",
      ]
    ) {
      expect(claim(receipt, id)?.state).toBe("uninspected");
    }
    request.mockRestore();
  });

  it("maps a distinct learner inspection to authentic retained email only", () => {
    const receipt = adaptHelpDeskEmailOperationToReceipt(
      learnerObservedInput(),
    );

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, HELP_DESK_EMAIL_SCENARIO)
    ).not.toThrow();
    expect(claim(receipt, "operation-read-marker-after")).toMatchObject({
      state: "proven",
      observation: {
        source: "learner-view",
        outcome: "learner-inspection",
        observerActorId: "cory-learner",
      },
    });
    expect(claim(receipt, "artifact-cory-help-desk-email")).toMatchObject({
      state: "proven",
      artifact: {
        kind: "outlook-email",
        authenticity: "platform-native",
      },
    });
    expect(claim(receipt, "visibility-cory-help-desk-email")?.state).toBe(
      "proven",
    );
    expect(claim(receipt, "retention-cory-help-desk-email")?.state).toBe(
      "proven",
    );
    expect(claim(receipt, "cleanup-delete-retained-help-desk-email")?.state)
      .toBe("uninspected");
    expect(claim(receipt, "terminal-outlook-email")?.state).toBe("proven");
    expect(claim(receipt, "learner-interpretation")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "response-report-help-desk-interpretation")?.state)
      .toBe("uninspected");
    expect(claim(receipt, "terminal-teams-call")?.state).toBe("uninspected");
    expect(claim(receipt, "terminal-teams-voicemail")?.state).toBe(
      "uninspected",
    );
  });

  it("maps exact cleanup and terminal absence separately", () => {
    const receipt = adaptHelpDeskEmailOperationToReceipt(cleanedInput());

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, HELP_DESK_EMAIL_SCENARIO)
    ).not.toThrow();
    expect(
      claim(receipt, "operation-delete-retained-help-desk-email"),
    ).toMatchObject({
      state: "proven",
      observation: {
        source: "provider-response",
        outcome: "operation-result",
        observerActorId: "ap2-orchestrator",
      },
    });
    expect(
      claim(receipt, "cleanup-delete-retained-help-desk-email"),
    ).toMatchObject({
      state: "proven",
      observation: {
        source: "learner-view",
        outcome: "exact-reconciliation",
        observerActorId: "cory-learner",
        operationKey: "read-marker-after",
      },
    });
    expect(claim(receipt, "retention-cory-help-desk-email")).toMatchObject({
      state: "absent",
      observation: {
        source: "learner-view",
        outcome: "exact-reconciliation",
      },
    });
  });

  it.each(["ambiguous", "failed", "incomplete", "refused"])(
    "rejects a %s operation outcome",
    (outcome) => {
      const input = clone(acceptedInput());
      (input.result as Record<string, unknown>).outcome = outcome;
      expectAdapterError(input, "operation-outcome");
    },
  );

  it("rejects missing, duplicate, reordered, and conflicting journal events", () => {
    const missing = clone(acceptedInput());
    missing.journal = (missing.journal as unknown[]).slice(0, 1);
    expectAdapterError(missing, "sequence");

    const duplicate = clone(acceptedInput());
    (duplicate.journal as unknown[])[1] = structuredClone(
      (duplicate.journal as unknown[])[0],
    );
    expectAdapterError(duplicate, "sequence");

    const reordered = clone(acceptedInput());
    (reordered.journal as unknown[]).reverse();
    expectAdapterError(reordered, "sequence");

    const conflicting = clone(acceptedInput());
    ((conflicting.journal as Record<string, unknown>[])[1]!).transition =
      "failed";
    expectAdapterError(conflicting, "sequence");
  });

  it("rejects cross-scenario, unknown, and mismatched operation values", () => {
    const crossScenario = clone(acceptedInput());
    crossScenario.scenarioId = "teams-missed-call-observation";
    expectAdapterError(crossScenario, "scenario-mismatch");

    const unknown = clone(acceptedInput());
    (unknown.result as Record<string, unknown>).operation =
      "send-another-email";
    expectAdapterError(unknown, "observation-mismatch");

    const mismatched = clone(acceptedInput());
    (mismatched.result as Record<string, unknown>).semanticBoundary =
      "teams-call";
    expectAdapterError(mismatched, "observation-mismatch");
  });

  it("rejects producer/learner role conflation", () => {
    const learner = clone(learnerObservedInput());
    const observations = learner.learner as Record<string, unknown>;
    (observations.artifact as Record<string, unknown>).observerRole =
      "evidenceProducer";
    expectAdapterError(learner, "role-conflation");

    const cleanup = clone(cleanedInput());
    (cleanup.cleanup as Record<string, unknown>).terminalObserverRole =
      "evidenceProducer";
    expectAdapterError(cleanup, "role-conflation");
  });

  it("rejects interpretation promotion even with a distinct response observation", () => {
    const withoutArtifact = clone(acceptedInput());
    (withoutArtifact.learner as Record<string, unknown>).interpretation = {
      state: "observed",
      observerRole: "learner",
      operation: "interpret-help-desk-email",
      responseAction: "report-help-desk-interpretation",
    };
    expectAdapterError(withoutArtifact, "semantic-overclaim");

    const withArtifact = clone(learnerObservedInput());
    (withArtifact.learner as Record<string, unknown>).interpretation = {
      state: "observed",
      observerRole: "learner",
      operation: "interpret-help-desk-email",
      responseAction: "report-help-desk-interpretation",
    };
    expectAdapterError(withArtifact, "semantic-overclaim");
  });

  it("rejects cleanup without the separately observed canonical artifact", () => {
    const input = clone(acceptedInput());
    input.cleanup = structuredClone(cleanedInput().cleanup);
    expectAdapterError(input, "cleanup-gap");

    const mismatched = clone(cleanedInput());
    (mismatched.cleanup as Record<string, unknown>).terminalOperation =
      "delete-retained-help-desk-email";
    expectAdapterError(mismatched, "cleanup-gap");
  });

  it.each([
    ["sender", ["learner", "example.invalid"].join("@")],
    ["tenantId", ["12345678", "1234", "1234", "1234", "123456789abc"].join("-")],
    ["subject", ["ap2", "hidden-marker-value"].join("-")],
    ["body", "arbitrary evidence text"],
    ["token", ["Bearer", "hidden-value"].join(" ")],
    ["path", ["", "home", "operator", "evidence"].join("/")],
    ["timestamp", ["2026-07-29", "12:00:00Z"].join("T")],
    ["payload", { arbitrary: "upstream" }],
  ])("rejects forbidden raw field %s", (key, value) => {
    const input = clone(acceptedInput());
    input[key] = value;
    expectAdapterError(input, "unsafe-input");
  });

  it("rejects arbitrary errors and unsupported Teams/voicemail fields", () => {
    const arbitrary = clone(acceptedInput());
    arbitrary.error = "provider returned something";
    expectAdapterError(arbitrary, "shape");

    const teams = clone(acceptedInput());
    (teams.learner as Record<string, unknown>).teamsCall = "observed";
    expectAdapterError(teams, "shape");

    const voicemail = clone(acceptedInput());
    (voicemail.cleanup as Record<string, unknown>).voicemail = "absent";
    expectAdapterError(voicemail, "shape");
  });

  it("is deterministic and never auto-completes learner or cleanup truth", () => {
    const left = adaptHelpDeskEmailOperationToReceipt(learnerObservedInput());
    const right = adaptHelpDeskEmailOperationToReceipt(learnerObservedInput());

    expect(left).toEqual(right);
    expect(left.claims.map(({ id }) => id)).toEqual(
      right.claims.map(({ id }) => id),
    );
    expect(
      left.claims.filter(({ state }) => state === "proven").map(({ id }) => id),
    ).not.toContain("learner-interpretation");
    expect(
      left.claims.filter(({ state }) => state === "proven").map(({ id }) => id),
    ).not.toContain("cleanup-delete-retained-help-desk-email");
  });
});
