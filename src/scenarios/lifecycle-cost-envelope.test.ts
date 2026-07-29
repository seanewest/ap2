import { describe, expect, it } from "vitest";
import { AVD_THREE_VM_SCENARIO } from "./avd-three-vm";
import {
  compileLifecycleCostEnvelope,
  LifecycleCostEnvelopeError,
  type LifecycleCostEnvelopeRequest,
  type LifecycleCostUsageLine,
  type LifecycleRateCard,
} from "./lifecycle-cost-envelope";
import {
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
} from "./scenario-plan";

const GENERATED_AT = "2026-07-29T08:45:37Z";
const EXPIRES_AT = "2026-07-29T13:45:37Z";

function plannedManifest() {
  return {
    ...AVD_THREE_VM_SCENARIO,
    id: "planned-three-vm-cost-example",
    evidence: {
      ...AVD_THREE_VM_SCENARIO.evidence,
      artifacts: AVD_THREE_VM_SCENARIO.evidence.artifacts.map(
        ({ observation: _observation, ...artifact }) => ({
          ...artifact,
          state: "planned" as const,
          learnerVisibility: "not-proven" as const,
        }),
      ),
    },
    learner: {
      ...AVD_THREE_VM_SCENARIO.learner,
      completionState: "not-run" as const,
    },
  };
}

function plannedExecutionPlan(): ScenarioExecutionPlan {
  return compileScenarioExecutionPlan(
    {
      scenarioId: "planned-three-vm-cost-example",
      actorAliases: {
        evidenceProducer: "orchestrator",
        workloadActor: "endpoint",
        learner: "learner",
        responder: "orchestrator",
        cleanupOwner: "orchestrator",
      },
      now: GENERATED_AT,
      expiresAt: EXPIRES_AT,
      maximumBudgetUsd: 10,
    },
    [plannedManifest()],
  );
}

function rateCard(): LifecycleRateCard {
  return {
    schemaVersion: 1,
    kind: "supplied-lifecycle-rate-card",
    currency: "USD",
    region: "example-region",
    effectiveAt: "2026-07-29T00:00:00Z",
    expiresAt: "2026-07-30T00:00:00Z",
    meters: [
      meter("windows-compute", "vm-compute", "compute", "example-win-vm", "resource-hour", 0.2),
      meter("linux-compute", "vm-compute", "compute", "example-linux-vm", "resource-hour", 0.05),
      meter("windows-disk", "os-disk", "disk-capacity", "example-win-disk", "resource-hour", 0.01),
      meter("linux-disk", "os-disk", "disk-capacity", "example-linux-disk", "resource-hour", 0.005),
      meter("shared-nat", "nat-gateway", "shared-service", "example-nat", "resource-hour", 0.02),
      meter("shared-ip", "public-ip", "shared-service", "example-ip", "resource-hour", 0.01),
      meter("nat-data", "nat-data", "network", "example-nat-data", "gb", 0.03),
      meter("egress-data", "internet-egress", "network", "example-egress", "gb", 0.04),
      meter("disk-operations", "disk-operations", "disk-operations", "example-disk-ops", "operation", 0.000001),
    ],
  };
}

function meter(
  id: string,
  component: LifecycleRateCard["meters"][number]["component"],
  category: LifecycleRateCard["meters"][number]["category"],
  sku: string,
  billingUnit: LifecycleRateCard["meters"][number]["billingUnit"],
  rateUsdPerUnit: number,
): LifecycleRateCard["meters"][number] {
  return {
    id,
    component,
    category,
    sku,
    billingUnit,
    rateUsdPerUnit,
    billingIncrementUnits: billingUnit === "resource-hour" ? 1 : 1,
    minimumBillableUnits: billingUnit === "resource-hour" ? 1 : 0,
  };
}

