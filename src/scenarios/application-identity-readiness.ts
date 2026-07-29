import { createHash } from "node:crypto";
import type {
  ScenarioApplicationIdentityBoundary,
  ScenarioManifest,
} from "./scenario-manifest.ts";

const GRAPH_APPLICATION_ID = "00000003-0000-0000-c000-000000000000";
const BLOCKER_ORDER = [
  "invalid-input",
  "plan-mismatch",
  "identity-conflation",
  "tenant-mismatch",
  "installation-unproven",
  "permission-mismatch",
  "permission-overlap",
  "token-not-fresh",
  "token-audience-mismatch",
  "token-identity-mismatch",
  "recovery-not-independent",
  "marker-mismatch",
  "invalid-window",
  "evidence-owner-mismatch",
  "detector-produced-evidence",
  "telemetry-correlation-unproven",
] as const;

const INPUT_KEYS = [
  "schemaVersion",
  "scenarioId",
  "planDigestSha256",
  "producer",
  "detector",
  "recovery",
  "evidence",
] as const;
const IDENTITY_KEYS = [
  "actorId",
  "applicationId",
  "servicePrincipalId",
  "tenantId",
  "installation",
  "assignedApplicationRoles",
  "token",
] as const;
const ROLE_KEYS = [
  "resourceApplicationId",
  "applicationRoleId",
  "assignment",
] as const;
const TOKEN_KEYS = [
  "source",
  "audience",
  "applicationId",
  "tenantId",
  "acquiredAt",
  "assignmentSnapshotAt",
] as const;
const RECOVERY_KEYS = [
  "actorId",
  "principalObjectId",
  "ownership",
] as const;
const EVIDENCE_KEYS = [
  "producerActorId",
  "detectorActorId",
  "sourceApplicationId",
  "sourceServicePrincipalId",
  "observerApplicationId",
  "marker",
  "windowStart",
  "windowEnd",
  "detectorGeneratedEvidence",
  "correlation",
] as const;

export type ApplicationIdentityReadinessBlocker =
  typeof BLOCKER_ORDER[number];

export interface ApplicationRoleAssignment {
  resourceApplicationId: string;
  applicationRoleId: string;
  assignment: "present-exact";
}

export interface ApplicationTokenBinding {
  source: "fresh-after-assignment-read";
  audience: string;
  applicationId: string;
  tenantId: string;
  acquiredAt: string;
  assignmentSnapshotAt: string;
}

export interface ApplicationIdentityBinding {
  actorId: string;
  applicationId: string;
  servicePrincipalId: string;
  tenantId: string;
  installation: "application-and-service-principal-present";
  assignedApplicationRoles: readonly ApplicationRoleAssignment[];
  token: ApplicationTokenBinding;
}

export interface DistinctApplicationIdentityReadinessInput {
  schemaVersion: 1;
  scenarioId: string;
  planDigestSha256: string;
  producer: ApplicationIdentityBinding;
  detector: ApplicationIdentityBinding;
  recovery: {
    actorId: string;
    principalObjectId: string;
    ownership: "independent-human-administrator";
  };
  evidence: {
    producerActorId: string;
    detectorActorId: string;
    sourceApplicationId: string;
    sourceServicePrincipalId: string;
    observerApplicationId: string;
    marker: string;
    windowStart: string;
    windowEnd: string;
    detectorGeneratedEvidence: false;
    correlation: "exact-producer-token-event-in-marker-window";
  };
}

interface ReadinessBase {
  schemaVersion: 1;
  contract: "distinct-application-identity/v1";
  scenarioId: string;
  proof: "readiness-and-correlation-contract-only";
}

export interface BlockedApplicationIdentityReadiness extends ReadinessBase {
  status: "blocked";
  blockers: readonly ApplicationIdentityReadinessBlocker[];
}

