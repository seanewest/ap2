// @vitest-environment node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PurviewAuditBoundaryRehearsalVerificationError,
  verifyPurviewAuditBoundaryRehearsalOutput,
  verifyPurviewAuditBoundaryRehearsalOutputText,
  type PurviewAuditBoundaryRehearsalVerificationFailure,
} from "./verify-purview-audit-boundary-rehearsal-output.ts";

const FIXTURE =
  "scripts/fixtures/purview-audit-boundary-rehearsal-output.json";
const CLI =
  "scripts/verify-purview-audit-boundary-rehearsal-output-cli.ts";

interface Fixture {
  schemaVersion: number;
  label: string;
  status: string;
  failure: string | null;
  binding: {
    scenarioId: string;
    manifestSchemaVersion: number;
    planDigestSha256: string;
    syntheticInputDigestSha256: string;
    receiptDigestSha256: string;
    outputDigestSha256: string;
  };
  stages: Record<string, string>;
  syntheticObservation: {
    terminalState: string;
    sourcePages: string;
    deduplication: string;
    adapterObservation: string;
  };
  receipt: {
    adapterCandidateAccepted: boolean;
    verifierAccepted: boolean;
    candidateClaimCount: number;
    syntheticProvenClaimCount: number;
    duplicatePageClaimCount: number;
    allUnsupportedClaims: string;
  };
  envelope: {
    terminalState: string;
    observationSource: string;
    externalEvidence: string;
    claims: Record<string, string>;
  };
  [key: string]: unknown;
}

function fixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
}

function category(
  action: () => unknown,
): PurviewAuditBoundaryRehearsalVerificationFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      PurviewAuditBoundaryRehearsalVerificationError,
    );
    return (error as PurviewAuditBoundaryRehearsalVerificationError).category;
  }
  throw new Error("Expected verifier refusal.");
}

