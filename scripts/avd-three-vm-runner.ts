import {
  calculateThreeVmLabCost,
  type ThreeVmLabCostBreakdown,
} from "./avd-three-vm-cost.ts";

export const REQUIRED_TEMPORARY_ROLES = [
  "DeviceManagementConfiguration.ReadWrite.All",
  "DeviceManagementManagedDevices.ReadWrite.All",
] as const;

const MARKER_PATTERN = /^ap2lab-\d{8}T\d{6}Z-[a-f0-9]{6}$/;
const WINDOWS_IMAGE_PREFIX =
  "MicrosoftWindowsDesktop:windows-11:win11-24h2-ent:";
const LINUX_IMAGE_PREFIX = "Canonical:ubuntu-24_04-lts:server:";

export interface LabScenario {
  runMarker: string;
  tenantId: string;
  subscriptionId: string;
  learner: string;
  plannedAt: string;
  readinessObservedAt: string;
  expiryUtc: string;
  learnerWindowHours: number;
  provisioningAllowanceHours: number;
  laneCeilingUsd: number;
  boundedDataGb: number;
  diskOperationsPerDisk: number;
  cleanupOwner: string;
  temporaryRoles: readonly string[];
  windowsImage: string;
  linuxImage: string;
  windowsSku: "Standard_D4s_v3";
  linuxSku: "Standard_F1als_v7";
  linuxVmCount: 2;
  availableWindowsVmCount: number;
  availableLinuxVmCount: number;
  vmPublicIpCount: 0;
  learnerSessionClaimed: boolean;
}

export type AdapterName =
  | "azure"
  | "graph"
  | "defender"
  | "timer"
  | "filesystem";

export type MutationOutcome =
  | { status: "succeeded"; references?: readonly string[] }
  | { status: "failed"; reason: string }
  | { status: "ambiguous"; reason: string };

export type ReconciliationOutcome =
  | { status: "desired-state"; references?: readonly string[] }
  | { status: "wrong-state"; reason: string }
  | { status: "incomplete"; reason: string };

export interface MutationRequest {
  operationId: string;
  adapter: AdapterName;
  action: string;
  target: string;
  owner: string;
  billable: boolean;
  desiredState: "present" | "absent";
  capturedAssignmentIds?: readonly string[];
}

