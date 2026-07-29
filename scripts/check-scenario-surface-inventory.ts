import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      specifier.endsWith(".js")
    ) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

if (process.argv.length !== 2) {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "canonical-scenario-surface-inventory",
      status: "invalid",
      scenarios: [],
      failures: [{
        scenarioId: "unknown",
        surface: "inventory",
        code: "BOUNDS_EXCEEDED",
      }],
    }, null, 2)}\n`,
  );
  process.exitCode = 2;
} else {
  const inventoryUrl = new URL(
    "../src/scenarios/scenario-surface-inventory.ts",
    import.meta.url,
  ).href;
  const {
    formatScenarioSurfaceInventory,
    inventoryCanonicalScenarioSurfaces,
  } = await import(inventoryUrl);
  const inventory = inventoryCanonicalScenarioSurfaces();
  const output = formatScenarioSurfaceInventory(inventory);
  if (inventory.status === "valid") {
    process.stdout.write(output);
  } else {
    process.stderr.write(output);
    process.exitCode = 2;
  }
}
