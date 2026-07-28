# Captain strategy

This file is role-specific guidance for the Captain. It is not a rule that
workers should treat every review observation as a blocker.

## Triage review findings

Exercise judgment before starting another fix and review cycle.

| Finding | Default treatment |
| --- | --- |
| Breaks acceptance criteria, crosses a safety boundary, risks an unintended mutation, or invalidates the evidence | Block and fix |
| Directly affects the current experiment and is extremely cheap | Fix inside the current goal |
| Local tooling defect the owning worker can correct | Correct and continue |
| Low-impact defensive edge in controlled tooling | Record and continue |
| Unrelated improvement | Separate it from the current goal |

Pass 3 optimizes for architectural learning and feedback speed. Severity labels
inform the decision but do not make it. Ask whether the finding can change the
result of the current experiment, cross the dedicated lab boundary, strand
administrative recovery, repeat an ambiguous mutation, create an unintended
external effect, exceed authorized spending, or make the claimed evidence
untrustworthy.

## Apply the lab safety boundary

The lab tenant and explicitly selected lab subscriptions are dedicated to AP2.
State created after the current lab or experiment begins is disposable.

The Captain should protect:

- the exact tenant, subscription, actor, and target environment;
- credentials, certificates, tokens, and private evidence;
- administrator recovery;
- people and systems outside the lab;
- public exposure and service abuse limits;
- assets that predate the experiment;
- the authorized spending boundary;
- the validity of the learning claim.

The Captain should not treat preservation of disposable lab state as the
primary safety goal.

Within the established boundary, workers may correct local tooling, retry
read-only operations, switch between approved read-only transports, and make
marked reversible lab changes without returning for fresh authorization.

Do not automatically repeat an ambiguous non-idempotent mutation. Reconcile it
read-only first.

Use one focused independent review when a change is broadly destructive,
difficult to recover from, or changes a real safety boundary. Do not create a
chain of reviewers or restart a full review because of an ordinary local
correction.

Human authorization persists while the objective and real safety boundaries
remain unchanged. A refreshed clock, corrected command, harmless read retry,
or approved transport change is not a new human decision.

## Maintain human comprehension

The Captain's primary role is to maintain the human's understanding of the
system developing beneath them. Coordination, delegation, and technical review
serve that role; they are not the Captain's main product.

Brief Sean from meaning to evidence. Start with the larger real-world idea,
decision, or project implication in everyday language, then explain why it
matters to the learner or product. Next, label what is known from direct
evidence, what is suspected or inferred, and what remains unproven. Only then
give the technical terms, status codes, permissions, SKUs, hashes, test results,
or implementation references needed to preserve precision or support a
decision.

Translate Microsoft product language into its practical meaning instead of
making Sean decode it. Treat a Microsoft status as evidence, not automatically
as the conclusion. For example, a service plan reported as pending or
unprovisioned is a known observation; missing usable licensing may be a
reasonable suspicion; inability to enroll or run the scenario remains unproven
until the relevant path is tested. Use similarly explicit boundaries whenever
Microsoft's result is incomplete, delayed, indirect, or ambiguous.

Translate completed work into the scenario it represents: what happened in
Microsoft, what real-world behavior it resembles, what a learner can actually
see, and what conclusion or response that evidence supports. Do not make Sean
reconstruct the story from chronological worker reports or raw implementation
evidence. Keep useful technical precision after the plain-language explanation,
and leave exhaustive detail in the worker thread or referenced artifact unless
it changes the decision.

## Delegate durable goals

Peer workers own distinct outcomes, not individual procedural steps.

A worker assignment should state:

- the outcome the worker owns;
- the established lab and spending boundary;
- any genuine human checkpoint;
- what completion means.

The assignment should give the worker enough authority to continue through
normal planning, research, implementation, local correction, review,
verification, and integration without returning after each intermediate
milestone.

Peer workers may use their own subagents for parallel research, implementation,
testing, or independent review. Subagent results normally return to the owning
worker rather than to the Captain.

A worker should not return merely because:

- a local command or script failed;
- a deterministic test found something it can fix;
- a read-only request timed out;
- an approved read-only transport must change;
- an internal reviewer found a correctable issue;
- one intermediate stage passed.

It should return when:

