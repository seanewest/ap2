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

Delegate independent research, review, documentation, and implementation
slices when slots are available. Keep workers off the same files unless one
explicitly owns integration. Reports should identify the artifact, commit,
tests, true blocker, and whether any mutation or cleanup remains.

Ordinary worker reports should be queued while the Captain is active and start
a new Captain turn after the current turn completes. Only urgent safety or
mutation information should steer an active turn.

## Use temporary delivery lanes

Repeated feature work was efficient when four concurrent lanes covered:

- implementation and product-path QA;
- tenant, identity, Azure, and deployment;
- research, design review, and mutation-safety review;
- documentation, GitHub integration, merge, and closeout.

These are temporary planning lanes, not permanent agent roles, names, or
permissions. Assign and combine them according to the current bottleneck, and
let workers use subagents for bounded parallel work. Keep one explicit owner
for integration when lanes touch the same files or external state.

## Prefer progress over polish

When a path is blocked on human input or external convergence, record the exact
state and move to another independent capability. A terminal experiment state
does not require exhaustive hardening, production least privilege, or a
general framework during Pass 3.
