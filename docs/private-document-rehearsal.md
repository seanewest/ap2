# Private-document contract rehearsal

The private-document rehearsal is a deterministic, network-free compatibility
check for the canonical scenario plan, lifecycle state machine, lifecycle
adapter, and evidence-receipt verifier. It runs the production contract code
against an injected in-memory fake. It does not run a Microsoft Graph
transport, create an artifact, persist a journal, or inspect external evidence.

Run either sanitized fixture through the bounded CLI:

```sh
npm run rehearse:private-document -- \
  scripts/fixtures/private-document-rehearsal-cleaned.json

npm run rehearse:private-document -- \
  scripts/fixtures/private-document-rehearsal-learner.json
```

The CLI accepts exactly one regular JSON file of at most 8 KiB and writes only
deterministic JSON to standard output. The request contains only the schema
version, `REHEARSAL_ONLY` label, canonical scenario ID, and one of two
synthetic branches. Extra fields and unsupported values fail closed.

## Pipeline

The pipeline:

1. compiles the canonical private-document manifest into its frozen scenario
   plan and digest;
2. runs the PR #82 lifecycle state machine with deterministic memory-only
   transport, journal, and clock fakes;
3. reduces only its bounded categorical result, ordered journal, and synthetic
   terminal state into the PR #85 adapter input;
4. lets that adapter build and internally verify a candidate PR #78 receipt;
   and
5. invokes the PR #78 verifier again before emitting a safe rehearsal summary.

The output binds the scenario and manifest version, plan digest, selected fake
branch, exact categorical terminal state, and a digest of the reduced fake
run. It never emits the internal marker, correlation, identities, drive,
folder, file, permission, payload, journal path, timestamps, or backend state.

## Synthetic branches

`cleaned-canary` rehearses the honest cleaned-canary boundary: producer-side
staging and ordered cleanup reach the expected synthetic states, but the
initial learner read and learner terminal observation are not proven. A
separate synthetic three-round terminal summary exercises the adapter's
bounded cleanup contract.

`learner-observation` rehearses the adapter's exact successful learner-read
branch and terminal absence path. It does not claim that a learner accessed a
real document.

Both outputs deliberately report producer staging, learner visibility,
interpretation, audit/detection, response, cleanup, and retention as
`uninspected`. Adapter acceptance proves contract compatibility only. A fake
operation, observation, or absence never becomes external evidence.

## Refusal boundary

The fake lifecycle is injected once and is never retried. Ambiguous, failed,
incomplete, nonterminal, reordered, duplicated, mixed-correlation, unsafe,
unknown, cleanup-gap, and evidence-overclaim inputs are refused with one
categorical failure. A valid synthetic result for the wrong requested branch
is also refused. No refusal echoes input or backend data.

The pipeline has no API route, UI, live transport, tenant call, deployment,
mutation, browser path, Windows-host dependency, or output-file write.
