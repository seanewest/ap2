// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateSharedDeviceProvisioningReadiness,
  summarizeSharedDeviceEvidence,
  type SharedDeviceProvisioningReadiness,
} from "./shared-device-provisioning-readiness.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readyInput(): SharedDeviceProvisioningReadiness {
  return {
    marker: "ap2-shared-endpoint-20260729-ab12cd",
    package: {
      exists: true,
      authoredInIsolatedWindowsClient: true,
      bulkTokenAcquiredInteractively: true,
      protectedCustody: true,
      expiresAt: "2026-08-01T00:00:00Z",
    },
    authoring: {
      usesPhysicalHostDesktop: false,
      usesCoordinateOrScreenAutomation: false,
      unattendedCliCanAcquireBulkToken: false,
    },
    cloud: {
      cleanupJournalPrepared: true,
      expiryCleanupPrepared: true,
      cleanupRunMarker: "ap2-shared-endpoint-20260729-ab12cd",
      currentBillableVmCount: 0,
      maximumBillableVmCount: 1,
      quotaAvailable: true,
      forecastUsd: 4.25,
      maximumSpendUsd: 7,
      privateVm: true,
      publicVmIp: false,
      bastion: false,
      avd: false,
      explicitOutbound: true,
    },
  };
}

describe("shared-device provisioning readiness", () => {
  it("rejects the observed no-package state before any billable resource", () => {
    const input = readyInput();
    input.package.exists = false;
    input.package.authoredInIsolatedWindowsClient = false;
    input.package.bulkTokenAcquiredInteractively = false;
    input.package.protectedCustody = false;
    input.package.expiresAt = null;

    expect(
      evaluateSharedDeviceProvisioningReadiness(
        input,
        new Date("2026-07-29T06:00:00Z"),
      ),
    ).toEqual({
      decision: "REJECT_INTERACTIVE_AUTHORING_REQUIRED",
      mayCreateBillableResources: false,
      reasons: [
        "No protected provisioning package exists. Microsoft requires interactive password or CBA authentication in Windows Configuration Designer to acquire its bulk token.",
        "The supported WCD CLI builds a package from existing customization input; it does not acquire a bulk Entra enrollment token.",
      ],
    });
  });

  it.each([
    ["physical desktop", "usesPhysicalHostDesktop"],
    ["coordinate automation", "usesCoordinateOrScreenAutomation"],
  ] as const)("rejects %s authoring regardless of cloud readiness", (_, key) => {
    const input = readyInput();
    input.authoring[key] = true;

    const result = evaluateSharedDeviceProvisioningReadiness(input);

    expect(result.decision).toBe("REJECT_BOUNDARY");
    expect(result.mayCreateBillableResources).toBe(false);
  });

  it("allows one isolated VM only with a protected unexpired package and all cloud gates", () => {
    const result = evaluateSharedDeviceProvisioningReadiness(
      readyInput(),
      new Date("2026-07-29T06:00:00Z"),
    );

    expect(result).toEqual({
      decision: "READY_FOR_ISOLATED_VM",
      mayCreateBillableResources: true,
      reasons: [],
    });
  });

  it("fails closed on expiry, spend, quota, VM count, or topology", () => {
    const input = readyInput();
    input.package.expiresAt = "2026-07-29T05:00:00Z";
    input.cloud.currentBillableVmCount = 1;
    input.cloud.quotaAvailable = false;
    input.cloud.forecastUsd = 7;
    input.cloud.publicVmIp = true;

    const result = evaluateSharedDeviceProvisioningReadiness(
      input,
      new Date("2026-07-29T06:00:00Z"),
    );

    expect(result.decision).toBe("REJECT_CLOUD_GATES");
    expect(result.mayCreateBillableResources).toBe(false);
    expect(result.reasons).toHaveLength(5);
  });

  it("rejects missing mutation maxima at runtime", () => {
    const input = readyInput() as unknown as {
      cloud: Record<string, unknown>;
    };
    delete input.cloud.maximumBillableVmCount;
    delete input.cloud.maximumSpendUsd;

    const result = evaluateSharedDeviceProvisioningReadiness(input);

    expect(result.decision).toBe("REJECT_BOUNDARY");
    expect(result.mayCreateBillableResources).toBe(false);
    expect(result.reasons).toContain(
      "Invalid readiness input: cloud.maximumBillableVmCount must be a positive integer",
    );
    expect(result.reasons).toContain(
      "Invalid readiness input: cloud.maximumSpendUsd must be a finite positive number",
    );
  });

  it("rejects negative runtime counts and forecasts", () => {
    const input = readyInput();
    input.cloud.currentBillableVmCount = -1;
    input.cloud.forecastUsd = -1;

    const result = evaluateSharedDeviceProvisioningReadiness(input);

    expect(result.decision).toBe("REJECT_BOUNDARY");
    expect(result.reasons).toContain(
      "Invalid readiness input: cloud.currentBillableVmCount must be a nonnegative integer",
    );
    expect(result.reasons).toContain(
      "Invalid readiness input: cloud.forecastUsd must be a finite nonnegative number",
    );
  });

  it("rejects cleanup prepared for a different marker", () => {
    const input = readyInput();
    input.cloud.cleanupRunMarker = "ap2-shared-endpoint-other-run";

    const result = evaluateSharedDeviceProvisioningReadiness(input);

    expect(result.decision).toBe("REJECT_CLOUD_GATES");
    expect(result.mayCreateBillableResources).toBe(false);
    expect(result.reasons).toContain(
      "Cleanup journal and expiry cleanup must precede billing.",
    );
  });

  it("rejects caller-supplied authority broader than the lane", () => {
    const input = readyInput();
    input.cloud.maximumBillableVmCount = 2;
    input.cloud.maximumSpendUsd = 8;

    const result = evaluateSharedDeviceProvisioningReadiness(input);

    expect(result.decision).toBe("REJECT_BOUNDARY");
    expect(result.reasons).toContain(
      "Invalid readiness input: cloud.maximumBillableVmCount must equal the authorized limit 1",
    );
    expect(result.reasons).toContain(
      "Invalid readiness input: cloud.maximumSpendUsd must not exceed the authorized USD 7 ceiling",
    );
  });
});

