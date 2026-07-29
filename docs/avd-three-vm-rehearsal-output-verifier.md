# Three-VM rehearsal output verifier

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

Every authoritative evidence claim is rebuilt as `uninspected` and checked by
the receipt verifier. Synthetic observations remain synthetic; they cannot be
promoted to authentic artifacts, external proof, learner evidence, or
cleanup-absence proof.
