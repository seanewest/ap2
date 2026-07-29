import { verifyCanonicalScenarioEvidenceReceipt } from "./scenario-evidence-verification.ts";
import {
  type EvidenceReceiptClaim,
  type EvidenceReceiptObservation,
  type ScenarioEvidenceReceipt,
} from "./scenario-evidence-receipt.ts";
import { OAUTH_APPLICATION_RECON_SCENARIO } from "./oauth-application-recon.ts";
import {
  verifyDistinctApplicationIdentityReadiness,
  type DistinctApplicationIdentityReadinessInput,
} from "./application-identity-readiness.ts";
import {
  compileScenarioExecutionPlan,
  type ScenarioPlanningRequest,
} from "./scenario-plan.ts";
import type {
  ScenarioAdapterCapabilityDeclaration,
} from "./scenario-surface-capability.ts";

const SCENARIO_ID = "oauth-application-reconnaissance";
const RUN_OPERATION = "run-bounded-recon-reads";
const DETECTOR_OPERATION = "observe-bounded-sign-in";
const LEARNER_OPERATION = "interpret-recon-summary";
const CLEANUP_OPERATION = "close-evidence-window";
const RESPONSE_ACTION = "report-recon-interpretation";
const ARTIFACT_ID = "application-recon-summary";
const MAX_INPUT_BYTES = 6_144;
const MAX_DEPTH = 7;
const MAX_VALUES = 96;
const STEP_CONTRACT = [
  {
    sequence: 1,
    step: "directory-memberships",
    collection: true,
  },
  {
    sequence: 2,
    step: "mailbox-folders",
    collection: true,
  },
  {
    sequence: 3,
    step: "personal-drive-root",
    collection: false,
  },
  {
    sequence: 4,
    step: "shared-drive-root",
    collection: false,
  },
] as const;

const FORBIDDEN_KEY =
  /^(?:observedAt|timestamp|correlationId|count|url|path|payload|request|response|error|token|credential|certificate|browserState|session|tenantId|applicationId|appId|servicePrincipalId|userId|groupId|mailId|driveId|siteId|objectId|resourceId|signInId|upn|name)$/i;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL = /\b(?:https?|file):\/\//i;
const PRIVATE_PATH = /(?:\/(?:home|Users|mnt\/[a-z])\/|[A-Z]:\\|\\\\)/i;
const TIMESTAMP =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/i;
const SECRET =
  /(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|-----BEGIN|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)/i;
const MARKER = /\bap2(?:lab)?-[a-z0-9][a-z0-9-]{7,}\b/i;

export const OAUTH_APPLICATION_RECON_RECEIPT_ADAPTER_CAPABILITY = {
  schemaVersion: 1,
  adapter: "oauth-application-recon",
  scenarioId: SCENARIO_ID,
  manifestSchemaVersion: 2,
  repositoryBoundary: "contract-only",
} as const satisfies ScenarioAdapterCapabilityDeclaration;

export type OauthReconStep =
  | {
      sequence: 1;
      step: "directory-memberships";
      outcome: "reachable";
      collection: "complete-within-bound";
    }
  | {
      sequence: 2;
      step: "mailbox-folders";
      outcome: "reachable";
      collection: "complete-within-bound";
    }
  | {
      sequence: 3;
      step: "personal-drive-root";
      outcome: "reachable";
    }
  | {
      sequence: 4;
      step: "shared-drive-root";
      outcome: "reachable";
    };

export interface SanitizedOauthReconResult {
  operation: typeof RUN_OPERATION;
  outcome: "completed";
  actorRole: "workloadActor";
  transport: "application-only";
  completedSteps: "four";
  evidenceBoundary: "reachability-only";
}

export type OauthReconDetectorObservation =
  | { state: "uninspected" }
  | {
      state: "observed";
      observerRole: "detector";
      workloadRole: "workloadActor";
      operation: typeof DETECTOR_OPERATION;
      event: "successful-service-principal-sign-in";
      match: "exact-workload-token-event";
      freshness: "current-bounded-window";
      collection: "complete-within-bound";
      attribution: "token-event-only";
      identityBinding: {
        observedBindingDigestSha256: string;
        planningRequest: ScenarioPlanningRequest;
        readiness: DistinctApplicationIdentityReadinessInput;
      };
    };

