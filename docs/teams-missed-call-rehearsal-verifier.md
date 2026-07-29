# Teams missed-call rehearsal output verifier

The offline verifier independently checks one bounded, sanitized output from
the [Teams missed-call contract rehearsal](teams-missed-call-rehearsal.md).
Run it with one explicit canonical JSON file:

```text
npm run verify:teams-missed-call-rehearsal -- \
  scripts/fixtures/teams-missed-call-rehearsal-output-stage-only.json
```

The CLI reads at most 32 KiB, accepts canonical pretty-printed JSON only, and
prints either a fixed safe verification summary or one categorical refusal.
It performs no fake execution, call, network request, retry, external mutation,
or persistence.

## Independent verification

For the declared branch, the verifier:

1. recompiles the canonical scenario plan;
2. reconstructs the exact one-attempt licensed-user staging input and the
   branch-specific history, Activity, report, retention, and cleanup
   categories without calling the rehearsal fake;
3. recomputes the canonical plan and fake-contract SHA-256 bindings;
4. invokes the Teams observation-to-receipt adapter and the scenario receipt
   verifier directly;
5. checks the shared `REHEARSAL_ONLY` terminal, synthetic-only, and
   all-external-claims-uninspected envelope invariants; and
6. compares every ordered field with the independently expected output.

The four committed positive fixtures are independently authored, sanitized
review fixtures for `stage-only`, `native-retained`, `reported-retained`, and
`native-cleaned`. They are not produced by the verifier or by a verifier-owned
factory.

## Evidence boundary

Verification proves only that the supplied offline result is internally
consistent with repository contracts. Every external claim and the canonical
learner-interpretation claim must remain `uninspected`. A completed synthetic
stage never proves a native missed-call row, Activity item, learner visibility
or interpretation, cleanup, voicemail, callback, bot behavior, identity, or
external proof.

Native evidence requires the exact paired history and Activity categories.
The optional report is independent of cleanup. The cleaned branch requires
the independently reconstructed two-surface terminal-absence input and absent
retention. Missing, extra, reordered, duplicated, unsafe, oversized,
cross-family, nonterminal, one-surface, coupled, overclaiming, or
digest/branch/plan-tampered values fail closed.