export interface MutationAdapter {
  mutate(request: Readonly<MutationRequest>): Promise<MutationOutcome>;
  reconcile(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome>;
}

export interface EvidenceAdapter {
  observe(request: Readonly<EvidenceRequest>): Promise<EvidenceObservation>;
}

export interface AzureAdapter extends MutationAdapter, EvidenceAdapter {}
export interface GraphAdapter extends MutationAdapter, EvidenceAdapter {
  verifyTemporaryRolesWithFreshToken(
    request: Readonly<TemporaryRoleProofRequest>,
  ): Promise<TemporaryRoleProof>;
}
export interface DefenderAdapter extends MutationAdapter, EvidenceAdapter {}

export interface TimerAdapter extends MutationAdapter {
  verifyExpiry(
    runMarker: string,
    expiryUtc: string,
  ): Promise<boolean>;
}

export interface FileSystemAdapter extends MutationAdapter {
  markerExists(runMarker: string): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface Journal {
  append(entry: Readonly<JournalEntry>): Promise<void>;
}

export interface RunnerAdapters {
  azure: AzureAdapter;
  graph: GraphAdapter;
  defender: DefenderAdapter;
  timer: TimerAdapter;
  filesystem: FileSystemAdapter;
  clock: Clock;
  journal: Journal;
}

export type EvidenceKind =
  | "arm-completion"
  | "avd-availability"
  | "intune-compliance"
  | "defender-onboarding"
  | "private-probes"
  | "learner-session";

export interface EvidenceRequest {
  kind: EvidenceKind;
  runMarker: string;
  target: string;
}

export interface EvidenceObservation {
  kind: EvidenceKind;
  state: "proven" | "not-observed" | "failed";
  observedAt: string;
  summary: "contract-satisfied" | "not-observed" | "contract-failed";
}

export interface TemporaryRoleProof {
  status: ReconciliationOutcome["status"];
  completeUnpagedRead: boolean;
  freshTokenRoleCount: number;
  matchingAssignmentIds: readonly string[];
  freshToken: boolean;
  tenantExact: boolean;
  actorExact: boolean;
  audienceExact: boolean;
}

export interface TemporaryRoleProofRequest {
  expectedState: "present" | "absent";
  requiredRoles: typeof REQUIRED_TEMPORARY_ROLES;
  capturedAssignmentIds: readonly string[];
}

export interface JournalEntry {
  at: string;
  operationId: string;
  transition:
    | "intent"
    | "succeeded"
    | "failed"
    | "ambiguous"
    | "reconciled"
    | "reconciliation-blocked";
  sanitizedDetail: string;
}

export interface FrozenLabPlan {
  schemaVersion: 1;
  runMarker: string;
  tenantId: string;
  subscriptionId: string;
  learner: string;
  plannedAt: string;
  readinessObservedAt: string;
  expiryUtc: string;
  cleanupOwner: string;
  resourceNames: Readonly<{
    baseName: string;
    resourceGroup: string;
    hostPool: string;
    applicationGroup: string;
    workspace: string;
    windowsVm: string;
    linuxVms: readonly [string, string];
    vnet: string;
    natGateway: string;
    natPublicIp: string;
  }>;
  topology: Readonly<{
    windowsImage: string;
    linuxImage: string;
    windowsSku: "Standard_D4s_v3";
    linuxSku: "Standard_F1als_v7";
    linuxVmCount: 2;
    vmPublicIpCount: 0;
    sharedNatGatewayCount: 1;
    sharedPublicIpCount: 1;
  }>;
  cost: Readonly<{
    billedHours: number;
    laneCeilingUsd: number;
    bound: Readonly<ThreeVmLabCostBreakdown>;
  }>;
  temporaryRoles: readonly string[];
  journalPath: string;
  phaseDependencies: Readonly<Record<string, readonly string[]>>;
  readinessGroups: readonly (readonly EvidenceKind[])[];
  mutations: readonly Readonly<MutationRequest>[];
  cleanupGraph: Readonly<Record<string, readonly string[]>>;
  learnerSessionClaimed: false;
}

export interface PlanContext {
  expectedTenantId: string;
  expectedSubscriptionId: string;
  expectedLearner: string;
  existingMarkers?: ReadonlySet<string>;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function validateScenario(
  scenario: LabScenario,
  context: PlanContext,
): void {
  invariant(
    context.expectedTenantId.trim() !== "" &&
      scenario.tenantId === context.expectedTenantId,
    "The scenario tenant does not match the fixed AP2 Student tenant.",
  );
  invariant(
    context.expectedSubscriptionId.trim() !== "" &&
      scenario.subscriptionId === context.expectedSubscriptionId,
    "The scenario subscription does not match the fixed AP2 Student subscription.",
  );
  invariant(
    context.expectedLearner.trim() !== "" &&
      scenario.learner === context.expectedLearner,
    "The scenario learner does not match the fixed AVD learner.",
  );
  invariant(MARKER_PATTERN.test(scenario.runMarker), "The run marker is malformed.");
  invariant(
    !context.existingMarkers?.has(scenario.runMarker),
    "The run marker has already been used.",
  );
  invariant(
    scenario.cleanupOwner === `owner:${scenario.runMarker}`,
    "The cleanup owner must be derived from the exact run marker.",
  );
  invariant(
    scenario.windowsImage.startsWith(WINDOWS_IMAGE_PREFIX) &&
      /^[0-9][0-9.]*$/.test(
        scenario.windowsImage.slice(WINDOWS_IMAGE_PREFIX.length),
      ),
    "The Windows image is unsupported.",
  );
  invariant(
    scenario.linuxImage.startsWith(LINUX_IMAGE_PREFIX) &&
      /^[0-9][0-9.]*$/.test(
        scenario.linuxImage.slice(LINUX_IMAGE_PREFIX.length),
      ),
    "The Linux image is unsupported.",
  );
  invariant(
    scenario.windowsSku === "Standard_D4s_v3" &&
      scenario.linuxSku === "Standard_F1als_v7" &&
      scenario.linuxVmCount === 2,
    "The VM SKU or count is unsupported.",
  );
  invariant(
    scenario.availableWindowsVmCount >= 1 &&
      scenario.availableLinuxVmCount >= scenario.linuxVmCount,
    "Available quota cannot support the three-VM topology.",
  );
  invariant(scenario.vmPublicIpCount === 0, "VM public IPs are forbidden.");
  invariant(
    !scenario.learnerSessionClaimed,
    "A control-plane run cannot claim a learner session.",
  );

  const roles = [...scenario.temporaryRoles];
  invariant(
    new Set(roles).size === roles.length,
    "Temporary roles must not be duplicated.",
  );
  invariant(
    roles.length === REQUIRED_TEMPORARY_ROLES.length &&
      REQUIRED_TEMPORARY_ROLES.every((role) => roles.includes(role)),
    "The exact two approved temporary roles are required.",
  );

  const plannedAt = Date.parse(scenario.plannedAt);
  const readinessObservedAt = Date.parse(scenario.readinessObservedAt);
  const expiry = Date.parse(scenario.expiryUtc);
  invariant(Number.isFinite(plannedAt), "The planned timestamp is invalid.");
  invariant(
    Number.isFinite(readinessObservedAt) &&
      readinessObservedAt <= plannedAt &&
      plannedAt - readinessObservedAt <= 30 * 60 * 1_000,
    "Mutation-critical readiness must be an independently supplied read no more than 30 minutes old.",
  );
  invariant(Number.isFinite(expiry), "A valid expiry is required.");
  invariant(expiry > plannedAt, "Expiry must follow planning.");
  const requestedHours =
    scenario.learnerWindowHours + scenario.provisioningAllowanceHours;
  invariant(requestedHours > 0, "The planned duration must be positive.");
  invariant(
    expiry >= plannedAt + requestedHours * 60 * 60 * 1_000,
    "Expiry does not cover the planned lifecycle.",
  );
  invariant(
    expiry <= plannedAt + 8 * 60 * 60 * 1_000,
    "Expiry exceeds the eight-hour absolute lifecycle.",
  );
  invariant(
    scenario.laneCeilingUsd > 0,
    "The lane ceiling must be positive.",
  );
}

function resourceNames(marker: string): FrozenLabPlan["resourceNames"] {
  const suffix = marker.slice(-6);
  const baseName = `ap2l-${suffix}`;
  return {
    baseName,
    resourceGroup: `${baseName}-rg`,
    hostPool: `${baseName}-hp`,
    applicationGroup: `${baseName}-dag`,
    workspace: `${baseName}-ws`,
    windowsVm: `${baseName.replaceAll("-", "")}avd`,
    linuxVms: [`${baseName}-aux1`, `${baseName}-aux2`],
    vnet: `${baseName}-vnet`,
    natGateway: `${baseName}-nat`,
    natPublicIp: `${baseName}-nat-pip`,
  };
}

function operation(
  operationId: string,
  adapter: AdapterName,
  action: string,
  target: string,
  owner: string,
  billable: boolean,
  desiredState: "present" | "absent",
): MutationRequest {
  return {
    operationId,
    adapter,
    action,
    target,
    owner,
    billable,
    desiredState,
  };
}

export function buildFrozenLabPlan(
  scenario: LabScenario,
  context: PlanContext,
): FrozenLabPlan {
  validateScenario(scenario, context);
  const names = resourceNames(scenario.runMarker);
  const billedHours =
    scenario.learnerWindowHours + scenario.provisioningAllowanceHours;
  const bound = calculateThreeVmLabCost({
    billedHours,
    boundedDataGb: scenario.boundedDataGb,
    diskOperationsPerDisk: scenario.diskOperationsPerDisk,
  });
  invariant(
    bound.totalUsd <= scenario.laneCeilingUsd,
    `The ${bound.totalUsd.toFixed(8)} USD cost bound exceeds the lane ceiling.`,
  );

  const mutations = [
    operation("expiry-create", "timer", "create-expiry", scenario.runMarker, scenario.cleanupOwner, false, "present"),
    operation("roles-grant", "graph", "grant-exact-temporary-roles", scenario.runMarker, scenario.cleanupOwner, false, "present"),
    operation("control-submit", "azure", "deploy-control-plane", names.resourceGroup, scenario.cleanupOwner, true, "present"),
    operation("compute-submit", "azure", "deploy-parallel-compute", names.resourceGroup, scenario.cleanupOwner, true, "present"),
    operation("defender-offboard", "defender", "offboard-marker-endpoint", names.windowsVm, scenario.cleanupOwner, false, "absent"),
    operation("endpoint-cleanup", "graph", "delete-marker-policy-group-device", scenario.runMarker, scenario.cleanupOwner, false, "absent"),
    operation("azure-cleanup", "azure", "delete-resource-group", names.resourceGroup, scenario.cleanupOwner, false, "absent"),
    operation("entra-cleanup", "graph", "delete-marker-entra-residue", names.windowsVm, scenario.cleanupOwner, false, "absent"),
    operation("roles-revoke", "graph", "revoke-captured-temporary-roles", scenario.runMarker, scenario.cleanupOwner, false, "absent"),
    operation("expiry-remove", "timer", "remove-expiry", scenario.runMarker, scenario.cleanupOwner, false, "absent"),
    operation("sensitive-remove", "filesystem", "remove-run-sensitive-artifacts", scenario.runMarker, scenario.cleanupOwner, false, "absent"),
  ] as const;

  for (const mutation of mutations) {
    invariant(
      mutation.owner === scenario.cleanupOwner,
      `Cleanup target ${mutation.operationId} is not owned by this run.`,
    );
  }

  return deepFreeze({
    schemaVersion: 1,
    runMarker: scenario.runMarker,
    tenantId: scenario.tenantId,
    subscriptionId: scenario.subscriptionId,
    learner: scenario.learner,
    plannedAt: scenario.plannedAt,
    readinessObservedAt: scenario.readinessObservedAt,
    expiryUtc: scenario.expiryUtc,
    cleanupOwner: scenario.cleanupOwner,
    resourceNames: names,
    topology: {
      windowsImage: scenario.windowsImage,
      linuxImage: scenario.linuxImage,
      windowsSku: scenario.windowsSku,
      linuxSku: scenario.linuxSku,
      linuxVmCount: scenario.linuxVmCount,
      vmPublicIpCount: scenario.vmPublicIpCount,
      sharedNatGatewayCount: 1,
      sharedPublicIpCount: 1,
    },
    cost: {
      billedHours,
      laneCeilingUsd: scenario.laneCeilingUsd,
      bound,
    },
    temporaryRoles: [...scenario.temporaryRoles],
    journalPath: `runs/${scenario.runMarker}/journal.jsonl`,
    phaseDependencies: {
      expiry: [],
      temporaryRoles: ["expiry"],
      control: ["expiry", "temporaryRoles"],
      compute: ["control"],
      readiness: ["compute"],
      cleanup: ["readiness"],
    },
    readinessGroups: [
      ["arm-completion"],
      [
        "avd-availability",
        "intune-compliance",
        "defender-onboarding",
        "private-probes",
        "learner-session",
      ],
    ],
    mutations,
    cleanupGraph: {
      "defender-offboard": [],
      "endpoint-cleanup": ["defender-offboard"],
      "azure-cleanup": ["endpoint-cleanup"],
      "entra-cleanup": ["azure-cleanup"],
      "roles-revoke": ["entra-cleanup"],
      "expiry-remove": ["roles-revoke"],
      "sensitive-remove": ["expiry-remove"],
    },
    learnerSessionClaimed: false,
  });
}

export type RunnerStatus =
  | "completed"
  | "cleaned-after-failure"
  | "ready-to-resume"
  | "blocked-ambiguous"
  | "blocked-reconciliation"
  | "failed";

export interface RunnerResult {
  status: RunnerStatus;
  operationId?: string;
  evidence: readonly EvidenceObservation[];
}

const DEPLOYMENT_OPERATION_IDS = [
  "expiry-create",
  "roles-grant",
  "control-submit",
  "compute-submit",
] as const;
const CLEANUP_OPERATION_IDS = [
  "defender-offboard",
  "endpoint-cleanup",
  "azure-cleanup",
  "entra-cleanup",
  "roles-revoke",
  "expiry-remove",
  "sensitive-remove",
] as const;

export class ThreeVmLabRunner {
  readonly #plan: FrozenLabPlan;
  readonly #adapters: RunnerAdapters;
  readonly #attempted = new Set<string>();
  #expiryVerified = false;
  #markerChecked = false;
  #deploymentIndex = 0;
  #cleanupIndex = 0;
  #pendingReconciliation: string | undefined;
  #pendingStatus: "blocked-ambiguous" | "blocked-reconciliation" | undefined;
  #pendingMode: "advance" | "pre-cleanup" | undefined;
  readonly #reconciliationReads = new Map<string, number>();
  #terminalFailure: string | undefined;
  #primaryFailure: string | undefined;
  #capturedRoleAssignmentIds: readonly string[] = [];
  #cleanupPrecheckedForMutation: string | undefined;
  #evidence: readonly EvidenceObservation[] | undefined;