function request(
  changes: Partial<LifecycleCostEnvelopeRequest> = {},
): LifecycleCostEnvelopeRequest {
  return {
    schemaVersion: 1,
    kind: "lifecycle-cost-envelope-request",
    asOf: GENERATED_AT,
    region: "example-region",
    manifest: plannedManifest(),
    plan: plannedExecutionPlan(),
    rateCard: rateCard(),
    learnerDurationHours: 4,
    provisioningWaves: [
      { id: "control", parallelDurationsHours: [0.25] },
      {
        id: "parallel-compute",
        parallelDurationsHours: [0.25, 0.25],
      },
    ],
    startupGraceHours: 0.25,
    cleanupGraceHours: 0.25,
    contingencyPercent: 20,
    suppliedCeilingUsd: 10,
    usageLines: [
      line("windows-vm", "windows-avd-host", "windows-compute", 1, "lifecycle-hours"),
      line("linux-vms", "ubuntu-auxiliary-pair", "linux-compute", 2, "lifecycle-hours"),
      line("windows-disk", "windows-avd-host", "windows-disk", 1, "lifecycle-hours"),
      line("linux-disks", "ubuntu-auxiliary-pair", "linux-disk", 2, "lifecycle-hours"),
      line("nat", "shared-nat-egress", "shared-nat", 1, "lifecycle-hours"),
      line("ip", "shared-nat-egress", "shared-ip", 1, "lifecycle-hours"),
      line("nat-gb", "shared-nat-egress", "nat-data", 1, "fixed-units", 10),
      line("egress-gb", "shared-nat-egress", "egress-data", 1, "fixed-units", 10),
      line("windows-ops", "windows-avd-host", "disk-operations", 1, "fixed-units", 1_000),
      line("linux-ops", "ubuntu-auxiliary-pair", "disk-operations", 2, "fixed-units", 1_000),
    ],
    ...changes,
  };
}

function line(
  id: string,
  resourceId: string,
  meterId: string,
  resourceCount: number,
  basis: "lifecycle-hours" | "fixed-units",
  unitsPerResource?: number,
) {
  return {
    id,
    resourceId,
    meterId,
    resourceCount,
    basis,
    ...(unitsPerResource === undefined ? {} : { unitsPerResource }),
  } as const;
}

function category(input: unknown): string {
  try {
    compileLifecycleCostEnvelope(input);
    return "accepted";
  } catch (error) {
    expect(error).toBeInstanceOf(LifecycleCostEnvelopeError);
    return (error as LifecycleCostEnvelopeError).category;
  }
}

