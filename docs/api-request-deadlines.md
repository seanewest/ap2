# API request deadlines and disconnects

The API uses finite transport boundaries without pretending that an HTTP
disconnect cancels external work:

| Boundary | Production limit | Terminal behavior |
| --- | ---: | --- |
| request headers | 10 seconds | Node closes or rejects the incomplete request |
| complete request receipt | 15 seconds | incomplete bodies close categorically, never as an internal error |
| header/request timeout check | 1 second | bounds enforcement granularity |
| JWKS fetch | 5 seconds | authentication fails as unauthorized before route work |
| inactive request/response connection | 120 seconds | the socket closes without cancelling route work |
| idle keep-alive connection | 5 seconds | the idle socket closes |
| graceful shutdown drain | 10 seconds | the process exits nonzero with `forced-exit/drain-timeout` |

The limits are absolute production constants, not an execution SLA. A route
can still complete sooner because its own validator, authentication provider,
or operation returns first. The 120-second inactivity boundary remains above
the simulated-user provider's existing 90-second acquisition boundary, so it
does not silently shorten that operation-specific contract.

## Cancellation boundary

A closed client or server-side inactivity deadline produces exactly one local
`api_request` record with outcome `connection-closed` and status sentinel
`499`. The sentinel is telemetry only; it is not claimed to have been sent to
the client. A normal response emits its existing terminal category, and the
later response `close` event cannot create a second record.

Cancellation is intentionally dispatch-aware:

- if the connection disappears while authentication is pending, the API does
  not dispatch the route operation after authentication eventually returns;
- if a pure, read-only, or mutating operation has already started, the API
  does not abort its promise or any shared work;
- late completion after disconnect cannot write another response or telemetry
  record; and
- the API never retries the operation.

For a bounded mutation, connection closure after dispatch means the external
outcome may be unknown. It does not mean the mutation is absent or failed.
Callers must not replay it. Cancellation or recovery below that boundary needs
the operation's own marker, lock, journal, and reconciliation contract. The
shared server therefore does not inject a generic `AbortSignal` into Graph,
Azure, or simulated-user operations.

## Deterministic matrix

The local held-service tests reduce production limits to milliseconds while
using the real HTTP server. They prove finite connection behavior for held
authentication, a held pure compiler, and a held bounded mutation; exact
terminal cardinality; pre-dispatch suppression; no retry; no generic
cancellation; and safe late completion after the client has gone away.

The production-container and local transport proofs additionally establish:

- the built image closes a partial JSON body at the 15-second receive boundary
  without a `500` and emits one safe terminal request record;
- the real remote-JWKS verifier, exercised against a held Linux-local fixture,
  refuses at five seconds;
- a held request drains when released during shutdown;
- a request still held at ten seconds reaches the fixed forced-exit lifecycle
  category and nonzero exit; and
- every container, image, socket, and local fixture server is cleaned up.

These are Linux-local measurements. They do not execute or prove a Microsoft
operation.
