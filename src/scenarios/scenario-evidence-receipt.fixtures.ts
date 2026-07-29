import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from "./purview-audit-boundary";
import { PRIVATE_DOCUMENT_EVIDENCE_SCENARIO } from "./private-document-evidence";
import {
  type EvidenceReceiptClaim,
  type EvidenceReceiptErrorCode,
  type EvidenceReceiptObservation,
  type ObservationOutcome,
  type ObservationSource,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt";
import type { ScenarioManifest } from "./scenario-manifest";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

interface ReceiptFixture {
  name: string;
  manifest: ScenarioManifest;
  receipt: ScenarioEvidenceReceipt;
}

interface NegativeReceiptFixture extends ReceiptFixture {
  expectedCode: EvidenceReceiptErrorCode;
}

type ClaimTruth = Pick<EvidenceReceiptClaim, "state"> & {
  observation?: EvidenceReceiptObservation;
};

function observed(
  manifest: ScenarioManifest,
  operationKey: string,
  source: ObservationSource,
  outcome: ObservationOutcome,
): EvidenceReceiptObservation {
  const operation = manifest.operations.find(
    (candidate) => candidate.key === operationKey,
  );
  if (!operation) {
    throw new Error("fixture operation is missing");
  }
  return {
    source,
    outcome,
    observerActorId: operation.ownerActorId,
    operationKey,
  };
}

function baselineReceipt(manifest: ScenarioManifest): ScenarioEvidenceReceipt {
  const roles = {
    evidenceProducer: manifest.roles.evidenceProducer,
    workloadActor: manifest.roles.workloadActor,
    learner: manifest.roles.learner,
    ...(manifest.roles.detector === undefined
      ? {}
      : { detector: manifest.roles.detector }),
    ...(manifest.roles.responder === undefined
      ? {}
      : { responder: manifest.roles.responder }),
  };
  const claims: EvidenceReceiptClaim[] = [
    ...manifest.operations.map((operation) =>
      uninspected(
        `operation-${operation.key}`,
        "operation",
        "operation",
        operation.key,
        "operation-completed",
      )
    ),
    ...manifest.evidence.artifacts.map((artifact) =>
      uninspected(
        `artifact-${artifact.id}`,
        "artifact",
        "artifact",
        artifact.id,
        "artifact-authentic",
        {
          kind: artifact.kind,
          authenticity: artifact.authenticity,
        },
      )
    ),
    ...manifest.learner.evidenceArtifactIds.map((artifactId) =>
      uninspected(
        `visibility-${artifactId}`,
        "learner-visibility",
        "artifact",
        artifactId,
        "learner-visible",
      )
    ),
    uninspected(
      "learner-interpretation",
      "learner-interpretation",
      "scenario",
      manifest.id,
      "learner-interpreted",
    ),
    ...manifest.responseActions.map((action) =>
      uninspected(
        `response-${action.id}`,
        "response",
        "response-action",
        action.id,
        "response-completed",
      )
    ),
    ...manifest.lifecycle.cleanupOperationKeys.map((operationKey) =>
      uninspected(
        `cleanup-${operationKey}`,
        "cleanup",
        "operation",
        operationKey,
        "cleanup-completed",
      )
    ),
    ...manifest.evidence.artifacts.map((artifact) =>
      uninspected(
        `retention-${artifact.id}`,
        "retention",
        "artifact",
        artifact.id,
        "retention-confirmed",
      )
    ),
    ...(manifest.detection?.kind === "independent"
      ? [
        uninspected(
          "detector-independent",
          "independent-observation",
          "scenario",
          manifest.id,
          "detector-independent",
        ),
      ]
      : []),
  ];
  return {
    schemaVersion: 1,
    scenario: {
      id: manifest.id,
      manifestSchemaVersion: 2,
    },
    roles,
    claims,
  };
}

function uninspected(
  id: string,
  category: EvidenceReceiptClaim["category"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  assertion: EvidenceReceiptClaim["assertion"],
  artifact?: EvidenceReceiptClaim["artifact"],
): EvidenceReceiptClaim {
  return {
    id,
    category,
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state: "uninspected",
    ...(artifact === undefined ? {} : { artifact }),
  };
}

function terminal(
  id: string,
  _manifest: ScenarioManifest,
  assertion: EvidenceReceiptClaim["assertion"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  truth: ClaimTruth,
): EvidenceReceiptClaim {
  return {
    id,
    category: "terminal-proof",
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    ...truth,
  };
}

function applyTruth(
  receipt: ScenarioEvidenceReceipt,
  truth: Readonly<Record<string, ClaimTruth>>,
  additions: readonly EvidenceReceiptClaim[],
): ScenarioEvidenceReceipt {
  return {
    ...receipt,
    claims: [
      ...receipt.claims.map((claim) => ({
        ...claim,
        ...(truth[claim.id] ?? {}),
      })),
      ...additions,
    ],
  };
}

const helpDesk = applyTruth(
  baselineReceipt(HELP_DESK_EMAIL_SCENARIO),
  {
    "operation-verify-fixed-identities": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "verify-fixed-identities",
        "local-reconciliation",
        "exact-reconciliation",
      ),
    },
    "operation-read-marker-before": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "read-marker-before",
        "learner-view",
        "exact-reconciliation",
      ),
    },
    "operation-send-help-desk-email": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "send-help-desk-email",
        "provider-response",
        "operation-result",
      ),
    },
    "operation-read-marker-after": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "read-marker-after",
        "learner-view",
        "platform-event",
      ),
    },
    "artifact-cory-help-desk-email": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "read-marker-after",
        "learner-view",
        "platform-event",
      ),
    },
    "visibility-cory-help-desk-email": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "read-marker-after",
        "learner-view",
        "learner-inspection",
      ),
    },
    "retention-cory-help-desk-email": {
      state: "proven",
      observation: observed(
        HELP_DESK_EMAIL_SCENARIO,
        "read-marker-after",
        "learner-view",
        "platform-event",
      ),
    },
  },
  [
    terminal(
      "terminal-outlook-email",
      HELP_DESK_EMAIL_SCENARIO,
      "outlook-email",
      "artifact",
      "cory-help-desk-email",
      {
        state: "proven",
        observation: observed(
          HELP_DESK_EMAIL_SCENARIO,
          "read-marker-after",
          "learner-view",
          "platform-event",
        ),
      },
    ),
    terminal(
      "terminal-teams-call",
      HELP_DESK_EMAIL_SCENARIO,
      "teams-call",
      "scenario",
      HELP_DESK_EMAIL_SCENARIO.id,
      { state: "uninspected" },
    ),
    terminal(
      "terminal-teams-voicemail",
      HELP_DESK_EMAIL_SCENARIO,
      "teams-voicemail",
      "scenario",
      HELP_DESK_EMAIL_SCENARIO.id,
      { state: "uninspected" },
    ),
  ],
);

