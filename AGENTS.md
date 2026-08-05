# AGENTS.md

## What AP2 is doing now

AP2 is an exploratory project for learning what can be created, changed,
observed, and reset across Microsoft 365, Azure, endpoints, SaaS integrations,
applications, and related security systems.

The eventual product may contain cybersecurity labs. That is not the current
work unless Sean explicitly asks for lab design, teaching content, learner
objectives, assessment, or pedagogy.

Use these terms consistently:

- A **capability** is one action or observation we can perform reliably, such as
  creating a calendar event, changing a SharePoint file, placing a Teams call,
  observing an audit record, or removing an artifact.
- A **scenario** combines capabilities to create incident-like state. It is a
  technical composition, not automatically a learning experience.
- A **lab** is a later educational product built around a scenario. It includes
  teaching, investigation, learner decisions, and completion criteria.

Current work is mainly capability exploration and early scenario composition.

## Preserve the original question

Every task should have a plain-language question or outcome and a clear stopping
point. Keep returning to that original intent while working.

Do not turn a useful experiment into a framework, production subsystem,
compliance exercise, documentation program, or generalized lab model unless the
current task actually requires it.

Code, tests, deployment, integration, documentation, cleanup, and hardening are
possible means. They are not automatic parts of every goal.

Stop when the stated question is answered well enough to support the next
product decision. Record unresolved facts honestly instead of creating more
machinery to eliminate every uncertainty.

## Work in a disposable sandbox

The AP2 tenant and explicitly selected subscriptions are dedicated sandboxes,
but the sandbox contains two different classes of state.

The AP2 control plane spans two tenants. The Product tenant owns the
multitenant After Party app registration and API resource. The Student tenant
contains its enterprise application plus the development automation identity,
the API and managed identity, standing roles and permissions, simulated-user
identities, licenses, authentication setup, and other selected baseline
configuration required to develop and run AP2. Preserve that control plane by
default. Deleting or casually resetting it would disable the current
architecture and is not ordinary scenario cleanup.

A simulated user's identity, license, and authentication setup are baseline
infrastructure. That user's mailbox, calendar, files, Teams activity,
scenario-specific memberships, temporary permissions, and other staged workload
state are disposable or resettable.

Avoid permission churn. Standing development authority that AP2 already uses is
part of the baseline and should not be repeatedly revoked, narrowed, and
regranted between experiments. Remove a grant during routine cleanup only when
it was explicitly introduced as temporary for that experiment. Change standing
authority when the current question requires different actor semantics or when
the permission choice changes the architecture in a meaningful way.

Broad authority inside the sandbox does not relax architectural boundaries.
Secrets, certificates, private keys, refresh tokens, and privileged credentials
must not be embedded in the public SPA or returned to the browser. Keep them in
the backend, external secret/configuration paths, or another appropriate
non-public boundary.

Capability and scenario runs create disposable experimental state around the
control plane. Messages, meetings, files, calls, temporary permissions, marked
Azure resources, security signals, and similar staged activity may be removed
or left as acceptable historical residue according to the current experiment.

Protect the boundaries that actually matter:

- the exact tenant, subscription, account, and target environment;
- credentials, certificates, tokens, and administrative recovery;
- people and systems outside the sandbox;
- unintended public exposure or service abuse;
- spending limits.

Inside that boundary, marked experimental state is disposable. Cleanup should
make later experiments practical when useful; it does not need to restore an
exact prior state or erase ordinary Microsoft history.

Do not automatically repeat an ambiguous non-idempotent mutation. Inspect its
result first. This is a narrow operational rule, not a reason to add ceremony to
every experiment.

## Prefer the shortest useful experiment

Start with the cheapest observation that could disprove the idea. Then run the
smallest live proof that answers the real question.

Microsoft 365 state often propagates slowly. Cleanup and confirmation may also
require delayed observations. Treat those waits as normal platform behavior:
record the state, do other useful work, and return later. Do not build a general
orchestration system merely because one experiment needs a wait.

Use the actor whose recorded behavior matters. A broad development identity is
fine for platform discovery when user attribution is not the question.

Add reusable product code only after an experiment reveals a repeated need or a
real product path. Remove temporary experiment code when its useful result has
been captured.

## Keep documentation small and factual

Documentation should help a person recover the current mental model. It should
not accumulate every caution, implementation detail, review observation, or
historical exception as a standing rule.

Use the canonical documents for their distinct jobs:

- `docs/product-direction.md` explains the project and current exploration stage.
- `docs/product-model.md` defines capability, scenario, and lab vocabulary.
- `docs/development-workflow.md` describes the short exploration loop.
- `captains-strategy.md` describes the local coordinator role.
- `CURRENT.md` contains only the current docket and immediate decisions.
- `docs/proven-capabilities.md` records evidence and limitations from completed
  work.

Feature documents may preserve technical facts that code and tests cannot carry.
They do not become new project goals merely because they exist.

When changing a rule, replace obsolete guidance rather than stacking another
qualification on top. Avoid duplicating the same rule across documents.

## Coordinator, peers, and subagents

Sean's primary strategy conversation defines product intent and interprets
whether the work is still useful. The local coordinator keeps approved work
moving; it does not redefine the product direction.

Configured peer workers are durable top-level threads with exact runtime thread
IDs. A child subagent is not a peer worker, even if someone gives it the same
friendly name. Only the configured mapping establishes peer identity.

The local coordinator should use the configured peer pool for project work and
should not create personal child agents as substitutes for peers. A peer worker
may create subagents for parts of its own goal. Those children remain owned by
that peer and must never be represented as independent peer workers.

A peer owns the original outcome, not a checklist derived from it. It may plan,
research, implement, test, and correct ordinary problems without reporting each
step. It should return when the outcome is answered, a real decision is needed,
the established boundary must change, or progress is genuinely blocked.

Worker reports must use the configured peer label and remain mechanically tied
to the durable goal:

```text
PEER: Copy the exact configured peer label.
QUESTION: Copy the goal card's INTENT exactly.
ANSWER: Give the plain-language result.
NEXT: Say Stop, the direct remaining dependency, or the one decision needed.
EVIDENCE: Name only the decisive reference or observation.
```

Do not paraphrase `INTENT` in `QUESTION`; exact copying lets the durable report
path detect accidental goal substitution.

## Simplicity

Prefer fewer concepts, fewer layers, fewer documents, and fewer moving parts.
Do not preserve complexity merely because previous agents created it.

A local defect is usually something to fix and continue. A speculative edge
case is usually something to record or ignore. Hardening belongs in the current
goal only when failure would invalidate the experiment, cross a real boundary,
or prevent the next useful step.
