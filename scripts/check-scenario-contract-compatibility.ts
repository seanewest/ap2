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
      status: "drift",
      scenarios: [],
      failures: [{ scenarioId: "unknown", category: "BOUNDS_DRIFT" }],
    }, null, 2)}\n`,
  );
  process.exitCode = 2;
} else {
  const checkerUrl = new URL(
    "../src/scenarios/scenario-contract-compatibility.ts",
    import.meta.url,
  ).href;
  const {
    checkScenarioContractCompatibility,
    formatScenarioCompatibilityMatrix,
  } = await import(checkerUrl);
  const result = checkScenarioContractCompatibility();
  const output = formatScenarioCompatibilityMatrix(result);
  if (result.status === "compatible") {
    process.stdout.write(output);
  } else {
    process.stderr.write(output);
    process.exitCode = 2;
  }
}