const avd = applyTruth(
  baselineReceipt(AVD_THREE_VM_SCENARIO),
  Object.fromEntries(
    AVD_THREE_VM_SCENARIO.operations
      .filter((operation) => operation.key !== "inspect-future-substrate")
      .map((operation) => [
        `operation-${operation.key}`,
        {
          state: "proven",
          observation: observed(
            AVD_THREE_VM_SCENARIO,
            operation.key,
            operation.effect === "read"
              ? "platform-control-plane"
              : "provider-response",
            operation.effect === "read"
              ? "exact-reconciliation"
              : "operation-result",
          ),
        } satisfies ClaimTruth,
      ]),
  ),
  [],
);
const avdWithArtifacts = applyTruth(
  avd,
  {
    "artifact-avd-host-readiness": {
      state: "proven",
      observation: observed(
        AVD_THREE_VM_SCENARIO,
        "observe-avd-endpoint",
        "platform-control-plane",
        "platform-event",
      ),
    },
    "artifact-private-three-vm-topology": {
      state: "proven",
      observation: observed(
        AVD_THREE_VM_SCENARIO,
        "observe-three-vm-topology",
        "platform-control-plane",
        "platform-event",
      ),
    },
    "artifact-windows-endpoint-posture": {
      state: "proven",
      observation: observed(
        AVD_THREE_VM_SCENARIO,
        "observe-avd-endpoint",
        "platform-control-plane",
        "platform-event",
      ),
    },
    "artifact-final-cleanup-state": {
      state: "proven",
      observation: observed(
        AVD_THREE_VM_SCENARIO,
        "observe-final-cleanup",
        "platform-control-plane",
        "exact-reconciliation",
      ),
    },
    ...Object.fromEntries(
      AVD_THREE_VM_SCENARIO.lifecycle.cleanupOperationKeys.map((key) => [
        `cleanup-${key}`,
        {
          state: "proven",
          observation: observed(
            AVD_THREE_VM_SCENARIO,
            "observe-final-cleanup",
            "local-reconciliation",
            "exact-reconciliation",
          ),
        } satisfies ClaimTruth,
      ]),
    ),
    "retention-final-cleanup-state": {
      state: "proven",
      observation: observed(
        AVD_THREE_VM_SCENARIO,
        "observe-final-cleanup",
        "platform-control-plane",
        "exact-reconciliation",
      ),
    },
  },
  [
    terminal(
      "terminal-infrastructure",
      AVD_THREE_VM_SCENARIO,
      "infrastructure-ready",
      "artifact",
      "private-three-vm-topology",
      {
        state: "proven",
        observation: observed(
          AVD_THREE_VM_SCENARIO,
          "observe-three-vm-topology",
          "platform-control-plane",
          "platform-event",
        ),
      },
    ),
    terminal(
      "terminal-learner-session",
      AVD_THREE_VM_SCENARIO,
      "learner-session",
      "scenario",
      AVD_THREE_VM_SCENARIO.id,
      { state: "uninspected" },
    ),
    terminal(
      "terminal-intune",
      AVD_THREE_VM_SCENARIO,
      "intune-managed",
      "artifact",
      "windows-endpoint-posture",
      {
        state: "proven",
        observation: observed(
          AVD_THREE_VM_SCENARIO,
          "observe-avd-endpoint",
          "platform-control-plane",
          "platform-event",
        ),
      },
    ),
    terminal(
      "terminal-defender",
      AVD_THREE_VM_SCENARIO,
      "defender-onboarded",
      "artifact",
      "windows-endpoint-posture",
      {
        state: "proven",
        observation: observed(
          AVD_THREE_VM_SCENARIO,
          "observe-avd-endpoint",
          "platform-control-plane",
          "platform-event",
        ),
      },
    ),
    terminal(
      "terminal-cleanup",
      AVD_THREE_VM_SCENARIO,
      "infrastructure-removed",
      "artifact",
      "final-cleanup-state",
      {
        state: "proven",
        observation: observed(
          AVD_THREE_VM_SCENARIO,
          "observe-final-cleanup",
          "local-reconciliation",
          "exact-reconciliation",
        ),
      },
    ),
    terminal(
      "terminal-spend",
      AVD_THREE_VM_SCENARIO,
      "spend-within-bound",
      "scenario",
      AVD_THREE_VM_SCENARIO.id,
      {
        state: "proven",
        observation: observed(
          AVD_THREE_VM_SCENARIO,
          "observe-final-cleanup",
          "platform-control-plane",
          "exact-reconciliation",
        ),
      },
    ),
  ],
);

