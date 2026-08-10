# Strategy snapshot — 2026-08-10

This is a point-in-time orientation artifact for a replacement strategy session
or read-only observer. It is **not** live execution state. Use the Durable
Coordinator MCP bridge for current peer/goal/report status. Canonical project
documents remain authoritative for durable product and workflow rules.

Completed capability evidence belongs in `docs/proven-capabilities.md`; durable
product and workflow rules belong in `AGENTS.md` and the focused strategy docs.

## Strategic frontier

AP2 is still in capability exploration. The current work is increasingly about
how identity, endpoint, SaaS, Defender, and network controls can each contribute
small deterministic facts that can later compose into realistic incident
backgrounds and learning environments.

The useful mental model remains:

**capability -> scenario -> incident background -> future detect/prevent/respond learning**

Do not jump ahead into generalized lab design. Continue proving small technical
primitives that could later create or expose authentic incident state.

The strongest current threads are:

- **YouTrack / Defender Conditional Access App Control:** authenticated SaaS
  session controls, now beyond clipboard blocking toward differentiated download
  behavior and protected downloads.
- **GitHub Enterprise Cloud / Defender API App Connector:** native SaaS telemetry
  is now proven in Defender `CloudAppEvents`.
- **Global Secure Access / Entra Internet Access:** network-layer controls that do
  not depend on the destination SaaS integrating with Microsoft are now proving
  useful.
- **Endpoint / Shadow IT:** MDE -> Defender for Cloud Apps discovery is being
  enabled/proven as a separate endpoint telemetry path.
- **Agent infrastructure:** after a serious host-memory crash, Sean is strongly
  considering moving the long-lived coordinator/agent environment from WSL to
  a Proxmox CT so the laptop can sleep without disrupting work.

The SPA remains Sean's internal capability notebook/operator console, not the
learner product or a generalized lab framework.

## Current capability evidence and open edges

### GitHub Enterprise / Defender connector

The `ap2-v2` GitHub Enterprise Cloud EMU environment is real and usable:

- Entra OIDC SSO and SCIM lifecycle work;
- managed account `admin_ap2` is Enterprise Owner;
- organization `ap2-v2-lab` exists with attributable lab activity;
- Sean manually completed the Microsoft Defender for Cloud Apps GitHub API App
  Connector after agent-controlled browser attempts incorrectly appeared blocked
  by a disabled OAuth-consent control.

The connector is now **telemetry-proven**, not merely connected. Defender
`CloudAppEvents` contains a GitHub `repo.create` for
`ap2-v2-lab/defender-connector-proof` attributable to `admin_ap2`; GitHub's
organization audit log independently records the same action/repository and
millisecond timestamp.

This establishes a useful distinction from a SaaS app with only SSO/SCIM or
browser proxying: GitHub can contribute SaaS-native audit/activity evidence to
Defender regardless of whether the action came through the Defender session
proxy.

The earlier disabled-consent observation must not be treated as an EMU/platform
blocker. It is a reminder that supported browser automation can still hit odd
interactive edges; API/CLI remains preferable, and a bounded human browser step
is better than redesigning identity or architecture around an automation failure.

### YouTrack / Conditional Access App Control

The core YouTrack path remains proven:

- non-gallery Entra SAML + SCIM lifecycle works;
- the staged SAML provider is YouTrack's default authentication provider;
- My Apps can launch directly into the authenticated YouTrack path without the
  former red-provider chooser clicks;
- Defender Conditional Access App Control has produced a genuine controlled
  session and explicitly blocked ordinary Cut/Copy.

A new, more realistic session-control experiment is in progress: **Cory as a
normal internal user should be able to download a harmless attachment while
Marge as a restricted support/vendor-style user is blocked from downloading the
same attachment**, with no managed/unmanaged-device premise.

Beta had staged Cory as monitor-only and Marge as FileDownload-block, but Sean's
first live retest exposed a regression: both Cory and Marge reached YouTrack but
could not access Issues, and Edge prompted for Entra authentication more than
expected. Beta currently owns repair/reconciliation of that learner access/session
path. Do not keep manually retrying until Beta reports a clean retest path.

Sean normally uses separate managed Edge work profiles for Cory, Kobe, Marge,
and admin on his personal Windows machine. InPrivate is not inherently required
for CA App Control tests; separate browser profiles provide clean identity/session
separation. Managed Edge may use Defender in-browser protection rather than a
visible `.mcas.ms` origin, so the enforcement outcome matters more than the URL
shape for those tests.

