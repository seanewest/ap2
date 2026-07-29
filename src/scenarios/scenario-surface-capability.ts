export const SCENARIO_SURFACE_DECLARATION_NAMES = [
  "authenticated-plan-api",
  "authenticated-plan-client",
  "authenticated-rehearsal-verification-api",
  "authenticated-rehearsal-verification-client",
  "authenticated-receipt-api",
  "authenticated-receipt-client",
  "operator-catalog-ui",
  "operator-plan-preview-ui",
  "operator-receipt-verify-ui",
  "rehearsal-only",
] as const;

export type ScenarioSurfaceDeclarationName =
  typeof SCENARIO_SURFACE_DECLARATION_NAMES[number];

export interface ScenarioSurfaceCapabilityDeclaration {
  schemaVersion: 1;
  surface: ScenarioSurfaceDeclarationName;
  scenarioScope: "canonical-registry" | "explicit-scenarios";
  manifestSchemaVersion: 2;
  repositoryBoundary: "contract-only";
  scenarioIds?: readonly string[];
}

export const SCENARIO_ADAPTER_NAMES = [
  "avd-manifest",
  "help-desk-email",
  "operation-telemetry",
  "private-document",
] as const;

export type ScenarioAdapterName = typeof SCENARIO_ADAPTER_NAMES[number];

export interface ScenarioAdapterCapabilityDeclaration {
  schemaVersion: 1;
  adapter: ScenarioAdapterName;
  scenarioId: string;
  manifestSchemaVersion: 2;
  repositoryBoundary: "contract-only";
}
