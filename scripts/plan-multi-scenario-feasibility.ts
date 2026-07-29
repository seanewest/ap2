import { readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const MAX_INPUT_BYTES = 1024 * 1024;
const plannerUrl = new URL(
  "../src/scenarios/multi-scenario-feasibility.ts",
  import.meta.url,
).href;
const {
  MultiScenarioFeasibilityInputError,
  planMultiScenarioFeasibility,
} = await import(plannerUrl) as
  typeof import("../src/scenarios/multi-scenario-feasibility.ts");

function fail(category: string): 2 {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: 1,
      label: "FEASIBILITY_ONLY",
      status: "refused",
      failure: category,
    })}\n`,
  );
  return 2;
}

function main(args: readonly string[]): number {
  if (args.length !== 1) return fail("INPUT_INVALID");
  try {
    const inputPath = args[0]!;
    const stat = statSync(inputPath);
    if (!stat.isFile()) return fail("INPUT_INVALID");
    if (stat.size > MAX_INPUT_BYTES) return fail("INPUT_OVERSIZED");
    const value: unknown = JSON.parse(readFileSync(inputPath, "utf8"));
    const result = planMultiScenarioFeasibility(value);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "feasible" ? 0 : 3;
  } catch (error) {
    return fail(
      error instanceof MultiScenarioFeasibilityInputError
        ? error.category
        : "INPUT_INVALID",
    );
  }
}

process.exitCode = main(process.argv.slice(2));
