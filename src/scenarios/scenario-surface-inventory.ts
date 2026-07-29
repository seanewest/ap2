import { SCENARIO_RECEIPT_API_CAPABILITY } from "../../api/scenario-evidence-verification.ts";
import { SCENARIO_PLAN_API_CAPABILITY } from "../../api/scenario-plan.ts";
import { REHEARSAL_OUTPUT_VERIFICATION_API_CAPABILITY } from "../../api/rehearsal-output-verification.ts";
import { AVD_MANIFEST_ADAPTER_CAPABILITY } from "../../scripts/avd-three-vm-manifest-adapter.ts";
import { AVD_THREE_VM_REHEARSAL_CAPABILITY } from "../../scripts/avd-three-vm-rehearsal.ts";
import { PRIVATE_DOCUMENT_REHEARSAL_CAPABILITY } from "../../scripts/private-document-rehearsal.ts";
import { SCENARIO_API_CLIENT_CAPABILITIES } from "../api/client.ts";
import { SCENARIO_CATALOG_UI_CAPABILITY } from "./scenario-catalog.ts";
import {
  HELP_DESK_EMAIL_RECEIPT_ADAPTER_CAPABILITY,
} from "./help-desk-email-receipt-adapter.ts";
import {
  checkScenarioContractCompatibility,
  type ScenarioCompatibilityMatrix,
} from "./scenario-contract-compatibility.ts";
import { parseScenarioManifest, type ScenarioManifest } from "./scenario-manifest.ts";
import { SCENARIO_PLAN_PREVIEW_UI_CAPABILITY } from "./scenario-plan-preview.ts";
import { SCENARIO_RECEIPT_VERIFICATION_UI_CAPABILITY } from "./scenario-evidence-verification-panel.ts";
import { PRIVATE_DOCUMENT_RECEIPT_ADAPTER_CAPABILITY } from "./private-document-receipt-adapter.ts";
import {
  SCENARIO_ADAPTER_NAMES,
  SCENARIO_SURFACE_DECLARATION_NAMES,
  type ScenarioAdapterCapabilityDeclaration,
  type ScenarioAdapterName,
  type ScenarioSurfaceCapabilityDeclaration,
  type ScenarioSurfaceDeclarationName,
} from "./scenario-surface-capability.ts";
import { SCENARIO_MANIFESTS } from "./scenarios.ts";

const MAX_SCENARIOS = 32;
const MAX_DECLARATIONS = 32;
const MAX_FAILURES = 64;
const SAFE_PUBLIC_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const GUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UPN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PRIVATE_PATH = /(?:\/(?:home|Users|mnt\/c)\/|[A-Z]:\\)/i;
const RAW_VALUE =
  /(?:onmicrosoft|tenant-?id|subscription-?id|object-?id|message-?id|resource-?id|credential|certificate|access-?token|refresh-?token|session)/i;
const LIVE_PROOF =
  /(?:live|tenant|external|learner|cleanup|detection).{0,24}(?:proof|proven|verified|succeeded)/i;
const CANONICAL_SCENARIO_IDS = new Set(
  SCENARIO_MANIFESTS.map(({ id }) => id),
);

export const SCENARIO_INVENTORY_SURFACES = [
  "manifest",
  "plan",
  "receipt",
  "adapter",
  "rehearsal",
  "authenticated-plan-api-client",
  "authenticated-receipt-api-client",
  "authenticated-rehearsal-verification-api-client",
  "operator-read-ui",
  "operator-preview-ui",
  "operator-verify-ui",
] as const;

export type ScenarioInventorySurface =
  typeof SCENARIO_INVENTORY_SURFACES[number];
export type ScenarioSurfaceStatus =
  | "implemented"
  | "not-applicable"
  | "missing";

export type ScenarioSurfaceReason =
  | "canonical-manifest-valid"
  | "plan-contract-compatible"
  | "plan-contract-drift"
  | "receipt-contract-compatible"
  | "receipt-contract-drift"
  | "validated-adapter-contract"
  | "no-applicable-adapter-declared"
  | "rehearsal-only-exported"
  | "rehearsal-not-declared"
  | "authenticated-plan-api-client-exported"
  | "authenticated-plan-api-client-missing"
  | "authenticated-receipt-api-client-exported"
  | "authenticated-receipt-api-client-missing"
  | "authenticated-rehearsal-verification-api-client-exported"
  | "authenticated-rehearsal-verification-api-client-missing"
  | "operator-catalog-exported"
  | "operator-catalog-missing"
  | "operator-plan-preview-exported"
  | "operator-plan-preview-missing"
  | "operator-receipt-verify-ui-exported"
  | "operator-receipt-verify-ui-missing";

