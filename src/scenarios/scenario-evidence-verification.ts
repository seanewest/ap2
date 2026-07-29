import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import { HELP_DESK_EMAIL_SCENARIO } from "./help-desk-email";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon";
import { PURVIEW_AUDIT_BOUNDARY_SCENARIO } from "./purview-audit-boundary";
import {
  SHAREPOINT_TRUSTED_VERSION_LIFECYCLE_SCENARIO,
} from "./sharepoint-trusted-version-lifecycle";
import {
  EvidenceReceiptError,
  parseScenarioEvidenceReceipt,
  verifyScenarioEvidenceReceipt,
  type ClaimCategory,
  type ScenarioEvidenceReceipt,
  type VerifiedClaimRow,
} from "./scenario-evidence-receipt";
import { TEAMS_MISSED_CALL_SCENARIO } from "./teams-missed-call";

export const SCENARIO_EVIDENCE_RECEIPT_MANIFESTS = [
  HELP_DESK_EMAIL_SCENARIO,
  AVD_THREE_VM_SCENARIO,
  TEAMS_MISSED_CALL_SCENARIO,
  OAUTH_APPLICATION_RECON_SCENARIO,
  PURVIEW_AUDIT_BOUNDARY_SCENARIO,
  SHAREPOINT_TRUSTED_VERSION_LIFECYCLE_SCENARIO,
] as const;
const TERMINAL_CLAIM_ID_OVERRIDES = {
  "infrastructure-ready": "terminal-infrastructure",
  "intune-managed": "terminal-intune",
  "defender-onboarded": "terminal-defender",
  "infrastructure-removed": "terminal-cleanup",
  "spend-within-bound": "terminal-spend",
  "purview-surface-reachability": "terminal-purview-surface",
} as const;

export interface SafeVerifiedScenarioEvidenceReceipt {
  schemaVersion: 1;
  kind: "verified-scenario-evidence-receipt";
  scenarioId: string;
  manifestSchemaVersion: 2;
  evidenceBindingDigestSha256?: string;
  roles: ScenarioEvidenceReceipt["roles"];
  claims: readonly VerifiedClaimRow[];
  missingCoverage: readonly string[];
}

export function verifyCanonicalScenarioEvidenceReceipt(
  value: unknown,
): SafeVerifiedScenarioEvidenceReceipt {
  const receipt = parseScenarioEvidenceReceipt(value);
  validateClaimIds(receipt);
  const manifest = SCENARIO_EVIDENCE_RECEIPT_MANIFESTS.find(
    ({ id }) => id === receipt.scenario.id,
  );
  if (manifest === undefined) {
    throw new EvidenceReceiptError(
      "scenario-mismatch",
      "scenario ID is not in the receipt registry.",
    );
  }
  const verified = verifyScenarioEvidenceReceipt(receipt, manifest);
  return {
    schemaVersion: 1,
    kind: "verified-scenario-evidence-receipt",
    ...verified,
    missingCoverage: verified.claims
      .filter(({ state }) => state === "uninspected")
      .map(({ claimId }) => claimId),
  };
}

function validateClaimIds(receipt: ScenarioEvidenceReceipt): void {
  if (receipt.claims.some((claim) => claim.id !== canonicalClaimId(claim))) {
    throw new EvidenceReceiptError(
      "raw-identifier",
      "claim IDs must match the deterministic receipt contract.",
    );
  }
}

function canonicalClaimId(
  claim: ScenarioEvidenceReceipt["claims"][number],
): string {
  if (claim.category === "terminal-proof") {
    const override =
      TERMINAL_CLAIM_ID_OVERRIDES[
        claim.assertion as keyof typeof TERMINAL_CLAIM_ID_OVERRIDES
      ];
    if (override !== undefined) return override;
    return `terminal-${claim.assertion}`;
  }
  if (claim.category === "independent-observation") {
    return claim.assertion;
  }
  if (claim.category === "learner-interpretation") {
    return "learner-interpretation";
  }
  const prefixes: Partial<Record<ClaimCategory, string>> = {
    operation: "operation",
    artifact: "artifact",
    "learner-visibility": "visibility",
    response: "response",
    cleanup: "cleanup",
    retention: "retention",
  };
  const prefix = prefixes[claim.category];
  if (prefix === undefined) {
    throw new EvidenceReceiptError(
      "shape",
      "claim category does not have a deterministic ID rule.",
    );
  }
  return `${prefix}-${claim.subject.id}`;
}
