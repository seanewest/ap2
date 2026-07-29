import type {
  ClaimCategory,
  EvidenceReceiptErrorCode,
  ScenarioEvidenceReceipt,
} from "../scenarios/scenario-evidence-receipt";
import type {
  SafeVerifiedScenarioEvidenceReceipt,
} from "../scenarios/scenario-evidence-verification";

export const EVIDENCE_RECEIPT_ERROR_CODES = [
  "shape",
  "raw-identifier",
  "scenario-mismatch",
  "role-mismatch",
  "role-conflation",
  "unknown-target",
  "duplicate-claim",
  "claim-coverage",
  "missing-observation",
  "invalid-observation",
  "unsupported-visibility",
  "cleanup-gap",
  "state-promotion",
  "ungrounded-claim",
] as const satisfies readonly EvidenceReceiptErrorCode[];

const CLAIM_STATES = [
  "proven",
  "absent",
  "refused",
  "ambiguous",
  "licensing-or-latency-blocked",
  "uninspected",
] as const;
const CLAIM_CATEGORIES = [
  "operation",
  "artifact",
  "independent-observation",
  "learner-visibility",
  "learner-interpretation",
  "response",
  "cleanup",
  "retention",
  "terminal-proof",
] as const;
const CLAIM_ASSERTIONS = [
  "operation-completed",
  "artifact-authentic",
  "detector-independent",
  "producer-attribution",
  "surface-reachability",
  "learner-visible",
  "learner-interpreted",
  "response-completed",
  "cleanup-completed",
  "retention-confirmed",
  "unattended-automation",
  "infrastructure-ready",
  "learner-session",
  "intune-managed",
  "defender-onboarded",
  "spend-within-bound",
  "teams-call",
  "avd-ready",
  "application-reconnaissance",
  "endpoint-managed",
  "endpoint-state-removed",
  "expiry-removed",
  "infrastructure-removed",
  "outlook-email",
  "permissions-revoked",
  "private-three-vm-topology",
  "purview-surface-reachability",
  "sensitive-artifacts-absent",
  "teams-missed-call",
  "teams-voicemail",
] as const;
const SUBJECT_KINDS = [
  "scenario",
  "operation",
  "artifact",
  "response-action",
] as const;
const OBSERVATION_SOURCES = [
  "independent-detector",
  "learner-view",
  "platform-control-plane",
  "provider-response",
  "local-reconciliation",
] as const;
const OBSERVATION_OUTCOMES = [
  "operation-result",
  "platform-event",
  "record-match",
  "query-empty",
  "query-blocked",
  "provider-refusal",
  "exact-reconciliation",
  "learner-inspection",
  "human-assisted-artifact",
] as const;
const ARTIFACT_KINDS = [
  "avd-topology",
  "cleanup-state",
  "endpoint-posture",
  "outlook-email",
  "application-recon-summary",
  "purview-audit-summary",
  "private-network-topology",
  "teams-missed-call",
] as const;
const ARTIFACT_AUTHENTICITY = [
  "application-narrative",
  "platform-control-plane",
  "platform-native",
] as const;
const SAFE_ALIAS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_CLAIM_ID_OVERRIDES = {
  "infrastructure-ready": "terminal-infrastructure",
  "intune-managed": "terminal-intune",
  "defender-onboarded": "terminal-defender",
  "infrastructure-removed": "terminal-cleanup",
  "spend-within-bound": "terminal-spend",
  "purview-surface-reachability": "terminal-purview-surface",
} as const;

export class ScenarioEvidenceContractError extends Error {
  readonly code: "shape" | "raw-identifier";

  constructor(code: "shape" | "raw-identifier") {
    super("Scenario evidence receipt contract validation failed.");
    this.name = "ScenarioEvidenceContractError";
    this.code = code;
  }
}

export function parseScenarioEvidenceReceiptRequest(
  value: unknown,
): ScenarioEvidenceReceipt {
  const receipt = record(value);
  exactKeys(receipt, ["schemaVersion", "scenario", "roles", "claims"]);
  if (receipt.schemaVersion !== 1) fail("shape");
  const scenario = record(receipt.scenario);
  exactKeys(scenario, ["id", "manifestSchemaVersion"]);
  if (scenario.manifestSchemaVersion !== 2) fail("shape");
  const roles = parseRoles(receipt.roles);
  if (
    !Array.isArray(receipt.claims) ||
    receipt.claims.length === 0 ||
    receipt.claims.length > 256
  ) {
    fail("shape");
  }
  const claims = receipt.claims.map(parseClaim);
  if (claims.some((claim) => claim.id !== canonicalClaimId(claim))) {
    fail("raw-identifier");
  }
  return {
    schemaVersion: 1,
    scenario: {
      id: alias(scenario.id),
      manifestSchemaVersion: 2,
    },
    roles,
    claims,
  };
}

export function isExactSafeVerifiedReceipt(
  value: unknown,
  receipt: ScenarioEvidenceReceipt,
): value is SafeVerifiedScenarioEvidenceReceipt {
  if (!isRecord(value)) return false;
  try {
    exactKeys(value, [
      "schemaVersion",
      "kind",
      "scenarioId",
      "manifestSchemaVersion",
      "roles",
      "claims",
      "missingCoverage",
    ]);
  } catch {
    return false;
  }
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "verified-scenario-evidence-receipt" ||
    value.scenarioId !== receipt.scenario.id ||
    value.manifestSchemaVersion !== 2 ||
    !sameRoles(value.roles, receipt.roles) ||
    !Array.isArray(value.claims) ||
    value.claims.length !== receipt.claims.length ||
    !Array.isArray(value.missingCoverage)
  ) {
    return false;
  }
  const expectedRows = [...receipt.claims]
    .sort(compareClaims)
    .map(normalizedClaim);
  if (
    value.claims.some((row, index) =>
      canonicalJson(row) !== canonicalJson(expectedRows[index])
    )
  ) {
    return false;
  }
  const expectedMissing = expectedRows
    .filter(({ state }) => state === "uninspected")
    .map(({ claimId }) => claimId);
  return canonicalJson(value.missingCoverage) === canonicalJson(expectedMissing);
}