export interface ReadyApplicationIdentityBinding extends ReadinessBase {
  status: "ready";
  bindingDigestSha256: string;
  planDigestSha256: string;
  roles: {
    producer: string;
    detector: string;
    recoveryOwner: string;
  };
  identity: {
    applications: "distinct";
    servicePrincipals: "distinct";
    tenant: "exact-shared";
    installation: "verified";
  };
  permissions: {
    producer: "exact-least-required";
    detector: "exact-least-required";
    overlap: "none";
  };
  tokens: {
    audience: "https://graph.microsoft.com";
    freshness: "fresh-after-assignment-read";
    claims: "exact-application-and-tenant";
  };
  evidence: {
    origin: "producer-application";
    observer: "detector-application";
    attribution: "token-event-only";
    markerWindow: "exact-and-bounded";
    perRequestAttribution: "not-proven";
  };
  recovery: "independent-human-administrator";
  /**
   * Protected exact runtime binding. Callers must not log, persist, or return
   * this object; it exists so the operation path can prove that the credential,
   * query, and bounded evidence window are the ones that were reviewed.
   */
  runtimeBinding: {
    producer: {
      applicationId: string;
      servicePrincipalId: string;
      tenantId: string;
    };
    detector: {
      applicationId: string;
      servicePrincipalId: string;
      tenantId: string;
    };
    evidence: {
      sourceApplicationId: string;
      sourceServicePrincipalId: string;
      observerApplicationId: string;
      marker: string;
      windowStart: string;
      windowEnd: string;
    };
  };
}

export type DistinctApplicationIdentityReadiness =
  | BlockedApplicationIdentityReadiness
  | ReadyApplicationIdentityBinding;

export type SafeApplicationIdentityReadinessSummary =
  Omit<ReadyApplicationIdentityBinding, "runtimeBinding">;

export function verifyDistinctApplicationIdentityReadiness(
  manifest: ScenarioManifest,
  expectedPlanDigestSha256: string,
  value: unknown,
): DistinctApplicationIdentityReadiness {
  const base: ReadinessBase = {
    schemaVersion: 1,
    contract: "distinct-application-identity/v1",
    scenarioId: manifest.id,
    proof: "readiness-and-correlation-contract-only",
  };
  const boundary = manifest.applicationIdentityBoundary;
  if (boundary === undefined || !isRecord(value)) {
    return blocked(base, ["invalid-input"]);
  }
  const blockers = new Set<ApplicationIdentityReadinessBlocker>();
  if (!exactKeys(value, INPUT_KEYS) || value.schemaVersion !== 1) {
    blockers.add("invalid-input");
  }
  if (
    value.scenarioId !== manifest.id ||
    !sha256(value.planDigestSha256) ||
    value.planDigestSha256 !== expectedPlanDigestSha256
  ) {
    blockers.add("plan-mismatch");
  }
  const producer = parseIdentity(value.producer, blockers);
  const detector = parseIdentity(value.detector, blockers);
  const recovery = parseRecovery(value.recovery, blockers);
  const evidence = parseEvidence(value.evidence, blockers);
  if (
    producer === null ||
    detector === null ||
    recovery === null ||
    evidence === null
  ) {
    return blocked(base, blockers);
  }

  validateIdentities(producer, detector, boundary, blockers);
  validatePermissions(producer, detector, boundary, blockers);
  validateToken(producer, boundary, blockers);
  validateToken(detector, boundary, blockers);
  validateRecovery(producer, detector, recovery, boundary, blockers);
  validateEvidence(producer, detector, evidence, manifest, boundary, blockers);

  if (blockers.size > 0) return blocked(base, blockers);
  const bindingDigestSha256 = createHash("sha256")
    .update(canonicalJson({
      scenarioId: manifest.id,
      planDigestSha256: expectedPlanDigestSha256,
      producer,
      detector,
      recovery,
      evidence,
    }))
    .digest("hex");
  return {
    ...base,
    status: "ready",
    bindingDigestSha256,
    planDigestSha256: expectedPlanDigestSha256,
    roles: {
      producer: boundary.producerActorId,
      detector: boundary.detectorActorId,
      recoveryOwner: boundary.recoveryOwnerActorId,
    },
    identity: {
      applications: "distinct",
      servicePrincipals: "distinct",
      tenant: "exact-shared",
      installation: "verified",
    },
    permissions: {
      producer: "exact-least-required",
      detector: "exact-least-required",
      overlap: "none",
    },
    tokens: {
      audience: "https://graph.microsoft.com",
      freshness: "fresh-after-assignment-read",
      claims: "exact-application-and-tenant",
    },
    evidence: {
      origin: "producer-application",
      observer: "detector-application",
      attribution: "token-event-only",
      markerWindow: "exact-and-bounded",
      perRequestAttribution: "not-proven",
    },
    recovery: "independent-human-administrator",
    runtimeBinding: {
      producer: {
        applicationId: producer.applicationId,
        servicePrincipalId: producer.servicePrincipalId,
        tenantId: producer.tenantId,
      },
      detector: {
        applicationId: detector.applicationId,
        servicePrincipalId: detector.servicePrincipalId,
        tenantId: detector.tenantId,
      },
      evidence: {
        sourceApplicationId: evidence.sourceApplicationId,
        sourceServicePrincipalId: evidence.sourceServicePrincipalId,
        observerApplicationId: evidence.observerApplicationId,
        marker: evidence.marker,
        windowStart: evidence.windowStart,
        windowEnd: evidence.windowEnd,
      },
    },
  };
}

