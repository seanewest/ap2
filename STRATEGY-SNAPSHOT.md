# Strategy snapshot — 2026-08-15

This is a deliberately small orientation handoff for the next primary ChatGPT
Strategist. It covers:

- `seanewest/ap2`, the Microsoft 365 / Azure / endpoint / SaaS / security
  capability-exploration project; and
- `seanewest/codex-agent-tools`, the project-agnostic durable multi-agent
  harness used to execute AP2 work.

This file is not live execution state, a backlog, or an instruction to resume
historical work. Use the Durable Coordinator for current goals, reports, worker
activity, and exact durable dispositions.

## Start here

1. Confirm the Durable Coordinator tool works.
2. Confirm Local Shell works with a harmless `hostname`, `id -un`, and `pwd`.
   Its expected host is `harness-control`, user is
   `codex_control_replacement`, and working directory is
   `/srv/replacement-control-workspace`.
3. Read the shared Strategist guidance in `seanewest/codex-agent-tools`.
4. Read this repository's `AGENTS.md`, `chatgpt-strategy.md`,
   `docs/product-direction.md`, and `docs/product-model.md`.
5. Use `docs/proven-capabilities.md` as a reference for the specific product
   question under discussion. It is an evidence inventory, not a queue.
6. Summarize the current AP2 direction to Sean and ask what question is worth
   answering next before dispatching any goal.

Do not begin by reconstructing every old goal, report, worker thread, or
implementation detail. Do not continue work merely because it once had a work
number, a partial result, a suggestion, or an archived thread. In particular,
there is no inherited W49 (or other numbered-work) objective in the new team.
If a historical result was merged into `docs/proven-capabilities.md`, treat it
only as a factual result with the limitations recorded there.

## AP2 direction

AP2 is still capability exploration and early scenario composition, not lab
authoring. Keep the mental model:

**capability -> scenario -> incident background -> later detect/prevent/respond learning**

A capability is one repeatable action or observation with a known boundary. A
scenario combines capabilities into coherent incident-like state. A lab is a
later educational product. Do not grow generalized learner, lesson, assessment,
scenario-framework, or publishing architecture unless Sean explicitly asks for
it.

The current SPA is Sean's internal capability notebook/operator console. It is
not the learner product and should not be treated as a prototype of the eventual
learner interface.

Optimize for learning and feedback speed. Prefer the smallest decisive live
experiment over a generalized framework. Preserve the original plain-language
question and stop when the evidence is sufficient for the next product
decision.

## Product evidence

`docs/proven-capabilities.md` is the canonical inventory of completed evidence
and limitations. It contains results across Microsoft 365 content, identity,
endpoints, Defender/Purview, Global Secure Access, Azure Virtual Desktop,
YouTrack, GitHub, and related integrations.

Consult only the sections relevant to the current question before proposing an
experiment. Do not casually re-prove a completed fact, but also do not infer a
new objective from an adjacent result, limitation, accepted residue, or worker
recommendation. Negative boundaries are completed evidence unless Sean chooses
a materially different experiment.

The repository intentionally has no automatically generated strategic backlog.
Unexplored surfaces are possibilities, not queued work.

## Sandbox and execution boundaries

The Product and Student tenants contain a retained AP2 control plane. Preserve
standing identities, licensing, authentication, applications, permissions, and
other selected baseline configuration by default. Experimental workload state
around that control plane is disposable or resettable.

Broad exploratory authority is acceptable inside the dedicated sandbox when it
reduces friction, but actor identity, credentials, administrative recovery,
systems outside the sandbox, public exposure, service-abuse limits, and spending
remain real boundaries. Do not ask Sean to paste credentials into chat.

Normal AP2 execution is CT-native on Proxmox:

- control CT: `harness-control.lan`;
- worker CT: `harness-worker.lan`;
- AP2 worker checkout: `/srv/replacement-worker-workspace/ap2`;
- protected AP2 runtime:
  `/var/lib/codex-agent-tools-replacement/worker/ap2-runtime`.

WSL is not part of the normal Coordinator, worker, or Local Shell path. Do not
route work through it or reintroduce it as a dependency.

## Harness model

The normal path is:

**Sean <-> Strategist -> Durable Coordinator -> durable goal -> goal-owned worker**

The Strategist owns the product question and AP2's highest-level direction. The
Coordinator owns durable recording, assignment, recovery, and reporting.
Workers own bounded technical execution and course correction. The Coordinator
should remain event-driven rather than polling quiet workers.

AP2 product work belongs in `ap2`. A genuine shared-harness defect or feature
belongs in `codex-agent-tools` as a separate goal. Do not let harness engineering
become AP2 product direction.

The canonical Git checkouts are the live AgentTools code. Do not recreate an
ordinary release-staging or whole-harness cutover process. Restart or reconnect
only a long-running process whose loaded implementation actually changed.

## Fresh-team boundary

On 2026-08-15 the previous Coordinator and peer-worker team was intentionally
retired. Its durable epoch was archived as rollback/history rather than imported
into the replacement team's working context.

The replacement identities at this snapshot are:

- team epoch: `8bddf22c-d7f5-46b3-b168-3056424deeb1`;
- Coordinator: `01a006de-0091-7081-aa92-cc1701778f07`;
- worker-pool limit: 4.

At verification, the replacement epoch had zero workers, zero pending reports,
no active report batch, and no inherited assignments. The new Coordinator was
oriented and idle. AP2 was at `9c369f2`; AgentTools was at `c2723c3`.

These are point-in-time facts. Always inspect live state before acting. The old
epoch is protected historical evidence, not a source of goals to replay,
summarize into new work, or reason through by default.

## Handoff rule

The next Strategist's job is to recover the compact mental model above, talk
with Sean, and help choose the next useful product question. It is not to ingest
the old team's history, reconstruct a supposedly unfinished plan, or keep agents
busy.

When Sean approves a new experiment:

1. state the new question and stopping point plainly;
2. consult only the relevant existing evidence;
3. inspect the live Coordinator state;
4. dispatch one bounded durable goal through the new Coordinator; and
5. treat suggestions and follow-on ideas as optional until Sean chooses them.
