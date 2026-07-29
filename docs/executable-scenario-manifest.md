# Executable generalized scenario manifest

`compileExecutableScenarioManifest` is a pure, local composition boundary for
an already-authored scenario lifecycle. It does not execute a scenario. It
accepts the exact manifest and canonical plan already bound by the lifecycle
cost request plus an evidence receipt, then invokes the existing supplied-rate
cost compiler and evidence-receipt verifier directly.

An accepted result is labeled `EXECUTABLE_MANIFEST_CONTRACT`,
`contract-ready`, and `not-executed`. The safe summary binds the scenario and
plan digest, canonical role ownership, categorical topology counts, lifecycle
phase counts, receipt claim-state counts, and the complete `FORECAST_ONLY`
cost envelope. It emits no lifecycle marker, runtime resource ID, rate-card
payload, or evidence body.

## Dependency and lifecycle rules

The manifest operation graph is explicit and acyclic. The expiry-schedule
operation is the sole root. Every other operation names at least one
dependency, and every billable create transitively depends on expiry.
Evidence reads transitively depend on setup. A selected learner response
depends on every learner evidence source. Every cleanup operation transitively
depends on that selected response as well as evidence, so the graph cannot
tear down the lab before permitted learner activity finishes. The one terminal
cleanup-state observation is an exact read and depends on every declared
cleanup operation.

The canonical plan must contain each non-optional operation and its selected
response operation exactly once and in dependency order. Existing planning
rules still place executable expiry before billable creation, bind one marker
and cleanup owner, and reject unsupported capabilities. Existing actor
validation still rejects learner/producer
conflation and independent detector conflation. Existing receipt verification
keeps learner visibility, interpretation, response, cleanup, and terminal
claims independently classified.

For the private three-node shape, the compiler requires exactly one personal
AVD host resource, one two-node Linux auxiliary resource, one shared NAT
egress resource, and the declared private-network prerequisite. The
`planned-avd-three-node-lab` fixture uses only operations already represented
by the completed three-VM contract. Its artifacts are planned and learner
visibility is not proven.

The current receipt vocabulary binds to a manifest but has no plan/run digest.
This plan-only composition therefore accepts only an entirely `uninspected`
receipt. That still verifies exact receipt coverage and claim vocabulary
without associating proof from another run with this plan. A future
proof-bearing composition must first add and verify a safe plan binding in the
authoritative receipt contract.

The cost section is not a quote or bill. It accepts only the existing immutable
supplied-rate request, including freshness, region, currency, resource-meter
coverage, four-hour learner duration, parallel provisioning waves, grace,
minimum billing increments, contingency, and caller-supplied ceiling.
