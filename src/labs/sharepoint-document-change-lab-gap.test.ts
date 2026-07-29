import { describe, expect, it } from "vitest";
import { API_ROUTE_CONTRACTS } from "../api/api-route-contract";
import {
  LEARNER_BRIEFING_SCENARIO_ID,
} from "../scenarios/learner-evidence-briefing";
import {
  PURVIEW_AUDIT_BOUNDARY_SCENARIO,
} from "../scenarios/purview-audit-boundary";
import { SCENARIO_MANIFESTS } from "../scenarios/scenarios";
import {
  LearnerLabValidationError,
  parseLearnerLabDefinition,
} from "./learner-lab";
import { LEARNER_LAB_CATALOG } from "./lab-catalog";

const candidate = {
  schemaVersion: 1,
  id: "unexpected-sharepoint-document-change",
  title: "Investigate an unexpected document change",
  summary:
    "Determine what changed, attribute the change, and recommend recovery.",
  humanLearner: {
    label: "Security learner",
    responsibility: "Investigate the safe version and attribution evidence.",
  },
  storyActors: [
    {
      label: "Fictional document producer",
      kind: "simulated-person",
      role: "evidence-source",
    },
    {
      label: "Independent audit detector",
      kind: "application",
      role: "detector",
    },
    {
      label: "Authorized recovery service",
      kind: "service",
      role: "responder",
    },
  ],
  learningObjective:
    "Use version and audit evidence to explain an unexpected document change.",
  evidenceChain: [
    {
      capabilityId: "sharepoint-document-version-change",
      learnerObservation: "A trusted version and a later changed version.",
      whyItMatters: "Shows what changed and which version is trusted.",
    },
    {
      capabilityId: "purview-sharepoint-audit-boundary",
      learnerObservation: "A sanitized operation-attribution summary.",
      whyItMatters: "Supports who or what performed the change.",
    },
  ],
  investigationPrompt:
    "Determine what changed, who or what changed it, and which version is trusted.",
  permittedActions: ["Recommend restoration of the trusted version."],
  completionCriteria: [
    "The finding cites both observations and selects only an allowed response.",
  ],
} as const;

describe("unexpected SharePoint document-change lab publication gap", () => {
  it("keeps the candidate unpublished while required runtime capabilities are absent", () => {
    const canonicalIds = new Set(SCENARIO_MANIFESTS.map(({ id }) => id));

    expect(LEARNER_LAB_CATALOG).toHaveLength(0);
    expect(canonicalIds).not.toContain("sharepoint-document-version-change");
    expect(canonicalIds).not.toContain("purview-sharepoint-audit-boundary");
    expect(() => parseLearnerLabDefinition(candidate, canonicalIds)).toThrow(
      expect.objectContaining<
        Partial<LearnerLabValidationError>
      >({ category: "CAPABILITY_UNKNOWN" }),
    );
  });

  it("preserves the decisive learner-visibility and completion boundary", () => {
    expect(
      PURVIEW_AUDIT_BOUNDARY_SCENARIO.evidence.artifacts.map(
        ({ learnerVisibility }) => learnerVisibility,
      ),
    ).toEqual(["not-proven"]);
    expect(PURVIEW_AUDIT_BOUNDARY_SCENARIO.learner.completionState).toBe(
      "not-run",
    );
    expect(LEARNER_BRIEFING_SCENARIO_ID).toBe(
      "help-desk-email-observation",
    );
  });

  it("keeps the authoritative API surface limited to fixed create/remove and pure Purview verification", () => {
    const relevantRoutes = API_ROUTE_CONTRACTS
      .filter(({ ownerKey, path }) =>
        /sharepoint|purview|version|restore/i.test(`${ownerKey} ${path}`)
      )
      .map(({ method, path, ownerKey, sideEffect }) => ({
        method,
        path,
        ownerKey,
        sideEffect,
      }));

    expect(relevantRoutes).toEqual([
      {
        method: "POST",
        path: "/api/purview-audit-boundary-rehearsal-verification",
        ownerKey: "purview-audit-boundary-rehearsal-verify",
        sideEffect: "pure",
      },
      {
        method: "POST",
        path: "/api/sharepoint-file-proof",
        ownerKey: "sharepoint-file-proof-create",
        sideEffect: "bounded-mutation",
      },
      {
        method: "DELETE",
        path: "/api/sharepoint-file-proof",
        ownerKey: "sharepoint-file-proof-remove",
        sideEffect: "bounded-mutation",
      },
    ]);
  });
});
