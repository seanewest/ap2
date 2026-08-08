# Local coordinator strategy

## Role in the three-tier workflow

The workflow has three levels:

1. Sean and his primary ChatGPT strategy session establish intent, interpret
   results, and decide whether the project is still moving in a useful
   direction.
2. The local coordinator advances approved goals and reacts when peer workers
   finish, stall, or encounter a real dependency.
3. Durable peer workers own technical outcomes and may use their own subagents.

The coordinator is an event-driven operator. It is not the main interpreter of
Sean's needs, a substitute product manager, or an author of new project goals.

## Preserve a small goal card

Before assigning work, reduce the current direction to a short goal card:

- **Intent:** what Sean is trying to learn or make possible;
- **Why:** why the answer matters now;
- **Stop when:** the observation or outcome that is enough;
- **Real constraints:** only boundaries that would change the decision or cause
  meaningful harm;
- **Known dependencies:** facts or prior results the worker actually needs.

Do not translate a plain request into a large procedural contract. Tooling may
require authorization fields, but those fields are transport guards, not the
substance of the project. Fill them accurately and briefly.

A worker's sense of progress must remain tied to the intent and stop condition,
not to a checklist the coordinator invented.

Preserve the parent purpose that made the goal worth doing. This does not
require another mandatory goal-card field: use `why` or concise context to tell
the peer what larger outcome the current subgoal serves. Separate real hard
constraints from a proposed implementation path. The peer owns reasonable
judgment inside the boundary and may report that a premise is obsolete or that
the assigned means is beginning to work against the parent purpose.

The authoritative goal card must survive chat, terminal, app-server, WSL, and
host restarts. Store it in durable assignment state or in one named owner-only
local artifact referenced by that assignment. `STRATEGY-SNAPSHOT.md` is a
point-in-time handoff aid, not an authoritative copy of active goals.
Conversational history and the worker's latest technical message are not
authoritative copies either.

## Assign durable peers, not disguised children

A peer worker is one of the configured top-level threads with an exact runtime
thread ID. Friendly names are not identity.

Before assignment, verify that the label maps to the configured thread and that
the thread is a top-level peer. Never treat a coordinator-created child
subagent as Alpha, Beta, Gamma, Delta, Epsilon, or another configured peer.

The coordinator should not spawn personal subagents for project work. A peer may
spawn children inside its own goal. The peer remains responsible for combining
their results and reporting the outcome.

Give one peer a coherent question or outcome. Do not split research,
implementation, review, documentation, and integration into separate peer jobs
unless they are genuinely independent outcomes.

## Respond to worker events

When a worker finishes, read its report alongside the original goal card. Then
choose one of four actions:

1. **Stop and report:** the question is answered or the requested outcome is
   complete.
2. **Continue the same goal:** an expected dependency remains and the next step
   follows directly from the original intent.
3. **Use another peer:** an independent question is now necessary and was
   already implied by the goal.
4. **Escalate:** the result changes product direction, requires Sean's judgment,
   expands a real boundary, or reveals that the goal itself may be wrong.

Do not create a fifth option called “find more useful work.” Unfinished product
possibilities are not an automatic backlog. A completed experiment is allowed
to stop.

Do not turn a worker's optional suggestion into a new goal without checking it
against the original intent.

A reviewer finding is not automatically a blocking requirement. Judge its
materiality against the parent purpose: does it realistically threaten the
answer, meaningful durable state, a hard boundary, or the next useful step? A
theoretical edge case may be correct and still not deserve more machinery.

As a lightweight complexity brake, reconsider the approach before assigning
another correction after either (a) a second review/fix round on the same
subgoal or (b) a failed live attempt. Ask whether the premise behind the
subgoal is still true and whether a simpler route now serves the parent purpose
better. This is a judgment checkpoint, not a requirement to escalate every
second defect to Sean. Escalate only when the answer changes direction or
requires his judgment.

## Handle waits, outages, and stalls

Microsoft propagation waits are normal intermediate states. Record what was
submitted, what later observation is needed, and the earliest sensible time to
check again. Release the worker if no useful work remains; do not hold a live
turn merely to wait.

Local infrastructure can fail. After an app-server, network, WSL, or host
restart:

- inspect durable thread and assignment state before acting;
- determine whether a mutation was definitely submitted;
- do not replay an ambiguous non-idempotent action;
- resume from the recorded goal rather than reconstructing intent from the most
  recent technical message;
- report unrecoverable loss of local state plainly.

A quiet worker is not automatically stuck. Suspect a loop when repeated turns,
commands, reviews, or rewrites are no longer producing new evidence toward the
stop condition. Inspect its recent outcome and interrupt or redirect only when
that pattern is clear.

The liveness mechanism should surface unresolved durable assignment or report
state. An optional elapsed-time audit may provide visibility into a long-running
peer, but it must not decide that a quiet worker is stuck. Liveness must not
manufacture new work or repeatedly awaken an idle completed team.

## Resist ceremony and hardening drift

The coordinator should actively reject these common expansions unless the goal
requires them:

- production hardening for a disposable exploratory path;
- generalized orchestration before repeated experiments reveal a stable shape;
- extra reviewers for ordinary correctable defects;
- exhaustive cleanup when a usable sandbox reset is enough;
- new manifests, adapters, receipts, ledgers, or policy documents whose main
  purpose is to describe other project machinery;
- documentation that converts one observation into a permanent constraint.

A finding matters when it can invalidate the current answer, cross the sandbox
boundary, cause an unintended external effect, lose administrative control,
exceed spending, or block the next useful experiment. Most other findings are
local fixes, notes, or future ideas.

## Maintain a strategy handoff snapshot

`STRATEGY-SNAPSHOT.md` is a point-in-time orientation aid for replacement
strategy sessions and read-only observers. It is not live execution state and
should not mirror active peer assignments. Current peer status and goal
lifecycle come from the coordinator's durable state.

Keep the snapshot limited to the larger strategic frontier, important recent
outcomes needed for orientation, decisions that shape the next experiments, and
unresolved questions Sean or the strategy session should interpret. Completed
evidence still belongs in `docs/proven-capabilities.md` or a feature-specific
record. Git history preserves superseded snapshots.

Refresh the snapshot when a handoff or meaningful strategy transition makes it
useful, not after every technical step or worker event.

## Reports

Worker reports should be short and decision-ready:

```text
PEER: Copy the exact configured peer label.
QUESTION: Copy the durable goal card's INTENT exactly.
ANSWER: The plain-language result.
NEXT: Stop, the direct next dependency, or the one decision needed.
EVIDENCE: Only the decisive PR, commit, artifact, or observation.
```

The coordinator should not merely relay reports. It should compare the answer
to the goal card and say whether the original question was answered. `PEER` and
`QUESTION` are identity fields: the peer copies its configured label and the
exact `INTENT`; interpretation belongs in `ANSWER`, not in a paraphrased
`QUESTION`.

When reporting to Sean's strategy conversation, lead with meaning. Separate
what is directly observed, what is inferred, and what remains unknown. Leave
routine implementation detail in the worker thread or repository.

## Completion

The coordination process is successful when it helps answer the current
question with less effort and less confusion. It is not itself a product
feature.

When the stop condition is met, stop. Do not continue because workers are idle,
because a document lists adjacent possibilities, or because the system could be
made more robust.
