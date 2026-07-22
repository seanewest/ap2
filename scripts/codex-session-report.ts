import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;

export type TurnTrigger = "automatic goal retry" | "human" | "unknown";

export interface TurnReport {
  id: string;
  objective?: string;
  trigger: TurnTrigger;
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
  reportedDurationMs?: number;
  timeToFirstTokenMs?: number;
  toolMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  creditBalanceBefore?: number;
  creditBalanceAfter?: number;
  gapAfterPreviousSameGoalMs?: number;
}

export interface SessionReport {
  turns: TurnReport[];
  malformedLines: number;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : undefined;
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => object(item)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addTokenUsage(turn: TurnReport, value: unknown): void {
  const usage = object(value);
  if (!usage) {
    return;
  }

  turn.inputTokens += number(usage.input_tokens) ?? 0;
  turn.cachedInputTokens += number(usage.cached_input_tokens) ?? 0;
  turn.outputTokens += number(usage.output_tokens) ?? 0;
  turn.reasoningOutputTokens += number(usage.reasoning_output_tokens) ?? 0;
  turn.totalTokens += number(usage.total_tokens) ?? 0;
}

function elapsedToolMs(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }

  for (const item of value) {
    const text = object(item)?.text;
    if (typeof text !== "string") {
      continue;
    }

    const match = text.match(/\bWall time ([0-9]+(?:\.[0-9]+)?) seconds\b/);
    if (match?.[1]) {
      return Number.parseFloat(match[1]) * 1_000;
    }
  }

  return 0;
}

function objectiveFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/);
  return match?.[1]?.trim();
}

export function parseCodexSession(jsonl: string): SessionReport {
  const turns = new Map<string, TurnReport>();
  const calls = new Map<string, { startedAt: string; turnId: string }>();
  let currentObjective: string | undefined;
  let lastCreditBalance: number | undefined;
  let malformedLines = 0;

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let record: JsonObject;
    try {
      record = JSON.parse(line) as JsonObject;
    } catch {
      malformedLines += 1;
      continue;
    }

    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
    const payload = object(record.payload);
    if (!payload) {
      continue;
    }

    if (record.type === "event_msg" && payload.type === "thread_goal_updated") {
      const objective = object(payload.goal)?.objective;
      if (typeof objective === "string" && objective.trim()) {
        currentObjective = objective.trim();
      }
      continue;
    }

    if (record.type === "event_msg" && payload.type === "task_started") {
      const id = payload.turn_id;
      if (typeof id === "string" && timestamp) {
        turns.set(id, {
          id,
          objective: currentObjective,
          trigger: "unknown",
          startedAt: timestamp,
          toolMs: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          creditBalanceBefore: lastCreditBalance,
        });
      }
      continue;
    }

    const metadata = object(payload.internal_chat_message_metadata_passthrough);
    const metadataTurnId = metadata?.turn_id;
    const explicitTurnId = payload.turn_id;
    const turnId =
      typeof metadataTurnId === "string"
        ? metadataTurnId
        : typeof explicitTurnId === "string"
          ? explicitTurnId
          : undefined;
    const turn = turnId ? turns.get(turnId) : undefined;

    if (
      record.type === "response_item" &&
      (payload.type === "function_call" ||
        payload.type === "custom_tool_call" ||
        payload.type === "mcp_tool_call") &&
      turn &&
      timestamp &&
      typeof payload.call_id === "string"
    ) {
      calls.set(payload.call_id, { startedAt: timestamp, turnId: turn.id });
      continue;
    }

    if (record.type === "response_item" && payload.type === "message" && payload.role === "user" && turn) {
      const prompt = textContent(payload.content);
      if (prompt.includes('<codex_internal_context source="goal">')) {
        turn.trigger = "automatic goal retry";
      } else {
        turn.trigger = "human";
      }
      turn.objective = objectiveFromPrompt(prompt) ?? turn.objective;
      continue;
    }

    if (
      record.type === "response_item" &&
      (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") &&
      turn
    ) {
      const call = typeof payload.call_id === "string" ? calls.get(payload.call_id) : undefined;
      if (call && timestamp && call.turnId === turn.id) {
        turn.toolMs += Date.parse(timestamp) - Date.parse(call.startedAt);
        calls.delete(payload.call_id as string);
      } else {
        turn.toolMs += elapsedToolMs(payload.output);
      }
      continue;
    }

    if (record.type === "event_msg" && payload.type === "token_count") {
      const info = object(payload.info);
      const lastUsage = info?.last_token_usage;
      const credits = object(object(payload.rate_limits)?.credits);
      const balanceValue = credits?.balance;
      const creditBalance =
        typeof balanceValue === "string"
          ? Number.parseFloat(balanceValue)
          : number(balanceValue);
      if (lastUsage) {
        const latestTurn = [...turns.values()].at(-1);
        if (latestTurn && !latestTurn.completedAt) {
          addTokenUsage(latestTurn, lastUsage);
          if (creditBalance !== undefined && Number.isFinite(creditBalance)) {
            latestTurn.creditBalanceAfter = creditBalance;
          }
        }
      }
      if (creditBalance !== undefined && Number.isFinite(creditBalance)) {
        lastCreditBalance = creditBalance;
      }
      continue;
    }

    if (record.type === "event_msg" && payload.type === "task_complete" && turn && timestamp) {
      turn.completedAt = timestamp;
      turn.elapsedMs = Date.parse(timestamp) - Date.parse(turn.startedAt);
      turn.reportedDurationMs = number(payload.duration_ms);
      turn.timeToFirstTokenMs = number(payload.time_to_first_token_ms);
    }
  }

  const orderedTurns = [...turns.values()];
  for (const [index, turn] of orderedTurns.entries()) {
    const previous = orderedTurns[index - 1];
    if (
      previous?.completedAt &&
      previous.objective &&
      previous.objective === turn.objective &&
      turn.trigger === "human"
    ) {
      turn.gapAfterPreviousSameGoalMs =
        Date.parse(turn.startedAt) - Date.parse(previous.completedAt);
    }
  }

  return { turns: orderedTurns, malformedLines };
}

