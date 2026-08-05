# Current work

This is the current docket, not a history ledger. Completed evidence belongs in
`docs/proven-capabilities.md` or focused technical records.

## Current objective

Move the merged capability-exploration operating model into the live agent
runtime without starting a new AP2 product goal prematurely.

The intended three-tier workflow is:

- Sean and his primary strategy conversation shape goals, preserve intent, and
  interpret results;
- a local coordinator handles worker events and explicit dependencies without
  inventing product direction;
- durable configured peers own technical outcomes and may use their own child
  subagents.

AP2 remains in broad capability exploration and early technical scenario
composition. General learner-lab design is not current work unless Sean asks for
it explicitly.

## Current state

- The AP2 documentation reset is merged in `bac9104`.
- The first durable-peer agent-tools reset is merged in `f208c31`.
- The live Captain and five historical workers still use older AP2 checkouts and
  older operating instructions.
- The installed continuity timer still targets that historical six-thread team.
  It is deliberately held at the durable `external-input` wait and must not be
  resumed or given new detached assignments during migration.
- No AP2 product implementation goal is active.

## Live agent migration

Do not replace the historical thread mapping while reusing its durable state.
The old state contains historical assignments tied to old thread IDs.

The migration is complete only when all of these are true:

1. Install an agent-tools release that keeps durable assignment and report
   delivery available independently of proactive liveness.
2. Preserve the historical config, state, and journal as a named prior team
   epoch, then initialize clean durable state for the new team. Never silently
   reinterpret old assignments under new thread IDs.
3. Create a fresh local coordinator and fresh durable peer threads from current
   AP2 guidance.
4. Configure the exact coordinator and peer thread-ID mapping for the new epoch.
5. Keep proactive liveness disabled initially while assignment, report staging,
   and read-only status remain available.
6. Prove one harmless goal-card assignment, exact peer report, coordinator
   delivery, and read-only recovery round trip.
7. Enable proactive liveness later only when Sean deliberately wants the
   fallback continuity check.

Until that sequence is complete, use the historical team only for read-only
inspection. Do not assign it new AP2 goals.

## Standing product decisions

- Keep the existing AP2 repository and history rather than starting over.
- Treat capability and scenario state as disposable, while preserving the AP2
  control plane across the Product and Student tenants.
- Preserve simulated-user identities, licensing, and authentication setup, but
  not their experiment-created mail, calendars, files, Teams activity,
  temporary memberships, or other staged workload state.
- Keep standing development permissions stable. Clean up explicitly temporary
  grants; avoid permission churn unless a meaningful architecture change
  requires it.
- Prefer short capability experiments over generalized contracts and
  hardening.
- Treat Microsoft propagation and piece-by-piece cleanup as expected platform
  realities.

## Future endpoint automation

Endpoints remain a large unexplored area. Future capability work may examine
Entra join, Intune enrollment and configuration, Defender onboarding and
evidence, device activity, application deployment, remote investigation,
reset, and how endpoints connect to broader incident scenarios.

The AVD personal-host learner lane is live-proven and closed. It is distinct
from the canonical private three-VM substrate, which did not include a learner
session. That historical result does not mean endpoint exploration is complete.

## API durability decision

Shared durable operation state, multi-replica coordination, generalized
journals, and production backpressure are not current goals unless a concrete
capability or scenario cannot be explored without them.

The current API's single-replica and process-local limitations are known. Do not
resume the earlier durability architecture merely because its design documents
exist. Revisit it when a real experiment or product path creates the need.

## Known platform realities

- Microsoft 365 state may take time to appear or disappear.
- Cleanup is often workload-specific and confirmation can lag.
- Azure resource groups provide a cleaner reset boundary than Microsoft 365.
- Audit, retention, recycle-bin, deleted-object, and other historical residue
  may remain after the sandbox is ready for another run.
- Microsoft365DSC may later help restore selected baseline configuration, while
  content cleanup will still need workload-specific handling.

## Closed/do not reopen

The AVD personal-host learner lane is live-proven and closed. One fixed learner
completed Windows App feed and resource authentication and reached the assigned
Windows 11 desktop; AVD independently recorded the session and its terminal
disconnected state. Endpoint offboarding, resource deletion, Intune and Entra
cleanup, and revocation of temporary Graph roles were then proven. This is
distinct from the canonical private three-VM substrate, which did not include a learner session.
See `docs/proven-capabilities.md` for the evidence and limits.

Other completed capability evidence should be read from
`docs/proven-capabilities.md`. It is not an implied backlog and should not be
reopened without a new question.
