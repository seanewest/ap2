import {
  parseScenarioManifest,
  type ScenarioArtifactKind,
  type ScenarioManifest,
} from "./scenario-manifest.ts";

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
const ARTIFACT_AUTHENTICITY = [
  "application-narrative",
  "platform-control-plane",
  "platform-native",
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
  "private-document-staged",
  "purview-surface-reachability",
  "sensitive-artifacts-absent",
  "teams-missed-call",
  "teams-voicemail",
] as const;

const ASSERTIONS_BY_CATEGORY = {
  operation: ["operation-completed"],
  artifact: ["artifact-authentic"],
  "independent-observation": [
    "detector-independent",
    "producer-attribution",
    "surface-reachability",
  ],
  "learner-visibility": ["learner-visible"],
  "learner-interpretation": ["learner-interpreted"],
  response: ["response-completed"],
  cleanup: ["cleanup-completed"],
  retention: ["retention-confirmed"],
  "terminal-proof": [
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
    "private-document-staged",
    "purview-surface-reachability",
    "sensitive-artifacts-absent",
    "teams-missed-call",
    "teams-voicemail",
  ],
} as const satisfies Record<ClaimCategory, readonly ClaimAssertion[]>;

const MAX_CLAIMS = 256;
const MAX_ALIAS = 100;
const SAFE_ALIAS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClaimState = typeof CLAIM_STATES[number];
export type ClaimCategory = typeof CLAIM_CATEGORIES[number];
export type ClaimAssertion = typeof CLAIM_ASSERTIONS[number];
export type ClaimSubjectKind = typeof SUBJECT_KINDS[number];
export type ObservationSource = typeof OBSERVATION_SOURCES[number];
export type ObservationOutcome = typeof OBSERVATION_OUTCOMES[number];
export type ReceiptArtifactAuthenticity =
  typeof ARTIFACT_AUTHENTICITY[number];

export interface EvidenceReceiptObservation {
  source: ObservationSource;
  outcome: ObservationOutcome;
  observerActorId: string;
  operationKey: string;
}

export interface EvidenceReceiptClaim {
  id: string;
  category: ClaimCategory;
  subject: {
    kind: ClaimSubjectKind;
    id: string;
  };
  assertion: ClaimAssertion;
  state: ClaimState;
  artifact?: {
    kind: ScenarioArtifactKind;
    authenticity: ReceiptArtifactAuthenticity;
  };
  observation?: EvidenceReceiptObservation;
}

export interface ScenarioEvidenceReceipt {
  schemaVersion: 1;
  scenario: {
    id: string;
    manifestSchemaVersion: 2;
  };
  roles: {
    evidenceProducer: string;
    workloadActor: string;
    learner: string;
    detector?: string;
    responder?: string;
  };
  claims: readonly EvidenceReceiptClaim[];
}

export interface VerifiedClaimRow {
  claimId: string;
  category: ClaimCategory;
  subject: string;
  assertion: ClaimAssertion;
  state: ClaimState;
  observationSource: ObservationSource | "none";
  observationOutcome: ObservationOutcome | "none";
  observerActor: string | "none";
  artifactKind: ScenarioArtifactKind | "none";
  artifactAuthenticity: ReceiptArtifactAuthenticity | "none";
}

export interface VerifiedScenarioEvidenceReceipt {
  scenarioId: string;
  manifestSchemaVersion: 2;
  roles: ScenarioEvidenceReceipt["roles"];
  claims: readonly VerifiedClaimRow[];
}

export type EvidenceReceiptErrorCode =
  | "shape"
  | "raw-identifier"
  | "scenario-mismatch"
  | "role-mismatch"
  | "role-conflation"
  | "unknown-target"
  | "duplicate-claim"
  | "claim-coverage"
  | "missing-observation"
  | "invalid-observation"
  | "unsupported-visibility"
  | "cleanup-gap"
  | "state-promotion"
  | "ungrounded-claim";

export class EvidenceReceiptError extends Error {
  readonly code: EvidenceReceiptErrorCode;

