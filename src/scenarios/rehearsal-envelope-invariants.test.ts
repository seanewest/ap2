import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RehearsalOutputVerificationError,
  verifyAvdThreeVmRehearsalOutput,
} from "../../scripts/verify-avd-three-vm-rehearsal-output.ts";
import {
  PrivateDocumentRehearsalVerificationError,
  verifyPrivateDocumentRehearsalOutput,
} from "../../scripts/verify-private-document-rehearsal-output.ts";
import {
  ALL_EXTERNAL_CLAIMS_UNINSPECTED,
  bindRehearsalPlan,
  declareRehearsalEnvelope,
  exactRehearsalRecord,
  inspectBoundedRehearsalValue,
  parseCanonicalRehearsalJson,
  REHEARSAL_ONLY_LABEL,
  REHEARSAL_VERIFIED_LABEL,
  SYNTHETIC_ONLY_OBSERVATIONS,
  TERMINAL_COMPLETE,
} from "./rehearsal-envelope-invariants.ts";

describe("shared rehearsal envelope invariants", () => {
  it("is browser/server-neutral and cannot invoke either family", () => {
    const source = readFileSync(join(
      process.cwd(),
      "src/scenarios/rehearsal-envelope-invariants.ts",
    ), "utf8");
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/from\s+["'][^"']*scripts\//);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(
      /\b(?:run|verify)(?:Avd|PrivateDocument|Rehearsal)/,
    );
  });

  it("exposes only fixed family-neutral declarations", () => {
    expect({
      input: REHEARSAL_ONLY_LABEL,
      verified: REHEARSAL_VERIFIED_LABEL,
      observations: SYNTHETIC_ONLY_OBSERVATIONS,
      claims: ALL_EXTERNAL_CLAIMS_UNINSPECTED,
      terminal: TERMINAL_COMPLETE,
    }).toEqual({
      input: "REHEARSAL_ONLY",
      verified: "REHEARSAL_ONLY_VERIFIED",
      observations: "synthetic-only",
      claims: "all-uninspected",
      terminal: "terminal-complete",
    });
  });

  it("parses bounded canonical JSON without normalizing field order", () => {
    const text = '{\n  "schemaVersion": 1,\n  "label": "REHEARSAL_ONLY"\n}\n';
    expect(parseCanonicalRehearsalJson(text, 1024)).toEqual({
      ok: true,
      value: { schemaVersion: 1, label: "REHEARSAL_ONLY" },
    });
    expect(parseCanonicalRehearsalJson(
      '{"label":"REHEARSAL_ONLY","schemaVersion":1}',
      1024,
    )).toEqual({ ok: false, failure: "NON_CANONICAL_JSON" });
    expect(parseCanonicalRehearsalJson("x".repeat(20), 10)).toEqual({
      ok: false,
      failure: "INPUT_OVERSIZED",
    });
    expect(parseCanonicalRehearsalJson(text, 0)).toEqual({
      ok: false,
      failure: "INPUT_SHAPE",
    });
  });

  it("rejects unsafe values and keys with UTF-8 cardinality bounds", () => {
    expect(inspectBoundedRehearsalValue({ safe: "value" }, 100))
      .toBeNull();
    expect(inspectBoundedRehearsalValue({ safe: "é" }, 12))
      .toBe("INPUT_OVERSIZED");
    expect(inspectBoundedRehearsalValue({
      [["person", "example.test"].join("@")]: "value",
    }, 1024)).toBe("UNSAFE_CONTENT");
    expect(inspectBoundedRehearsalValue({
      detail: ["run", "rawmarker"].join("-"),
    }, 1024)).toBe("UNSAFE_CONTENT");
  });

  it("requires exact ordered record shape", () => {
    expect(exactRehearsalRecord(
      { schemaVersion: 1, label: REHEARSAL_ONLY_LABEL },
      ["schemaVersion", "label"],
    )).not.toBeNull();
    expect(exactRehearsalRecord(
      { label: REHEARSAL_ONLY_LABEL, schemaVersion: 1 },
      ["schemaVersion", "label"],
    )).toBeNull();
    expect(exactRehearsalRecord(
      { schemaVersion: 1, label: REHEARSAL_ONLY_LABEL, extra: true },
      ["schemaVersion", "label"],
    )).toBeNull();
  });

  it("binds exact scenario, manifest version, and plan digest", () => {
    const digest = "a".repeat(64);
    expect(bindRehearsalPlan({
      scenarioId: "scenario-one",
      expectedScenarioId: "scenario-one",
      manifestSchemaVersion: 2,
      expectedManifestSchemaVersion: 2,
      planDigestSha256: digest,
      expectedPlanDigestSha256: digest,
    })).toEqual({
      ok: true,
      value: {
        scenarioId: "scenario-one",
        manifestSchemaVersion: 2,
        planDigestSha256: digest,
      },
    });
    for (
      const changed of [
        { scenarioId: "scenario-two" },
        { manifestSchemaVersion: 1 },
        { planDigestSha256: "b".repeat(64) },
      ]
    ) {
      expect(bindRehearsalPlan({
        scenarioId: "scenario-one",
        expectedScenarioId: "scenario-one",
        manifestSchemaVersion: 2,
        expectedManifestSchemaVersion: 2,
        planDigestSha256: digest,
        expectedPlanDigestSha256: digest,
        ...changed,
      })).toEqual({ ok: false, failure: "PLAN_BINDING" });
    }
  });

  it("declares only terminal synthetic all-uninspected envelopes", () => {
    const valid = {
      label: REHEARSAL_ONLY_LABEL,
      status: "completed",
      failure: null,
      syntheticValues: ["synthetic", "synthetic-supplied"],
      externalClaims: {
        total: 7,
        uninspected: 7,
        nonUninspected: 0,
      },
    };
    expect(declareRehearsalEnvelope(valid)).toEqual({
      ok: true,
      value: {
        label: REHEARSAL_ONLY_LABEL,
        terminalState: TERMINAL_COMPLETE,
        observationSource: SYNTHETIC_ONLY_OBSERVATIONS,
        externalEvidence: ALL_EXTERNAL_CLAIMS_UNINSPECTED,
      },
    });
    expect(declareRehearsalEnvelope({
      ...valid,
      syntheticValues: ["learner-visible"],
    })).toEqual({ ok: false, failure: "SYNTHETIC_MISMATCH" });
    expect(declareRehearsalEnvelope({
      ...valid,
      externalClaims: {
        total: 7,
        uninspected: 6,
        nonUninspected: 1,
      },
    })).toEqual({
      ok: false,
      failure: "EXTERNAL_CLAIM_MISMATCH",
    });
    expect(declareRehearsalEnvelope({
      ...valid,
      status: "unresolved",
    })).toEqual({ ok: false, failure: "RUN_NONTERMINAL" });
    expect(declareRehearsalEnvelope({
      ...valid,
      externalClaims: {
        total: 513,
        uninspected: 513,
        nonUninspected: 0,
      },
    })).toEqual({
      ok: false,
      failure: "EXTERNAL_CLAIM_MISMATCH",
    });
  });

  it("cannot substitute one rehearsal family for the other", () => {
    const avd = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/avd-three-vm-rehearsal-output.json",
    ), "utf8"));
    const privateDocument = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
    ), "utf8"));
    expect(() => verifyPrivateDocumentRehearsalOutput(avd)).toThrow(
      PrivateDocumentRehearsalVerificationError,
    );
    expect(() => verifyAvdThreeVmRehearsalOutput(privateDocument)).toThrow(
      RehearsalOutputVerificationError,
    );
  });

  it("leaves scenario-specific required fields with each family", () => {
    const avd = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/avd-three-vm-rehearsal-output.json",
    ), "utf8")) as Record<string, unknown>;
    delete avd.runnerJournal;
    expect(() => verifyAvdThreeVmRehearsalOutput(avd)).toThrow(
      RehearsalOutputVerificationError,
    );

    const privateDocument = JSON.parse(readFileSync(join(
      process.cwd(),
      "scripts/fixtures/private-document-rehearsal-output-cleaned.json",
    ), "utf8")) as Record<string, unknown>;
    delete privateDocument.fakeRun;
    expect(() =>
      verifyPrivateDocumentRehearsalOutput(privateDocument)
    ).toThrow(PrivateDocumentRehearsalVerificationError);
  });
});