export function summarizeDistinctApplicationIdentityReadiness(
  binding: ReadyApplicationIdentityBinding,
): SafeApplicationIdentityReadinessSummary {
  const { runtimeBinding: _protectedRuntimeBinding, ...safe } = binding;
  return safe;
}

function validateIdentities(
  producer: ApplicationIdentityBinding,
  detector: ApplicationIdentityBinding,
  boundary: ScenarioApplicationIdentityBoundary,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): void {
  if (
    producer.actorId !== boundary.producerActorId ||
    detector.actorId !== boundary.detectorActorId ||
    new Set([
      producer.applicationId,
      producer.servicePrincipalId,
      detector.applicationId,
      detector.servicePrincipalId,
    ]).size !== 4
  ) {
    blockers.add("identity-conflation");
  }
  if (
    producer.tenantId !== detector.tenantId ||
    producer.token.tenantId !== producer.tenantId ||
    detector.token.tenantId !== detector.tenantId
  ) {
    blockers.add("tenant-mismatch");
  }
  if (
    producer.installation !== "application-and-service-principal-present" ||
    detector.installation !== "application-and-service-principal-present"
  ) {
    blockers.add("installation-unproven");
  }
}

function validatePermissions(
  producer: ApplicationIdentityBinding,
  detector: ApplicationIdentityBinding,
  boundary: ScenarioApplicationIdentityBoundary,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): void {
  const expectedProducer = permissionKeys(boundary.producerPermissions);
  const expectedDetector = permissionKeys(boundary.detectorPermissions);
  const actualProducer = assignmentKeys(producer.assignedApplicationRoles);
  const actualDetector = assignmentKeys(detector.assignedApplicationRoles);
  if (
    !sameStrings(expectedProducer, actualProducer) ||
    !sameStrings(expectedDetector, actualDetector)
  ) {
    blockers.add("permission-mismatch");
  }
  if (
    actualProducer.some((key) => actualDetector.includes(key)) ||
    expectedProducer.some((key) => expectedDetector.includes(key))
  ) {
    blockers.add("permission-overlap");
  }
}

function validateToken(
  identity: ApplicationIdentityBinding,
  boundary: ScenarioApplicationIdentityBoundary,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): void {
  if (
    identity.token.source !== "fresh-after-assignment-read" ||
    Date.parse(identity.token.acquiredAt) <
      Date.parse(identity.token.assignmentSnapshotAt)
  ) {
    blockers.add("token-not-fresh");
  }
  if (identity.token.audience !== boundary.tokenAudience) {
    blockers.add("token-audience-mismatch");
  }
  if (
    identity.token.applicationId !== identity.applicationId ||
    identity.token.tenantId !== identity.tenantId
  ) {
    blockers.add("token-identity-mismatch");
  }
}

