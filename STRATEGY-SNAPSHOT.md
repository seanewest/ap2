# Strategy snapshot — 2026-08-12

This is the orientation handoff for the next primary ChatGPT strategy session.
It now covers **two repositories**:

- `seanewest/ap2` — the Microsoft 365 / Azure / security capability-exploration
  project;
- `seanewest/codex-agent-tools` — the increasingly project-agnostic agent
  harness used to run AP2 and intended to support other projects later.

This file is a point-in-time strategic snapshot, **not live execution state**.
For current goals, worker activity, reports, or blockers, use the **Durable
Coordinator** custom app first.

## Read these next

For AP2 orientation, read:

1. `AGENTS.md`
2. `chatgpt-strategy.md`
3. `docs/product-direction.md`
4. `docs/product-model.md`
5. `docs/proven-capabilities.md` for completed live evidence

For the agent harness, read in `seanewest/codex-agent-tools`:

1. `README.md`
2. `AGENTS.md`
3. `docs/operating-contract.md`
4. the focused replacement/service/CT documents linked from those files when
   needed for the current migration

The generic Strategist -> Coordinator -> worker workflow is becoming a
`codex-agent-tools` concern rather than an AP2 concern. AP2 should increasingly
contain only AP2 product/strategy guidance plus project configuration that uses
that harness.

## How the strategy session works

Sean uses ChatGPT as a conversational **Strategist**. The Strategist helps Sean
interpret results, decide what is worth doing next, and turn approved direction
into bounded goals for the local Coordinator. The Coordinator delegates and
operates; it should not become the product strategist.

The intended flow is:

**Sean <-> ChatGPT Strategist -> Durable Coordinator -> durable goal -> worker**

The Coordinator is event-driven. After assigning work it should end its turn and
let the dispatcher wake it when reports arrive. It should not repeatedly poll
workers merely to see whether they are finished. It may inspect or steer the
exact worker that owns a goal when there is a concrete suspected stall,
ambiguity, or reason to preserve that worker's context.

The replacement harness is moving away from permanent named peers. A **goal** is
the durable primary object. A goal retains the exact worker/thread that owns it
so the Coordinator can continue that same worker, steer it, or inspect bounded
history when context matters. Warm anonymous workers may be reused; more can be
created as needed; eligible idle workers can retire after a TTL without losing
DONE/BLOCKED goal history.

## ChatGPT custom apps / plugins

Two ChatGPT custom apps are available from the current WSL rollback environment:

### Durable Coordinator — primary

Use **Durable Coordinator** for normal strategy work. It is deliberately bounded
and exposes workflow status, durable goals/reports/journal, coordinator turns,
and protected repository text operations rather than arbitrary shell access.

Important behavior already fixed in `codex-agent-tools`: if the exact configured
Coordinator thread is merely `notLoaded`, the bridge safely resumes that exact
thread, rechecks identity/idle/direct-input eligibility, and then submits the
turn. A terminal does not need to be kept open just so ChatGPT can talk to the
Coordinator.

### Local Shell — fallback only

A separate **Local Shell** app exists as an emergency/fallback mechanism. It
uses `shell-exec-mcp` through its own Secure MCP Tunnel and can execute arbitrary
commands in WSL; a harmless `pwd` has been proven to return `/home/west`.

**Use Local Shell sparingly.** It is broad, can trigger platform safety blocks,
and should not replace Durable Coordinator for ordinary implementation or
workflow observation. Its useful roles are recovery when Durable Coordinator is
unavailable and occasional independent host-level diagnosis.

Current WSL Local Shell and Durable Coordinator are intentionally preserved as
the rollback path during the Proxmox migration.

## AP2 strategic state

AP2 is still primarily **capability exploration**, not lab-authoring. The useful
mental model remains:

**capability -> scenario -> incident background -> later detect/prevent/respond learning**

The SPA remains Sean's internal capability notebook/operator console, not the
learner product.

A great deal of Microsoft/SaaS capability evidence was added since the previous
snapshot. `docs/proven-capabilities.md` is canonical; the most strategically
important recent results are:

- **YouTrack SAML + SCIM + Defender Conditional Access App Control** is proven.
  Cory and Marge can reach the same staged SaaS content with different download
  treatment. Defender can also allow a supported YouTrack download while
  applying an existing encrypted Purview sensitivity label to the downloaded
  copy without changing the SaaS original.
- A YouTrack **permanent token survives SCIM deactivation as a record but loses
  authorization** while the user is banned (`200 -> 403 -> 200` across
  deactivate/reactivate). A harmless custom app configured by that user remained
  configured/operational through deactivation.