  constructor(plan: FrozenLabPlan, adapters: RunnerAdapters) {
    this.#plan = plan;
    this.#adapters = adapters;
  }

  async run(): Promise<RunnerResult> {
    if (this.#terminalFailure) {
      return {
        status: "failed",
        operationId: this.#terminalFailure,
        evidence: this.#evidence ?? [],
      };
    }
    if (this.#pendingReconciliation && this.#pendingStatus) {
      return {
        status: this.#pendingStatus,
        operationId: this.#pendingReconciliation,
        evidence: this.#evidence ?? [],
      };
    }
    if (!this.#markerChecked) {
      this.#markerChecked = true;
      if (await this.#adapters.filesystem.markerExists(this.#plan.runMarker)) {
        this.#terminalFailure = "marker-reuse";
        return { status: "failed", operationId: "marker-reuse", evidence: [] };
      }
    }

    while (
      !this.#primaryFailure &&
      this.#deploymentIndex < DEPLOYMENT_OPERATION_IDS.length
    ) {
      const operationId = DEPLOYMENT_OPERATION_IDS[this.#deploymentIndex];
      invariant(operationId, "Deployment state is invalid.");
      const operation = this.#effectiveOperation(operationId);
      if (
        operation.billable &&
        (!this.#expiryVerified ||
          this.#adapters.clock.now().getTime() >=
            Date.parse(this.#plan.expiryUtc))
      ) {
        this.#primaryFailure = operation.operationId;
        break;
      }
      const result = await this.#mutateOnce(operation);
      if (result !== "succeeded") {
        if (result === "ambiguous") {
          this.#setPending(operation.operationId, "blocked-ambiguous");
          return {
            status: "blocked-ambiguous",
            operationId: operation.operationId,
            evidence: [],
          };
        }
        this.#primaryFailure = operation.operationId;
        break;
      }
      if (operation.operationId === "expiry-create") {
        this.#expiryVerified = await this.#adapters.timer.verifyExpiry(
          this.#plan.runMarker,
          this.#plan.expiryUtc,
        );
        if (!this.#expiryVerified) {
          this.#primaryFailure = "expiry-verification";
          break;
        }
      }
      if (
        operation.operationId === "roles-grant"
      ) {
        const verification = await this.#verifyDesiredState(operation);
        if (verification.status !== "desired-state") {
          if (verification.status === "incomplete") {
            this.#setPending(
              operation.operationId,
              "blocked-reconciliation",
            );
          } else {
            this.#primaryFailure = "roles-grant-verification";
          }
          if (verification.status === "incomplete") {
            return {
              status: "blocked-reconciliation",
              operationId: operation.operationId,
              evidence: [],
            };
          }
          break;
        }
      }
      this.#deploymentIndex += 1;
    }

    if (!this.#primaryFailure) {
      const evidence = this.#evidence ?? (await this.#observeReadiness());
      this.#evidence = evidence;
      if (
        evidence.some(
          (item) =>
            item.kind !== "learner-session" && item.state !== "proven",
        ) ||
        evidence.some(
          (item) =>
            item.kind === "learner-session" &&
            item.state !== "not-observed",
        )
      ) {
        this.#primaryFailure = "readiness";
      }
    }

    while (this.#cleanupIndex < CLEANUP_OPERATION_IDS.length) {
      const operationId = CLEANUP_OPERATION_IDS[this.#cleanupIndex];
      invariant(operationId, "Cleanup state is invalid.");
      let operation = this.#effectiveOperation(operationId);
      invariant(
        operation.owner === this.#plan.cleanupOwner,
        `Refusing cleanup of unowned target ${operation.target}.`,
      );
      if (this.#cleanupPrecheckedForMutation === operation.operationId) {
        this.#cleanupPrecheckedForMutation = undefined;
      } else {
        const before = await this.#verifyDesiredState(operation);
        if (before.status === "desired-state") {
          this.#cleanupIndex += 1;
          continue;
        }
        if (before.status === "incomplete") {
          this.#setPending(
            operation.operationId,
            "blocked-reconciliation",
            "pre-cleanup",
          );
          return {
            status: "blocked-reconciliation",
            operationId: operation.operationId,
            evidence: this.#evidence ?? [],
          };
        }
      }
      operation = this.#effectiveOperation(operationId);
      if (
        operation.operationId === "roles-revoke" &&
        this.#capturedRoleAssignmentIds.length !==
          REQUIRED_TEMPORARY_ROLES.length
      ) {
        this.#terminalFailure = "roles-revoke-missing-captured-assignments";
        return {
          status: "failed",
          operationId: this.#terminalFailure,
          evidence: this.#evidence ?? [],
        };
      }
      const result = await this.#mutateOnce(operation);
      if (result !== "succeeded") {
        if (result === "ambiguous") {
          this.#setPending(operation.operationId, "blocked-ambiguous");
        } else {
          this.#terminalFailure = operation.operationId;
        }
        return {
          status:
            result === "ambiguous" ? "blocked-ambiguous" : "failed",
          operationId: operation.operationId,
          evidence: this.#evidence ?? [],
        };
      }
      const verification = await this.#verifyDesiredState(operation);
      if (verification.status !== "desired-state") {
        if (verification.status === "incomplete") {
          this.#setPending(
            operation.operationId,
            "blocked-reconciliation",
          );
        } else {
          this.#terminalFailure = `${operation.operationId}-verification`;
        }
        return {
          status:
            verification.status === "incomplete"
              ? "blocked-reconciliation"
              : "failed",
          operationId:
            verification.status === "incomplete"
              ? operation.operationId
              : `${operation.operationId}-verification`,
          evidence: this.#evidence ?? [],
        };
      }
      this.#cleanupIndex += 1;
    }

    return {
      status: this.#primaryFailure ? "cleaned-after-failure" : "completed",
      operationId: this.#primaryFailure,
      evidence: this.#evidence ?? [],
    };
  }

