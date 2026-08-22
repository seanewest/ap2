import { describe, expect, it } from "vitest";
import {
  BASELINE_NAMES,
  RETAINED_DEVICE_NAMES,
  assertFeatureShape,
  assertRetainedInventory,
  assertRingShape,
  featureUpdateBody,
  summarizeDeviceStatus,
  updateRingBody,
} from "./windows-update-baseline.mjs";

const devices = RETAINED_DEVICE_NAMES.map((deviceName) => ({
  id: crypto.randomUUID(),
  deviceName,
  azureADDeviceId: crypto.randomUUID(),
  operatingSystem: "Windows",
  osVersion: "10.0.26100.9106",
  managementAgent: deviceName === "ap2homerfresh" ? "msSense" : "mdm",
}));

describe("retained Windows update baseline", () => {
  it("requires the exact four live retained identities and current management states", () => {
    expect(assertRetainedInventory(devices).map((device) => device.deviceName)).toEqual(RETAINED_DEVICE_NAMES);
    expect(() => assertRetainedInventory(devices.slice(1))).toThrow("Missing retained Intune device");
    expect(() => assertRetainedInventory(devices.map((device) =>
      device.deviceName === "ap2homerfresh" ? { ...device, managementAgent: "eas" } : device,
    ))).toThrow("unexpected management state");
    expect(() => assertRetainedInventory(devices.map((device) =>
      device.deviceName === "ap2fastrachel" ? { ...device, osVersion: "10.0.26200.9168" } : device,
    ))).not.toThrow();
    expect(() => assertRetainedInventory(devices.map((device) =>
      device.deviceName === "ap2fastrachel" ? { ...device, osVersion: "10.0.22631.5909" } : device,
    ))).toThrow("below the retained Windows 11 24H2 baseline");
  });

  it("uses a quality deadline with restart warning and no user pause or scan override", () => {
    const ring = updateRingBody();
    expect(ring.displayName).toBe(BASELINE_NAMES.ring);
    expect(ring.qualityUpdatesDeferralPeriodInDays).toBe(3);
    expect(ring.deadlineForQualityUpdatesInDays).toBe(7);
    expect(ring.deadlineGracePeriodInDays).toBe(2);
    expect(ring.postponeRebootUntilAfterDeadline).toBe(false);
    expect(ring.updateNotificationLevel).toBe("restartWarningsOnly");
    expect(ring.userPauseAccess).toBe("disabled");
    expect(ring.userWindowsUpdateScanAccess).toBe("disabled");
    expect(ring.driversExcluded).toBe(true);
    expect(() => assertRingShape({ ...ring, id: crypto.randomUUID() })).not.toThrow();
  });

  it("holds feature updates at supported Windows 11 24H2", () => {
    const feature = featureUpdateBody();
    expect(feature.displayName).toBe(BASELINE_NAMES.feature);
    expect(feature.featureUpdateVersion).toBe("Windows 11, version 24H2");
    expect(feature.installFeatureUpdatesOptional).toBe(false);
    expect(() => assertFeatureShape({ ...feature, id: crypto.randomUUID() })).not.toThrow();
  });

  it("preserves device versus user context in native policy status", () => {
    expect(summarizeDeviceStatus({
      deviceDisplayName: "ap2fastrachel",
      userPrincipalName: "System account",
      status: "compliant",
      lastReportedDateTime: "2026-08-22T05:42:42Z",
    })).toEqual({
      deviceDisplayName: "ap2fastrachel",
      userPrincipalName: "System account",
      status: "compliant",
      lastReportedDateTime: "2026-08-22T05:42:42Z",
    });
  });
});
