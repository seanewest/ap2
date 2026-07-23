import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;

const LONG_INTERVAL_MS = 30_000;
const DELAYED_FIRST_TOKEN_MS = 10_000;
const LARGE_DISCREPANCY_MS = 5_000;
const SLOWEST_TOOL_LIMIT = 5;

export type TurnTrigger = "automatic goal retry" | "human" | "unknown";
export type TurnStatus = "completed" | "interrupted" | "running";
export type ObservationEvidence = "recorded" | "derived" | "inference";

export interface ToolCallReport {
  tool: string;
  summary: string;
  startedAt: string;
  completedAt?: string;
  spanMs?: number;
  reportedWallMs?: number;
  activeMs?: number;
  inactiveWallMs?: number;
  hasLargeSpanDiscrepancy: boolean;
}

export interface SessionObservation {
  kind:
    | "delayed_first_token"
    | "inactive_wall_time"
    | "interrupted_turn"
    | "long_tool_wait"
    | "silent_interval"
    | "tool_span_discrepancy";
  evidence: ObservationEvidence;
  durationMs?: number;
  turnId: string;
  tool?: string;
  summary: string;
}

export interface TurnReport {
  id: string;
  objective?: string;
  trigger: TurnTrigger;
  status: TurnStatus;
  startedAt: string;
  completedAt?: string;
  /** Existing field retained for compatibility; this is recorded wall-clock time. */
  elapsedMs?: number;
  wallElapsedMs?: number;
  /** Existing field retained for compatibility; this is Codex's reported duration. */
  reportedDurationMs?: number;
  codexActiveDurationMs?: number;
  inactiveWallMs?: number;
  timeToFirstTokenMs?: number;
  /** Summed nested Wall time when available, otherwise summed recorded call spans. */
  toolMs: number;
  toolSpanMs: number;
  toolReportedWallMs: number;
  toolCalls: ToolCallReport[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  creditBalanceBefore?: number;
  creditBalanceAfter?: number;
  gapAfterPreviousSameGoalMs?: number;
}

export interface SessionSummary {
  completedTurns: number;
  interruptedTurns: number;
  runningTurns: number;
  turnWallElapsedMs: number;
  codexActiveDurationMs: number;
  turnsWithoutReportedActiveDuration: number;
  inactiveWallMs: number;
  summedToolActiveMs: number;
  summedToolSpanMs: number;
  automaticGoalRetries: number;
  automaticGoalRetryWallMs: number;
  automaticGoalRetryTokens: number;
  automaticGoalRetryCreditDelta: number;
  sameGoalGapMs: number;
}

export interface SessionReport {
  schemaVersion: 1;
  turns: TurnReport[];
  summary: SessionSummary;
  slowestToolCalls: ToolCallReport[];
  observations: SessionObservation[];
  malformedLines: number;
}

export interface SessionSelection {
  sessionPath: string;
  threadId?: string;
  threadName?: string;
  selectedBy: "path" | "thread-id" | "name" | "latest" | "only-session";
}

interface SessionIndexEntry {
  id: string;
  threadName: string;
  updatedAt?: string;
}

interface OpenCall {
  callId: string;
  startedAt: string;
  turnId: string;
  tool: string;
  summary: string;
}

interface TimestampedTurnRecord {
  timestamp: string;
  turnId: string;
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

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  const valueObject = object(value);
  return valueObject ? Object.values(valueObject).flatMap(stringsIn) : [];
}

function reportedToolWallMs(value: unknown): number | undefined {
  for (const text of stringsIn(value)) {
    const displayMatch = text.match(/\bWall time\s+([0-9]+(?:\.[0-9]+)?)\s+seconds\b/i);
    if (displayMatch?.[1]) {
      return Number.parseFloat(displayMatch[1]) * 1_000;
    }

    const jsonMatch = text.match(/"wall_time_seconds"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (jsonMatch?.[1]) {
      return Number.parseFloat(jsonMatch[1]) * 1_000;
    }
  }
  return undefined;
}

function objectiveFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/);
  return match?.[1]?.trim();
}

function safeToolName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown tool";
  }
  return value.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 60) || "unknown tool";
}

