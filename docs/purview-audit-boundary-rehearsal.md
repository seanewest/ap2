# Purview audit-boundary contract rehearsal

The Purview audit-boundary rehearsal is a deterministic, network-free
composition of the receipt-facing canonical Purview manifest, the real
scenario plan compiler, the Purview operation receipt adapter, the canonical
receipt verifier, and the shared rehearsal envelope.

Run the checked-in request:

```text
npm run rehearse:purview-audit-boundary -- \
  scripts/fixtures/purview-audit-boundary-rehearsal.json
```

The CLI reads exactly one bounded canonical JSON file and writes one bounded
result to standard output. It performs no audit search, result read, Graph or
Purview call, scenario execution, persistence, or external mutation.

## Synthetic boundary

The injected fake represents two synthetic pages containing one duplicate
categorical operation record. The pipeline requires an exact terminal
deduplication result and passes only the resulting categorical adapter input
to the existing receipt adapter. The verified synthetic receipt therefore
contains exactly one producer-attribution claim even though the fake exercises
duplicate-page handling.

The output always says `REHEARSAL_ONLY`. Its shared envelope leaves audit
submission, result reading, live workload activity, operation attribution,
content, learner visibility and interpretation, response, cleanup, retention,
and impact `uninspected`. Synthetic receipt claims exercise contract
composition only; they do not prove those external facts.

## Bindings and refusal

Successful output binds the exact scenario and manifest version, compiled plan,
synthetic input, candidate receipt, and deterministic output projection with
SHA-256 digests. The output digest covers the complete result except its own
digest field, avoiding a circular value.

Missing, extra, reordered, oversized, unsafe, ambiguous, nonterminal,
cross-scenario, mismatched, non-deduplicated, overclaiming, or digest-drifted
input is refused categorically. Raw identities, record values, markers,
timestamps, paths, tokens, payloads, and arbitrary errors are never emitted.

This receipt-facing Purview manifest remains outside the runnable operator
scenario registry, so the rehearsal does not add a UI/API execution surface or
change the canonical runtime surface inventory.
