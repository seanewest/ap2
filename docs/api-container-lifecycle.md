# API container lifecycle

The production API container has one process-local lifecycle boundary. It is
ready only while the HTTP listener is accepting work and shutdown has not
begun.

On `SIGTERM` or `SIGINT`, the API synchronously enters draining state before
closing the listener. Every request that reaches dispatch after that transition,
including `/health`, receives the fixed `503` response
`{"error":"server_shutting_down"}`. This check occurs before origin handling,
operator authentication, or request-body parsing, so an already-active
keep-alive connection cannot admit another pure or mutating operation.

Requests admitted before the transition retain their existing bounded route
contracts and may finish. The listener closes after those requests drain. If
they do not drain within ten seconds, the existing categorical timeout exits
the process with status 1; the API does not retry, persist, or resume their
work. A normal drain exits with status 0.

`npm run test:api-lifecycle-container` builds and exercises the real production
image. It proves:

- invalid configuration exits nonzero before readiness;
- the Docker health command succeeds only after the listener serves `/health`;
- one authenticated pure request held in flight completes after `SIGTERM`;
- a mutation pipelined on that active connection after the signal is refused
  with the shutdown category;
- health is no longer ready after the shutdown transition;
- both `SIGTERM` and `SIGINT` close the listener and exit cleanly; and
- the test removes its containers and image.

The test prints measured startup-failure, readiness, drain, and interrupt-exit
times for that local run. Those observations validate the lifecycle contract;
they are not hosted-deployment readiness evidence or an orchestration SLA.