function commandSummary(command: string): string {
  const lower = command.toLowerCase();
  if (/password|passwd|secret|private[_ -]?key|client[_ -]?secret|access[_ -]?token|\.pfx\b/.test(lower)) {
    return "sensitive command (redacted)";
  }

  const tokens = command
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens[0]?.includes("=") && !tokens[0].startsWith("=")) {
    tokens.shift();
  }
  const executable = basename((tokens[0] ?? "command").replace(/^['\"]|['\"]$/g, ""));
  const second = (tokens[1] ?? "").replace(/[^A-Za-z0-9_.:-]/g, "");
  const third = (tokens[2] ?? "").replace(/[^A-Za-z0-9_.:-]/g, "");

  if (executable === "npm") {
    return ["npm", second, second === "run" ? third : ""].filter(Boolean).join(" ");
  }
  if (["git", "az", "gh"].includes(executable)) {
    return [executable, second].filter(Boolean).join(" ");
  }
  if (executable === "node") {
    return second ? `node ${basename(second)}` : "node command";
  }
  if (["curl", "wget"].includes(executable)) {
    return `${executable} request`;
  }
  if (["rg", "grep"].includes(executable)) {
    return `${executable} text search`;
  }
  if (["find", "fd"].includes(executable)) {
    return `${executable} file search`;
  }
  if (["sed", "head", "tail", "jq"].includes(executable)) {
    return `${executable} data read`;
  }
  if (executable.endsWith(".sh") || executable.endsWith(".mjs") || executable.endsWith(".ts")) {
    return basename(executable);
  }
  return `${executable || "unknown"} command`;
}

function safeCallSummary(tool: string, input: unknown): string {
  const normalized = tool.toLowerCase();
  if (normalized === "exec") {
    return "orchestrated tool calls";
  }
  if (normalized.includes("apply_patch")) {
    return "edit files";
  }
  if (normalized.includes("write_stdin")) {
    return "poll or continue a process";
  }
  if (normalized === "wait" || normalized.endsWith(".wait")) {
    return "wait for a running tool";
  }
  if (normalized.includes("web")) {
    return "web request";
  }
  if (normalized.includes("update_plan")) {
    return "update task plan";
  }
  if (normalized.includes("exec_command")) {
    let inputObject = object(input);
    if (typeof input === "string") {
      try {
        inputObject = object(JSON.parse(input));
      } catch {
        inputObject = undefined;
      }
    }
    return typeof inputObject?.cmd === "string" ? commandSummary(inputObject.cmd) : "shell command";
  }
  return `${tool} call`;
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

function hasLargeDiscrepancy(spanMs: number, reportedMs: number): boolean {
  return Math.abs(spanMs - reportedMs) >= Math.max(LARGE_DISCREPANCY_MS, reportedMs * 0.5);
}

function summarize(turns: TurnReport[]): SessionSummary {
  const ended = turns.filter((turn) => turn.status !== "running");
  const completed = turns.filter((turn) => turn.status === "completed");
  const interrupted = turns.filter((turn) => turn.status === "interrupted");
  const retries = ended.filter((turn) => turn.trigger === "automatic goal retry");
  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
  return {
    completedTurns: completed.length,
    interruptedTurns: interrupted.length,
    runningTurns: turns.length - ended.length,
    turnWallElapsedMs: sum(ended.map((turn) => turn.wallElapsedMs ?? 0)),
    codexActiveDurationMs: sum(ended.map((turn) => turn.codexActiveDurationMs ?? 0)),
    turnsWithoutReportedActiveDuration: ended.filter((turn) => turn.codexActiveDurationMs === undefined).length,
    inactiveWallMs: sum(ended.map((turn) => turn.inactiveWallMs ?? 0)),
    summedToolActiveMs: sum(ended.map((turn) => turn.toolMs)),
    summedToolSpanMs: sum(ended.map((turn) => turn.toolSpanMs)),
    automaticGoalRetries: retries.length,
    automaticGoalRetryWallMs: sum(retries.map((turn) => turn.wallElapsedMs ?? 0)),
    automaticGoalRetryTokens: sum(retries.map(newlyProcessedTokens)),
    automaticGoalRetryCreditDelta: sum(retries.map((turn) => creditsUsed(turn) ?? 0)),
    sameGoalGapMs: sum(ended.map((turn) => turn.gapAfterPreviousSameGoalMs ?? 0)),
  };
}

export function parseCodexSession(jsonl: string): SessionReport {
  const turns = new Map<string, TurnReport>();
  const calls = new Map<string, OpenCall>();
  const turnRecords: TimestampedTurnRecord[] = [];
  const observations: SessionObservation[] = [];
  let currentObjective: string | undefined;
  let activeTurnId: string | undefined;
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
        activeTurnId = id;
        turns.set(id, {
          id,
          objective: currentObjective,
          trigger: "unknown",
          status: "running",
          startedAt: timestamp,
          toolMs: 0,
          toolSpanMs: 0,
          toolReportedWallMs: 0,
          toolCalls: [],
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          creditBalanceBefore: lastCreditBalance,
        });
        turnRecords.push({ timestamp, turnId: id });
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
          : activeTurnId;
    const turn = turnId ? turns.get(turnId) : undefined;
    if (turn && timestamp) {
      turnRecords.push({ timestamp, turnId: turn.id });
    }

    if (
      record.type === "response_item" &&
      (payload.type === "function_call" ||
        payload.type === "custom_tool_call" ||
        payload.type === "mcp_tool_call") &&
      turn &&
      timestamp &&
      typeof payload.call_id === "string"
    ) {
      const tool = safeToolName(payload.name);
      calls.set(payload.call_id, {
        callId: payload.call_id,
        startedAt: timestamp,
        turnId: turn.id,
        tool,
        summary: safeCallSummary(tool, payload.arguments ?? payload.input),
      });
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
      (payload.type === "function_call_output" || payload.type === "custom_tool_call_output" || payload.type === "mcp_tool_call_output") &&
      turn
    ) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const call = callId ? calls.get(callId) : undefined;
      if (call && timestamp && call.turnId === turn.id) {
        const spanMs = Math.max(0, Date.parse(timestamp) - Date.parse(call.startedAt));
        const nestedWallMs = reportedToolWallMs(payload.output);
        const discrepancy = nestedWallMs !== undefined && hasLargeDiscrepancy(spanMs, nestedWallMs);
        const toolCall: ToolCallReport = {
          tool: call.tool,
          summary: call.summary,
          startedAt: call.startedAt,
          completedAt: timestamp,
          spanMs,
          reportedWallMs: nestedWallMs,
          activeMs: nestedWallMs ?? spanMs,
          inactiveWallMs: nestedWallMs === undefined ? undefined : Math.max(0, spanMs - nestedWallMs),
          hasLargeSpanDiscrepancy: discrepancy,
        };
        turn.toolCalls.push(toolCall);
        turn.toolSpanMs += spanMs;
        turn.toolMs += toolCall.activeMs ?? 0;
        turn.toolReportedWallMs += nestedWallMs ?? 0;
        if (discrepancy) {
          observations.push({
            kind: "tool_span_discrepancy",
            evidence: "derived",
            durationMs: Math.abs(spanMs - nestedWallMs),
            turnId: turn.id,
            tool: call.tool,
            summary: "Recorded call span and nested Wall time differ substantially; nested Wall time is counted as active tool time.",
          });
        }
        calls.delete(call.callId);
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
      const activeTurn = activeTurnId ? turns.get(activeTurnId) : undefined;
      if (lastUsage && activeTurn && activeTurn.status === "running") {
        addTokenUsage(activeTurn, lastUsage);
        if (creditBalance !== undefined && Number.isFinite(creditBalance)) {
          activeTurn.creditBalanceAfter = creditBalance;
        }
      }
      if (creditBalance !== undefined && Number.isFinite(creditBalance)) {
        lastCreditBalance = creditBalance;
      }
      continue;
    }

    const ended = record.type === "event_msg" && (payload.type === "task_complete" || payload.type === "turn_aborted");
    if (ended && turn && timestamp) {
      turn.status = payload.type === "turn_aborted" ? "interrupted" : "completed";
      turn.completedAt = timestamp;
      turn.wallElapsedMs = Math.max(0, Date.parse(timestamp) - Date.parse(turn.startedAt));
      turn.elapsedMs = turn.wallElapsedMs;
      turn.codexActiveDurationMs = number(payload.duration_ms);
      turn.reportedDurationMs = turn.codexActiveDurationMs;
      turn.inactiveWallMs =
        turn.codexActiveDurationMs === undefined
          ? undefined
          : Math.max(0, turn.wallElapsedMs - turn.codexActiveDurationMs);
      turn.timeToFirstTokenMs = number(payload.time_to_first_token_ms);
      if ((turn.inactiveWallMs ?? 0) >= LARGE_DISCREPANCY_MS) {
        observations.push({
          kind: "inactive_wall_time",
          evidence: "derived",
          durationMs: turn.inactiveWallMs,
          turnId: turn.id,
          summary: "Wall-clock time exceeds Codex-reported active duration; the transcript does not prove the cause.",
        });
      }
      if ((turn.timeToFirstTokenMs ?? 0) >= DELAYED_FIRST_TOKEN_MS) {
        observations.push({
          kind: "delayed_first_token",
          evidence: "recorded",
          durationMs: turn.timeToFirstTokenMs,
          turnId: turn.id,
          summary: "Codex recorded a delayed first token.",
        });
      }
      if (turn.status === "interrupted") {
        observations.push({
          kind: "interrupted_turn",
          evidence: "recorded",
          durationMs: turn.codexActiveDurationMs,
          turnId: turn.id,
          summary: "Codex recorded an interrupted turn; no interrupt-request timestamp is present to measure delivery delay.",
        });
      }
      if (activeTurnId === turn.id) {
        activeTurnId = undefined;
      }
    }
  }

  for (const call of calls.values()) {
    const turn = turns.get(call.turnId);
    if (turn) {
      turn.toolCalls.push({
        tool: call.tool,
        summary: call.summary,
        startedAt: call.startedAt,
        hasLargeSpanDiscrepancy: false,
      });
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

  const completedCalls = orderedTurns.flatMap((turn) => turn.toolCalls).filter((call) => call.spanMs !== undefined);
  for (const turn of orderedTurns) {
    const records = turnRecords
      .filter((record) => record.turnId === turn.id)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    for (let index = 1; index < records.length; index += 1) {
      const previous = records[index - 1];
      const current = records[index];
      if (!previous || !current) {
        continue;
      }
      const durationMs = Date.parse(current.timestamp) - Date.parse(previous.timestamp);
      if (durationMs < LONG_INTERVAL_MS) {
        continue;
      }
      const containingCall = turn.toolCalls.find(
        (call) =>
          call.completedAt &&
          Date.parse(call.startedAt) <= Date.parse(previous.timestamp) &&
          Date.parse(call.completedAt) >= Date.parse(current.timestamp),
      );
      observations.push({
        kind: containingCall ? "long_tool_wait" : "silent_interval",
        evidence: containingCall ? "recorded" : "inference",
        durationMs,
        turnId: turn.id,
        tool: containingCall?.tool,
        summary: containingCall
          ? "A tool call spanned this record-free interval; long-running is not itself classified as a stall."
          : "No transcript records appear in this interval; it may be a stall, but the cause is unknown.",
      });
    }
  }

  return {
    schemaVersion: 1,
    turns: orderedTurns,
    summary: summarize(orderedTurns),
    slowestToolCalls: [...completedCalls]
      .sort((left, right) => (right.spanMs ?? 0) - (left.spanMs ?? 0))
      .slice(0, SLOWEST_TOOL_LIMIT),
    observations: [...observations].sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0)),
    malformedLines,
  };
}

async function sessionFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        paths.push(path);
      }
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (object(error)?.code !== "ENOENT") {
      throw error;
    }
  }
  return paths;
}

