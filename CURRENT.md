# Current work

This is the current docket, not a history ledger or future backlog. Completed
capability evidence belongs in `docs/proven-capabilities.md`; durable product
rules belong in `AGENTS.md` and focused architecture documents.

## Current objective

Wait for Sean and his primary strategy conversation to shape the first useful
post-migration capability goal. The local coordinator must not choose that goal.

## Current state

- The capability-exploration documentation model is merged and active.
- The durable-peer agent tools are merged and installed locally.
- The historical Captain/team epoch is archived with its config, state, and
  journal; its unresolved historical entries were not converted into new work.
- A fresh local coordinator and five fresh durable peers are configured under a
  clean team epoch.
- Durable assignment, report delivery, and read-only recovery are enabled.
- Proactive liveness is disabled and remains optional.
- A harmless migration canary proved one exact goal-card assignment, peer final,
  automatic coordinator delivery, coordinator interpretation, and durable
  recovery while proactive liveness was off.
- No AP2 product implementation goal is active.

## Operating state

The coordinator is idle and should react only to explicit peer events or goals
that Sean and the primary strategy conversation have already shaped. It must not
turn unexplored areas, historical findings, or optional hardening into a docket.

The five peers are idle. Each peer should receive one durable goal with a clear
intent, reason, stop condition, and only the constraints that materially affect
that goal. A peer may use child subagents, but those children are not configured
peers.

## Next interpretation point

Sean and the primary strategy conversation decide what capability question, if
any, should become the first real peer goal. That decision should begin from the
current product direction and a concrete learning need, not from the historical
team's unfinished assignments or adjacent possibilities.
