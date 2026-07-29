import { describe, expect, it } from "vitest";
import {
  createLearnerEvidenceBriefingRoute,
} from "./learner-evidence-briefing-route";
import type {
  LearnerEvidenceBriefing,
} from "./learner-evidence-briefing";

const briefing: LearnerEvidenceBriefing = {
  schemaVersion: 1,
  kind: "learner-evidence-briefing",
  scenario: {
    id: "help-desk-email-observation",
    title: "Kobe help-desk email for Cory",
    context: "Interpret one fictional help-desk follow-up.",
  },
  evidence: {
    type: "Outlook email",
    status: "Observed",
    briefingTime: "2026-07-29T12:00:00.000Z",
  },
  producer: {
    identityLabel: "AP2 orchestrator",
    roleLabel: "Evidence producer",
  },
  learner: {
    identityLabel: "Learner using Cory's mailbox",
    roleLabel: "Learner",
  },
  observationTask: "Inspect the Outlook email.",
  expectedInterpretation: "This is an Outlook email, not a Teams event.",
  permittedActions: [{
    id: "report-help-desk-interpretation",
    label: "Report the interpretation without replying or forwarding.",
  }],
  supportReference: "canonical:proven-capabilities/help-desk-email",
};

describe("learner evidence briefing route", () => {
  it("renders only the bounded learner projection and no controls", () => {
    const route = createLearnerEvidenceBriefingRoute(briefing);
    expect(route.textContent).toContain("Outlook email");
    expect(route.textContent).toContain("Evidence producerAP2 orchestrator");
    expect(route.textContent).toContain(
      "Report the interpretation without replying or forwarding.",
    );
    expect(route.querySelectorAll(
      "button, form, input, textarea, select, [data-action]",
    )).toHaveLength(0);
    expect(route.textContent).not.toMatch(
      /marker|cleanup operation|credential|token|request body|object id|tenant id/i,
    );
  });
});
