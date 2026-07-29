// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SCENARIO_RECEIPT_API_CAPABILITY } from "../../api/scenario-evidence-verification.ts";
import { SCENARIO_PLAN_API_CAPABILITY } from "../../api/scenario-plan.ts";
import { REHEARSAL_OUTPUT_VERIFICATION_API_CAPABILITY } from "../../api/rehearsal-output-verification.ts";
import { BATCH_FEASIBILITY_API_CAPABILITY } from "../../api/multi-scenario-feasibility.ts";
import { PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_API_CAPABILITY } from "../../api/private-document-rehearsal-verification.ts";
import { AVD_MANIFEST_ADAPTER_CAPABILITY } from "../../scripts/avd-three-vm-manifest-adapter.ts";
import { AVD_THREE_VM_REHEARSAL_CAPABILITY } from "../../scripts/avd-three-vm-rehearsal.ts";
import { HELP_DESK_EMAIL_REHEARSAL_CAPABILITY } from "../../scripts/help-desk-email-rehearsal.ts";
import { PRIVATE_DOCUMENT_REHEARSAL_CAPABILITY } from "../../scripts/private-document-rehearsal.ts";
import { SCENARIO_API_CLIENT_CAPABILITIES } from "../api/client.ts";
import { SCENARIO_CATALOG_UI_CAPABILITY } from "./scenario-catalog.ts";
import { SCENARIO_PLAN_PREVIEW_UI_CAPABILITY } from "./scenario-plan-preview.ts";
import { SCENARIO_RECEIPT_VERIFICATION_UI_CAPABILITY } from "./scenario-evidence-verification-panel.ts";
import { PRIVATE_DOCUMENT_RECEIPT_ADAPTER_CAPABILITY } from "./private-document-receipt-adapter.ts";
import {
  formatScenarioSurfaceInventory,
  inventoryCanonicalScenarioSurfaces,
  type ScenarioInventoryFailureCode,
  type ScenarioSurfaceInventoryOptions,
} from "./scenario-surface-inventory.ts";
import { SCENARIO_MANIFESTS } from "./scenarios.ts";

function surfaceDeclarations(): unknown[] {
  return structuredClone([
    BATCH_FEASIBILITY_API_CAPABILITY,
    PRIVATE_DOCUMENT_REHEARSAL_VERIFICATION_API_CAPABILITY,
    SCENARIO_PLAN_API_CAPABILITY,
    SCENARIO_RECEIPT_API_CAPABILITY,
    REHEARSAL_OUTPUT_VERIFICATION_API_CAPABILITY,
    ...SCENARIO_API_CLIENT_CAPABILITIES,
    SCENARIO_CATALOG_UI_CAPABILITY,
    SCENARIO_PLAN_PREVIEW_UI_CAPABILITY,
    SCENARIO_RECEIPT_VERIFICATION_UI_CAPABILITY,
    AVD_THREE_VM_REHEARSAL_CAPABILITY,
    HELP_DESK_EMAIL_REHEARSAL_CAPABILITY,
    PRIVATE_DOCUMENT_REHEARSAL_CAPABILITY,
  ]);
}

function adapterDeclarations(): unknown[] {
  return structuredClone([
    AVD_MANIFEST_ADAPTER_CAPABILITY,
    PRIVATE_DOCUMENT_RECEIPT_ADAPTER_CAPABILITY,
  ]);
}

function failureCodes(
  options: ScenarioSurfaceInventoryOptions,
): ScenarioInventoryFailureCode[] {
  return inventoryCanonicalScenarioSurfaces(options).failures.map(
    ({ code }) => code,
  );
}

