# Purview audit-boundary rehearsal output verifier

> The verifier remains available through its CLI, API, client, fixtures, and
> tests. Its manual JSON panel was removed from the primary SPA.

The offline verifier checks one canonical sanitized output envelope from the
Purview audit-boundary `REHEARSAL_ONLY` pipeline. It does not invoke that
pipeline or its synthetic detector, submit or read an audit search, call
Microsoft Graph or Purview, inspect tenant state, retry, mutate, or persist
anything.

Run one explicit local JSON output:

```sh
npm run verify:purview-audit-boundary-rehearsal -- rehearsal-output.json
```

The CLI accepts exactly one regular file of at most 32 KiB. Success writes one
fixed safe summary to stdout. Refusal writes one categorical failure to stderr
and exits nonzero. Neither path echoes the input path or arbitrary input
values.

## Primary SPA boundary

The primary SPA does not expose this verifier or accept pasted envelopes. The
bounded API, typed client, offline CLI, fixtures, and tests remain supported.

## Independent verification

The verifier independently recompiles the dedicated canonical zero-cost
Purview plan and reconstructs the categorical adapter input represented by
two synthetic pages containing one duplicate observation. It directly invokes
the Purview operation-to-receipt adapter and canonical evidence-receipt
verifier, requires exactly one producer-attribution claim after
deduplication, and recomputes the plan, synthetic-input, receipt, and output
digests. The shared rehearsal invariants enforce the exact `REHEARSAL_ONLY`
label, terminal state, synthetic-only observation source, bounded safe
content, and all-external-claims-uninspected declaration.

The committed positive fixture was assembled independently from the canonical
manifest, adapter, receipt verifier, and shared envelope contracts. The
offline verifier neither imports nor invokes the pipeline fake or runner.

## Claim boundary

Verification proves only that the supplied JSON is internally consistent with
the repository contracts. Audit-search submission or result access, a live
SharePoint operation, external producer attribution, content, learner
visibility or interpretation, response, cleanup, retention, and external
impact all remain `uninspected`.

Missing, duplicated, reordered, ambiguous, nonterminal, or
cardinality-incorrect observations fail closed. So do scenario/version/plan,
synthetic-input, receipt, or output drift; malformed, oversized, unsafe, or
cross-family data; unknown fields; receipt overclaims; and any external claim
promotion. Post-rehearsal state is never accepted as proof of an earlier live
observation.