export type ScenarioInventoryFailureCode =
  | "ADAPTER_CONTRACT_DRIFT"
  | "BOUNDS_EXCEEDED"
  | "CONTRACT_COMPATIBILITY_DRIFT"
  | "DECLARATION_DUPLICATE"
  | "DECLARATION_SHAPE"
  | "LIVE_PROOF_LANGUAGE"
  | "RAW_IDENTIFIER"
  | "REGISTRY_DUPLICATE"
  | "REGISTRY_INCOMPLETE"
  | "REGISTRY_INVALID"
  | "SCENARIO_UNKNOWN"
  | "STALE_MANIFEST_VERSION"
  | "UNSUPPORTED_ADAPTER_CLAIM"
  | "UNSUPPORTED_SURFACE_CLAIM";

export interface ScenarioSurfaceCell {
  status: ScenarioSurfaceStatus;
  reason: ScenarioSurfaceReason;
}

export interface ScenarioSurfaceInventoryRow {
  scenarioId: string;
  manifestSchemaVersion: 2;
  surfaces: Readonly<
    Record<ScenarioInventorySurface, ScenarioSurfaceCell>
  >;
}

export interface ScenarioSurfaceInventoryFailure {
  scenarioId: string;
  surface: ScenarioInventorySurface | "inventory";
  code: ScenarioInventoryFailureCode;
}

export interface ScenarioSurfaceInventory {
  schemaVersion: 1;
  kind: "canonical-scenario-surface-inventory";
  status: "valid" | "invalid";
  scenarios: readonly ScenarioSurfaceInventoryRow[];
  failures: readonly ScenarioSurfaceInventoryFailure[];
}

export interface ScenarioSurfaceInventoryOptions {
  registry?: readonly unknown[];
  surfaceDeclarations?: readonly unknown[];
  adapterDeclarations?: readonly unknown[];
}

const AUTHORITATIVE_SURFACE_DECLARATIONS = [
  SCENARIO_PLAN_API_CAPABILITY,
  SCENARIO_RECEIPT_API_CAPABILITY,
  REHEARSAL_OUTPUT_VERIFICATION_API_CAPABILITY,
  ...SCENARIO_API_CLIENT_CAPABILITIES,
  SCENARIO_CATALOG_UI_CAPABILITY,
  SCENARIO_PLAN_PREVIEW_UI_CAPABILITY,
  SCENARIO_RECEIPT_VERIFICATION_UI_CAPABILITY,
  AVD_THREE_VM_REHEARSAL_CAPABILITY,
  PRIVATE_DOCUMENT_REHEARSAL_CAPABILITY,
] as const satisfies readonly ScenarioSurfaceCapabilityDeclaration[];

const AUTHORITATIVE_ADAPTER_DECLARATIONS = [
  AVD_MANIFEST_ADAPTER_CAPABILITY,
  HELP_DESK_EMAIL_RECEIPT_ADAPTER_CAPABILITY,
  PRIVATE_DOCUMENT_RECEIPT_ADAPTER_CAPABILITY,
] as const satisfies readonly ScenarioAdapterCapabilityDeclaration[];

