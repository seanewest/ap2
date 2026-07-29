import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AVD_THREE_VM_SCENARIO } from "../src/scenarios/avd-three-vm";
import {
  parseScenarioManifest,
  type ScenarioManifest,
} from "../src/scenarios/scenario-manifest";
import {
  ThreeVmLabRunner,
  type EvidenceKind,
  type EvidenceObservation,
  type EvidenceRequest,
  type JournalEntry,
  type MutationOutcome,
  type MutationRequest,
  type ReconciliationOutcome,
  type RunnerAdapters,
  type TemporaryRoleProof,
  type TemporaryRoleProofRequest,
} from "./avd-three-vm-runner";
import {
  compileAvdManifestRunnerPlan,
  type AvdManifestRunnerAdapterInput,
} from "./avd-three-vm-manifest-adapter";
import {
  canonicalAvdManifestDryRunInput,
  runCanonicalAvdManifestDryRun,
} from "./dry-run-avd-three-vm-manifest";

function input(): AvdManifestRunnerAdapterInput {
  return structuredClone(canonicalAvdManifestDryRunInput());
}

function canonicalManifest(
  change: (value: Record<string, unknown>) => void,
): ScenarioManifest {
  const value = structuredClone(
    AVD_THREE_VM_SCENARIO,
  ) as unknown as Record<string, unknown>;
  change(value);
  return parseScenarioManifest(value);
}

class FakeAdapter {
  readonly mutations: MutationRequest[] = [];
  readonly reconciliations: string[] = [];
  readonly outcomes = new Map<string, MutationOutcome>();
  readonly reconciliationOutcomes =
    new Map<string, ReconciliationOutcome>();
  readonly observations: EvidenceKind[] = [];
  terminalRoleAbsenceProofs = 0;

  async mutate(
    request: Readonly<MutationRequest>,
  ): Promise<MutationOutcome> {
    this.mutations.push({ ...request });
    return this.outcomes.get(request.operationId) ??
      (request.operationId === "roles-grant"
        ? {
            status: "succeeded",
            references: ["assignment-one", "assignment-two"],
          }
        : { status: "succeeded" });
  }

  async reconcile(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    this.reconciliations.push(request.operationId);
    const configured = this.reconciliationOutcomes.get(request.operationId);
    if (configured) return configured;
    return this.mutations.some(
        (mutation) => mutation.operationId === request.operationId,
      )
      ? { status: "desired-state" }
      : { status: "wrong-state", reason: "dry-run state remains" };
  }

  async verifyTemporaryRolesWithFreshToken(
    request: Readonly<TemporaryRoleProofRequest>,
  ): Promise<TemporaryRoleProof> {
    const revoked = this.mutations.some(
      (mutation) => mutation.operationId === "roles-revoke",
    );
    const absent = request.expectedState === "absent" && revoked;
    if (absent) this.terminalRoleAbsenceProofs += 1;
    return {
      status: "desired-state",
      completeUnpagedRead: true,
      freshTokenRoleCount: absent ? 0 : 2,
      matchingAssignmentIds: absent
        ? []
        : ["assignment-one", "assignment-two"],
      freshToken: true,
      tenantExact: true,
      actorExact: true,
      audienceExact: true,
    };
  }

  async observe(
    request: Readonly<EvidenceRequest>,
  ): Promise<EvidenceObservation> {
    this.observations.push(request.kind);
    return {
      kind: request.kind,
      state: request.kind === "learner-session"
        ? "not-observed"
        : "proven",
      observedAt: "2026-01-01T00:00:00.000Z",
      summary: request.kind === "learner-session"
        ? "not-observed"
        : "contract-satisfied",
    };
  }

  async verifyExpiry(): Promise<boolean> {
    return true;
  }

  async markerExists(): Promise<boolean> {
    return false;
  }
}

function fakeRunner(adapter = new FakeAdapter()) {
  const journal: JournalEntry[] = [];
  const plan = compileAvdManifestRunnerPlan(input());
  const adapters: RunnerAdapters = {
    azure: adapter,
    graph: adapter,
    defender: adapter,
    timer: adapter,
    filesystem: adapter,
    clock: { now: () => new Date(plan.plannedAt) },
    journal: {
      append: async (entry) => {
        journal.push(entry);
      },
    },
  };
  return {
    adapter,
    journal,
    plan,
    runner: new ThreeVmLabRunner(plan, adapters),
  };
}