Two existing encrypted Purview sensitivity labels are already published,
synchronized, and visible in Defender's Protect-download selector:

- `Confidential-All Employees`
- `Highly Confidential-All Employees`

No new label publication/propagation is needed. Epsilon currently owns a proof
that Defender can allow a supported YouTrack Office/PDF download while applying
one of those existing encrypted labels to the downloaded copy without changing
the SaaS original.

### Global Secure Access / Entra Internet Access

A meaningful network-layer exfiltration-prevention capability is now **proven**.
On Kobe's managed endpoint, ordinary HTTPS access to the benign external test
destination remained allowed (`GET 200`) while GSA blocked the same harmless PDF
upload (`POST 403`). GSA transaction evidence attributed the block to Kobe, the
managed device, the intended security profile/content rule, and TLS inspection.
The temporary proof configuration and endpoint artifacts were then removed and
the VM deallocated.

This is a useful GSA primitive because the destination does not need Entra SSO,
SCIM, Defender API integration, or AP2 integration. Enforcement occurs at the
identity-aware network layer.

A separate Universal CAE containment experiment did **not** prove the desired
behavior. Gamma disabled Kobe exactly once after establishing working GSA-routed
access; roughly 100 seconds later Kobe-owned requests still returned HTTP 200.
Kobe was restored immediately and remains enabled/licensed. The result cannot
distinguish propagation delay from a client/token path that was not CAE-capable.
Do not simply repeat the disable/wait cycle. Any retest should first establish
that the relevant GSA client/token state is actually capable of the Universal
CAE challenge being tested.

### Endpoint Shadow IT / Cloud Discovery

A simple signed-out ChatGPT visit from Kobe's Defender-managed endpoint was used
as the modern Shadow IT canary. The first attempt established that the Defender
for Endpoint -> Defender for Cloud Apps integration itself was **Off**, so there
was no MDE Cloud Discovery stream. Alpha stopped there too conservatively; this
was a fixable supported prerequisite rather than a human blocker.

Alpha currently owns the corrected goal: enable the documented MDE integration
and then prove that Kobe's ChatGPT usage appears in Defender for Cloud Apps Cloud
Discovery with user/device/app/time attribution through the MDE source. Keep
this separate from GSA discovery/enforcement.

## Endpoint / AVD state

Fresh generalized-image AVD timing remains adequately calibrated:

- fresh deployment -> learner connection accepted: about **9m00s**;
- fresh deployment -> genuinely usable desktop: about **11m13s**;
- final Windows Welcome/first-profile phase: about **2m13s**.

Do not restart AVD timing optimization unless a real learner/product need makes
it worthwhile. Endpoint infrastructure remains disposable and reproducible.

The GSA upload/CAE experiments used Kobe's AVD endpoint and returned it to a
deallocated state after cleanup. Verify live Azure power state when it matters.

## Host crash, resource controls, and infrastructure direction

On 2026-08-10 Sean's Dell Precision 5770 suffered a severe Windows crash after
host-wide commit exhaustion. Windows recorded **63.588 GiB committed against a
63.692 GiB limit** immediately before the crash; WSL then reported memory
pressure, Windows shell/graphics components faulted, the host bugchecked with
`0x7E`, and NTFS repair ran on reboot. No decisive hardware/WHEA error was found.

WSL/Codex likely contributed but cannot explain the full 63.6 GiB host commit:
WSL had only about 7.6 GiB guest RAM plus 2 GiB swap. Surviving Windows telemetry
did not preserve the top commit consumer, so the exact host-side culprit is
unknown.

Two safeguards are now installed:

1. `codex-app-server.service` has an active systemd cgroup guardrail:
   - `MemoryHigh=4G`
   - `MemoryMax=5G`
   - `MemorySwapMax=1G`
2. Windows has a built-in PerfMon/logman collector `Host Memory Commit History`
   sampling every 15 seconds. It records commit/pagefile/kernel-pool and
   per-process private-memory counters into bounded circular BLGs:
   - current boot: `C:\ProgramData\HostDiagnostics\MemoryCommit\memory-commit.blg`
   - previous boot: `memory-commit-previous.blg`
   - 256 MiB cap each, with startup rotation, so ongoing retention is bounded.

The memory guardrail was applied live without restarting the app server.

### Proxmox direction

Sean is strongly interested in making the coordinator/agent environment
independent of his Windows laptop so the laptop can sleep without interrupting
long-running work. The likely first experiment is **not** a distributed cluster;
it is a straightforward migration of the current long-lived stack into one
Proxmox LXC CT:

- Codex app-server;
- coordinator and peer threads;
- `codex-agent-tools` dispatcher/durable state;
- Durable Coordinator Secure MCP Tunnel;
- AP2 repositories/worktrees and required local tooling.

Sean prefers CTs over full VMs. AP2 agents sometimes run containers during
backend/sign-in testing, so nested-container capability inside an unprivileged
Proxmox CT must be tested explicitly before committing to the migration.

A related idea is for AP2 itself to define a reproducible **agent development
environment** containing project dependencies such as Azure CLI, GitHub CLI,
Node/Python, Playwright/browser dependencies, PowerShell where needed, etc.,
while Codex/app-server and `codex-agent-tools` remain host/runtime concerns.
That could make AP2 work portable across WSL, Proxmox, and later other spare
machines. Do not design a large distributed scheduler yet; prove a single CT can
run ordinary AP2 agent work, including one existing container-based AP2 workflow,
first.

Longer term, Sean also has spare compute (a 16 GiB Proxmox host, an unused Intel
Mac with 16 GiB, other laptops, custom router/managed switch). A multi-node agent
pool may eventually be worthwhile, but the first useful infrastructure question
is simply whether the current WSL control/agent environment can move cleanly to
Proxmox and stay available while the laptop sleeps.

## Coordinator / Durable Coordinator state

The project uses one configured coordinator plus durable peers Alpha through
Epsilon. `state.json` is the durable assignment/goal/report source of truth and
`journal.jsonl` is event history; there is no separate live `goals.json`.

The **Durable Coordinator** custom app is the strategist's normal control surface.
The dedicated Secure MCP Tunnel is
`tunnel_6a792321dee08191bc9f4a3e3170f636`.

`codex-agent-tools` now exposes 13 MCP operations, including
`repository_edit_text`, which performs unique exact-text replacement using the
SHA-256 from a prior read and fails closed on stale/ambiguous/racing targets.
The ChatGPT plugin must be explicitly **refreshed** after MCP tool-schema changes;
restarting the tunnel alone does not refresh the already-registered action list.
A fresh ChatGPT session after refresh can see the 13th function.

PR #25 introduced the bridge, PR #26 added timeout-safe durable coordinator
submit/result reconciliation, PR #27 added targeted repository editing, and PR
#28 changed MCP `serverInfo.version` to `2.0.0` as a cache experiment. The
version change did not automatically refresh ChatGPT's action catalog; the UI
Refresh action did.

Repository tools can edit allowlisted text but still do not commit/push. The
strategy session should own canonical wording and use a coordinator turn only
for the mechanical commit/push when needed.

At this handoff, several peer goals are or recently were active. **Do not rely on
this snapshot for their lifecycle. Inspect Durable Coordinator live state first.**
The most important known questions are:

- Alpha: enable MDE -> Defender for Cloud Apps integration and prove Kobe/ChatGPT
  Cloud Discovery attribution;
- Beta: repair Cory/Marge YouTrack issue access and repeated-authentication
  behavior while preserving differentiated download policy;
- Epsilon: prove Purview-protected YouTrack download using an existing encrypted
  label;
- Delta's GSA PDF-upload block is already proven and cleaned up;
- Gamma's Universal CAE containment attempt did not prove enforcement and should
  not simply be repeated without verifying CAE-capable client/token state.

## Strategy reminders

- Inspect Durable Coordinator live state before acting; this snapshot is not a
  live docket.
- Strategist co-creates goals with Sean; coordinator executes approved work
  through durable peers.
- Preserve the original purpose and let peers exercise bottom-up technical
  judgment. A fixable prerequisite is normally something to fix and continue,
  not a reason to stop and ask Sean.
- Prefer supported API/CLI paths first, straightforward supported browser UI
  second, and brittle/private workarounds last. For genuinely tricky interactive
  browser edges, a bounded human step is preferable to architecture changes or
  hours of automation struggle.
- Learner-style actions that are themselves the evidence are good manual Sean
  actions; configuration/backstory should be automated when that is actually
  efficient.
- Avoid tight polling around Microsoft propagation. Use bounded waits and later
  observations; do not interpret silence as failure prematurely.
- Prefer fast empirical experiments over speculative architecture.
- Keep Defender API App Connector, Conditional Access App Control, MDE Cloud
  Discovery, GSA/Entra Internet Access, and Purview conceptually separate; they
  contribute different evidence/enforcement layers.
- The Student tenant, endpoints, and experimental state are disposable around
  the retained AP2 control plane and should remain reproducible.
