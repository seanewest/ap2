import { join } from "node:path";
import {
  evaluateSpaBundleBudget,
  readSpaBundleFiles,
} from "./spa-bundle-budget.ts";

if (process.argv.length !== 2) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    label: "SPA_BUNDLE_BUDGET",
    status: "error",
    reason: "INPUT_SHAPE",
  })}\n`);
  process.exitCode = 2;
} else {
  try {
    const result = evaluateSpaBundleBudget(
      readSpaBundleFiles(join(process.cwd(), "dist")),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "pass") process.exitCode = 1;
  } catch {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      label: "SPA_BUNDLE_BUDGET",
      status: "error",
      reason: "OUTPUT_UNREADABLE",
    })}\n`);
    process.exitCode = 2;
  }
}