  async reconcile(operationId: string): Promise<RunnerResult> {
    const request = this.#effectiveOperation(operationId);
    invariant(
      this.#pendingReconciliation === operationId,
      "Only the currently pending operation may be reconciled.",
    );
    const outcome = await this.#readDesiredState(request);
    if (
      this.#pendingMode === "pre-cleanup" &&
      outcome.status === "wrong-state"
    ) {
      this.#pendingReconciliation = undefined;
      this.#pendingStatus = undefined;
      this.#pendingMode = undefined;
      this.#cleanupPrecheckedForMutation = operationId;
      return {
        status: "ready-to-resume",
        operationId,
        evidence: this.#evidence ?? [],
      };
    }
    if (outcome.status === "desired-state") {
      const pendingMode = this.#pendingMode;
      this.#pendingReconciliation = undefined;
      this.#pendingStatus = undefined;
      this.#pendingMode = undefined;
      if (operationId === "expiry-create") {
        this.#expiryVerified = await this.#adapters.timer.verifyExpiry(
          this.#plan.runMarker,
          this.#plan.expiryUtc,
        );
        if (!this.#expiryVerified) {
          this.#primaryFailure = "expiry-verification";
          return {
            status: "ready-to-resume",
            operationId: "expiry-verification",
            evidence: this.#evidence ?? [],
          };
        }
      }
      if (pendingMode === "pre-cleanup") {
        this.#cleanupIndex += 1;
      } else if (DEPLOYMENT_OPERATION_IDS.includes(
        operationId as (typeof DEPLOYMENT_OPERATION_IDS)[number],
      )) {
        this.#deploymentIndex += 1;
      } else {
        this.#cleanupIndex += 1;
      }
    } else if (
      outcome.status === "wrong-state" ||
      (this.#reconciliationReads.get(operationId) ?? 0) >= 3
    ) {
      const deploymentFailure = DEPLOYMENT_OPERATION_IDS.includes(
        operationId as (typeof DEPLOYMENT_OPERATION_IDS)[number],
      );
      this.#pendingReconciliation = undefined;
      this.#pendingStatus = undefined;
      this.#pendingMode = undefined;
      if (deploymentFailure) {
        this.#primaryFailure = `${operationId}-reconciliation`;
      } else {
        this.#terminalFailure = `${operationId}-reconciliation`;
      }
      if (deploymentFailure) {
        return {
          status: "ready-to-resume",
          operationId: this.#primaryFailure,
          evidence: this.#evidence ?? [],
        };
      }
    } else {
      this.#pendingStatus = "blocked-reconciliation";
    }
    return {
      status:
        outcome.status === "desired-state"
          ? "ready-to-resume"
          : outcome.status === "incomplete" &&
              (this.#reconciliationReads.get(operationId) ?? 0) < 3
            ? this.#pendingStatus ?? "blocked-reconciliation"
            : "failed",
      operationId,
      evidence: [],
    };
  }

  async #mutateOnce(
    request: Readonly<MutationRequest>,
  ): Promise<"succeeded" | "failed" | "ambiguous"> {
    invariant(
      !this.#attempted.has(request.operationId),
      `Operation ${request.operationId} cannot be replayed.`,
    );
    this.#attempted.add(request.operationId);
    await this.#adapters.journal.append({
      at: this.#adapters.clock.now().toISOString(),
      operationId: request.operationId,
      transition: "intent",
      sanitizedDetail: `${request.adapter}:${request.action}`,
    });
    let outcome: MutationOutcome;
    try {
      outcome = await this.#mutationAdapter(request.adapter).mutate(request);
    } catch {
      outcome = {
        status: "ambiguous",
        reason: "transport ended without a definite mutation outcome",
      };
    }
    const normalized =
      request.operationId === "roles-grant" &&
      outcome.status === "succeeded" &&
      !this.#captureRoleAssignments(outcome.references)
        ? {
            status: "ambiguous" as const,
            reason: "assignment references require exact reconciliation",
          }
        : outcome;
    await this.#adapters.journal.append({
      at: this.#adapters.clock.now().toISOString(),
      operationId: request.operationId,
      transition: normalized.status,
      sanitizedDetail:
        normalized.status === "succeeded"
          ? "definite"
          : normalized.status === "failed"
            ? "definite-failure"
            : "requires-exact-read",
    });
    return normalized.status;
  }

  async #observeReadiness(): Promise<readonly EvidenceObservation[]> {
    const armRequest: EvidenceRequest = {
      kind: "arm-completion",
      runMarker: this.#plan.runMarker,
      target: this.#plan.resourceNames.resourceGroup,
    };
    const arm = await this.#observe(this.#adapters.azure, armRequest);
    if (arm.state !== "proven") {
      return [arm];
    }
    return Promise.all([
      this.#observe(this.#adapters.azure, {
        kind: "avd-availability",
        runMarker: this.#plan.runMarker,
        target: this.#plan.resourceNames.hostPool,
      }),
      this.#observe(this.#adapters.graph, {
        kind: "intune-compliance",
        runMarker: this.#plan.runMarker,
        target: this.#plan.resourceNames.windowsVm,
      }),
      this.#observe(this.#adapters.defender, {
        kind: "defender-onboarding",
        runMarker: this.#plan.runMarker,
        target: this.#plan.resourceNames.windowsVm,
      }),
      this.#observe(this.#adapters.azure, {
        kind: "private-probes",
        runMarker: this.#plan.runMarker,
        target: this.#plan.resourceNames.windowsVm,
      }),
      this.#observe(this.#adapters.azure, {
        kind: "learner-session",
        runMarker: this.#plan.runMarker,
        target: this.#plan.resourceNames.hostPool,
      }),
    ]);
  }

  async #observe(
    adapter: EvidenceAdapter,
    request: Readonly<EvidenceRequest>,
  ): Promise<EvidenceObservation> {
    try {
      return await adapter.observe(request);
    } catch {
      return {
        kind: request.kind,
        state: "failed",
        observedAt: this.#adapters.clock.now().toISOString(),
        summary: "contract-failed",
      };
    }
  }

  async #verifyDesiredState(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    return this.#readDesiredState(request);
  }

  async #readDesiredState(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    const reads = (this.#reconciliationReads.get(request.operationId) ?? 0) + 1;
    invariant(reads <= 3, "The exact reconciliation read limit is exhausted.");
    this.#reconciliationReads.set(request.operationId, reads);
    let outcome: ReconciliationOutcome;
    try {
      outcome =
        request.operationId === "roles-grant" ||
        request.operationId === "roles-revoke"
          ? await this.#readTemporaryRoleState(request)
          : await this.#mutationAdapter(request.adapter).reconcile(request);
    } catch {
      outcome = {
        status: "incomplete",
        reason: "exact reconciliation read was unavailable",
      };
    }
    await this.#adapters.journal.append({
      at: this.#adapters.clock.now().toISOString(),
      operationId: request.operationId,
      transition:
        outcome.status === "desired-state"
          ? "reconciled"
          : "reconciliation-blocked",
      sanitizedDetail: outcome.status,
    });
    return outcome;
  }

  #setPending(
    operationId: string,
    status: "blocked-ambiguous" | "blocked-reconciliation",
    mode: "advance" | "pre-cleanup" = "advance",
  ): void {
    this.#pendingReconciliation = operationId;
    this.#pendingStatus = status;
    this.#pendingMode = mode;
  }

  #operation(operationId: string): Readonly<MutationRequest> {
    const operation = this.#plan.mutations.find(
      (candidate) => candidate.operationId === operationId,
    );
    invariant(operation, `Unknown operation ${operationId}.`);
    return operation;
  }

  #effectiveOperation(operationId: string): Readonly<MutationRequest> {
    const operation = this.#operation(operationId);
    if (operationId !== "roles-revoke") {
      return operation;
    }
    return {
      ...operation,
      capturedAssignmentIds: this.#capturedRoleAssignmentIds,
    };
  }

  async #readTemporaryRoleState(
    request: Readonly<MutationRequest>,
  ): Promise<ReconciliationOutcome> {
    const expectedState =
      request.operationId === "roles-grant" ? "present" : "absent";
    const proof =
      await this.#adapters.graph.verifyTemporaryRolesWithFreshToken({
      expectedState,
      requiredRoles: REQUIRED_TEMPORARY_ROLES,
      capturedAssignmentIds: this.#capturedRoleAssignmentIds,
    });
    if (
      !proof.freshToken ||
      !proof.tenantExact ||
      !proof.actorExact ||
      !proof.audienceExact
    ) {
      return {
        status: "wrong-state",
        reason: "temporary-role token identity is not exact",
      };
    }
    if (proof.status !== "desired-state") {
      if (
        expectedState === "absent" &&
        proof.matchingAssignmentIds.length > 0
      ) {
        this.#captureRoleAssignments(proof.matchingAssignmentIds);
      }
      return {
        status: proof.status,
        reason: "temporary-role proof did not converge",
      };
    }
    if (!proof.completeUnpagedRead) {
      return {
        status: "incomplete",
        reason: "temporary-role assignment read was incomplete",
      };
    }
    if (expectedState === "present") {
      if (
        proof.freshTokenRoleCount !== REQUIRED_TEMPORARY_ROLES.length ||
        !this.#captureRoleAssignments(proof.matchingAssignmentIds)
      ) {
        return {
          status: "wrong-state",
          reason: "temporary roles are not exactly present",
        };
      }
      return {
        status: "desired-state",
        references: this.#capturedRoleAssignmentIds,
      };
    }
    if (
      proof.freshTokenRoleCount !== 0 ||
      proof.matchingAssignmentIds.length !== 0
    ) {
      return {
        status: "wrong-state",
        reason: "temporary roles remain assigned",
      };
    }
    return { status: "desired-state" };
  }

  #captureRoleAssignments(
    references: readonly string[] | undefined,
  ): boolean {
    if (
      !references ||
      references.length !== REQUIRED_TEMPORARY_ROLES.length ||
      references.some((reference) => reference.trim() === "") ||
      new Set(references).size !== references.length
    ) {
      return false;
    }
    this.#capturedRoleAssignmentIds = [...references];
    return true;
  }

  #mutationAdapter(adapter: AdapterName): MutationAdapter {
    return this.#adapters[adapter];
  }
}

