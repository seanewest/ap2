import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type ReadinessDecision =
  | "READY_FOR_ISOLATED_VM"
  | "REJECT_INTERACTIVE_AUTHORING_REQUIRED"
  | "REJECT_BOUNDARY"
  | "REJECT_CLOUD_GATES";

export const SHARED_DEVICE_AUTHORIZED_VM_LIMIT = 1;
export const SHARED_DEVICE_AUTHORIZED_SPEND_USD = 7;

export interface SharedDeviceProvisioningReadiness {
  marker: string;
  package: {
    exists: boolean;
    authoredInIsolatedWindowsClient: boolean;
    bulkTokenAcquiredInteractively: boolean;
    protectedCustody: boolean;
    expiresAt: string | null;
  };
  authoring: {
    usesPhysicalHostDesktop: boolean;
    usesCoordinateOrScreenAutomation: boolean;
    unattendedCliCanAcquireBulkToken: boolean;
  };
  cloud: {
    cleanupJournalPrepared: boolean;
    expiryCleanupPrepared: boolean;
    cleanupRunMarker: string;
    currentBillableVmCount: number;
    maximumBillableVmCount: number;
    quotaAvailable: boolean;
    forecastUsd: number;
    maximumSpendUsd: number;
    privateVm: boolean;
    publicVmIp: boolean;
    bastion: boolean;
    avd: boolean;
    explicitOutbound: boolean;
  };
}

export interface ReadinessResult {
  decision: ReadinessDecision;
  mayCreateBillableResources: boolean;
  reasons: string[];
}

export function evaluateSharedDeviceProvisioningReadiness(
  value: unknown,
  now = new Date(),
): ReadinessResult {
  const validationErrors = validateReadiness(value);
  if (validationErrors.length > 0) {
    return {
      decision: "REJECT_BOUNDARY",
      mayCreateBillableResources: false,
      reasons: validationErrors.map((error) => `Invalid readiness input: ${error}`),
    };
  }
  const input = value as SharedDeviceProvisioningReadiness;
  const reasons: string[] = [];
  if (
    input.authoring.usesPhysicalHostDesktop ||
    input.authoring.usesCoordinateOrScreenAutomation
  ) {
    reasons.push(
      "Provisioning-package authoring must not drive a physical host desktop, screen, pointer, or keyboard.",
    );
    return {
      decision: "REJECT_BOUNDARY",
      mayCreateBillableResources: false,
      reasons,
    };
  }
  if (!input.package.exists) {
    reasons.push(
      "No protected provisioning package exists. Microsoft requires interactive password or CBA authentication in Windows Configuration Designer to acquire its bulk token.",
    );
    if (!input.authoring.unattendedCliCanAcquireBulkToken) {
      reasons.push(
        "The supported WCD CLI builds a package from existing customization input; it does not acquire a bulk Entra enrollment token.",
      );
    }
    return {
      decision: "REJECT_INTERACTIVE_AUTHORING_REQUIRED",
      mayCreateBillableResources: false,
      reasons,
    };
  }
  if (
    !input.package.authoredInIsolatedWindowsClient ||
    !input.package.bulkTokenAcquiredInteractively ||
    !input.package.protectedCustody
  ) {
    reasons.push(
      "The package lacks isolated interactive authoring provenance or protected custody.",
    );
    return {
      decision: "REJECT_BOUNDARY",
      mayCreateBillableResources: false,
      reasons,
    };
  }
  if (
    input.package.expiresAt === null ||
    !Number.isFinite(Date.parse(input.package.expiresAt)) ||
    Date.parse(input.package.expiresAt) <= now.getTime()
  ) {
    reasons.push("The package bulk token is absent, invalid, or expired.");
  }
  if (
    !input.cloud.cleanupJournalPrepared ||
    !input.cloud.expiryCleanupPrepared ||
    input.cloud.cleanupRunMarker !== input.marker
  ) {
    reasons.push("Cleanup journal and expiry cleanup must precede billing.");
  }
  if (
    input.cloud.currentBillableVmCount >= input.cloud.maximumBillableVmCount
  ) {
    reasons.push("The lane already reached its billable VM limit.");
  }
  if (!input.cloud.quotaAvailable) reasons.push("Required VM quota is unavailable.");
  if (
    !Number.isFinite(input.cloud.forecastUsd) ||
    input.cloud.forecastUsd >= input.cloud.maximumSpendUsd
  ) {
    reasons.push("The public-price forecast is not below the lane ceiling.");
  }
  if (
    !input.cloud.privateVm ||
    input.cloud.publicVmIp ||
    input.cloud.bastion ||
    input.cloud.avd ||
    !input.cloud.explicitOutbound
  ) {
    reasons.push(
      "The deployment topology is not one private ordinary VM with explicit outbound.",
    );
  }
  if (reasons.length > 0) {
    return {
      decision: "REJECT_CLOUD_GATES",
      mayCreateBillableResources: false,
      reasons,
    };
  }
  return {
    decision: "READY_FOR_ISOLATED_VM",
    mayCreateBillableResources: true,
    reasons: [],
  };
}