const teams = applyTruth(
  baselineReceipt(TEAMS_MISSED_CALL_SCENARIO),
  {
    "operation-stage-one-audio-call": {
      state: "proven",
      observation: observed(
        TEAMS_MISSED_CALL_SCENARIO,
        "stage-one-audio-call",
        "provider-response",
        "human-assisted-artifact",
      ),
    },
    "operation-read-cory-call-history": {
      state: "proven",
      observation: observed(
        TEAMS_MISSED_CALL_SCENARIO,
        "read-cory-call-history",
        "learner-view",
        "learner-inspection",
      ),
    },
    "artifact-cory-missed-call": {
      state: "proven",
      observation: observed(
        TEAMS_MISSED_CALL_SCENARIO,
        "read-cory-call-history",
        "learner-view",
        "human-assisted-artifact",
      ),
    },
    "visibility-cory-missed-call": {
      state: "proven",
      observation: observed(
        TEAMS_MISSED_CALL_SCENARIO,
        "read-cory-call-history",
        "learner-view",
        "learner-inspection",
      ),
    },
    "retention-cory-missed-call": {
      state: "proven",
      observation: observed(
        TEAMS_MISSED_CALL_SCENARIO,
        "read-cory-call-history",
        "learner-view",
        "platform-event",
      ),
    },
  },
  [
    terminal(
      "terminal-teams-missed-call",
      TEAMS_MISSED_CALL_SCENARIO,
      "teams-missed-call",
      "artifact",
      "cory-missed-call",
      {
        state: "proven",
        observation: observed(
          TEAMS_MISSED_CALL_SCENARIO,
          "read-cory-call-history",
          "learner-view",
          "human-assisted-artifact",
        ),
      },
    ),
    terminal(
      "terminal-teams-call",
      TEAMS_MISSED_CALL_SCENARIO,
      "teams-call",
      "artifact",
      "cory-missed-call",
      {
        state: "proven",
        observation: observed(
          TEAMS_MISSED_CALL_SCENARIO,
          "read-cory-call-history",
          "learner-view",
          "human-assisted-artifact",
        ),
      },
    ),
    terminal(
      "terminal-unattended-automation",
      TEAMS_MISSED_CALL_SCENARIO,
      "unattended-automation",
      "operation",
      "stage-one-audio-call",
      { state: "uninspected" },
    ),
    terminal(
      "terminal-teams-voicemail",
      TEAMS_MISSED_CALL_SCENARIO,
      "teams-voicemail",
      "scenario",
      TEAMS_MISSED_CALL_SCENARIO.id,
      { state: "uninspected" },
    ),
  ],
);