async function latestSession(root: string): Promise<string | undefined> {
  let latest: { path: string; modifiedMs: number } | undefined;

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const modifiedMs = (await stat(path)).mtimeMs;
        if (!latest || modifiedMs > latest.modifiedMs) {
          latest = { path, modifiedMs };
        }
      }
    }
  }

  try {
    await visit(root);
  } catch (error) {
    const code = object(error)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return latest?.path;
}

function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) {
    return "running";
  }

  const roundedSeconds = Math.round(milliseconds / 100) / 10;
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds - minutes * 60;
  return minutes > 0 ? `${minutes}m ${seconds.toFixed(1)}s` : `${seconds.toFixed(1)}s`;
}

function shortObjective(objective: string | undefined): string {
  if (!objective) {
    return "(no goal recorded)";
  }
  const singleLine = objective.replace(/\s+/g, " ");
  return singleLine.length > 76 ? `${singleLine.slice(0, 73)}...` : singleLine;
}

function newlyProcessedTokens(turn: TurnReport): number {
  return Math.max(0, turn.inputTokens - turn.cachedInputTokens) + turn.outputTokens;
}

function creditsUsed(turn: TurnReport): number | undefined {
  if (turn.creditBalanceBefore === undefined || turn.creditBalanceAfter === undefined) {
    return undefined;
  }
  return Math.max(0, turn.creditBalanceBefore - turn.creditBalanceAfter);
}

function printHumanReport(sessionPath: string, report: SessionReport): void {
  console.log(`Codex session: ${sessionPath}`);
  console.log("");

  for (const turn of report.turns) {
    console.log(
      `${turn.id.slice(0, 8)}  ${turn.trigger.padEnd(20)}  elapsed ${formatDuration(turn.elapsedMs).padStart(10)}  tools ${formatDuration(turn.toolMs).padStart(10)}  new tokens ${newlyProcessedTokens(turn).toLocaleString()}${creditsUsed(turn) === undefined ? "" : `  balance delta ${creditsUsed(turn)?.toFixed(4)}`}`,
    );
    console.log(`          ${shortObjective(turn.objective)}`);
    if ((turn.gapAfterPreviousSameGoalMs ?? 0) > 0) {
      console.log(`          same-goal gap before turn: ${formatDuration(turn.gapAfterPreviousSameGoalMs)}`);
    }
  }

  const completed = report.turns.filter((turn) => turn.elapsedMs !== undefined);
  const retries = completed.filter((turn) => turn.trigger === "automatic goal retry");
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
  const elapsedMs = sum(completed.map((turn) => turn.elapsedMs ?? 0));
  const toolMs = sum(completed.map((turn) => turn.toolMs));
  const retryMs = sum(retries.map((turn) => turn.elapsedMs ?? 0));
  const retryTokens = sum(retries.map(newlyProcessedTokens));
  const retryCredits = sum(retries.map((turn) => creditsUsed(turn) ?? 0));
  const sameGoalGapMs = sum(completed.map((turn) => turn.gapAfterPreviousSameGoalMs ?? 0));

  console.log("");
  console.log(`Completed turns: ${completed.length}; running turns: ${report.turns.length - completed.length}`);
  console.log(`Turn elapsed total: ${formatDuration(elapsedMs)}; measured tool time: ${formatDuration(toolMs)}`);
  console.log(`Same-goal gaps before human turns: ${formatDuration(sameGoalGapMs)}`);
  console.log(
    `Automatic goal retries: ${retries.length}; elapsed: ${formatDuration(retryMs)}; uncached input + output tokens: ${retryTokens.toLocaleString()}; observed credit-balance delta: ${retryCredits.toFixed(4)}`,
  );
  if (report.malformedLines > 0) {
    console.log(`Skipped malformed JSONL lines: ${report.malformedLines}`);
  }
}

async function main(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const positional = args.filter((argument) => argument !== "--json");
  if (positional.length > 1 || positional.includes("--help")) {
    console.log("Usage: npm run report:codex -- [session.jsonl] [--json]");
    process.exitCode = positional.includes("--help") ? 0 : 2;
    return;
  }

  const configuredRoot = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const sessionPath = positional[0]
    ? resolve(positional[0])
    : await latestSession(join(configuredRoot, "sessions"));

  if (!sessionPath) {
    throw new Error(`No Codex session JSONL files found under ${join(configuredRoot, "sessions")}`);
  }

  const report = parseCodexSession(await readFile(sessionPath, "utf8"));
  if (json) {
    console.log(JSON.stringify({ sessionPath, ...report }, null, 2));
  } else {
    printHumanReport(sessionPath, report);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main(process.argv.slice(2));
}
