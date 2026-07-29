# Three-VM scenario rehearsal

The three-VM rehearsal is a deterministic, network-free compatibility check
for the canonical AVD scenario contracts. It composes the scenario-plan
compiler, manifest-to-runner adapter, lifecycle runner with synthetic
adapters, and evidence-receipt verifier without changing those schemas.

Run it with one explicit sanitized request file:

```sh
npm run rehearse:avd-three-vm -- request.json
```

The command reads only that file and emits a bounded JSON result labeled
`REHEARSAL_ONLY`. It performs no Azure or Microsoft 365 operation and writes no
files. A fixed input produces a fixed result.

## What a green rehearsal proves

- the canonical plan compiles and its digest remains bound to the runner input;
- topology, roles, cost, expiry, cleanup, and retention contracts are
  compatible;
- the fake lifecycle runner follows its mutation, reconciliation, cleanup, and
  terminal-replay rules;
- the post-run receipt envelope is bound to the plan digest, run state,
  synthetic observations, and supplied terminal inputs; its authoritative
  receipt has canonical claim coverage and passes structural verification.

## What it does not prove

Synthetic observations are always labeled synthetic. They are not authentic
external artifacts, independent detector observations, learner-visible
evidence, cleanup-absence evidence, or proof that any cloud operation occurred.
The rehearsal receipt deliberately downgrades every claim to `uninspected`;
missing or contradictory inputs never become guessed proof. A learner-session
observation must remain `not-observed`, so zero learner sessions stays zero.

The result contains only categorical stage status, a plan digest, transition
counts, synthetic observation counts, and incomplete receipt coverage.
Requests containing unsupported fields, raw identity material, unsafe
topology, or contract drift fail closed before the responsible stage proceeds.
