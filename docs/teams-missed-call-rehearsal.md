# Teams missed-call contract rehearsal

The Teams missed-call rehearsal is a deterministic, network-free composition
of the canonical scenario plan, an injected fake lifecycle, the Teams
observation-to-receipt adapter, the receipt verifier, and the shared rehearsal
envelope. Run one explicit canonical input with:

```text
npm run rehearse:teams-missed-call -- \
  scripts/fixtures/teams-missed-call-rehearsal-stage-only.json
```

The CLI reads at most 8 KiB from that one file, accepts canonical JSON only,
and prints a bounded categorical result. It performs no call, API request,
retry, tenant mutation, browser action, or persistence.

## Synthetic branches

- `stage-only` exercises one fake completed staging attempt.
- `native-retained` adds exactly one synthetic missed-incoming history row,
  one matching synthetic Activity item, and retained state.
- `reported-retained` adds the optional synthetic learner report while
  retaining the two native observations.
- `native-cleaned` adds independent synthetic two-surface terminal absence.

Reporting does not imply cleanup. Hang-up, elapsed time, a quality prompt, or
absence on one surface cannot satisfy terminal cleanup.

## Evidence boundary

Adapter and receipt-verifier acceptance establish only internal contract
composition. The output is always labeled `REHEARSAL_ONLY`, bound to the
canonical scenario and manifest version plus plan and fake-run digests, and
declares every external claim `uninspected`. In particular, it does not prove a
live call, native missed-call row, Activity item, learner visibility or
interpretation, response, retention, cleanup, voicemail, callback, bot path,
identity, or any other external result. Even the optional synthetic report
does not upgrade the canonical learner-interpretation claim.

Inputs with unsafe values, invalid lifecycle order, duplicate or conflicting
terminal events, one-surface evidence or cleanup, bot/human conflation,
voicemail or callback inference, branch mismatch, or nonterminal outcomes fail
closed. Output contains only fixed categorical values and digests; raw
identifiers, markers, timestamps, durations, payloads, paths, client state, and
arbitrary text are never propagated.
