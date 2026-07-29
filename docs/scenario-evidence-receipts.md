# Post-run scenario evidence receipts

A scenario evidence receipt is a sanitized, post-run statement of what was
observed. It verifies that supplied claims are internally consistent with one
validated scenario manifest and that no claim is stronger than its categorical
observation.

The receipt does not perform tenant work, inspect protected evidence, or prove
that an external operation happened. The external observation remains the
proof; the receipt preserves its bounded meaning for product code and learners.

The optional pure local
[operation telemetry adapter](operation-telemetry-receipt-adapter.md) can
produce only candidate operation rows from bounded lifecycle events. It cannot
auto-complete a receipt or supply artifact, learner, cleanup, retention, or
terminal proof.

## Receipt shape

`verifyScenarioEvidenceReceipt` accepts only schema version 1. A receipt
contains:

- the exact canonical scenario ID and manifest schema version 2;
- sanitized actor aliases for evidence producer, workload actor, learner,
  optional independent detector, and optional responder, exactly matching the
  manifest roles; and
- a bounded list of categorical claim rows.

Every claim row has a sanitized claim ID, category, manifest-linked subject,
categorical assertion, terminal state, and—unless it is `uninspected`—one
categorical observation. Artifact rows also repeat the expected manifest
artifact kind and authenticity so an artifact ID cannot silently change
meaning.

The receipt has no free-form evidence field. It rejects unknown fields, UPNs,
GUIDs, paths, and any identifier that is not a short lowercase alias. It has no
place for tenant, subscription, object, message, credential, token,
certificate, session, or upstream response data.

## Terminal states

The six states are intentionally not ordered:

| State | Meaning |
| --- | --- |
| `proven` | The exact bounded assertion has a permitted terminal observation. |
| `absent` | A separate exact reconciliation observed absence. |
| `refused` | The provider definitively refused the attempted operation. |
| `ambiguous` | The bounded observation cannot decide the assertion. |
| `licensing-or-latency-blocked` | The supported observation did not converge or was unavailable at its licensed boundary. |
| `uninspected` | No terminal observation was supplied. |

The verifier never promotes one state to another. A non-`uninspected` claim
must name an observation source, outcome, observer actor alias, and manifest
operation. The observer must own that operation. Independent observations must
use the manifest detector; learner observations must use the learner.

An empty query can prove its own completed query operation or surface
reachability. It cannot prove producer attribution, artifact absence, or
learner visibility. A blocked query can represent only the blocked state.
A provider refusal cannot prove success.

## Required claim coverage

Each receipt has exactly one coverage row for every:

- manifest operation and terminal outcome;
- expected artifact and its authenticity category;
- learner evidence artifact and learner visibility;
- learner interpretation;
- response action;
- lifecycle cleanup operation; and
- artifact retention disposition.

It also has at least one terminal-proof row. An independent-detection manifest
requires a distinct-detector row.

Cleanup proof requires a separate exact read after the cleanup mutation.
Retention proof requires its own terminal read. Missing rows fail as cleanup
gaps; honest `uninspected` rows preserve a known gap without inventing proof.

## Claim grounding

Artifact proof must use the artifact's manifest observation and match its kind
and authenticity. Learner visibility requires a learner inspection and a
manifest artifact whose visibility was observed. Learner interpretation
requires manifest completion.

Producer attribution requires an independent detector record match for an
authentic artifact whose source operation belongs to the workload actor.
A human-assisted platform artifact may be authentic, but it cannot prove
unattended automation. Manifest semantic claims require their authentic
artifact; endpoint, topology, learner-session, call, voicemail, cleanup, and
spend claims remain separate.

## Canonical fixtures

The source fixtures in
`src/scenarios/scenario-evidence-receipt.fixtures.ts` are sanitized and contain
no protected run data:

| Fixture | Truth preserved |
| --- | --- |
| Help-desk email | The Outlook email is authentic and learner-visible. Teams call and voicemail semantics remain uninspected; retained-message cleanup remains uninspected. |
| Three-VM AVD | Infrastructure, Intune, Defender, terminal cleanup, the final-cleanup artifact's retention, and bounded spend are separate proven rows. The learner session and retention of earlier readiness artifacts remain uninspected. |
| Teams missed call | The platform-native missed-call artifact and call are proven through a human-operated path. Unattended automation, voicemail, and retained-history cleanup remain uninspected. |
| Application reconnaissance | Workload execution, distinct detector, exact producer attribution, and the authentic summary are separate proven rows. Learner interpretation and ephemeral retention cleanup remain uninspected. |
| Purview boundary | App-only surface reachability and detector separation are proven. Operation-level producer attribution remains `licensing-or-latency-blocked`; learner visibility and local-window cleanup remain uninspected. |

Each fixture has a paired negative form that attempts one forbidden promotion.
Tests also cover missing observation, raw identifiers, unsupported visibility,
empty-query absence, cleanup and retention gaps, arbitrary input fields, and
deterministic output.

## Offline CLI

Validate one explicit sanitized JSON receipt:

```text
npm run validate:scenario-receipt -- ./receipt.json
```

The command reads one regular file of at most 256 KiB, selects the built-in
canonical manifest by sanitized scenario ID, performs no network request, and
prints a deterministic tab-separated claim table. Failure output is only
`INVALID` plus a categorical code; it never echoes input data or file paths.