function parseRoles(value: unknown): ScenarioEvidenceReceipt["roles"] {
  const roles = record(value);
  exactKeys(
    roles,
    ["evidenceProducer", "workloadActor", "learner", "detector", "responder"],
    ["detector", "responder"],
  );
  return {
    evidenceProducer: alias(roles.evidenceProducer),
    workloadActor: alias(roles.workloadActor),
    learner: alias(roles.learner),
    ...(roles.detector === undefined ? {} : { detector: alias(roles.detector) }),
    ...(roles.responder === undefined
      ? {}
      : { responder: alias(roles.responder) }),
  };
}

function parseClaim(
  value: unknown,
): ScenarioEvidenceReceipt["claims"][number] {
  const claim = record(value);
  exactKeys(
    claim,
    ["id", "category", "subject", "assertion", "state", "artifact", "observation"],
    ["artifact", "observation"],
  );
  const subject = record(claim.subject);
  exactKeys(subject, ["kind", "id"]);
  const artifact = claim.artifact === undefined
    ? undefined
    : parseArtifact(claim.artifact);
  const observation = claim.observation === undefined
    ? undefined
    : parseObservation(claim.observation);
  return {
    id: alias(claim.id),
    category: enumeration(claim.category, CLAIM_CATEGORIES),
    subject: {
      kind: enumeration(subject.kind, SUBJECT_KINDS),
      id: alias(subject.id),
    },
    assertion: enumeration(claim.assertion, CLAIM_ASSERTIONS),
    state: enumeration(claim.state, CLAIM_STATES),
    ...(artifact === undefined ? {} : { artifact }),
    ...(observation === undefined ? {} : { observation }),
  };
}

function parseArtifact(
  value: unknown,
): NonNullable<ScenarioEvidenceReceipt["claims"][number]["artifact"]> {
  const artifact = record(value);
  exactKeys(artifact, ["kind", "authenticity"]);
  return {
    kind: enumeration(artifact.kind, ARTIFACT_KINDS),
    authenticity: enumeration(
      artifact.authenticity,
      ARTIFACT_AUTHENTICITY,
    ),
  };
}

function parseObservation(
  value: unknown,
): NonNullable<ScenarioEvidenceReceipt["claims"][number]["observation"]> {
  const observation = record(value);
  exactKeys(
    observation,
    [
      "source",
      "outcome",
      "observerActorId",
      "operationKey",
      "identityBindingDigestSha256",
    ],
    ["identityBindingDigestSha256"],
  );
  const identityBindingDigestSha256 =
    observation.identityBindingDigestSha256 === undefined
      ? undefined
      : digest(observation.identityBindingDigestSha256);
  return {
    source: enumeration(observation.source, OBSERVATION_SOURCES),
    outcome: enumeration(observation.outcome, OBSERVATION_OUTCOMES),
    observerActorId: alias(observation.observerActorId),
    operationKey: alias(observation.operationKey),
    ...(identityBindingDigestSha256 === undefined
      ? {}
      : { identityBindingDigestSha256 }),
  };
}

function normalizedClaim(
  claim: ScenarioEvidenceReceipt["claims"][number],
): SafeVerifiedScenarioEvidenceReceipt["claims"][number] {
  return {
    claimId: claim.id,
    category: claim.category,
    subject: `${claim.subject.kind}:${claim.subject.id}`,
    assertion: claim.assertion,
    state: claim.state,
    observationSource: claim.observation?.source ?? "none",
    observationOutcome: claim.observation?.outcome ?? "none",
    observerActor: claim.observation?.observerActorId ?? "none",
    artifactKind: claim.artifact?.kind ?? "none",
    artifactAuthenticity: claim.artifact?.authenticity ?? "none",
  };
}

function sameRoles(
  value: unknown,
  expected: ScenarioEvidenceReceipt["roles"],
): boolean {
  if (!isRecord(value)) return false;
  try {
    exactKeys(
      value,
      ["evidenceProducer", "workloadActor", "learner", "detector", "responder"],
      ["detector", "responder"],
    );
  } catch {
    return false;
  }
  return (
    value.evidenceProducer === expected.evidenceProducer &&
    value.workloadActor === expected.workloadActor &&
    value.learner === expected.learner &&
    value.detector === expected.detector &&
    value.responder === expected.responder
  );
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
  if (prefix === undefined) fail("shape");
  return `${prefix}-${claim.subject.id}`;
}

function compareClaims(
  left: ScenarioEvidenceReceipt["claims"][number],
  right: ScenarioEvidenceReceipt["claims"][number],
): number {
  return claimTuple(left).localeCompare(claimTuple(right)) ||
    left.id.localeCompare(right.id);
}

function claimTuple(
  claim: ScenarioEvidenceReceipt["claims"][number],
): string {
  return [
    claim.category,
    claim.subject.kind,
    claim.subject.id,
    claim.assertion,
  ].join(":");
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail("shape");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(value).sort();
  const expected = allowed
    .filter((key) => !optional.includes(key) || value[key] !== undefined)
    .sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) fail("shape");
}

function alias(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !SAFE_ALIAS.test(value) ||
    GUID.test(value)
  ) {
    fail("raw-identifier");
  }
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("invalid receipt");
  }
  return value;
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail("shape");
  return value as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(code: "shape" | "raw-identifier"): never {
  throw new ScenarioEvidenceContractError(code);
}