describe("canonical scenario surface inventory", () => {
  it("enumerates every canonical scenario deterministically and honestly", () => {
    const first = inventoryCanonicalScenarioSurfaces();
    const second = inventoryCanonicalScenarioSurfaces();

    expect(second).toEqual(first);
    expect(first.status).toBe("valid");
    expect(first.failures).toEqual([]);
    expect(first.scenarios.map(({ scenarioId }) => scenarioId)).toEqual(
      [...SCENARIO_MANIFESTS.map(({ id }) => id)].sort(),
    );
    for (const row of first.scenarios) {
      expect(row.surfaces.manifest.status).toBe("implemented");
      expect(row.surfaces.plan.status).toBe("implemented");
      expect(row.surfaces.receipt.status).toBe("implemented");
      expect(row.surfaces["authenticated-plan-api-client"].status).toBe(
        "implemented",
      );
      expect(
        row.surfaces["authenticated-batch-feasibility-api-client"].status,
      ).toBe("implemented");
      expect(row.surfaces["operator-read-ui"].status).toBe("implemented");
      expect(row.surfaces["operator-preview-ui"].status).toBe("implemented");
      expect(row.surfaces["operator-verify-ui"]).toEqual({
        status: "implemented",
        reason: "operator-receipt-verify-ui-exported",
      });
    }

    const avd = first.scenarios.find(
      ({ scenarioId }) => scenarioId === "avd-three-vm-substrate",
    )!;
    expect(avd.surfaces.adapter.status).toBe("implemented");
    expect(avd.surfaces.rehearsal.status).toBe("implemented");
    expect(
      avd.surfaces[
        "authenticated-rehearsal-verification-api-client"
      ].status,
    ).toBe("implemented");

    const privateDocument = first.scenarios.find(
      ({ scenarioId }) => scenarioId === "private-document-evidence",
    )!;
    expect(privateDocument.surfaces.adapter.status).toBe("implemented");
    expect(privateDocument.surfaces.rehearsal.status).toBe("implemented");
    expect(
      privateDocument.surfaces["authenticated-receipt-api-client"],
    ).toEqual({
      status: "missing",
      reason: "authenticated-receipt-api-client-missing",
    });
    expect(
      privateDocument.surfaces[
        "authenticated-rehearsal-verification-api-client"
      ].status,
    ).toBe("implemented");

    const helpDesk = first.scenarios.find(
      ({ scenarioId }) => scenarioId === "help-desk-email-observation",
    )!;
    expect(helpDesk.surfaces.adapter.status).toBe("implemented");
    expect(helpDesk.surfaces.rehearsal.status).toBe("implemented");

    const teams = first.scenarios.find(
      ({ scenarioId }) => scenarioId === "teams-missed-call-observation",
    )!;
    expect(teams.surfaces.adapter.status).toBe("implemented");
    expect(teams.surfaces.rehearsal.status).toBe("implemented");

    const oauthRecon = first.scenarios.find(
      ({ scenarioId }) => scenarioId === "oauth-application-reconnaissance",
    )!;
    expect(oauthRecon.surfaces.adapter.status).toBe("implemented");
    expect(oauthRecon.surfaces.rehearsal.status).toBe("implemented");

    for (
      const row of first.scenarios.filter(
        ({ scenarioId }) =>
          scenarioId !== "avd-three-vm-substrate" &&
          scenarioId !== "private-document-evidence" &&
          scenarioId !== "help-desk-email-observation" &&
          scenarioId !== "teams-missed-call-observation" &&
          scenarioId !== "oauth-application-reconnaissance",
      )
    ) {
      expect(row.surfaces.adapter.status).toBe("not-applicable");
      expect(row.surfaces.rehearsal.status).toBe("missing");
      expect(
        row.surfaces["authenticated-receipt-api-client"].status,
      ).toBe("implemented");
      expect(
        row.surfaces[
          "authenticated-rehearsal-verification-api-client"
        ].status,
      ).toBe("missing");
    }
  });

  it("emits only bounded canonical IDs and fixed categorical cells", () => {
    const inventory = inventoryCanonicalScenarioSurfaces();
    const output = formatScenarioSurfaceInventory(inventory);

    for (const manifest of SCENARIO_MANIFESTS) {
      for (const actor of manifest.actors) {
        expect(output).not.toContain(actor.id);
      }
      for (const operation of manifest.operations) {
        expect(output).not.toContain(operation.key);
        expect(output).not.toContain(operation.marker ?? "not-present");
      }
      for (const artifact of manifest.evidence.artifacts) {
        expect(output).not.toContain(
          artifact.observation?.proofReference ?? "not-present",
        );
      }
    }
    expect(JSON.parse(output)).toEqual(inventory);
  });

  it("fails closed on duplicate and unknown canonical registry IDs", () => {
    expect(failureCodes({
      registry: [...SCENARIO_MANIFESTS, SCENARIO_MANIFESTS[0]],
    })).toContain("REGISTRY_DUPLICATE");

    const unknown = structuredClone(SCENARIO_MANIFESTS[0]) as {
      id: string;
    };
    unknown.id = "unknown-scenario";
    expect(failureCodes({
      registry: [...SCENARIO_MANIFESTS.slice(1), unknown],
    })).toContain("SCENARIO_UNKNOWN");

    expect(failureCodes({
      registry: SCENARIO_MANIFESTS.slice(1),
    })).toContain("REGISTRY_INCOMPLETE");
  });

  it("rejects unsafe identifiers and live-proof language without echoing", () => {
    const raw = surfaceDeclarations();
    const unsafeAlias = ["learner", "example.invalid"].join("@");
    Object.assign(raw[0] as object, {
      scenarioScope: "explicit-scenarios",
      scenarioIds: [unsafeAlias],
    });
    const rawResult = inventoryCanonicalScenarioSurfaces({
      surfaceDeclarations: raw,
    });
    expect(rawResult.failures.map(({ code }) => code)).toContain(
      "RAW_IDENTIFIER",
    );
    expect(formatScenarioSurfaceInventory(rawResult)).not.toContain(
      unsafeAlias,
    );

    const rawActor = structuredClone(SCENARIO_MANIFESTS[0]) as unknown;
    const actorRecord = rawActor as {
      actors: Array<{ id: string }>;
    };
    const oldActorId = actorRecord.actors[0]!.id;
    const rawActorId = [
      "11111111",
      "1111",
      "1111",
      "1111",
      "111111111111",
    ].join("-");
    replaceExactString(rawActor, oldActorId, rawActorId);
    const rawActorResult = inventoryCanonicalScenarioSurfaces({
      registry: [rawActor, ...SCENARIO_MANIFESTS.slice(1)],
    });
    expect(rawActorResult.failures.map(({ code }) => code)).toContain(
      "RAW_IDENTIFIER",
    );
    expect(formatScenarioSurfaceInventory(rawActorResult)).not.toContain(
      rawActorId,
    );

    const live = surfaceDeclarations();
    Object.assign(live[0] as object, {
      repositoryBoundary: "live-platform-proof",
    });
    const liveResult = inventoryCanonicalScenarioSurfaces({
      surfaceDeclarations: live,
    });
    expect(liveResult.failures.map(({ code }) => code)).toContain(
      "LIVE_PROOF_LANGUAGE",
    );
    expect(formatScenarioSurfaceInventory(liveResult)).not.toContain(
      "live-platform-proof",
    );
  });

  it("pinpoints stale, duplicate, and unsupported surface declarations", () => {
    const stale = surfaceDeclarations();
    Object.assign(stale[0] as object, { manifestSchemaVersion: 1 });
    expect(failureCodes({ surfaceDeclarations: stale })).toContain(
      "STALE_MANIFEST_VERSION",
    );

    const duplicate = surfaceDeclarations();
    duplicate.push(structuredClone(duplicate[0]));
    expect(failureCodes({ surfaceDeclarations: duplicate })).toContain(
      "DECLARATION_DUPLICATE",
    );

    const fakeUi = surfaceDeclarations();
    const verifyUi = fakeUi.find(
      (candidate) =>
        (candidate as { surface?: unknown }).surface ===
        "operator-receipt-verify-ui",
    ) as Record<string, unknown>;
    verifyUi.scenarioScope = "explicit-scenarios";
    verifyUi.scenarioIds = ["help-desk-email-observation"];
    const fakeUiResult = inventoryCanonicalScenarioSurfaces({
      surfaceDeclarations: fakeUi,
    });
    expect(fakeUiResult.failures.map(({ code }) => code)).toContain(
      "UNSUPPORTED_SURFACE_CLAIM",
    );
    expect(
      fakeUiResult.scenarios.every(
        (row) => row.surfaces["operator-verify-ui"].status === "missing",
      ),
    ).toBe(true);
  });

  it("rejects unsupported adapter claims and adapter contract drift", () => {
    const unsupported = adapterDeclarations();
    Object.assign(unsupported[0] as object, {
      scenarioId: "oauth-application-reconnaissance",
    });
    const result = inventoryCanonicalScenarioSurfaces({
      adapterDeclarations: unsupported,
    });

    expect(result.status).toBe("invalid");
    expect(result.failures.map(({ code }) => code)).toContain(
      "UNSUPPORTED_ADAPTER_CLAIM",
    );
    expect(result.failures.map(({ code }) => code)).toContain(
      "ADAPTER_CONTRACT_DRIFT",
    );
  });

  it("keeps undeclared optional surfaces missing without invalidating", () => {
    const declarations = surfaceDeclarations().filter(
      (candidate) =>
        (candidate as { surface?: unknown }).surface !==
          "operator-plan-preview-ui" &&
        (candidate as { surface?: unknown }).surface !== "rehearsal-only",
    );
    const result = inventoryCanonicalScenarioSurfaces({
      surfaceDeclarations: declarations,
    });

    expect(result.status).toBe("valid");
    expect(result.failures).toEqual([]);
    expect(
      result.scenarios.every(
        (row) => row.surfaces["operator-preview-ui"].status === "missing",
      ),
    ).toBe(true);
    expect(
      result.scenarios.every(
        (row) => row.surfaces.rehearsal.status === "missing",
      ),
    ).toBe(true);
  });

  it("bounds declarations and output failures", () => {
    const tooMany = Array.from(
      { length: 33 },
      () => structuredClone(SCENARIO_PLAN_API_CAPABILITY),
    );
    expect(inventoryCanonicalScenarioSurfaces({
      surfaceDeclarations: tooMany,
    })).toEqual({
      schemaVersion: 1,
      kind: "canonical-scenario-surface-inventory",
      status: "invalid",
      scenarios: [],
      failures: [{
        scenarioId: "unknown",
        surface: "inventory",
        code: "BOUNDS_EXCEEDED",
      }],
    });
  });
});

function replaceExactString(
  value: unknown,
  before: string,
  after: string,
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === before) {
        value[index] = after;
      } else {
        replaceExactString(value[index], before, after);
      }
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (child === before) {
      (value as Record<string, unknown>)[key] = after;
    } else {
      replaceExactString(child, before, after);
    }
  }
}
