# AP2 repository guidance

This file applies to work inside `ap2`. Generic Strategist, Coordinator, and
worker behavior belongs to `seanewest/agent-tools` and the runtime role
instructions in `$CODEX_HOME/AGENTS.md`.

## Current project stage

AP2 is exploring what can be created, changed, observed, detected, controlled,
and reset across Microsoft 365, Azure, endpoints, SaaS applications, and related
security systems. Current work is capability exploration and direct composition
of realistic incident-like scenarios. Lab design, teaching, learner flow, and
assessment are later work unless Sean explicitly requests them.

Use the capability/scenario/lab vocabulary in `docs/product-model.md`. Do not
create a generalized scenario engine, learner contract, manifest system, or
publishing architecture merely because a direct experiment could be abstracted.

The current SPA is Sean's internal capability notebook and operator console. It
is not the learner product or a prototype of the eventual learner interface.
Keep its language ordinary and avoid exposing obsolete internal terms such as
rehearsal, canary, manifest, or learner role when they do not describe the
visible action.

## AP2 operating boundaries

The Product and Student tenants, named simulated users, retained Windows
endpoints, AP2-owned SaaS instances, and synthetic experiment data are controlled
sandbox assets.

Preserve the retained control plane by default: tenant identity, application and
service-principal setup, standing development authority, simulated-user identity
and authentication setup, licensing, protected credentials, and selected
baseline infrastructure. Mail, files, meetings, Teams activity, temporary
memberships or grants, endpoint artifacts, marked Azure resources, and other
scenario state are disposable or resettable according to the experiment.

Protect the boundaries that materially matter:

- the exact tenant, subscription, account, user, device, and target environment;
- credentials, certificates, tokens, private keys, and administrative recovery;
- people and systems outside the AP2 sandbox;
- unintended public exposure, service abuse, and spending.

Broad authority in the owned sandbox does not permit secrets in the public SPA,
Git, logs, reports, or browser responses. Keep protected material in the backend
or the owner-only runtime documented in `docs/durable-runtime.md`.

Actor semantics matter when evidence must appear user-originated. Use the real
simulated user's Microsoft 365 or Windows context when attribution, browser
history, process ancestry, user registry state, or workload audit is part of the
claim. Use simpler control-plane automation when actor fidelity is not relevant.

Do not automatically repeat an ambiguous non-idempotent mutation. Reconcile its
result first. This is a narrow operational rule, not a reason to add ceremony to
every experiment.

## Work and evidence

Begin with one plain-language question and the observation that would answer it.
Run the cheapest read that could disprove readiness, then the smallest live proof
that answers the real question.

Microsoft propagation delays are normal. Record accepted state and the later
observation needed; do other useful work or stop the active turn instead of
building a general polling or orchestration system around one wait.

Consult `docs/proven-capabilities.md` before repeating work that may already be
proven. Search the relevant workload, actor, or capability section rather than
reading the entire evidence ledger as routine orientation. Preserve only the
smallest useful code, test, evidence entry, or focused technical document after
the result is known.

Code, tests, deployment, cleanup, documentation, review, and hardening are means,
not automatic phases. Stop when the question is answered well enough to support
the next product decision. Record unknowns honestly instead of manufacturing
more machinery to eliminate every uncertainty.

## Documentation authority

Use each canonical document for one job:

- `docs/product-direction.md` — current product direction and exploration stage;
- `docs/product-model.md` — capability, scenario, lab, and evidence vocabulary;
- `docs/development-workflow.md` — the AP2 exploration loop;
- `docs/proven-capabilities.md` — completed live evidence and limitations;
- `docs/durable-runtime.md` — current protected execution boundary;
- `chatgpt-strategy.md` — AP2 Strategist supplement;
- `coordinator-strategy.md` — AP2 Coordinator supplement;
- `STRATEGY-SNAPSHOT.md` — point-in-time Strategist handoff, never live workflow
  state or normal Coordinator orientation.

Feature documents preserve technical contracts that code and tests cannot carry.
They do not become current goals merely because they exist. When guidance
changes, revise the canonical source and remove obsolete duplicates rather than
stacking another qualification in this file.

## Repository changes

Follow the development commands in `README.md` and run the checks relevant to the
changed surface. Prefer direct, removable implementation over speculative
architecture. A local defect is normally something to fix and continue; a review
finding or edge case becomes additional work only when it threatens the result,
a real boundary, durable recoverability, or the next useful step.

AP2 uses the shared AgentTools workflow, but project direction and evidence stay
in this repository. Workers follow their runtime role instructions plus this
file. Harness defects and generic workflow features belong in
`agent-tools`, not in AP2 product direction.
