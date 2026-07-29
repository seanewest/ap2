import {
  apiSupportReferenceFromError,
} from "../api/support-reference";
import type { ApiRouteOwnerKey } from "../api/api-route-contract";

export const OPERATOR_SUPPORT_BUNDLE_MAX_FAILURES = 12;
export const OPERATOR_SUPPORT_BUNDLE_MAX_BYTES = 4_096;

export const REHEARSAL_SUPPORT_ROUTE_CATEGORIES = [
  "avd-rehearsal-verify",
  "private-document-rehearsal-verify",
  "help-desk-email-rehearsal-verify",
  "teams-missed-call-rehearsal-verify",
  "oauth-application-recon-rehearsal-verify",
  "purview-audit-boundary-rehearsal-verify",
] as const satisfies readonly ApiRouteOwnerKey[];

export type RehearsalSupportRouteCategory =
  (typeof REHEARSAL_SUPPORT_ROUTE_CATEGORIES)[number];

export const REHEARSAL_SUPPORT_STATUSES = [
  "request-too-large",
  "response-too-large",
  "server-shutting-down",
  "session-expired",
  "unauthorized",
  "unavailable",
  "verification-refused",
] as const;

export type RehearsalSupportStatus =
  (typeof REHEARSAL_SUPPORT_STATUSES)[number];

export interface OperatorSupportBundleFailure {
  readonly occurredAt: string;
  readonly routeCategory: RehearsalSupportRouteCategory;
  readonly categoricalStatus: RehearsalSupportStatus;
  readonly supportReference: string;
}

export interface OperatorSupportBundle {
  readonly schemaVersion: 1;
  readonly label: "AP2_OPERATOR_SUPPORT_BUNDLE";
  readonly applicationVersion: "0.1.0";
  readonly buildCategory: "browser-spa";
  readonly exportedAt: string;
  readonly failures: readonly OperatorSupportBundleFailure[];
}

export interface OperatorSupportBundleSession {
  recordFailure(input: {
    routeCategory: RehearsalSupportRouteCategory;
    categoricalStatus: RehearsalSupportStatus;
    error: unknown;
  }): void;
  createBundle(): OperatorSupportBundle | undefined;
  clear(): void;
}

export function createOperatorSupportBundleSession(
  now: () => Date = () => new Date(),
): OperatorSupportBundleSession {
  const failures: OperatorSupportBundleFailure[] = [];

  return {
    recordFailure(input): void {
      const parsed = safelyParseFailureInput(input);
      if (parsed === undefined) {
        return;
      }
      const supportReference = safelyReadSupportReference(parsed.error);
      const occurredAt = safeIsoTimestamp(now);
      if (supportReference === undefined || occurredAt === undefined) {
        return;
      }
      failures.push({
        occurredAt,
        routeCategory: parsed.routeCategory,
        categoricalStatus: parsed.categoricalStatus,
        supportReference,
      });
      if (failures.length > OPERATOR_SUPPORT_BUNDLE_MAX_FAILURES) {
        failures.splice(
          0,
          failures.length - OPERATOR_SUPPORT_BUNDLE_MAX_FAILURES,
        );
      }
    },
    createBundle(): OperatorSupportBundle | undefined {
      if (failures.length === 0) {
        return undefined;
      }
      const exportedAt = safeIsoTimestamp(now);
      if (exportedAt === undefined) {
        return undefined;
      }
      const bundle = {
        schemaVersion: 1,
        label: "AP2_OPERATOR_SUPPORT_BUNDLE",
        applicationVersion: "0.1.0",
        buildCategory: "browser-spa",
        exportedAt,
        failures: failures.map((failure) => ({ ...failure })),
      } as const satisfies OperatorSupportBundle;
      return serializeOperatorSupportBundle(bundle).length <=
          OPERATOR_SUPPORT_BUNDLE_MAX_BYTES
        ? bundle
        : undefined;
    },
    clear(): void {
      failures.splice(0, failures.length);
    },
  };
}

export function serializeOperatorSupportBundle(
  bundle: OperatorSupportBundle,
): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function safelyParseFailureInput(
  input: unknown,
): {
  routeCategory: RehearsalSupportRouteCategory;
  categoricalStatus: RehearsalSupportStatus;
  error: unknown;
} | undefined {
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input)
    ) {
      return undefined;
    }
    const candidate = input as Record<string, unknown>;
    const routeCategory = candidate.routeCategory;
    const categoricalStatus = candidate.categoricalStatus;
    if (
      typeof routeCategory !== "string" ||
      !REHEARSAL_SUPPORT_ROUTE_CATEGORIES.includes(
        routeCategory as RehearsalSupportRouteCategory,
      ) ||
      typeof categoricalStatus !== "string" ||
      !REHEARSAL_SUPPORT_STATUSES.includes(
        categoricalStatus as RehearsalSupportStatus,
      )
    ) {
      return undefined;
    }
    return {
      routeCategory: routeCategory as RehearsalSupportRouteCategory,
      categoricalStatus: categoricalStatus as RehearsalSupportStatus,
      error: candidate.error,
    };
  } catch {
    return undefined;
  }
}

function safelyReadSupportReference(
  error: unknown,
): string | undefined {
  try {
    return apiSupportReferenceFromError(error);
  } catch {
    return undefined;
  }
}

function safeIsoTimestamp(now: () => Date): string | undefined {
  try {
    return now().toISOString();
  } catch {
    return undefined;
  }
}
