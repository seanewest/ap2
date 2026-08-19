import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_TEMPORARY_ROLES,
  ThreeVmLabRunner,
  buildFrozenLabPlan,
  sanitizedPlanSummary,
  validateTerminalReplay,
  type EvidenceKind,
  type EvidenceObservation,
  type EvidenceRequest,
  type FrozenLabPlan,
  type JournalEntry,
  type LabScenario,
  type MutationOutcome,
  type MutationRequest,
  type ReconciliationOutcome,
  type RunnerAdapters,
  type SanitizedTerminalReplay,
  type TemporaryRoleProof,
  type TemporaryRoleProofRequest,
} from "./avd-three-vm-runner";

const FIXED_SCOPE = {
  expectedTenantId: "fixed-tenant",
  expectedSubscriptionId: "fixed-subscription",
  expectedLearner: "fixed-learner",
} as const;

function roleProof(
  changes: Pick<
    TemporaryRoleProof,
    "status" | "freshTokenRoleCount" | "matchingAssignmentIds"
  > &
    Partial<TemporaryRoleProof>,
): TemporaryRoleProof {
  return {
    completeUnpagedRead: true,
    freshToken: true,
    tenantExact: true,
    actorExact: true,
    audienceExact: true,
    ...changes,
  };
}

function scenario(
  changes: Partial<LabScenario> = {},
): LabScenario {
  return {
    runMarker: "ap2lab-20260101T000000Z-a1b2c3",
    tenantId: FIXED_SCOPE.expectedTenantId,
    subscriptionId: FIXED_SCOPE.expectedSubscriptionId,
    learner: FIXED_SCOPE.expectedLearner,
    plannedAt: "2026-01-01T00:00:00.000Z",
    readinessObservedAt: "2025-12-31T23:50:00.000Z",
    expiryUtc: "2026-01-01T08:00:00.000Z",
    learnerWindowHours: 4,
    provisioningAllowanceHours: 1,
    laneCeilingUsd: 10,
    boundedDataGb: 20,
    diskOperationsPerDisk: 100_000,
    cleanupOwner: "owner:ap2lab-20260101T000000Z-a1b2c3",
    temporaryRoles: REQUIRED_TEMPORARY_ROLES,
    windowsImage:
      "MicrosoftWindowsDesktop:windows-11:win11-24h2-ent:1.2.3",
    linuxImage: "Canonical:ubuntu-24_04-lts:server:1.2.3",
    windowsSku: "Standard_D2as_v7",
    linuxSku: "Standard_F1als_v7",
    linuxVmCount: 2,
    availableWindowsVmCount: 1,
    availableLinuxVmCount: 2,
    vmPublicIpCount: 0,
    learnerSessionClaimed: false,
    ...changes,
  };
}

class FakeAdapter {
  readonly mutations: string[] = [];
  readonly mutationRequests: MutationRequest[] = [];
  readonly reconciliations: string[] = [];
  readonly observations: EvidenceKind[] = [];
  readonly outcomes = new Map<string, MutationOutcome>();
  readonly reconciliationOutcomes =
    new Map<string, ReconciliationOutcome>();
  readonly reconciliationSequences =
    new Map<string, ReconciliationOutcome[]>();
  readonly roleProofSequences: TemporaryRoleProof[] = [];
  readonly roleProofRequests: TemporaryRoleProofRequest[] = [];
  readonly evidenceStates = new Map<
    EvidenceKind,
    EvidenceObservation["state"]
  >();
  readonly throwOnMutations = new Set<string>();
  readonly throwOnEvidence = new Set<EvidenceKind>();
  markerAlreadyExists = false;
  expiryVerified = true;

  async mutate(request: Readonly<MutationRequest>): Promise<MutationOutcome> {
    this.mutations.push(request.operationId);
    this.mutationRequests.push({ ...request });
    if (this.throwOnMutations.has(request.operationId)) {
      throw new Error("raw transport failure");
    }
    return (
      this.outcomes.get(request.operationId) ??
      (request.operationId === "roles-grant"
        ? {
            status: "succeeded",
            references: ["assignment-one", "assignment-two"],
          }
        : { status: "succeeded" })
    );
  }