export type OauthReconLearnerObservation =
  | { state: "uninspected" }
  | {
      state: "visible";
      observerRole: "learner";
      operation: typeof LEARNER_OPERATION;
      artifact: typeof ARTIFACT_ID;
      visibility: "observed";
      interpretation: "not-claimed";
    };

export type OauthReconCleanupObservation =
  | { state: "uninspected" }
  | {
      state: "restored";
      observerRole: "cleanupOwner";
      operation: typeof CLEANUP_OPERATION;
      permissionState: "restored-to-retained-baseline";
      temporaryGrants: "absent-with-fresh-token";
      collection: "complete-within-bound";
    };

export interface OauthApplicationReconReceiptAdapterInput {
  schemaVersion: 1;
  scenarioId: typeof SCENARIO_ID;
  result: SanitizedOauthReconResult;
  journal: readonly OauthReconStep[];
  detector: OauthReconDetectorObservation;
  learner: OauthReconLearnerObservation;
  cleanup: OauthReconCleanupObservation;
}

type VerifiedOauthReconDetectorObservation =
  | { state: "uninspected" }
  | {
      state: "observed";
      observerRole: "detector";
      workloadRole: "workloadActor";
      operation: typeof DETECTOR_OPERATION;
      event: "successful-service-principal-sign-in";
      match: "exact-workload-token-event";
      freshness: "current-bounded-window";
      collection: "complete-within-bound";
      attribution: "token-event-only";
      identityBinding: {
        contract: "distinct-application-identity/v1";
        planDigestSha256: string;
        bindingDigestSha256: string;
      };
    };

interface ParsedOauthApplicationReconReceiptAdapterInput
  extends Omit<OauthApplicationReconReceiptAdapterInput, "detector"> {
  detector: VerifiedOauthReconDetectorObservation;
}

export type OauthReconReceiptAdapterErrorCode =
  | "shape"
  | "unsafe-input"
  | "scenario-mismatch"
  | "sequence"
  | "workload-mismatch"
  | "pagination-uncertain"
  | "actor-mismatch"
  | "detector-mismatch"
  | "stale-observation"
  | "learner-overclaim"
  | "cleanup-gap"
  | "semantic-overclaim";

export class OauthReconReceiptAdapterError extends Error {
  readonly code: OauthReconReceiptAdapterErrorCode;

  constructor(code: OauthReconReceiptAdapterErrorCode, detail: string) {
    super(`Invalid application reconnaissance receipt input [${code}]: ${detail}`);
    this.name = "OauthReconReceiptAdapterError";
    this.code = code;
  }
}

export function canonicalOauthApplicationReconReceiptAdapterInput():
  OauthApplicationReconReceiptAdapterInput {
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    result: {
      operation: RUN_OPERATION,
      outcome: "completed",
      actorRole: "workloadActor",
      transport: "application-only",
      completedSteps: "four",
      evidenceBoundary: "reachability-only",
    },
    journal: [
      {
        sequence: 1,
        step: "directory-memberships",
        outcome: "reachable",
        collection: "complete-within-bound",
      },
      {
        sequence: 2,
        step: "mailbox-folders",
        outcome: "reachable",
        collection: "complete-within-bound",
      },
      {
        sequence: 3,
        step: "personal-drive-root",
        outcome: "reachable",
      },
      {
        sequence: 4,
        step: "shared-drive-root",
        outcome: "reachable",
      },
    ],
    detector: { state: "uninspected" },
    learner: { state: "uninspected" },
    cleanup: { state: "uninspected" },
  };
}

export function adaptOauthApplicationReconToReceipt(
  value: unknown,
): ScenarioEvidenceReceipt {
  rejectOversizedInput(value);
  rejectUnsafeInput(withProtectedBindingRedacted(value));
  const input = parseInput(value);
  const receipt = buildReceipt(input);
  verifyCanonicalScenarioEvidenceReceipt(receipt);
  return deepFreeze(receipt);
}

function withProtectedBindingRedacted(value: unknown): unknown {
  if (!isPlainRecord(value) || !isPlainRecord(value.detector)) return value;
  if (!Object.hasOwn(value.detector, "identityBinding")) return value;
  return {
    ...value,
    detector: {
      ...value.detector,
      identityBinding: "verified-protected-binding",
    },
  };
}

