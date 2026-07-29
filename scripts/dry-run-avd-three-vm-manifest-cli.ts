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

const moduleUrl = new URL(
  "./dry-run-avd-three-vm-manifest.ts",
  import.meta.url,
).href;
const { runCanonicalAvdManifestDryRun } = await import(moduleUrl) as
  typeof import("./dry-run-avd-three-vm-manifest.ts");

runCanonicalAvdManifestDryRun().then(
  (summary) => {
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  },
  (_error: unknown) => {
    process.stderr.write(
      `${
        JSON.stringify({
          schemaVersion: 1,
          mode: "network-free-dry-run",
          status: "refused",
          cloudOperations: "not-performed",
        })
      }\n`,
    );
    process.exitCode = 1;
  },
);
