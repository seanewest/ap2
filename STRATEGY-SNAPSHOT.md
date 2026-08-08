# Strategy snapshot — 2026-08-08

This is a point-in-time orientation artifact for a replacement strategy session
or read-only observer. It is **not** live execution state. For worker status use
`coordinator-dispatcher peer-status`; durable coordinator state wins for current
execution status. Canonical project documents remain authoritative for durable
product and workflow rules.

Completed capability evidence belongs in `docs/proven-capabilities.md`; durable
product and agent-workflow rules belong in `AGENTS.md` and the focused strategy
and architecture documents.

## Strategic frontier

The next likely exploration is third-party SaaS identity/security integration,
not further endpoint timing optimization. The genuine Windows/AVD endpoint path
works well enough for current purposes, and Sean does not want the next goals to
turn into another latency-optimization project unless a later product need makes
that useful.

The SPA remains Sean's internal capability notebook/operator console, not the
learner product or a generalized lab framework. AP2 should continue favoring
small, decisive capability experiments over infrastructure or ceremony that is
not needed to answer the current question.

## Endpoint / AVD state

Recent timing work established a useful learner-side calibration for a genuinely
fresh generalized-image Marge endpoint:

- fresh deployment -> learner connection accepted: about **9m00s**;
- fresh deployment -> genuinely usable desktop: about **11m13s**;
- the final Windows `Welcome` / first-profile phase was about **2m13s**.

Earlier clean raw-marketplace runs were roughly **14-15 minutes** to visible
usable desktop, but those were measured with more backend polling and unattended
login automation. Several cloud/backend timestamps proved to be observation
points rather than exact transition times, so do not over-interpret small timing
differences without a learner-side apples-to-apples test.

A newer/faster CPU also showed a promising pre-login AVD improvement, but the
full desktop comparison was contaminated by a simulated-user CBA readiness
mistake. First-login forensics separately indicated that genuine fresh-profile
initialization is usually around two minutes and is a meaningful component of
learner-visible latency.

For now, treat all of this as useful evidence rather than the active frontier.
As of this snapshot, all retained AP2 test VMs are **deallocated**. The older
Marge duplicate VM/NIC/disk was removed; only the newer `ap2margefresh-vm`
remains in the Marge environment. Retained endpoint state can be cleaned up later
when it no longer has learning value.

## Coordinator / peer cutover just completed

The Codex team was freshly cut over on 2026-08-08:

- `AP2 Coordinator`: fresh thread, GPT-5.6 Sol, **High** reasoning;
- `AP2 Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`: fresh threads, GPT-5.6 Sol,
  **Medium** reasoning;
- approvals are `never`, with the existing hardened app-server execution
  boundary;
- old threads were renamed `old AP2 ... 8-8 3am`;
- the dispatcher was atomically rotated to the fresh thread IDs and a new team
  epoch;
- the reusable coordinator/peer worktrees were clean and advanced to current
  AP2 `main` before orientation.

The fresh coordinator and peers read their role/project guidance and are idle.
`coordinator-dispatcher peer-status` remains the intended human-readable watch
interface.

Two `codex-agent-tools` reliability changes were also merged during cutover.
Automatic peer-report capture was added, and then a live canary exposed that
Codex app-server `turn/completed` notifications are connection-local rather than
broadcast across independent clients. The dispatcher was corrected to perform a
lightweight bounded durable-state reconciliation sweep, so it can discover a
peer completion even when another app-server connection created the assignment.
A live post-fix canary proved: fresh coordinator assignment -> peer completion ->
automatic durable capture -> coordinator acknowledgment -> peer AVAILABLE,
without restarting the dispatcher. Keep an eye on this new path during ordinary
work rather than assuming it is flawless merely because the canary passed.

The source/install used for this workflow is the separate
`/home/west/codex-agent-tools-source` repository. A replacement strategist should
read it as well as the AP2 docs before changing coordinator/dispatcher behavior.

## Judgment and coordination

A recent priority is preserving **bottom-up judgment**. The coordinator should
translate strategist/user intent into a bounded durable goal, preserve the real
purpose and invariants, and then leave ordinary implementation judgment to the
peer worker. Do not compensate for one peer mistake by making every later goal
increasingly prescriptive.

Likewise, avoid cycles of procedural ceremony. Goal cards, reports, independent
review, or another peer are useful when they reduce a real risk or answer an
independent question; they should not become mandatory layers that crowd out the
technical work. The recent coordinator guidance was adjusted in this direction,
but continue watching for drift back toward overspecific delegation or ritual.

## SaaS exploration

**YouTrack Cloud** has now successfully connected to Entra for SSO, including a
successful test login. That proves the basic Entra enterprise-application / SSO
relationship, but the interesting lifecycle/security work has **not** yet been
proven:

- SCIM provisioning/deprovisioning has not been tested end-to-end;
- the intended group/assignment -> create users -> SSO -> remove user -> observe
  deactivation flow remains to be proven;
- Defender for Cloud Apps Conditional Access App Control/session-control behavior
  has not been tested with YouTrack.

Those are likely near-term experiments. Keep native Defender API App Connectors
separate conceptually from Conditional Access App Control: YouTrack is useful
precisely as a SaaS product without the native API connector if the session proxy
path works.

Other third-party SaaS candidates worth experimenting with next include
**GitHub Enterprise, Snowflake, Tableau, and Webex**. The point is not to collect
vendors for its own sake; use them when they let AP2 prove a distinct realistic
SSO, SCIM, SaaS governance, Defender connector, or session-control capability.
Prefer options that work with the disposable `onmicrosoft.com` tenant and do not
create avoidable learner billing/trial friction.

## Strategy reminders

- Before acting on worker status, inspect durable coordinator state rather than
  treating this snapshot as a live docket.
- Strategist co-creates goals with Sean; the coordinator executes approved work
  through peers.
- Preserve original purpose through delegation and let peers exercise technical
  judgment inside the real boundaries.
- Prefer fast empirical experiments over speculative architecture.
- Do not turn the current pause in endpoint optimization into a permanent
  architecture decision; simply do not prioritize it now.
- The Student tenant and endpoint infrastructure should remain disposable and
  reproducible; nothing important should depend on preserving one specific
  tenant or VM forever.