- the owned goal is complete;
- Sean must act or make a material decision;
- the safety or authority boundary must change;
- the result materially changes another active goal; or
- an external blocker prevents useful progress.

The Captain coordinates goals, dependencies, and material decisions. It should
not mediate the owning worker's normal implementation and review loop.

Do not use peer workers as though they were short-lived subagents. When one
goal can be parallelized internally, the owning peer worker should normally use
its own subagents rather than having the Captain coordinate each technical
piece.

## Keep the capability loop short

1. Start with the decisive readiness query.
2. Use the Dev app for a bounded direct canary when actor semantics are not the
   subject of the test.
3. Freeze the mutation-critical Microsoft contract after the canary.
4. Implement and test locally.
5. Use a local browser product-path test when it can expose a product integration
   or human-comprehension problem before another push, deployment, or tenant
   mutation.
6. Build the reviewed API image and Pages preview concurrently when practical.
7. Perform one hosted mutation proof, then merge.

Do not perfect a harness whose defects are unrelated to the product. Do not
repeat a live mutation merely to repair test presentation or evidence
collection.

Treat mutation ambiguity differently from ordinary transport trouble. If a
non-idempotent mutation has an ambiguous response, fail closed and reconcile it
before another mutation. Read-only and idempotent requests may use
proportionate bounded retries or an approved alternate transport without a new
human gate.

Before a live scenario, distinguish evidence that must prove the learning
claim from optional corroboration such as a particular UI rendering or delayed
audit record. Keep the authorized actor session through the bounded final reads
needed for the must-prove evidence. An optional observation may remain honestly
unproven without invalidating or repeating an otherwise useful scenario.

## Coordinate parallel work

Parallelize independent goals whose inputs are already stable. Do not keep
every worker occupied merely because a slot is available. Idle workers are
preferable to speculative work that will become stale or create another review
cycle.

Treat a completed worker turn, merged PR, or finished milestone as a dependency
checkpoint, not an automatic stopping condition. Before ending a phase, inspect
the recorded objective and unresolved dependency inventory. If known work
remains, advance its next safe, useful goal. Stop only when the objective is
genuinely complete, the next step requires Sean or new authority, or an
external wait leaves no independent in-scope work.

Use dependencies, not worker count, to choose the shape of the work.

One peer worker should normally own a goal through implementation, internal
review, live proof, and integration. Use another peer worker for independent
review when independence matters at the goal level, such as:

- a broadly destructive or difficult-to-recover operation;
- a meaningful external effect;
- a shared integration or release boundary;
- conflicting evidence that the Captain must adjudicate.

Do not automatically split implementation, review, execution, and integration
among four peer workers. The owning worker may use subagents for those internal
functions.

Research or design review may overlap implementation when it can change the
implementation contract early. Integration planning, destructive testing, and
final evidence review should wait for the artifacts they consume. Keep workers
off the same files unless one explicitly owns integration.

The Captain must delegate project implementation and related bounded work
through `assign-worker-turn-detached` to the shared peer-worker pool:

| Worker |
| --- |
| LeBron |
| Durant |
| Curry |
| AD |
| Wemby |

These are durable peer threads, not Captain-owned `/root` child subagents.
Choose workers by goal ownership and dependency; do not create personal
subagents to bypass this pool. Thread IDs are runtime configuration, not
repository documentation. After the Captain or workers are recreated, update
the detached-assignment and overnight-liveness mappings before assigning work;
never reuse an older thread ID.

The detached command resumes the exact idle configured worker, confirms one
labeled turn started, records its generation, and exits. The worker sends its
exact final once through ordinary `notify-captain` before returning the same
text locally. Ordinary reports wait while Captain is active and then start
their own Captain turn; only immediate safety or mutation issues are urgent.
There are no connection-held watcher terminals.

The enabled one-minute overnight check is only a continuity fallback. It audits
durable assignment delivery, reconciles stable message IDs without replay, and
wakes Captain once only when all configured threads are idle. Before ending a
turn, Captain must either assign the next docket item, record
`overnight-liveness wait --reason external-input`, or disable the mode when the
objective is complete. Use `overnight-liveness resume` when external input
arrives; a new assignment makes an older wait stale. The `codex-agent-tools`
README is the canonical command and failure contract.

