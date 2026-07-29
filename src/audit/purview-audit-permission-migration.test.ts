import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  verifyPurviewAuditPermissionMigrationReadiness,
} from "./purview-audit-permission-migration";

const broadRoleId = "5e1e9171-754d-478c-812c-f1755a9a4c2d";
const narrowRoleId = "91c64a47-a524-4fce-9bf3-3d569a344ecf";

const ready = {
  detectorIdentity: {
    expectedApplicationId: "11111111-1111-4111-8111-111111111111",
    observedApplicationId: "11111111-1111-4111-8111-111111111111",
    expectedServicePrincipalId: "22222222-2222-4222-8222-222222222222",
    observedServicePrincipalId: "22222222-2222-4222-8222-222222222222",
    expectedGraphServicePrincipalId:
      "33333333-3333-4333-8333-333333333333",
    observedGraphServicePrincipalId:
      "33333333-3333-4333-8333-333333333333",
  },
  assignedGraphApplicationRoles: [
    {
      principalId: "22222222-2222-4222-8222-222222222222",
      resourceId: "33333333-3333-4333-8333-333333333333",
      appRoleId: broadRoleId,
    },
    {
      principalId: "22222222-2222-4222-8222-222222222222",
      resourceId: "33333333-3333-4333-8333-333333333333",
      appRoleId: narrowRoleId,
    },
  ],
  consumers: [
    {
      id: "repository-purview-readiness-planner",
      state: "migrated-to-sharepoint-only",
    },
    {
      id: "protected-purview-preflight",
      state: "migrated-to-sharepoint-only",
    },
    {
      id: "protected-purview-run-once",
      state: "migrated-to-sharepoint-only",
    },
    {
      id: "protected-purview-reconcile-existing-once",
      state: "migrated-to-sharepoint-only",
    },
  ],
  activeMarkedRun: "none",
  independentRecoveryAdministrator: "confirmed",
  grantReconciliation: "exact-assignment-read-before-any-retry",
  revocationReconciliation:
    "exact-assignment-absence-read-before-any-retry",
  rollbackRegrant:
    "independent-admin-regrants-broad-and-requires-one-exact-assignment",
  postRevocationFreshTokenCheck:
    "planned-require-narrow-present-and-broad-absent",
} as const;

describe("verifyPurviewAuditPermissionMigrationReadiness", () => {
  it("freezes a pure, ordered, separately authorized revocation contract", () => {
    expect(verifyPurviewAuditPermissionMigrationReadiness(ready)).toEqual({
      schemaVersion: 1,
      proof: "readiness-only-no-permission-mutation",
      status: "ready-for-separate-revocation-authority",
      detectorBinding: "exact",
      permissions: {
        broad: { id: broadRoleId, name: "AuditLogsQuery.Read.All" },
        narrow: {
          id: narrowRoleId,
          name: "AuditLogsQuery-SharePoint.Read.All",
        },
      },
      consumerMigration: {
        required: [
          "repository-purview-readiness-planner",
          "protected-purview-preflight",
          "protected-purview-run-once",
          "protected-purview-reconcile-existing-once",
        ],
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
    });
  });

  it("models the current retained broad-only state as blocked", () => {
    const result = verifyPurviewAuditPermissionMigrationReadiness({
      ...ready,
      assignedGraphApplicationRoles: [ready.assignedGraphApplicationRoles[0]],
      consumers: ready.consumers.map((consumer) => ({
        ...consumer,
        state: consumer.id === "repository-purview-readiness-planner"
          ? "migrated-to-sharepoint-only"
          : "depends-on-broad",
      })),
    });

    expect(result).toMatchObject({
      status: "blocked",
      blockers: [
        "narrow-role-not-exactly-once",
        "consumer-not-migrated",
      ],
    });
    expect(result).not.toHaveProperty("executionOrder");
  });

  it.each([
    [
      "mismatched detector binding",
      {
        detectorIdentity: {
          ...ready.detectorIdentity,
          observedServicePrincipalId:
            "33333333-3333-4333-8333-333333333333",
        },
      },
      "detector-binding-mismatch",
    ],
    [
      "missing broad role",
      { assignedGraphApplicationRoles: [ready.assignedGraphApplicationRoles[1]] },
      "broad-role-not-exactly-once",
    ],
    [
      "duplicate narrow role",
      {
        assignedGraphApplicationRoles: [
          ...ready.assignedGraphApplicationRoles,
          ready.assignedGraphApplicationRoles[1],
        ],
      },
      "narrow-role-not-exactly-once",
    ],
    ["active marked run", { activeMarkedRun: "active" }, "active-marked-run"],
    [
      "assignment from another principal",
      {
        assignedGraphApplicationRoles: [
          ready.assignedGraphApplicationRoles[0],
          {
            ...ready.assignedGraphApplicationRoles[1],
            principalId: "44444444-4444-4444-8444-444444444444",
          },
        ],
      },
      "invalid-input",
    ],
    [
      "assignment from another resource",
      {
        assignedGraphApplicationRoles: [
          ready.assignedGraphApplicationRoles[0],
          {
            ...ready.assignedGraphApplicationRoles[1],
            resourceId: "44444444-4444-4444-8444-444444444444",
          },
        ],
      },
      "invalid-input",
    ],
    [
      "unknown marked run",
      { activeMarkedRun: "unknown" },
      "marked-run-state-unknown",
    ],
    [
      "missing recovery administrator",
      { independentRecoveryAdministrator: "missing" },
      "independent-recovery-administrator-unconfirmed",
    ],
    [
      "incomplete grant reconciliation",
      { grantReconciliation: "incomplete" },
      "grant-reconciliation-incomplete",
    ],
    [
      "incomplete revocation reconciliation",
      { revocationReconciliation: "incomplete" },
      "revocation-reconciliation-incomplete",
    ],
    [
      "incomplete rollback",
      { rollbackRegrant: "incomplete" },
      "rollback-regrant-incomplete",
    ],
    [
      "unplanned fresh token check",
      { postRevocationFreshTokenCheck: "unplanned" },
      "fresh-token-check-unplanned",
    ],
  ])("refuses %s", (_label, change, blocker) => {
    expect(
      verifyPurviewAuditPermissionMigrationReadiness({
        ...ready,
        ...change,
      }),
    ).toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining([blocker]),
    });
  });

  it.each([
    null,
    [],
    { ...ready, extra: true },
    {
      ...ready,
      detectorIdentity: {
        ...ready.detectorIdentity,
        expectedApplicationId: "not-an-id",
      },
    },
    { ...ready, consumers: ready.consumers.slice(1) },
    {
      ...ready,
      consumers: [
        ready.consumers[0],
        ready.consumers[0],
        ...ready.consumers.slice(2),
      ],
    },
    {
      ...ready,
      consumers: ready.consumers.map((consumer) =>
        Object.assign(
          Object.create({
            id: consumer.id,
            state: consumer.state,
          }),
          {},
        )
      ),
    },
  ])("fails closed on malformed input", (value) => {
    expect(verifyPurviewAuditPermissionMigrationReadiness(value)).toMatchObject({
      status: "blocked",
      blockers: expect.arrayContaining(["invalid-input"]),
    });
  });

  it("contains no authentication, Graph, mutation, or token acquisition path", () => {
    const source = readFileSync(
      "src/audit/purview-audit-permission-migration.ts",
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("appRoleAssignments/");
    expect(source).not.toContain("client_credentials");
    expect(source).not.toContain("access_token");
    expect(source).not.toMatch(/\bPOST\b|\bDELETE\b|\bPATCH\b/);
  });
});
