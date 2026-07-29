const BROAD_APPLICATION_PERMISSION = {
  id: "5e1e9171-754d-478c-812c-f1755a9a4c2d",
  name: "AuditLogsQuery.Read.All",
} as const;

const NARROW_APPLICATION_PERMISSION = {
  id: "91c64a47-a524-4fce-9bf3-3d569a344ecf",
  name: "AuditLogsQuery-SharePoint.Read.All",
} as const;

const CONSUMER_IDS = [
  "repository-purview-readiness-planner",
  "protected-purview-preflight",
  "protected-purview-run-once",
  "protected-purview-reconcile-existing-once",
] as const;

const INPUT_KEYS = [
  "detectorIdentity",
  "assignedGraphApplicationRoles",
  "consumers",
  "activeMarkedRun",
  "independentRecoveryAdministrator",
  "grantReconciliation",
  "revocationReconciliation",
  "rollbackRegrant",
  "postRevocationFreshTokenCheck",
] as const;

const BLOCKER_ORDER = [
  "invalid-input",
  "detector-binding-mismatch",
  "broad-role-not-exactly-once",
  "narrow-role-not-exactly-once",
  "consumer-not-migrated",
  "active-marked-run",
  "marked-run-state-unknown",
  "independent-recovery-administrator-unconfirmed",
  "grant-reconciliation-incomplete",
  "revocation-reconciliation-incomplete",
  "rollback-regrant-incomplete",
  "fresh-token-check-unplanned",
] as const;

export type PurviewAuditPermissionConsumerId = typeof CONSUMER_IDS[number];
export type PurviewAuditPermissionMigrationBlocker =
  typeof BLOCKER_ORDER[number];

export interface PurviewAuditPermissionMigrationInput {
  detectorIdentity: {
    expectedApplicationId: string;
    observedApplicationId: string;
    expectedServicePrincipalId: string;
    observedServicePrincipalId: string;
    expectedGraphServicePrincipalId: string;
    observedGraphServicePrincipalId: string;
  };
  assignedGraphApplicationRoles: readonly {
    principalId: string;
    resourceId: string;
    appRoleId: string;
  }[];
  consumers: readonly {
    id: PurviewAuditPermissionConsumerId;
    state: "migrated-to-sharepoint-only" | "depends-on-broad" | "unknown";
  }[];
  activeMarkedRun: "none" | "active" | "unknown";
  independentRecoveryAdministrator: "confirmed" | "missing" | "unknown";
  grantReconciliation:
    | "exact-assignment-read-before-any-retry"
    | "incomplete";
  revocationReconciliation:
    | "exact-assignment-absence-read-before-any-retry"
    | "incomplete";
  rollbackRegrant:
    | "independent-admin-regrants-broad-and-requires-one-exact-assignment"
    | "incomplete";
  postRevocationFreshTokenCheck:
    | "planned-require-narrow-present-and-broad-absent"
    | "unplanned";
}

interface PurviewAuditPermissionMigrationBase {
  schemaVersion: 1;
  proof: "readiness-only-no-permission-mutation";
  detectorBinding: "exact" | "unproven";
  permissions: {
    broad: typeof BROAD_APPLICATION_PERMISSION;
    narrow: typeof NARROW_APPLICATION_PERMISSION;
  };
}

export interface PurviewAuditPermissionMigrationBlocked
  extends PurviewAuditPermissionMigrationBase {
  status: "blocked";
  blockers: readonly PurviewAuditPermissionMigrationBlocker[];
}

export interface PurviewAuditPermissionMigrationReady
  extends PurviewAuditPermissionMigrationBase {
  status: "ready-for-separate-revocation-authority";
  consumerMigration: {
    required: typeof CONSUMER_IDS;
    state: "all-migrated";
  };
  narrowAdminConsent: "proven-by-exact-app-role-assignment";
  executionOrder: readonly [
    "re-read-and-require-one-broad-and-one-narrow-assignment",
    "reconfirm-no-active-marked-run",
    "revoke-only-the-exact-broad-assignment-once",
    "on-ambiguous-revoke-read-and-require-broad-absence-never-replay-blindly",
    "acquire-a-new-post-revocation-token",
    "require-fresh-token-narrow-role-present-and-broad-role-absent",
  ];
  rollback: {
    authority: "independent-recovery-administrator";
    trigger:
      "fresh-token-or-sharepoint-readiness-fails-after-confirmed-revocation";
    action:
      "regrant-exact-broad-role-to-exact-detector-service-principal-once";
    reconciliation:
      "read-and-require-one-exact-broad-assignment-before-any-retry";
  };
  cachedTokenMeaning: "never-proves-post-revocation-absence";
}