function rejectOversizedInput(value: unknown): void {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded.length > MAX_INPUT_BYTES) {
      throw new Error();
    }
  } catch {
    throw failure("unsafe-input", "input exceeds the safe bound.");
  }
}

function parseInput(
  value: unknown,
): ParsedOauthApplicationReconReceiptAdapterInput {
  const input = record(value);
  exactKeys(input, [
    "schemaVersion",
    "scenarioId",
    "result",
    "journal",
    "detector",
    "learner",
    "cleanup",
  ]);
  if (input.schemaVersion !== 1) {
    throw failure("shape", "schemaVersion must be 1.");
  }
  if (input.scenarioId !== SCENARIO_ID) {
    throw failure("scenario-mismatch", "scenario ID is not canonical.");
  }
  if (!Array.isArray(input.journal) || input.journal.length !== 4) {
    throw failure("sequence", "journal must contain exactly four steps.");
  }
  return {
    schemaVersion: 1,
    scenarioId: SCENARIO_ID,
    result: parseResult(input.result),
    journal: input.journal.map(parseStep),
    detector: parseDetector(input.detector),
    learner: parseLearner(input.learner),
    cleanup: parseCleanup(input.cleanup),
  };
}

function parseResult(value: unknown): SanitizedOauthReconResult {
  const result = record(value);
  exactKeys(result, [
    "operation",
    "outcome",
    "actorRole",
    "transport",
    "completedSteps",
    "evidenceBoundary",
  ]);
  if (
    result.actorRole !== "workloadActor" ||
    result.transport !== "application-only"
  ) {
    throw failure(
      "actor-mismatch",
      "the result must use the canonical workload application role.",
    );
  }
  if (
    result.operation !== RUN_OPERATION ||
    result.outcome !== "completed" ||
    result.completedSteps !== "four"
  ) {
    throw failure(
      "workload-mismatch",
      "the exact four-read operation is not complete.",
    );
  }
  if (result.evidenceBoundary !== "reachability-only") {
    throw failure(
      "semantic-overclaim",
      "workload reads prove only bounded reachability.",
    );
  }
  return {
    operation: RUN_OPERATION,
    outcome: "completed",
    actorRole: "workloadActor",
    transport: "application-only",
    completedSteps: "four",
    evidenceBoundary: "reachability-only",
  };
}

function parseStep(value: unknown, index: number): OauthReconStep {
  const step = record(value);
  const expected = STEP_CONTRACT[index];
  if (expected === undefined) {
    throw failure("sequence", "journal exceeds the four-step contract.");
  }
  exactKeys(
    step,
    expected.collection
      ? ["sequence", "step", "outcome", "collection"]
      : ["sequence", "step", "outcome"],
  );
  if (
    step.sequence !== expected.sequence ||
    step.step !== expected.step
  ) {
    throw failure(
      "sequence",
      "journal steps are missing, duplicated, or reordered.",
    );
  }
  if (step.outcome !== "reachable") {
    throw failure(
      "workload-mismatch",
      "each fixed read must be categorically reachable.",
    );
  }
  if (expected.collection && step.collection !== "complete-within-bound") {
    throw failure(
      "pagination-uncertain",
      "collection reachability requires complete bounded pagination.",
    );
  }
  return expected.collection
    ? {
      sequence: expected.sequence,
      step: expected.step,
      outcome: "reachable",
      collection: "complete-within-bound",
    } as OauthReconStep
    : {
      sequence: expected.sequence,
      step: expected.step,
      outcome: "reachable",
    } as OauthReconStep;
}

