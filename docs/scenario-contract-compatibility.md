# Scenario contract compatibility

The local compatibility check detects drift between the canonical scenario
registry and the existing plan, receipt, AVD, help-desk email,
operation-telemetry, and private-document adapter contracts. It imports and
calls their runtime validators, adapters, and compilers; it does not copy their
schemas, rewrite an input, execute a plan, run a lifecycle, call an API, persist
state, or establish external proof.

Run:

```text
npm run check:scenario-contracts
```

The command accepts no arguments and performs no network work. A compatible
registry exits zero and prints one deterministic JSON matrix. Drift exits
nonzero and writes the same safe shape to standard error.

Each row contains only an already-public canonical scenario ID, bounded
counts, plan-phase categories, receipt observation-source categories, and
applicable adapter names. Output never includes actor aliases, operation keys,
markers, proof references, cost values, expiry timestamps, raw identifiers,
paths, credentials, tokens, payloads, or upstream errors. Failures contain
only a scenario ID or the fixed value `unknown` plus one categorical drift
code. Rows and failures are sorted, deduplicated, and bounded.

## What is checked

For every registry manifest, the checker:

- invokes the manifest validator and real plan compiler with sanitized local
  aliases;
- compares role binding, operation ownership and phases, evidence
  expectations, learner interpretation, optional responses, cleanup,
  retention, cost, expiry, and terminal proof across manifest and plan;
- builds an all-`uninspected` vocabulary probe and passes it through the real
  receipt verifier, so representability never upgrades evidence;
- verifies the scenario's canonical receipt fixture through the same verifier,
  including its observation sources and full coverage rules;
- calls the help-desk email receipt adapter only for that canonical scenario,
  using its accepted-only sanitized input and preserving every unsupported
  evidence category as `uninspected`;
- calls the private-document receipt adapter only for that canonical scenario,
  using a bounded sanitized lifecycle fixture;
- calls the PR #79 AVD manifest adapter only for the canonical AVD scenario,
  using its deterministic network-free readiness input; and
- calls the PR #81 telemetry adapter only when an explicit canonical mapping
  is supplied, then proves every candidate remains an operation row while all
  artifact, learner, response, cleanup, retention, and terminal categories
  remain separately uninspected.

The checker reports drift; it does not repair a manifest, plan, receipt, or
adapter. The owning contract must be corrected deliberately.

The separate
[canonical scenario surface inventory](scenario-surface-inventory.md) reports
which higher repository surfaces exist after compatibility passes. Missing
API, rehearsal, or operator cells remain honest and do not weaken this check.
