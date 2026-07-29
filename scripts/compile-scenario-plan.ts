import { readFileSync } from "node:fs";
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

const plannerUrl = new URL(
  "../src/scenarios/scenario-plan.ts",
  import.meta.url,
).href;
const {
  compileScenarioExecutionPlan,
  ScenarioPlanError,
} = await import(plannerUrl);

function main(args: readonly string[]): number {
  if (args.length !== 1) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: { category: "INPUT_INVALID" },
      })}\n`,
    );
    return 2;
  }

  try {
    const value: unknown = JSON.parse(readFileSync(args[0]!, "utf8"));
    const plan = compileScenarioExecutionPlan(value);
    process.stdout.write(`${JSON.stringify({ ok: true, plan }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const category = error instanceof ScenarioPlanError &&
        typeof (error as { category?: unknown }).category === "string"
      ? (error as { category: string }).category
      : "INPUT_INVALID";
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: { category } })}\n`,
    );
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
