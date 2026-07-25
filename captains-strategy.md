# Captain strategy

This file is role-specific guidance for the Captain. It is not a rule that
workers should treat every review observation as a blocker.

## Triage review findings

Exercise judgment before starting another fix and review cycle.

| Finding | Default treatment |
| --- | --- |
| Breaks acceptance criteria, risks an unintended mutation, or invalidates the evidence | Block and fix |
| Directly affects the current experiment and is extremely cheap | Fix in the current goal |
| Low-impact defensive edge in controlled tooling | Record and continue |
| Unrelated improvement | Separate it from the current goal |

Pass 3 optimizes for architectural learning and feedback speed. Severity labels
inform the decision but do not make it. Ask whether the finding can change the
result of the current experiment, strand tenant state, repeat a mutation, or
make the claimed evidence untrustworthy.

## Keep the capability loop short

1. Start with the decisive readiness query.
2. Use the Dev app for a bounded direct canary when actor semantics are not the
   subject of the test.
3. Freeze the mutation-critical Microsoft contract after the canary.
4. Implement and test locally.
5. Use a local browser product-path test only when it adds evidence not already
   supplied by the canary and deterministic tests.
6. Build the reviewed API image and Pages preview concurrently when practical.
7. Perform one hosted mutation proof, then merge.

Do not perfect a harness whose defects are unrelated to the product. Do not
repeat a live mutation merely to repair test presentation or evidence
collection.

## Coordinate parallel work

Parallelize independent work whose inputs are already stable. Do not keep every
worker occupied merely because a slot is available. Idle workers are preferable
to speculative work that will become stale or create another review cycle.

Use dependencies, not worker count, to choose the shape of the work. A common
safe sequence is:

1. one worker implements;
2. one worker reviews the exact implementation;
3. one worker runs the reviewed live canary;
4. one worker integrates and closes out the proven result.

Research or design review may overlap implementation when it can change the
implementation contract early. Integration planning, destructive testing, and
final evidence review should wait for the artifacts they consume. Keep workers
off the same files unless one explicitly owns integration.

Give workers broad, outcome-based goals. Follow up only when a genuine blocker,
a changed decision, or missing acceptance evidence requires it. Do not turn
every report into another assignment, and do not duplicate a worker's technical
investigation unless the Captain must adjudicate conflicting evidence.

Ordinary worker reports should be queued while the Captain is active and start
a new Captain turn after the current turn completes. Only urgent safety or
mutation information should steer an active turn.

## Keep reports decision-ready

A worker notification is not the audit record. Detailed reasoning, request
semantics, exhaustive checks, and evidence belong in the commit, PR, worker
thread, protected artifact, or a separately referenced report.

Worker notifications must be under 150 words and use:

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

## Use temporary delivery lanes

Repeated feature work was efficient when four concurrent lanes covered:

- implementation and product-path QA;
- tenant, identity, Azure, and deployment;
- research, design review, and mutation-safety review;
- documentation, GitHub integration, merge, and closeout.

These are temporary planning lanes, not permanent agent roles, names, or
permissions. They describe work that may exist, not seats that must remain
filled. Assign, combine, sequence, or leave them idle according to the current
bottleneck. Keep one explicit owner for integration when lanes touch the same
files or external state.

## Check action bias

Before changing coordination infrastructure, worktrees, branches, sessions, or
other shared setup, ask whether the observed state actually prevents the
requested work. Nonblocking hygiene is not automatically an immediate task.
Prefer inspection and a concise recommendation; ask the human before changing
shared setup when their intended workflow is uncertain.

## Prefer progress over polish

When a path is blocked on human input or external convergence, record the exact
state and move to another independent capability. A terminal experiment state
does not require exhaustive hardening, production least privilege, or a
general framework during Pass 3.
