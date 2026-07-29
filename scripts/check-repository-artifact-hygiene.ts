import { scanTrackedRepositoryArtifacts } from "./repository-artifact-hygiene.ts";

try {
  const result = scanTrackedRepositoryArtifacts(process.cwd());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "pass") {
    process.exitCode = 1;
  }
} catch (error) {
  const reason =
    error instanceof Error &&
    [
      "REPOSITORY_ARTIFACT_HYGIENE_FILE_LIMIT",
      "REPOSITORY_ARTIFACT_HYGIENE_FINDING_LIMIT",
    ].includes(error.message)
      ? error.message
      : "REPOSITORY_ARTIFACT_HYGIENE_UNEXPECTED_ERROR";
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      label: "REPOSITORY_ARTIFACT_HYGIENE",
      status: "error",
      reason,
    })}\n`,
  );
  process.exitCode = 2;
}
