# Help-desk email rehearsal output verifier

The offline verifier checks one saved canonical output from the
[help-desk email contract rehearsal](help-desk-email-rehearsal.md). It does
not invoke that pipeline, construct its fake operation, send email, call
Microsoft Graph, inspect a mailbox, retry, mutate, or persist anything.

Run one explicit local JSON output:

```sh
npm run verify:help-desk-email-rehearsal -- rehearsal-output.json
```

The CLI accepts exactly one regular file of at most 32 KiB. Success writes one
fixed-schema safe summary to standard output. Refusal writes one categorical
failure to standard error and exits nonzero. Neither path echoes the input
path or arbitrary input values.

## Independent verification

For the selected `send-accepted`, `learner-observed-retained`, or
`learner-observed-cleaned` branch, the verifier:

1. independently recompiles the canonical zero-cost scenario plan;
2. reconstructs the exact categorical two-event one-shot journal and the
   branch's learner, retention, and cleanup observations without importing or
   invoking the rehearsal fake;
3. directly invokes the help-desk operation-to-receipt adapter and the
   authoritative scenario receipt verifier;
4. recomputes the stable plan and reduced fake-contract SHA-256 digests;
5. applies the shared `REHEARSAL_ONLY` scenario/version/plan, terminal,
   synthetic-only, and all-external-claims-uninspected invariants; and
6. compares every outer and nested field against the independently
   reconstructed canonical output.

The three committed PR #103 output fixtures are the positive reviewer
fixtures. The verifier does not generate or rewrite them.

## Claim boundary

The verified summary means only that the saved JSON is internally consistent
with the repository contracts. Email send, Inbox visibility, learner
interpretation, response, cleanup, retention, audit/detection, Teams call, and
voicemail remain externally `uninspected` in every branch.

Send acceptance cannot prove Inbox visibility. The retained branch requires
the distinct synthetic learner observation. The cleaned branch requires that
same pre-cleanup observation plus the exact cleanup and terminal-absence
categories; post-cleanup absence cannot replace earlier visibility.
Interpretation is never promoted because the canonical manifest does not mark
it completed.

## Refusal boundary

The verifier categorically rejects missing, extra, reordered, duplicated,
malformed, oversized, unsafe, raw-identifier, subject/body, marker, path, UPN,
token-like, digest-tampered, nonterminal, branch-mismatched, cleanup-gap,
retained-as-cleaned, cross-family, and evidence-overclaim inputs. It also
rejects adapter/verifier/envelope or claim-count drift.

The implementation has no fake lifecycle, runner, send, network, retry,
mutation, API route/client, UI, browser, or Windows-host path.
