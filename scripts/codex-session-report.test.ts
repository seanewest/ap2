import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCodexSession, resolveSessionSelection } from "./codex-session-report";

function line(timestamp: string, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp, type, payload });
}

function taskStart(timestamp: string, turnId: string): string {
  return line(timestamp, "event_msg", { type: "task_started", turn_id: turnId });
}

function userPrompt(timestamp: string, turnId: string, text: string): string {
  return line(timestamp, "response_item", {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  });
}

function taskComplete(
  timestamp: string,
  turnId: string,
  durationMs: number,
  timeToFirstTokenMs = 400,
): string {
  return line(timestamp, "event_msg", {
    type: "task_complete",
    turn_id: turnId,
    duration_ms: durationMs,
    time_to_first_token_ms: timeToFirstTokenMs,
  });
}

describe("parseCodexSession", () => {
  it("reports normal human turns, automatic retries, tokens, and malformed lines", () => {
    const session = [
      line("2026-07-22T00:00:00.000Z", "event_msg", {
        type: "thread_goal_updated",
        goal: { objective: "Deploy the application" },
      }),
      taskStart("2026-07-22T00:00:01.000Z", "human-turn"),
      userPrompt("2026-07-22T00:00:01.100Z", "human-turn", "Start it"),
      line("2026-07-22T00:00:03.100Z", "event_msg", {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 80,
            output_tokens: 20,
            reasoning_output_tokens: 5,
            total_tokens: 120,
          },
        },
        rate_limits: { credits: { balance: "10.0000" } },
      }),
      taskComplete("2026-07-22T00:00:05.000Z", "human-turn", 3_500),
      taskStart("2026-07-22T00:00:05.100Z", "retry-turn"),
      userPrompt(
        "2026-07-22T00:00:05.200Z",
        "retry-turn",
        '<codex_internal_context source="goal"><objective>Deploy the application</objective></codex_internal_context>',
      ),
      line("2026-07-22T00:00:06.000Z", "event_msg", {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 10,
            cached_input_tokens: 5,
            output_tokens: 2,
            reasoning_output_tokens: 1,
            total_tokens: 12,
          },
        },
        rate_limits: { credits: { balance: "9.7500" } },
      }),
      taskComplete("2026-07-22T00:00:07.100Z", "retry-turn", 2_000, 300),
      "not json",
    ].join("\n");

    const report = parseCodexSession(session);

    expect(report.schemaVersion).toBe(1);
    expect(report.malformedLines).toBe(1);
    expect(report.turns).toHaveLength(2);
    expect(report.turns[0]).toMatchObject({
      id: "human-turn",
      objective: "Deploy the application",
      trigger: "human",
      status: "completed",
      elapsedMs: 4_000,
      wallElapsedMs: 4_000,
      reportedDurationMs: 3_500,
      codexActiveDurationMs: 3_500,
      inactiveWallMs: 500,
      timeToFirstTokenMs: 400,
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalTokens: 120,
    });
    expect(report.turns[1]).toMatchObject({
      id: "retry-turn",
      objective: "Deploy the application",
      trigger: "automatic goal retry",
      wallElapsedMs: 2_000,
      creditBalanceBefore: 10,
      creditBalanceAfter: 9.75,
    });
    expect(report.summary).toMatchObject({
      completedTurns: 2,
      automaticGoalRetries: 1,
      turnWallElapsedMs: 6_000,
      codexActiveDurationMs: 5_500,
      inactiveWallMs: 500,
    });
  });

  it("separates host suspension from Codex-reported active time and records delayed first token", () => {
    const report = parseCodexSession([
      taskStart("2026-07-22T01:00:00.000Z", "suspended-turn"),
      userPrompt("2026-07-22T01:00:00.100Z", "suspended-turn", "Continue"),
      taskComplete("2026-07-22T01:02:00.000Z", "suspended-turn", 5_000, 15_000),
    ].join("\n"));

    expect(report.turns[0]).toMatchObject({
      wallElapsedMs: 120_000,
      codexActiveDurationMs: 5_000,
      inactiveWallMs: 115_000,
      timeToFirstTokenMs: 15_000,
    });
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "inactive_wall_time", evidence: "derived", durationMs: 115_000 }),
      expect.objectContaining({ kind: "delayed_first_token", evidence: "recorded", durationMs: 15_000 }),
      expect.objectContaining({ kind: "silent_interval", evidence: "inference" }),
    ]));
  });

  it("uses nested Wall time for a long tool call and flags a suspended call span", () => {
    const turnId = "tool-turn";
    const report = parseCodexSession([
      taskStart("2026-07-22T02:00:00.000Z", turnId),
      userPrompt("2026-07-22T02:00:00.100Z", turnId, "Run it"),
      line("2026-07-22T02:00:02.000Z", "response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "slow-call",
        arguments: JSON.stringify({ cmd: "npm run test -- --runInBand" }),
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      }),
      line("2026-07-22T02:01:12.000Z", "response_item", {
        type: "function_call_output",
        call_id: "slow-call",
        output: [{ type: "input_text", text: "Script completed\nWall time 5 seconds\nOutput:\nok" }],
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      }),
      taskComplete("2026-07-22T02:01:13.000Z", turnId, 8_000),
    ].join("\n"));

    expect(report.turns[0]).toMatchObject({
      toolMs: 5_000,
      toolSpanMs: 70_000,
      toolReportedWallMs: 5_000,
    });
    expect(report.slowestToolCalls[0]).toMatchObject({
      tool: "exec_command",
      summary: "npm run test",
      spanMs: 70_000,
      reportedWallMs: 5_000,
      activeMs: 5_000,
      inactiveWallMs: 65_000,
      hasLargeSpanDiscrepancy: true,
    });
    expect(report.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool_span_discrepancy", evidence: "derived", durationMs: 65_000 }),
      expect.objectContaining({ kind: "long_tool_wait", evidence: "recorded", durationMs: 70_000 }),
    ]));
  });

  it("records an interrupted turn without inventing interrupt-delivery timing", () => {
    const report = parseCodexSession([
      taskStart("2026-07-22T03:00:00.000Z", "interrupted"),
      userPrompt("2026-07-22T03:00:00.100Z", "interrupted", "Begin"),
      line("2026-07-22T03:00:12.000Z", "event_msg", {
        type: "turn_aborted",
        turn_id: "interrupted",
        duration_ms: 11_900,
        reason: "interrupted",
      }),
    ].join("\n"));

    expect(report.turns[0]).toMatchObject({ status: "interrupted", wallElapsedMs: 12_000 });
    expect(report.observations).toContainEqual(expect.objectContaining({
      kind: "interrupted_turn",
      evidence: "recorded",
      summary: expect.stringContaining("no interrupt-request timestamp"),
    }));
  });

  it("does not retain a sensitive command body in call summaries", () => {
    const turnId = "redacted-command";
    const report = parseCodexSession([
      taskStart("2026-07-22T04:00:00.000Z", turnId),
      line("2026-07-22T04:00:01.000Z", "response_item", {
        type: "function_call",
        name: "exec_command",
        call_id: "redacted-call",
        arguments: JSON.stringify({ cmd: "example --password synthetic-test-value --verbose" }),
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      }),
      line("2026-07-22T04:00:02.000Z", "response_item", {
        type: "function_call_output",
        call_id: "redacted-call",
        output: "done",
        internal_chat_message_metadata_passthrough: { turn_id: turnId },
      }),
      taskComplete("2026-07-22T04:00:03.000Z", turnId, 3_000),
    ].join("\n"));

    expect(report.turns[0]?.toolCalls[0]?.summary).toBe("sensitive command (redacted)");
    expect(JSON.stringify(report)).not.toContain("synthetic-test-value");
  });
});

