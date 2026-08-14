# Strategy snapshot — 2026-08-14

This is the point-in-time orientation handoff for the next primary ChatGPT
Strategist. It covers two repositories:

- `seanewest/ap2` — Microsoft 365 / Azure / endpoint / SaaS / security
  capability exploration;
- `seanewest/codex-agent-tools` — the project-agnostic durable multi-agent
  harness used to execute AP2 work.

This file is **not live execution state**. Always use the Durable Coordinator
for current goals, reports, worker activity, and exact durable dispositions.

## First orientation steps

The intended new-session opening prompt asks the Strategist to verify both tool
surfaces before reading this snapshot:

1. confirm the **Durable Coordinator** tool works;
2. run `pwd` with **Local Shell** and confirm it returns `/home/west`.

That Local Shell check is only a connectivity sanity check. Local Shell lands in
Sean's external WSL environment (`ravioli`, user `west`) and is **not part of the
Coordinator/worker execution path**. The Coordinator and workers must not use or
depend on it. The Strategist may use it deliberately as an external operator/root
jump host when a host-level action really requires that authority.

After this file, read the AP2 documents in this order:

1. `AGENTS.md`
2. `chatgpt-strategy.md`
3. `docs/product-direction.md`
4. `docs/product-model.md`
5. `docs/proven-capabilities.md`

For the shared harness, read in `seanewest/codex-agent-tools`:

1. `README.md`
2. `AGENTS.md`
3. `docs/chatgpt-strategy.md`
4. `docs/operating-contract.md`
5. `docs/coordinator-strategy.md` / `docs/worker-strategy.md` as needed

## AP2 direction

AP2 is still **capability exploration**, not lab-authoring. The useful mental
model remains:

**capability -> scenario -> incident background -> later detect/prevent/respond learning**

A capability is one repeatable action or observation with a known boundary. A
scenario composes capabilities into useful incident-like state. A lab is a later
educational product. Do not grow generalized learner, lesson, assessment, or
scenario-framework architecture unless Sean explicitly asks for it.

The current SPA is Sean's internal capability notebook/operator console. It is
not the learner product or a prototype of the eventual learner UI.

Optimize for learning and feedback speed. Prefer one decisive live experiment
over a generalized framework. Broad development authority is acceptable inside
the dedicated sandbox when it reduces exploration friction, while credentials,
public exposure, spending, and actor identity remain real boundaries.

## Current AP2 execution environment

Normal AP2 execution is now durable on Proxmox; the WSL dependency has been
removed.

- Proxmox host: `10.0.0.10`
- control CT: `harness-control.lan` / `10.0.0.11` / VMID 125
- worker CT: `harness-worker.lan` / `10.0.0.12` / VMID 126
- AP2 worker checkout: `/srv/replacement-worker-workspace/ap2`
- durable protected AP2 runtime:
  `/var/lib/codex-agent-tools-replacement/worker/ap2-runtime`

The durable runtime contains the standing CBA/operator/Dev-Graph material needed
for normal experiments. Lisa's issuer and the simulated-user leaves were renewed
with the same keys/SKIs; fresh Kobe CBA sign-in is proven after the trust update.
The owner-only durable `admin_ap2` GitHub classic PAT is also present and proven
for the bounded enterprise/org/repository authority used by the GitHub canaries.
Do not ask Sean to paste credentials into chat.

AVD is practical but slow enough that startup/propagation time should be treated
as normal platform latency rather than worker failure. Temporary VMs should be
deallocated when an experiment is finished.

## AP2 work status at handoff

**There is no unfinished AP2 experiment right now.** All recent AP2 work is
terminal. The flat `goals` command mixes AP2 capability work with AP2 enabling
work and AgentTools engineering, so do not infer the product frontier from that
list alone.

The most important recent AP2 conclusions are:

### Endpoint DLP destination differentiation — complete

W20 added a controlled A/B proof, not merely another ChatGPT block observation.
On the same managed endpoint, under the same bounded policy and using the same
synthetic credit-card clipboard content:

- an unsaved YouTrack dashboard-name field accepted and retained the value for
  60 seconds;
