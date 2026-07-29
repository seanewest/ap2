# Post-run scenario evidence receipts

A scenario evidence receipt is a sanitized, post-run statement of what was
observed. It verifies that supplied claims are internally consistent with one
validated scenario manifest and that no claim is stronger than its categorical
observation.

The receipt does not perform tenant work, inspect protected evidence, or prove
that an external operation happened. The external observation remains the
proof; the receipt preserves its bounded meaning for product code and learners.

The bounded [learner evidence briefing](learner-evidence-briefing.md) projects
one accepted help-desk plan and verified receipt into a control-free learner
view. It does not create evidence or expose producer operations.

The optional pure local
[operation telemetry adapter](operation-telemetry-receipt-adapter.md) can
produce only candidate operation rows from bounded lifecycle events. It cannot
auto-complete a receipt or supply artifact, learner, cleanup, retention, or
terminal proof.

The pure local
[private-document lifecycle adapter](private-document-evidence.md#scenario-receipt-adapter)
maps only its exact categorical one-shot journal and terminal absence summary.
It can complete the canonical private-document receipt because that lifecycle
contains artifact, learner-read, ordered cleanup, and fresh-session terminal
evidence. It still cannot infer learner interpretation, response, audit, or
detection.

The pure local
[help-desk email adapter](help-desk-email-receipt-adapter.md) maps one reduced
accepted-operation journal and only separately supplied learner/cleanup
observations. Send acceptance alone leaves artifact, visibility,
interpretation, response, cleanup, retention, Teams, and voicemail truth
`uninspected`.

The pure local
[Teams missed-call adapter](teams-missed-call-receipt-adapter.md) keeps the
licensed-user staging result separate from Cory-side native history/Activity,
the learner's bounded report, and terminal cleanup. Neither stage completion
nor the blocked bot path can prove target-side evidence.

The network-free
[scenario contract compatibility check](scenario-contract-compatibility.md)
uses all-`uninspected` probes and canonical fixtures to detect manifest/receipt
vocabulary or coverage drift without upgrading any claim.

The
[private-document contract rehearsal](private-document-rehearsal.md) exercises
that adapter and this verifier with a deterministic injected fake. Its
candidate acceptance is not external proof: the emitted rehearsal summary
keeps staging, visibility, interpretation, audit/detection, response, cleanup,
and retention `uninspected`.

The
[help-desk email contract rehearsal](help-desk-email-rehearsal.md) composes the
canonical plan, a one-shot operation fake, the help-desk adapter, this
verifier, and the shared rehearsal envelope. Its send, learner-visible,
retained, and cleaned synthetic branches keep email, Inbox visibility,
interpretation, response, cleanup, retention, audit/detection, Teams, and
voicemail external truth `uninspected`.
The separate
[offline help-desk rehearsal output verifier](help-desk-email-rehearsal-output-verifier.md)
checks a saved envelope without invoking the fake or pipeline and returns only
a fixed safe contract-consistency summary.

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
use a manifest detector distinct from both workload actor and learner; learner
observations must use the learner. Display labels never establish identity
separation.

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

Artifact proof must match the manifest kind and authenticity. Observed
artifacts use their manifest observation. The canonical `private-document`
platform-accepted artifact can use only exact local reconciliation of its
source operation while every folder, file, and permission staging operation is
separately proven; this does not promote learner visibility. Learner visibility
requires a learner inspection through a learner-owned exact evidence read.
Learner interpretation still requires manifest completion.

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
| Purview boundary | App-only surface reachability and detector separation are proven. Both retained searches succeeded, and their bounded pages contained the same exact producer-attributed operation records after supported record-type casing normalization. Learner visibility and local-window cleanup remain uninspected. |
| Private document | Exact producer-side folder, file, and direct-permission reconciliation proves platform-accepted staging. Ordered cleanup plus three fresh-session terminal rounds prove active-state absence. Learner visibility remains uninspected unless the exact learner-owned evidence read records learner inspection. Interpretation, response, audit, and detection remain unclaimed. |

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

## Authenticated API and typed client

An established AP2 operator can submit the same sanitized receipt to
`POST /api/scenario-evidence-verification`. The route applies the existing
bearer-token verifier and operator policy before reading the body. It accepts
only `application/json`, caps request and response bodies at 128 KiB, rejects
unknown fields and raw identifiers, and verifies synchronously in memory.

Successful output contains only the normalized deterministic claim rows and a
`missingCoverage` list of claim IDs whose supplied state is `uninspected`.
Other honest terminal states remain visible in their claim rows and are not
silently promoted. Invalid receipts return one fixed categorical verifier
code. The typed client validates the bounded request shape and deterministic
claim IDs before sending, streams the response with the same hard cap, and
accepts only an exactly matching normalized role/claim result. Manifest and
evidence-strength verification remain server-side.

This endpoint verifies the internal consistency and permitted strength of
receipt data supplied by an operator. It does not collect telemetry, obtain or
inspect evidence, authorize or execute a scenario, persist a receipt, schedule
work, or prove that any external operation occurred.

## Primary SPA boundary

The primary signed-in SPA does not expose a receipt-verification panel or
accept pasted JSON. The authoritative verifier, typed client, API route, CLI,
fixtures, and automated tests remain available for technical workflows. This
removes an implementation contract from the human experience without changing
receipt validation or evidence-strength semantics.
