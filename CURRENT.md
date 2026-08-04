# Current work

This is the current docket, not a history ledger. Completed evidence belongs in
`docs/proven-capabilities.md` or focused technical records.

## Current objective

Reset AP2's documentation and agent operating model around the project's actual
stage:

- broad capability exploration across Microsoft 365, Azure, endpoints, SaaS,
  applications, Kubernetes, attack paths, and related security systems;
- early technical scenario composition;
- no general learner-lab design unless Sean explicitly requests it;
- a three-tier agent workflow in which Sean's primary strategy conversation
  interprets direction, a local coordinator handles events, and durable peers
  own technical outcomes.

Product code and historical evidence are being preserved while mistaken global
guidance is simplified.

## Immediate decisions

- Keep the existing AP2 repository and history rather than starting over.
- Treat capability and scenario state as disposable, while preserving the AP2
  control plane across the Product and Student tenants. Preserve simulated-user
  identities, licensing, and authentication setup but not their staged workload
  state. Keep standing development permissions stable; clean up only explicitly
  temporary grants unless an architectural change requires otherwise.
- Prefer short capability experiments over generalized contracts and hardening.
- Treat Microsoft propagation and piece-by-piece cleanup as expected realities.
- Recreate the local coordinator and peer threads only after the revised
  operating documents are accepted and runtime mappings can be configured with
  their new exact thread IDs.

## Active agent work

- Documentation reset on branch `docs/exploration-reset`.
- No product implementation goal is active under this docket.
- Existing Captain and worker threads remain untouched during the reset.

## Future endpoint automation

Endpoints remain a large unexplored area. Future capability work may examine
Entra join, Intune enrollment and configuration, Defender onboarding and
evidence, device activity, application deployment, remote investigation, reset,
and how endpoints connect to broader incident scenarios.

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
distinct from the canonical private three-VM substrate, which did not include a learner session. See `docs/proven-capabilities.md` for the evidence and limits.

Other completed capability evidence should be read from
`docs/proven-capabilities.md`. It is not an implied backlog and should not be
reopened without a new question.