- an unsent ChatGPT prompt remained empty and showed the Purview blocked-paste
  dialog by 22 seconds;
- Activity Explorer later attributed YouTrack as `Audit` and ChatGPT as `Block`.

The key new fact is that this exact Endpoint DLP policy can **differentiate the
two browser destinations**. Activity Explorer is retrospective: it showed
nothing around eight minutes and had the decisive records by roughly 50 minutes.
Cleanup completed and the VM was deallocated. Evidence commit: `a78d41c`.

### GitHub write deploy key — complete

W31 proved a narrow repo-scoped machine authority. With current enterprise/org
settings, one temporary Ed25519 deploy key attached to private
`ap2-v2-lab/maintainer-control-proof` with `read_only=false`:

- cloned the repository over SSH;
- pushed a marker commit to a temporary branch;
- returned the exact pushed commit via SSH `ls-remote`;
- populated GitHub's `last_used` field.

The key was **disposable only in the experimental sense**: it was created for
this canary and deleted afterward. The result is simply that a write-enabled
deploy key can independently read/write that exact private repository. It does
not grant organization-wide authority.

GitHub audit immediately recorded key create/verify/delete under `admin_ap2`,
but no distinct push action. Defender Advanced Hunting showed no matching GitHub
`CloudAppEvents` within the bounded ~4/~10 minute checks. All temporary key,
branch, commit, and runtime state was removed; target `main` was unchanged.
Evidence commit: `aa0820e`.

### Teams voicemail automation — complete negative boundary

W23 is **not an intermediate blocker**. The authorized browser approaches were
exhausted and the experiment closed:

- exact Kobe Teams Web CBA authentication worked;
- the first automated browser attempt produced one genuine Cory `Missed
  incoming` Teams artifact;
- it did **not** deposit Cloud Voicemail;
- the second technically distinct browser path failed before Microsoft accepted
  a second call;
- final accepted outbound call count was 1/3, with both permitted Teams Web
  variants exhausted.

So unattended browser automation can originate the missed-call artifact, but
this fake-microphone path has not produced voicemail. A materially different
calling/media mechanism or human-assisted voicemail deposit would be a **new
experiment requiring fresh approval**, not a continuation that should happen
automatically. The Graph bot `7505` path is also exhausted absent genuinely new
Microsoft evidence.

### YouTrack deactivation persistence — complete

A Kobe-configured YouTrack backend app remained configured and operational while
Kobe was SCIM-deactivated/banned; an administrator could invoke it and obtain a
successful outbound delivery. Kobe's own retained token was unauthorized while
banned (`200 -> 403 -> 200` across deactivate/reactivate). This proves retained
configuration/backend execution, not continued banned-user authority.

### Other important existing evidence

Do not casually re-prove the following; `docs/proven-capabilities.md` is the
canonical detailed inventory:

- YouTrack Entra SAML + SCIM lifecycle and Defender Conditional Access App
  Control;
- user-differentiated YouTrack download behavior and protected/encrypted
  downloaded copies;
- YouTrack -> GitHub movement of the protected encrypted blob;
- MDE -> Defender for Cloud Apps Cloud Discovery attribution;
- Universal CAE through Global Secure Access;
- GSA/Purview direct-upload blocking plus the observed Git HTTPS protocol-opacity
  boundary;
- GitHub EMU Entra OIDC/SCIM and partial Defender GitHub connector telemetry;
- SharePoint tamper/restore, Inbox-rule effect, EICAR attachment prevention,
  Teams membership remediation, and many smaller Graph/Azure capabilities.

## Current strategic frontier

There is intentionally **no automatically generated AP2 backlog** at handoff.
The next Strategist should first discuss with Sean what platform question is worth
learning next rather than interpreting DONE work as an obligation to add another
layer.

Potential future areas exist—broader endpoint controls, more SaaS behavior,
applications/identity/attack paths, Azure/Kubernetes surfaces, richer scenario
composition, or a materially different Teams voicemail path—but these are
examples of unexplored medium, **not queued work**.

When considering a new experiment, consult `docs/proven-capabilities.md` first
and ask what new decision the experiment would enable.