describe("generalized lifecycle cost envelope", () => {
  it("forecasts a synthetic three-VM four-hour lifecycle without claiming a bill", () => {
    const result = compileLifecycleCostEnvelope(request());

    expect(result).toMatchObject({
      label: "FORECAST_ONLY",
      status: "fits-ceiling",
      scenarioId: "planned-three-vm-cost-example",
      region: "example-region",
      currency: "USD",
      timing: {
        learnerHours: 4,
        provisioningWaveHours: [0.25, 0.25],
        totalProvisioningHours: 0.5,
        startupGraceHours: 0.25,
        cleanupGraceHours: 0.25,
        conservativeLifecycleHours: 5,
        planWindowHours: 5,
      },
      cost: {
        baseForecastUsd: 2.453,
        contingencyPercent: 20,
        contingencyUsd: 0.4906,
        conservativeForecastUsd: 2.9436,
        suppliedCeilingUsd: 10,
      },
      classifications: {
        forecast: "supplied-rate-conservative-bound",
        ceiling: "caller-supplied-limit",
        observedBill: "not-observed",
      },
    });
    expect(result.rateCardDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.usageProfileDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.planDigestSha256).toBe(plannedExecutionPlan().digestSha256);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lines)).toBe(true);
  });

  it("sums sequential waves, overlaps members, and applies per-resource minimums", () => {
    const input = request({
      learnerDurationHours: 3.1,
      provisioningWaves: [
        { id: "control", parallelDurationsHours: [0.2] },
        {
          id: "compute",
          parallelDurationsHours: [0.4, 0.4],
        },
      ],
      startupGraceHours: 0.1,
      cleanupGraceHours: 0.1,
    });
    const result = compileLifecycleCostEnvelope(input);
    const linux = result.lines.find(({ sku }) => sku === "example-linux-vm");

    expect(result.timing).toMatchObject({
      provisioningWaveHours: [0.2, 0.4],
      totalProvisioningHours: 0.6,
      conservativeLifecycleHours: 3.9,
    });
    expect(linux).toMatchObject({
      resourceCount: 2,
      rawUnitsPerResource: 3.9,
      billableUnitsPerResource: 4,
      extendedUsd: 0.4,
    });
  });

  it("returns an honest ceiling decision instead of throwing on a high forecast", () => {
    const input = request();
    const result = compileLifecycleCostEnvelope(input);
    expect(result.status).toBe("fits-ceiling");
    const expensive = structuredClone(rateCard());
    expensive.meters[0]!.rateUsdPerUnit = 3;
    expect(
      compileLifecycleCostEnvelope({
        ...input,
        rateCard: expensive,
      }).status,
    ).toBe("exceeds-ceiling");
  });

  it("rejects stale or mismatched rate-card metadata", () => {
    for (const mutation of [
      (card: Record<string, unknown>) => {
        card.currency = "EUR";
      },
      (card: Record<string, unknown>) => {
        card.region = "other-region";
      },
      (card: Record<string, unknown>) => {
        card.effectiveAt = "2026-07-29T09:00:00Z";
      },
      (card: Record<string, unknown>) => {
        card.expiresAt = "2026-07-29T12:00:00Z";
      },
      (card: Record<string, unknown>) => {
        delete card.effectiveAt;
      },
      (card: Record<string, unknown>) => {
        card.effectiveAt = "2026-02-30T00:00:00Z";
      },
    ]) {
      const input = request();
      const card = structuredClone(input.rateCard) as Record<string, unknown>;
      mutation(card);
      expect(category({ ...input, rateCard: card })).toMatch(
        /RATE_CARD_(?:INVALID|STALE)/,
      );
    }
  });

  it("rejects missing SKU, negative, non-finite, and overflowing inputs", () => {
    const missingSku = request();
    delete (missingSku.rateCard as {
      meters: Array<Record<string, unknown>>;
    }).meters[0]!.sku;
    expect(category(missingSku)).toBe("RATE_CARD_INVALID");

    for (const changes of [
      { learnerDurationHours: -1 },
      { startupGraceHours: Number.NaN },
      { cleanupGraceHours: Number.POSITIVE_INFINITY },
      { contingencyPercent: 101 },
    ]) {
      expect(category(request(changes))).toBe("INPUT_INVALID");
    }

    const overflow = request();
    (overflow.rateCard as LifecycleRateCard).meters[1]!.rateUsdPerUnit =
      1_000_000;
    expect(category(overflow)).toBe("COST_OVERFLOW");
  });

  it("rejects unknown fields, duplicate lines, fractional counts, and plan drift", () => {
    expect(category({ ...request(), arbitrary: "unsafe" })).toBe(
      "INPUT_INVALID",
    );

    const rateExtra = request();
    (rateExtra.rateCard as Record<string, unknown>).source = "unbounded";
    expect(category(rateExtra)).toBe("RATE_CARD_INVALID");

    const meterExtra = request();
    (
      meterExtra.rateCard as {
        meters: Array<Record<string, unknown>>;
      }
    ).meters[0]!.quote = "not-allowed";
    expect(category(meterExtra)).toBe("RATE_CARD_INVALID");

    const duplicate = request();
    duplicate.usageLines = [
      ...duplicate.usageLines,
      duplicate.usageLines[0]!,
    ];
    expect(category(duplicate)).toBe("INPUT_INVALID");

    const fractional = request();
    const fractionalLines =
      fractional.usageLines as LifecycleCostUsageLine[];
    fractionalLines[0] = {
      ...fractionalLines[0]!,
      resourceCount: 1.5,
    };
    expect(category(fractional)).toBe("INPUT_INVALID");

    const digestDrift = request();
    (digestDrift.plan as ScenarioExecutionPlan).digestSha256 = "0".repeat(64);
    expect(category(digestDrift)).toBe("PLAN_BINDING");
  });

  it("rejects incomplete resource coverage and unsafe meter relationships", () => {
    const missing = request();
    missing.usageLines = missing.usageLines.filter(
      ({ resourceId }) => resourceId !== "shared-nat-egress",
    );
    expect(category(missing)).toBe("COVERAGE_INCOMPLETE");

    const unowned = request();
    const unownedLines = unowned.usageLines as LifecycleCostUsageLine[];
    unownedLines[0] = {
      ...unownedLines[0]!,
      resourceId: "not-a-billable-resource",
    };
    expect(category(unowned)).toBe("COVERAGE_INCOMPLETE");

    const wrongUnit = request();
    (wrongUnit.rateCard as LifecycleRateCard).meters[0]!.billingUnit = "gb";
    expect(category(wrongUnit)).toBe("RATE_CARD_INVALID");

    const wrongCount = request();
    const wrongCountLines =
      wrongCount.usageLines as LifecycleCostUsageLine[];
    wrongCountLines[1] = {
      ...wrongCountLines[1]!,
      resourceCount: 1,
    };
    expect(category(wrongCount)).toBe("COVERAGE_INCOMPLETE");

    const missingCategory = request();
    missingCategory.usageLines = missingCategory.usageLines.filter(
      ({ id }) => id !== "linux-disks",
    );
    expect(category(missingCategory)).toBe("COVERAGE_INCOMPLETE");

    const unusedMeter = request();
    (unusedMeter.rateCard as LifecycleRateCard).meters = [
      ...(unusedMeter.rateCard as LifecycleRateCard).meters,
      meter(
        "unused",
        "nat-data",
        "network",
        "example-unused",
        "gb",
        0.01,
      ),
    ];
    expect(category(unusedMeter)).toBe("COVERAGE_INCOMPLETE");
  });

  it("rejects learner-only hourly billing and zero-duration provisioning", () => {
    const learnerOnly = request();
    (
      learnerOnly.usageLines[0] as unknown as Record<string, unknown>
    ).basis = "learner-hours";
    expect(category(learnerOnly)).toBe("INPUT_INVALID");

    const zeroWave = request({
      provisioningWaves: [{
        id: "zero",
        parallelDurationsHours: [0],
      }],
    });
    expect(category(zeroWave)).toBe("INPUT_INVALID");
  });

  it("rejects a pre-seeded historical plan and expiry-order tampering", () => {
    const historical = request({
      manifest: AVD_THREE_VM_SCENARIO,
      plan: compileScenarioExecutionPlan(
        {
          scenarioId: AVD_THREE_VM_SCENARIO.id,
          actorAliases: {
            evidenceProducer: "orchestrator",
            workloadActor: "endpoint",
            learner: "learner",
            responder: "orchestrator",
            cleanupOwner: "orchestrator",
          },
          now: GENERATED_AT,
          expiresAt: EXPIRES_AT,
          maximumBudgetUsd: 10,
        },
        [AVD_THREE_VM_SCENARIO],
      ),
    });
    expect(category(historical)).toBe("EXPIRY_INVALID");

    const tampered = request();
    const plan = structuredClone(tampered.plan) as ScenarioExecutionPlan & {
      steps: ScenarioExecutionPlan["steps"][number][];
    };
    const expiry = plan.steps.findIndex(
      ({ operationCategory }) => operationCategory === "expiry.schedule",
    );
    const deploy = plan.steps.findIndex(
      ({ operationCategory }) => operationCategory === "azure.three-vm.deploy",
    );
    [plan.steps[expiry], plan.steps[deploy]] = [
      plan.steps[deploy]!,
      plan.steps[expiry]!,
    ];
    expect(category({ ...tampered, plan })).toBe("PLAN_BINDING");
  });

  it("rejects duration beyond expiry and categorical overclaim fields", () => {
    expect(
      category(request({ learnerDurationHours: 4.1 })),
    ).toBe("EXPIRY_INVALID");
    expect(
      category({
        ...request(),
        observedBillUsd: 2.5,
      }),
    ).toBe("INPUT_INVALID");
  });

  it("is deterministic and monotonic across bounded duration and contingency properties", () => {
    let previous = 0;
    for (const learnerDurationHours of [1, 1.5, 2, 2.5, 3, 3.5, 4]) {
      for (const contingencyPercent of [0, 10, 20, 50]) {
        const input = request({
          learnerDurationHours,
          provisioningWaves: [{
            id: "parallel",
            parallelDurationsHours: [0.5, 0.5],
          }],
          startupGraceHours: 0.25,
          cleanupGraceHours: 0.25,
          contingencyPercent,
        });
        const first = compileLifecycleCostEnvelope(input);
        const second = compileLifecycleCostEnvelope(structuredClone(input));

        expect(first).toEqual(second);
        expect(first.cost.conservativeForecastUsd).toBeGreaterThanOrEqual(
          first.cost.baseForecastUsd,
        );
        if (contingencyPercent === 20) {
          expect(first.cost.conservativeForecastUsd).toBeGreaterThanOrEqual(
            previous,
          );
          previous = first.cost.conservativeForecastUsd;
        }
      }
    }
  });
});
