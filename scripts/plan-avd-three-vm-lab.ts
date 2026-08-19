import {
  REQUIRED_TEMPORARY_ROLES,
  buildFrozenLabPlan,
  sanitizedPlanSummary,
  type LabScenario,
} from "./avd-three-vm-runner.ts";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(flag: string): string {
  const value = valueAfter(flag);
  if (!value) {
    throw new Error(`Missing ${flag}.`);
  }
  return value;
}

const marker = required("--marker");
const plannedAt = required("--planned-at");
const expiryUtc = required("--expiry");
const learnerWindowHours = Number(valueAfter("--learner-hours") ?? "4");
const provisioningAllowanceHours = Number(
  valueAfter("--provisioning-hours") ?? "1",
);
const laneCeilingUsd = Number(valueAfter("--ceiling-usd") ?? "10");
const tenantId = process.env.AP2_TENANT_ID;
const subscriptionId = process.env.AP2_SUBSCRIPTION_ID;
const learner = process.env.AP2_AVD_LEARNER;
const expectedTenantId = process.env.AP2_EXPECTED_TENANT_ID;
const expectedSubscriptionId = process.env.AP2_EXPECTED_SUBSCRIPTION_ID;
const expectedLearner = process.env.AP2_EXPECTED_AVD_LEARNER;
const readinessObservedAt = process.env.AP2_READINESS_OBSERVED_AT;
const windowsImage = process.env.AP2_WINDOWS_IMAGE;
const linuxImage = process.env.AP2_LINUX_IMAGE;
const availableWindowsVmCount = Number(process.env.AP2_WINDOWS_QUOTA);
const availableLinuxVmCount = Number(process.env.AP2_LINUX_QUOTA);
if (
  !tenantId ||
  !subscriptionId ||
  !learner ||
  !expectedTenantId ||
  !expectedSubscriptionId ||
  !expectedLearner ||
  !readinessObservedAt ||
  !windowsImage ||
  !linuxImage ||
  !Number.isFinite(availableWindowsVmCount) ||
  !Number.isFinite(availableLinuxVmCount)
) {
  throw new Error(
    "Exact observed scope, independent expected scope, image, quota, and readiness environment values are required.",
  );
}

const scenario: LabScenario = {
  runMarker: marker,
  tenantId,
  subscriptionId,
  learner,
  plannedAt,
  readinessObservedAt,
  expiryUtc,
  learnerWindowHours,
  provisioningAllowanceHours,
  laneCeilingUsd,
  boundedDataGb: 20,
  diskOperationsPerDisk: 100_000,
  cleanupOwner: `owner:${marker}`,
  temporaryRoles: REQUIRED_TEMPORARY_ROLES,
  windowsImage,
  linuxImage,
  windowsSku: "Standard_D4s_v3",
  linuxSku: "Standard_F1als_v7",
  linuxVmCount: 2,
  availableWindowsVmCount,
  availableLinuxVmCount,
  vmPublicIpCount: 0,
  learnerSessionClaimed: false,
};

const plan = buildFrozenLabPlan(scenario, {
  expectedTenantId,
  expectedSubscriptionId,
  expectedLearner,
});
process.stdout.write(`${JSON.stringify(sanitizedPlanSummary(plan), null, 2)}\n`);