export type PurviewAuditPermissionMigrationResult =
  | PurviewAuditPermissionMigrationBlocked
  | PurviewAuditPermissionMigrationReady;

export function verifyPurviewAuditPermissionMigrationReadiness(
  value: unknown,
): PurviewAuditPermissionMigrationResult {
  const base = migrationBase("unproven");
  if (!isRecord(value)) {
    return { ...base, status: "blocked", blockers: ["invalid-input"] };
  }

  const blockers = new Set<PurviewAuditPermissionMigrationBlocker>();
  if (
    Object.keys(value).length !== INPUT_KEYS.length ||
    Object.keys(value).some((key) =>
      !INPUT_KEYS.includes(key as typeof INPUT_KEYS[number])
    )
  ) {
    blockers.add("invalid-input");
  }

  const detectorBinding = exactDetectorBinding(value.detectorIdentity);
  if (detectorBinding === null) {
    blockers.add("invalid-input");
  } else if (!detectorBinding) {
    blockers.add("detector-binding-mismatch");
  }

  const assignedRoles = parseAssignedRoles(
    value.assignedGraphApplicationRoles,
    value.detectorIdentity,
  );
  if (assignedRoles === null) {
    blockers.add("invalid-input");
  } else {
    if (
      assignedRoles.filter((assignment) =>
        assignment.appRoleId === BROAD_APPLICATION_PERMISSION.id
      ).length !== 1
    ) {
      blockers.add("broad-role-not-exactly-once");
    }
    if (
      assignedRoles.filter((assignment) =>
        assignment.appRoleId === NARROW_APPLICATION_PERMISSION.id
      ).length !== 1
    ) {
      blockers.add("narrow-role-not-exactly-once");
    }
  }

  const consumers = parseConsumers(value.consumers);
  if (consumers === null) {
    blockers.add("invalid-input");
  } else if (
    consumers.some((consumer) =>
      consumer.state !== "migrated-to-sharepoint-only"
    )
  ) {
    blockers.add("consumer-not-migrated");
  }

  if (value.activeMarkedRun === "active") {
    blockers.add("active-marked-run");
  } else if (value.activeMarkedRun === "unknown") {
    blockers.add("marked-run-state-unknown");
  } else if (value.activeMarkedRun !== "none") {
    blockers.add("invalid-input");
  }

  if (value.independentRecoveryAdministrator !== "confirmed") {
    if (
      value.independentRecoveryAdministrator !== "missing" &&
      value.independentRecoveryAdministrator !== "unknown"
    ) {
      blockers.add("invalid-input");
    }
    blockers.add("independent-recovery-administrator-unconfirmed");
  }

  exactValue(
    value.grantReconciliation,
    "exact-assignment-read-before-any-retry",
    "grant-reconciliation-incomplete",
    blockers,
  );
  exactValue(
    value.revocationReconciliation,
    "exact-assignment-absence-read-before-any-retry",
    "revocation-reconciliation-incomplete",
    blockers,
  );
  exactValue(
    value.rollbackRegrant,
    "independent-admin-regrants-broad-and-requires-one-exact-assignment",
    "rollback-regrant-incomplete",
    blockers,
  );
  exactValue(
    value.postRevocationFreshTokenCheck,
    "planned-require-narrow-present-and-broad-absent",
    "fresh-token-check-unplanned",
    blockers,
  );

  const exactBase = migrationBase(detectorBinding ? "exact" : "unproven");
  if (blockers.size > 0) {
    return {
      ...exactBase,
      status: "blocked",
      blockers: BLOCKER_ORDER.filter((blocker) => blockers.has(blocker)),
    };
  }

  return {
    ...exactBase,
    status: "ready-for-separate-revocation-authority",
    consumerMigration: {
      required: CONSUMER_IDS,
      state: "all-migrated",
    },
    narrowAdminConsent: "proven-by-exact-app-role-assignment",
    executionOrder: [
      "re-read-and-require-one-broad-and-one-narrow-assignment",
      "reconfirm-no-active-marked-run",
      "revoke-only-the-exact-broad-assignment-once",
      "on-ambiguous-revoke-read-and-require-broad-absence-never-replay-blindly",
      "acquire-a-new-post-revocation-token",
      "require-fresh-token-narrow-role-present-and-broad-role-absent",
    ],
    rollback: {
      authority: "independent-recovery-administrator",
      trigger:
        "fresh-token-or-sharepoint-readiness-fails-after-confirmed-revocation",
      action:
        "regrant-exact-broad-role-to-exact-detector-service-principal-once",
      reconciliation:
        "read-and-require-one-exact-broad-assignment-before-any-retry",
    },
    cachedTokenMeaning: "never-proves-post-revocation-absence",
  };
}

