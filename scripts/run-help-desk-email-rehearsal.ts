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
const moduleUrl = new URL(
  "./help-desk-email-rehearsal.ts",
  import.meta.url,
).href;
const {
  createDeterministicHelpDeskEmailFakeLifecycle,
  runHelpDeskEmailRehearsal,
} = await import(moduleUrl) as
  typeof import("./help-desk-email-rehearsal.ts");

async function main(args: readonly string[]): Promise<number> {
  if (args.length !== 1) return refuse();
  try {
    const inputPath = args[0]!;
    const stat = statSync(inputPath);
    if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES) return refuse();
    const value: unknown = JSON.parse(readFileSync(inputPath, "utf8"));
    const result = await runHelpDeskEmailRehearsal(
      value,
      createDeterministicHelpDeskEmailFakeLifecycle(),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === "completed" ? 0 : 2;
  } catch {
    return refuse();
  }
}

function refuse(): 2 {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    label: "REHEARSAL_ONLY",
    status: "refused",
    failure: "INPUT_SCHEMA",
  })}\n`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
