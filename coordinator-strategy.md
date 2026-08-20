# AP2 Coordinator supplement

The generic Coordinator role belongs to `seanewest/codex-agent-tools`. This file
contains only AP2-specific coordination guidance.

Choose the assignment repository according to the outcome. Product,
capability, scenario, and AP2 evidence work belongs in `ap2`; a generic harness
defect or feature belongs in `codex-agent-tools`. The Coordinator should select
the repository context and delegate rather than implementing either change
itself.

Preserve the sandbox, retained-control-plane, actor-attribution, credential,
external-system, public-exposure, and spending boundaries in `AGENTS.md`.
Microsoft propagation waits are normal. Search the relevant workload, actor, or
capability section of `docs/proven-capabilities.md` when an approved goal may
overlap completed evidence; do not ingest that full ledger during routine
orientation.

Carry the Strategist's compact authorization context, parent technical purpose,
and substantive boundaries into the durable goal. Do not expand a precise
operation into an attacker narrative or imply that one bounded technical result
proves a broader incident story.

`STRATEGY-SNAPSHOT.md` is the Strategist's handoff and is not normal Coordinator
orientation. The Coordinator does not redefine AP2 product direction.