function migrationBase(
  detectorBinding: "exact" | "unproven",
): PurviewAuditPermissionMigrationBase {
  return {
    schemaVersion: 1,
    proof: "readiness-only-no-permission-mutation",
    detectorBinding,
    permissions: {
      broad: BROAD_APPLICATION_PERMISSION,
      narrow: NARROW_APPLICATION_PERMISSION,
    },
  };
}

function exactDetectorBinding(value: unknown): boolean | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 6 ||
    ![
      "expectedApplicationId",
      "observedApplicationId",
      "expectedServicePrincipalId",
      "observedServicePrincipalId",
      "expectedGraphServicePrincipalId",
      "observedGraphServicePrincipalId",
    ].every((key) => Object.hasOwn(value, key))
  ) {
    return null;
  }
  const ids = [
    value.expectedApplicationId,
    value.observedApplicationId,
    value.expectedServicePrincipalId,
    value.observedServicePrincipalId,
    value.expectedGraphServicePrincipalId,
    value.observedGraphServicePrincipalId,
  ].map(uuid);
  if (ids.some((id) => id === null)) {
    return null;
  }
  return ids[0] === ids[1] && ids[2] === ids[3] && ids[4] === ids[5];
}

function parseConsumers(
  value: unknown,
): PurviewAuditPermissionMigrationInput["consumers"] | null {
  if (!Array.isArray(value) || value.length !== CONSUMER_IDS.length) {
    return null;
  }
  const parsed = value.map((entry) => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, "id") ||
      !Object.hasOwn(entry, "state") ||
      !CONSUMER_IDS.includes(entry.id as PurviewAuditPermissionConsumerId) ||
      ![
        "migrated-to-sharepoint-only",
        "depends-on-broad",
        "unknown",
      ].includes(entry.state as string)
    ) {
      return null;
    }
    return {
      id: entry.id as PurviewAuditPermissionConsumerId,
      state: entry.state as
        | "migrated-to-sharepoint-only"
        | "depends-on-broad"
        | "unknown",
    };
  });
  if (parsed.some((entry) => entry === null)) {
    return null;
  }
  const ids = parsed.map((entry) => entry!.id);
  if (
    new Set(ids).size !== CONSUMER_IDS.length ||
    CONSUMER_IDS.some((id) => !ids.includes(id))
  ) {
    return null;
  }
  return parsed as PurviewAuditPermissionMigrationInput["consumers"];
}

function exactValue(
  value: unknown,
  expected: string,
  blocker: PurviewAuditPermissionMigrationBlocker,
  blockers: Set<PurviewAuditPermissionMigrationBlocker>,
): void {
  if (value !== expected) {
    if (value !== "incomplete" && value !== "unplanned") {
      blockers.add("invalid-input");
    }
    blockers.add(blocker);
  }
}

function parseAssignedRoles(
  value: unknown,
  detectorIdentity: unknown,
): PurviewAuditPermissionMigrationInput["assignedGraphApplicationRoles"] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 64 ||
    !isRecord(detectorIdentity)
  ) {
    return null;
  }
  const detectorServicePrincipalId = uuid(
    detectorIdentity.observedServicePrincipalId,
  );
  const graphServicePrincipalId = uuid(
    detectorIdentity.observedGraphServicePrincipalId,
  );
  if (
    detectorServicePrincipalId === null ||
    graphServicePrincipalId === null
  ) {
    return null;
  }
  const assignments = value.map((entry) => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 3 ||
      !["principalId", "resourceId", "appRoleId"].every((key) =>
        Object.hasOwn(entry, key)
      )
    ) {
      return null;
    }
    const principalId = uuid(entry.principalId);
    const resourceId = uuid(entry.resourceId);
    const appRoleId = uuid(entry.appRoleId);
    if (
      principalId !== detectorServicePrincipalId ||
      resourceId !== graphServicePrincipalId ||
      appRoleId === null
    ) {
      return null;
    }
    return { principalId, resourceId, appRoleId };
  });
  return assignments.some((assignment) => assignment === null)
    ? null
    : assignments as PurviewAuditPermissionMigrationInput[
      "assignedGraphApplicationRoles"
    ];
}

function uuid(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    return null;
  }
  return value.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
