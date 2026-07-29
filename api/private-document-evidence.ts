export const PRIVATE_DOCUMENT_FILES_READ_SCOPE =
  "https://graph.microsoft.com/Files.Read";
export const PRIVATE_DOCUMENT_FILES_READ_WRITE_SCOPE =
  "https://graph.microsoft.com/Files.ReadWrite";
export const PRIVATE_DOCUMENT_PAYLOAD =
  "AP2 authorized lab document review scenario. This harmless private text artifact contains no links, secrets, active content, or security-test payload.\n";
export const PRIVATE_DOCUMENT_FILE_NAME = "authorized-lab-document.txt";

const MARKER_PATTERN =
  /^ap2doc-\d{8}T\d{6}Z-[a-f0-9]{6}$/;

export interface PrivateDocumentActor {
  alias: "kobe" | "cory";
  tenantId: string;
  objectId: string;
}

export interface PrivateDocumentDrive {
  id: string;
  driveType: "business";
  ownerObjectId: string;
  hostname: string;
}

export interface PrivateDocumentScenario {
  runMarker: string;
  tenantId: string;
  producer: PrivateDocumentActor;
  learner: PrivateDocumentActor;
  drive: PrivateDocumentDrive;
  runFolderPathAbsent: boolean;
  producerScopes: readonly string[];
  learnerScopes: readonly string[];
  cleanupOwnerAlias: "kobe";
  payloadCategory: "authorized-lab-document-review";
  retention: "ephemeral";
  share: Readonly<{
    recipientObjectId: string;
    roles: readonly ["read"];
    requireSignIn: true;
    sendInvitation: false;
    allowLinks: false;
  }>;
  claims: Readonly<{
    learnerVisibility: "metadata-or-content-read";
    learnerInterpretation: false;
    auditOrDetection: false;
  }>;
}

export interface PrivateDocumentPlanContext {
  expectedTenantId: string;
  existingMarkers?: ReadonlySet<string>;
}

export interface FrozenPrivateDocumentPlan
  extends PrivateDocumentScenario {
  schemaVersion: 1;
  folderName: string;
  journalPath: string;
  payload: typeof PRIVATE_DOCUMENT_PAYLOAD;
  fileName: typeof PRIVATE_DOCUMENT_FILE_NAME;
  mutationOrder: readonly [
    "folder-create",
    "file-create",
    "direct-share-create",
  ];
  cleanupOrder: readonly [
    "direct-share-delete",
    "file-delete",
    "folder-delete",
  ];
}

export type PrivateDocumentMutation =
  | "folder-create"
  | "file-create"
  | "direct-share-create"
  | "direct-share-delete"
  | "file-delete"
  | "folder-delete";

export type PrivateDocumentRead =
  | "learner-visibility"
  | "terminal-producer-absence"
  | "terminal-learner-absence";

export interface PrivateDocumentState {
  folderId?: string;
  folderETag?: string;
  itemId?: string;
  itemETag?: string;
  permissionId?: string;
}

export type PrivateDocumentMutationOutcome =
  | {
      status: "succeeded";
      state: Readonly<PrivateDocumentState>;
    }
  | { status: "failed" }
  | { status: "ambiguous" };

export type PrivateDocumentReconciliation =
  | {
      status: "desired";
      state: Readonly<PrivateDocumentState>;
    }
  | {
      status: "present";
      state: Readonly<PrivateDocumentState>;
    }
  | { status: "absent"; state: Readonly<PrivateDocumentState> }
  | { status: "incomplete" };

export interface PrivateDocumentObservation {
  status: "proven" | "absent" | "failed";
  summary:
    | "learner-visible"
    | "producer-absent"
    | "learner-absent"
    | "contract-failed";
}

export interface PrivateDocumentTransport {
  mutate(
    operation: PrivateDocumentMutation,
    plan: FrozenPrivateDocumentPlan,
    state: Readonly<PrivateDocumentState>,
  ): Promise<PrivateDocumentMutationOutcome>;
  reconcile(
    operation: PrivateDocumentMutation,
    plan: FrozenPrivateDocumentPlan,
    state: Readonly<PrivateDocumentState>,
  ): Promise<PrivateDocumentReconciliation>;
  observe(
    read: PrivateDocumentRead,
    plan: FrozenPrivateDocumentPlan,
    state: Readonly<PrivateDocumentState>,
  ): Promise<PrivateDocumentObservation>;
}

