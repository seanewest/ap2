export const API_SUPPORT_REFERENCE_HEADER = "X-AP2-Support-Reference";
export const API_SUPPORT_REFERENCE_PATTERN = /^r1_[0-9a-f]{24}$/;

export interface ApiSupportReferencedError extends Error {
  readonly supportReference?: string;
}

export function readApiSupportReference(
  headers: Pick<Headers, "get">,
): string | undefined {
  const value = headers.get(API_SUPPORT_REFERENCE_HEADER);
  return value !== null && API_SUPPORT_REFERENCE_PATTERN.test(value)
    ? value
    : undefined;
}

export function apiSupportReferenceFromError(
  error: unknown,
): string | undefined {
  if (!(error instanceof Error) || !("supportReference" in error)) {
    return undefined;
  }
  const value = (error as ApiSupportReferencedError).supportReference;
  return typeof value === "string" && API_SUPPORT_REFERENCE_PATTERN.test(value)
    ? value
    : undefined;
}

export function withApiSupportReference(
  message: string,
  error: unknown,
): string {
  const reference = apiSupportReferenceFromError(error);
  return reference === undefined
    ? message
    : `${message} Support reference: ${reference}.`;
}
