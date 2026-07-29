# Durable operation journal decision

Status: **adapter implemented; live storage architecture remains deferred**

The repository's
[single-replica fallback](api-single-replica-fallback.md) remains mandatory
until an approved shared table, network path, and managed-identity data role
are configured and proven. PR #144 defines the state machine. The
[shared operation journal](shared-operation-journal.md) now implements its
Azure Table conditional-write adapter and emulator contract, but does not
provision or approve a live store.

The main AP2 API cannot replace its process-local mutation boundaries without
choosing and provisioning a shared durable store. Its source and configuration
currently define no such store, connection contract, dependency, deployment
resource, or managed-identity data role. Do not substitute process memory, the
container filesystem, or a mounted file share: none can establish the required
cross-replica claim and crash-recovery semantics.

## Existing product consumers

This is not a speculative abstraction. Two production-wired operations depend
on process-local coordination:

| Route pair | Boundary | Stable mutation identity | Existing recovery read |
| --- | --- | --- | --- |
| `POST` / `DELETE /api/onedrive-share-proof` | `ProcessLocalOneDriveShareProofBoundary` | fixed proof path, Homer actor, Marge target | exact path/content/permission reads exist inside the operation, but share recovery is not exposed as a boundary contract |
| `POST /api/calendar-meeting` / `POST /api/calendar-meeting/cancel` | `ProcessLocalCalendarMeetingBoundary` | calendar run property and transaction ID, Cory actor, Kobe/Marge targets | cancel can recover the exact event by the run property; create has no boundary-level reconciliation result |

`api/index.ts` constructs both boundaries around their delegated Graph
operations. `api/server.ts` turns their busy errors into HTTP 409 responses.
The browser client consumes those responses. Other fixed proof operations do
not currently use this boundary, so the first durable contract must not be
wired to them without deriving their recovery semantics separately.

The current main API Container App is deliberately constrained to one replica.
Its runtime dependencies are Microsoft identity, token verification, and
browser automation only. The repository contains no main API infrastructure
definition and no main API storage endpoint or credential configuration. The
documented live shape is one Container App backed by ACR and a Container Apps
environment.

The separate Teams calling-bot service does have Bicep and an existing Azure
Files environment-storage binding for one exclusive JSONL journal. That
journal is deliberately single-replica and fail-closed: it uses exclusive
filesystem creation and an account-key-backed Container Apps mount. It offers
no shared compare-and-swap claim or operation-specific reconciliation
contract, and it belongs to a different service. It is therefore evidence of a
special-purpose retained canary journal, not an intended shared store for the
main API.

## Required journal contract

Once a production store is selected, one journal record represents exactly
one canonical tuple:

1. scenario marker;
2. mutation-phase-specific operation kind (`onedrive.share`,
   `onedrive.remove`, `calendar.create`, or `calendar.cancel`);
3. intended actor identity; and
4. intended target identity.

The store key should be a versioned digest of that tuple while the record keeps
only the non-secret immutable identity fields needed to reject a digest
collision or marker/actor/target mismatch. It must never contain access
tokens, certificates, passwords, passphrases, cookies, browser state,
simulated-user caches, raw tenant objects, unrestricted request bodies, or raw
upstream responses.

Allowed states are:

- `prepared`: the unique record exists, but mutation has not started;
- `executing`: one owner holds the unexpired lease and may make the mutation;
- `succeeded`: the exact outcome was confirmed;
- `failed`: a terminal failure proved the mutation did not occur; and
- `ambiguous`: execution may have occurred and replay is forbidden.

Creation and every transition require one atomic conditional write. A claimant
may take an expired `prepared` lease. It may never turn an expired `executing`
lease back into permission to mutate. Instead it records or returns
`ambiguous`, then invokes the operation-specific read-only reconciler. Only
that reconciler may transition ambiguity to terminal success or terminal
failure. An unavailable or inconclusive read leaves the record ambiguous and
returns a decision-ready conflict.

An ambiguous conditional-store create or transition response grants no
ownership and permits no mutation or automatic write retry. Reconcile it first
with one exact read of the immutable key, schema version, record version, and
lease owner. A reconciled `prepared` record permits only the next conditional
transition. Dispatch is allowed only after an unambiguous conditional
transition to `executing`, or when the exact read proves the caller owns the
expected `executing` state, lease, and record version. Otherwise preserve the
record and return conflict.

