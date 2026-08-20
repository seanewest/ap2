# Strategy snapshot — 2026-08-20

This is a compact orientation handoff for a fresh AP2 Strategist. It is not
live workflow state, a backlog, or authorization to resume historical work.
Use the Durable Coordinator for current goals and `docs/proven-capabilities.md`
for detailed evidence and limitations.

## Start here

Read the shared Strategist guidance in `codex-agent-tools`, then this
repository's `AGENTS.md`, `chatgpt-strategy.md`, `docs/product-direction.md`,
`docs/product-model.md`, and only the relevant sections of
`docs/proven-capabilities.md`. Inspect the live Durable Coordinator state before
assuming any work is active. The Strategist owns AP2's product direction and
strategy documents; workers own technical execution and evidence.

Do not reconstruct the whole history or treat old work numbers, worker
recommendations, negative boundaries, or unexplored surfaces as a backlog.
Choose the next useful question with Sean.

## Current AP2 direction

AP2 is moving from isolated capability proofs toward **more realistic technical
scenario composition** while still remaining an exploration project rather
than a lab-authoring system.

Keep the mental model:

**capability -> realistic scenario / incident background -> later detect,
prevent, respond, and teaching work**

The near-term question is increasingly not just "can Microsoft perform this one
action?" but "can several proven actions be composed so the resulting tenant,
endpoint, SaaS, and security evidence resembles a coherent incident?"

Do not jump from that into a generalized scenario framework, learner contract,
assessment system, or publishing architecture. Direct code and direct scenario
composition remain the default until repeated concrete work demonstrates a
stable abstraction worth building.

The current SPA is Sean's internal capability notebook/operator console. It is
not the learner product and should not be treated as a prototype of the future
learner interface.

## Realism without real harm

AP2's realism comes from **mimicking the observable behavior and evidence of an
incident**, not from using real victims, real malicious payloads, or harmful
outcomes.

The Product and Student tenants, named simulated users, retained Windows
endpoints, AP2-owned SaaS instances, and synthetic experiment data are owned
lab assets. When a scenario calls for suspicious-looking activity, prefer the
smallest harmless action that produces the evidence shape we actually need:
for example a no-op persistence key, a synthetic file, a benign network request,
or a harmless PowerShell command that still produces realistic process lineage,
RunMRU state, browser history, Defender telemetry, or other artifacts.

The important fidelity question is: **would the learner and the real security
products see the right actor, process relationships, workload artifacts,
timing, and security evidence?** The simulation does not need a genuinely
malicious effect to answer that question.

Preserve the distinction between what was directly proven and the broader
incident story it may later support. A harmless action that mimics one stage of
an attack proves that technical stage and its evidence, not that a real
compromise occurred.

## How to build realistic scenarios well

Start from the incident background and evidence that should exist, then choose
the least intrusive implementation that creates it faithfully.

- **Actor semantics matter.** If activity is supposed to look like Rachel,
  Homer, Kobe, or another simulated user performed it, prefer execution in that
  real user's Windows or Microsoft 365 context when the resulting attribution,
  process ancestry, browser history, user registry state, or workload audit
  matters.
- **Use simpler control-plane actions when actor fidelity does not matter.**
  Azure Run Command, Graph, ARM, Defender APIs, and other external control paths
  are often better for machine-level setup, observation, cleanup, or state that
  does not need to appear user-originated.
- **Do not let simulation machinery become the incident.** A permanent AP2
  service or agent inside every endpoint could create its own processes,
  services, files, logs, credentials, network traffic, or Defender telemetry.
  Prefer external orchestration or temporary helpers unless an in-guest
  component is clearly the better tradeoff and its artifacts do not invalidate
  the scenario.
- **Separate background generation from learner access.** The incident can be
  staged before the learner arrives. The learner should later encounter the
  resulting endpoint and tenant state as though the fictional activity had
  already happened.
- **Keep proven automation.** When a realistic path is successfully composed,
  retain the smallest reusable deterministic code needed to reproduce it. Do
  not require a generalized scenario engine merely because one direct runner
  exists.

## Endpoint and AVD model

AVD exists because the learner needs a practical way to reach retained Windows
VMs. It is infrastructure transport, not part of the fictional employee story.
The scenario should be reasoned about as activity on an ordinary endpoint.

During exploration, AVD has also been useful as an **external remote-control
channel** for genuine interactive user-session actions. That is legitimate
implementation plumbing: driving a real Rachel session through the remote
canvas can still produce authentic Rachel browser, clipboard, Run-dialog,
process, and user-profile evidence inside the guest.

This is not the only endpoint-control method. Machine-level background work has
also been performed directly through Azure Run Command as SYSTEM. Choose the
path according to the evidence that must look user-originated.

A polished general-purpose way to manipulate arbitrary interactive Windows user
sessions without relying on remote-canvas coordinates is still a design area,
not a prerequisite for continuing scenario exploration. Do not assume the
answer is a permanent guest agent.

One useful recent anchor is the fully composed fake-verification path: an
AP2-owned page in guest Edge used a trusted click to write a fixed harmless
PowerShell command to the guest clipboard; the same user pasted it through
Win+R; `explorer.exe` launched PowerShell; `Hello World` appeared; and Defender
later produced a RunMRU alert. This matters mainly because it proves that a
realistic endpoint interaction chain can be composed safely and reproducibly,
not because ClickFix should dominate the next strategy discussion.

## Security-platform evidence

`docs/proven-capabilities.md` is the canonical evidence inventory. It now
contains both isolated capabilities and several composed scenarios across
Microsoft 365, endpoints, Defender/Purview, Global Secure Access, Azure,
YouTrack, GitHub, and related integrations.

Treat both positive and negative results as completed evidence until Sean
chooses a materially different question. For example, Defender is authentically
on the Endpoint Plan 2 experience, but the classic Device groups UI/surface
remained unusable beyond Microsoft's documented propagation window. That is a
current product fact, not an automatic task to keep retrying.

## Working with the Coordinator and workers

Normal execution is:

**Sean <-> Strategist -> Durable Coordinator -> durable goal -> goal-owned worker**

The Strategist should hand over the **outcome/question and relevant context**,
not remotely author a procedure for the worker. A simple goal such as "Did the
P2 activation work?" plus the necessary background can be better than a long
contract full of speculative prohibitions.

Use explicit constraints only for genuine boundaries the worker cannot safely
infer. Avoid blanket `read-only` language merely because the purpose is
observation; it can accidentally prohibit ordinary prerequisite repair. Trust
workers to choose implementation, verification, correction, and reasonable
alternative paths within the owned sandbox.

Real boundaries remain credentials, administrative recovery, actor identity
when it matters, systems outside the AP2 sandbox, public exposure, service-abuse
limits, and spending. Do not ask Sean to paste credentials into chat.

AP2 product work belongs in `ap2`. Shared harness defects or features belong in
`codex-agent-tools` and should not become AP2 product direction.

## Handoff rule

A fresh Strategist should recover the compact model above, inspect live state,
and talk with Sean about the next useful product question. Do not keep agents
busy merely because an idea, limitation, or old work item exists.