  constructor(
    code: EvidenceReceiptErrorCode,
    message: string,
  ) {
    super(`Invalid scenario evidence receipt [${code}]: ${message}`);
    this.name = "EvidenceReceiptError";
    this.code = code;
  }
}

export function readScenarioIdFromEvidenceReceipt(value: unknown): string {
  const receipt = object(value, "shape");
  const scenario = object(receipt.scenario, "shape");
  return alias(scenario.id);
}

export function verifyScenarioEvidenceReceipt(
  value: unknown,
  manifestValue: ScenarioManifest,
): VerifiedScenarioEvidenceReceipt {
  const manifest = parseScenarioManifest(manifestValue);
  const receipt = parseReceipt(value);
  verifyScenario(receipt, manifest);
  verifyRoles(receipt, manifest);
  verifyClaims(receipt, manifest);
  return {
    scenarioId: receipt.scenario.id,
    manifestSchemaVersion: 2,
    roles: receipt.roles,
    claims: [...receipt.claims]
      .sort(compareClaims)
      .map((claim) => ({
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
      })),
  };
}

export function formatVerifiedClaimTable(
  verified: VerifiedScenarioEvidenceReceipt,
): string {
  const header = [
    "CLAIM",
    "CATEGORY",
    "SUBJECT",
    "ASSERTION",
    "STATE",
    "SOURCE",
    "OUTCOME",
    "OBSERVER",
    "ARTIFACT_KIND",
    "ARTIFACT_AUTHENTICITY",
  ].join("\t");
  const rows = verified.claims.map((claim) =>
    [
      claim.claimId,
      claim.category,
      claim.subject,
      claim.assertion,
      claim.state,
      claim.observationSource,
      claim.observationOutcome,
      claim.observerActor,
      claim.artifactKind,
      claim.artifactAuthenticity,
    ].join("\t")
  );
  return [header, ...rows].join("\n");
}

function parseReceipt(value: unknown): ScenarioEvidenceReceipt {
  const receipt = object(value, "shape");
  exactKeys(receipt, ["schemaVersion", "scenario", "roles", "claims"]);
  if (receipt.schemaVersion !== 1) {
    throw failure("shape", "schemaVersion must be 1.");
  }
  const scenario = object(receipt.scenario, "shape");
  exactKeys(scenario, ["id", "manifestSchemaVersion"]);
  if (scenario.manifestSchemaVersion !== 2) {
    throw failure("shape", "manifestSchemaVersion must be 2.");
  }
  const roles = parseRoles(receipt.roles);
  if (!Array.isArray(receipt.claims)) {
    throw failure("shape", "claims must be an array.");
  }
  if (receipt.claims.length === 0 || receipt.claims.length > MAX_CLAIMS) {
    throw failure("shape", "claims must contain between 1 and 256 rows.");
  }
  return {
    schemaVersion: 1,
    scenario: {
      id: alias(scenario.id),
      manifestSchemaVersion: 2,
    },
    roles,
    claims: receipt.claims.map(parseClaim),
  };
}

function parseRoles(value: unknown): ScenarioEvidenceReceipt["roles"] {
  const roles = object(value, "shape");
  exactKeys(
    roles,
    ["evidenceProducer", "workloadActor", "learner", "detector", "responder"],
    ["detector", "responder"],
  );
  return {
    evidenceProducer: alias(roles.evidenceProducer),
    workloadActor: alias(roles.workloadActor),
    learner: alias(roles.learner),
    ...(roles.detector === undefined
      ? {}
      : { detector: alias(roles.detector) }),
    ...(roles.responder === undefined
      ? {}
      : { responder: alias(roles.responder) }),
  };
}

