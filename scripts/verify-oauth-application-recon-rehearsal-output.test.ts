// @vitest-environment node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OauthApplicationReconRehearsalVerificationError,
  verifyOauthApplicationReconRehearsalOutput,
  verifyOauthApplicationReconRehearsalOutputText,
  type OauthApplicationReconRehearsalVerificationFailure,
} from "./verify-oauth-application-recon-rehearsal-output.ts";

const FIXTURE =
  "scripts/fixtures/oauth-application-recon-rehearsal-output.json";
const CLI =
  "scripts/verify-oauth-application-recon-rehearsal-output-cli.ts";

interface Fixture {
  schemaVersion: number;
  label: string;
  status: string;
  failure: string | null;
  binding: {
    scenarioId: string;
    manifestSchemaVersion: number;
    planDigestSha256: string;
    fakeResultDigestSha256: string;
  };
  stages: Record<string, string>;
  fakeRun: {
    terminalState: string;
    orderedReads: string[];
    collectionBoundary: string;
    evidenceBoundary: string;
    detector: string;
    learner: string;
    permissionRestoration: string;
    cleanup: string;
  };
  receipt: {
    adapterCandidateAccepted: boolean;
    verifierAccepted: boolean;
    candidateClaimCount: number;
    syntheticReachability: string;
    allOtherClaims: string;
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
): OauthApplicationReconRehearsalVerificationFailure {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      OauthApplicationReconRehearsalVerificationError,
    );
    return (error as OauthApplicationReconRehearsalVerificationError).category;
  }
  throw new Error("Expected verifier refusal.");
}

