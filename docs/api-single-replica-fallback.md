# API single-replica fallback

AP2 has no approved shared conditional-write operation journal. Until one is
selected and implemented, the main API must run with both minimum and maximum
replicas fixed at one. This is a fail-closed fallback, not cross-replica
serialization.

PR #144 froze the required future journal state machine. It did not add a
store, a lease implementation, a journal-ready switch, or any protection
between replicas.

`npm run check:api-replicas` validates the committed, exact main-API topology
plan in `scripts/fixtures/api-single-replica-plan.json`. The bounded schema
accepts only `ca-ap2-api`, `minReplicas: 1`, and `maxReplicas: 1`; missing,
extra, malformed, or drifted fields fail categorically. It is the explicit
input contract for any future repository deployment command.

The repository has no main-API IaC, deployment command, or hosted deployment
workflow today. The check does not infer coverage by scanning filenames or
deployment syntax, and the separate calling-bot template is not evidence for
the main API. When a real deployment path is added, it must consume the exact
validated plan rather than restating replica values or relying on heuristic
discovery.

The API's existing read-only rehearsal-status operation independently reads
the fixed Container App ARM resource and refuses readiness unless
`properties.template.scale.minReplicas` and `maxReplicas` are both exactly
one. The safe response remains name, region, running status, and latest ready
revision only; scale data and the raw ARM response do not leave the API.

The production Docker image remains topology-neutral: building or starting one
container does not prove deployment replica count. A future deployment is
acceptable only when it consumes the validated one-to-one plan and the later
authoritative readiness read observes that exact scale.

Do not replace this invariant with an environment flag. Enabling multiple
replicas requires the explicit shared-store architecture decision, the
conditional journal implementation, operation-specific reconciliation, and
their independent review.
