# Shared operation journal

AP2 includes a production Azure Table Storage adapter for the durable operation
state machine frozen by PR #144. It is a repository and emulator-proven
contract only: no storage account, table, network path, managed-identity role,
or multi-replica deployment is created or approved by this implementation.
The [single-replica fallback](api-single-replica-fallback.md) therefore remains
authoritative for the current API deployment.

## Production boundary

`api/shared-operation-journal.ts` accepts one bounded immutable tuple:

- a sanitized scenario marker alias;
- one of the four currently frozen mutation phases;
- a sanitized workload-actor alias; and
- a sanitized target alias.

Versioned SHA-256 partition and row keys are deterministic for that tuple. The
entity retains the aliases so a digest collision or immutable-field mismatch
fails closed. Tokens, credentials, request or response bodies, tenant objects,
raw identities, paths, arbitrary errors, and evidence are not accepted.

The production factory accepts only:

- `kind: azure-table-managed-identity`;
- an HTTPS `*.table.core.windows.net` endpoint without query or user info;
- a bounded Azure table name; and
- a bounded retention interval.

It constructs `ManagedIdentityCredential` and disables SDK retries. Connection
strings, account keys, SAS values, HTTP endpoints, unknown fields, and
unbounded retention are refused. If an explicit future goal enables this
adapter, that work would separately establish the storage resource,
table-scoped `Storage Table Data Contributor` assignment, network reachability,
retention ownership, and cloud readiness. None of that is current Pass 3 work.

## Conditional state transitions

Entity creation is insert-only. Every transition uses full replacement with
the exact current ETag; retirement uses an exact ETag delete only after a
terminal `succeeded` or `failed` record has passed retention and its marker is
explicitly retired. An `ambiguous` record is never deleted.

Only an unambiguous or exactly reconciled `executing` transition grants
dispatch. An expired `prepared` lease may be claimed conditionally. An
`executing` lease, including an expired one, returns
`requires-reconciliation` and never becomes executable again. Terminal
tombstones suppress fresh-process replay. Once an `executing` lease expires, a
fresh claimant conditionally records `ambiguous` with
`executing-lease-expired`, receives no dispatch authority, and leaves terminal
resolution to the operation-specific read-only reconciler.

An uncertain create or update is read exactly once. The write is accepted only
when immutable fields, intended state, record version, lease owner, and ETag
shape validate and the stored state exactly matches the intended write. No
conditional mutation is replayed. An uncertain terminal retirement is also
read exactly once: only confirmed absence counts as reconciled deletion.
Corrupt or unknown records remain preserved and categorical.

## Local proof

Run:

```bash
npm run test:shared-operation-journal-emulator
```

The bounded script starts Azurite Table service in a new Linux temporary
directory with a random emulator-only account key. Two independent Node
processes race for one operation and exactly one reaches `dispatch`; a fresh
third process is refused with `requires-reconciliation`. The script terminates
the emulator and removes its temporary directory in a `finally` path. This
proves local Table conditional semantics, not Azure RBAC, managed identity,
network, availability, or deployment readiness.