describe("offline Purview audit-boundary rehearsal output verifier", () => {
  it("accepts the independently committed output fixture", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "0851eab44bb5425ecaf222e39a26cc4f704f014e1f8590210f74fbe1e3fead83",
    );
    const summary = verifyPurviewAuditBoundaryRehearsalOutput(
      JSON.parse(text),
    );
    expect(summary).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      scenarioId: "purview-sharepoint-audit-boundary",
      manifestSchemaVersion: 2,
      planDigestSha256:
        "8332f86c4f6db90697287c12ccfd603165eb383226a25511ccee3df5028e195c",
      syntheticInputDigestSha256:
        "87dc4bae807c8fbb77655a46f833669bdef074dc14f1c797fae4997423d10076",
      receiptDigestSha256:
        "5cd8f96cc4c082f5c60c8457b858f68c8d4e4a3e797d76a3a40603ed42655642",
      outputDigestSha256:
        "6263da51e58764d2e925207925131c5b5413e4a59f6396093be096b2b70fa352",
      syntheticContract:
        "deduplicated-producer-attribution-terminal-verified",
      adapter: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
      externalEvidence: "all-uninspected",
      claimCount: 14,
      producerAttributionClaimCount: 1,
    });
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it("is deterministic and never imports or invokes the pipeline fake", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(verifyPurviewAuditBoundaryRehearsalOutputText(text)).toEqual(
      verifyPurviewAuditBoundaryRehearsalOutputText(text),
    );
    const source = readFileSync(
      "scripts/verify-purview-audit-boundary-rehearsal-output.ts",
      "utf8",
    );
    expect(source).not.toContain(
      "createDeterministicPurviewAuditBoundarySyntheticDetector",
    );
    expect(source).not.toContain("runPurviewAuditBoundaryRehearsal");
    expect(source).not.toMatch(/\bfetch\s*\(|\bwriteFile|\bretry\b/i);
    expect(source).not.toMatch(
      /GraphServiceClient|submitAuditSearch|readAuditSearch|https?:\/\//i,
    );
    expect(source).toContain("adaptPurviewOperationToReceipt");
    expect(source).toContain("verifyScenarioEvidenceReceipt");
    expect(source).toContain("declareRehearsalEnvelope");
  });

  it("rejects missing, extra, and reordered fields at every boundary", () => {
    const missing = fixture();
    delete (missing as Partial<Fixture>).receipt;
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.raw = "synthetic";
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const reordered = fixture();
    reordered.binding = Object.fromEntries(
      Object.entries(reordered.binding).reverse(),
    ) as Fixture["binding"];
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");

    const nested = fixture();
    delete nested.envelope.claims.cleanup;
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutput(nested)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects malformed, duplicate-key, compact, and oversized JSON", () => {
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutputText("{")
    )).toBe("NON_CANONICAL_JSON");
    const canonical = readFileSync(FIXTURE, "utf8");
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutputText(canonical.replace(
        '  "schemaVersion": 1,',
        '  "schemaVersion": 1,\n  "schemaVersion": 1,',
      ))
    )).toBe("NON_CANONICAL_JSON");
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutputText(JSON.stringify(fixture()))
    )).toBe("NON_CANONICAL_JSON");
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutputText(
        `${" ".repeat(32 * 1024)}\n`,
      )
    )).toBe("INPUT_OVERSIZED");
  });

  it("rejects scenario, plan, input, receipt, and output digest drift", () => {
    const mutations: Array<[() => Fixture, string]> = [
      [() => {
        const value = fixture();
        value.binding.scenarioId = "oauth-application-reconnaissance";
        return value;
      }, "PLAN_BINDING"],
      [() => {
        const value = fixture();
        value.binding.manifestSchemaVersion = 1;
        return value;
      }, "PLAN_BINDING"],
      [() => {
        const value = fixture();
        value.binding.planDigestSha256 = "0".repeat(64);
        return value;
      }, "PLAN_BINDING"],
      [() => {
        const value = fixture();
        value.binding.syntheticInputDigestSha256 = "0".repeat(64);
        return value;
      }, "INPUT_BINDING"],
      [() => {
        const value = fixture();
        value.binding.receiptDigestSha256 = "0".repeat(64);
        return value;
      }, "RECEIPT_BINDING"],
      [() => {
        const value = fixture();
        value.binding.outputDigestSha256 = "0".repeat(64);
        return value;
      }, "OUTPUT_BINDING"],
    ];
    for (const [mutate, expected] of mutations) {
      expect(category(() =>
        verifyPurviewAuditBoundaryRehearsalOutput(mutate())
      )).toBe(expected);
    }
  });

  it("rejects order, cardinality, deduplication, and nonterminal drift", () => {
    const mutations: Array<[() => Fixture, string]> = [
      [() => {
        const value = fixture();
        value.syntheticObservation.sourcePages = "synthetic-pages-reordered";
        return value;
      }, "OBSERVATION_SEQUENCE"],
      [() => {
        const value = fixture();
        value.syntheticObservation.sourcePages = "synthetic-three-pages";
        return value;
      }, "OBSERVATION_SEQUENCE"],
      [() => {
        const value = fixture();
        value.syntheticObservation.terminalState = "synthetic-ambiguous";
        return value;
      }, "OBSERVATION_SEQUENCE"],
      [() => {
        const value = fixture();
        value.syntheticObservation.deduplication =
          "synthetic-two-unique-matches";
        return value;
      }, "DEDUPLICATION_MISMATCH"],
      [() => {
        const value = fixture();
        value.receipt.duplicatePageClaimCount = 2;
        return value;
      }, "DEDUPLICATION_MISMATCH"],
      [() => {
        const value = fixture();
        value.status = "refused";
        return value;
      }, "RUN_NONTERMINAL"],
    ];
    for (const [mutate, expected] of mutations) {
      expect(category(() =>
        verifyPurviewAuditBoundaryRehearsalOutput(mutate())
      )).toBe(expected);
    }
  });

  it("rejects every external claim promotion and receipt overclaim", () => {
    for (const claim of Object.keys(fixture().envelope.claims)) {
      const value = fixture();
      value.envelope.claims[claim] = "proven";
      expect(category(() =>
        verifyPurviewAuditBoundaryRehearsalOutput(value)
      )).toBe("EXTERNAL_CLAIM_MISMATCH");
    }
    const claimCount = fixture();
    claimCount.receipt.candidateClaimCount = 15;
    expect(category(() =>
      verifyPurviewAuditBoundaryRehearsalOutput(claimCount)
    )).toBe("RECEIPT_BINDING");
  });

  it("rejects unsafe identifiers, identities, paths, markers, and tokens", () => {
    const unsafeValues = [
      "00000000-0000-4000-8000-000000000000",
      "operator@example.test",
      "/home/operator/protected.json",
      "ap2lab-secret-marker",
      `eyJ${"a".repeat(24)}`,
      "client_secret",
    ];
    for (const unsafe of unsafeValues) {
      const value = fixture();
      value.binding.scenarioId = unsafe;
      expect(category(() =>
        verifyPurviewAuditBoundaryRehearsalOutput(value)
      )).toBe("UNSAFE_CONTENT");
    }
  });

  it("runs the bounded network-free CLI with stable refusal behavior", () => {
    const success = spawnSync(process.execPath, [CLI, FIXTURE], {
      encoding: "utf8",
    });
    expect(success.status).toBe(0);
    expect(success.stderr).toBe("");
    expect(JSON.parse(success.stdout)).toMatchObject({
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      externalEvidence: "all-uninspected",
    });

    const directory = mkdtempSync(join(
      tmpdir(),
      "ap2-purview-output-verifier-",
    ));
    const input = join(directory, "input.json");
    writeFileSync(input, JSON.stringify(fixture()), { mode: 0o600 });
    const refusal = spawnSync(process.execPath, [CLI, input], {
      encoding: "utf8",
    });
    expect(refusal.status).toBe(2);
    expect(refusal.stdout).toBe("");
    expect(JSON.parse(refusal.stderr)).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFICATION",
      status: "refused",
      failure: "NON_CANONICAL_JSON",
    });
  });
});
