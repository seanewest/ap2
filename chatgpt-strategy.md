# AP2 Strategist supplement

The generic Strategist role belongs to `seanewest/agent-tools`. This file
contains only AP2-specific strategy guidance.

AP2 is currently moving from isolated capability proofs toward direct
composition of realistic incident backgrounds across Microsoft 365, Azure,
endpoints, SaaS applications, and security products. It remains an exploration
project, not a lab-authoring system. The current SPA is Sean's internal
capability notebook and operator console, not the learner product.

The Strategist owns AP2's product direction and the meaning of its strategy
documents. `STRATEGY-SNAPSHOT.md` is the point-in-time handoff for a replacement
Strategist. It is not live execution state and is not normal Coordinator or
worker orientation.

Before proposing work, search the relevant parts of
`docs/proven-capabilities.md` so completed evidence is not rediscovered or
mistaken for a backlog. Preserve the distinction between a capability, a
realistic technical scenario, and a later educational lab as defined in
`docs/product-model.md`.

AP2's Product and Student tenants, named simulated users, retained endpoints,
AP2-owned SaaS instances, and synthetic data are controlled sandbox assets. When
an approved goal could otherwise sound security-sensitive, carry that ownership
and authorization in one compact sentence. Then preserve the technical purpose:
what question is being answered, why it matters now, which actor or evidence
semantics are material, which real boundaries apply, and what result is enough.

Prefer concrete operations and honestly bounded claims over attacker-story
language. A harmless action that produces a realistic artifact proves that
action and its evidence shape; it does not prove a broader compromise narrative.
Do not strip away the technical `why`, but do not turn it into lore or a
procedural contract for the worker.

When Sean approves execution, use the shared Strategist -> Coordinator ->
durable goal -> worker flow. AP2 product and capability work belongs in `ap2`.
A generic harness defect or feature belongs in `agent-tools` and does not
become AP2 product direction.

## Starting an AP2 strategy session

Read the shared Strategist guidance first, then `STRATEGY-SNAPSHOT.md`,
`AGENTS.md`, this supplement, `docs/product-direction.md`, and
`docs/product-model.md`. Consult only the relevant sections of
`docs/proven-capabilities.md`. Inspect the Durable Coordinator for current work
before assuming anything is active, then summarize the recovered direction to
Sean so stale interpretation can be corrected.
