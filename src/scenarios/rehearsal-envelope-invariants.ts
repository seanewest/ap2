export const REHEARSAL_ONLY_LABEL = "REHEARSAL_ONLY";
export const REHEARSAL_VERIFIED_LABEL = "REHEARSAL_ONLY_VERIFIED";
export const SYNTHETIC_ONLY_OBSERVATIONS = "synthetic-only";
export const ALL_EXTERNAL_CLAIMS_UNINSPECTED = "all-uninspected";
export const TERMINAL_COMPLETE = "terminal-complete";

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SCENARIO_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const TOKEN_LIKE =
  /\b(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]+|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b/i;
const PRIVATE_PATH =
  /(?:[A-Za-z]:\\|\/(?:home|mnt|Users|tmp|var)\/|AppData|\\\\Users\\\\)/i;
const MARKER_LIKE =
  /\b(?:ap2(?:lab)?-[a-z0-9][a-z0-9-]{7,}|ap2doc-\d{8}T\d{6}Z-[a-f0-9]{6}|run-[a-z0-9]{2,})\b/i;
const PEM = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/;
const SYNTHETIC_CATEGORY = /^synthetic(?:$|-)/;
const MAX_BOUND_BYTES = 1024 * 1024;
const MAX_RECORD_FIELDS = 64;
const MAX_SYNTHETIC_VALUES = 64;
const MAX_EXTERNAL_CLAIMS = 512;
const MAX_MANIFEST_SCHEMA_VERSION = 100;

export type SharedRehearsalInvariantFailure =
  | "EXTERNAL_CLAIM_MISMATCH"
  | "INPUT_OVERSIZED"
  | "INPUT_SHAPE"
  | "NON_CANONICAL_JSON"
  | "PLAN_BINDING"
  | "RUN_NONTERMINAL"
  | "SYNTHETIC_MISMATCH"
  | "UNSAFE_CONTENT";

export type SharedRehearsalResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: SharedRehearsalInvariantFailure };

export interface SharedRehearsalPlanBinding {
  scenarioId: string;
  manifestSchemaVersion: number;
  planDigestSha256: string;
}

export interface SharedRehearsalDeclaration {
  label: typeof REHEARSAL_ONLY_LABEL;
  terminalState: typeof TERMINAL_COMPLETE;
  observationSource: typeof SYNTHETIC_ONLY_OBSERVATIONS;
  externalEvidence: typeof ALL_EXTERNAL_CLAIMS_UNINSPECTED;
}

export function inspectBoundedRehearsalValue(
  value: unknown,
  maximumBytes: number,
): SharedRehearsalInvariantFailure | null {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MAX_BOUND_BYTES
  ) {
    return "INPUT_SHAPE";
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "INPUT_SHAPE";
  }
  if (serialized === undefined) return "INPUT_SHAPE";
  if (utf8Bytes(serialized) > maximumBytes) return "INPUT_OVERSIZED";
  return containsUnsafeContent(value) ? "UNSAFE_CONTENT" : null;
}

export function parseCanonicalRehearsalJson(
  text: string,
  maximumBytes: number,
): SharedRehearsalResult<unknown> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MAX_BOUND_BYTES
  ) {
    return { ok: false, failure: "INPUT_SHAPE" };
  }
  if (utf8Bytes(text) > maximumBytes) {
    return { ok: false, failure: "INPUT_OVERSIZED" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, failure: "NON_CANONICAL_JSON" };
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    return { ok: false, failure: "NON_CANONICAL_JSON" };
  }
  return { ok: true, value };
}

export function exactRehearsalRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    expectedKeys.length < 1 ||
    expectedKeys.length > MAX_RECORD_FIELDS ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(expectedKeys)
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function bindRehearsalPlan(
  input: Readonly<{
    scenarioId: unknown;
    expectedScenarioId: string;
    manifestSchemaVersion: unknown;
    expectedManifestSchemaVersion: number;
    planDigestSha256: unknown;
    expectedPlanDigestSha256: string;
  }>,
): SharedRehearsalResult<SharedRehearsalPlanBinding> {
  if (
    typeof input.scenarioId !== "string" ||
    !SAFE_SCENARIO_ID.test(input.scenarioId) ||
    input.scenarioId !== input.expectedScenarioId ||
    !Number.isSafeInteger(input.manifestSchemaVersion) ||
    Number(input.manifestSchemaVersion) < 1 ||
    Number(input.manifestSchemaVersion) > MAX_MANIFEST_SCHEMA_VERSION ||
    input.manifestSchemaVersion !== input.expectedManifestSchemaVersion ||
    typeof input.planDigestSha256 !== "string" ||
    !SHA256.test(input.planDigestSha256) ||
    input.planDigestSha256 !== input.expectedPlanDigestSha256
  ) {
    return { ok: false, failure: "PLAN_BINDING" };
  }
  return {
    ok: true,
    value: {
      scenarioId: input.scenarioId,
      manifestSchemaVersion: input.manifestSchemaVersion as number,
      planDigestSha256: input.planDigestSha256,
    },
  };
}

export function declareRehearsalEnvelope(
  input: Readonly<{
    label: unknown;
    status: unknown;
    failure: unknown;
    syntheticValues: readonly unknown[];
    externalClaims: Readonly<{
      total: unknown;
      uninspected: unknown;
      nonUninspected: unknown;
    }>;
  }>,
): SharedRehearsalResult<SharedRehearsalDeclaration> {
  if (input.label !== REHEARSAL_ONLY_LABEL) {
    return { ok: false, failure: "INPUT_SHAPE" };
  }
  if (input.status !== "completed" || input.failure !== null) {
    return { ok: false, failure: "RUN_NONTERMINAL" };
  }
  if (
    input.syntheticValues.length === 0 ||
    input.syntheticValues.length > MAX_SYNTHETIC_VALUES ||
    input.syntheticValues.some((value) =>
      typeof value !== "string" || !SYNTHETIC_CATEGORY.test(value)
    )
  ) {
    return { ok: false, failure: "SYNTHETIC_MISMATCH" };
  }
  const { total, uninspected, nonUninspected } = input.externalClaims;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(uninspected) ||
    !Number.isSafeInteger(nonUninspected) ||
    Number(total) < 1 ||
    Number(total) > MAX_EXTERNAL_CLAIMS ||
    uninspected !== total ||
    nonUninspected !== 0
  ) {
    return { ok: false, failure: "EXTERNAL_CLAIM_MISMATCH" };
  }
  return {
    ok: true,
    value: {
      label: REHEARSAL_ONLY_LABEL,
      terminalState: TERMINAL_COMPLETE,
      observationSource: SYNTHETIC_ONLY_OBSERVATIONS,
      externalEvidence: ALL_EXTERNAL_CLAIMS_UNINSPECTED,
    },
  };
}

function containsUnsafeContent(value: unknown): boolean {
  if (typeof value === "string") {
    return GUID.test(value) ||
      UPN.test(value) ||
      TOKEN_LIKE.test(value) ||
      PRIVATE_PATH.test(value) ||
      MARKER_LIKE.test(value) ||
      PEM.test(value);
  }
  if (Array.isArray(value)) return value.some(containsUnsafeContent);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, child]) =>
      containsUnsafeContent(key) || containsUnsafeContent(child)
    );
  }
  return false;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