function validateRecovery(
  producer: ApplicationIdentityBinding,
  detector: ApplicationIdentityBinding,
  recovery: DistinctApplicationIdentityReadinessInput["recovery"],
  boundary: ScenarioApplicationIdentityBoundary,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): void {
  if (
    recovery.actorId !== boundary.recoveryOwnerActorId ||
    recovery.ownership !== "independent-human-administrator" ||
    [
      producer.applicationId,
      producer.servicePrincipalId,
      detector.applicationId,
      detector.servicePrincipalId,
    ].includes(recovery.principalObjectId)
  ) {
    blockers.add("recovery-not-independent");
  }
}

function validateEvidence(
  producer: ApplicationIdentityBinding,
  detector: ApplicationIdentityBinding,
  evidence: DistinctApplicationIdentityReadinessInput["evidence"],
  manifest: ScenarioManifest,
  boundary: ScenarioApplicationIdentityBoundary,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): void {
  if (
    evidence.producerActorId !== boundary.producerActorId ||
    evidence.detectorActorId !== boundary.detectorActorId ||
    evidence.sourceApplicationId !== producer.applicationId ||
    evidence.sourceServicePrincipalId !== producer.servicePrincipalId ||
    evidence.observerApplicationId !== detector.applicationId
  ) {
    blockers.add("evidence-owner-mismatch");
  }
  if (evidence.detectorGeneratedEvidence !== false) {
    blockers.add("detector-produced-evidence");
  }
  if (
    evidence.correlation !==
      "exact-producer-token-event-in-marker-window"
  ) {
    blockers.add("telemetry-correlation-unproven");
  }
  const start = Date.parse(evidence.windowStart);
  const end = Date.parse(evidence.windowEnd);
  const expectedMarker = manifest.operations.find(
    ({ key }) => key === boundary.markerOperationKey,
  )?.marker;
  if (
    !safeMarker(evidence.marker) ||
    evidence.marker !== expectedMarker ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start >
      boundary.maximumObservationWindowMinutes * 60_000
  ) {
    blockers.add(
      !safeMarker(evidence.marker) || evidence.marker !== expectedMarker
        ? "marker-mismatch"
        : "invalid-window",
    );
  }
}

function parseIdentity(
  value: unknown,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): ApplicationIdentityBinding | null {
  if (!isRecord(value) || !exactKeys(value, IDENTITY_KEYS)) {
    blockers.add("invalid-input");
    return null;
  }
  const assignedApplicationRoles = Array.isArray(
      value.assignedApplicationRoles,
    )
    ? value.assignedApplicationRoles.map(parseAssignment)
    : null;
  const token = parseToken(value.token);
  if (
    !safeAlias(value.actorId) ||
    !uuid(value.applicationId) ||
    !uuid(value.servicePrincipalId) ||
    !uuid(value.tenantId) ||
    value.installation !== "application-and-service-principal-present" ||
    assignedApplicationRoles === null ||
    assignedApplicationRoles.some((row) => row === null) ||
    token === null
  ) {
    blockers.add("invalid-input");
    return null;
  }
  return {
    actorId: value.actorId,
    applicationId: value.applicationId.toLowerCase(),
    servicePrincipalId: value.servicePrincipalId.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    installation: "application-and-service-principal-present",
    assignedApplicationRoles:
      assignedApplicationRoles as ApplicationRoleAssignment[],
    token,
  };
}

function parseAssignment(value: unknown): ApplicationRoleAssignment | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ROLE_KEYS) ||
    !uuid(value.resourceApplicationId) ||
    !uuid(value.applicationRoleId) ||
    value.assignment !== "present-exact"
  ) return null;
  return {
    resourceApplicationId: value.resourceApplicationId.toLowerCase(),
    applicationRoleId: value.applicationRoleId.toLowerCase(),
    assignment: "present-exact",
  };
}

