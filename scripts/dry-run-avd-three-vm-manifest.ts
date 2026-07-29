import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AVD_THREE_VM_SCENARIO } from "../src/scenarios/avd-three-vm.ts";
import { SCENARIO_MANIFESTS } from "../src/scenarios/scenarios.ts";
import {
  ThreeVmLabRunner,
  validateTerminalReplay,
  type EvidenceObservation,
  type EvidenceRequest,
  type JournalEntry,
  type MutationOutcome,
  type MutationRequest,
  type ReconciliationOutcome,
  type RunnerAdapters,
  type SanitizedTerminalReplay,
  type TemporaryRoleProof,
  type TemporaryRoleProofRequest,
} from "./avd-three-vm-runner.ts";
import {
  compileAvdManifestRunnerPlan,
  type AvdManifestRunnerAdapterInput,
} from "./avd-three-vm-manifest-adapter.ts";

export interface AvdManifestDryRunSummary {
  schemaVersion: 1;
  mode: "network-free-dry-run";
  scenario: "avd-three-vm-substrate";
  status: "completed";
  cloudOperations: "not-performed";
  learnerSession: "not-observed";
  mutationCount: number;
  cleanupMutationCount: number;
  terminalReplay: "duplicate-suppressed";
  terminalProof: "validated";
  output: "sanitized";
}

export function canonicalAvdManifestDryRunInput():
  AvdManifestRunnerAdapterInput {
  const manifest = SCENARIO_MANIFESTS.find(
    (candidate) => candidate.id === AVD_THREE_VM_SCENARIO.id,
  );
  if (!manifest) {
    throw new Error("Canonical AVD scenario registry entry is unavailable.");
  }
  const expiry = Date.parse(manifest.lifecycle.expiresAt);
  const plannedAt = new Date(
    expiry - manifest.cost.conservativeDurationHours * 60 * 60 * 1_000,
  );
  const readinessObservedAt = new Date(plannedAt.getTime() - 10 * 60 * 1_000);
  const compactPlannedAt = plannedAt.toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".000Z", "Z");
  return {
    manifest,
    actorAliases: {
      evidenceProducer: "dev-orchestrator",
      workloadActor: "windows-endpoint",
      learner: "fixed-learner",
      responder: "dev-orchestrator",
    },
    scopeAliases: {
      tenant: "student-tenant",
      subscription: "student-subscription",
    },
    timing: {
      runMarker: `ap2lab-${compactPlannedAt}-a1b2c3`,
      plannedAt: plannedAt.toISOString(),
      readinessObservedAt: readinessObservedAt.toISOString(),
      expiryUtc: manifest.lifecycle.expiresAt,
    },
    readiness: {
      windowsImage:
        "MicrosoftWindowsDesktop:windows-11:win11-24h2-ent:1.2.3",
      linuxImage: "Canonical:ubuntu-24_04-lts:server:1.2.3",
      windowsSku: "Standard_D2s_v3",
      linuxSku: "Standard_F1als_v7",
      linuxVmCount: 2,
      availableWindowsVmCount: 1,
      availableLinuxVmCount: 2,
      vmPublicIpCount: 0,
      explicitOutbound: true,
      sharedNatGatewayCount: 1,
      sharedNatPublicIpCount: 1,
      temporaryPermissionsExact: true,
    },
    costBasis: {
      boundedDataGb: 20,
      diskOperationsPerDisk: 100_000,
    },
  };
}

export async function runCanonicalAvdManifestDryRun():
  Promise<AvdManifestDryRunSummary> {
  const plan = compileAvdManifestRunnerPlan(
    canonicalAvdManifestDryRunInput(),
  );
  const fake = new NetworkFreeRunnerAdapter();
  const journal: JournalEntry[] = [];
  const adapters: RunnerAdapters = {
    azure: fake,
    graph: fake,
    defender: fake,
    timer: fake,
    filesystem: fake,
    clock: { now: () => new Date(plan.plannedAt) },
    journal: {
      append: async (entry) => {
        journal.push(entry);
      },
    },
  };
  const runner = new ThreeVmLabRunner(plan, adapters);
  const first = await runner.run();
  if (first.status !== "completed") {
    throw new Error("Network-free lifecycle dry run did not complete.");
  }
  const mutationCount = fake.mutations.length;
  const replay = await runner.run();
  if (
    replay.status !== "completed" ||
    fake.mutations.length !== mutationCount
  ) {
    throw new Error("Terminal lifecycle replay was not duplicate-safe.");
  }
  const terminalReplay = readCanonicalTerminalReplay();
  validateTerminalReplay(terminalReplay);
  const cleanupMutationCount = fake.mutations.filter(
    (request) => request.desiredState === "absent",
  ).length;
  if (
    fake.freshTokenAbsenceProofs !== 1 ||
    cleanupMutationCount !== 7 ||
    journal.some((entry) => entry.sanitizedDetail.includes("raw"))
  ) {
    throw new Error("Network-free cleanup proof is incomplete.");
  }
  return {
    schemaVersion: 1,
    mode: "network-free-dry-run",
    scenario: "avd-three-vm-substrate",
    status: "completed",
    cloudOperations: "not-performed",
    learnerSession: "not-observed",
    mutationCount,
    cleanupMutationCount,
    terminalReplay: "duplicate-suppressed",
    terminalProof: "validated",
    output: "sanitized",
  };
}

class NetworkFreeRunnerAdapter {
  readonly mutations: MutationRequest[] = [];
  freshTokenAbsenceProofs = 0;

  async mutate(
    request: Readonly<MutationRequest>,
  ): Promise<MutationOutcome> {
    this.mutations.push({ ...request });
    return request.operationId === "roles-grant"
      ? {
          status: "succeeded",
          references: ["role-assignment-one", "role-assignment-two"],
        }
      : { status: "succeeded" };
  }

  async reconcile(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    return this.mutations.some(
        (mutation) => mutation.operationId === request.operationId,
      )
      ? { status: "desired-state" }
      : { status: "wrong-state", reason: "dry-run state remains" };
  }

  async verifyTemporaryRolesWithFreshToken(
    request: Readonly<TemporaryRoleProofRequest>,
  ): Promise<TemporaryRoleProof> {
    const absent = request.expectedState === "absent" &&
      this.mutations.some(
        (mutation) => mutation.operationId === "roles-revoke",
      );
    if (absent) {
      this.freshTokenAbsenceProofs += 1;
    }
    return {
      status: "desired-state",
      completeUnpagedRead: true,
      freshTokenRoleCount: absent ? 0 : 2,
      matchingAssignmentIds: absent
        ? []
        : ["role-assignment-one", "role-assignment-two"],
      freshToken: true,
      tenantExact: true,
      actorExact: true,
      audienceExact: true,
    };
  }

  async observe(
    request: Readonly<EvidenceRequest>,
  ): Promise<EvidenceObservation> {
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

function readCanonicalTerminalReplay(): SanitizedTerminalReplay {
  const scriptsDirectory = import.meta.url.startsWith("file:")
    ? path.dirname(fileURLToPath(import.meta.url))
    : path.resolve(process.cwd(), "scripts");
  const fixture = path.resolve(
    scriptsDirectory,
    "fixtures/avd-three-vm-completed-run.json",
  );
  return JSON.parse(fs.readFileSync(fixture, "utf8")) as
    SanitizedTerminalReplay;
}
