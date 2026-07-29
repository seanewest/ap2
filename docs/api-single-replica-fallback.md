# API single-replica fallback

AP2 has no approved, configured, and live-proven shared conditional-write
operation journal. Although the repository now includes the
[Azure Table adapter](shared-operation-journal.md), the main API must run with
both minimum and maximum replicas fixed at one until a later lane establishes
the exact table, managed-identity role, network path, and readiness proof. This
is a fail-closed fallback, not cross-replica serialization.

PR #144 froze the required future journal state machine. It did not add a
store, a lease implementation, a journal-ready switch, or any protection
between replicas.

`npm run check:api-replicas` validates the committed, exact main-API topology
plan in `scripts/fixtures/api-single-replica-plan.json`. The bounded schema
accepts only `ca-ap2-api`, `minReplicas: 1`, and `maxReplicas: 1`; missing,
extra, malformed, or drifted fields fail categorically. It is the explicit
input contract for any future repository deployment command.

The repository has no main-API deployment command or hosted deployment
workflow. Its one declarative main-API artifact path is the
[offline Container Apps artifact compiler](api-container-app-deployment-artifact.md).
That compiler consumes this exact validated plan instead of restating replica
values. It emits data only; it cannot deploy or call Azure. The check does not
infer coverage by scanning filenames or deployment syntax, and the separate
calling-bot template is not evidence for the main API.

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
replicas requires an approved live shared-store configuration, operation-
specific reconciliation wiring, cloud readiness proof, and independent
review. Emulator proof alone cannot satisfy that boundary.