const recon = applyTruth(
  baselineReceipt(OAUTH_APPLICATION_RECON_SCENARIO),
  {
    "operation-run-bounded-recon-reads": {
      state: "proven",
      observation: observed(
        OAUTH_APPLICATION_RECON_SCENARIO,
        "run-bounded-recon-reads",
        "platform-control-plane",
        "operation-result",
      ),
    },
    "operation-observe-bounded-sign-in": {
      state: "proven",
      observation: observed(
        OAUTH_APPLICATION_RECON_SCENARIO,
        "observe-bounded-sign-in",
        "independent-detector",
        "record-match",
      ),
    },
    "artifact-application-recon-summary": {
      state: "proven",
      observation: observed(
        OAUTH_APPLICATION_RECON_SCENARIO,
        "observe-bounded-sign-in",
        "independent-detector",
        "record-match",
      ),
    },
    "detector-independent": {
      state: "proven",
      observation: observed(
        OAUTH_APPLICATION_RECON_SCENARIO,
        "observe-bounded-sign-in",
        "independent-detector",
        "record-match",
      ),
    },
  },
  [
    {
      id: "producer-attribution",
      category: "independent-observation",
      subject: {
        kind: "scenario",
        id: OAUTH_APPLICATION_RECON_SCENARIO.id,
      },
      assertion: "producer-attribution",
      state: "proven",
      observation: observed(
        OAUTH_APPLICATION_RECON_SCENARIO,
        "observe-bounded-sign-in",
        "independent-detector",
        "record-match",
      ),
    },
    terminal(
      "terminal-application-reconnaissance",
      OAUTH_APPLICATION_RECON_SCENARIO,
      "application-reconnaissance",
      "artifact",
      "application-recon-summary",
      {
        state: "proven",
        observation: observed(
          OAUTH_APPLICATION_RECON_SCENARIO,
          "observe-bounded-sign-in",
          "independent-detector",
          "record-match",
        ),
      },
    ),
  ],
);

const purview = applyTruth(
  baselineReceipt(PURVIEW_AUDIT_BOUNDARY_SCENARIO),
  {
    "operation-submit-bounded-audit-query": {
      state: "proven",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "submit-bounded-audit-query",
        "independent-detector",
        "operation-result",
      ),
    },
    "operation-read-bounded-audit-status": {
      state: "proven",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "query-empty",
      ),
    },
    "artifact-purview-query-boundary": {
      state: "proven",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "operation-result",
      ),
    },
    "detector-independent": {
      state: "proven",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "operation-result",
      ),
    },
    "retention-purview-query-boundary": {
      state: "proven",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "operation-result",
      ),
    },
  },
  [
    {
      id: "surface-reachability",
      category: "independent-observation",
      subject: {
        kind: "scenario",
        id: PURVIEW_AUDIT_BOUNDARY_SCENARIO.id,
      },
      assertion: "surface-reachability",
      state: "proven",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "query-empty",
      ),
    },
    {
      id: "producer-attribution",
      category: "independent-observation",
      subject: {
        kind: "scenario",
        id: PURVIEW_AUDIT_BOUNDARY_SCENARIO.id,
      },
      assertion: "producer-attribution",
      state: "licensing-or-latency-blocked",
      observation: observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "query-blocked",
      ),
    },
    terminal(
      "terminal-purview-surface",
      PURVIEW_AUDIT_BOUNDARY_SCENARIO,
      "purview-surface-reachability",
      "artifact",
      "purview-query-boundary",
      {
        state: "proven",
        observation: observed(
          PURVIEW_AUDIT_BOUNDARY_SCENARIO,
          "read-bounded-audit-status",
          "independent-detector",
          "operation-result",
        ),
      },
    ),
  ],
);

