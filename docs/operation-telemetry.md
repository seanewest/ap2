# Operation telemetry

The API has a small in-process structured telemetry seam for consequential
scenario operations. It is observational only: it does not persist state,
claim work, retry mutations, select a monitoring vendor, or change the durable
operation-journal decision.

The first product-wired consumer is the calendar scenario:

- `calendar.create` reports the execution mutation;
- `calendar.cancel` reports cleanup; and
- a cancellation after process-state loss reports its exact read-only recovery
  phase before the cancellation mutation.

The production API writes one JSON object per event to standard output. A
future approved sink can implement the same `OperationTelemetrySink` interface
without changing operation semantics. Sink and clock failures are swallowed;
they never cause a Microsoft request, retry, success, or failure to change.

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