describe("canonical AVD manifest to lifecycle runner adapter", () => {
  it("binds the canonical registry entry without duplicating runner values", () => {
    const request = input();
    const manifest = parseScenarioManifest(request.manifest);
    const plan = compileAvdManifestRunnerPlan(request);

    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.expiryUtc).toBe(manifest.lifecycle.expiresAt);
    expect(plan.cost.laneCeilingUsd).toBe(manifest.cost.laneMaximum);
    expect(plan.cost.billedHours).toBe(
      manifest.cost.conservativeDurationHours,
    );
    expect(plan.cost.bound.totalUsd).toBeLessThanOrEqual(
      manifest.cost.laneMaximum,
    );
    expect(plan.topology).toMatchObject({
      linuxVmCount: 2,
      vmPublicIpCount: 0,
      sharedNatGatewayCount: 1,
      sharedPublicIpCount: 1,
    });
    expect(plan.learnerSessionClaimed).toBe(false);
    expect(plan.temporaryRoles).toEqual([
      "DeviceManagementConfiguration.ReadWrite.All",
      "DeviceManagementManagedDevices.ReadWrite.All",
    ]);
    expect(plan.cleanupGraph["sensitive-remove"]).toEqual([
      "expiry-remove",
    ]);
  });

  it.each([
    [
      "quota",
      (request: AvdManifestRunnerAdapterInput) => {
        (request.readiness as { availableWindowsVmCount: number })
          .availableWindowsVmCount = 0;
      },
      /three VM roles/,
    ],
    [
      "public VM IP",
      (request: AvdManifestRunnerAdapterInput) => {
        (request.readiness as { vmPublicIpCount: number }).vmPublicIpCount = 1;
      },
      /private with explicit shared outbound/,
    ],
    [
      "missing explicit outbound",
      (request: AvdManifestRunnerAdapterInput) => {
        (request.readiness as { explicitOutbound: boolean })
          .explicitOutbound = false;
      },
      /private with explicit shared outbound/,
    ],
    [
      "permission drift",
      (request: AvdManifestRunnerAdapterInput) => {
        (request.readiness as { temporaryPermissionsExact: boolean })
          .temporaryPermissionsExact = false;
      },
      /permission/,
    ],
    [
      "expiry drift",
      (request: AvdManifestRunnerAdapterInput) => {
        (request.timing as { expiryUtc: string }).expiryUtc =
          "2026-07-29T13:46:37Z";
      },
      /caller expiry/,
    ],
  ])("refuses %s before a runner can mutate", (_name, change, pattern) => {
    const request = input();
    change(request);
    expect(() => compileAvdManifestRunnerPlan(request)).toThrow(pattern);
  });

  it("refuses manifest topology, roles, cost, retention, and learner drift", () => {
    const cases: ScenarioManifest[] = [
      canonicalManifest((value) => {
        const operations = value.operations as Array<Record<string, unknown>>;
        const deployment = operations.find(
          (operation) =>
            operation.capability === "azure.three-vm.deploy",
        )!;
        operations.push({
          ...deployment,
          key: "duplicate-three-vm-deployment",
        });
      }),
      canonicalManifest((value) => {
        const resources = value.resources as Array<Record<string, unknown>>;
        value.resources = resources.filter(
          (resource) => resource.kind !== "linux-auxiliary-pair",
        );
      }),
      canonicalManifest((value) => {
        const roles = value.roles as Record<string, unknown>;
        delete roles.responder;
      }),
      canonicalManifest((value) => {
        const cost = value.cost as Record<string, unknown>;
        cost.laneMaximum = 1;
      }),
      canonicalManifest((value) => {
        const evidence = value.evidence as {
          artifacts: Array<Record<string, unknown>>;
        };
        evidence.artifacts[0]!.retention = "ephemeral";
        const lifecycle = value.lifecycle as {
          retainedArtifacts: Array<Record<string, unknown>>;
        };
        lifecycle.retainedArtifacts =
          lifecycle.retainedArtifacts.filter(
            (item) =>
              item.artifactId !== evidence.artifacts[0]!.id,
          );
      }),
      canonicalManifest((value) => {
        const learner = value.learner as Record<string, unknown>;
        learner.completionState = "completed";
        const evidence = value.evidence as {
          artifacts: Array<Record<string, unknown>>;
        };
        for (const artifact of evidence.artifacts) {
          artifact.state = "learner-completed";
          artifact.learnerVisibility = "observed";
        }
      }),
    ];

    for (const manifest of cases) {
      const request = input();
      (request as { manifest: unknown }).manifest = manifest;
      expect(() => compileAvdManifestRunnerPlan(request)).toThrow(
        /AVD manifest adapter refused|cost bound exceeds/,
      );
    }
  });

  it("rejects raw identity, path, and sensitive fields", () => {
    const rawValues = [
      (request: AvdManifestRunnerAdapterInput) => {
        (request.scopeAliases as { tenant: string }).tenant = [
          "00000000",
          "0000",
          "0000",
          "0000",
          "000000000000",
        ].join("-");
      },
      (request: AvdManifestRunnerAdapterInput) => {
        (request.actorAliases as { learner: string }).learner =
          ["learner", "example.invalid"].join("@");
      },
      (request: AvdManifestRunnerAdapterInput) => {
        (request.timing as { runMarker: string }).runMarker =
          ["", "home", "operator", "evidence"].join("/");
      },
      (request: AvdManifestRunnerAdapterInput) => {
        (request as unknown as Record<string, unknown>).accessToken =
          "not-a-real-secret";
      },
    ];
    for (const change of rawValues) {
      const request = input();
      change(request);
      expect(() => compileAvdManifestRunnerPlan(request)).toThrow(
        /Raw identity|Sensitive runtime fields/,
      );
    }
  });
});

