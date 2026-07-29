import type {
  ScenarioSurfaceInventory,
} from "./scenario-surface-inventory";

declare const __AP2_SCENARIO_SURFACE_INVENTORY__:
  | ScenarioSurfaceInventory
  | undefined;

const UNAVAILABLE_INVENTORY: ScenarioSurfaceInventory = {
  schemaVersion: 1,
  kind: "canonical-scenario-surface-inventory",
  status: "invalid",
  scenarios: [],
  failures: [{
    scenarioId: "unknown",
    surface: "inventory",
    code: "REGISTRY_INVALID",
  }],
};

export function browserScenarioSurfaceInventory(): ScenarioSurfaceInventory {
  return typeof __AP2_SCENARIO_SURFACE_INVENTORY__ === "undefined"
    ? UNAVAILABLE_INVENTORY
    : __AP2_SCENARIO_SURFACE_INVENTORY__;
}
