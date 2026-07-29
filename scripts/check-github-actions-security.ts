import { scanTrackedGitHubActions } from "./github-actions-security.ts";

try {
  const result = scanTrackedGitHubActions(process.cwd());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "pass") {
    process.exitCode = 1;
  }
} catch {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      label: "GITHUB_ACTIONS_SECURITY",
      status: "error",
      reason: "GITHUB_ACTIONS_SECURITY_UNEXPECTED_ERROR",
    })}\n`,
  );
  process.exitCode = 2;
}
