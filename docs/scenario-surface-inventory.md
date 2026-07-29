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

## Current repository coverage

| Scenario | Manifest / plan / receipt | Adapter | Rehearsal | Authenticated plan API/client | Authenticated receipt API/client | Authenticated rehearsal verification API/client | Operator read / preview | Operator verify |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `avd-three-vm-substrate` | implemented | implemented | implemented | implemented | implemented | implemented | implemented | implemented |
| `help-desk-email-observation` | implemented | implemented | missing | implemented | implemented | missing | implemented | implemented |
| `oauth-application-reconnaissance` | implemented | not applicable | missing | implemented | implemented | missing | implemented | implemented |
| `private-document-evidence` | implemented | implemented | implemented | implemented | missing | missing | implemented | implemented |
| `teams-missed-call-observation` | implemented | not applicable | missing | implemented | implemented | missing | implemented | implemented |

The table describes source availability only. In particular, `implemented`
never means that a tenant operation, learner observation, cleanup, detection,
or other external result succeeded.

## Authority and failure boundary

The inventory consumes the validated canonical registry and the existing
cross-contract compatibility result. Optional surfaces publish small fixed
capability declarations beside the API, client, adapter, rehearsal, or
operator code that owns them. It does not discover support from filenames,
documentation prose, dynamic imports, or network responses.

The checker rejects duplicate or unknown scenario IDs, stale manifest
versions, unsafe identifiers, live-proof language, fabricated API or UI
claims, unsupported adapter mappings, and contradictory declarations. Output
never includes actor aliases, operation keys, markers, proof references,
paths, credentials, tokens, payloads, or arbitrary errors.
