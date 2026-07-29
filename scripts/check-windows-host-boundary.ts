import { scanTrackedRepository } from "./windows-host-boundary.ts";

function safeFailure(reason: string): {
  schemaVersion: 1;
  label: "WINDOWS_HOST_BOUNDARY";
  status: "error";
  reason: string;
} {
  const knownReasons = new Set([
    "WINDOWS_HOST_BOUNDARY_FILE_LIMIT",
    "WINDOWS_HOST_BOUNDARY_FILE_SIZE_LIMIT",
    "WINDOWS_HOST_BOUNDARY_FINDING_LIMIT",
    "WINDOWS_HOST_BOUNDARY_INDEX_LIMIT",
    "WINDOWS_HOST_BOUNDARY_INDEX_SIZE_LIMIT",
    "WINDOWS_HOST_BOUNDARY_INVALID_GIT_DIRECTORY",
    "WINDOWS_HOST_BOUNDARY_INVALID_GIT_INDEX",
    "WINDOWS_HOST_BOUNDARY_NON_REGULAR_FILE",
    "WINDOWS_HOST_BOUNDARY_PATH_ESCAPE",
    "WINDOWS_HOST_BOUNDARY_TOTAL_SIZE_LIMIT",
    "WINDOWS_HOST_BOUNDARY_UNSCOPED_FILE",
    "WINDOWS_HOST_BOUNDARY_UNSUPPORTED_GIT_INDEX",
    "WINDOWS_HOST_BOUNDARY_UNSAFE_GIT_PATH",
  ]);
  return {
    schemaVersion: 1,
    label: "WINDOWS_HOST_BOUNDARY",
    status: "error",
    reason: knownReasons.has(reason)
      ? reason
      : "WINDOWS_HOST_BOUNDARY_UNEXPECTED_ERROR",
  };
}

try {
  const result = scanTrackedRepository(process.cwd());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "pass") {
    process.exitCode = 1;
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : "";
  process.stdout.write(`${JSON.stringify(safeFailure(reason))}\n`);
  process.exitCode = 2;
}