export interface SanitizedTerminalReplay {
  schemaVersion: 1;
  learnerSessionObserved: false;
  observedUpperBoundUsd: number;
  evidence: Readonly<Record<EvidenceKind, "proven" | "not-observed">>;
  cleanup: Readonly<{
    defenderOffboardedWhileHostAlive: boolean;
    endpointStateAbsent: boolean;
    azureStateAbsent: boolean;
    entraStateAbsent: boolean;
    temporaryRolesAbsentWithFreshToken: boolean;
    expiryAbsent: boolean;
    sensitiveArtifactsAbsent: boolean;
  }>;
}

export function validateTerminalReplay(
  replay: SanitizedTerminalReplay,
): void {
  invariant(replay.schemaVersion === 1, "Unsupported replay schema.");
  invariant(
    replay.learnerSessionObserved === false &&
      replay.evidence["learner-session"] === "not-observed",
    "The completed control-plane run must not claim a learner session.",
  );
  for (const kind of [
    "arm-completion",
    "avd-availability",
    "intune-compliance",
    "defender-onboarding",
    "private-probes",
  ] as const) {
    invariant(replay.evidence[kind] === "proven", `${kind} was not proven.`);
  }
  invariant(
    replay.observedUpperBoundUsd === 3.07872603,
    "The replay cost does not match the protected run's reduced upper bound.",
  );
  invariant(
    Object.values(replay.cleanup).every(Boolean),
    "The replay is not terminally cleaned.",
  );
}

export function sanitizedPlanSummary(plan: FrozenLabPlan): object {
  return {
    schemaVersion: plan.schemaVersion,
    runMarker: plan.runMarker,
    tenant: "fixed-contract",
    subscription: "fixed-contract",
    learner: "fixed-contract",
    expiryUtc: plan.expiryUtc,
    resourceNames: plan.resourceNames,
    topology: plan.topology,
    cost: {
      billedHours: plan.cost.billedHours,
      laneCeilingUsd: plan.cost.laneCeilingUsd,
      upperBoundUsd: plan.cost.bound.totalUsd,
    },
    journalPath: plan.journalPath,
    phaseDependencies: plan.phaseDependencies,
    cleanupGraph: plan.cleanupGraph,
    temporaryRoles: plan.temporaryRoles,
    learnerSessionClaimed: plan.learnerSessionClaimed,
  };
}
