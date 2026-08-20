# Strategy snapshot — 2026-08-20

This is the point-in-time handoff for a fresh AP2 Strategist. It is not live
workflow state, a backlog, authorization to resume historical work, or normal
Coordinator/worker orientation. Use the Durable Coordinator for active work and
`docs/proven-capabilities.md` for detailed evidence.

## Recover the project

Read the shared Strategist guidance in `agent-tools`, then this repository's
`AGENTS.md`, `chatgpt-strategy.md`, `docs/product-direction.md`, and
`docs/product-model.md`. Consult only the relevant sections of
`docs/proven-capabilities.md`. Inspect the Durable Coordinator before assuming
anything is active.

The Strategist owns AP2's product direction and strategy documents. Workers own
technical execution and evidence. Do not reconstruct the full history or treat
old work numbers, worker suggestions, negative results, or unexplored surfaces
as a backlog. Recover the mental model, then choose the next useful question with
Sean.

## Current direction

AP2 is moving from isolated capability proofs toward **direct composition of
more realistic technical incident backgrounds** while remaining an exploration
project rather than a lab-authoring system.

The useful progression is:

**capability -> realistic scenario / incident background -> later detection,
prevention, response, and teaching work**

The near-term question is increasingly whether several proven actions can coexist
with coherent actor attribution, timing, workload artifacts, endpoint evidence,
and security telemetry. AP2 still does not need a generalized scenario engine,
learner contract, assessment system, or publishing architecture. Direct code and
direct composition remain the default until repeated concrete work demonstrates
a stable abstraction worth keeping.

The current SPA is Sean's internal capability notebook and operator console. It
is not the learner product and should not be treated as a prototype of the future
learner interface.

## Realism without harmful effects

AP2's realism comes from mimicking the observable behavior and evidence of an
incident, not from using real victims, real malicious payloads, or harmful
outcomes.

The Product and Student tenants, named simulated users, retained Windows
endpoints, AP2-owned SaaS instances, and synthetic experiment data are controlled
sandbox assets. Prefer the smallest harmless action that creates the evidence
shape actually needed: for example a no-op persistence value, synthetic file,
benign network request, or harmless PowerShell command that still creates useful
process lineage, RunMRU state, browser history, Defender telemetry, or workload
audit.

The fidelity question is whether the real security products and a later learner
would see the intended actor, process relationships, artifacts, timing, and
security evidence. A harmless action that mimics one stage proves that technical
stage and its evidence, not that a real compromise occurred.

## Building realistic scenarios

Start from the incident background and evidence that should exist, then choose
the least intrusive implementation that creates them faithfully.

- **Actor semantics matter.** When activity should look like Rachel, Homer,
  Kobe, or another simulated user performed it, prefer that real user's Windows
  or Microsoft 365 context when attribution, process ancestry, browser history,
  user registry state, or workload audit matters.
- **Use control-plane actions when actor fidelity does not matter.** Azure Run
  Command, Graph, ARM, Defender APIs, and similar paths are often simpler for
  machine-level setup, observation, cleanup, and neutral state changes.
- **Do not let simulation machinery become the incident.** A permanent AP2
  component inside every endpoint would create its own services, files, logs,
  credentials, network traffic, and Defender telemetry. Prefer external
  orchestration or temporary helpers unless an in-guest component clearly
  produces better fidelity without contaminating the evidence.
- **Separate staging from learner access.** Incident background can be generated
  before the learner arrives. The later learner should encounter the resulting
  endpoint and tenant state as though the fictional activity already happened.
- **Retain the smallest deterministic path.** When a realistic composition is
  proven, keep only the direct reusable code needed to reproduce it. One useful
  runner does not justify a general scenario framework.

## Endpoint and AVD model

AVD exists because a learner needs a practical route to retained Windows VMs. It
is infrastructure transport, not part of the fictional employee story. Reason
about the scenario as activity on an ordinary endpoint.

During exploration, AVD has also served as an external remote-control channel for
genuine interactive user-session actions. Driving a real simulated-user session
through the remote canvas can produce authentic browser, clipboard, Run-dialog,
process, and user-profile evidence in the guest. Machine-level background work
can instead use Azure Run Command as SYSTEM when user-originated evidence is not
the point.

A polished coordinate-free way to manipulate arbitrary interactive Windows user
sessions remains a design area, not a prerequisite for continued scenario work.
Do not assume the answer is a permanent guest agent.

A useful recent anchor is the composed fake-verification path: an AP2-owned page
in guest Edge used a trusted click to place one fixed harmless PowerShell command
on the guest clipboard; the simulated user pasted it through Win+R;
`explorer.exe` launched PowerShell; visible harmless output appeared; and
Defender later produced RunMRU evidence. Its importance is that a realistic
interactive evidence chain can be composed safely and reproducibly, not that
this one incident pattern should dominate future strategy.

## Evidence and handoff boundary

`docs/proven-capabilities.md` is the canonical evidence ledger across Microsoft
365, endpoints, Defender and Purview, Global Secure Access, Azure, YouTrack,
GitHub, and related integrations. Positive and negative results remain completed
evidence until Sean chooses a materially different question. Search it on demand;
do not use its size as a reason to re-ingest the entire project history.

AP2 product work belongs in `ap2`. Generic Strategist/Coordinator/worker behavior
and shared harness defects or features belong in `agent-tools`. This
snapshot may explain that boundary to the next Strategist, but it does not become
part of routine Coordinator orientation.

A fresh Strategist should recover this compact model, inspect live state, and
discuss the next useful product question with Sean. Do not keep agents busy
merely because an idea, limitation, or old work item exists.