export interface PrivateDocumentJournalEntry {
  at: string;
  operation: PrivateDocumentMutation | PrivateDocumentRead;
  transition:
    | "intent"
    | "succeeded"
    | "failed"
    | "ambiguous"
    | "reconciled"
    | "reconciliation-incomplete"
    | "observed";
  detail:
    | "mutation-intent"
    | "definite-success"
    | "definite-failure"
    | "requires-exact-read"
    | "exact-desired-state"
    | "exact-present-state"
    | "exact-absent-state"
    | "absence-awaiting-propagation"
    | "read-incomplete"
    | PrivateDocumentObservation["summary"];
}

export interface PrivateDocumentJournal {
  append(entry: Readonly<PrivateDocumentJournalEntry>): Promise<void>;
}

export interface PrivateDocumentClock {
  now(): Date;
  wait(milliseconds: number): Promise<void>;
}

export type PrivateDocumentRunResult =
  | {
      status: "completed-cleaned";
      learnerVisibility: "proven";
      learnerInterpretation: "not-claimed";
      auditOrDetection: "not-claimed";
      state: Readonly<PrivateDocumentState>;
    }
  | {
      status: "blocked-cleanup";
      failedOperation: string;
      state: Readonly<PrivateDocumentState>;
    }
  | {
      status: "cleaned-after-failure";
      failedOperation: string;
      state: Readonly<PrivateDocumentState>;
    };

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

export function buildPrivateDocumentPlan(
  scenario: PrivateDocumentScenario,
  context: PrivateDocumentPlanContext,
): FrozenPrivateDocumentPlan {
  invariant(
    context.expectedTenantId.length > 0 &&
      scenario.tenantId === context.expectedTenantId &&
      scenario.producer.tenantId === context.expectedTenantId &&
      scenario.learner.tenantId === context.expectedTenantId,
    "The private-document tenant does not match the fixed AP2 tenant.",
  );
  invariant(
    scenario.producer.alias === "kobe" &&
      scenario.learner.alias === "cory" &&
      scenario.producer.objectId !== scenario.learner.objectId,
    "The exact distinct Kobe producer and Cory learner are required.",
  );
  invariant(
    MARKER_PATTERN.test(scenario.runMarker) &&
      !context.existingMarkers?.has(scenario.runMarker),
    "The private-document run marker is malformed or reused.",
  );
  invariant(
    scenario.drive.driveType === "business" &&
      scenario.drive.ownerObjectId === scenario.producer.objectId &&
      scenario.drive.hostname.toLowerCase().endsWith(".sharepoint.com"),
    "The drive must be Kobe's tenant-local business OneDrive.",
  );
  invariant(
    scenario.runFolderPathAbsent,
    "The unique run-folder path must be absent before mutation.",
  );
  invariant(
    scenario.producerScopes.length === 1 &&
      scenario.producerScopes[0] ===
        PRIVATE_DOCUMENT_FILES_READ_WRITE_SCOPE &&
      scenario.learnerScopes.length === 1 &&
      scenario.learnerScopes[0] === PRIVATE_DOCUMENT_FILES_READ_SCOPE,
    "The exact retained delegated Files scopes are required.",
  );
  invariant(
    scenario.cleanupOwnerAlias === "kobe",
    "Kobe must own exact item and permission cleanup.",
  );
  invariant(
    scenario.payloadCategory === "authorized-lab-document-review" &&
      scenario.retention === "ephemeral",
    "Only the fixed harmless ephemeral payload category is supported.",
  );
  invariant(
    scenario.share.recipientObjectId === scenario.learner.objectId &&
      scenario.share.roles.length === 1 &&
      scenario.share.roles[0] === "read" &&
      scenario.share.requireSignIn &&
      !scenario.share.sendInvitation &&
      !scenario.share.allowLinks,
    "Only one direct signed-in Cory read grant without links or email is supported.",
  );
  invariant(
    scenario.claims.learnerVisibility === "metadata-or-content-read" &&
      !scenario.claims.learnerInterpretation &&
      !scenario.claims.auditOrDetection,
    "The claim contract exceeds backend learner-visibility evidence.",
  );

  return deepFreeze({
    schemaVersion: 1,
    ...scenario,
    folderName: `AP2 private document ${scenario.runMarker}`,
    journalPath: `private-document/${scenario.runMarker}/journal.jsonl`,
    payload: PRIVATE_DOCUMENT_PAYLOAD,
    fileName: PRIVATE_DOCUMENT_FILE_NAME,
    mutationOrder: [
      "folder-create",
      "file-create",
      "direct-share-create",
    ],
    cleanupOrder: [
      "direct-share-delete",
      "file-delete",
      "folder-delete",
    ],
  });
}