function parseToken(value: unknown): ApplicationTokenBinding | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, TOKEN_KEYS) ||
    value.source !== "fresh-after-assignment-read" ||
    typeof value.audience !== "string" ||
    !uuid(value.applicationId) ||
    !uuid(value.tenantId) ||
    !utc(value.acquiredAt) ||
    !utc(value.assignmentSnapshotAt)
  ) return null;
  return {
    source: "fresh-after-assignment-read",
    audience: value.audience,
    applicationId: value.applicationId.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    acquiredAt: value.acquiredAt,
    assignmentSnapshotAt: value.assignmentSnapshotAt,
  };
}

function parseRecovery(
  value: unknown,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): DistinctApplicationIdentityReadinessInput["recovery"] | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, RECOVERY_KEYS) ||
    !safeAlias(value.actorId) ||
    !uuid(value.principalObjectId) ||
    value.ownership !== "independent-human-administrator"
  ) {
    blockers.add("invalid-input");
    return null;
  }
  return {
    actorId: value.actorId,
    principalObjectId: value.principalObjectId.toLowerCase(),
    ownership: "independent-human-administrator",
  };
}

function parseEvidence(
  value: unknown,
  blockers: Set<ApplicationIdentityReadinessBlocker>,
): DistinctApplicationIdentityReadinessInput["evidence"] | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, EVIDENCE_KEYS) ||
    !safeAlias(value.producerActorId) ||
    !safeAlias(value.detectorActorId) ||
    !uuid(value.sourceApplicationId) ||
    !uuid(value.sourceServicePrincipalId) ||
    !uuid(value.observerApplicationId) ||
    typeof value.marker !== "string" ||
    !utc(value.windowStart) ||
    !utc(value.windowEnd) ||
    typeof value.detectorGeneratedEvidence !== "boolean" ||
    typeof value.correlation !== "string"
  ) {
    blockers.add("invalid-input");
    return null;
  }
  return {
    producerActorId: value.producerActorId,
    detectorActorId: value.detectorActorId,
    sourceApplicationId: value.sourceApplicationId.toLowerCase(),
    sourceServicePrincipalId: value.sourceServicePrincipalId.toLowerCase(),
    observerApplicationId: value.observerApplicationId.toLowerCase(),
    marker: value.marker,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    detectorGeneratedEvidence: value.detectorGeneratedEvidence as false,
    correlation:
      value.correlation as
        "exact-producer-token-event-in-marker-window",
  };
}

function permissionKeys(
  permissions: ScenarioApplicationIdentityBoundary[
    "producerPermissions"
  ],
): string[] {
  return permissions.map(
    ({ resourceApplicationId, applicationRoleId }) =>
      `${resourceApplicationId}:${applicationRoleId}`,
  ).sort();
}

function assignmentKeys(
  assignments: readonly ApplicationRoleAssignment[],
): string[] {
  if (
    new Set(assignments.map(({ resourceApplicationId, applicationRoleId }) =>
      `${resourceApplicationId}:${applicationRoleId}`
    )).size !== assignments.length ||
    assignments.some(({ resourceApplicationId, assignment }) =>
      resourceApplicationId !== GRAPH_APPLICATION_ID ||
      assignment !== "present-exact"
    )
  ) return ["invalid"];
  return assignments.map(
    ({ resourceApplicationId, applicationRoleId }) =>
      `${resourceApplicationId}:${applicationRoleId}`,
  ).sort();
}

function blocked(
  base: ReadinessBase,
  blockers: Iterable<ApplicationIdentityReadinessBlocker>,
): BlockedApplicationIdentityReadiness {
  const set = new Set(blockers);
  if (set.size === 0) set.add("invalid-input");
  return {
    ...base,
    status: "blocked",
    blockers: BLOCKER_ORDER.filter((blocker) => set.has(blocker)),
  };
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index]);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function safeAlias(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

function safeMarker(value: unknown): value is string {
  return typeof value === "string" &&
    /^ap2-[a-z0-9][a-z0-9-]{7,63}$/.test(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function utc(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
