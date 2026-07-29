# Operation telemetry receipt adapter

The local adapter connects the bounded safe operation events in
[operation telemetry](operation-telemetry.md) to candidate operation rows in a
[scenario evidence receipt](scenario-evidence-receipts.md). It is a pure
interpretation step. It does not call an API, run a scenario, persist data, or
complete a receipt.

The caller supplies:

- one already validated schema-v1 telemetry snapshot;
- one sanitized canonical scenario ID and exact role aliases; and
- a one-to-one mapping from each telemetry operation category to a manifest
  operation key, base phase, and observer role.

The mapping is a trusted repository contract. The adapter does not infer that
two differently named operations are equivalent. The receipt verifier remains
the authority for the final scenario, roles, operation keys, coverage, and
claim grounding.

## Evidence strength

A coherent start and terminal event can produce only one `operation` claim
candidate:

| Telemetry lifecycle | Candidate receipt state |
| --- | --- |
| succeeded | `proven` for that operation result only |
| definite upstream refusal | `refused` |
| local or pre-identity refusal | lifecycle `refused`; receipt row remains `uninspected` |
| ambiguous | `ambiguous` |
| reconciled recovery followed by success | `proven` for the recovered operation result only |
| unresolved recovery | `ambiguous` |
| missing or incoherent lifecycle | `uninspected` |

`proven` does not mean that an authentic platform artifact exists. The adapter
always reports artifact authenticity, independent detection, learner
visibility and interpretation, response, cleanup, retention, and terminal
proof as missing receipt coverage. In particular, telemetry that a cleanup
mutation returned success is not a terminal read and cannot prove absence.

The adapter normalizes the snapshot's declared order and requires one coherent
bounded lifecycle for each mapping. Capacity-bound snapshots, unmapped events,
mixed correlation groups, duplicates, impossible ordering, missing endpoints,
and conflicting recovery become an explicitly `incomplete` result. Missing
events never become `absent`. Because the collector does not expose a
truncation flag, response-size truncation is detectable only when it breaks a
mapped lifecycle; even a coherent result is not a claim that the snapshot is a
complete external history.

## Data boundary

Output is rebuilt from fixed categories. Marker hashes, request correlation,
duration, HTTP status, arbitrary errors, request or response content, and raw
identifiers are never copied. The existing collector validator rejects unknown
event fields and categories before lifecycle interpretation. Contract aliases
use the same sanitized identifier shape as receipts and reject role
conflation.

Callers must assemble all remaining sanitized claims and invoke
`verifyScenarioEvidenceReceipt` separately. There is intentionally no helper
that auto-fills or auto-completes a receipt.