export const CANONICAL_RECEIPT_FIXTURES: readonly ReceiptFixture[] = [
  {
    name: "help-desk-email",
    manifest: HELP_DESK_EMAIL_SCENARIO,
    receipt: helpDesk,
  },
  {
    name: "three-vm-avd",
    manifest: AVD_THREE_VM_SCENARIO,
    receipt: avdWithArtifacts,
  },
  {
    name: "teams-missed-call",
    manifest: TEAMS_MISSED_CALL_SCENARIO,
    receipt: teams,
  },
  {
    name: "application-reconnaissance",
    manifest: OAUTH_APPLICATION_RECON_SCENARIO,
    receipt: recon,
  },
  {
    name: "purview-audit-boundary",
    manifest: PURVIEW_AUDIT_BOUNDARY_SCENARIO,
    receipt: purview,
  },
];

function changed(
  receipt: ScenarioEvidenceReceipt,
  mutate: (copy: ScenarioEvidenceReceipt) => void,
): ScenarioEvidenceReceipt {
  const copy = structuredClone(receipt);
  mutate(copy);
  return copy;
}

export const NEGATIVE_RECEIPT_FIXTURES: readonly NegativeReceiptFixture[] = [
  {
    name: "help-desk-does-not-prove-teams",
    manifest: HELP_DESK_EMAIL_SCENARIO,
    receipt: changed(helpDesk, (copy) => {
      const claim = copy.claims.find((row) => row.id === "terminal-teams-call")!;
      claim.state = "proven";
      claim.observation = observed(
        HELP_DESK_EMAIL_SCENARIO,
        "read-marker-after",
        "learner-view",
        "platform-event",
      );
    }),
    expectedCode: "ungrounded-claim",
  },
  {
    name: "avd-does-not-prove-learner-session",
    manifest: AVD_THREE_VM_SCENARIO,
    receipt: changed(avdWithArtifacts, (copy) => {
      const claim = copy.claims.find(
        (row) => row.id === "terminal-learner-session",
      )!;
      claim.state = "proven";
      claim.observation = observed(
        AVD_THREE_VM_SCENARIO,
        "inspect-future-substrate",
        "learner-view",
        "learner-inspection",
      );
    }),
    expectedCode: "unsupported-visibility",
  },
  {
    name: "human-call-does-not-prove-automation",
    manifest: TEAMS_MISSED_CALL_SCENARIO,
    receipt: changed(teams, (copy) => {
      const claim = copy.claims.find(
        (row) => row.id === "terminal-unattended-automation",
      )!;
      claim.state = "proven";
      claim.observation = observed(
        TEAMS_MISSED_CALL_SCENARIO,
        "stage-one-audio-call",
        "provider-response",
        "human-assisted-artifact",
      );
    }),
    expectedCode: "state-promotion",
  },
  {
    name: "recon-rejects-role-conflation",
    manifest: OAUTH_APPLICATION_RECON_SCENARIO,
    receipt: changed(recon, (copy) => {
      copy.roles.detector = copy.roles.workloadActor;
    }),
    expectedCode: "role-conflation",
  },
  {
    name: "empty-purview-query-does-not-prove-attribution",
    manifest: PURVIEW_AUDIT_BOUNDARY_SCENARIO,
    receipt: changed(purview, (copy) => {
      const claim = copy.claims.find((row) => row.id === "producer-attribution")!;
      claim.state = "proven";
      claim.observation = observed(
        PURVIEW_AUDIT_BOUNDARY_SCENARIO,
        "read-bounded-audit-status",
        "independent-detector",
        "query-empty",
      );
    }),
    expectedCode: "state-promotion",
  },
];

export const RECEIPT_MANIFESTS = [
  HELP_DESK_EMAIL_SCENARIO,
  AVD_THREE_VM_SCENARIO,
  TEAMS_MISSED_CALL_SCENARIO,
  OAUTH_APPLICATION_RECON_SCENARIO,
  PURVIEW_AUDIT_BOUNDARY_SCENARIO,
  PRIVATE_DOCUMENT_EVIDENCE_SCENARIO,
] as const;