## Agent harness — current settled state

The Proxmox replacement is no longer a migration project. It is the live harness.
Normal path:

**ChatGPT Strategist -> Durable Coordinator tunnel/MCP on harness-control ->
Coordinator/dispatcher -> TLS worker runtime on harness-worker -> durable worker**

The generic workflow is:

**Sean <-> Strategist -> Coordinator -> durable goal -> goal-owned worker**

The Coordinator is event-driven. It owns durable recording, assignment,
continuation/recovery, and reporting. It should end its turn after dispatch and
wait for events rather than polling quiet workers. Worker capacity should be
viewed as elastic from the Strategist's perspective; do not ration goals simply
because a small number of warm workers happen to exist.

Workers own technical execution and course correction. The Strategist owns the
highest-level strategy/product guidance and directly authors documents such as
this snapshot and AP2 product direction. Do not delegate the meaning of those
documents to workers.

### Live-code model

`codex-agent-tools` deliberately removed the ordinary installed-release/staging
layer. The **canonical Git checkouts are the live AgentTools code**:

- control checkout:
  `/srv/replacement-control-workspace/codex-agent-tools`
- worker checkout:
  `/srv/replacement-worker-workspace/codex-agent-tools`

At this handoff both are at AgentTools commit
`90e4d72b72f0ce827f3ad56671f3d5561b8d248e`.

Control wrappers, dispatcher `ExecStart`, and the Durable Coordinator MCP
launcher execute from the control checkout. Runtime role files point to strategy
and operating docs in the appropriate checkout. A normal AgentTools change is
integrated by clean fast-forwarding the relevant live checkout(s). Short-lived
commands see it on their next invocation; restart/reconnect only a long-running
process whose loaded implementation changed. Do **not** recreate ordinary
release staging, `/current` promotion, activation, or whole-harness cutover
ceremony. Historical `/opt` release trees remain only as rollback evidence.

The latest MCP launcher also exports the existing protected worker capability
token and TLS CA paths, so direct `recent_messages` reads for durable pooled
workers work through the Durable Coordinator bridge.

### Local Shell boundary

Local Shell is an account-level ChatGPT App that reaches Sean's WSL machine. It
is separate from Durable Coordinator. WSL can SSH root to both harness CTs, so
the Strategist may deliberately use it as an **external operator jump host** for
a bounded host/root action when necessary. Coordinator and workers must not use
Local Shell as a fallback or route normal work through WSL.

## Durable Coordinator state at handoff

At the time this snapshot was written:

- all durable work items are terminal (`DONE`);
- no AP2 or AgentTools worker is active;
- four durable workers are AVAILABLE;
- no pending report batch exists;
- W37, the one-time live-checkout conversion, is authoritatively DONE even
  though its preserved original worker report describes the earlier failed
  attempt; the later external-operator reconciliation is the authoritative
  completion evidence.

Always check the live Durable Coordinator state rather than assuming this remains
true.

## Handoff guidance

1. Verify Durable Coordinator first; that is the normal control surface.
2. Verify Local Shell returns `/home/west`, but remember that this proves only the
   external WSL operator connector—not the harness path.
3. Orient to both repositories, but keep their purposes separate: AP2 is the
   product/exploration project; AgentTools is the reusable harness.
4. Consult `docs/proven-capabilities.md` before proposing AP2 experiments.
5. Do not treat a negative completed experiment (especially W23 Teams voicemail)
   as unfinished work.
6. Do not manufacture a backlog from worker suggestions, available worker
   capacity, or interesting adjacent questions.
7. Keep the Coordinator event-driven and preserve exact durable identity when
   continuing work.
8. Prefer simple files/Git/process behavior over deployment or orchestration
   machinery unless a concrete failure mode requires more.
9. When AP2 work genuinely needs a new capability experiment, discuss the
   strategic question with Sean first, then dispatch a bounded goal through the
   Coordinator.

The next Strategist's job is not to reconstruct every historical implementation
detail. It is to recover the current mental model quickly, understand what AP2
has actually proven, and help Sean choose the next useful question.