export function inventoryCanonicalScenarioSurfaces(
  options: ScenarioSurfaceInventoryOptions = {},
): ScenarioSurfaceInventory {
  const failures: ScenarioSurfaceInventoryFailure[] = [];
  const registry = options.registry ?? SCENARIO_MANIFESTS;
  const configuredSurfaces =
    options.surfaceDeclarations ?? AUTHORITATIVE_SURFACE_DECLARATIONS;
  const configuredAdapters =
    options.adapterDeclarations ?? AUTHORITATIVE_ADAPTER_DECLARATIONS;

  if (
    !Array.isArray(registry) ||
    registry.length === 0 ||
    registry.length > MAX_SCENARIOS ||
    !Array.isArray(configuredSurfaces) ||
    configuredSurfaces.length > MAX_DECLARATIONS ||
    !Array.isArray(configuredAdapters) ||
    configuredAdapters.length > MAX_DECLARATIONS
  ) {
    return result([], [
      { scenarioId: "unknown", surface: "inventory", code: "BOUNDS_EXCEEDED" },
    ]);
  }

  const manifests = parseRegistry(registry, failures);
  const manifestIds = new Set(manifests.map(({ id }) => id));
  if (
    manifestIds.size !== CANONICAL_SCENARIO_IDS.size ||
    [...CANONICAL_SCENARIO_IDS].some((id) => !manifestIds.has(id))
  ) {
    addFailure(
      failures,
      "unknown",
      "inventory",
      "REGISTRY_INCOMPLETE",
    );
  }
  const surfaces = parseSurfaceDeclarations(
    configuredSurfaces,
    manifestIds,
    failures,
  );
  const adapters = parseAdapterDeclarations(
    configuredAdapters,
    manifestIds,
    failures,
  );
  validateDeclarationAuthority(
    surfaces,
    AUTHORITATIVE_SURFACE_DECLARATIONS,
    failures,
  );
  validateAdapterAuthority(
    adapters,
    configuredAdapters,
    AUTHORITATIVE_ADAPTER_DECLARATIONS,
    failures,
  );

  const compatibility = checkScenarioContractCompatibility({
    catalog: manifests,
  });
  validateCompatibility(manifests, compatibility, adapters, failures);

  const rows = manifests
    .map((manifest) =>
      inventoryRow(manifest, compatibility, surfaces, adapters)
    )
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  return result(rows, failures);
}

export function formatScenarioSurfaceInventory(
  inventory: ScenarioSurfaceInventory,
): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function parseRegistry(
  registry: readonly unknown[],
  failures: ScenarioSurfaceInventoryFailure[],
): ScenarioManifest[] {
  const manifests: ScenarioManifest[] = [];
  const ids = new Set<string>();
  for (const candidate of registry) {
    try {
      const manifest = parseScenarioManifest(candidate);
      if (!safeId(manifest.id)) {
        addFailure(failures, "unknown", "inventory", "RAW_IDENTIFIER");
        continue;
      }
      if (!CANONICAL_SCENARIO_IDS.has(manifest.id)) {
        addFailure(failures, "unknown", "inventory", "SCENARIO_UNKNOWN");
        continue;
      }
      if (manifestHasUnsafeActorIdentity(manifest)) {
        addFailure(failures, manifest.id, "manifest", "RAW_IDENTIFIER");
        continue;
      }
      if (ids.has(manifest.id)) {
        addFailure(failures, manifest.id, "inventory", "REGISTRY_DUPLICATE");
        continue;
      }
      ids.add(manifest.id);
      manifests.push(manifest);
    } catch {
      addFailure(failures, "unknown", "inventory", "REGISTRY_INVALID");
    }
  }
  return manifests;
}

function parseSurfaceDeclarations(
  configured: readonly unknown[],
  manifestIds: ReadonlySet<string>,
  failures: ScenarioSurfaceInventoryFailure[],
): Map<
  ScenarioSurfaceDeclarationName,
  readonly ScenarioSurfaceCapabilityDeclaration[]
> {
  const declarations = new Map<
    ScenarioSurfaceDeclarationName,
    readonly ScenarioSurfaceCapabilityDeclaration[]
  >();
  for (const candidate of configured) {
    const unsafe = unsafeValue(candidate);
    if (unsafe !== undefined) {
      addFailure(
        failures,
        "unknown",
        "inventory",
        unsafe === "live" ? "LIVE_PROOF_LANGUAGE" : "RAW_IDENTIFIER",
      );
      continue;
    }
    try {
      const declaration = surfaceDeclaration(candidate, manifestIds);
      const existing = declarations.get(declaration.surface) ?? [];
      if (
        existing.some((configuredDeclaration) =>
          declarationsOverlap(configuredDeclaration, declaration)
        )
      ) {
        addFailure(
          failures,
          "unknown",
          mapSurface(declaration.surface),
          "DECLARATION_DUPLICATE",
        );
        continue;
      }
      declarations.set(declaration.surface, [...existing, declaration]);
    } catch (error) {
      const failure = error instanceof InventoryInputError
        ? error.code
        : "DECLARATION_SHAPE";
      addFailure(failures, "unknown", "inventory", failure);
    }
  }
  return declarations;
}