describe("shared-device evidence", () => {
  it("keeps join, enrollment, compliance, user affinity, and Defender lifecycle distinct", () => {
    expect(
      summarizeSharedDeviceEvidence({
        entraJoined: true,
        intuneManagedDevicePresent: false,
        complianceState: "unknown",
        primaryUserCount: 0,
        defenderOnboarded: false,
        defenderOffboardedBeforeVmDeletion: false,
      }),
    ).toEqual({
      entraJoinProven: true,
      intuneEnrollmentProven: false,
      complianceProven: false,
      userlessEnrollmentProven: false,
      defenderLifecycleProven: false,
    });
  });
});

describe("shared-device readiness command", () => {
  function run(input: SharedDeviceProvisioningReadiness) {
    const directory = mkdtempSync(join(tmpdir(), "ap2-shared-readiness-"));
    temporaryDirectories.push(directory);
    const inputPath = join(directory, "input.json");
    writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
    return spawnSync(
      process.execPath,
      ["scripts/shared-device-provisioning-readiness.ts", inputPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
  }

  it("exits nonzero when the gate rejects so check-and-deploy stops", () => {
    const input = readyInput();
    input.package.exists = false;

    const result = run(input);

    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      '"decision": "REJECT_INTERACTIVE_AUTHORING_REQUIRED"',
    );
    expect(result.stdout).toContain('"mayCreateBillableResources": false');
  });

  it("exits zero only when the isolated VM gate is ready", () => {
    const result = run(readyInput());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"decision": "READY_FOR_ISOLATED_VM"');
    expect(result.stdout).toContain('"mayCreateBillableResources": true');
  });
});
