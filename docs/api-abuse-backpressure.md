# API process-local backpressure

The production API now has a small fail-fast admission boundary derived from
the authoritative route registry. It exists to keep one Node process from
accepting unbounded simultaneous authentication, request-body, verifier, or
mutation work. It does not identify callers, meter requests over time, queue
work, retry work, persist state, or coordinate replicas.

## Fixed one-process limits

| Lane | Concurrent admitted work |
| --- | ---: |
| public, preflight, and undeclared control traffic | 8 total |
| operator traffic | 24 total |
| one pure route | 8 |
| one read-only-external route | 4 |
| one bounded-mutation method and path | 1 |

The mutation key is the exact registered method and path. Same-route duplicate
work cannot enter concurrently, while paired create/cleanup methods still
reach their established operation-level busy/conflict boundary. A full lane
receives immediate `503` JSON with the fixed
`process_capacity_exceeded` category and `Connection: close`. The response has
no `Retry-After`; the API never queues or automatically replays a mutation.
Admission happens before operator authentication or JSON parsing. Capacity is
released only when the admitted route handler settles. A client disconnect
does not free a mutation lane while its underlying operation is still running.

Shutdown remains the stronger boundary. Once draining begins, every newly
dispatched request receives `server_shutting_down` before capacity, origin,
authentication, body, or operation handling.

The Node listener also freezes receive-side bounds:

- 16 KiB maximum request headers and at most 64 parsed headers;
- 10-second header receipt timeout;
- 15-second complete-request receipt timeout;
- 120-second inactive-connection timeout;
- 5-second keep-alive idle timeout; and
- at most 100 requests on one socket.

These receive timers do not impose an operation-response timeout. Existing
interactive authentication and Microsoft operation semantics are unchanged.
Every route retains its own request, response, and error byte limits.

## Production-container matrix

`npm run test:api-backpressure-container` builds the real production image and
runs one bounded Linux-local test with one CPU, 512 MiB memory, 128 processes,
no capabilities, and a read-only root filesystem. The build network is
disabled. Runtime requests use only loopback and a controlled local JWKS
endpoint; no external operation is configured or invoked. The test has fixed
request ceilings and cleans its container and image.

The emitted `API_PROCESS_BACKPRESSURE` matrix records:

- 32 health responses and 32 authentication refusals with bounded latency;
- one held mutation, one immediate same-path refusal, no queue, and no retry;
- eight held pure bodies, one immediate refusal, and successful capacity
  release;
- eight oversized-body refusals;
- one held body reaching HTTP `408`;
- peak and settled RSS plus CPU-tick growth under fixed local ceilings; and
- one admitted request draining while a pipelined follow-up receives the
  shutdown `503`, followed by a clean exit and absent residue.

The matrix measures a local container contract. It is not a hosted throughput,
latency, memory, CPU, or denial-of-service guarantee.

Focused server tests additionally abort a client after a fake mutation starts
and prove that the same route remains refused until the original operation
settles.

## Required platform boundary

The repository has no main-API ingress or Container Apps infrastructure
definition, so it cannot truthfully enforce client rate, connection count,
aggregate replicas, or upstream queueing. Deployment must keep
`maxReplicas=1` while mutation ownership and token caches remain process-local.
Ingress must independently bound connection creation, header/body bytes,
request rate, and aggregate concurrent requests before traffic reaches the
container. Any upstream overload response must be fixed and must not
automatically retry bounded-mutation methods.

A future multi-replica deployment needs the durable operation journal already
identified by the architecture decision plus an ingress-level rate and
concurrency policy. Increasing these process-local counters is not a
replacement for either boundary.