  async reconcile(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    this.reconciliations.push(request.operationId);
    const sequence = this.reconciliationSequences.get(request.operationId);
    const sequenced = sequence?.shift();
    if (sequenced) {
      return sequenced;
    }
    if (
      request.desiredState === "absent" &&
      !this.mutations.includes(request.operationId)
    ) {
      return { status: "wrong-state", reason: "owned state remains" };
    }
    return (
      this.reconciliationOutcomes.get(request.operationId) ?? {
        status: "desired-state",
      }
    );
  }

  async verifyTemporaryRolesWithFreshToken(
    request: Readonly<TemporaryRoleProofRequest>,
  ): Promise<TemporaryRoleProof> {
    this.roleProofRequests.push({ ...request });
    const sequenced = this.roleProofSequences.shift();
    if (sequenced) {
      return sequenced;
    }
    if (request.expectedState === "present") {
      return roleProof({
        status: "desired-state",
        freshTokenRoleCount: 2,
        matchingAssignmentIds: ["assignment-one", "assignment-two"],
      });
    }
    const revoked = this.mutations.includes("roles-revoke");
    const grantAttempted = this.mutations.includes("roles-grant");
    const grantFailed =
      this.outcomes.get("roles-grant")?.status === "failed";
    return revoked || grantFailed || !grantAttempted
      ? roleProof({
          status: "desired-state",
          freshTokenRoleCount: 0,
          matchingAssignmentIds: [],
        })
      : roleProof({
          status: "wrong-state",
          freshTokenRoleCount: 2,
          matchingAssignmentIds: request.capturedAssignmentIds,
        });
  }

  async observe(
    request: Readonly<EvidenceRequest>,
  ): Promise<EvidenceObservation> {
    this.observations.push(request.kind);
    if (this.throwOnEvidence.has(request.kind)) {
      throw new Error("raw observation failure");
    }
    return {
      kind: request.kind,
      state:
        this.evidenceStates.get(request.kind) ??
        (request.kind === "learner-session" ? "not-observed" : "proven"),
      observedAt: "2026-01-01T00:20:00.000Z",
      summary:
        request.kind === "learner-session"
          ? "not-observed"
          : "contract-satisfied",
    };
  }

  async verifyExpiry(): Promise<boolean> {
    return this.expiryVerified;
  }

  async markerExists(): Promise<boolean> {
    return this.markerAlreadyExists;
  }
}

function fakeRunner(
  plan = buildFrozenLabPlan(scenario(), FIXED_SCOPE),
): {
  runner: ThreeVmLabRunner;
  adapter: FakeAdapter;
  journal: JournalEntry[];
} {
  const adapter = new FakeAdapter();
  const journal: JournalEntry[] = [];
  const adapters: RunnerAdapters = {
    azure: adapter,
    graph: adapter,
    defender: adapter,
    timer: adapter,
    filesystem: adapter,
    clock: { now: () => new Date("2026-01-01T00:00:01.000Z") },
    journal: {
      append: async (entry) => {
        journal.push(entry);
      },
    },
  };
  return {
    runner: new ThreeVmLabRunner(plan, adapters),
    adapter,
    journal,
  };
}