Missing, malformed, or corrupt schema versions, immutable tuple fields, record
versions/ETags, states, lease owners, or lease expiries fail closed. The API
must not overwrite, recreate, expire, or compact such a record into an
executable state. Once a record reached `executing`, lease expiry or target
absence alone cannot prove terminal failure because the original external
request may still complete. Only authoritative operation-specific
reconciliation may establish terminal failure; without that proof, the
ambiguous tombstone remains and replay stays forbidden.

Terminal records suppress replay. A marker is immutable and unique to one
scenario lifetime. Detailed records may be compacted after the scenario's
declared retention window, but a minimal terminal or ambiguous tombstone must
remain until the scenario marker is retired and the API no longer accepts it.
Unresolved ambiguity must never expire back into executability.

Health output may expose only store availability, aggregate state counts,
expired-lease count, and oldest ambiguous age. It must not expose keys,
identities, target data, errors, or record contents.

## Existing-platform options

### 1. Azure Table Storage — recommended

One StorageV2 table can atomically reject duplicate entity insertion and use
ETags for conditional state transitions. The Container App's managed identity
can receive `Storage Table Data Contributor` at table scope, avoiding account
keys. One entity per operation tuple is sufficient; no cross-entity
transaction is required.

This is the smallest production change, but it is still a new shared
persistence service, SDK dependency, endpoint setting, data-role assignment,
retention job, and availability dependency. The repository does not establish
which storage account, network posture, resource ownership, or retention
period should be used.

### 2. Azure Blob Storage

Conditional blob creation, ETags, and blob leases can serialize one record.
This needs more bespoke lease and document-update code, and the application
must reconcile uncertain lease/write responses. It has no advantage over a
table for the current single-record state machine.

### 3. Azure Cosmos DB

Conditional item updates and native TTL are a strong fit, but Cosmos adds a
database account, capacity/cost choices, and a larger operational surface than
the current workload warrants.

### 4. Dapr state management

Container Apps can host a Dapr sidecar, but Dapr still requires a configured
backing state store. The repository has neither Dapr nor a backing component,
so this adds an indirection without resolving the persistence decision.

### 5. Service Bus or Azure Files

Service Bus duplicate detection does not by itself provide the queryable
journal and read-reconciliation state. The calling bot's existing Azure Files
journal proves only exclusive file creation for a one-replica canary; it is not
the intended atomic cross-replica journal contract, and its Container Apps
mount introduces storage-account-key custody. Neither is recommended.

## Remaining deployment decision

Azure Table Storage is selected and its production adapter is implemented. A
later bounded deployment lane must designate an existing or authorize a new
StorageV2 account/table, freeze its network posture and owner, assign the API
managed identity table-scoped data access, choose the live retention period,
and prove cloud readiness. It must then wire each operation-specific read-only
reconciler before allowing more than one replica.

The current emulator suite proves conditional claims across two independent
processes plus a fresh process, prepared lease expiry, executing replay
suppression, terminal and ambiguous tombstones, corruption refusal, exact
retirement, and uncertain-write reconciliation. It does not prove Azure
managed identity, RBAC, networking, availability, or the existing operations'
reconciliation wiring.

## Platform references

- [Table entity updates use ETags for optimistic concurrency](https://learn.microsoft.com/en-us/rest/api/storageservices/update-entity2)
- [Table data supports Microsoft Entra authorization and managed identities](https://learn.microsoft.com/en-us/azure/storage/tables/authorize-access-azure-active-directory)
- [Table data roles can be scoped to one table](https://learn.microsoft.com/en-us/azure/storage/tables/assign-azure-role-data-access)
- [Blob leases lock blob write and delete operations](https://learn.microsoft.com/en-us/rest/api/storageservices/lease-blob)
- [Container Apps Dapr state management requires a backing state store](https://learn.microsoft.com/en-us/azure/container-apps/microservices-dapr)
- [Container Apps Azure Files mounts require a storage account and file share](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files)
