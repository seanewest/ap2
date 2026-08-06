# SharePoint trusted-version lifecycle

`POST /api/sharepoint-trusted-version-lifecycle` is an operator-authorized,
bounded backend capability. It uses the existing API managed identity and its
existing `Sites.ReadWrite.All` Graph application role against the fixed AP2
SharePoint document library. It adds no SPA panel or Lab card.

The request contains only schema version 1, a unique marker matching
`ap2-spv-[a-z0-9]{12}`, and a canonical expiry no more than 30 minutes in the
future. Authorization completes before the 512-byte JSON body is read.

## One-shot lifecycle

The process-local journal reserves the marker and expiry before the first
SharePoint write. The single route invocation then:

1. proves the exact run-folder path absent and creates that folder once;
2. creates `trusted-version.txt` once with the fixed 49-byte trusted content;
3. reads and proves those exact version-one bytes;
4. writes exactly one fixed 70-byte harmless changed version;
5. reads one capped, unpaged, newest-first two-version history and proves its
   newest row is the exact current-version metadata;
6. reads the supported current-item bytes and historical-version bytes, then
   binds their identities, timestamps, content, order, and file identity
   through SHA-256 digests;
7. deletes the exact retained file, rereads and matches the exact folder
   identity with its current eTag, proves the folder empty, deletes that exact
   folder, removes the expiry contract, and proves both active paths absent.

Every mutation records intent before the call. A transport or bounded
server-side ambiguity triggers only an exact marker/path/content read. The
mutation is never replayed automatically. If an ambiguous delete remains
present, the route stops with `cleanup-incomplete`; it does not issue a second
delete. The changed-version write is conditional on the retained trusted-v1
eTag. The frozen expiry is checked again immediately before every producer
mutation; expiry never blocks cleanup.

## Response and evidence boundary

The response is the sanitized lifecycle result. It contains safe actor aliases,
the action window and expiry, digests of the marker and file identity, ordered
version sizes and digests, a categorical journal, and terminal cleanup state.
It never contains the marker, tenant, drive, folder, item, version, path, token,
or Graph payload identifiers.

A completed result proves only the producer-side platform operations, exact
trusted and changed bytes, ordered version history, marker-owned active
cleanup, and expiry closure. It does not prove an independent detector,
human visibility, interpretation, response, or restoration. SharePoint
recycle-bin and ordinary audit history remain service-managed platform history,
not active run artifacts.

The process-local reservation is sufficient only for the enforced
single-replica synchronous route. A protected canary journal remains outside
Git. This capability does not create a durable distributed lab runner.

## First canary result

The first marked canary reached cleanup but returned the categorical
`cleanup-incomplete` refusal. Exact reconciliation found the active file
absent and the retained run folder present and empty. The folder was then
deleted once with its freshly read eTag, and independent exact reads proved
both active paths absent. The defect was the runtime's use of the folder's
creation-time eTag after child mutations; the lifecycle now rereads and
matches the folder before deletion.

Because the refused response did not return a completed lifecycle result, this canary
does not establish the trusted-v1 bytes, changed-v2 bytes, or ordered-history
claim even though cleanup is terminal. It was not replayed. Recycle-bin and
audit records remain ordinary platform history, and detector, human-observation,
restoration, and lab claims remain unproven.
