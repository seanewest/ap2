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

const MAX_OUTPUT_BYTES = 32 * 1024;
const verifierUrl = new URL(
  "./verify-help-desk-email-rehearsal-output.ts",
  import.meta.url,
).href;
const {
  HelpDeskEmailRehearsalVerificationError,
  verifyHelpDeskEmailRehearsalOutputText,
} = await import(verifierUrl) as
  typeof import("./verify-help-desk-email-rehearsal-output.ts");

function fail(category: string): 2 {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    label: "REHEARSAL_ONLY_VERIFICATION",
    status: "refused",
    failure: category,
  })}\n`);
  return 2;
}

function main(args: readonly string[]): number {
  if (args.length !== 1) return fail("INPUT_SHAPE");
  try {
    const inputPath = args[0]!;
    const stat = statSync(inputPath);
    if (!stat.isFile()) return fail("INPUT_SHAPE");
    if (stat.size > MAX_OUTPUT_BYTES) return fail("INPUT_OVERSIZED");
    const summary = verifyHelpDeskEmailRehearsalOutputText(
      readFileSync(inputPath, "utf8"),
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (error) {
    return fail(
      error instanceof HelpDeskEmailRehearsalVerificationError
        ? error.category
        : "INPUT_SHAPE",
    );
  }
}

process.exitCode = main(process.argv.slice(2));
