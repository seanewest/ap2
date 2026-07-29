export const SERVER_SHUTTING_DOWN_ERROR = "server_shutting_down";

export const SERVER_SHUTTING_DOWN_MESSAGE =
  "The API is shutting down. No request was accepted. Try again manually after service readiness is restored.";

export function isExactServerShuttingDown(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "error" in value &&
    value.error === SERVER_SHUTTING_DOWN_ERROR;
}