function validateReadiness(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["root must be an object"];
  if (
    typeof value.marker !== "string" ||
    !/^ap2-shared-endpoint-[a-z0-9-]+$/.test(value.marker)
  ) {
    errors.push("marker must be an exact shared-device endpoint marker");
  }
  const packageInput = requireRecord(value, "package", errors);
  const authoring = requireRecord(value, "authoring", errors);
  const cloud = requireRecord(value, "cloud", errors);
  if (packageInput) {
    requireBoolean(packageInput, "exists", "package", errors);
    requireBoolean(
      packageInput,
      "authoredInIsolatedWindowsClient",
      "package",
      errors,
    );
    requireBoolean(
      packageInput,
      "bulkTokenAcquiredInteractively",
      "package",
      errors,
    );
    requireBoolean(packageInput, "protectedCustody", "package", errors);
    if (
      packageInput.expiresAt !== null &&
      typeof packageInput.expiresAt !== "string"
    ) {
      errors.push("package.expiresAt must be a string or null");
    }
  }
  if (authoring) {
    requireBoolean(
      authoring,
      "usesPhysicalHostDesktop",
      "authoring",
      errors,
    );
    requireBoolean(
      authoring,
      "usesCoordinateOrScreenAutomation",
      "authoring",
      errors,
    );
    requireBoolean(
      authoring,
      "unattendedCliCanAcquireBulkToken",
      "authoring",
      errors,
    );
  }
  if (cloud) {
    for (const key of [
      "cleanupJournalPrepared",
      "expiryCleanupPrepared",
      "quotaAvailable",
      "privateVm",
      "publicVmIp",
      "bastion",
      "avd",
      "explicitOutbound",
    ] as const) {
      requireBoolean(cloud, key, "cloud", errors);
    }
    if (typeof cloud.cleanupRunMarker !== "string") {
      errors.push("cloud.cleanupRunMarker must be a string");
    }
    requireNonnegativeInteger(cloud, "currentBillableVmCount", errors);
    requirePositiveInteger(cloud, "maximumBillableVmCount", errors);
    requireNonnegativeFinite(cloud, "forecastUsd", errors);
    requirePositiveFinite(cloud, "maximumSpendUsd", errors);
    if (
      typeof cloud.maximumBillableVmCount === "number" &&
      cloud.maximumBillableVmCount !== SHARED_DEVICE_AUTHORIZED_VM_LIMIT
    ) {
      errors.push(
        `cloud.maximumBillableVmCount must equal the authorized limit ${SHARED_DEVICE_AUTHORIZED_VM_LIMIT}`,
      );
    }
    if (
      typeof cloud.maximumSpendUsd === "number" &&
      cloud.maximumSpendUsd > SHARED_DEVICE_AUTHORIZED_SPEND_USD
    ) {
      errors.push(
        `cloud.maximumSpendUsd must not exceed the authorized USD ${SHARED_DEVICE_AUTHORIZED_SPEND_USD} ceiling`,
      );
    }
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(
  parent: Record<string, unknown>,
  key: string,
  errors: string[],
): Record<string, unknown> | null {
  const value = parent[key];
  if (!isRecord(value)) {
    errors.push(`${key} must be an object`);
    return null;
  }
  return value;
}

function requireBoolean(
  parent: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: string[],
): void {
  if (typeof parent[key] !== "boolean") {
    errors.push(`${prefix}.${key} must be a boolean`);
  }
}

function requireNonnegativeInteger(
  parent: Record<string, unknown>,
  key: string,
  errors: string[],
): void {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push(`cloud.${key} must be a nonnegative integer`);
  }
}

function requirePositiveInteger(
  parent: Record<string, unknown>,
  key: string,
  errors: string[],
): void {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    errors.push(`cloud.${key} must be a positive integer`);
  }
}

function requireNonnegativeFinite(
  parent: Record<string, unknown>,
  key: string,
  errors: string[],
): void {
  const value = parent[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    errors.push(`cloud.${key} must be a finite nonnegative number`);
  }
}

function requirePositiveFinite(
  parent: Record<string, unknown>,
  key: string,
  errors: string[],
): void {
  const value = parent[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    errors.push(`cloud.${key} must be a finite positive number`);
  }
}

export interface SharedDeviceEvidence {
  entraJoined: boolean;
  intuneManagedDevicePresent: boolean;
  complianceState: "compliant" | "noncompliant" | "unknown";
  primaryUserCount: number;
  defenderOnboarded: boolean;
  defenderOffboardedBeforeVmDeletion: boolean;
}

export function summarizeSharedDeviceEvidence(input: SharedDeviceEvidence) {
  return {
    entraJoinProven: input.entraJoined,
    intuneEnrollmentProven: input.intuneManagedDevicePresent,
    complianceProven: input.complianceState !== "unknown",
    userlessEnrollmentProven:
      input.intuneManagedDevicePresent && input.primaryUserCount === 0,
    defenderLifecycleProven:
      input.defenderOnboarded && input.defenderOffboardedBeforeVmDeletion,
  };
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: shared-device-provisioning-readiness.ts <input.json>");
  }
  const input: unknown = JSON.parse(readFileSync(realpathSync(inputPath), "utf8"));
  const result = evaluateSharedDeviceProvisioningReadiness(input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.mayCreateBillableResources) process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Readiness failed");
    process.exitCode = 1;
  }
}