function parseAdapterDeclarations(
  configured: readonly unknown[],
  manifestIds: ReadonlySet<string>,
  failures: ScenarioSurfaceInventoryFailure[],
): Map<string, ScenarioAdapterCapabilityDeclaration> {
  const declarations = new Map<string, ScenarioAdapterCapabilityDeclaration>();
  for (const candidate of configured) {
    const unsafe = unsafeValue(candidate);
    if (unsafe !== undefined) {
      addFailure(
        failures,
        "unknown",
        "adapter",
        unsafe === "live" ? "LIVE_PROOF_LANGUAGE" : "RAW_IDENTIFIER",
      );
      continue;
    }
    try {
      const declaration = adapterDeclaration(candidate, manifestIds);
      if (declarations.has(declaration.scenarioId)) {
        addFailure(
          failures,
          declaration.scenarioId,
          "adapter",
          "DECLARATION_DUPLICATE",
        );
        continue;
      }
      declarations.set(declaration.scenarioId, declaration);
    } catch (error) {
      const failure = error instanceof InventoryInputError
        ? error.code
        : "DECLARATION_SHAPE";
      addFailure(failures, "unknown", "adapter", failure);
    }
  }
  return declarations;
}

function surfaceDeclaration(
  candidate: unknown,
  manifestIds: ReadonlySet<string>,
): ScenarioSurfaceCapabilityDeclaration {
  const value = exactRecord(candidate, [
    "schemaVersion",
    "surface",
    "scenarioScope",
    "manifestSchemaVersion",
    "repositoryBoundary",
    "scenarioIds",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !SCENARIO_SURFACE_DECLARATION_NAMES.includes(
      value.surface as ScenarioSurfaceDeclarationName,
    ) ||
    (
      value.scenarioScope !== "canonical-registry" &&
      value.scenarioScope !== "explicit-scenarios"
    ) ||
    value.repositoryBoundary !== "contract-only"
  ) {
    throw new InventoryInputError("DECLARATION_SHAPE");
  }
  if (value.manifestSchemaVersion !== 2) {
    throw new InventoryInputError("STALE_MANIFEST_VERSION");
  }
  if (
    value.scenarioScope === "canonical-registry" &&
    value.scenarioIds !== undefined
  ) {
    throw new InventoryInputError("DECLARATION_SHAPE");
  }
  let scenarioIds: string[] | undefined;
  if (value.scenarioScope === "explicit-scenarios") {
    if (
      !Array.isArray(value.scenarioIds) ||
      value.scenarioIds.length === 0 ||
      value.scenarioIds.length > MAX_SCENARIOS
    ) {
      throw new InventoryInputError("DECLARATION_SHAPE");
    }
    scenarioIds = value.scenarioIds.map((id) => {
      if (!safeId(id)) throw new InventoryInputError("RAW_IDENTIFIER");
      if (!manifestIds.has(id)) {
        throw new InventoryInputError("SCENARIO_UNKNOWN");
      }
      return id;
    });
    if (new Set(scenarioIds).size !== scenarioIds.length) {
      throw new InventoryInputError("DECLARATION_DUPLICATE");
    }
  }
  return {
    schemaVersion: 1,
    surface: value.surface as ScenarioSurfaceDeclarationName,
    scenarioScope: value.scenarioScope,
    manifestSchemaVersion: 2,
    repositoryBoundary: "contract-only",
    ...(scenarioIds === undefined ? {} : { scenarioIds }),
  };
}

function adapterDeclaration(
  candidate: unknown,
  manifestIds: ReadonlySet<string>,
): ScenarioAdapterCapabilityDeclaration {
  const value = exactRecord(candidate, [
    "schemaVersion",
    "adapter",
    "scenarioId",
    "manifestSchemaVersion",
    "repositoryBoundary",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !SCENARIO_ADAPTER_NAMES.includes(value.adapter as ScenarioAdapterName) ||
    value.repositoryBoundary !== "contract-only"
  ) {
    throw new InventoryInputError("DECLARATION_SHAPE");
  }
  if (value.manifestSchemaVersion !== 2) {
    throw new InventoryInputError("STALE_MANIFEST_VERSION");
  }
  if (!safeId(value.scenarioId)) {
    throw new InventoryInputError("RAW_IDENTIFIER");
  }
  if (!manifestIds.has(value.scenarioId)) {
    throw new InventoryInputError("SCENARIO_UNKNOWN");
  }
  return {
    schemaVersion: 1,
    adapter: value.adapter as ScenarioAdapterName,
    scenarioId: value.scenarioId,
    manifestSchemaVersion: 2,
    repositoryBoundary: "contract-only",
  };
}

function validateDeclarationAuthority(
  declarations: Map<
    ScenarioSurfaceDeclarationName,
    readonly ScenarioSurfaceCapabilityDeclaration[]
  >,
  authoritative: readonly ScenarioSurfaceCapabilityDeclaration[],
  failures: ScenarioSurfaceInventoryFailure[],
): void {
  const authoritativeSignatures = new Set(authoritative.map(signature));
  for (const [surface, configured] of declarations) {
    const accepted = configured.filter((declaration) => {
      if (authoritativeSignatures.has(signature(declaration))) return true;
      addFailure(
        failures,
        "unknown",
        mapSurface(declaration.surface),
        "UNSUPPORTED_SURFACE_CLAIM",
      );
      return false;
    });
    if (accepted.length === 0) {
      declarations.delete(surface);
    } else {
      declarations.set(surface, accepted);
    }
  }
}

function validateAdapterAuthority(
  declarations: Map<string, ScenarioAdapterCapabilityDeclaration>,
  _configured: readonly unknown[],
  authoritative: readonly ScenarioAdapterCapabilityDeclaration[],
  failures: ScenarioSurfaceInventoryFailure[],
): void {
  const authoritativeSignatures = new Set(authoritative.map(signature));
  for (const declaration of declarations.values()) {
    if (!authoritativeSignatures.has(signature(declaration))) {
      addFailure(
        failures,
        declaration.scenarioId,
        "adapter",
        "UNSUPPORTED_ADAPTER_CLAIM",
      );
      declarations.delete(declaration.scenarioId);
    }
  }
}

function validateCompatibility(
  manifests: readonly ScenarioManifest[],
  compatibility: ScenarioCompatibilityMatrix,
  adapters: ReadonlyMap<string, ScenarioAdapterCapabilityDeclaration>,
  failures: ScenarioSurfaceInventoryFailure[],
): void {
  const ids = new Set(manifests.map(({ id }) => id));
  const rows = new Map(
    compatibility.scenarios.map((row) => [row.scenarioId, row]),
  );
  if (
    compatibility.status !== "compatible" ||
    compatibility.failures.length !== 0 ||
    rows.size !== ids.size ||
    [...rows.keys()].some((id) => !ids.has(id))
  ) {
    addFailure(
      failures,
      "unknown",
      "inventory",
      "CONTRACT_COMPATIBILITY_DRIFT",
    );
  }
  for (const manifest of manifests) {
    const row = rows.get(manifest.id);
    const declaration = adapters.get(manifest.id);
    const authoritativeAdapter = AUTHORITATIVE_ADAPTER_DECLARATIONS.find(
      ({ scenarioId }) => scenarioId === manifest.id,
    );
    const declaredAdapters = declaration === undefined
      ? []
      : [declaration.adapter];
    if (
      row === undefined ||
      !sameSet(row.adapters, declaredAdapters)
    ) {
      addFailure(
        failures,
        manifest.id,
        "adapter",
        declaration === undefined && authoritativeAdapter !== undefined
          ? "ADAPTER_CONTRACT_DRIFT"
          : declaration === undefined && row !== undefined &&
              row.adapters.length > 0
          ? "UNSUPPORTED_ADAPTER_CLAIM"
          : "ADAPTER_CONTRACT_DRIFT",
      );
    }
  }
}

function inventoryRow(
  manifest: ScenarioManifest,
  compatibility: ScenarioCompatibilityMatrix,
  declarations: ReadonlyMap<
    ScenarioSurfaceDeclarationName,
    readonly ScenarioSurfaceCapabilityDeclaration[]
  >,
  adapters: ReadonlyMap<string, ScenarioAdapterCapabilityDeclaration>,
): ScenarioSurfaceInventoryRow {
  const compatible = compatibility.status === "compatible"
    ? compatibility.scenarios.find(({ scenarioId }) =>
      scenarioId === manifest.id
    )
    : undefined;
  const adapter = adapters.get(manifest.id);
  return {
    scenarioId: manifest.id,
    manifestSchemaVersion: 2,
    surfaces: {
      manifest: cell("implemented", "canonical-manifest-valid"),
      plan: compatible !== undefined && compatible.planStepCount > 0
        ? cell("implemented", "plan-contract-compatible")
        : cell("missing", "plan-contract-drift"),
      receipt: compatible !== undefined && compatible.receiptClaimCount > 0
        ? cell("implemented", "receipt-contract-compatible")
        : cell("missing", "receipt-contract-drift"),
      adapter: adapter === undefined
        ? cell("not-applicable", "no-applicable-adapter-declared")
        : cell("implemented", "validated-adapter-contract"),
      rehearsal: supports(
          declarations.get("rehearsal-only"),
          manifest.id,
        )
        ? cell("implemented", "rehearsal-only-exported")
        : cell("missing", "rehearsal-not-declared"),
      "authenticated-plan-api-client": supports(
          declarations.get("authenticated-plan-api"),
          manifest.id,
        ) &&
          supports(
            declarations.get("authenticated-plan-client"),
            manifest.id,
          )
        ? cell("implemented", "authenticated-plan-api-client-exported")
        : cell("missing", "authenticated-plan-api-client-missing"),
      "authenticated-receipt-api-client": supports(
          declarations.get("authenticated-receipt-api"),
          manifest.id,
        ) &&
          supports(
            declarations.get("authenticated-receipt-client"),
            manifest.id,
          )
        ? cell("implemented", "authenticated-receipt-api-client-exported")
        : cell("missing", "authenticated-receipt-api-client-missing"),
      "authenticated-rehearsal-verification-api-client": supports(
          declarations.get("authenticated-rehearsal-verification-api"),
          manifest.id,
        ) &&
          supports(
            declarations.get("authenticated-rehearsal-verification-client"),
            manifest.id,
          )
        ? cell(
          "implemented",
          "authenticated-rehearsal-verification-api-client-exported",
        )
        : cell(
          "missing",
          "authenticated-rehearsal-verification-api-client-missing",
        ),
      "operator-read-ui": supports(
          declarations.get("operator-catalog-ui"),
          manifest.id,
        )
        ? cell("implemented", "operator-catalog-exported")
        : cell("missing", "operator-catalog-missing"),
      "operator-preview-ui": supports(
          declarations.get("operator-plan-preview-ui"),
          manifest.id,
        )
        ? cell("implemented", "operator-plan-preview-exported")
        : cell("missing", "operator-plan-preview-missing"),
      "operator-verify-ui": supports(
          declarations.get("operator-receipt-verify-ui"),
          manifest.id,
        )
        ? cell("implemented", "operator-receipt-verify-ui-exported")
        : cell("missing", "operator-receipt-verify-ui-missing"),
    },
  };
}

function supports(
  declarations:
    | readonly ScenarioSurfaceCapabilityDeclaration[]
    | undefined,
  scenarioId: string,
): boolean {
  return declarations?.some(
    (declaration) =>
      declaration.scenarioScope === "canonical-registry" ||
      declaration.scenarioIds?.includes(scenarioId) === true,
  ) === true;
}

function declarationsOverlap(
  left: ScenarioSurfaceCapabilityDeclaration,
  right: ScenarioSurfaceCapabilityDeclaration,
): boolean {
  if (
    left.scenarioScope === "canonical-registry" ||
    right.scenarioScope === "canonical-registry"
  ) return true;
  return left.scenarioIds!.some((id) => right.scenarioIds!.includes(id));
}

function cell(
  status: ScenarioSurfaceStatus,
  reason: ScenarioSurfaceReason,
): ScenarioSurfaceCell {
  return Object.freeze({ status, reason });
}

function result(
  rows: readonly ScenarioSurfaceInventoryRow[],
  configuredFailures: readonly ScenarioSurfaceInventoryFailure[],
): ScenarioSurfaceInventory {
  const failures = [...configuredFailures]
    .filter((failure, index, values) =>
      values.findIndex((candidate) =>
        candidate.scenarioId === failure.scenarioId &&
        candidate.surface === failure.surface &&
        candidate.code === failure.code
      ) === index
    )
    .sort((left, right) =>
      left.scenarioId.localeCompare(right.scenarioId) ||
      left.surface.localeCompare(right.surface) ||
      left.code.localeCompare(right.code)
    )
    .slice(0, MAX_FAILURES);
  return Object.freeze({
    schemaVersion: 1,
    kind: "canonical-scenario-surface-inventory",
    status: failures.length === 0 ? "valid" : "invalid",
    scenarios: Object.freeze([...rows]),
    failures: Object.freeze(failures),
  });
}

function exactRecord(
  candidate: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    throw new InventoryInputError("DECLARATION_SHAPE");
  }
  const value = candidate as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new InventoryInputError("DECLARATION_SHAPE");
  }
  return value;
}