export function sanitizedPrivateDocumentPlan(
  plan: FrozenPrivateDocumentPlan,
): object {
  return {
    schemaVersion: plan.schemaVersion,
    runMarker: plan.runMarker,
    tenant: "fixed-contract",
    producer: plan.producer.alias,
    learner: plan.learner.alias,
    drive: "verified-tenant-local-business-drive",
    folderName: plan.folderName,
    fileName: plan.fileName,
    payloadCategory: plan.payloadCategory,
    share: {
      recipient: plan.learner.alias,
      roles: plan.share.roles,
      requireSignIn: plan.share.requireSignIn,
      sendInvitation: plan.share.sendInvitation,
      linksAllowed: plan.share.allowLinks,
    },
    retention: plan.retention,
    claims: plan.claims,
    mutationOrder: plan.mutationOrder,
    cleanupOrder: plan.cleanupOrder,
  };
}

export class PrivateDocumentEvidenceRunner {
  readonly #plan: FrozenPrivateDocumentPlan;
  readonly #transport: PrivateDocumentTransport;
  readonly #journal: PrivateDocumentJournal;
  readonly #clock: PrivateDocumentClock;
  readonly #attempted = new Set<PrivateDocumentMutation>();
  #state: PrivateDocumentState = {};

  constructor(
    plan: FrozenPrivateDocumentPlan,
    transport: PrivateDocumentTransport,
    journal: PrivateDocumentJournal,
    clock: PrivateDocumentClock,
  ) {
    this.#plan = plan;
    this.#transport = transport;
    this.#journal = journal;
    this.#clock = clock;
  }

  async run(): Promise<PrivateDocumentRunResult> {
    let failure: string | undefined;
    for (const operation of this.#plan.mutationOrder) {
      const outcome = await this.#mutateOnce(operation);
      if (outcome === "blocked") {
        failure = operation;
        break;
      }
    }

    if (!failure) {
      const learner = await this.#observe("learner-visibility");
      if (learner.status !== "proven") {
        failure = "learner-visibility";
      }
    }

    const cleanupFailure = await this.#cleanup();
    if (cleanupFailure) {
      return {
        status: "blocked-cleanup",
        failedOperation: cleanupFailure,
        state: this.#state,
      };
    }

    const [producer, learner] = await Promise.all([
      this.#observe("terminal-producer-absence"),
      this.#observe("terminal-learner-absence"),
    ]);
    if (producer.status !== "absent" || learner.status !== "absent") {
      return {
        status: "blocked-cleanup",
        failedOperation: "terminal-absence",
        state: this.#state,
      };
    }

    if (failure) {
      return {
        status: "cleaned-after-failure",
        failedOperation: failure,
        state: this.#state,
      };
    }
    return {
      status: "completed-cleaned",
      learnerVisibility: "proven",
      learnerInterpretation: "not-claimed",
      auditOrDetection: "not-claimed",
      state: this.#state,
    };
  }

