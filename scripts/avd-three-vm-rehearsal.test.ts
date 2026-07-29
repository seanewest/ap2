import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRehearsalReceiptInput,
  canonicalAvdThreeVmRehearsalRequest,
  compileRehearsalPlanStage,
  compileRehearsalRunnerPlanStage,
  executeRehearsalRunStage,
  runAvdThreeVmRehearsal,
  verifyRehearsalReceiptInput,
  type AvdThreeVmRehearsalRequest,
} from "./avd-three-vm-rehearsal";

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T[Key] extends object ? Mutable<T[Key]> : T[Key];
};

function request(): Mutable<AvdThreeVmRehearsalRequest> {
  return structuredClone(canonicalAvdThreeVmRehearsalRequest());
}

async function receiptFixture() {
  const input = request();
  const plan = compileRehearsalPlanStage(input);
  const runnerPlan = compileRehearsalRunnerPlanStage(input, plan);
  const run = await executeRehearsalRunStage(input, runnerPlan);
  const result = await runAvdThreeVmRehearsal(input);
  const observations = result.observations!;
  return {
    plan,
    run,
    observations,
    input: buildRehearsalReceiptInput(
      plan.plan.digestSha256,
      run,
      observations,
    ),
  };
}

describe("three-VM REHEARSAL_ONLY pipeline", () => {
  it("composes the real local contracts without claiming external evidence", async () => {
    const result = await runAvdThreeVmRehearsal(request());

    expect(result).toMatchObject({
      label: "REHEARSAL_ONLY",
      status: "completed",
      failure: null,
      stages: {
        plan: "compiled",
        run: "completed",
        observation: "collected",
        receipt: "verified-incomplete",
      },
      observations: {
        provenance: "synthetic",
        evidence: {
          proven: 4,
          notObserved: 1,
          failedOrMissing: 0,
        },
      },
      receipt: {
        verified: true,
        provenClaims: 0,
        binding: {
          runStatus: "completed",
          observationProvenance: "synthetic",
          cleanup: "synthetic-supplied",
          roleAbsence: "synthetic-supplied",
          retention: "synthetic-supplied",
        },
      },
    });
    expect(result.receipt?.uninspectedClaims).toBeGreaterThan(0);
    expect(result.runnerJournal.entries).toBeGreaterThan(0);
    expect(result.planDigestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is byte-for-byte deterministic for a fixed request", async () => {
    const input = request();
    expect(JSON.stringify(await runAvdThreeVmRehearsal(input))).toBe(
      JSON.stringify(await runAvdThreeVmRehearsal(input)),
    );
  });

  it("refuses schema, role, cost, and expiry drift before mutation", async () => {
    const schema = request() as unknown as Record<string, unknown>;
    schema.schemaVersion = 2;
    expect(await runAvdThreeVmRehearsal(schema)).toMatchObject({
      status: "refused",
      failure: "INPUT_SCHEMA",
      runnerJournal: { entries: 0 },
    });

    const role = request();
    delete role.planRequest.actorAliases.learner;
    expect(await runAvdThreeVmRehearsal(role)).toMatchObject({
      status: "refused",
      failure: "ACTOR_BINDING_INVALID",
      runnerJournal: { entries: 0 },
    });

    const cost = request();
    cost.planRequest.maximumBudgetUsd = 0;
    expect(await runAvdThreeVmRehearsal(cost)).toMatchObject({
      status: "refused",
      failure: "BUDGET_EXCEEDED",
      runnerJournal: { entries: 0 },
    });

    const expiry = request();
    expiry.planRequest.expiresAt = expiry.planRequest.now;
    expect(await runAvdThreeVmRehearsal(expiry)).toMatchObject({
      status: "refused",
      failure: "EXPIRY_INVALID",
      runnerJournal: { entries: 0 },
    });
  });

  it("refuses adapter topology and cost drift before runner mutation", async () => {
    const topology = request();
    (topology.runner.readiness as unknown as {
      vmPublicIpCount: number;
    }).vmPublicIpCount = 1;
    expect(await runAvdThreeVmRehearsal(topology)).toMatchObject({
      status: "refused",
      failure: "ADAPTER_REFUSED",
      runnerJournal: { entries: 0 },
    });

    const cost = request();
    cost.runner.costBasis.boundedDataGb = 1_000_000;
    expect(await runAvdThreeVmRehearsal(cost)).toMatchObject({
      status: "refused",
      failure: "ADAPTER_REFUSED",
      runnerJournal: { entries: 0 },
    });
  });

  it("refuses quota and temporary-permission readiness gaps", async () => {
    const quota = request();
    (quota.runner.readiness as unknown as {
      availableWindowsVmCount: number;
    }).availableWindowsVmCount = 0;
    expect(await runAvdThreeVmRehearsal(quota)).toMatchObject({
      status: "refused",
      failure: "ADAPTER_REFUSED",
      runnerJournal: { entries: 0 },
    });

    const permission = request();
    (permission.runner.readiness as unknown as {
      temporaryPermissionsExact: boolean;
    }).temporaryPermissionsExact = false;
    expect(await runAvdThreeVmRehearsal(permission)).toMatchObject({
      status: "refused",
      failure: "ADAPTER_REFUSED",
      runnerJournal: { entries: 0 },
    });
  });

  it("detects plan digest and runner cleanup drift at their typed stages", async () => {
    const input = request();
    const plan = compileRehearsalPlanStage(input);
    plan.plan.digestSha256 = "0".repeat(64);
    expect(() => compileRehearsalRunnerPlanStage(input, plan)).toThrow(
      "PLAN_DIGEST_DRIFT",
    );

    const cleanPlan = compileRehearsalPlanStage(input);
    const runner = compileRehearsalRunnerPlanStage(input, cleanPlan);
    const changed = structuredClone(runner);
    delete (changed.runnerPlan.cleanupGraph as unknown as
      Record<string, readonly string[]>)["roles-revoke"];
    await expect(executeRehearsalRunStage(input, changed)).rejects.toThrow(
      "RUNNER_PLAN_DRIFT",
    );
  });

  it("orders cleanup after a partial deployment failure", async () => {
    const input = request();
    input.transport.failedMutation = "compute-submit";
    const result = await runAvdThreeVmRehearsal(input);

    expect(result).toMatchObject({
      status: "partial-failure-cleaned",
      failure: "PARTIAL_FAILURE_CLEANED",
      stages: { run: "partial-failure-cleaned" },
      runnerJournal: {
        transitions: { failed: 1 },
      },
    });
    expect(result.runnerJournal.transitions.succeeded).toBeGreaterThan(4);
    const stage = await executeRehearsalRunStage(
      input,
      compileRehearsalRunnerPlanStage(
        input,
        compileRehearsalPlanStage(input),
      ),
    );
    expect(stage).toMatchObject({
      cleanup: "ordered-complete",
      duplicateWriteCount: 0,
    });
  });

  it("reconciles one ambiguous write read-only and suppresses terminal replay", async () => {
    const input = request();
    input.transport.ambiguousMutation = "control-submit";
    input.transport.reconciliation = "desired-state";
    const result = await runAvdThreeVmRehearsal(input);

    expect(result).toMatchObject({
      status: "completed",
      runnerJournal: {
        duplicateWrites: 0,
        transitions: { ambiguous: 1 },
      },
    });
    expect(result.runnerJournal.transitions.reconciled).toBeGreaterThan(0);
  });

  it("surfaces unresolved ambiguity without replay", async () => {
    const input = request();
    input.transport.ambiguousMutation = "control-submit";
    input.transport.reconciliation = "incomplete";
    const result = await runAvdThreeVmRehearsal(input);

    expect(result).toMatchObject({
      status: "unresolved",
      failure: "RUN_UNRESOLVED",
      stages: { receipt: "verified-incomplete" },
      runnerJournal: {
        transitions: { ambiguous: 1, "reconciliation-blocked": 1 },
      },
    });
  });

  it("keeps missing learner and fresh-token observations synthetic and incomplete", async () => {
    const input = request();
    input.transport.evidence["learner-session"] = "missing";
    input.terminal.freshTokenRoleAbsence = false;
    const result = await runAvdThreeVmRehearsal(input);

    expect(result.status).not.toBe("completed");
    expect(result.observations).toMatchObject({
      provenance: "synthetic",
      evidence: { failedOrMissing: 1 },
      terminalInputs: { roleAbsence: "synthetic-missing" },
    });
    expect(result.receipt).toMatchObject({
      provenClaims: 0,
      status: "verified-incomplete",
    });
  });

  it("binds a retention contradiction without converting it to proof", async () => {
    const input = request();
    input.terminal.retentionReconciled = false;
    const result = await runAvdThreeVmRehearsal(input);
    expect(result).toMatchObject({
      receipt: {
        status: "verified-incomplete",
        provenClaims: 0,
        binding: { retention: "synthetic-missing" },
      },
      observations: {
        terminalInputs: { retention: "synthetic-missing" },
      },
    });
  });

  it("refuses a learner-session or receipt evidence overclaim", async () => {
    const input = request();
    input.transport.evidence["learner-session"] = "proven";
    expect(await runAvdThreeVmRehearsal(input)).toMatchObject({
      status: "refused",
      failure: "LEARNER_OVERCLAIM",
    });

    const fixture = await receiptFixture();
    fixture.input.receipt.claims[0]!.state = "proven";
    expect(() =>
      verifyRehearsalReceiptInput(
        fixture.input,
        fixture.plan.plan.digestSha256,
        fixture.run,
        fixture.observations,
      )
    ).toThrow();
  });

  it("refuses incomplete receipt coverage rather than guessing claims", async () => {
    const fixture = await receiptFixture();
    (fixture.input.receipt.claims as Mutable<
      typeof fixture.input.receipt.claims
    >).pop();
    expect(() =>
      verifyRehearsalReceiptInput(
        fixture.input,
        fixture.plan.plan.digestSha256,
        fixture.run,
        fixture.observations,
      )
    ).toThrow();
  });

  it("runs the explicit-file CLI with bounded sanitized output", () => {
    const directory = mkdtempSync(join(tmpdir(), "ap2-rehearsal-"));
    const inputPath = join(directory, "request.json");
    try {
      writeFileSync(inputPath, JSON.stringify(request()), { mode: 0o600 });
      const run = spawnSync(
        process.execPath,
        ["scripts/run-avd-three-vm-rehearsal.ts", inputPath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(run.status).toBe(0);
      const output = JSON.parse(run.stdout) as Record<string, unknown>;
      expect(output).toMatchObject({
        label: "REHEARSAL_ONLY",
        status: "completed",
      });
      expect(run.stdout).not.toContain(inputPath);
      expect(run.stdout).not.toContain("runMarker");
      expect(run.stdout).not.toContain("student-tenant");
      expect(run.stdout).not.toContain("after-party-learner");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes categorical schema refusals only to stderr", () => {
    const run = spawnSync(
      process.execPath,
      [
        "scripts/run-avd-three-vm-rehearsal.ts",
        "scripts/fixtures/help-desk-email-rehearsal-send.json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toEqual({
      schemaVersion: 1,
      label: "REHEARSAL_ONLY",
      status: "refused",
      failure: "INPUT_SCHEMA",
    });
  });
});
