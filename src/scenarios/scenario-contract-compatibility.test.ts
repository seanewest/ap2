// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { OperationTelemetryEvent } from "../../api/operation-telemetry.ts";
import { canonicalAvdManifestDryRunInput } from "../../scripts/dry-run-avd-three-vm-manifest.ts";
import {
  CANONICAL_RECEIPT_FIXTURES,
  NEGATIVE_RECEIPT_FIXTURES,
} from "./scenario-evidence-receipt.fixtures.ts";
import type { ScenarioManifest } from "./scenario-manifest.ts";
import {
  compileScenarioExecutionPlan,
  type ScenarioExecutionPlan,
} from "./scenario-plan.ts";
import { SCENARIO_MANIFESTS } from "./scenarios.ts";
import {
  checkScenarioContractCompatibility,
  formatScenarioCompatibilityMatrix,
  type CompatibilityCheckOptions,
  type CompatibilityDriftCategory,
  type CompatibilityTelemetryBinding,
} from "./scenario-contract-compatibility.ts";

const HASH = ["m1", "0123456789abcdef01234567"].join("_");
const OTHER_HASH = ["m1", "89abcdef0123456701234567"].join("_");
const supportedManifests = SCENARIO_MANIFESTS;
const supportedIds = new Set(supportedManifests.map(({ id }) => id));
const supportedReceipts = CANONICAL_RECEIPT_FIXTURES.filter(
  ({ manifest }) => supportedIds.has(manifest.id),
);

type PlanSet = NonNullable<
  CompatibilityCheckOptions["planOverrides"]
> extends ReadonlyMap<string, infer Value> ? Value : never;