function parseSessionIndex(jsonl: string): SessionIndexEntry[] {
  const latest = new Map<string, SessionIndexEntry>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = object(JSON.parse(line));
      const id = record?.id;
      const threadName = record?.thread_name;
      const updatedAt = record?.updated_at;
      if (typeof id !== "string" || typeof threadName !== "string") {
        continue;
      }
      const entry = { id, threadName, updatedAt: typeof updatedAt === "string" ? updatedAt : undefined };
      const previous = latest.get(id);
      if (!previous || !previous.updatedAt || !entry.updatedAt || entry.updatedAt >= previous.updatedAt) {
        latest.set(id, entry);
      }
    } catch {
      // A malformed index line cannot make a transcript report invalid.
    }
  }
  return [...latest.values()];
}

async function threadIdFromSession(path: string): Promise<string | undefined> {
  const firstLine = (await readFile(path, "utf8")).split("\n", 1)[0];
  if (!firstLine) {
    return undefined;
  }
  try {
    const record = object(JSON.parse(firstLine));
    const id = object(record?.payload)?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

async function pathForThreadId(sessionsRoot: string, threadId: string): Promise<string> {
  const paths = await sessionFiles(sessionsRoot);
  const filenameMatches = paths.filter((path) => basename(path).includes(threadId));
  const candidates = filenameMatches.length > 0 ? filenameMatches : paths;
  const matches: string[] = [];
  for (const path of candidates) {
    if ((await threadIdFromSession(path)) === threadId) {
      matches.push(path);
    }
  }
  if (matches.length === 0) {
    throw new Error(`No session transcript found for thread ID ${threadId}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Thread ID ${threadId} matches multiple transcripts. Select one with --path.`);
  }
  return matches[0] as string;
}

async function latestSession(paths: string[]): Promise<string | undefined> {
  let latest: { path: string; modifiedMs: number } | undefined;
  for (const path of paths) {
    const modifiedMs = (await stat(path)).mtimeMs;
    if (!latest || modifiedMs > latest.modifiedMs) {
      latest = { path, modifiedMs };
    }
  }
  return latest?.path;
}

export async function resolveSessionSelection(options: {
  codexHome: string;
  path?: string;
  threadId?: string;
  name?: string;
  latest?: boolean;
}): Promise<SessionSelection> {
  const selectorCount = [options.path, options.threadId, options.name, options.latest ? "latest" : undefined].filter(Boolean).length;
  if (selectorCount > 1) {
    throw new Error("Choose exactly one of --path, --thread-id, --name, or --latest.");
  }
  if (options.path) {
    const sessionPath = resolve(options.path);
    return { sessionPath, threadId: await threadIdFromSession(sessionPath), selectedBy: "path" };
  }

  const sessionsRoot = join(options.codexHome, "sessions");
  let indexEntries: SessionIndexEntry[] = [];
  try {
    indexEntries = parseSessionIndex(await readFile(join(options.codexHome, "session_index.jsonl"), "utf8"));
  } catch (error) {
    if (object(error)?.code !== "ENOENT") {
      throw error;
    }
  }

  if (options.name) {
    const normalizedName = options.name.toLocaleLowerCase();
    const matches = indexEntries.filter((entry) => entry.threadName.toLocaleLowerCase() === normalizedName);
    if (matches.length === 0) {
      throw new Error(`No saved session named ${JSON.stringify(options.name)}. Use --thread-id or --path.`);
    }
    if (matches.length > 1) {
      const ids = matches.map((entry) => entry.id).sort().join(", ");
      throw new Error(`Saved name ${JSON.stringify(options.name)} is ambiguous (${ids}). Use --thread-id or --path.`);
    }
    const match = matches[0] as SessionIndexEntry;
    return {
      sessionPath: await pathForThreadId(sessionsRoot, match.id),
      threadId: match.id,
      threadName: match.threadName,
      selectedBy: "name",
    };
  }

  if (options.threadId) {
    const indexEntry = indexEntries.find((entry) => entry.id === options.threadId);
    return {
      sessionPath: await pathForThreadId(sessionsRoot, options.threadId),
      threadId: options.threadId,
      threadName: indexEntry?.threadName,
      selectedBy: "thread-id",
    };
  }

  const paths = await sessionFiles(sessionsRoot);
  if (paths.length === 0) {
    throw new Error(`No Codex session JSONL files found under ${sessionsRoot}.`);
  }
  if (options.latest) {
    return { sessionPath: (await latestSession(paths)) as string, selectedBy: "latest" };
  }
  if (paths.length > 1) {
    throw new Error(`Found ${paths.length} session transcripts. Select one with --name, --thread-id, --path, or explicitly use --latest.`);
  }
  return { sessionPath: paths[0] as string, threadId: await threadIdFromSession(paths[0] as string), selectedBy: "only-session" };
}

function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) {
    return "unavailable";
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

function printHumanReport(selection: SessionSelection, report: SessionReport): void {
  const label = selection.threadName ? ` (${selection.threadName})` : "";
  console.log(`Codex session${label}: ${selection.sessionPath}`);
  if (selection.threadId) {
    console.log(`Thread ID: ${selection.threadId}`);
  }
  console.log("");

  for (const turn of report.turns) {
    console.log(
      `${turn.id.slice(0, 8)}  ${turn.trigger.padEnd(20)}  ${turn.status.padEnd(11)}  wall ${formatDuration(turn.wallElapsedMs).padStart(10)}  Codex active ${formatDuration(turn.codexActiveDurationMs).padStart(10)}  inactive ${formatDuration(turn.inactiveWallMs).padStart(10)}  new tokens ${newlyProcessedTokens(turn).toLocaleString()}`,
    );
    console.log(`          ${shortObjective(turn.objective)}`);
    if ((turn.gapAfterPreviousSameGoalMs ?? 0) > 0) {
      console.log(`          same-goal gap before turn: ${formatDuration(turn.gapAfterPreviousSameGoalMs)}`);
    }
  }

  const summary = report.summary;
  console.log("");
  console.log(`Completed: ${summary.completedTurns}; interrupted: ${summary.interruptedTurns}; running: ${summary.runningTurns}`);
  console.log(`Turn wall-clock total: ${formatDuration(summary.turnWallElapsedMs)}`);
  console.log(`Codex-reported active total: ${formatDuration(summary.codexActiveDurationMs)}`);
  console.log(`Suspended/inactive wall difference: ${formatDuration(summary.inactiveWallMs)} (cause is not recorded)`);
  if (summary.turnsWithoutReportedActiveDuration > 0) {
    console.log(`Turns without Codex-reported active duration: ${summary.turnsWithoutReportedActiveDuration}`);
  }
  console.log(
    `Measured tool time: ${formatDuration(summary.summedToolActiveMs)} active across ${formatDuration(summary.summedToolSpanMs)} recorded call span (summed, so parallel calls may overlap)`,
  );
  console.log(`Same-goal gaps before human turns: ${formatDuration(summary.sameGoalGapMs)}`);
  console.log(
    `Automatic goal retries: ${summary.automaticGoalRetries}; wall: ${formatDuration(summary.automaticGoalRetryWallMs)}; uncached input + output tokens: ${summary.automaticGoalRetryTokens.toLocaleString()}; observed credit-balance delta: ${summary.automaticGoalRetryCreditDelta.toFixed(4)}`,
  );

  if (report.slowestToolCalls.length > 0) {
    console.log("");
    console.log("Slowest tool calls/waits (recorded span):");
    for (const call of report.slowestToolCalls) {
      const nested = call.reportedWallMs === undefined ? "" : `; nested Wall time ${formatDuration(call.reportedWallMs)}`;
      const discrepancy = call.hasLargeSpanDiscrepancy ? "; large discrepancy flagged" : "";
      console.log(`  ${formatDuration(call.spanMs).padStart(10)}  ${call.tool}: ${call.summary}${nested}${discrepancy}`);
    }
  }

  if (report.observations.length > 0) {
    console.log("");
    console.log("Timing observations:");
    for (const observation of report.observations.slice(0, 10)) {
      console.log(`  [${observation.evidence}] ${observation.kind} ${formatDuration(observation.durationMs)}: ${observation.summary}`);
    }
  }
  if (report.malformedLines > 0) {
    console.log(`Skipped malformed JSONL lines: ${report.malformedLines}`);
  }
}

interface CliOptions {
  json: boolean;
  help: boolean;
  path?: string;
  threadId?: string;
  name?: string;
  latest: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { json: false, help: false, latest: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--latest") {
      options.latest = true;
    } else if (argument === "--path" || argument === "--thread-id" || argument === "--name") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--path") options.path = value;
      if (argument === "--thread-id") options.threadId = value;
      if (argument === "--name") options.name = value;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option ${argument}.`);
    } else if (!options.path) {
      options.path = argument;
    } else {
      throw new Error("Only one transcript path may be supplied.");
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: npm run report:codex -- [selector] [--json]

Selectors (choose one):
  --name <saved-name>       Saved worker/thread name, for example Lebron
  --thread-id <uuid>        Exact Codex thread ID
  --path <session.jsonl>    Exact transcript path (a positional path also works)
  --latest                  Explicitly choose the newest transcript

With multiple local transcripts, a selector is required. If a saved name is
ambiguous, use its thread ID or path. For JSON without npm banners, run:
  npm run --silent report:codex -- --name Lebron --json
or invoke node scripts/codex-session-report.ts directly.`);
}

async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    printHelp();
    return;
  }
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const selection = await resolveSessionSelection({
    codexHome,
    path: options.path,
    threadId: options.threadId,
    name: options.name,
    latest: options.latest,
  });
  const report = parseCodexSession(await readFile(selection.sessionPath, "utf8"));
  if (options.json) {
    console.log(JSON.stringify({ sessionPath: selection.sessionPath, session: selection, ...report }, null, 2));
  } else {
    printHumanReport(selection, report);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