describe("resolveSessionSelection", () => {
  const temporaryHomes: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryHomes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function fixtureHome(indexLines: Record<string, unknown>[]): Promise<{ home: string; sessions: string }> {
    const home = await mkdtemp(join(tmpdir(), "codex-report-"));
    temporaryHomes.push(home);
    const sessions = join(home, "sessions", "2026", "07", "22");
    await mkdir(sessions, { recursive: true });
    await writeFile(join(home, "session_index.jsonl"), indexLines.map((item) => JSON.stringify(item)).join("\n"));
    return { home, sessions };
  }

  async function transcript(sessions: string, id: string): Promise<string> {
    const path = join(sessions, `rollout-2026-07-22T00-00-00-${id}.jsonl`);
    await writeFile(path, line("2026-07-22T00:00:00.000Z", "session_meta", { id }));
    return path;
  }

  it("selects by saved worker name, thread ID, and explicit JSONL path", async () => {
    const id = "019f87a8-2a8c-7921-a8d3-72e08a90146c";
    const { home, sessions } = await fixtureHome([
      { id, thread_name: "AP2 Worker", updated_at: "2026-07-22T00:00:00Z" },
      { id, thread_name: "Lebron", updated_at: "2026-07-22T00:01:00Z" },
    ]);
    const path = await transcript(sessions, id);

    await expect(resolveSessionSelection({ codexHome: home, name: "lebron" })).resolves.toMatchObject({
      sessionPath: path,
      threadId: id,
      threadName: "Lebron",
      selectedBy: "name",
    });
    await expect(resolveSessionSelection({ codexHome: home, threadId: id })).resolves.toMatchObject({
      sessionPath: path,
      threadId: id,
      selectedBy: "thread-id",
    });
    await expect(resolveSessionSelection({ codexHome: home, path })).resolves.toMatchObject({
      sessionPath: path,
      threadId: id,
      selectedBy: "path",
    });
  });

  it("rejects ambiguous names with thread IDs as the fallback", async () => {
    const firstId = "019f87a8-2a8c-7921-a8d3-72e08a90146c";
    const secondId = "019f8c2f-38ab-74b0-be19-1136cb626f8f";
    const { home, sessions } = await fixtureHome([
      { id: firstId, thread_name: "Lebron", updated_at: "2026-07-22T00:01:00Z" },
      { id: secondId, thread_name: "Lebron", updated_at: "2026-07-22T00:02:00Z" },
    ]);
    await transcript(sessions, firstId);
    await transcript(sessions, secondId);

    await expect(resolveSessionSelection({ codexHome: home, name: "Lebron" })).rejects.toThrow(
      /ambiguous.*--thread-id or --path/i,
    );
    await expect(resolveSessionSelection({ codexHome: home })).rejects.toThrow(/Select one with --name/);
  });
});