describe("network-free AVD manifest lifecycle path", () => {
  it("runs the canonical CLI product path with bounded sanitized output", async () => {
    await expect(runCanonicalAvdManifestDryRun()).resolves.toEqual({
      schemaVersion: 1,
      mode: "network-free-dry-run",
      scenario: "avd-three-vm-substrate",
      status: "completed",
      cloudOperations: "not-performed",
      learnerSession: "not-observed",
      mutationCount: 11,
      cleanupMutationCount: 7,
      terminalReplay: "duplicate-suppressed",
      terminalProof: "validated",
      output: "sanitized",
    });

    const result = spawnSync(
      process.execPath,
      ["scripts/dry-run-avd-three-vm-manifest-cli.ts"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "network-free-dry-run",
      status: "completed",
      cloudOperations: "not-performed",
      learnerSession: "not-observed",
      output: "sanitized",
    });
    expect(result.stdout).not.toMatch(
      /operationId|runMarker|tenant|subscription|resourceNames|journalPath|@|\/home\//,
    );
  });

  it("orders cleanup after a partial deployment failure", async () => {
    const harness = fakeRunner();
    harness.adapter.outcomes.set("compute-submit", {
      status: "failed",
      reason: "definite dry-run failure",
    });

    await expect(harness.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "compute-submit",
    });
    expect(harness.adapter.mutations.map((item) => item.operationId)).toEqual([
      "expiry-create",
      "roles-grant",
      "control-submit",
      "compute-submit",
      "defender-offboard",
      "endpoint-cleanup",
      "azure-cleanup",
      "entra-cleanup",
      "roles-revoke",
      "expiry-remove",
      "sensitive-remove",
    ]);
    expect(harness.adapter.terminalRoleAbsenceProofs).toBe(1);
  });

  it("reconciles an ambiguous one-shot without replaying it", async () => {
    const harness = fakeRunner();
    harness.adapter.outcomes.set("control-submit", {
      status: "ambiguous",
      reason: "dry-run transport ended",
    });

    await expect(harness.runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "control-submit",
    });
    await expect(
      harness.runner.reconcile("control-submit"),
    ).resolves.toMatchObject({
      status: "ready-to-resume",
      operationId: "control-submit",
    });
    await expect(harness.runner.run()).resolves.toMatchObject({
      status: "completed",
    });
    expect(
      harness.adapter.mutations.filter(
        (item) => item.operationId === "control-submit",
      ),
    ).toHaveLength(1);
    expect(harness.adapter.reconciliations).toContain("control-submit");
  });

  it("suppresses terminal replay and proves fresh-token role absence", async () => {
    const harness = fakeRunner();

    await expect(harness.runner.run()).resolves.toMatchObject({
      status: "completed",
    });
    const writes = harness.adapter.mutations.length;
    await expect(harness.runner.run()).resolves.toMatchObject({
      status: "completed",
    });
    expect(harness.adapter.mutations).toHaveLength(writes);
    expect(harness.adapter.terminalRoleAbsenceProofs).toBe(1);
    expect(
      harness.journal.every((entry) =>
        /^[a-z-]+(?::[a-z-]+)?$/.test(entry.sanitizedDetail) &&
        !/token|credential|password|response|body|@|[\\/]/i.test(
          entry.sanitizedDetail,
        )
      ),
    ).toBe(true);
  });
});
