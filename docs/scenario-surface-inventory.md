# Canonical scenario surface inventory

The network-free scenario surface inventory reports repository support for
every canonical runtime scenario. It does not call an API, execute a plan or
rehearsal, inspect a tenant, or prove platform behavior.

Run:

```text
npm run check:scenario-surfaces
```

The command accepts no arguments. It prints deterministic JSON containing only
public canonical scenario IDs and fixed categorical cells. Each cell is one
of:

- `implemented` — the owning repository contract is exported and its pure
  validator or compatibility check passes;
- `not-applicable` — no real adapter is declared for that scenario; or
- `missing` — the repository does not export the complete surface.

Missing cells are useful inventory, not validation failures. The inventory
becomes invalid only when authoritative declarations contradict one another or
contain unsafe, stale, duplicate, unknown, or unsupported claims.

## Current rehearsal-family coverage

| Scenario | Manifest / plan / receipt | Adapter | `REHEARSAL_ONLY` pipeline | Offline verifier | Authenticated rehearsal verification API/client | Manual-only rehearsal panel | Learner briefing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `avd-three-vm-substrate` | implemented | implemented | implemented | implemented | implemented | implemented | missing |
| `help-desk-email-observation` | implemented | implemented | implemented | implemented | implemented | implemented | implemented |
| `oauth-application-reconnaissance` | implemented | implemented | implemented | implemented | implemented | implemented | missing |
| `private-document-evidence` | implemented | implemented | implemented | implemented | implemented | implemented | missing |
| `teams-missed-call-observation` | implemented | implemented | implemented | implemented | implemented | missing | missing |

The table describes source availability only. In particular, `implemented`
never means that a tenant operation, learner observation, cleanup, detection,
or other external result succeeded. `missing` means no source-owned capability
is exported; it is not a validation failure and does not invent whether the
surface is deliberately absent or future work. No pending capability
declarations currently exist.

## Authenticated operator matrix

The authenticated SPA renders a compact read-only capability-surface matrix by
calling the same `inventoryCanonicalScenarioSurfaces()` function in process. It does not copy
the inventory declarations, fetch an API, or infer tenant, cloud, workload, or
external readiness. The matrix shows the exact manifest/plan, adapter,
rehearsal, offline-verifier, authenticated rehearsal-verification API/client,
manual-panel and learner-briefing cells for all five canonical building-block
families. The same inventory verifies the capability-catalog declaration.

The UI labels `missing` as “Missing — not a failure” and `not-applicable` as
“Deliberately absent.” Pending remains a separate concept, but the
authoritative inventory currently declares no pending state. The semantic
table is horizontally scrollable at narrow widths and contains no action,
execution navigation, persistence, polling, or retry control.

## Authority and failure boundary

The inventory consumes the validated canonical registry and the existing
cross-contract compatibility result. Optional surfaces publish small fixed
capability declarations beside the API, client, adapter, rehearsal, offline
verifier, manual panel, or operator code that owns them. Paired authenticated
verification API/client declarations must bind the same owner in the
authoritative API route contract registry. A manual panel must bind that same
owner. Route paths remain defined only by the route registry. The inventory
does not discover support from filenames, documentation prose, dynamic
imports, or network responses.

The checker rejects duplicate or unknown scenario IDs, stale manifest
versions, unsafe identifiers, live-proof language, fabricated API or UI
claims, unsupported adapter mappings, mismatched family ownership, route
binding drift, and contradictory declarations. Output never includes actor
aliases, operation keys, markers, proof references, paths, credentials,
tokens, payloads, or arbitrary errors.
