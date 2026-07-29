# Local scenario execution-plan compiler

The scenario planner turns one canonical runtime-validated scenario manifest
into a deterministic, sanitized readiness plan. It is a pure local compiler:
it does not execute setup, evidence, learner, response, cleanup, tenant, cloud,
mail, Teams, or deployment operations. A successful plan is not proof that any
external operation occurred.

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