function unsafeValue(value: unknown): "live" | "raw" | undefined {
  if (typeof value === "string") {
    if (LIVE_PROOF.test(value)) return "live";
    if (
      GUID.test(value) ||
      UPN.test(value) ||
      PRIVATE_PATH.test(value) ||
      RAW_VALUE.test(value)
    ) return "raw";
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const unsafe = unsafeValue(item);
      if (unsafe !== undefined) return unsafe;
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const unsafe = unsafeValue(key) ?? unsafeValue(item);
      if (unsafe !== undefined) return unsafe;
    }
  }
  return undefined;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 128 &&
    SAFE_PUBLIC_ID.test(value) &&
    !GUID.test(value) &&
    !UPN.test(value) &&
    !PRIVATE_PATH.test(value) &&
    !RAW_VALUE.test(value);
}

function manifestHasUnsafeActorIdentity(
  manifest: ScenarioManifest,
): boolean {
  const actorIds = [
    ...manifest.actors.map(({ id }) => id),
    manifest.roles.evidenceProducer,
    manifest.roles.workloadActor,
    manifest.roles.learner,
    ...(manifest.roles.detector === undefined
      ? []
      : [manifest.roles.detector]),
    ...(manifest.roles.responder === undefined
      ? []
      : [manifest.roles.responder]),
    manifest.lifecycle.cleanupOwnerActorId,
    ...manifest.operations.map(({ ownerActorId }) => ownerActorId),
  ];
  return actorIds.some((id) => !safeId(id));
}

