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

const MAX_REQUEST_BYTES = 8 * 1024;
const pipelineUrl = new URL(
  "./teams-missed-call-rehearsal.ts",
  import.meta.url,
).href;
const envelopeUrl = new URL(
  "../src/scenarios/rehearsal-envelope-invariants.ts",
  import.meta.url,
).href;
const {
  createDeterministicTeamsMissedCallFakeLifecycle,
  runTeamsMissedCallRehearsal,
} = await import(pipelineUrl) as
  typeof import("./teams-missed-call-rehearsal.ts");
const { parseCanonicalRehearsalJson } = await import(envelopeUrl) as
  typeof import("../src/scenarios/rehearsal-envelope-invariants.ts");

async function main(args: readonly string[]): Promise<number> {
  if (args.length !== 1) return refuse("INPUT_SCHEMA");
  try {
    const inputPath = args[0]!;
    const stat = statSync(inputPath);
    if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES) {
      return refuse("INPUT_SCHEMA");
    }
    const parsed = parseCanonicalRehearsalJson(
      readFileSync(inputPath, "utf8"),
      MAX_REQUEST_BYTES,
    );
    if (!parsed.ok) return refuse(parsed.failure);
    const result = await runTeamsMissedCallRehearsal(
      parsed.value,
      createDeterministicTeamsMissedCallFakeLifecycle(),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "completed" ? 0 : 2;
  } catch {
    return refuse("INPUT_SCHEMA");
  }
}

function refuse(failure: string): 2 {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "refused",
    failure,
  })}\n`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
