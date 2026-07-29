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
contracts and may finish. Connection closure never generically cancels an
already-dispatched operation; operation-specific recovery remains authoritative.
The listener closes after those requests drain. If
they do not drain within ten seconds, the existing categorical timeout exits
the process with status 1; the API does not retry, persist, or resume their
work. A normal drain exits with status 0.

Before shutdown, one
[process-local backpressure boundary](api-abuse-backpressure.md) admits
bounded work by the route registry's side-effect class. A full lane refuses
immediately without authenticating, reading JSON, queueing, or retrying. This
single-process boundary does not replace ingress rate/connection controls,
`maxReplicas=1`, or a durable cross-replica mutation journal.

`npm run test:api-lifecycle-container` builds and exercises the real production
image. It proves:

- invalid configuration exits nonzero before readiness;
- the Docker health command succeeds only after the listener serves `/health`;
- one authenticated pure request held in flight completes after `SIGTERM`;
- a mutation pipelined on that active connection after the signal is refused
  with the shutdown category;
- health is no longer ready after the shutdown transition;
- both `SIGTERM` and `SIGINT` close the listener and exit cleanly; and
- one partial request held beyond the drain window exits nonzero with the
  categorical forced-exit record; and
- the test removes its containers and image.

The test prints measured startup-failure, readiness, drain, and interrupt-exit
times for that local run. Those observations validate the lifecycle contract;
they are not hosted-deployment readiness evidence or an orchestration SLA.

## Production image boundary

The API image uses the exact Playwright release and Ubuntu-family tag that
matches the runtime `playwright` package. Both Docker stages also pin the
approved linux/amd64 child-manifest digest. `container-base-lock.json` records
the tag's manifest-list digest, its single linux/amd64 child digest, and the
intended platform. The image remains intentionally linux/amd64-only.

`npm run update:api-container-base` is the sole base-renewal command. It reads
the exact Playwright version from `package.json`, queries only Microsoft's
Container Registry over TLS, hashes the returned manifest list and child
manifest, and hashes the child's config before accepting its declared
linux/amd64 platform. It then rewrites only the deterministic base lock and
the two bounded `FROM` lines. The resulting digest change is ordinary reviewable
source; the command does not pull, build, publish, or approve an image. Routine
Playwright updates therefore update the package lock first, run this command,
and review both dependency and base-digest changes together.

The final stage contains `dist-api/index.js`, production `node_modules`, and
`container-provenance.json`; build source maps are removed before the stage
copy. The image runs as `pwuser` and exposes only port 3000. The rootless
production-container test proves compatibility with a read-only root
filesystem, all capabilities dropped, `no-new-privileges`, the default seccomp
filter, and no host/device mounts. Chromium receives only a bounded `/tmp`
tmpfs when its local proof runs.

`npm run check:api-container-provenance` deterministically binds every file in
the Docker build input allowlist, the complete lockfile, the base lock's tag,
index digest, linux/amd64 manifest digest, and each installed production Node
dependency. It rejects a tag-only `FROM`, a stale Playwright/base-lock pair, a
wrong platform, malformed digest, or a Dockerfile/lock mismatch without a
registry read. During the image build, it additionally binds the exact sole API
bundle by path, byte count, and digest. The embedded manifest lists only that
fixed image-relative artifact path, public package name/version/integrity
metadata, and bounded classification fields; source contents or paths,
resolution URLs, environment values, and registry credentials are never
emitted. The production-container test compares the embedded base, input, and
dependency bindings to the current repository, then independently hashes the
final bundle and manifest.

This is deliberately a provenance manifest, not a published SBOM or
attestation. The pinned child manifest binds the selected base bytes but does
not enumerate or independently attest its OS and browser components; the final
image digest is available only after build. Publishing an SBOM, image, or
attestation remains a separate operational decision.