  async #cleanup(): Promise<string | undefined> {
    for (const operation of this.#plan.cleanupOrder) {
      const before = await this.#reconcile(operation, true);
      if (before.status === "desired" || before.status === "absent") {
        this.#mergeState(before.state);
        continue;
      }
      if (before.status !== "present") {
        return operation;
      }
      this.#mergeState(before.state);
      const outcome = await this.#mutateOnce(operation);
      if (outcome === "blocked") {
        return operation;
      }
    }
    return undefined;
  }

  async #mutateOnce(
    operation: PrivateDocumentMutation,
  ): Promise<"succeeded" | "blocked"> {
    invariant(
      !this.#attempted.has(operation),
      `Mutation ${operation} cannot be replayed.`,
    );
    this.#attempted.add(operation);
    await this.#write(operation, "intent", "mutation-intent");
    let outcome: PrivateDocumentMutationOutcome;
    try {
      outcome = await this.#transport.mutate(
        operation,
        this.#plan,
        this.#state,
      );
    } catch {
      outcome = { status: "ambiguous" };
    }
    if (outcome.status === "succeeded") {
      this.#mergeState(outcome.state);
      await this.#write(operation, "succeeded", "definite-success");
      const reconciled = await this.#reconcile(operation, true);
      if (reconciled.status === "desired") {
        this.#mergeState(reconciled.state);
        return "succeeded";
      }
      return "blocked";
    }
    if (outcome.status === "failed") {
      await this.#write(operation, "failed", "definite-failure");
      return "blocked";
    }
    await this.#write(operation, "ambiguous", "requires-exact-read");
    const reconciled = await this.#reconcile(operation, true);
    if (reconciled.status === "desired") {
      this.#mergeState(reconciled.state);
      return "succeeded";
    }
    return "blocked";
  }

  async #reconcile(
    operation: PrivateDocumentMutation,
    requireStableAbsence = false,
  ): Promise<PrivateDocumentReconciliation> {
    let consecutiveAbsence = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let result: PrivateDocumentReconciliation;
      try {
        result = await this.#transport.reconcile(
          operation,
          this.#plan,
          this.#state,
        );
      } catch {
        result = { status: "incomplete" };
      }
      const absenceLike =
        result.status === "absent" ||
        (result.status === "desired" && operation.endsWith("-delete"));
      if (
        result.status !== "incomplete" &&
        (!requireStableAbsence || !absenceLike)
      ) {
        await this.#write(
          operation,
          "reconciled",
          result.status === "desired"
            ? "exact-desired-state"
            : result.status === "present"
              ? "exact-present-state"
              : "exact-absent-state",
        );
        return result;
      }
      if (absenceLike) {
        consecutiveAbsence += 1;
        if (consecutiveAbsence === 3) {
          await this.#write(
            operation,
            "reconciled",
            result.status === "desired"
              ? "exact-desired-state"
              : "exact-absent-state",
          );
          return result;
        }
        await this.#write(
          operation,
          "reconciliation-incomplete",
          "absence-awaiting-propagation",
        );
      } else {
        consecutiveAbsence = 0;
        await this.#write(
          operation,
          "reconciliation-incomplete",
          "read-incomplete",
        );
      }
      if (attempt < 2) {
        await this.#clock.wait(1_000);
      }
    }
    return { status: "incomplete" };
  }

  async #observe(
    read: PrivateDocumentRead,
  ): Promise<PrivateDocumentObservation> {
    let observation: PrivateDocumentObservation;
    try {
      observation = await this.#transport.observe(
        read,
        this.#plan,
        this.#state,
      );
    } catch {
      observation = { status: "failed", summary: "contract-failed" };
    }
    await this.#journal.append({
      at: this.#clock.now().toISOString(),
      operation: read,
      transition: "observed",
      detail: observation.summary,
    });
    return observation;
  }

  #mergeState(next: Readonly<PrivateDocumentState>): void {
    this.#state = { ...this.#state, ...next };
  }

  async #write(
    operation: PrivateDocumentMutation,
    transition: PrivateDocumentJournalEntry["transition"],
    detail: PrivateDocumentJournalEntry["detail"],
  ): Promise<void> {
    await this.#journal.append({
      at: this.#clock.now().toISOString(),
      operation,
      transition,
      detail,
    });
  }
}
