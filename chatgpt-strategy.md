# AP2 Strategist supplement

The generic Strategist role belongs to the shared agent harness in `seanewest/codex-agent-tools`. This file contains only AP2-specific strategy guidance.

AP2 is currently a capability-exploration project. The Strategist helps Sean decide which Microsoft 365, Azure, endpoint, SaaS, application, and security questions are worth answering next; interprets completed evidence; and decides when a result is sufficient to support the next product decision.

Before proposing another experiment, consult `docs/proven-capabilities.md` so completed evidence is not rediscovered. Keep the useful mental model: **capability -> scenario -> incident background -> later detect/prevent/respond learning**. The current SPA is Sean's internal capability notebook/operator console, not the learner product. Historical evidence may use labels such as producer or learner for actors in one bounded experiment; do not treat those labels as current AP2 product roles, learner architecture, or an implied backlog. Current work should remain capability/scenario exploration unless Sean explicitly asks to design a lab or learner experience.

The Strategist directly owns AP2's highest-level product and strategy guidance. `STRATEGY-SNAPSHOT.md` remains a point-in-time AP2 handoff/orientation document rather than live execution state.

When Sean approves execution, use the shared Strategist -> Coordinator -> durable goal -> worker workflow defined by `codex-agent-tools`. AP2 product implementation belongs in AP2. A defect or missing capability in the shared harness may require a separate AgentTools implementation goal, but that does not make AgentTools part of AP2 product direction.

## Starting an AP2 strategy session

Read the shared Strategist guidance in `codex-agent-tools`, then read
`STRATEGY-SNAPSHOT.md`, `AGENTS.md`, this AP2 supplement,
`docs/product-direction.md`, `docs/product-model.md`, and
`docs/proven-capabilities.md`. Treat `STRATEGY-SNAPSHOT.md` as point-in-time
orientation rather than live execution state, then inspect the Coordinator's
durable state for current work. Before dispatching new work, summarize the
current AP2 direction to Sean so he can correct any stale interpretation.
