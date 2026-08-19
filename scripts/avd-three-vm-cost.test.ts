import { describe, expect, it } from "vitest";
import { calculateThreeVmLabCost } from "./avd-three-vm-cost";

describe("three-VM AVD lab cost model", () => {
  it("keeps the four-hour learner window below five dollars", () => {
    const result = calculateThreeVmLabCost({
      billedHours: 4,
      boundedDataGb: 20,
      diskOperationsPerDisk: 100_000,
    });

    expect(result.totalUsd).toBe(4.96690411);
    expect(result.totalUsd).toBeLessThan(5);
  });

  it("keeps a full extra provisioning hour below the lane ceiling", () => {
    const result = calculateThreeVmLabCost({
      billedHours: 5,
      boundedDataGb: 20,
      diskOperationsPerDisk: 100_000,
    });

    expect(result.totalUsd).toBe(5.53363014);
    expect(result.totalUsd).toBeLessThan(10);
  });

  it("rejects negative quantities", () => {
    expect(() =>
      calculateThreeVmLabCost({
        billedHours: -1,
        boundedDataGb: 0,
        diskOperationsPerDisk: 0,
      }),
    ).toThrow("non-negative");
  });
});
