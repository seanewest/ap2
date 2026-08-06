import { describe, expect, it } from "vitest";
import {
  summarizeDistinctApplicationIdentityReadiness,
  verifyDistinctApplicationIdentityReadiness,
  type DistinctApplicationIdentityReadinessInput,
} from "./oauth-recon-identity-readiness.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PRODUCER_APP = "22222222-2222-4222-8222-222222222222";
const PRODUCER_SP = "33333333-3333-4333-8333-333333333333";
const DETECTOR_APP = "44444444-4444-4444-8444-444444444444";
const DETECTOR_SP = "55555555-5555-4555-8555-555555555555";
const RECOVERY = "66666666-6666-4666-8666-666666666666";
const GRAPH = "00000003-0000-0000-c000-000000000000";

function assignment(applicationRoleId: string) {
  return {
    resourceApplicationId: GRAPH,
    applicationRoleId,
    assignment: "present-exact" as const,
  };
}

function input(): DistinctApplicationIdentityReadinessInput {
  return {
    schemaVersion: 1,
    scenarioId: "oauth-application-reconnaissance",
    producer: {
      actorId: "recon-workload-app",
      applicationId: PRODUCER_APP,
      servicePrincipalId: PRODUCER_SP,
      tenantId: TENANT,
      installation: "application-and-service-principal-present",
      assignedApplicationRoles: [
        assignment("98830695-27a2-44f7-8c18-0c3ebc9698f6"),
        assignment("810c84a8-4a9e-49e6-bf7d-12d183f40d01"),
        assignment("01d4889c-1287-42c6-ac1f-5d1e02578ef6"),
      ],
      token: {
        source: "fresh-after-assignment-read",
        audience: "https://graph.microsoft.com",
        applicationId: PRODUCER_APP,
        tenantId: TENANT,
        assignmentSnapshotAt: "2026-07-29T12:00:00.000Z",
        acquiredAt: "2026-07-29T12:00:01.000Z",
      },
    },
    detector: {
      actorId: "audit-observer-app",
      applicationId: DETECTOR_APP,
      servicePrincipalId: DETECTOR_SP,
      tenantId: TENANT,
      installation: "application-and-service-principal-present",
      assignedApplicationRoles: [
        assignment("b0afded3-3588-46d8-8b3d-9842eff778da"),
      ],
      token: {
        source: "fresh-after-assignment-read",
        audience: "https://graph.microsoft.com",
        applicationId: DETECTOR_APP,
        tenantId: TENANT,
        assignmentSnapshotAt: "2026-07-29T12:00:00.000Z",
        acquiredAt: "2026-07-29T12:00:02.000Z",
      },
    },
    recovery: {
      actorId: "recon-recovery-administrator",
      principalObjectId: RECOVERY,
      ownership: "independent-human-administrator",
    },
    evidence: {
      producerActorId: "recon-workload-app",
      detectorActorId: "audit-observer-app",
      sourceApplicationId: PRODUCER_APP,
      sourceServicePrincipalId: PRODUCER_SP,
      observerApplicationId: DETECTOR_APP,
      marker: "ap2-application-recon-window",
      windowStart: "2026-07-29T12:00:00.000Z",
      windowEnd: "2026-07-29T12:15:00.000Z",
      detectorGeneratedEvidence: false,
      correlation: "exact-producer-token-event-in-marker-window",
    },
  };
}