function parseClaim(value: unknown, index: number): EvidenceReceiptClaim {
  const claim = object(value, "shape");
  exactKeys(
    claim,
    [
      "id",
      "category",
      "subject",
      "assertion",
      "state",
      "artifact",
      "observation",
    ],
    ["artifact", "observation"],
  );
  const subject = object(claim.subject, "shape");
  exactKeys(subject, ["kind", "id"]);
  const observation = claim.observation === undefined
    ? undefined
    : parseObservation(claim.observation);
  const artifact = claim.artifact === undefined
    ? undefined
    : parseArtifactCategory(claim.artifact);
  return {
    id: alias(claim.id),
    category: enumeration(
      claim.category,
      CLAIM_CATEGORIES,
      `claims[${index}].category`,
    ),
    subject: {
      kind: enumeration(
        subject.kind,
        SUBJECT_KINDS,
        `claims[${index}].subject.kind`,
      ),
      id: alias(subject.id),
    },
    assertion: enumeration(
      claim.assertion,
      CLAIM_ASSERTIONS,
      `claims[${index}].assertion`,
    ),
    state: enumeration(
      claim.state,
      CLAIM_STATES,
      `claims[${index}].state`,
    ),
    ...(artifact === undefined ? {} : { artifact }),
    ...(observation === undefined ? {} : { observation }),
  };
}

function parseArtifactCategory(
  value: unknown,
): NonNullable<EvidenceReceiptClaim["artifact"]> {
  const artifact = object(value, "shape");
  exactKeys(artifact, ["kind", "authenticity"]);
  return {
    kind: enumeration(
      artifact.kind,
      [
        "avd-topology",
        "cleanup-state",
        "endpoint-posture",
        "outlook-email",
        "private-document",
        "application-recon-summary",
        "purview-audit-summary",
        "private-network-topology",
        "teams-missed-call",
      ],
      "artifact.kind",
    ),
    authenticity: enumeration(
      artifact.authenticity,
      ARTIFACT_AUTHENTICITY,
      "artifact.authenticity",
    ),
  };
}

function parseObservation(value: unknown): EvidenceReceiptObservation {
  const observation = object(value, "shape");
  exactKeys(
    observation,
    ["source", "outcome", "observerActorId", "operationKey"],
  );
  return {
    source: enumeration(
      observation.source,
      OBSERVATION_SOURCES,
      "observation.source",
    ),
    outcome: enumeration(
      observation.outcome,
      OBSERVATION_OUTCOMES,
      "observation.outcome",
    ),
    observerActorId: alias(observation.observerActorId),
    operationKey: alias(observation.operationKey),
  };
}

function verifyScenario(
  receipt: ScenarioEvidenceReceipt,
  manifest: ScenarioManifest,
): void {
  if (
    receipt.scenario.id !== manifest.id ||
    receipt.scenario.manifestSchemaVersion !== manifest.schemaVersion
  ) {
    throw failure("scenario-mismatch", "scenario ID or version does not match.");
  }
}

function verifyRoles(
  receipt: ScenarioEvidenceReceipt,
  manifest: ScenarioManifest,
): void {
  if (receipt.roles.evidenceProducer === receipt.roles.learner) {
    throw failure(
      "role-conflation",
      "evidence producer and learner are conflated.",
    );
  }
  if (
    receipt.roles.detector !== undefined &&
    receipt.roles.detector === receipt.roles.workloadActor
  ) {
    throw failure(
      "role-conflation",
      "detector and workload actor are conflated.",
    );
  }
  if (
    receipt.roles.evidenceProducer !== manifest.roles.evidenceProducer ||
    receipt.roles.workloadActor !== manifest.roles.workloadActor ||
    receipt.roles.learner !== manifest.roles.learner ||
    receipt.roles.detector !== manifest.roles.detector ||
    receipt.roles.responder !== manifest.roles.responder
  ) {
    throw failure("role-mismatch", "receipt roles do not match the manifest.");
  }
}

