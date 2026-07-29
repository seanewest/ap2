// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalPurviewAuditBoundaryRehearsalRequest,
  canonicalPurviewAuditBoundarySyntheticObservation,
  compilePurviewAuditBoundaryRehearsalPlan,
  createDeterministicPurviewAuditBoundarySyntheticDetector,
  runPurviewAuditBoundaryRehearsal,
  type PurviewAuditBoundarySyntheticDetector,
} from "./purview-audit-boundary-rehearsal.ts";

const CLI = resolve("scripts/run-purview-audit-boundary-rehearsal.ts");
const CLI_FIXTURE = resolve(
  "scripts/fixtures/purview-audit-boundary-rehearsal.json",
);

type MutableSynthetic = ReturnType<
  typeof canonicalPurviewAuditBoundarySyntheticObservation
> & Record<string, unknown>;

function detector(value: unknown): PurviewAuditBoundarySyntheticDetector {
  return { observe: vi.fn(async () => structuredClone(value)) };
}

describe("Purview audit-boundary REHEARSAL_ONLY pipeline", () => {
  it("composes the canonical plan, synthetic detector, adapter, verifier, and shared envelope", async () => {
    const request = canonicalPurviewAuditBoundaryRehearsalRequest();
    const first = await runPurviewAuditBoundaryRehearsal(
      request,
      createDeterministicPurviewAuditBoundarySyntheticDetector(),
    );
    const second = await runPurviewAuditBoundaryRehearsal(
      structuredClone(request),
      createDeterministicPurviewAuditBoundarySyntheticDetector(),
    );

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toMatchObject({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      status: "completed",
      failure: null,
      binding: {
        scenarioId: "purview-sharepoint-audit-boundary",
        manifestSchemaVersion: 2,
        planDigestSha256:
          compilePurviewAuditBoundaryRehearsalPlan().digestSha256,
      },
      stages: {
        plan: "compiled",
        syntheticDetector: "completed",
        adapter: "accepted",
        syntheticBinding: "accepted",
        receiptVerifier: "accepted",
        envelope: "accepted",
      },
      syntheticObservation: {
        terminalState: "synthetic-deduplicated-operation-observation",
        sourcePages: "synthetic-two-pages-one-duplicate",
        deduplication: "synthetic-one-unique-match",
        adapterObservation: "synthetic-categorical-only",
      },
      receipt: {
        adapterCandidateAccepted: true,
        verifierAccepted: true,
        candidateClaimCount: 14,
        syntheticProvenClaimCount: 6,
        duplicatePageClaimCount: 1,
        allUnsupportedClaims: "uninspected",
      },
      envelope: {
        terminalState: "terminal-complete",
        observationSource: "synthetic-only",
        externalEvidence: "all-uninspected",
      },
    });
    expect(first.binding?.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.binding?.syntheticInputDigestSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(first.binding?.receiptDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.binding?.outputDigestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("deduplicates the synthetic two-page shape into exactly one producer-attribution claim", async () => {
    const result = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      createDeterministicPurviewAuditBoundarySyntheticDetector(),
    );

    expect(result.receipt?.duplicatePageClaimCount).toBe(1);
    expect(result.receipt?.syntheticProvenClaimCount).toBe(6);
    expect(JSON.stringify(result)).not.toContain("FileUploaded");
    expect(JSON.stringify(result)).not.toContain("marker-bearing");
  });

  it("keeps every external and unsupported claim uninspected", async () => {
    const result = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      createDeterministicPurviewAuditBoundarySyntheticDetector(),
    );

    expect(Object.keys(result.envelope?.claims ?? {})).toHaveLength(11);
    expect(
      Object.values(result.envelope?.claims ?? {}).every(
        (state) => state === "uninspected",
      ),
    ).toBe(true);
    expect(result.envelope?.claims).toMatchObject({
      auditSearchSubmission: "uninspected",
      auditSearchResultRead: "uninspected",
      liveSharePointOperation: "uninspected",
      operationAttribution: "uninspected",
      content: "uninspected",
      learnerVisibility: "uninspected",
      learnerInterpretation: "uninspected",
      response: "uninspected",
      cleanup: "uninspected",
      retention: "uninspected",
      externalImpact: "uninspected",
    });
  });

  it("runs the injected detector once with network access disabled", async () => {
    const observe = vi.fn(async () =>
      canonicalPurviewAuditBoundarySyntheticObservation()
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network forbidden");
    });
    try {
      const result = await runPurviewAuditBoundaryRehearsal(
        canonicalPurviewAuditBoundaryRehearsalRequest(),
        { observe },
      );
      expect(result.status).toBe("completed");
      expect(observe).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not retry an ambiguous or throwing detector", async () => {
    const ambiguous = mutableSynthetic();
    ambiguous.terminalState = "synthetic-ambiguous" as never;
    const ambiguousDetector = detector(ambiguous);
    const ambiguousResult = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      ambiguousDetector,
    );
    expect(ambiguousResult.failure).toBe("SYNTHETIC_AMBIGUOUS");
    expect(ambiguousDetector.observe).toHaveBeenCalledTimes(1);

    const observe = vi.fn(async () => {
      throw new Error("nonterminal");
    });
    const failed = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      { observe },
    );
    expect(failed.failure).toBe("SYNTHETIC_NONTERMINAL");
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["cross scenario", "SYNTHETIC_SCENARIO_MISMATCH", (value: MutableSynthetic) => {
      value.scenarioId = "private-document-evidence" as never;
    }],
    ["nonterminal", "SYNTHETIC_NONTERMINAL", (value: MutableSynthetic) => {
      value.terminalState = "synthetic-pending" as never;
    }],
    ["reordered pages", "SYNTHETIC_ORDER", (value: MutableSynthetic) => {
      value.sourcePages = "synthetic-pages-reordered" as never;
    }],
    ["wrong page cardinality", "SYNTHETIC_CARDINALITY", (value: MutableSynthetic) => {
      value.sourcePages = "synthetic-one-page" as never;
    }],
    ["missing deduplication", "SYNTHETIC_CARDINALITY", (value: MutableSynthetic) => {
      value.deduplication = "synthetic-duplicates-retained" as never;
    }],
    ["role conflation", "SYNTHETIC_BINDING", (value: MutableSynthetic) => {
      value.adapterInput.roles.detector = "sharepoint-workload-app" as never;
    }],
    ["mismatched workload", "SYNTHETIC_BINDING", (value: MutableSynthetic) => {
      value.adapterInput.result.workload = "Exchange" as never;
    }],
    ["missing correlation", "SYNTHETIC_BINDING", (value: MutableSynthetic) => {
      value.adapterInput.result.correlation = "absent" as never;
    }],
    ["surface-only overclaim", "SYNTHETIC_OVERCLAIM", (value: MutableSynthetic) => {
      value.adapterInput.result.status = "officially-supported" as never;
    }],
  ] as const)("refuses %s categorically", async (_name, failure, mutate) => {
    const value = mutableSynthetic();
    mutate(value);
    const result = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      detector(value),
    );
    expect(result.status).toBe("refused");
    expect(result.failure).toBe(failure);
    expect(result.binding).toBeNull();
    expect(result.receipt).toBeNull();
    expect(result.envelope).toBeNull();
  });

  it("refuses digest drift after an otherwise valid categorical observation", async () => {
    const changed = mutableSynthetic();
    changed.adapterInput.result.operation = "FileDeleted";
    const result = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      detector(changed),
    );
    expect(result.failure).toBe("SYNTHETIC_DIGEST");
    expect(result.stages.adapter).toBe("accepted");
    expect(result.stages.syntheticBinding).toBe("refused");
  });

  it("refuses missing, extra, and reordered request fields", async () => {
    const request = canonicalPurviewAuditBoundaryRehearsalRequest() as
      unknown as Record<string, unknown>;
    const missing = structuredClone(request);
    delete missing.planDigestSha256;
    const extra = { ...request, proof: "synthetic" };
    const reordered = Object.fromEntries(Object.entries(request).reverse());

    for (const value of [missing, extra, reordered]) {
      const result = await runPurviewAuditBoundaryRehearsal(
        value,
        createDeterministicPurviewAuditBoundarySyntheticDetector(),
      );
      expect(result.failure).toBe("INPUT_SCHEMA");
      expect(result.stages.syntheticDetector).toBe("not-run");
    }
  });

  it("refuses malformed synthetic shapes and unsafe raw values without output propagation", async () => {
    const missing = mutableSynthetic();
    delete (missing.adapterInput.result as unknown as Record<string, unknown>)
      .targetType;
    const extra = mutableSynthetic();
    extra.rawRecord = "opaque";
    const unsafe = mutableSynthetic();
    unsafe.rawRecord = [
      "00000000",
      "0000",
      "4000",
      "8000",
      "000000000000",
    ].join("-");

    expect(
      (await runPurviewAuditBoundaryRehearsal(
        canonicalPurviewAuditBoundaryRehearsalRequest(),
        detector(missing),
      )).failure,
    ).toBe("SYNTHETIC_SHAPE");
    expect(
      (await runPurviewAuditBoundaryRehearsal(
        canonicalPurviewAuditBoundaryRehearsalRequest(),
        detector(extra),
      )).failure,
    ).toBe("SYNTHETIC_SHAPE");
    const unsafeResult = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      detector(unsafe),
    );
    expect(unsafeResult.failure).toBe("SYNTHETIC_UNSAFE");
    expect(JSON.stringify(unsafeResult)).not.toContain("00000000");
  });

  it("refuses plan digest drift before invoking the detector", async () => {
    const request = canonicalPurviewAuditBoundaryRehearsalRequest();
    request.planDigestSha256 = "0".repeat(64);
    const observe = vi.fn(async () =>
      canonicalPurviewAuditBoundarySyntheticObservation()
    );
    const result = await runPurviewAuditBoundaryRehearsal(request, { observe });

    expect(result.failure).toBe("PLAN_BINDING");
    expect(observe).not.toHaveBeenCalled();
  });

  it("emits only bounded safe deterministic output", async () => {
    const result = await runPurviewAuditBoundaryRehearsal(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
      createDeterministicPurviewAuditBoundarySyntheticDetector(),
    );
    const serialized = JSON.stringify(result);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(8_192);
    expect(serialized).not.toMatch(
      /@|https?:|Bearer|eyJ|-----BEGIN|onmicrosoft|tenantId|objectId|recordId|marker-bearing|FileUploaded/i,
    );
  });

  it("runs through the bounded network-free CLI and refuses noncanonical input", () => {
    expect(JSON.parse(readFileSync(CLI_FIXTURE, "utf8"))).toEqual(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
    );
    const completed = spawnSync(process.execPath, [CLI, CLI_FIXTURE], {
      encoding: "utf8",
      env: { ...process.env, NO_PROXY: "*" },
    });
    expect(completed.status).toBe(0);
    expect(completed.stderr).toBe("");
    expect(JSON.parse(completed.stdout)).toMatchObject({
      label: "REHEARSAL_ONLY",
      status: "completed",
    });

    const directory = mkdtempSync(join(tmpdir(), "purview-rehearsal-test-"));
    const input = join(directory, "input.json");
    writeFileSync(
      input,
      `${JSON.stringify(
        canonicalPurviewAuditBoundaryRehearsalRequest(),
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    writeFileSync(input, JSON.stringify(
      canonicalPurviewAuditBoundaryRehearsalRequest(),
    ));
    const refused = spawnSync(process.execPath, [CLI, input], {
      encoding: "utf8",
    });
    expect(refused.status).toBe(2);
    expect(refused.stdout).toBe("");
    expect(JSON.parse(refused.stderr)).toMatchObject({
      label: "REHEARSAL_ONLY",
      status: "refused",
      failure: "NON_CANONICAL_JSON",
    });
  });
});

function mutableSynthetic(): MutableSynthetic {
  return structuredClone(
    canonicalPurviewAuditBoundarySyntheticObservation(),
  ) as MutableSynthetic;
}