function parseDetector(value: unknown): VerifiedOauthReconDetectorObservation {
  const detector = record(value);
  if (detector.state === "uninspected") {
    exactKeys(detector, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(detector, [
    "state",
    "observerRole",
    "workloadRole",
    "operation",
    "event",
    "match",
    "freshness",
    "collection",
    "attribution",
    "identityBinding",
  ]);
  if (
    detector.observerRole === "workloadActor" ||
    detector.observerRole === detector.workloadRole
  ) {
    throw failure(
      "actor-mismatch",
      "detector and workload roles must remain distinct.",
    );
  }
  if (
    detector.freshness !== "current-bounded-window" ||
    detector.state === "stale" ||
    detector.state === "ambiguous"
  ) {
    throw failure(
      "stale-observation",
      "detector evidence must be current and unambiguous.",
    );
  }
  if (detector.collection !== "complete-within-bound") {
    throw failure(
      "pagination-uncertain",
      "detector collection must be complete within its bound.",
    );
  }
  if (
    detector.state !== "observed" ||
    detector.observerRole !== "detector" ||
    detector.workloadRole !== "workloadActor" ||
    detector.operation !== DETECTOR_OPERATION ||
    detector.event !== "successful-service-principal-sign-in" ||
    detector.match !== "exact-workload-token-event" ||
    detector.attribution !== "token-event-only"
  ) {
    throw failure(
      "detector-mismatch",
      "detector observation does not match the canonical sign-in contract.",
    );
  }
  const identityBinding = parseIdentityBinding(detector.identityBinding);
  return {
    state: "observed",
    observerRole: "detector",
    workloadRole: "workloadActor",
    operation: DETECTOR_OPERATION,
    event: "successful-service-principal-sign-in",
    match: "exact-workload-token-event",
    freshness: "current-bounded-window",
    collection: "complete-within-bound",
    attribution: "token-event-only",
    identityBinding,
  };
}

function parseIdentityBinding(
  value: unknown,
): Extract<
  VerifiedOauthReconDetectorObservation,
  { state: "observed" }
>["identityBinding"] {
  let plan;
  let binding: Record<string, unknown>;
  try {
    binding = record(value);
    exactKeys(binding, [
      "observedBindingDigestSha256",
      "planningRequest",
      "readiness",
    ]);
    plan = compileScenarioExecutionPlan(
      binding.planningRequest as ScenarioPlanningRequest,
    );
  } catch {
    throw failure(
      "detector-mismatch",
      "detector evidence requires the verified exact identity binding.",
    );
  }
  if (plan.scenarioId !== SCENARIO_ID) {
    throw failure(
      "detector-mismatch",
      "detector evidence requires the verified exact identity binding.",
    );
  }
  const readiness = verifyDistinctApplicationIdentityReadiness(
    OAUTH_APPLICATION_RECON_SCENARIO,
    plan.digestSha256,
    binding.readiness,
  );
  if (readiness.status !== "ready") {
    throw failure(
      "detector-mismatch",
      "detector evidence requires the verified exact identity binding.",
    );
  }
  if (
    typeof binding.observedBindingDigestSha256 !== "string" ||
    binding.observedBindingDigestSha256 !== readiness.bindingDigestSha256
  ) {
    throw failure(
      "detector-mismatch",
      "observer output does not match the verified identity binding.",
    );
  }
  return {
    contract: "distinct-application-identity/v1",
    planDigestSha256: plan.digestSha256,
    bindingDigestSha256: readiness.bindingDigestSha256,
  };
}

function parseLearner(value: unknown): OauthReconLearnerObservation {
  const learner = record(value);
  if (learner.state === "uninspected") {
    exactKeys(learner, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(learner, [
    "state",
    "observerRole",
    "operation",
    "artifact",
    "visibility",
    "interpretation",
  ]);
  if (learner.observerRole !== "learner") {
    throw failure(
      "actor-mismatch",
      "only the canonical learner can supply learner visibility.",
    );
  }
  if (learner.interpretation !== "not-claimed") {
    throw failure(
      "learner-overclaim",
      "the canonical manifest does not mark interpretation completed.",
    );
  }
  if (
    learner.state !== "visible" ||
    learner.operation !== LEARNER_OPERATION ||
    learner.artifact !== ARTIFACT_ID ||
    learner.visibility !== "observed"
  ) {
    throw failure(
      "learner-overclaim",
      "learner visibility observation is not canonical.",
    );
  }
  return {
    state: "visible",
    observerRole: "learner",
    operation: LEARNER_OPERATION,
    artifact: ARTIFACT_ID,
    visibility: "observed",
    interpretation: "not-claimed",
  };
}

function parseCleanup(value: unknown): OauthReconCleanupObservation {
  const cleanup = record(value);
  if (cleanup.state === "uninspected") {
    exactKeys(cleanup, ["state"]);
    return { state: "uninspected" };
  }
  exactKeys(cleanup, [
    "state",
    "observerRole",
    "operation",
    "permissionState",
    "temporaryGrants",
    "collection",
  ]);
  if (cleanup.observerRole !== "cleanupOwner") {
    throw failure(
      "actor-mismatch",
      "only the canonical cleanup owner can restore the baseline.",
    );
  }
  if (
    cleanup.temporaryGrants !== "absent-with-fresh-token" ||
    cleanup.collection !== "complete-within-bound"
  ) {
    throw failure(
      "cleanup-gap",
      "restoration requires fresh-token complete absence evidence.",
    );
  }
  if (
    cleanup.state !== "restored" ||
    cleanup.operation !== CLEANUP_OPERATION ||
    cleanup.permissionState !== "restored-to-retained-baseline"
  ) {
    throw failure(
      "semantic-overclaim",
      "the retained canonical permission baseline cannot be called revoked.",
    );
  }
  return {
    state: "restored",
    observerRole: "cleanupOwner",
    operation: CLEANUP_OPERATION,
    permissionState: "restored-to-retained-baseline",
    temporaryGrants: "absent-with-fresh-token",
    collection: "complete-within-bound",
  };
}

function buildReceipt(
  input: ParsedOauthApplicationReconReceiptAdapterInput,
): ScenarioEvidenceReceipt {
  const manifest = OAUTH_APPLICATION_RECON_SCENARIO;
  const detectorObserved = input.detector.state === "observed";
  const learnerVisible = input.learner.state === "visible";
  const workloadObservation = observation(
    "provider-response",
    "operation-result",
    manifest.roles.workloadActor,
    RUN_OPERATION,
  );
  const detectorObservation = observation(
    "independent-detector",
    "record-match",
    manifest.roles.detector!,
    DETECTOR_OPERATION,
    input.detector.state === "observed"
      ? input.detector.identityBinding.bindingDigestSha256
      : undefined,
  );
  const learnerObservation = observation(
    "learner-view",
    "learner-inspection",
    manifest.roles.learner,
    LEARNER_OPERATION,
  );

  const claims: EvidenceReceiptClaim[] = manifest.operations.map(
    (operation) => {
      if (operation.key === RUN_OPERATION) {
        return operationClaim(operation.key, "proven", workloadObservation);
      }
      if (operation.key === DETECTOR_OPERATION && detectorObserved) {
        return operationClaim(operation.key, "proven", detectorObservation);
      }
      return operationClaim(operation.key, "uninspected");
    },
  );

  claims.push(
    detectorObserved
      ? {
        id: `artifact-${ARTIFACT_ID}`,
        category: "artifact",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "artifact-authentic",
        state: "proven",
        artifact: {
          kind: "application-recon-summary",
          authenticity: "platform-control-plane",
        },
        observation: detectorObservation,
      }
      : uninspectedArtifact(),
    detectorObserved
      ? independentClaim(
        "detector-independent",
        "detector-independent",
        detectorObservation,
      )
      : independentClaim("detector-independent", "detector-independent"),
    detectorObserved
      ? independentClaim(
        "producer-attribution",
        "producer-attribution",
        detectorObservation,
      )
      : independentClaim("producer-attribution", "producer-attribution"),
    learnerVisible
      ? {
        id: `visibility-${ARTIFACT_ID}`,
        category: "learner-visibility",
        subject: { kind: "artifact", id: ARTIFACT_ID },
        assertion: "learner-visible",
        state: "proven",
        observation: learnerObservation,
      }
      : uninspectedClaim(
        `visibility-${ARTIFACT_ID}`,
        "learner-visibility",
        "artifact",
        ARTIFACT_ID,
        "learner-visible",
      ),
    uninspectedClaim(
      "learner-interpretation",
      "learner-interpretation",
      "scenario",
      SCENARIO_ID,
      "learner-interpreted",
    ),
    uninspectedClaim(
      `response-${RESPONSE_ACTION}`,
      "response",
      "response-action",
      RESPONSE_ACTION,
      "response-completed",
    ),
    uninspectedClaim(
      `cleanup-${CLEANUP_OPERATION}`,
      "cleanup",
      "operation",
      CLEANUP_OPERATION,
      "cleanup-completed",
    ),
    uninspectedClaim(
      `retention-${ARTIFACT_ID}`,
      "retention",
      "artifact",
      ARTIFACT_ID,
      "retention-confirmed",
    ),
    terminalClaim(
      "terminal-application-reconnaissance",
      "application-reconnaissance",
      detectorObserved ? detectorObservation : undefined,
    ),
  );

  return {
    schemaVersion: 1,
    scenario: { id: SCENARIO_ID, manifestSchemaVersion: 2 },
    roles: {
      evidenceProducer: manifest.roles.evidenceProducer,
      workloadActor: manifest.roles.workloadActor,
      learner: manifest.roles.learner,
      detector: manifest.roles.detector,
    },
    claims,
  };
}

function operationClaim(
  operationKey: string,
  state: "proven" | "uninspected",
  observed?: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    id: `operation-${operationKey}`,
    category: "operation",
    subject: { kind: "operation", id: operationKey },
    assertion: "operation-completed",
    state,
    ...(observed === undefined ? {} : { observation: observed }),
  };
}

function independentClaim(
  id: "detector-independent" | "producer-attribution",
  assertion: "detector-independent" | "producer-attribution",
  observed?: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    id,
    category: "independent-observation",
    subject: { kind: "scenario", id: SCENARIO_ID },
    assertion,
    state: observed === undefined ? "uninspected" : "proven",
    ...(observed === undefined ? {} : { observation: observed }),
  };
}

function uninspectedArtifact(): EvidenceReceiptClaim {
  return {
    ...uninspectedClaim(
      `artifact-${ARTIFACT_ID}`,
      "artifact",
      "artifact",
      ARTIFACT_ID,
      "artifact-authentic",
    ),
    artifact: {
      kind: "application-recon-summary",
      authenticity: "platform-control-plane",
    },
  };
}

function uninspectedClaim(
  id: string,
  category: EvidenceReceiptClaim["category"],
  subjectKind: EvidenceReceiptClaim["subject"]["kind"],
  subjectId: string,
  assertion: EvidenceReceiptClaim["assertion"],
): EvidenceReceiptClaim {
  return {
    id,
    category,
    subject: { kind: subjectKind, id: subjectId },
    assertion,
    state: "uninspected",
  };
}

function terminalClaim(
  id: string,
  assertion: EvidenceReceiptClaim["assertion"],
  observed?: EvidenceReceiptObservation,
): EvidenceReceiptClaim {
  return {
    id,
    category: "terminal-proof",
    subject: { kind: "artifact", id: ARTIFACT_ID },
    assertion,
    state: observed === undefined ? "uninspected" : "proven",
    ...(observed === undefined ? {} : { observation: observed }),
  };
}

function observation(
  source: EvidenceReceiptObservation["source"],
  outcome: EvidenceReceiptObservation["outcome"],
  observerActorId: string,
  operationKey: string,
  identityBindingDigestSha256?: string,
): EvidenceReceiptObservation {
  return {
    source,
    outcome,
    observerActorId,
    operationKey,
    ...(identityBindingDigestSha256 === undefined
      ? {}
      : { identityBindingDigestSha256 }),
  };
}

function rejectUnsafeInput(value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw failure("unsafe-input", "input must be bounded JSON.");
  }
  if (encoded === undefined || encoded.length > MAX_INPUT_BYTES) {
    throw failure("unsafe-input", "input exceeds the safe bound.");
  }
  let count = 0;
  const visit = (candidate: unknown, depth: number): void => {
    count += 1;
    if (count > MAX_VALUES || depth > MAX_DEPTH) {
      throw failure("unsafe-input", "input exceeds structural bounds.");
    }
    if (typeof candidate === "string") {
      if (
        candidate.length > 100 ||
        GUID.test(candidate) ||
        UPN.test(candidate) ||
        URL.test(candidate) ||
        PRIVATE_PATH.test(candidate) ||
        TIMESTAMP.test(candidate) ||
        SECRET.test(candidate) ||
        MARKER.test(candidate)
      ) {
        throw failure("unsafe-input", "raw or sensitive values are forbidden.");
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (candidate !== null && typeof candidate === "object") {
      for (const [key, child] of Object.entries(candidate)) {
        if (FORBIDDEN_KEY.test(key)) {
          throw failure("unsafe-input", "raw evidence fields are forbidden.");
        }
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw failure("shape", "expected an object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...allowed].sort())
  ) {
    throw failure("shape", "object fields do not match the adapter schema.");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function failure(
  code: OauthReconReceiptAdapterErrorCode,
  detail: string,
): OauthReconReceiptAdapterError {
  return new OauthReconReceiptAdapterError(code, detail);
}
