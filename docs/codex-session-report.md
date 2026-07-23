# Codex session reports

The reporter reads local Codex JSONL transcripts and `session_index.jsonl`. It
does not use an LLM, copy prompts, or require SQLite.

Choose a saved worker name when several agents share the same Codex home:

```sh
npm run report:codex -- --name Lebron
npm run report:codex -- --name Durant
```

Names are exact apart from letter case. If a name is missing or ambiguous, use
the thread ID shown by Codex or the exact transcript path:

```sh
npm run report:codex -- --thread-id '<thread-id>'
npm run report:codex -- --path '<session.jsonl>'
```

`--latest` remains available as an explicit choice. With multiple transcripts,
omitting a selector fails instead of guessing which worker you meant.

For machine-readable output, npm must run silently because normal `npm run`
prints a banner. Both commands below produce JSON directly:

```sh
npm run --silent report:codex -- --name Lebron --json
node scripts/codex-session-report.ts --name Lebron --json
```

## Timing meanings

- **Turn wall time** is the recorded span from task start to completion or
  interruption.
- **Codex active time** is `duration_ms` reported by Codex. The difference is
  labeled suspended/inactive wall time; the transcript does not prove why it
  happened.
- **Tool span** is the JSONL call-to-output span. When a tool also reports a
  nested `Wall time`, that value is counted as active tool time. A large
  difference is flagged instead of charging the full suspended span to command
  execution.
- A long record-free interval inside a tool call is a long tool wait, not
  automatically a stall. Other silent intervals are marked as inference with
  an unknown cause.
- A `turn_aborted` record proves an interruption. Current local transcripts do
  not record the request time, so interrupt-delivery latency is not invented.

JSON output includes a schema version, summary totals, individual turns, up to
five slowest calls, timing observations, and a malformed-line count. Safe call
summaries name the operation without emitting full command bodies.
