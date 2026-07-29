# Three-VM AVD manifest lifecycle adapter

The local adapter connects the canonical `avd-three-vm-substrate` registry
entry to the existing three-VM lifecycle planner and runner. It does not add a
third scenario or runner schema. The manifest remains authoritative for actor
roles, evidence expectations, expiry, cost ceiling, cleanup ownership,
temporary permissions, and retained evidence. The caller supplies only
sanitized aliases plus a fixed planning time and an independently observed
image, quota, private-network, outbound, and cost-basis snapshot.

The adapter fails before a runner is created when:

- the registry object is not the canonical runtime-validated manifest;
- its three-node resource roles, operation capabilities, evidence semantics,
  cleanup ownership, or retention inventory drift from the lifecycle runner;
- the caller requests a public VM address, lacks explicit shared outbound, or
  supplies insufficient quota;
- cost, expiry, permission, or role bindings disagree;
- learner evidence is claimed despite the canonical zero-session result; or
- runtime input contains raw GUIDs, UPNs, private paths, credentials, tokens,
  browser/session state, request bodies, or raw responses.

The resulting plan is produced only by `buildFrozenLabPlan`. The runner keeps
its existing expiry-before-billing, one-shot mutation, bounded reconciliation,
fresh-token role proof, ordered cleanup, and terminal replay rules.

## Network-free product-path check

```sh
npm run dry-run:avd-manifest-lifecycle
```

This command loads the canonical registry entry, compiles it through the
adapter, runs the real lifecycle runner against deterministic in-process
adapters, validates the canonical terminal replay fixture, and repeats the
terminal call to prove that no write is replayed. It performs no network,
tenant, cloud, browser, persistence, or learner operation. Output is one
bounded JSON object containing only categorical status and operation counts;
`cloudOperations` is always `not-performed`.

The generic scenario-plan compiler is deliberately not a dependency of this
adapter. A later integration can pass its validated pre-run result as another
caller readiness gate once that contract explicitly references lifecycle
runner inputs; no unmerged evidence-receipt interface is assumed here.
