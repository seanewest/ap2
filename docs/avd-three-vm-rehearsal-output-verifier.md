# Three-VM rehearsal output verifier

> The verifier remains available through its CLI, API, client, fixtures, and
> tests. Its manual JSON panel was removed from the primary SPA.

The offline verifier accepts only the exact successful output envelope emitted
by the canonical three-VM `REHEARSAL_ONLY` pipeline. It recomputes the
scenario-plan digest and manifest-to-runner plan, checks the terminal journal
and synthetic observation summary, rebuilds the typed post-run receipt
envelope, and invokes the authoritative evidence-receipt verifier.

Run it against one explicit PR #83 output file:

```sh
npm run verify:avd-three-vm-rehearsal -- rehearsal-output.json
```

The file must be at most 256 KiB and use the pipeline CLI's canonical
two-space JSON format with one terminal newline. Missing, extra, reordered, or
duplicate fields fail closed. Failures contain only a fixed category and never
echo input data or paths.

The verifier performs no scenario or runner execution, network access, retry,
mutation, or write. It reads only the supplied file. A successful result means
that the bounded local rehearsal contracts are internally consistent. It does
not prove that Azure, Microsoft 365, a learner session, an external detector,
or cleanup occurred.

## Authenticated in-memory API

Operators may submit the same sanitized envelope to
`POST /api/rehearsal-output-verification`. The endpoint authenticates and
authorizes through the existing operator policy before reading a strict JSON
body, applies deterministic request and response caps, and invokes this
verifier synchronously in memory. It returns only the verifier's categorical
refusal or bounded safe summary.

The typed `HttpAfterPartyApi.verifyRehearsalOutput` client streams the response
under a hard cap and validates every returned field. Its request type reaches
the PR #83 envelope through a type-only import, so browser code does not load
the runner or verifier graph.

This endpoint does not run or schedule the rehearsal, obtain observations,
ingest telemetry, persist a receipt, call an external service, or prove that
any external work occurred. `synthetic-only` and `all-uninspected` remain
mandatory result labels.

Every authoritative evidence claim is rebuilt as `uninspected` and checked by
the receipt verifier. Synthetic observations remain synthetic; they cannot be
promoted to authentic artifacts, external proof, learner evidence, or
cleanup-absence proof.

## Primary SPA boundary

The primary SPA does not expose this verifier or accept pasted envelopes. The
bounded API, typed client, offline CLI, fixtures, and tests remain supported.

The outer label, canonical JSON, safe-string, plan-binding, terminal, and
all-uninspected checks use the
[shared rehearsal envelope invariants](rehearsal-envelope-invariants.md).
AVD runner-journal, cleanup, observation-count, and receipt-coverage semantics
remain local to this verifier.
