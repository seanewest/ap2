# Scenario manifest contract

The scenario manifest is the runtime-validated boundary between a scenario
author and the AP2 orchestrator/learner UI. It is a plan and evidence contract,
not proof that setup ran. Microsoft API acceptance, resource readiness, and a
planned learner task cannot be presented as learner evidence.

`parseScenarioManifest` accepts only schema version 2 and validates these
bounded sections:

- actors plus distinct evidence-producer, workload-actor, learner, and optional
  responder roles;
- authentication transports and explicit prerequisites;
- setup, evidence, response, and cleanup operations with a stable operation
  key, owner, supported capability, and read/mutation effect;
- setup resources, including expiry and cleanup for every billable resource;
- retained and temporary permissions, with exact grant/revocation operations
  and revocation ownership for temporary access;
- authentic evidence artifacts, their observation state, learner visibility,
  semantic claims, retention, exact read operation, and sanitized canonical
  proof reference;
- the learner task, expected interpretation, completion state, and exact
  evidence dependencies;
- allowed response actions;
- scenario expiry, cleanup owner and operations, and retained-artifact
  custodian/disposition; and
- USD lane maximum plus a conservative duration assumption.

All arrays are bounded and identifiers are stable lowercase values. Mutations
require markers. References must resolve to declared actors, operations,
resources, or artifacts. Every cleanup operation is declared by lifecycle and
owned by the lifecycle cleanup actor. Every retained evidence artifact has one
inventory entry; `cleanup-later` also names its exact cleanup operation.

The validator rejects:

- producer/learner conflation without an explained `self-triggered` model;
- semantic claims unsupported by the artifact kind, including Teams
  missed-call or voicemail claims on Outlook email;
- planned or merely platform-accepted evidence presented as learner-visible,
  or observed evidence without an exact read and proof reference;
- learner completion without learner-completed visible evidence;
- missing expiry, cleanup, cost, owners, markers, permission revocation, or
  retained-artifact disposition; and
- mismatched creation/cleanup markers or non-canonical proof references; and
- billable resources outside the declared lifecycle or in a zero-cost lane.

## Representative fixtures

`help-desk-email.ts` describes the proven fixed Kobe-to-Cory Outlook artifact.
Kobe is the workload actor, Cory is the learner, and the AP2 orchestrator owns
the one-shot route and later exact cleanup. The sole semantic claim is Outlook
email. The privately inventoried message remains for the separately authorized
cleanup lane.

`avd-three-vm.ts` describes Durant's proven private substrate: one personal
Windows 11 AVD host, two private Ubuntu auxiliary nodes, shared NAT egress, and
the Entra/Intune/Defender lifecycle. It also inventories the expiry schedule
and ephemeral sensitive run material under exact cleanup ownership. The frozen
run used a USD 10 ceiling and a five-hour conservative assumption. Final
protected reconciliation proved the
resource group, marker policies/groups, Intune and Entra device records,
temporary roles, expiry job, and sensitive run artifacts absent. No learner
session occurred, so its learner completion is `not-run` and learner visibility
is `not-proven`. Reduced evidence remains with the AP2 orchestrator.

The controlled Teams missed-call fixture is also migrated to schema version 2.
Its native Teams semantic claim remains distinct from the Outlook fixture.

The [local scenario planner](scenario-planner.md) consumes this validated
contract to produce a deterministic sanitized readiness plan. The planner is
not an executor and its output is not evidence that any external operation
occurred.

## Authenticated read-only catalog

The signed-in operator shell renders `SCENARIO_MANIFESTS` through a compact
Scenario catalog. Each entry is revalidated with `parseScenarioManifest` at
render time; validation failure produces one fixed safe error and no scenario
details. The catalog has no network fetch, loading loop, persistence, polling,
or execution control.

Cards use only validated labels and summaries for purpose, actor-role
separation, producer operation, artifact authenticity and visibility, learner
task and interpretation, optional response, prerequisites and human
gates, setup/cleanup/retention, expiry, cost ceiling, and current
limitations. Canonical IDs, operation keys, markers, proof references, and raw
payloads are not rendered.

Each card can populate the existing plan-preview form with that exact
in-memory canonical scenario and schema version. This is a local navigation
action only: it resets the form to registry-derived aliases, budget, expiry,
and response choices, clears any stale result, and moves focus to the scenario
selector. It does not authenticate, call the planning API, or perform work.
Only the separate `Preview plan` action may make one planning request.

The separate Purview audit capability is labeled as a read-only boundary, not
invented as a fifth registry scenario or treated as an execution receipt.
Application reconnaissance retains its narrower registry claim: the workload
and observer are distinct, while one sign-in or audit record does not prove
every workload read.

`purview-audit-boundary.ts` is a receipt-facing canonical manifest for the
already-completed PR #73 audit boundary. It is not registered as a runnable UI
scenario: the surface and distinct detector are proven, while operation
attribution remains licensing or latency blocked.

The manifest remains a pre-run plan, not post-run proof. Post-run truth belongs
in a separate
[scenario evidence receipt](scenario-evidence-receipts.md). The receipt binds
back to the exact manifest roles, operations, artifacts, learner contract,
response, cleanup, and retention without changing the plan or embedding raw
evidence.

`private-document-evidence.ts` describes the cleanup-first delegated document
contract. A distinct producer stages one private harmless text artifact and
one direct learner-only read grant, then removes the permission, file, and
empty run folder. The canary reached producer-side platform acceptance but did
not prove learner visibility, so the fixture remains `platform-accepted`,
`not-proven`, and `not-run`, with no audit or detection claim. Separate
producer and learner terminal-read operations let post-run receipts ground
cleanup and learner-access absence without treating a deletion response as
absence proof.