- **MDE -> Defender for Cloud Apps Cloud Discovery** is proven: Kobe's ChatGPT
  use from a managed endpoint appeared with user/device attribution.
- **Universal CAE through Global Secure Access** is proven with the supported
  client: disabling Kobe triggered reauthentication and GSA channel disconnect;
  restoration reconnected the channels. This is session/channel containment,
  not endpoint isolation.
- **Purview Endpoint DLP paste-to-browser** is partially proven: a synthetic
  credit-card sample pasted into an unsent ChatGPT prompt was blocked and
  appeared in Activity Explorer. The intended destination-differentiated
  YouTrack allow/audit path did not complete and remains an observed limitation.
- **Purview Network Data Security through Global Secure Access** is proven for a
  direct sensitive upload. The same sensitive file later passed inside a normal
  Windows Git HTTPS `receive-pack`: GSA intercepted TLS but Purview produced no
  content-policy match. This is a useful demonstrated **Git pack/protocol opacity
  boundary** for that DLP path.
- GitHub Enterprise Cloud EMU + Entra SSO/SCIM + Defender's GitHub API connector
  are proven. Defender ingests some GitHub activity such as `repo.create`, but a
  later 45-minute recheck still found no Defender `CloudAppEvents` for the tested
  branch-protection destroy/create actions.
- A YouTrack -> GitHub workflow proved that a Purview-encrypted downloaded blob
  could be committed unchanged to GitHub, while full cross-system attribution of
  that movement was not available.

Do not re-prove these merely because they are interesting. Build on them when a
new strategic question actually benefits from the evidence.

## `codex-agent-tools` strategic state

The harness has changed substantially. It is no longer merely an AP2-specific
named-peer dispatcher.

Canonical source now contains a staged **goal-centric elastic replacement
harness** with:

- project-agnostic Strategist / Coordinator / goal-owned worker semantics;
- exact goal -> worker/thread ownership with same-worker continuation, steering,
  and bounded history inspection;
- warm anonymous worker reuse, bounded top-level worker creation, and TTL-based
  retirement without losing goal history;
- a simple goal-centric terminal status view that keeps RUNNING/BLOCKED/DONE
  outcomes visible after workers go idle or retire;
- configurable worker runtime/location binding so control can operate a worker
  runtime on another host/CT without embedding Proxmox or AP2 semantics;
- **event-driven remote completion** with exact runtime/thread/turn routing and
  bounded reconnect reconciliation. A five-second completion polling sweep was
  explicitly identified as a material architectural defect and removed;
- a goal-centric Durable Coordinator MCP bridge while preserving fixed-team
  compatibility for the current rollback environment;
- source-controlled replacement service/config bundles for distinct control and
  worker roles;
- authenticated worker transport and a minimal TLS design for non-local
  WebSocket use: authenticated Codex app-server on loopback behind an unprivileged
  nginx TLS proxy, with owner-only CA/token material and normal certificate /
  hostname validation;
- fail-closed two-CT staging assets and nested-container canary support;
- deterministic isolated end-to-end split-service rehearsal covering assignment,
  event/report capture, continuation/steer/history, wrong-token refusal,
  restart/reconnect recovery without replay, warm reuse/TTL behavior, durable
  goal status, and bounded shutdown.

The fully rehearsed source line was advanced through PRs #31-#42. The most recent
known canonical source after the TLS work is commit
`2d0366b5fb785f66b9117dafba536b1ea33d2c81`, with 197 tests passing plus the
isolated service rehearsal and focused TLS/service tests. Before relying on that
hash operationally, verify current `origin/main`; later migration work may have
advanced it.

A sealed replacement staging root was built at:

`/home/west/codex-agent-tools-replacement-stage-2d0366b`

with a reproducible package and no embedded secrets. The final live overlay is
supposed to remain incomplete until actual CT addressing/DNS, fresh Codex
authentication, a fresh top-level Coordinator identity, new epoch, and protected
TLS/token material exist.

## Proxmox replacement migration — immediate frontier

This is the **main current infrastructure project**.

The goal is to move the generic harness off Sean's Windows/WSL laptop so long
runs do not depend on the laptop staying awake. The target is intentionally
simple and should grow naturally rather than starting as a distributed
scheduler.

### Target layout

Use two Proxmox LXC CT roles on `vmbr1` / `10.0.0.x`:

- **control CT** — Coordinator, dispatcher, durable goal state, goal-status view,
  MCP bridge, tunnel staging, project configuration;
- **worker CT** — Codex worker app-server/runtime, anonymous worker pool,
  worktrees/build tooling, nested-container capability.

Worker location is an abstraction so additional worker CTs can be added later
if real RAM/compute pressure justifies it. Do **not** build automatic RAM
resizing, service discovery, or a cluster scheduler now. Proxmox CT resources
can be increased manually as needed.

