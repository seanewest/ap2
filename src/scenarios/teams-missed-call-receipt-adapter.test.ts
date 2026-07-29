// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  adaptTeamsMissedCallObservationToReceipt,
  canonicalTeamsMissedCallReceiptAdapterInput,
  TeamsMissedCallReceiptAdapterError,
  type TeamsMissedCallReceiptAdapterInput,
} from "./teams-missed-call-receipt-adapter.ts";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call.ts";
import {
  verifyScenarioEvidenceReceipt,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";

type MutableInput = {
  -readonly [Key in keyof TeamsMissedCallReceiptAdapterInput]:
    TeamsMissedCallReceiptAdapterInput[Key];
};

function stageOnlyInput(): MutableInput {
  return structuredClone(
    canonicalTeamsMissedCallReceiptAdapterInput(),
  ) as MutableInput;
}

function observedInput(): MutableInput {
  return {
    ...stageOnlyInput(),
    nativeObservation: {
      state: "observed",
      observerRole: "learner",
      operation: "read-cory-call-history",
      history: "one-missed-incoming",
      activity: "one-matching-notification",
      authenticity: "platform-native",
    },
  };
}

function interpretedInput(): MutableInput {
  return {
    ...observedInput(),
    interpretation: {
      state: "reported",
      observerRole: "learner",
      operation: "interpret-missed-call",
      responseAction: "report-observation",
      conclusion: "missed-teams-call-without-voicemail",
    },
  };
}

function cleanedInput(): MutableInput {
  return {
    ...observedInput(),
    cleanup: {
      state: "cleaned",
      mutationObserverRole: "evidenceProducer",
      mutationOperation: "clean-retained-call-history",
      terminalObserverRole: "learner",
      terminalOperation: "read-cory-call-history",
      history: "absent",
      activity: "absent",
      retention: "absent",
    },
  };
}

function clone(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

function claim(receipt: ScenarioEvidenceReceipt, id: string) {
  return receipt.claims.find((candidate) => candidate.id === id);
}

function expectAdapterError(
  value: unknown,
  code: TeamsMissedCallReceiptAdapterError["code"],
): void {
  try {
    adaptTeamsMissedCallObservationToReceipt(value);
    throw new Error("Expected Teams adapter failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(TeamsMissedCallReceiptAdapterError);
    expect((error as TeamsMissedCallReceiptAdapterError).code).toBe(code);
  }
}

describe("Teams missed-call observation receipt adapter", () => {
  it("maps stage completion only to the exact one-attempt operation", () => {
    const input = stageOnlyInput();
    const before = structuredClone(input);
    const request = vi.spyOn(globalThis, "fetch");
    const receipt = adaptTeamsMissedCallObservationToReceipt(input);
    const verified = verifyScenarioEvidenceReceipt(
      receipt,
      TEAMS_MISSED_CALL_SCENARIO,
    );

    expect(input).toEqual(before);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(verified.scenarioId).toBe("teams-missed-call-observation");
    expect(claim(receipt, "operation-stage-one-audio-call")).toMatchObject({
      state: "proven",
      observation: {
        source: "provider-response",
        outcome: "human-assisted-artifact",
        observerActorId: "ap2-instructor",
        operationKey: "stage-one-audio-call",
      },
    });
    for (
      const id of [
        "artifact-cory-missed-call",
        "visibility-cory-missed-call",
        "learner-interpretation",
        "response-report-observation",
        "cleanup-clean-retained-call-history",
        "retention-cory-missed-call",
        "terminal-teams-missed-call",
        "terminal-teams-call",
        "terminal-unattended-automation",
        "terminal-teams-voicemail",
      ]
    ) {
      expect(claim(receipt, id)?.state).toBe("uninspected");
    }
    request.mockRestore();
  });

  it("requires both native Cory-side surfaces for artifact and visibility", () => {
    const receipt = adaptTeamsMissedCallObservationToReceipt(observedInput());

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, TEAMS_MISSED_CALL_SCENARIO)
    ).not.toThrow();
    expect(claim(receipt, "operation-read-cory-call-history")).toMatchObject({
      state: "proven",
      observation: {
        source: "learner-view",
        outcome: "learner-inspection",
        observerActorId: "learner-in-cory-view",
      },
    });
    expect(claim(receipt, "artifact-cory-missed-call")).toMatchObject({
      state: "proven",
      artifact: {
        kind: "teams-missed-call",
        authenticity: "platform-native",
      },
      observation: { outcome: "human-assisted-artifact" },
    });
    expect(claim(receipt, "visibility-cory-missed-call")?.state).toBe(
      "proven",
    );
    expect(claim(receipt, "retention-cory-missed-call")?.state).toBe(
      "proven",
    );
    expect(claim(receipt, "cleanup-clean-retained-call-history")?.state)
      .toBe("uninspected");
    expect(claim(receipt, "terminal-teams-call")?.state).toBe("proven");
    expect(claim(receipt, "terminal-teams-voicemail")?.state).toBe(
      "uninspected",
    );
  });

  it("preserves a separate bounded interpretation report without voicemail", () => {
    const receipt = adaptTeamsMissedCallObservationToReceipt(
      interpretedInput(),
    );

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, TEAMS_MISSED_CALL_SCENARIO)
    ).not.toThrow();
    expect(claim(receipt, "operation-interpret-missed-call")).toMatchObject({
      state: "proven",
      observation: {
        source: "learner-view",
        outcome: "learner-inspection",
        observerActorId: "learner-in-cory-view",
      },
    });
    expect(claim(receipt, "response-report-observation")?.state).toBe(
      "proven",
    );
    expect(claim(receipt, "learner-interpretation")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "terminal-teams-voicemail")?.state).toBe(
      "uninspected",
    );
  });

  it("maps cleanup mutation and two-surface terminal absence separately", () => {
    const receipt = adaptTeamsMissedCallObservationToReceipt(cleanedInput());

    expect(() =>
      verifyScenarioEvidenceReceipt(receipt, TEAMS_MISSED_CALL_SCENARIO)
    ).not.toThrow();
    expect(claim(receipt, "operation-clean-retained-call-history"))
      .toMatchObject({
        state: "proven",
        observation: {
          source: "provider-response",
          outcome: "operation-result",
          observerActorId: "ap2-instructor",
        },
      });
    expect(claim(receipt, "cleanup-clean-retained-call-history"))
      .toMatchObject({
        state: "proven",
        observation: {
          source: "learner-view",
          outcome: "exact-reconciliation",
          observerActorId: "learner-in-cory-view",
          operationKey: "read-cory-call-history",
        },
      });
    expect(claim(receipt, "retention-cory-missed-call")).toMatchObject({
      state: "absent",
      observation: {
        source: "learner-view",
        outcome: "exact-reconciliation",
      },
    });
    expect(claim(receipt, "operation-interpret-missed-call")?.state).toBe(
      "uninspected",
    );
    expect(claim(receipt, "response-report-observation")?.state).toBe(
      "uninspected",
    );
  });

  it.each([
    "ambiguous",
    "refused",
    "pre-identity",
    "failed",
    "incomplete",
  ])("rejects a %s stage outcome", (outcome) => {
    const input = clone(stageOnlyInput());
    (input.stage as Record<string, unknown>).outcome = outcome;
    expectAdapterError(input, "stage-outcome");
  });

  it("rejects repeated, bot, non-audio, and mismatched staging", () => {
    const repeated = clone(stageOnlyInput());
    (repeated.stage as Record<string, unknown>).attempt = "two";
    expectAdapterError(repeated, "observation-mismatch");

    for (const actorPath of ["graph-bot", "bot"]) {
      const bot = clone(stageOnlyInput());
      (bot.stage as Record<string, unknown>).actorPath = actorPath;
      expectAdapterError(bot, "role-conflation");
    }

    const video = clone(stageOnlyInput());
    (video.stage as Record<string, unknown>).media = "video";
    expectAdapterError(video, "observation-mismatch");

    const wrongOperation = clone(stageOnlyInput());
    (wrongOperation.stage as Record<string, unknown>).operation =
      "place-bot-call";
    expectAdapterError(wrongOperation, "observation-mismatch");
  });

  it("rejects missing, duplicate, reordered, and conflicting journal events", () => {
    const missing = clone(stageOnlyInput());
    missing.journal = (missing.journal as unknown[]).slice(0, 1);
    expectAdapterError(missing, "sequence");

    const duplicate = clone(stageOnlyInput());
    (duplicate.journal as unknown[])[1] = structuredClone(
      (duplicate.journal as unknown[])[0],
    );
    expectAdapterError(duplicate, "sequence");

    const reordered = clone(stageOnlyInput());
    (reordered.journal as unknown[]).reverse();
    expectAdapterError(reordered, "sequence");

    const conflicting = clone(stageOnlyInput());
    ((conflicting.journal as Record<string, unknown>[])[1]!).transition =
      "failed";
    expectAdapterError(conflicting, "sequence");
  });

  it("rejects one-surface, non-native, mismatched, and producer observations", () => {
    for (const [key, value] of [
      ["history", "uninspected"],
      ["activity", "uninspected"],
      ["authenticity", "application-narrative"],
      ["operation", "read-originator-quality"],
    ] as const) {
      const input = clone(observedInput());
      (input.nativeObservation as Record<string, unknown>)[key] = value;
      expectAdapterError(input, "observation-mismatch");
    }

    const producer = clone(observedInput());
    (producer.nativeObservation as Record<string, unknown>).observerRole =
      "evidenceProducer";
    expectAdapterError(producer, "role-conflation");
  });

  it("rejects voicemail, callback, and interpretation without native evidence", () => {
    for (const conclusion of [
      "missed-teams-call-with-voicemail",
      "missed-teams-call-with-callback",
      "voicemail-absent",
    ]) {
      const input = clone(interpretedInput());
      (input.interpretation as Record<string, unknown>).conclusion =
        conclusion;
      expectAdapterError(input, "semantic-overclaim");
    }

    const noEvidence = clone(stageOnlyInput());
    noEvidence.interpretation = interpretedInput().interpretation;
    expectAdapterError(noEvidence, "semantic-overclaim");
  });

  it("rejects cleanup inference, one-surface absence, and post-action ambiguity", () => {
    const noObservation = clone(stageOnlyInput());
    noObservation.cleanup = cleanedInput().cleanup;
    expectAdapterError(noObservation, "cleanup-gap");

    for (const [key, value] of [
      ["history", "unknown"],
      ["activity", "present"],
      ["terminalOperation", "clean-retained-call-history"],
      ["retention", "ambiguous"],
    ] as const) {
      const input = clone(cleanedInput());
      (input.cleanup as Record<string, unknown>)[key] = value;
      expectAdapterError(input, "cleanup-gap");
    }

    for (const key of [
      "elapsedTime",
      "hangup",
      "qualityPrompt",
      "originatorAbsence",
      "postActionOutcome",
    ]) {
      const input = clone(cleanedInput());
      (input.cleanup as Record<string, unknown>)[key] = "observed";
      expectAdapterError(input, "shape");
    }
  });

  it("rejects cross-scenario and unknown categorical values", () => {
    const crossScenario = clone(stageOnlyInput());
    crossScenario.scenarioId = "help-desk-email-observation";
    expectAdapterError(crossScenario, "scenario-mismatch");

    const unknown = clone(observedInput());
    (unknown.nativeObservation as Record<string, unknown>).state = "maybe";
    expectAdapterError(unknown, "observation-mismatch");
  });

  it.each([
    ["userId", ["12345678", "1234", "1234", "1234", "123456789abc"].join("-")],
    ["upn", ["learner", "example.invalid"].join("@")],
    ["timestamp", ["2026-07-29", "12:00:00Z"].join("T")],
    ["duration", 17],
    ["screenshot", "encoded-image"],
    ["marker", ["teams", "missed-call-controlled-hidden"].join("-")],
    ["token", ["Bearer", "hidden-value"].join(" ")],
    ["path", ["", "home", "operator", "evidence"].join("/")],
    ["clientState", "signed-in"],
    ["browserState", "open"],
    ["payload", { arbitrary: "upstream" }],
    ["text", "arbitrary observation"],
  ])("rejects forbidden raw field %s", (key, value) => {
    const input = clone(stageOnlyInput());
    input[key] = value;
    expectAdapterError(input, "unsafe-input");
  });

  it("is deterministic and never proves bot automation, voicemail, or cleanup", () => {
    const left = adaptTeamsMissedCallObservationToReceipt(interpretedInput());
    const right = adaptTeamsMissedCallObservationToReceipt(interpretedInput());

    expect(left).toEqual(right);
    expect(left.claims.map(({ id }) => id)).toEqual(
      right.claims.map(({ id }) => id),
    );
    for (
      const id of [
        "terminal-unattended-automation",
        "terminal-teams-voicemail",
        "cleanup-clean-retained-call-history",
      ]
    ) {
      expect(claim(left, id)?.state).toBe("uninspected");
    }
  });
});