function mapSurface(
  surface: ScenarioSurfaceDeclarationName,
): ScenarioInventorySurface {
  const mapping: Record<
    ScenarioSurfaceDeclarationName,
    ScenarioInventorySurface
  > = {
    "authenticated-plan-api": "authenticated-plan-api-client",
    "authenticated-plan-client": "authenticated-plan-api-client",
    "authenticated-rehearsal-verification-api":
      "authenticated-rehearsal-verification-api-client",
    "authenticated-rehearsal-verification-client":
      "authenticated-rehearsal-verification-api-client",
    "authenticated-receipt-api": "authenticated-receipt-api-client",
    "authenticated-receipt-client": "authenticated-receipt-api-client",
    "operator-catalog-ui": "operator-read-ui",
    "operator-plan-preview-ui": "operator-preview-ui",
    "operator-receipt-verify-ui": "operator-verify-ui",
    "rehearsal-only": "rehearsal",
  };
  return mapping[surface];
}

function signature(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function addFailure(
  failures: ScenarioSurfaceInventoryFailure[],
  scenarioId: string,
  surface: ScenarioInventorySurface | "inventory",
  code: ScenarioInventoryFailureCode,
): void {
  if (failures.length >= MAX_FAILURES) return;
  failures.push({
    scenarioId: safeId(scenarioId) &&
        SCENARIO_MANIFESTS.some(({ id }) => id === scenarioId)
      ? scenarioId
      : "unknown",
    surface,
    code,
  });
}

class InventoryInputError extends Error {
  readonly code: ScenarioInventoryFailureCode;

  constructor(code: ScenarioInventoryFailureCode) {
    super(code);
    this.name = "InventoryInputError";
    this.code = code;
  }
}
