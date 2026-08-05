# Current work

This is the current docket, not a history ledger or future backlog. Completed
capability evidence belongs in `docs/proven-capabilities.md`; durable product
rules belong in `AGENTS.md` and the focused architecture documents.

## Current objective

Move the merged capability-exploration operating model into the live agent
runtime without starting a new AP2 product goal.

The intended three-tier workflow is:

- Sean and his primary strategy conversation shape goals, preserve intent, and
  interpret results;
- a local coordinator handles peer events and explicit dependencies without
  inventing product direction;
- durable configured peers own technical outcomes and may use their own child
  subagents.

## Current state

- The AP2 documentation reset is merged in `bac9104`.
- The first durable-peer agent-tools reset is merged in `f208c31`.
- Follow-up migration fixes are under review in AP2 PR #170 and
  `codex-agent-tools` PR #13.
- The historical Captain and five workers still use older AP2 checkouts and
  older operating instructions.
- The installed continuity timer still targets that historical six-thread team.
  It is held at the durable `external-input` wait and must not be resumed or
  given new detached assignments during migration.
- No AP2 product implementation goal is active.

## Live agent migration

Do not replace the historical thread mapping while reusing its durable state.
The old state contains assignments tied to old thread IDs.

The core migration is complete when all of these are true:

1. Merge and install agent tools that keep durable assignment, actual report
   delivery, and read-only recovery available independently of proactive
   liveness.
2. Preserve the historical config, state, and journal as a named prior team
   epoch, then initialize clean durable state for the new team. Never reinterpret
   old assignments under new thread IDs.
3. Create a fresh local coordinator and fresh durable peer threads from current
   AP2 guidance.
4. Configure the exact coordinator and peer thread-ID mapping for the new epoch.
5. Keep proactive liveness disabled while durable dispatch and read-only status
   remain available.
6. Prove one harmless goal-card assignment, exact peer report, coordinator
   delivery, and read-only recovery round trip.

Proactive liveness is optional after migration. Enable it later only when Sean
deliberately wants the fallback continuity check; leaving it disabled does not
make the migration incomplete.

Until the sequence is complete, use the historical team only for read-only
inspection. Do not assign it new AP2 goals.

## Constraints on this migration

- Do not modify AP2 product behavior, tenant state, deployments, or permissions.
- Do not treat historical capabilities, unexplored areas, or adjacent ideas as
  migration work.
- Do not resume older hardening, shared-journal, lab-authoring, or cleanup work.
- Preserve the historical team state and journal as evidence; do not translate
  its unresolved entries into goals for the new team.

## Next interpretation point

After the harmless durable round trip, Sean and the primary strategy
conversation decide whether the migration is complete and what first capability
question—if any—should become a peer goal. The coordinator must not choose that
question itself.