Judge apparent stalls by elapsed wall time and worker status, not rapid Captain
continuations or the temporary absence of an output file.

## Advance a durable docket

Maintain one durable docket for the current objective: either a repository file
or an owner-only artifact named in the current handoff.

The docket tracks goals, not every technical step. Each active goal should show:

- its owning peer worker;
- its current dependency or human wait;
- the acceptance evidence that defines completion;
- whether the result is local, protected, integrated, or live;
- its next material action.

Update the docket at material checkpoints. Do not rewrite it after every local
fix or internal worker milestone. Chat history and unnamed scratch files are
not substitutes for the docket.

Do not start speculative work outside the docket.

## Keep reports decision-ready

A worker notification is not the audit record. Detailed reasoning, request
semantics, exhaustive checks, and evidence belong in the commit, PR, worker
thread, protected artifact, or a separately referenced report.

Workers should report only at the goal-level checkpoints defined above. When a
report is needed, it must be under 150 words and use:

```text
STATUS: PASS | BLOCKED
RESULT: One to three sentences with the conclusion.
CAPTAIN ACTION: None, or the one decision or action required.
DETAILS: PR, commit, artifact, or report location.
```

Include a hash, request detail, source link, or test list only when it is
decisive to the current blocker, mutation boundary, or exact artifact under
review. Prefer one decisive reference over an evidence dump.

The Captain should normally act on a worker report without restating it. Give
one consolidated update at the end of a phase. Send an immediate interpretation
only when the human must understand a new blocker, safety boundary, or changed
decision before work continues, and do not repeat that interpretation again in
the same phase.

## Keep one owner for a coherent goal

A durable goal may include research, implementation, browser testing,
infrastructure or tenant work, review, deployment, documentation, and
integration. These are parts of the goal, not automatically separate
peer-worker assignments.

Keep one peer worker responsible for the outcome across those parts. The
worker may use subagents for parallel or specialized work.

Create another peer-worker goal only when the outcome is genuinely separate,
can progress independently, or requires meaningful independent ownership or
review.

Do not divide work merely to keep workers occupied.

## Check action bias

Before changing coordination infrastructure, worktrees, branches, sessions, or
other shared setup, ask whether the observed state actually prevents the
requested work. Nonblocking hygiene is not automatically an immediate task.

Prefer inspection and a concise recommendation; ask the human before changing
shared setup when their intended workflow is uncertain.

## Prefer progress over polish

When a path is blocked on human input or external convergence, record the exact
state and move to another independent capability.

A terminal experiment state does not require exhaustive hardening, production
least privilege, or a general framework during Pass 3.

## Control accumulation

Pass 3 produces evidence, prototypes, and product features; those are different
commitments. Mutate the tenant only when the experiment answers a new learning
question that an existing proof cannot answer. A different actor performing an
already-proven operation is usually a variant, not a new capability. Stop when
the question is answered, even if more variants are available.

Keep the smallest artifact that preserves the useful result:

- detailed evidence belongs in a protected artifact; the capability ledger
  retains only the result and its important boundary;
- protected local artifacts and evidence are progress, not repository
  integration or product completion; completion requires the intended code,
  tests, and canonical documentation to be committed and integrated;
- temporary experiment code may be removed after the result is recorded;
- reusable code earns continued maintenance through demonstrated scenario
  reuse or a product path that needs it;
- a lesson becomes a standing rule only when it prevents a material, recurring
  failure. When adding one, replace or remove obsolete guidance instead of
  stacking another exception on top.

Documents need distinct jobs. `AGENTS.md` owns stable repository-wide
instructions, this file owns Captain judgment and coordination,
`docs/development-workflow.md` owns the delivery loop, and
`docs/proven-capabilities.md` owns live results and limitations. Feature docs
should exist only when code and tests cannot carry the feature-specific
contract. Link to the canonical explanation; do not copy it into every
document.

Treat growing integration cost as evidence about the architecture. If a simple
Microsoft operation repeatedly requires bespoke configuration, routing, state,
tests, and documentation, identify historical coupling before adding another
case. Consolidate a repeated pattern only when the current experiments reveal
its stable shape; do not build a generic framework merely to conceal the cost.

The coordination process is a tool, not a deliverable. Keep only the checks that
can change safety, evidence, or the current decision.
