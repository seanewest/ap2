# Operation telemetry

> Telemetry collection and validation remain reusable technical capabilities.
> The Recent operations diagnostic panel was removed from the primary SPA.

The API has a small in-process structured telemetry seam for consequential
scenario operations. It is observational only: it does not persist state,
claim work, retry mutations, select a monitoring vendor, or change the durable
operation-journal decision.

This is distinct from the production API's bounded
[request and lifecycle telemetry](api-request-telemetry.md). Request
correlation identifies one local HTTP response only; it is not an operation
marker or external evidence reference.

The first product-wired consumer is the calendar scenario:

- `calendar.create` reports the execution mutation;
- `calendar.cancel` reports cleanup; and
- a cancellation after process-state loss reports its exact read-only recovery
  phase before the cancellation mutation.

The API writes one JSON object per event to standard output and independently
offers the same validated event to a bounded process-local collector. Each
sink is best-effort and isolated from the operation and every other sink.
Sink and clock failures never cause a Microsoft request, retry, success, or
failure to change.

An authenticated operator can read a snapshot with
`GET /api/operation-events?order=newest` (or `oldest`). The route uses the same
token verification and caller allowlist as the other protected API routes.
The typed `HttpAfterPartyApi.getRecentOperationEvents` client performs its own
strict schema check and rejects additional response or event fields.

The primary SPA does not expose this telemetry as a diagnostic panel. The
bounded route, typed client, collector, and contract tests remain available to
technical tooling.

## Fixed event contract

Each schema-v1 event contains only:

- `markerHash`: `m1_` plus 24 lowercase hexadecimal characters derived from a
  bounded safe operation marker;
- `operationKind`: currently `calendar.create` or `calendar.cancel`;
- `phase`: `execution`, `cleanup`, or `recovery`;
- `outcome`: `started`, `succeeded`, `refused`, or `ambiguous`;
- `durationMs`: a non-negative integer capped at 24 hours;
- one fixed `reason` category;
- one fixed `ambiguityState`;
- one fixed `recoveryState`; and
- optional integer `upstreamStatus` from 100 through 599.

One operation emits two events normally. Entering recovery adds one recovery
start and one recovery terminal event, for an absolute maximum of four. A run
and its recovery span accept only their first terminal result.

All dimensions are enums. The marker hash is correlation, not a metric name,
and arbitrary tenant or learner values must never become labels. A 4xx
mutation response is a definite refusal. A 5xx response, an accepted response
with an invalid confirmation shape, or a transport failure after dispatch is
ambiguous. Recovery reports `in-progress`, then `reconciled` or `unresolved`.

## Data boundary

The telemetry API accepts no error object, request body, response body, Graph
object, token, identity, or scenario content. Events must never contain:

- access or refresh tokens, certificates, passwords, or passphrases;
- cookies, browser state, or simulated-user caches;
- user principal names, tenant object IDs, event IDs, or raw tenant objects;
- message bodies, file names or contents, meeting subject/body/attendees; or
- raw Microsoft responses, error messages, request headers, or URLs.

Only the stable internal reason category and sanitized HTTP status may describe
a failure. Tests inject credential-like markers, raw Microsoft error text,
tenant object content, and a failing sink, then prove those values are absent
and that the underlying Graph call count remains unchanged.

## Collector bounds and limitations

The collector accepts only the exact schema-v1 field allowlist and validates
every enum, hash, duration, and status at runtime. It holds at most 64 events,
prunes events older than 15 minutes, and limits a serialized snapshot to 16
KiB by dropping the oldest retained events. Sequence and observation time are
internal only. Snapshot events are copies, deterministic for either requested
order, and cannot mutate stored events.

This is intentionally not a durable telemetry sink. Events disappear when the
API process restarts and may be absent after a revision change or process
failure. No database, queue, background worker, vendor SDK, delivery guarantee,
or cross-instance aggregation is implied. Choosing and deploying a durable
sink remains a separate decision.

The local operator product-path test runs the real SPA and API in isolated
headless Chromium. It uses a runtime-generated signed fixture token, verifies
the same operator authorization boundary, and leaves screenshots, traces, and
video disabled.

The pure local
[telemetry-to-receipt adapter](operation-telemetry-receipt-adapter.md) can
reduce a coherent bounded lifecycle to a candidate operation claim. It drops
correlation and HTTP details and cannot prove artifacts, learner observation,
cleanup absence, retention, or terminal external state.
