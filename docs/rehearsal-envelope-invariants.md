# Shared rehearsal envelope invariants

The AVD, private-document, and Teams missed-call rehearsal families have
different execution and evidence semantics, but their offline output
contracts converge on a small
outer-envelope contract. The browser/server-neutral
`rehearsal-envelope-invariants.ts` module owns only that shared boundary.

It provides:

- the exact `REHEARSAL_ONLY` and verified labels;
- bounded UTF-8 JSON parsing with canonical field order and terminal newline;
- one shared unsafe-string traversal for values and keys;
- exact ordered-record shape checks;
- scenario ID, manifest version, and SHA-256 plan binding;
- the successful terminal category derived from `completed` plus no failure;
- synthetic-only categorical observation validation; and
- all-external-claims-uninspected cardinality validation.

The extraction removes two production copies of the JSON parser, byte-bound
check, sensitive-string patterns and traversal, record-shape comparison,
plan-digest validation, and terminal/claim declarations. Each verifier maps a
small shared failure vocabulary to its existing public categorical error type,
so API, CLI, and client behavior remains unchanged.

## Family boundaries

The shared module does not know any family output schema. Each verifier
supplies its own exact ordered keys and canonical scenario binding, so an AVD envelope
cannot pass as a private-document envelope or Teams missed-call envelope, and
vice versa.

AVD mutation counts, runner journal transitions, cleanup graph, synthetic
readiness counts, receipt binding, and missing coverage remain exclusively in
the PR #83/#86 family.

Private-document staging order, pre-cleanup learner visibility, post-cleanup
learner absence, three-round terminal reconciliation, fake-contract digest,
PR #85 adapter, and PR #78 receipt semantics remain exclusively in the
PR #90/#94 family. Terminal learner absence cannot satisfy the earlier
visibility claim.

Teams missed-call one-attempt staging, two-surface history and Activity
semantics, optional reporting, independent retained or two-surface cleanup
state, PR #101 adapter, and PR #78 receipt semantics remain exclusively in the
Teams rehearsal family. Synthetic adapter acceptance never upgrades the
canonical learner-interpretation or any external claim beyond `uninspected`.

The module performs no pipeline, verifier, adapter, runner, network, retry,
mutation, persistence, browser, or Windows-host action. Both pipeline output
schemas and committed fixture bytes remain family-owned.