function verifyClaims(
  receipt: ScenarioEvidenceReceipt,
  manifest: ScenarioManifest,
): void {
  const actors = new Map(manifest.actors.map((actor) => [actor.id, actor]));
  const operations = new Map(
    manifest.operations.map((operation) => [operation.key, operation]),
  );
  const artifacts = new Map(
    manifest.evidence.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const responses = new Map(
    manifest.responseActions.map((action) => [action.id, action]),
  );
  const claimIds = new Set<string>();
  const claimTuples = new Set<string>();

  for (const claim of receipt.claims) {
    if (claimIds.has(claim.id)) {
      throw failure("duplicate-claim", "claim IDs must be unique.");
    }
    claimIds.add(claim.id);
    const tuple = claimTuple(claim);
    if (claimTuples.has(tuple)) {
      throw failure("duplicate-claim", "claim targets must be unique.");
    }
    claimTuples.add(tuple);
    verifyCategory(claim);
    verifyTarget(claim, manifest, operations, artifacts, responses);
    verifyObservation(claim, manifest, actors, operations);
  }

  verifyCoverage(receipt.claims, manifest);
  for (const claim of receipt.claims) {
    verifyGrounding(claim, receipt.claims, manifest, operations, artifacts);
  }
}

function verifyCategory(claim: EvidenceReceiptClaim): void {
  const allowed = ASSERTIONS_BY_CATEGORY[claim.category];
  if (!(allowed as readonly ClaimAssertion[]).includes(claim.assertion)) {
    throw failure(
      "ungrounded-claim",
      "claim assertion is not valid for its category.",
    );
  }
  const expectedSubject: Partial<Record<ClaimCategory, ClaimSubjectKind>> = {
    operation: "operation",
    artifact: "artifact",
    "independent-observation": "scenario",
    "learner-visibility": "artifact",
    "learner-interpretation": "scenario",
    response: "response-action",
    cleanup: "operation",
    retention: "artifact",
  };
  const expected = expectedSubject[claim.category];
  if (expected !== undefined && claim.subject.kind !== expected) {
    throw failure("unknown-target", "claim subject kind is invalid.");
  }
  if (
    (claim.category === "artifact") !== (claim.artifact !== undefined)
  ) {
    throw failure(
      "ungrounded-claim",
      "only artifact claims must identify an artifact category.",
    );
  }
}

function verifyTarget(
  claim: EvidenceReceiptClaim,
  manifest: ScenarioManifest,
  operations: ReadonlyMap<string, ScenarioManifest["operations"][number]>,
  artifacts: ReadonlyMap<
    string,
    ScenarioManifest["evidence"]["artifacts"][number]
  >,
  responses: ReadonlyMap<
    string,
    ScenarioManifest["responseActions"][number]
  >,
): void {
  const exists = claim.subject.kind === "scenario"
    ? claim.subject.id === manifest.id
    : claim.subject.kind === "operation"
    ? operations.has(claim.subject.id)
    : claim.subject.kind === "artifact"
    ? artifacts.has(claim.subject.id)
    : responses.has(claim.subject.id);
  if (!exists) {
    throw failure("unknown-target", "claim target is not in the manifest.");
  }
}

function verifyObservation(
  claim: EvidenceReceiptClaim,
  manifest: ScenarioManifest,
  actors: ReadonlyMap<string, ScenarioManifest["actors"][number]>,
  operations: ReadonlyMap<string, ScenarioManifest["operations"][number]>,
): void {
  if (claim.state === "uninspected") {
    if (claim.observation !== undefined) {
      throw failure(
        "state-promotion",
        "uninspected claims cannot carry an observation.",
      );
    }
    return;
  }
  if (claim.observation === undefined) {
    throw failure(
      "missing-observation",
      "terminal claims require an observation source.",
    );
  }
  const observation = claim.observation;
  const observer = actors.get(observation.observerActorId);
  const operation = operations.get(observation.operationKey);
  if (
    observer === undefined ||
    operation === undefined ||
    operation.ownerActorId !== observer.id
  ) {
    throw failure(
      "invalid-observation",
      "observation actor and operation ownership do not match.",
    );
  }
  if (
    observation.source === "independent-detector" &&
    observation.observerActorId !== manifest.roles.detector
  ) {
    throw failure(
      "invalid-observation",
      "independent observation must use the manifest detector.",
    );
  }
  if (
    observation.source === "learner-view" &&
    observation.observerActorId !== manifest.roles.learner
  ) {
    throw failure(
      "invalid-observation",
      "learner observation must use the manifest learner.",
    );
  }
  if (
    observation.source === "local-reconciliation" &&
    observation.observerActorId !== manifest.lifecycle.cleanupOwnerActorId
  ) {
    throw failure(
      "invalid-observation",
      "cleanup reconciliation must use the cleanup owner.",
    );
  }
  if (
    claim.state === "refused" &&
    observation.outcome !== "provider-refusal"
  ) {
    throw failure("state-promotion", "refused requires provider-refusal.");
  }
  if (
    claim.state === "licensing-or-latency-blocked" &&
    observation.outcome !== "query-blocked"
  ) {
    throw failure("state-promotion", "blocked requires query-blocked.");
  }
  if (
    claim.state === "absent" &&
    observation.outcome !== "exact-reconciliation"
  ) {
    throw failure(
      "state-promotion",
      "absence requires exact reconciliation.",
    );
  }
  if (
    claim.state === "proven" &&
    (
      observation.outcome === "query-blocked" ||
      observation.outcome === "provider-refusal"
    )
  ) {
    throw failure(
      "state-promotion",
      "blocked or refused observations cannot prove a claim.",
    );
  }
  if (
    claim.state === "proven" &&
    observation.outcome === "query-empty" &&
    claim.assertion !== "operation-completed" &&
    claim.assertion !== "surface-reachability"
  ) {
    throw failure(
      "state-promotion",
      "an empty query proves only reachability or its own outcome.",
    );
  }
}

function verifyCoverage(
  claims: readonly EvidenceReceiptClaim[],
  manifest: ScenarioManifest,
): void {
  requireClaims(
    claims,
    "operation",
    "operation-completed",
    manifest.operations.map((operation) => operation.key),
    "claim-coverage",
  );
  requireClaims(
    claims,
    "artifact",
    "artifact-authentic",
    manifest.evidence.artifacts.map((artifact) => artifact.id),
    "claim-coverage",
  );
  requireClaims(
    claims,
    "learner-visibility",
    "learner-visible",
    manifest.learner.evidenceArtifactIds,
    "claim-coverage",
  );
  requireClaims(
    claims,
    "learner-interpretation",
    "learner-interpreted",
    [manifest.id],
    "claim-coverage",
  );
  requireClaims(
    claims,
    "response",
    "response-completed",
    manifest.responseActions.map((action) => action.id),
    "claim-coverage",
  );
  requireClaims(
    claims,
    "cleanup",
    "cleanup-completed",
    manifest.lifecycle.cleanupOperationKeys,
    "cleanup-gap",
  );
  requireClaims(
    claims,
    "retention",
    "retention-confirmed",
    manifest.evidence.artifacts.map((artifact) => artifact.id),
    "cleanup-gap",
  );
  if (!claims.some((claim) => claim.category === "terminal-proof")) {
    throw failure("claim-coverage", "terminal proof claim is required.");
  }
  if (manifest.detection?.kind === "independent") {
    requireClaims(
      claims,
      "independent-observation",
      "detector-independent",
      [manifest.id],
      "claim-coverage",
    );
  }
}

function requireClaims(
  claims: readonly EvidenceReceiptClaim[],
  category: ClaimCategory,
  assertion: ClaimAssertion,
  expectedIds: readonly string[],
  code: "claim-coverage" | "cleanup-gap",
): void {
  const actual = claims
    .filter((claim) =>
      claim.category === category && claim.assertion === assertion
    )
    .map((claim) => claim.subject.id)
    .sort();
  const expected = [...expectedIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw failure(code, "required claim coverage is incomplete.");
  }
}

function verifyGrounding(
  claim: EvidenceReceiptClaim,
  claims: readonly EvidenceReceiptClaim[],
  manifest: ScenarioManifest,
  operations: ReadonlyMap<string, ScenarioManifest["operations"][number]>,
  artifacts: ReadonlyMap<
    string,
    ScenarioManifest["evidence"]["artifacts"][number]
  >,
): void {
  if (
    claim.category === "cleanup" &&
    (claim.state === "proven" || claim.state === "absent")
  ) {
    const observation = claim.observation!;
    const observationOperation = operations.get(observation.operationKey)!;
    if (
      observation.operationKey === claim.subject.id ||
      observationOperation.effect !== "read" ||
      observation.outcome !== "exact-reconciliation"
    ) {
      throw failure(
        "cleanup-gap",
        "cleanup proof requires a separate exact terminal read.",
      );
    }
    return;
  }
  if (
    claim.category === "retention" &&
    (claim.state === "proven" || claim.state === "absent")
  ) {
    const observation = claim.observation!;
    const observationOperation = operations.get(observation.operationKey)!;
    if (observationOperation.effect !== "read") {
      throw failure(
        "cleanup-gap",
        "retention proof requires a terminal read.",
      );
    }
    return;
  }
  if (claim.state !== "proven") {
    return;
  }
  const observation = claim.observation!;
  if (claim.category === "operation") {
    if (observation.operationKey !== claim.subject.id) {
      throw failure(
        "ungrounded-claim",
        "operation proof must observe that operation.",
      );
    }
    return;
  }
  if (claim.category === "artifact") {
    const artifact = artifacts.get(claim.subject.id)!;
    const privateDocumentStagingCapabilities = [
      "private-document.folder-create",
      "private-document.file-create",
      "private-document.permission-create",
    ];
    const privateDocumentStagingOperations = manifest.operations.filter(
      (operation) =>
        privateDocumentStagingCapabilities.includes(operation.capability),
    );
    const observedArtifact =
      artifact.observation !== undefined &&
      observation.operationKey === artifact.observation.operationKey;
    const acceptedArtifact =
      manifest.id === "private-document-evidence" &&
      artifact.id === "private-text-document" &&
      artifact.kind === "private-document" &&
      artifact.semanticClaims.includes("private-document-staged") &&
      artifact.state === "platform-accepted" &&
      artifact.observation === undefined &&
      artifact.sourceOperationKey === "grant-direct-learner-read" &&
      observation.operationKey === artifact.sourceOperationKey &&
      observation.source === "local-reconciliation" &&
      observation.outcome === "exact-reconciliation" &&
      privateDocumentStagingOperations.length ===
        privateDocumentStagingCapabilities.length &&
      new Set(
        privateDocumentStagingOperations.map((operation) =>
          operation.capability
        ),
      ).size === privateDocumentStagingCapabilities.length &&
      privateDocumentStagingOperations
        .every((operation) =>
          hasProvenOperation(claims, operation.key)
        );
    if (
      claim.artifact?.kind !== artifact.kind ||
      claim.artifact.authenticity !== artifact.authenticity ||
      (!observedArtifact && !acceptedArtifact)
    ) {
      throw failure(
        "ungrounded-claim",
        "artifact proof must use its manifest observation.",
      );
    }
    return;
  }
  if (claim.category === "independent-observation") {
    verifyIndependentGrounding(claim, claims, manifest, operations, artifacts);
    return;
  }
  if (claim.category === "learner-visibility") {
    const artifact = artifacts.get(claim.subject.id)!;
    const operation = operations.get(observation.operationKey);
    const exactLearnerRead =
      observation.operationKey === "read-private-document-exact" &&
      operation?.phase === "evidence" &&
      operation.effect === "read" &&
      operation.capability === "artifact.read-exact" &&
      operation.ownerActorId === manifest.roles.learner;
    if (
      (
        artifact.learnerVisibility !== "observed" &&
        !(
          manifest.id === "private-document-evidence" &&
          artifact.id === "private-text-document" &&
          artifact.kind === "private-document" &&
          exactLearnerRead
        )
      ) ||
      observation.source !== "learner-view" ||
      observation.outcome !== "learner-inspection"
    ) {
      throw failure(
        "unsupported-visibility",
        "learner visibility is not grounded by learner inspection.",
      );
    }
    return;
  }
  if (claim.category === "learner-interpretation") {
    if (
      manifest.learner.completionState !== "completed" ||
      observation.source !== "learner-view" ||
      observation.outcome !== "learner-inspection"
    ) {
      throw failure(
        "unsupported-visibility",
        "learner interpretation is not completed.",
      );
    }
    return;
  }
  if (claim.category === "response") {
    const response = manifest.responseActions.find(
      (action) => action.id === claim.subject.id,
    )!;
    if (observation.operationKey !== response.operationKey) {
      throw failure(
        "ungrounded-claim",
        "response proof must observe its response operation.",
      );
    }
    return;
  }
  verifyTerminalGrounding(claim, claims, manifest, operations, artifacts);
}

function verifyIndependentGrounding(
  claim: EvidenceReceiptClaim,
  claims: readonly EvidenceReceiptClaim[],
  manifest: ScenarioManifest,
  operations: ReadonlyMap<string, ScenarioManifest["operations"][number]>,
  artifacts: ReadonlyMap<
    string,
    ScenarioManifest["evidence"]["artifacts"][number]
  >,
): void {
  const observation = claim.observation!;
  if (
    observation.source !== "independent-detector" ||
    manifest.roles.detector === undefined ||
    manifest.roles.detector === manifest.roles.workloadActor
  ) {
    throw failure(
      "ungrounded-claim",
      "independent proof requires the distinct manifest detector.",
    );
  }
  if (claim.assertion === "detector-independent") {
    return;
  }
  if (claim.assertion === "surface-reachability") {
    if (
      observation.outcome !== "record-match" &&
      observation.outcome !== "query-empty" &&
      observation.outcome !== "operation-result"
    ) {
      throw failure(
        "ungrounded-claim",
        "surface reachability lacks an accepted query outcome.",
      );
    }
    return;
  }
  const grounded = claims.some((artifactClaim) => {
    if (
      artifactClaim.category !== "artifact" ||
      artifactClaim.state !== "proven" ||
      artifactClaim.observation?.source !== "independent-detector" ||
      artifactClaim.observation.outcome !== "record-match"
    ) {
      return false;
    }
    const artifact = artifacts.get(artifactClaim.subject.id);
    const source = artifact === undefined
      ? undefined
      : operations.get(artifact.sourceOperationKey);
    return source?.ownerActorId === manifest.roles.workloadActor;
  });
  if (!grounded || observation.outcome !== "record-match") {
    throw failure(
      "state-promotion",
      "producer attribution lacks an exact detector record match.",
    );
  }
}

function verifyTerminalGrounding(
  claim: EvidenceReceiptClaim,
  claims: readonly EvidenceReceiptClaim[],
  manifest: ScenarioManifest,
  operations: ReadonlyMap<string, ScenarioManifest["operations"][number]>,
  artifacts: ReadonlyMap<
    string,
    ScenarioManifest["evidence"]["artifacts"][number]
  >,
): void {
  if (claim.assertion === "unattended-automation") {
    if (claim.subject.kind !== "operation") {
      throw failure("ungrounded-claim", "automation must target an operation.");
    }
    const operation = operations.get(claim.subject.id)!;
    const owner = manifest.actors.find(
      (actor) => actor.id === operation.ownerActorId,
    )!;
    if (
      operation.capability.endsWith(".manual") ||
      owner.kind === "human" ||
      owner.kind === "simulated-user" ||
      claim.observation?.outcome === "human-assisted-artifact"
    ) {
      throw failure(
        "state-promotion",
        "human-assisted evidence cannot prove unattended automation.",
      );
    }
    return;
  }
  if (claim.assertion === "learner-session") {
    const visibility = claims.some((row) =>
      row.category === "learner-visibility" && row.state === "proven"
    );
    const interpretation = claims.some((row) =>
      row.category === "learner-interpretation" && row.state === "proven"
    );
    if (!visibility || !interpretation) {
      throw failure(
        "unsupported-visibility",
        "learner session lacks visibility and interpretation proof.",
      );
    }
    return;
  }
  if (claim.assertion === "infrastructure-ready") {
    if (
      claim.subject.kind !== "artifact" ||
      !["avd-topology", "private-network-topology"].includes(
        artifacts.get(claim.subject.id)?.kind ?? "",
      ) ||
      !hasProvenArtifact(claims, claim.subject.id)
    ) {
      throw failure(
        "ungrounded-claim",
        "infrastructure proof lacks an authentic topology artifact.",
      );
    }
    return;
  }
  if (
    claim.assertion === "intune-managed" ||
    claim.assertion === "defender-onboarded"
  ) {
    if (
      claim.subject.kind !== "artifact" ||
      artifacts.get(claim.subject.id)?.kind !== "endpoint-posture" ||
      !hasProvenArtifact(claims, claim.subject.id)
    ) {
      throw failure(
        "ungrounded-claim",
        "endpoint claim lacks an authentic endpoint-posture artifact.",
      );
    }
    return;
  }
  if (claim.assertion === "spend-within-bound") {
    if (
      claim.subject.kind !== "scenario" ||
      claim.observation?.source !== "platform-control-plane" ||
      claim.observation.outcome !== "exact-reconciliation"
    ) {
      throw failure(
        "ungrounded-claim",
        "spend proof lacks control-plane reconciliation.",
      );
    }
    return;
  }
  if (claim.assertion === "teams-call") {
    if (
      claim.subject.kind !== "artifact" ||
      !artifacts.get(claim.subject.id)?.semanticClaims.includes(
        "teams-missed-call",
      ) ||
      !hasProvenArtifact(claims, claim.subject.id)
    ) {
      throw failure(
        "ungrounded-claim",
        "Teams call lacks an authentic missed-call artifact.",
      );
    }
    return;
  }
  if (
    claim.subject.kind !== "artifact" ||
    !artifacts.get(claim.subject.id)?.semanticClaims.includes(
      claim.assertion as never,
    ) ||
    !hasProvenArtifact(claims, claim.subject.id)
  ) {
    throw failure(
      "ungrounded-claim",
      "semantic proof lacks its authentic manifest artifact.",
    );
  }
}

function hasProvenArtifact(
  claims: readonly EvidenceReceiptClaim[],
  artifactId: string,
): boolean {
  return claims.some((claim) =>
    claim.category === "artifact" &&
    claim.subject.id === artifactId &&
    claim.state === "proven"
  );
}

function hasProvenOperation(
  claims: readonly EvidenceReceiptClaim[],
  operationKey: string,
): boolean {
  return claims.some((claim) =>
    claim.category === "operation" &&
    claim.subject.id === operationKey &&
    claim.state === "proven"
  );
}

function claimTuple(claim: EvidenceReceiptClaim): string {
  return [
    claim.category,
    claim.subject.kind,
    claim.subject.id,
    claim.assertion,
  ].join(":");
}

function compareClaims(
  left: EvidenceReceiptClaim,
  right: EvidenceReceiptClaim,
): number {
  return claimTuple(left).localeCompare(claimTuple(right)) ||
    left.id.localeCompare(right.id);
}

function object(
  value: unknown,
  code: EvidenceReceiptErrorCode,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw failure(code, "expected an object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value).sort();
  const expected = allowed
    .filter((key) => !optional.includes(key) || value[key] !== undefined)
    .sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw failure("shape", "object fields do not match the receipt schema.");
  }
}

function alias(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_ALIAS ||
    !SAFE_ALIAS.test(value) ||
    GUID.test(value)
  ) {
    throw failure(
      "raw-identifier",
      "identifiers must be bounded sanitized aliases.",
    );
  }
  return value;
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  _field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw failure("shape", "categorical value is unsupported.");
  }
  return value as T;
}

function failure(
  code: EvidenceReceiptErrorCode,
  message: string,
): EvidenceReceiptError {
  return new EvidenceReceiptError(code, message);
}
