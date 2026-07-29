# Local scenario execution-plan compiler

The scenario planner turns one canonical runtime-validated scenario manifest
into a deterministic, sanitized readiness plan. It is a pure local compiler:
it does not execute setup, evidence, learner, response, cleanup, tenant, cloud,
mail, Teams, or deployment operations. A successful plan is not proof that any
external operation occurred.

The separate network-free
[scenario contract compatibility check](scenario-contract-compatibility.md)
compiles every canonical manifest and compares its sanitized output with the
receipt and applicable adapter contracts. It never executes the plan.

The compiler accepts only:

- one scenario ID from the canonical registry;
- opaque aliases for every assigned evidence-producer, workload-actor,
  learner, optional detector/responder, and cleanup-owner role;
- a fixed UTC current time and expiry;
- a USD budget ceiling; and
- an optional response-action ID already declared by the manifest.

Aliases are not identities. UPNs, GUIDs, tenant/subscription/object/message
identifiers, credentials, tokens, certificates, private paths, and session
data are rejected rather than normalized. Distinct manifest actors require
distinct aliases; roles assigned to the same actor require the same alias.

The ordered output covers:

1. actor, prerequisite, expiry, and budget preflight;
2. setup and evidence-producer operations;
3. authentic evidence expectations, including whether evidence is planned or
   pre-seeded;
4. learner interpretation and its human-only gate;
5. only the selected optional response;
6. expiry enforcement;
7. exact cleanup operations;
8. retained-artifact disposition; and
9. terminal reconciliation requirements.

Every step includes its owning role, sanitized alias when applicable,
manifest-defined operation category, human-only status, ambiguity behavior,
and recovery behavior. Mutations always stop for read-only reconciliation and
are never represented as automatically retryable. When canonical evidence is
already observed, its prior producer mutations are retained only as
`pre-seeded-reference` steps: they are not executable and do not create a new
human gate. When cleanup itself is already observed, its mutation steps are
also non-executable references. Cleanup-state observations are ordered after
every cleanup step. The SHA-256 plan digest is computed from canonical
sanitized output with stable key and step ordering.

The compiler fails with one categorical error for invalid actor binding, role
conflation, undeclared self-triggering, raw identifiers, invalid expiry,
insufficient budget, missing cleanup/evidence/interpretation/terminal proof,
unsupported response, contradictory retention, an invalid manifest, or an
unknown scenario.

## CLI

The CLI reads exactly one explicit sanitized JSON input file and writes either
the safe plan to standard output or one categorical refusal to standard error.
It has no network path and does not modify the input or any other file.

```json
{
  "scenarioId": "help-desk-email-observation",
  "actorAliases": {
    "evidenceProducer": "producer",
    "workloadActor": "sender",
    "learner": "learner",
    "cleanupOwner": "producer"
  },
  "now": "2026-07-29T06:00:00Z",
  "expiresAt": "2026-07-29T06:15:00Z",
  "maximumBudgetUsd": 0,
  "selectedResponseId": "report-help-desk-interpretation"
}
```

Run it locally:

```sh
npm run plan:scenario -- request.json
```

The canonical help-desk email, three-VM AVD, Teams missed-call, and application
reconnaissance manifests all pass through this same compiler. Tests also cover
unsafe alias binding, missing cleanup/evidence/interpretation, expired or
overlong windows, insufficient budget, unsupported responses, retention
contradictions, deterministic digests, and raw-identifier refusal.

## Authenticated API and typed client

An established AP2 operator can submit the same sanitized request to
`POST /api/scenario-plan`. The route uses the existing bearer-token verifier
and operator policy before reading the body. It accepts only
`application/json`, rejects unknown fields and raw identifiers, caps the
request at 8 KiB and the response at 64 KiB, and compiles synchronously in
memory. It has no scenario executor, transport, storage, queue, timer, retry,
or background-work path.

The typed `HttpAfterPartyApi.compileScenarioPlan` client sends the exact
planning request and validates the bounded response contract. It maps missing
authorization, forbidden callers, compiler refusal, oversize data, and other
isolated failures to fixed categories; arbitrary server text is never exposed
as a client error.

A returned plan is readiness guidance only. Authentication permits access to
the compiler, not to any operation described by the plan. The response does
not authorize, execute, schedule, persist, or prove setup, evidence creation,
learner activity, response, cleanup, or any other external operation.

## Authenticated operator preview

The signed-in operator shell exposes the same contract through a
`Scenario plan preview` form. Scenario and optional-response choices come
directly from the runtime-validated canonical registry. The form accepts only
short lowercase role aliases, a bounded USD ceiling, and a positive expiry
window no longer than the manifest's conservative duration. It derives the UTC
request timestamps locally and calls `HttpAfterPartyApi.compileScenarioPlan`
only after the operator selects `Preview plan`.

Every Scenario catalog card also offers `Use in plan preview`. That local-only
action resolves the exact canonical scenario and schema version, restores only
bounded registry-derived defaults, clears a stale result, and moves keyboard
focus to the preview selector. Repeating or changing this selection is
deterministic and makes no authentication or API call; the operator must still
select `Preview plan` explicitly.

The result presents ordered phases, role ownership, human-only gates, safe
evidence categories, learner interpretation, optional response, cleanup,
retention, terminal reconciliation counts, categorical limitations, and a
short stable digest. It does not render scenario, operation, step, artifact,
marker, or proof-reference identifiers. Selection or input changes clear the
previous result.

There is no automatic submit, retry, polling, persistence, scheduling, or
execution path. Authorization, compiler, size, and general failures use fixed
safe messages and never display request echoes or server error bodies. The
preview disclosure remains visible before and after every request: planning
does not authorize or perform work and is not proof of an external operation.