describe("three-VM AVD plan validation", () => {
  it("freezes marker-derived names, dependencies, cost, ownership, and cleanup", () => {
    const plan = buildFrozenLabPlan(scenario(), FIXED_SCOPE);

    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.resourceNames.resourceGroup).toBe("ap2l-a1b2c3-rg");
    expect(plan.cost.bound.totalUsd).toBe(4.56863014);
    expect(plan.phaseDependencies.compute).toEqual(["control"]);
    expect(plan.readinessGroups[1]).toEqual([
      "avd-availability",
      "intune-compliance",
      "defender-onboarding",
      "private-probes",
      "learner-session",
    ]);
    expect(plan.cleanupGraph["sensitive-remove"]).toEqual(["expiry-remove"]);
    expect(
      plan.mutations.every(
        (item) =>
          item.owner === "owner:ap2lab-20260101T000000Z-a1b2c3",
      ),
    ).toBe(true);
  });

  it.each([
    ["wrong tenant", { tenantId: "wrong" }, /tenant/],
    ["wrong subscription", { subscriptionId: "wrong" }, /subscription/],
    ["wrong learner", { learner: "wrong" }, /learner/],
    ["malformed marker", { runMarker: "bad" }, /marker/],
    ["missing expiry", { expiryUtc: "" }, /expiry/],
    [
      "stale readiness",
      { readinessObservedAt: "2025-12-31T20:00:00.000Z" },
      /readiness/,
    ],
    ["public VM IP", { vmPublicIpCount: 1 as 0 }, /public IP/],
    [
      "unsupported image",
      { linuxImage: "Unsupported:linux:image:version" },
      /image/,
    ],
    [
      "unsupported SKU",
      { linuxSku: "Unsupported" as "Standard_F1als_v7" },
      /SKU/,
    ],
    ["missing cleanup owner", { cleanupOwner: "" }, /cleanup owner/],
    [
      "insufficient quota",
      { availableLinuxVmCount: 1 },
      /quota/,
    ],
    [
      "learner-session overclaim",
      { learnerSessionClaimed: true },
      /learner session/,
    ],
    [
      "insufficient permissions",
      { temporaryRoles: [REQUIRED_TEMPORARY_ROLES[0]] },
      /exact two/,
    ],
    [
      "redundant permissions",
      {
        temporaryRoles: [
          ...REQUIRED_TEMPORARY_ROLES,
          REQUIRED_TEMPORARY_ROLES[0],
        ],
      },
      /duplicated/,
    ],
  ])("rejects %s", (_name, changes, expected) => {
    expect(() =>
      buildFrozenLabPlan(
        scenario(changes as Partial<LabScenario>),
        FIXED_SCOPE,
      ),
    ).toThrow(expected as RegExp);
  });

  it("rejects a reused marker and a cost above the lane ceiling", () => {
    const input = scenario();
    expect(() =>
      buildFrozenLabPlan(input, {
        ...FIXED_SCOPE,
        existingMarkers: new Set([input.runMarker]),
      }),
    ).toThrow(/already been used/);
    expect(() =>
      buildFrozenLabPlan(scenario({ laneCeilingUsd: 4 }), FIXED_SCOPE),
    ).toThrow(/cost bound exceeds/);
  });

  it("sanitizes fixed scope identities out of dry-run output", () => {
    const summary = JSON.stringify(
      sanitizedPlanSummary(buildFrozenLabPlan(scenario(), FIXED_SCOPE)),
    );

    expect(summary).not.toContain(FIXED_SCOPE.expectedTenantId);
    expect(summary).not.toContain(FIXED_SCOPE.expectedSubscriptionId);
    expect(summary).not.toContain(FIXED_SCOPE.expectedLearner);
    expect(summary).toContain('"tenant":"fixed-contract"');
    expect(summary).not.toMatch(/\/home\//);
    expect(summary).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(summary).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});

describe("three-VM AVD lifecycle runner", () => {
  it("verifies expiry before billable work, separates evidence, and cleans in order", async () => {
    const { runner, adapter, journal } = fakeRunner();

    const result = await runner.run();

    expect(result.status).toBe("completed");
    expect(adapter.mutations).toEqual([
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
    expect(adapter.observations).toEqual([
      "arm-completion",
      "avd-availability",
      "intune-compliance",
      "defender-onboarding",
      "private-probes",
      "learner-session",
    ]);
    expect(result.evidence.at(-1)).toMatchObject({
      kind: "learner-session",
      state: "not-observed",
    });
    for (const operationId of adapter.mutations) {
      const entries = journal.filter((entry) => entry.operationId === operationId);
      expect(entries.map((entry) => entry.transition)).toEqual(
        operationId === "expiry-create" ||
          operationId === "control-submit" ||
          operationId === "compute-submit"
          ? ["intent", "succeeded"]
          : operationId === "roles-grant"
            ? ["intent", "succeeded", "reconciled"]
            : [
                "reconciliation-blocked",
                "intent",
                "succeeded",
                "reconciled",
              ],
      );
    }
    for (const operationId of [
      "defender-offboard",
      "endpoint-cleanup",
      "azure-cleanup",
      "entra-cleanup",
      "expiry-remove",
      "sensitive-remove",
    ]) {
      expect(
        adapter.reconciliations.filter((item) => item === operationId),
      ).toHaveLength(2);
    }
    expect(adapter.roleProofRequests.map((item) => item.expectedState)).toEqual(
      ["present", "absent", "absent"],
    );
    expect(adapter.roleProofRequests.at(-1)).toMatchObject({
      capturedAssignmentIds: ["assignment-one", "assignment-two"],
    });
  });

  it("stops before billable submission when expiry verification fails", async () => {
    const { runner, adapter } = fakeRunner();
    adapter.expiryVerified = false;

    await expect(runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "expiry-verification",
    });
    expect(adapter.mutations).not.toContain("control-submit");
    expect(adapter.mutations).not.toContain("compute-submit");
    expect(adapter.mutations).toContain("expiry-remove");
  });

  it("cleans owned state after compute or readiness failure", async () => {
    const computeFailure = fakeRunner();
    computeFailure.adapter.outcomes.set("compute-submit", {
      status: "failed",
      reason: "definite deployment failure",
    });
    await expect(computeFailure.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "compute-submit",
    });
    expect(computeFailure.adapter.mutations).toContain("azure-cleanup");
    expect(computeFailure.adapter.mutations).toContain("roles-revoke");
    expect(computeFailure.adapter.mutations.at(-1)).toBe("sensitive-remove");

    const readinessFailure = fakeRunner();
    readinessFailure.adapter.throwOnEvidence.add("intune-compliance");
    await expect(readinessFailure.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "readiness",
    });
    expect(readinessFailure.adapter.mutations.at(-1)).toBe("sensitive-remove");
  });

  it("never copies raw adapter failures into the journal", async () => {
    const failed = fakeRunner();
    const privatePath = ["/", "home", "example"].join("/");
    failed.adapter.outcomes.set("control-submit", {
      status: "failed",
      reason: `private ${privatePath} path and raw platform response`,
    });

    await failed.runner.run();

    const serialized = JSON.stringify(failed.journal);
    expect(serialized).not.toContain(privatePath);
    expect(serialized).not.toContain("raw platform response");
    expect(serialized).toContain("definite-failure");
  });

  it("journals ambiguity, never replays it, and resumes only after exact reconciliation", async () => {
    const { runner, adapter, journal } = fakeRunner();
    adapter.outcomes.set("compute-submit", {
      status: "ambiguous",
      reason: "transport ended",
    });

    await expect(runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "compute-submit",
    });
    await expect(runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "compute-submit",
    });
    expect(adapter.mutations.filter((item) => item === "compute-submit")).toHaveLength(1);

    await expect(runner.reconcile("compute-submit")).resolves.toMatchObject({
      status: "ready-to-resume",
    });
    await expect(runner.run()).resolves.toMatchObject({ status: "completed" });
    expect(
      adapter.reconciliations.filter((item) => item === "compute-submit"),
    ).toEqual(["compute-submit"]);
    expect(
      journal
        .filter((entry) => entry.operationId === "compute-submit")
        .map((entry) => entry.transition),
    ).toEqual(["intent", "ambiguous", "reconciled"]);
  });

  it("normalizes thrown mutations to categorical ambiguity without replay", async () => {
    const thrown = fakeRunner();
    thrown.adapter.throwOnMutations.add("control-submit");

    await expect(thrown.runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "control-submit",
    });
    await expect(thrown.runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "control-submit",
    });
    expect(
      thrown.adapter.mutations.filter((item) => item === "control-submit"),
    ).toHaveLength(1);
    expect(
      thrown.journal
        .filter((entry) => entry.operationId === "control-submit")
        .map((entry) => entry.sanitizedDetail),
    ).toEqual(["azure:deploy-control-plane", "requires-exact-read"]);
  });

  it("cleans after ambiguous compute reconciliation proves non-convergence", async () => {
    const uncertain = fakeRunner();
    uncertain.adapter.outcomes.set("compute-submit", {
      status: "ambiguous",
      reason: "transport ended",
    });
    uncertain.adapter.reconciliationOutcomes.set("compute-submit", {
      status: "wrong-state",
      reason: "exact deployment read did not converge",
    });

    await expect(uncertain.runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "compute-submit",
    });
    await expect(
      uncertain.runner.reconcile("compute-submit"),
    ).resolves.toMatchObject({
      status: "ready-to-resume",
      operationId: "compute-submit-reconciliation",
    });
    await expect(uncertain.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "compute-submit-reconciliation",
    });
    expect(
      uncertain.adapter.mutations.filter(
        (item) => item === "compute-submit",
      ),
    ).toHaveLength(1);
    expect(uncertain.adapter.mutations.at(-1)).toBe("sensitive-remove");
  });

  it("removes an ambiguously created expiry when exact verification fails", async () => {
    const uncertain = fakeRunner();
    uncertain.adapter.outcomes.set("expiry-create", {
      status: "ambiguous",
      reason: "transport ended",
    });
    uncertain.adapter.expiryVerified = false;

    await expect(uncertain.runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "expiry-create",
    });
    await expect(
      uncertain.runner.reconcile("expiry-create"),
    ).resolves.toMatchObject({
      status: "ready-to-resume",
      operationId: "expiry-verification",
    });
    await expect(uncertain.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "expiry-verification",
    });
    expect(uncertain.adapter.mutations).toContain("expiry-remove");
    expect(
      uncertain.adapter.mutations.filter(
        (item) => item === "expiry-create",
      ),
    ).toHaveLength(1);
  });

  it("waits on incomplete propagation reads without replay and caps them at three", async () => {
    const delayed = fakeRunner();
    delayed.adapter.roleProofSequences.push(
      roleProof({
        status: "incomplete",
        completeUnpagedRead: false,
        freshTokenRoleCount: 0,
        matchingAssignmentIds: [],
      }),
      roleProof({
        status: "desired-state",
        freshTokenRoleCount: 2,
        matchingAssignmentIds: ["assignment-one", "assignment-two"],
      }),
    );

    await expect(delayed.runner.run()).resolves.toMatchObject({
      status: "blocked-reconciliation",
      operationId: "roles-grant",
    });
    await expect(
      delayed.runner.reconcile("roles-grant"),
    ).resolves.toMatchObject({ status: "ready-to-resume" });
    await expect(delayed.runner.run()).resolves.toMatchObject({
      status: "completed",
    });
    expect(
      delayed.adapter.mutations.filter((item) => item === "roles-grant"),
    ).toHaveLength(1);

    const exhausted = fakeRunner();
    exhausted.adapter.roleProofSequences.push(
      ...Array.from({ length: 3 }, () => roleProof({
        status: "incomplete" as const,
        completeUnpagedRead: false,
        freshTokenRoleCount: 0,
        matchingAssignmentIds: [],
      })),
    );
    await expect(exhausted.runner.run()).resolves.toMatchObject({
      status: "blocked-reconciliation",
    });
    await expect(
      exhausted.runner.reconcile("roles-grant"),
    ).resolves.toMatchObject({ status: "blocked-reconciliation" });
    await expect(
      exhausted.runner.reconcile("roles-grant"),
    ).resolves.toMatchObject({ status: "ready-to-resume" });
    await expect(exhausted.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "roles-grant-reconciliation",
    });
    expect(
      exhausted.adapter.mutations.filter((item) => item === "roles-grant"),
    ).toHaveLength(1);
  });

  it("refuses marker reuse and cleanup of an unowned target", async () => {
    const reused = fakeRunner();
    reused.adapter.markerAlreadyExists = true;
    await expect(reused.runner.run()).resolves.toMatchObject({
      status: "failed",
      operationId: "marker-reuse",
    });
    expect(reused.adapter.mutations).toEqual([]);

    const plan = structuredClone(
      buildFrozenLabPlan(scenario(), FIXED_SCOPE),
    ) as FrozenLabPlan;
    const target = plan.mutations.find(
      (item) => item.operationId === "defender-offboard",
    );
    expect(target).toBeDefined();
    Object.assign(target as MutationRequest, { owner: "unrelated-owner" });
    const unowned = fakeRunner(plan);
    await expect(unowned.runner.run()).rejects.toThrow(/unowned target/);
    expect(unowned.adapter.mutations).not.toContain("defender-offboard");
  });

  it("requires captured assignments, complete reads, and fresh-token role absence", async () => {
    const malformedGrant = fakeRunner();
    malformedGrant.adapter.outcomes.set("roles-grant", {
      status: "succeeded",
      references: ["only-one-assignment"],
    });
    malformedGrant.adapter.roleProofSequences.push(
      roleProof({
        status: "wrong-state",
        freshTokenRoleCount: 0,
        matchingAssignmentIds: [],
      }),
      roleProof({
        status: "wrong-state",
        freshTokenRoleCount: 2,
        matchingAssignmentIds: ["discovered-one", "discovered-two"],
      }),
      roleProof({
        status: "desired-state",
        freshTokenRoleCount: 0,
        matchingAssignmentIds: [],
      }),
    );
    await expect(malformedGrant.runner.run()).resolves.toMatchObject({
      status: "blocked-ambiguous",
      operationId: "roles-grant",
    });
    await expect(
      malformedGrant.runner.reconcile("roles-grant"),
    ).resolves.toMatchObject({ status: "ready-to-resume" });
    await expect(malformedGrant.runner.run()).resolves.toMatchObject({
      status: "cleaned-after-failure",
      operationId: "roles-grant-reconciliation",
    });
    const revokeRequest = malformedGrant.adapter.roleProofRequests.find(
      (request) => request.expectedState === "absent",
    );
    expect(revokeRequest).toBeDefined();
    expect(
      malformedGrant.adapter.mutations.filter(
        (item) => item === "roles-revoke",
      ),
    ).toHaveLength(1);
    expect(
      malformedGrant.adapter.mutationRequests.find(
        (request) => request.operationId === "roles-revoke",
      )?.capturedAssignmentIds,
    ).toEqual(["discovered-one", "discovered-two"]);

    const staleToken = fakeRunner();
    staleToken.adapter.roleProofSequences.push(
      roleProof({
        status: "desired-state",
        freshTokenRoleCount: 2,
        matchingAssignmentIds: ["assignment-one", "assignment-two"],
      }),
      roleProof({
        status: "wrong-state",
        freshTokenRoleCount: 2,
        matchingAssignmentIds: ["assignment-one", "assignment-two"],
      }),
      roleProof({
        status: "desired-state",
        freshTokenRoleCount: 1,
        matchingAssignmentIds: [],
      }),
    );
    await expect(staleToken.runner.run()).resolves.toMatchObject({
      status: "failed",
      operationId: "roles-revoke-verification",
    });
  });
});