### Infrastructure access

From WSL, the existing SSH key can access:

- Proxmox: `root@10.0.0.10` (`prox.lan` currently resolves to `10.0.0.10`);
- OpenWrt: `root@10.0.0.1` — Sean has now installed the WSL public key with
  `ssh-copy-id`, specifically so agents can manage DHCP/DNS/network state when
  needed.

`.lan` is the existing local naming convention and is fine to continue using;
do not create work merely to replace it with `home.arpa`.

Sean has explicitly authorized routine infrastructure work needed to build the
isolated replacement: DHCP/static-address choices, CT creation/configuration,
packages, accounts, service configuration, local DNS, TLS/capability-token
material, and tests should normally be handled by the agents. Do **not** offload
ordinary infrastructure choices to Sean merely because a preferred candidate
IP or configuration is inconvenient. Ask only for a genuine credential,
physical action, judgment boundary, or the final authority cutover.

Candidate CT identities from earlier discovery were control VMID 125 /
`10.0.0.11` and worker VMID 126 / `10.0.0.12`, but these are not sacred. Recheck
live Proxmox/OpenWrt state before non-idempotent creation and choose equivalent
safe values if necessary.

### Physical-host caveat

The Proxmox laptop was unexpectedly powered off during the migration. Sean has
physically started it again. Previous read-only inspection strongly suggested an
**abrupt loss of power/hard power-off rather than an orderly agent-issued
shutdown**: the prior boot ended as a crash, the journal stopped without normal
poweroff/reboot units, and logind is configured to ignore lid closure. Do not
assume agents caused it, but keep the distinction visible if host reliability
becomes relevant.

### Migration safety invariant

**OLD SYSTEM BUILDS NEW SYSTEM.**

The replacement CT system must not modify, rotate, unload, repoint, or replace
the current WSL Coordinator/team/tunnels/services/state while being built and
tested. The WSL system remains the rollback path.

The old named Alpha/Beta/Gamma/Delta/Epsilon team is temporary construction
machinery. The replacement design does not depend on permanent names.

### Cutover boundary

The **final ChatGPT/Durable Coordinator authority cutover is intentionally
reserved for Sean + the Strategist** after the CT replacement is provisioned and
passes real cross-CT lifecycle/restart/recovery tests.

Staging a separate candidate tunnel/profile on the new control CT is fine if it
remains non-authoritative. Do not silently repoint the currently registered
ChatGPT Durable Coordinator app.

The next Strategist should expect that this final cutover is coming soon and
should personally review the replacement state before authorizing it.

## Current live work

Do not use this section as a durable docket; inspect Durable Coordinator first.
At the moment of this snapshot, the Coordinator had just been told that:

- the Proxmox laptop is back online and reachable as `root@10.0.0.10`;
- OpenWrt is now reachable by key as `root@10.0.0.1`;
- routine network/DHCP/DNS/CT decisions are already authorized and should not be
  bounced back to Sean unnecessarily;
- it should resume live Proxmox preflight/provisioning through a peer and remain
  event-driven rather than polling that peer.

The exact assignment may already have advanced by the time the next Strategist
reads this. **Start by checking Durable Coordinator live status and recent
reports.**

## Handoff guidance for the next Strategist

1. Orient to **both repos**, not just AP2.
2. Use Durable Coordinator as the normal control surface; use Local Shell only
   when the bounded bridge is unavailable or host-level recovery truly requires
   it.
3. Treat `codex-agent-tools` as a project-agnostic harness in its own right.
   Avoid sneaking AP2-specific assumptions back into its core.
4. Keep the Coordinator event-driven. Do not encourage peer polling.
5. Preserve exact goal/worker/thread identity and same-worker context when
   continuation or steering matters, even though worker names are disappearing.
6. Continue the real Proxmox deployment rather than reopening already-proven
   source architecture questions unless live deployment exposes a material
   defect.
7. Keep the WSL harness untouched as rollback until the new control+worker CT
   environment passes real cross-CT tests.
8. The upcoming final ChatGPT/Durable Coordinator tunnel/app authority cutover
   is a deliberate Strategist/Sean action, not something the Coordinator or a
   worker should perform opportunistically.
9. For AP2 itself, consult `docs/proven-capabilities.md` before proposing another
   Microsoft/SaaS experiment so completed evidence is not rediscovered.

The intended next-session opening prompt is intentionally simple:

> You are the new AP2 strategist. We are developing seanewest/ap2 and
> seanewest/codex-agent-tools. Read strategy-snapshot.md in the ap2 repository,
> and any docs it points you to, and tell me when you are properly oriented.