describe("distinct application identity readiness", () => {
  it("binds exact identities, permissions, tokens, evidence, and recovery", () => {
    const result = verifyDistinctApplicationIdentityReadiness(input(),
    );
    expect(result).toMatchObject({
      status: "ready",
      identity: {
        applications: "distinct",
        servicePrincipals: "distinct",
        tenant: "exact-shared",
      },
      permissions: {
        producer: "exact-least-required",
        detector: "exact-least-required",
        overlap: "none",
      },
      evidence: {
        attribution: "token-event-only",
        perRequestAttribution: "not-proven",
      },
    });
    expect(result.status === "ready" &&
      result.bindingDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.status === "ready" && result.runtimeBinding).toEqual({
      producer: {
        applicationId: PRODUCER_APP,
        servicePrincipalId: PRODUCER_SP,
        tenantId: TENANT,
      },
      detector: {
        applicationId: DETECTOR_APP,
        servicePrincipalId: DETECTOR_SP,
        tenantId: TENANT,
      },
      evidence: {
        sourceApplicationId: PRODUCER_APP,
        sourceServicePrincipalId: PRODUCER_SP,
        observerApplicationId: DETECTOR_APP,
        marker: "ap2-application-recon-window",
        windowStart: "2026-07-29T12:00:00.000Z",
        windowEnd: "2026-07-29T12:15:00.000Z",
      },
    });
    const output = JSON.stringify(
      result.status === "ready"
        ? summarizeDistinctApplicationIdentityReadiness(result)
        : result,
    );
    for (const raw of [
      TENANT,
      PRODUCER_APP,
      PRODUCER_SP,
      DETECTOR_APP,
      DETECTOR_SP,
      RECOVERY,
    ]) expect(output).not.toContain(raw);
  });

  it.each([
    ["same application", (value: any) => {
      value.detector.applicationId = value.producer.applicationId;
      value.detector.token.applicationId = value.producer.applicationId;
    }, "identity-conflation"],
    ["same service principal", (value: any) => {
      value.detector.servicePrincipalId = value.producer.servicePrincipalId;
    }, "identity-conflation"],
    ["different tenant", (value: any) => {
      value.detector.tenantId = "77777777-7777-4777-8777-777777777777";
      value.detector.token.tenantId = value.detector.tenantId;
    }, "tenant-mismatch"],
    ["missing assignment", (value: any) => {
      value.detector.assignedApplicationRoles = [];
    }, "permission-mismatch"],
    ["extra broad assignment", (value: any) => {
      value.detector.assignedApplicationRoles.push(
        assignment("df021288-bdef-4463-88db-98f22de89214"),
      );
    }, "permission-mismatch"],
    ["permission overlap", (value: any) => {
      value.detector.assignedApplicationRoles.push(
        value.producer.assignedApplicationRoles[0],
      );
    }, "permission-overlap"],
    ["cached token", (value: any) => {
      value.detector.token.acquiredAt = "2026-07-29T11:59:59.000Z";
    }, "token-not-fresh"],
    ["wrong token audience", (value: any) => {
      value.detector.token.audience = "https://management.azure.com";
    }, "token-audience-mismatch"],
    ["token identity substitution", (value: any) => {
      value.detector.token.applicationId = value.producer.applicationId;
    }, "token-identity-mismatch"],
    ["recovery conflation", (value: any) => {
      value.recovery.principalObjectId = value.detector.servicePrincipalId;
    }, "recovery-not-independent"],
    ["detector created evidence", (value: any) => {
      value.evidence.detectorGeneratedEvidence = true;
    }, "detector-produced-evidence"],
    ["unproven correlation", (value: any) => {
      value.evidence.correlation = "time-only";
    }, "telemetry-correlation-unproven"],
    ["wrong marker", (value: any) => {
      value.evidence.marker = "ap2-another-recon-window";
    }, "marker-mismatch"],
    ["oversized window", (value: any) => {
      value.evidence.windowEnd = "2026-07-29T12:15:00.001Z";
    }, "invalid-window"],
    ["detector claims producer evidence", (value: any) => {
      value.evidence.sourceApplicationId = value.detector.applicationId;
    }, "evidence-owner-mismatch"],
  ])("fails closed for %s", (_label, mutate, blocker) => {
    const value = input();
    mutate(value);
    const result = verifyDistinctApplicationIdentityReadiness(value);
    expect(result.status).toBe("blocked");
    expect(result.status === "blocked" && result.blockers).toContain(blocker);
  });

  it("fails closed on scenario drift, unknown fields, and malformed exact identities", () => {
    const drifted = input();
    drifted.scenarioId = "another-scenario";
    expect(verifyDistinctApplicationIdentityReadiness(drifted))
      .toMatchObject({ status: "blocked", blockers: ["invalid-input"] });

    const extra = { ...input(), arbitrary: "not accepted" };
    expect(verifyDistinctApplicationIdentityReadiness(extra))
      .toMatchObject({ status: "blocked", blockers: ["invalid-input"] });

    const malformed = input();
    malformed.producer.applicationId = "not-an-id";
    expect(verifyDistinctApplicationIdentityReadiness(malformed))
      .toMatchObject({ status: "blocked", blockers: ["invalid-input"] });
  });
});