describe("sanitized protected-run replay", () => {
  it("proves terminal cleanup and the observed upper bound without protected IDs", () => {
    const fixturePath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "fixtures",
      "avd-three-vm-completed-run.json",
    );
    const raw = fs.readFileSync(fixturePath, "utf8");
    const replay = JSON.parse(raw) as SanitizedTerminalReplay;

    expect(() => validateTerminalReplay(replay)).not.toThrow();
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(raw).not.toContain('"runMarker"');
    expect(raw).not.toMatch(/\/home\//);
    expect(raw).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });

  it("rejects learner overclaim, incomplete cleanup, and changed cost", () => {
    const complete: SanitizedTerminalReplay = {
      schemaVersion: 1,
      learnerSessionObserved: false,
      observedUpperBoundUsd: 3.07872603,
      evidence: {
        "arm-completion": "proven",
        "avd-availability": "proven",
        "intune-compliance": "proven",
        "defender-onboarding": "proven",
        "private-probes": "proven",
        "learner-session": "not-observed",
      },
      cleanup: {
        defenderOffboardedWhileHostAlive: true,
        endpointStateAbsent: true,
        azureStateAbsent: true,
        entraStateAbsent: true,
        temporaryRolesAbsentWithFreshToken: true,
        expiryAbsent: true,
        sensitiveArtifactsAbsent: true,
      },
    };
    expect(() =>
      validateTerminalReplay({
        ...complete,
        observedUpperBoundUsd: 3,
      }),
    ).toThrow(/cost/);
    expect(() =>
      validateTerminalReplay({
        ...complete,
        cleanup: { ...complete.cleanup, azureStateAbsent: false },
      }),
    ).toThrow(/not terminally cleaned/);
    expect(() =>
      validateTerminalReplay({
        ...complete,
        learnerSessionObserved: true,
        evidence: { ...complete.evidence, "learner-session": "proven" },
      } as unknown as SanitizedTerminalReplay),
    ).toThrow(/learner session/);
  });
});