describe("offline OAuth application-recon rehearsal output verifier", () => {
  it("accepts the independently committed output fixture", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "acb0dc150579606606b61ac4cb81366a622f35b9df46ca31f24c01e8422f7f9d",
    );
    const summary = verifyOauthApplicationReconRehearsalOutput(
      JSON.parse(text),
    );
    expect(summary).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      scenarioId: "oauth-application-reconnaissance",
      manifestSchemaVersion: 2,
      planDigestSha256:
        "684176156e1922802a25500095726183ca02a89fb019f9143de53aa1be201fe7",
      fakeResultDigestSha256:
        "1e10c070c8c8e10d5cc179cacf523cf2156508500ac0de842eaab7218bf79080",
      outputDigestSha256:
        "1d89edb8b710176d63026723b842d4e1e36f801b3abf058fb36dbc6617a5c9bc",
      fakeContract: "ordered-four-read-terminal-verified",
      adapter: "accepted",
      receiptVerifier: "accepted",
      envelope: "accepted",
      externalEvidence: "all-uninspected",
      claimCount: 13,
    });
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it("verifies canonical fixture text deterministically", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(verifyOauthApplicationReconRehearsalOutputText(text)).toEqual(
      verifyOauthApplicationReconRehearsalOutputText(text),
    );
  });

  it("does not import or invoke the PR #111 fake or pipeline runner", () => {
    const source = readFileSync(
      "scripts/verify-oauth-application-recon-rehearsal-output.ts",
      "utf8",
    );
    expect(source).not.toContain(
      "createDeterministicOauthApplicationReconFakeFourRead",
    );
    expect(source).not.toContain("runOauthApplicationReconRehearsal");
    expect(source).not.toMatch(/\.execute\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bhttps?:\/\//);
    expect(source).not.toMatch(/\bwriteFile/);
    expect(source).not.toMatch(/\bretry\b/i);
    expect(source).not.toMatch(
      /acquireToken|GraphServiceClient|oauth.*request|tenant.*read/i,
    );
    expect(source).toContain("adaptOauthApplicationReconToReceipt");
    expect(source).toContain("verifyScenarioEvidenceReceipt");
    expect(source).toContain("declareRehearsalEnvelope");
  });

  it("rejects missing, extra, and reordered top-level fields", () => {
    const missing = fixture();
    delete (missing as Partial<Fixture>).receipt;
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.detail = "safe";
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const value = fixture();
    const reordered = {
      label: value.label,
      schemaVersion: value.schemaVersion,
      ...Object.fromEntries(Object.entries(value).filter(
        ([key]) => !["label", "schemaVersion"].includes(key),
      )),
    };
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects missing, extra, and reordered nested fields", () => {
    const missing = fixture();
    delete missing.envelope.claims.cleanup;
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(missing)
    )).toBe("INPUT_SHAPE");

    const extra = fixture();
    extra.fakeRun = { ...extra.fakeRun, detail: "safe" } as
      typeof extra.fakeRun;
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(extra)
    )).toBe("INPUT_SHAPE");

    const reordered = fixture();
    const claims = reordered.envelope.claims;
    reordered.envelope.claims = {
      rawIdentities: claims.rawIdentities!,
      tenantContents: claims.tenantContents!,
      ...Object.fromEntries(Object.entries(claims).filter(
        ([key]) => !["rawIdentities", "tenantContents"].includes(key),
      )),
    };
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(reordered)
    )).toBe("INPUT_SHAPE");
  });

  it("rejects malformed, duplicate-key, compact, and oversized JSON", () => {
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutputText("{")
    )).toBe("NON_CANONICAL_JSON");
    const canonical = readFileSync(FIXTURE, "utf8");
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutputText(canonical.replace(
        '  "schemaVersion": 1,',
        '  "schemaVersion": 1,\n  "schemaVersion": 1,',
      ))
    )).toBe("NON_CANONICAL_JSON");
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutputText(
        JSON.stringify(fixture()),
      )
    )).toBe("NON_CANONICAL_JSON");
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutputText(
        `${" ".repeat(32 * 1024)}\n`,
      )
    )).toBe("INPUT_OVERSIZED");
  });

  it("rejects scenario, manifest, plan, fake, and output binding drift", () => {
    const mutations: Array<[() => Fixture, string]> = [
      [() => {
        const value = fixture();
        value.binding.scenarioId = "help-desk-email-observation";
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
        value.binding.fakeResultDigestSha256 = "0".repeat(64);
        return value;
      }, "FAKE_CONTRACT_BINDING"],
      [() => {
        const value = fixture();
        value.receipt.syntheticReachability =
          "synthetic-four-read-reachability";
        return value;
      }, "RECEIPT_REFUSED"],
    ];
    for (const [mutate, expected] of mutations) {
      expect(category(() =>
        verifyOauthApplicationReconRehearsalOutput(mutate())
      )).toBe(expected);
    }
  });

  it("rejects missing, reordered, duplicated, or foreign read categories", () => {
    const mutations = [
      (reads: string[]) => reads.slice(0, 3),
      (reads: string[]) => [reads[1]!, reads[0]!, ...reads.slice(2)],
      (reads: string[]) => [reads[0]!, reads[0]!, ...reads.slice(2)],
      (reads: string[]) => [...reads.slice(0, 3), "synthetic-other-reachable"],
    ];
    for (const mutate of mutations) {
      const value = fixture();
      value.fakeRun.orderedReads = mutate(value.fakeRun.orderedReads);
      expect(category(() =>
        verifyOauthApplicationReconRehearsalOutput(value)
      )).toBe("FAKE_SEQUENCE");
    }
  });

  it("rejects pagination uncertainty and ambiguous or nonterminal state", () => {
    const pagination = fixture();
    pagination.fakeRun.collectionBoundary = "synthetic-page-incomplete";
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(pagination)
    )).toBe("PAGINATION_UNCERTAIN");

    for (const state of [
      "synthetic-four-read-ambiguous",
      "synthetic-four-read-running",
    ]) {
      const value = fixture();
      value.fakeRun.terminalState = state;
      expect(category(() =>
        verifyOauthApplicationReconRehearsalOutput(value)
      )).toBe("RUN_NONTERMINAL");
    }
  });

  it.each([
    "detector",
    "learner",
    "permissionRestoration",
    "cleanup",
  ] as const)("rejects synthetic %s promotion", (field) => {
    const value = fixture();
    value.fakeRun[field] = "synthetic-proven";
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(value)
    )).toBe("EVIDENCE_OVERCLAIM");
  });

  it.each([
    "tenantContents",
    "rawIdentities",
    "externalArtifact",
    "detectorAttribution",
    "auditCompleteness",
    "learnerVisibility",
    "learnerInterpretation",
    "permissionRestoration",
    "evidenceWindowClosure",
    "cleanup",
    "retention",
    "revocation",
    "externalImpact",
  ])("keeps external claim %s uninspected", (claim) => {
    const value = fixture();
    value.envelope.claims[claim] = "proven";
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(value)
    )).toBe("EXTERNAL_CLAIM_MISMATCH");
  });

  it("rejects receipt acceptance, claim count, and reachability drift", () => {
    const mutations: Array<(value: Fixture) => void> = [
      (value) => {
        value.receipt.adapterCandidateAccepted = false;
      },
      (value) => {
        value.receipt.verifierAccepted = false;
      },
      (value) => {
        value.receipt.candidateClaimCount = 12;
      },
      (value) => {
        value.receipt.allOtherClaims = "proven";
      },
    ];
    for (const mutate of mutations) {
      const value = fixture();
      mutate(value);
      expect(category(() =>
        verifyOauthApplicationReconRehearsalOutput(value)
      )).toBe("RECEIPT_REFUSED");
    }
  });

  it.each([
    ["guid", ["00000000", "0000", "4000", "8000", "000000000000"].join("-")],
    ["upn", ["person", "example.test"].join("@")],
    ["private path", ["", "home", "example", "evidence.json"].join("/")],
    ["token", ["Bearer", "synthetic-secret-value"].join(" ")],
    ["marker", ["ap2lab", "private", "marker"].join("-")],
  ])("rejects unsafe/raw %s value", (_kind, unsafe) => {
    const value = fixture();
    value.detail = unsafe;
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(value)
    )).toBe("UNSAFE_CONTENT");
  });

  it("refuses cross-family envelopes", () => {
    const value = JSON.parse(readFileSync(
      "scripts/fixtures/help-desk-email-rehearsal-output-send.json",
      "utf8",
    ));
    expect(category(() =>
      verifyOauthApplicationReconRehearsalOutput(value)
    )).toBe("INPUT_SHAPE");
  });

  it("provides a bounded deterministic CLI without echoing input paths", () => {
    const success = spawnSync(process.execPath, [CLI, FIXTURE], {
      encoding: "utf8",
    });
    expect(success.status, success.stderr).toBe(0);
    expect(JSON.parse(success.stdout)).toMatchObject({
      label: "REHEARSAL_ONLY_VERIFIED",
      status: "verified",
      externalEvidence: "all-uninspected",
    });

    const directory = mkdtempSync(join(tmpdir(), "oauth-recon-verify-"));
    try {
      const badPath = join(directory, "private-input.json");
      writeFileSync(badPath, "{}\n", { mode: 0o600 });
      const failure = spawnSync(process.execPath, [CLI, badPath], {
        encoding: "utf8",
      });
      expect(failure.status).toBe(2);
      expect(JSON.parse(failure.stderr)).toEqual({
        schemaVersion: 1,
        label: "REHEARSAL_ONLY_VERIFICATION",
        status: "refused",
        failure: "INPUT_SHAPE",
      });
      expect(failure.stderr).not.toContain(badPath);
      expect(failure.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
