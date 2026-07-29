# API request telemetry

The production API emits one bounded JSON record when each HTTP response
finishes. This is operational request telemetry, not evidence that a scenario
or external operation occurred. It does not persist, retry, schedule, or call
another service.

Each schema-v1 `api_request` record contains exactly:

- a process-generated `correlationId` with the form `r1_` followed by 24
  lowercase hexadecimal characters;
- the fixed route registry's `routeOwner`, `sideEffect`, and `authorization`
  categories, or the fixed `unmatched` category;
- the terminal HTTP `status`;
- `completed`, `refused`, `failed`, `shutdown-refused`, or
  `connection-closed`;
- and an integer `durationMs` capped at 60 seconds.

When the connection closes before a response finishes, the record uses the
fixed `connection-closed` outcome and local status sentinel `499`. This
preserves one terminal record without claiming that a response was delivered.
See the [request deadline and cancellation boundary](api-request-deadlines.md).

The telemetry observer receives only the response, resolved route contract,
and shutdown-admission state. It never receives the request, headers, body,
verified claims, response body, or an exception. Consequently, tokens,
credentials, tenant/user/application/object/resource/message identifiers,
UPNs, protected markers and paths, and arbitrary upstream text cannot become
request telemetry. Correlation generation, clocks, serialization, and sinks
are best effort and cannot change request behavior.

Lifecycle records use the same one-JSON-object-per-line format with the
`api_lifecycle` event and fixed `ready`, `startup-failed`, `draining`,
`stopped`, or `forced-exit` states. Startup and shutdown failures are reduced
to categorical reasons; raw exceptions are not logged.

Request correlation is deliberately separate from
[operation telemetry](operation-telemetry.md). Operation telemetry uses a
bounded marker hash to connect phases within a consequential operation.
Request telemetry does not expose or derive that marker and does not claim
cross-process, cross-instance, or external-system correlation.

## Production-container proof

`npm run test:container` exercises the built production image across readiness,
missing and accepted authentication, authorization refusals, content-type,
malformed-body and body-size validation, a pure route success, and a
bounded-mutation origin refusal. It verifies fixed keys, route classifications,
status cardinality, unique generated correlation values, and absence of
injected body content, bearer tokens, and fixed identity values.

`npm run test:api-lifecycle-container` separately proves categorical startup
failure, readiness, SIGTERM and SIGINT handling, shutdown admission refusal,
bounded in-flight pure-request drain, clean exit, and residue cleanup. Neither
test invokes an external workload API.