function plans(manifest: ScenarioManifest): PlanSet {
  const aliasByActor = new Map(
    manifest.actors.map((actor, index) => [
      actor.id,
      `actor-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const actors = {
    evidenceProducer: manifest.roles.evidenceProducer,
    workloadActor: manifest.roles.workloadActor,
    learner: manifest.roles.learner,
    detector: manifest.roles.detector,
    responder: manifest.roles.responder,
    cleanupOwner: manifest.lifecycle.cleanupOwnerActorId,
  };
  const actorAliases = Object.fromEntries(
    Object.entries(actors)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([role, actorId]) => [role, aliasByActor.get(actorId)!]),
  );
  const expiresAt = manifest.lifecycle.expiresAt;
  const now = new Date(
    Date.parse(expiresAt) -
      manifest.cost.conservativeDurationHours * 3_600_000,
  ).toISOString();
  const request = {
    scenarioId: manifest.id,
    actorAliases,
    now,
    expiresAt,
    maximumBudgetUsd: manifest.cost.laneMaximum,
  };
  const base = compileScenarioExecutionPlan(request, [manifest]);
  return {
    base,
    responses: new Map(
      manifest.responseActions.map((response) => [
        response.id,
        compileScenarioExecutionPlan(
          { ...request, selectedResponseId: response.id },
          [manifest],
        ),
      ]),
    ),
  };
}

function mutablePlanSet(manifest: ScenarioManifest): {
  base: ScenarioExecutionPlan;
  responses: Map<string, ScenarioExecutionPlan>;
} {
  return structuredClone(plans(manifest)) as {
    base: ScenarioExecutionPlan;
    responses: Map<string, ScenarioExecutionPlan>;
  };
}

function fixture(manifest: ScenarioManifest) {
  return supportedReceipts.filter(
    (candidate) => candidate.manifest.id === manifest.id,
  );
}

function checkOne(
  manifest: ScenarioManifest,
  options: Omit<CompatibilityCheckOptions, "catalog" | "receiptFixtures"> = {},
) {
  return checkScenarioContractCompatibility({
    catalog: [manifest],
    receiptFixtures: fixture(manifest),
    ...options,
  });
}

function categories(
  result: ReturnType<typeof checkScenarioContractCompatibility>,
): CompatibilityDriftCategory[] {
  return result.failures.map(({ category }) => category);
}

function rawManifest(
  manifest: ScenarioManifest,
  change: (value: Record<string, unknown>) => void,
): unknown {
  const value = structuredClone(manifest) as unknown as Record<string, unknown>;
  change(value);
  return value;
}

function telemetryEvent(
  operationKind: OperationTelemetryEvent["operationKind"],
  phase: OperationTelemetryEvent["phase"],
  outcome: OperationTelemetryEvent["outcome"],
  markerHash = HASH,
): OperationTelemetryEvent {
  return {
    schemaVersion: 1,
    markerHash,
    operationKind,
    phase,
    outcome,
    durationMs: outcome === "started" ? 0 : 4,
    reason: outcome === "started" || outcome === "succeeded"
      ? "none"
      : "upstream-refusal",
    ambiguityState: "none",
    recoveryState: outcome === "started" ? "not-applicable" : "not-needed",
  };
}

function telemetryBinding(
  manifest: ScenarioManifest,
  mixed = false,
): CompatibilityTelemetryBinding {
  return {
    scenarioId: manifest.id,
    snapshot: {
      schemaVersion: 1,
      order: "oldest",
      events: [
        telemetryEvent("calendar.create", "execution", "started"),
        telemetryEvent("calendar.create", "execution", "succeeded"),
        ...(mixed
          ? [
            telemetryEvent(
              "calendar.cancel",
              "cleanup",
              "started",
              OTHER_HASH,
            ),
            telemetryEvent(
              "calendar.cancel",
              "cleanup",
              "succeeded",
              OTHER_HASH,
            ),
          ]
          : []),
      ],
    },
    contract: {
      schemaVersion: 1,
      scenarioId: manifest.id,
      roles: {
        evidenceProducer: manifest.roles.evidenceProducer,
        workloadActor: manifest.roles.workloadActor,
        learner: manifest.roles.learner,
      },
      operations: [
        {
          operationKind: "calendar.create",
          phase: "execution",
          manifestOperationKey: "send-help-desk-email",
          observerRole: "evidenceProducer",
        },
        ...(mixed
          ? [{
            operationKind: "calendar.cancel" as const,
            phase: "cleanup" as const,
            manifestOperationKey: "delete-help-desk-email",
            observerRole: "evidenceProducer" as const,
          }]
          : []),
      ],
    },
  };
}

describe("scenario contract compatibility checker", () => {
  it("passes every canonical scenario deterministically", () => {
    const first = checkScenarioContractCompatibility();
    const second = checkScenarioContractCompatibility();

    expect(second).toEqual(first);
    expect(first.status).toBe("compatible");
    expect(first.scenarios.map(({ scenarioId }) => scenarioId)).toEqual(
      [...SCENARIO_MANIFESTS.map(({ id }) => id)].sort(),
    );
    expect(first.failures).toEqual([]);
    expect(
      first.scenarios.find(
        ({ scenarioId }) => scenarioId === "private-document-evidence",
      )?.adapters,
    ).toEqual(["private-document"]);
  });

  it("passes the explicit canonical fixture set", () => {
    const result = checkScenarioContractCompatibility({
      catalog: supportedManifests,
      receiptFixtures: supportedReceipts,
    });

    expect(result.status).toBe("compatible");
    expect(result.failures).toEqual([]);
    expect(result.scenarios).toHaveLength(supportedManifests.length);
    expect(
      result.scenarios.find(
        ({ scenarioId }) => scenarioId === "avd-three-vm-substrate",
      )?.adapters,
    ).toEqual(["avd-manifest"]);
  });

  it("emits only bounded public IDs, counts, categories, and adapter names", () => {
    const serialized = formatScenarioCompatibilityMatrix(
      checkScenarioContractCompatibility(),
    );

    expect(serialized).not.toContain(HASH);
    for (const manifest of SCENARIO_MANIFESTS) {
      for (const actor of manifest.actors) {
        expect(serialized).not.toContain(actor.id);
      }
      for (const operation of manifest.operations) {
        expect(serialized).not.toContain(operation.key);
        expect(serialized).not.toContain(operation.marker ?? "never-present");
      }
      for (const artifact of manifest.evidence.artifacts) {
        expect(serialized).not.toContain(artifact.observation?.proofReference ??
          "never-present");
      }
    }
    expect(JSON.parse(serialized)).toEqual(
      checkScenarioContractCompatibility(),
    );
  });

  it.each([
    [
      "missing role",
      (value: Record<string, unknown>) => {
        delete (value.roles as Record<string, unknown>).learner;
      },
    ],
    [
      "extra role",
      (value: Record<string, unknown>) => {
        (value.roles as Record<string, unknown>).extra = "actor";
      },
    ],
    [
      "conflated role",
      (value: Record<string, unknown>) => {
        const roles = value.roles as Record<string, unknown>;
        roles.evidenceProducer = roles.learner;
      },
    ],
  ])("pinpoints %s as role drift", (_name, change) => {
    const manifest = supportedManifests[1]!;
    const result = checkScenarioContractCompatibility({
      catalog: [rawManifest(manifest, change)],
      receiptFixtures: [],
    });
    expect(categories(result)).toEqual(["ROLE_DRIFT"]);
  });

  it("pinpoints operation ownership and unknown plan operations", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "help-desk-email-observation",
    )!;
    const ownership = rawManifest(manifest, (value) => {
      const operations = value.operations as Array<Record<string, unknown>>;
      operations.find(({ key }) => key === "send-help-desk-email")!
        .ownerActorId = manifest.roles.learner;
    });
    expect(categories(checkScenarioContractCompatibility({
      catalog: [ownership],
      receiptFixtures: fixture(manifest),
    }))).toContain("OPERATION_DRIFT");

    const changed = mutablePlanSet(manifest);
    const extra = structuredClone(changed.base.steps.at(-1)!);
    (extra as { sequence: number }).sequence = changed.base.steps.length + 1;
    Object.assign(extra, {
      phase: "producer-operation",
      operationKey: "unknown-operation",
    });
    (changed.base as unknown as { steps: unknown[] }).steps.push(extra);
    expect(categories(checkOne(manifest, {
      planOverrides: new Map([[manifest.id, changed]]),
    }))).toEqual(["OPERATION_DRIFT"]);
  });

  it("pinpoints plan phase, evidence, learner, and response drift", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "help-desk-email-observation",
    )!;

    const phase = mutablePlanSet(manifest);
    const operation = phase.base.steps.find(
      ({ operationKey }) => operationKey === "send-help-desk-email",
    )!;
    (operation as { phase: string }).phase = "cleanup";
    expect(categories(checkOne(manifest, {
      planOverrides: new Map([[manifest.id, phase]]),
    }))).toEqual(["PLAN_PHASE_DRIFT"]);

    const evidence = mutablePlanSet(manifest);
    const evidenceStep = evidence.base.steps.find(
      ({ phase }) => phase === "authentic-evidence",
    )!;
    (evidenceStep.evidenceExpectation as { artifactKind: string })
      .artifactKind = "mismatched-kind";
    expect(categories(checkOne(manifest, {
      planOverrides: new Map([[manifest.id, evidence]]),
    }))).toEqual(["EVIDENCE_DRIFT"]);

    const learner = mutablePlanSet(manifest);
    const learnerStep = learner.base.steps.find(
      ({ phase }) => phase === "learner-interpretation",
    )!;
    (learnerStep as { owningRole: string }).owningRole = "system";
    expect(categories(checkOne(manifest, {
      planOverrides: new Map([[manifest.id, learner]]),
    }))).toEqual(["LEARNER_DRIFT"]);

    const response = mutablePlanSet(manifest);
    const responsePlan = response.responses.values().next().value!;
    (responsePlan as { selectedResponseId: string | null })
      .selectedResponseId = null;
    expect(categories(checkOne(manifest, {
      planOverrides: new Map([[manifest.id, response]]),
    }))).toEqual(["RESPONSE_DRIFT"]);
  });

  it("never reports fields from an invalid plan override", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "help-desk-email-observation",
    )!;
    const invalid = mutablePlanSet(manifest);
    (invalid.base.steps[0] as { phase: string }).phase =
      "credential-secret-phase";

    const result = checkOne(manifest, {
      planOverrides: new Map([[manifest.id, invalid]]),
    });
    const serialized = formatScenarioCompatibilityMatrix(result);

    expect(categories(result)).toEqual(["PLAN_PHASE_DRIFT"]);
    expect(result.scenarios[0]?.planStepCount).toBe(0);
    expect(result.scenarios[0]?.planPhases).toEqual([]);
    expect(serialized).not.toContain("credential-secret-phase");

    const malformed = mutablePlanSet(manifest);
    (malformed.base as unknown as { steps: unknown }).steps = null;
    expect(() =>
      checkOne(manifest, {
        planOverrides: new Map([[manifest.id, malformed]]),
      })
    ).not.toThrow();
  });

  it("pinpoints cleanup, retention, cost, and expiry contradictions", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "help-desk-email-observation",
    )!;
    const cases: Array<[CompatibilityDriftCategory, unknown]> = [
      [
        "CLEANUP_DRIFT",
        rawManifest(manifest, (value) => {
          (value.lifecycle as { cleanupOperationKeys: string[] })
            .cleanupOperationKeys = [];
        }),
      ],
      [
        "RETENTION_DRIFT",
        rawManifest(manifest, (value) => {
          delete (
            value.lifecycle as {
              retainedArtifacts: Array<Record<string, unknown>>;
            }
          ).retainedArtifacts[0]!.cleanupOperationKey;
        }),
      ],
      [
        "COST_DRIFT",
        rawManifest(manifest, (value) => {
          (value.cost as { laneMaximum: number }).laneMaximum = -1;
        }),
      ],
      [
        "EXPIRY_DRIFT",
        rawManifest(manifest, (value) => {
          (value.lifecycle as { expiresAt: string }).expiresAt =
            "not-a-timestamp";
        }),
      ],
    ];
    for (const [expected, value] of cases) {
      expect(categories(checkScenarioContractCompatibility({
        catalog: [value],
        receiptFixtures: [],
      }))).toEqual([expected]);
    }
  });

  it("rejects learner evidence mismatch and unsupported response", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "help-desk-email-observation",
    )!;
    const learner = rawManifest(manifest, (value) => {
      (value.learner as { evidenceArtifactIds: string[] })
        .evidenceArtifactIds = ["missing-artifact"];
    });
    expect(categories(checkScenarioContractCompatibility({
      catalog: [learner],
      receiptFixtures: [],
    }))).toEqual(["LEARNER_DRIFT"]);

    const response = rawManifest(manifest, (value) => {
      (value.responseActions as Array<Record<string, unknown>>)[0]!
        .operationKey = "missing-operation";
    });
    expect(categories(checkScenarioContractCompatibility({
      catalog: [response],
      receiptFixtures: [],
    }))).toEqual(["RESPONSE_DRIFT"]);
  });

  it("rejects receipt overclaim and raw identifier contamination", () => {
    const negative = NEGATIVE_RECEIPT_FIXTURES.find(
      ({ name }) => name === "human-call-does-not-prove-automation",
    )!;
    expect(categories(checkScenarioContractCompatibility({
      catalog: [negative.manifest],
      receiptFixtures: [negative],
    }))).toEqual(["RECEIPT_OVERCLAIM_DRIFT"]);

    const manifest = supportedManifests[0]!;
    const raw = rawManifest(manifest, (value) => {
      value.id = ["learner", "example.invalid"].join("@");
    });
    expect(categories(checkScenarioContractCompatibility({
      catalog: [raw],
      receiptFixtures: [],
    }))).toEqual(["RAW_IDENTIFIER_DRIFT"]);
  });

  it("uses the AVD adapter only for AVD and rejects readiness drift", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "avd-three-vm-substrate",
    )!;
    const input = canonicalAvdManifestDryRunInput();
    (input.readiness as { availableWindowsVmCount: number })
      .availableWindowsVmCount = 0;
    const result = checkOne(manifest, { avdInput: input });

    expect(categories(result)).toEqual(["AVD_ADAPTER_DRIFT"]);
    expect(
      checkOne(
        supportedManifests.find(
          ({ id }) => id === "help-desk-email-observation",
        )!,
      ).scenarios[0]?.adapters,
    ).toEqual([]);
  });

  it("uses the private-document adapter only for its canonical fixture", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "private-document-evidence",
    )!;
    const result = checkOne(manifest, {
      privateDocumentInput: {} as never,
    });

    expect(categories(result)).toEqual(["RECEIPT_COVERAGE_DRIFT"]);
    expect(result.scenarios[0]?.adapters).toEqual([]);
  });

  it("accepts only coherent supported telemetry mappings", () => {
    const manifest = supportedManifests.find(
      ({ id }) => id === "help-desk-email-observation",
    )!;
    const accepted = checkOne(manifest, {
      telemetryBindings: [telemetryBinding(manifest)],
    });
    expect(accepted.status).toBe("compatible");
    expect(accepted.scenarios[0]?.adapters).toEqual([
      "operation-telemetry",
    ]);

    const gap = telemetryBinding(manifest);
    (
      gap.contract.operations[0] as {
        manifestOperationKey: string;
      }
    ).manifestOperationKey = "missing-operation";
    expect(categories(checkOne(manifest, {
      telemetryBindings: [gap],
    }))).toEqual(["TELEMETRY_MAPPING_DRIFT"]);

    expect(categories(checkOne(manifest, {
      telemetryBindings: [telemetryBinding(manifest, true)],
    }))).toEqual(["TELEMETRY_MAPPING_DRIFT"]);
  });

  it("bounds catalog and failure output", () => {
    const result = checkScenarioContractCompatibility({
      catalog: Array.from({ length: 33 }, () => supportedManifests[0]),
      receiptFixtures: [],
    });
    expect(result).toEqual({
      schemaVersion: 1,
      status: "drift",
      scenarios: [],
      failures: [{ scenarioId: "unknown", category: "BOUNDS_DRIFT" }],
    });
  });
});
