import { describe, expect, it } from "vitest";
import { parseCodexSession } from "./codex-session-report";

function line(timestamp: string, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp, type, payload });
}

describe("parseCodexSession", () => {
  it("reports human turns, automatic retries, tool time, and token usage", () => {
    const session = [
      line("2026-07-22T00:00:00.000Z", "event_msg", {
        type: "thread_goal_updated",
        goal: { objective: "Deploy the application" },
      }),
      line("2026-07-22T00:00:01.000Z", "event_msg", {
        type: "task_started",
        turn_id: "human-turn",
      }),
      line("2026-07-22T00:00:01.100Z", "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Start it" }],
        internal_chat_message_metadata_passthrough: { turn_id: "human-turn" },
      }),
      line("2026-07-22T00:00:01.500Z", "response_item", {
        type: "function_call",
        call_id: "tool-call",
        internal_chat_message_metadata_passthrough: { turn_id: "human-turn" },
      }),
      line("2026-07-22T00:00:03.000Z", "response_item", {
        type: "function_call_output",
        call_id: "tool-call",
        output: [{ type: "input_text", text: "Script completed\nWall time 1.5 seconds\nOutput:\nok" }],
        internal_chat_message_metadata_passthrough: { turn_id: "human-turn" },
      }),
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
      line("2026-07-22T00:00:05.000Z", "event_msg", {
        type: "task_complete",
        turn_id: "human-turn",
        duration_ms: 3_500,
        time_to_first_token_ms: 400,
      }),
      line("2026-07-22T00:00:05.100Z", "event_msg", {
        type: "task_started",
        turn_id: "retry-turn",
      }),
      line("2026-07-22T00:00:05.200Z", "response_item", {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: '<codex_internal_context source="goal"><objective>Deploy the application</objective></codex_internal_context>',
          },
        ],
        internal_chat_message_metadata_passthrough: { turn_id: "retry-turn" },
      }),
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
      line("2026-07-22T00:00:07.100Z", "event_msg", {
        type: "task_complete",
        turn_id: "retry-turn",
        duration_ms: 2_000,
        time_to_first_token_ms: 300,
      }),
      "not json",
    ].join("\n");

    const report = parseCodexSession(session);

    expect(report.malformedLines).toBe(1);
    expect(report.turns).toHaveLength(2);
    expect(report.turns[0]).toMatchObject({
      id: "human-turn",
      objective: "Deploy the application",
      trigger: "human",
      elapsedMs: 4_000,
      reportedDurationMs: 3_500,
      timeToFirstTokenMs: 400,
      toolMs: 1_500,
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
      elapsedMs: 2_000,
      creditBalanceBefore: 10,
      creditBalanceAfter: 9.75,
    });
  });
});
