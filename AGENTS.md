# AGENTS.md

## Working principles

### Testability

Prefer architecture that is easy and efficient to test.

Prefer end-to-end testing that uses a similar path as the product itself, when
possible.

### Speed

For Captain-led work, use the five shared peer-worker threads through the
detached assignment process in [captains-strategy.md](captains-strategy.md).
Those durable peer threads are not personal `/root` child subagents. The
Captain must not create child subagents for project work.

Give peer workers durable goals rather than individual procedural steps. A
peer worker should normally own planning, implementation, correction, review,
verification, and closeout for one distinct outcome. It may use its own
subagents to parallelize or independently review parts of that goal.

Prefer fast feedback loops.

Try to avoid repeated operations that incur wait times, such as merging,
GitHub operations, hosted deployments, or tenant operations.

### Safety boundaries

AP2 operates in dedicated lab environments. State created after a lab or
experiment begins is disposable. Cleanup should leave the environment ready
enough for another lab; it does not need to reproduce an exact prior state or
erase normal platform history.

Safety means protecting:

- the correct tenant, subscription, account, and target environment;
- credentials, certificates, tokens, and private evidence;
- the administrative path needed to regain control;
- people and systems outside the lab;
- unintended public exposure;
- service abuse limits;
- assets that predate the lab or experiment;
- the authorized spending boundary.

Within those boundaries, agents should move quickly. Read-only failures, local
tooling defects, clock changes, or changes between already approved transports
do not require new human authorization. Marked and reversible changes inside
the disposable lab normally do not require production-style ceremony.

Do not automatically repeat an ambiguous non-idempotent mutation. Reconcile
its outcome read-only first.

Use one focused independent review when an operation is broadly destructive,
difficult to recover from, or changes a real safety boundary. Do not create
review chains or re-review unchanged work.

### Efficient experimentation

Design experiments marker- and cleanup-first so their mutations can be
identified and reversed.

Validate fields that control mutation safety rather than normalizing upstream
presentation details.

If repeated findings converge on one abstraction, simplify or remove it.

When feasible, run deterministic local tests, then a local canary through the
real product path before hosted deployment. Avoid repeated CI or cloud cycles.

For features with a human-facing path, prefer operating the local product in a
browser before pushing another revision or repeating a tenant mutation. The
browser test should show whether the product actually behaves and communicates
as intended.

Use incremental checks for image-only changes.

Start with the decisive query. Do not add evidence-sealing ceremony unless the
result is consequential or genuinely ambiguous.

Reuse a verified authentication session or token cache within one controlled
test batch when isolation does not require a fresh sign-in. Use a fresh browser
context when authentication itself is under test. A local browser harness
should shorten the feedback loop; stop improving it when the harness costs more
time than the product risk it removes.

Backend simulated-user CBA and SPA operator sign-in are separate sessions.
Prefer one in-memory MSAL cache per simulated user, silent acquisition before
interactive CBA, and Graph `/me` for fixed-user verification. Treat Microsoft
Graph access tokens as opaque. Do not log or persist tokens, browser state, or
token caches during Pass 3.

See [the development workflow](docs/development-workflow.md) for the shared
testing and actor-selection strategy.

### Peer-worker ownership

A peer worker owns a distinct outcome, not a single procedural step.

The owning worker should continue through normal research, implementation,
testing, local correction, internal review, live verification, and integration
without returning to the Captain after every intermediate result.

A peer worker may create and direct its own subagents when one goal contains
parallel or specialized work. Those subagent findings return to the owning
worker, not normally to the Captain.

A worker should report to the Captain when:

- its owned outcome is complete;
- Sean must perform a genuinely human-only action or make a material decision;
- the established safety or authority boundary must change;
- its result materially changes another active goal; or
- an external blocker prevents useful progress within the goal.

Ordinary local defects, test failures, read-only transport problems, and
review findings the worker can resolve itself are not Captain checkpoints.

### Simplicity

Prefer solutions that keep the overall system simple.

Be cautious about adding new architecture.

If you see leftover code or unnecessary architecture, refactor or remove it.

Avoid overengineering.

### Autonomy and human interaction

Do not create unconventional workarounds or add new complexity simply to avoid
asking the human for input.

Ask for input when a decision meaningfully affects the mental model, product
direction, safety boundary, or overall architecture.

Agents should perform all testing and QA they can perform themselves, including
operating the SPA in a browser. Involve Sean only when human judgment, a
meaningful product or architecture decision, credentials or access only he
has, deliberate authorization, or evaluation of the human experience is
needed.

When Sean must act, give him one clear action, the expected outcome, and the
point at which he should stop. Do not turn human involvement into a sequence of
routine administrative checks that agents could perform themselves.

Agent QA does not replace intentionally requested human-experience testing.

### Human comprehension

When communicating with a human, write like a person, not an agent status
report. Keep it simple and understandable.

Prefer solutions that are easy to explain at a high level to a human.

Keep worker-to-Captain reports concise. State the outcome, blockers, material
changes, and only the decisive evidence or references. Prefer one short
paragraph. Leave step-by-step logs, exhaustive checks, routine unchanged-state
details, and full timing data in the worker thread or evidence files unless
they explain an ambiguity, risk, or requested decision.

### Languages

Keep the number of implementation languages small. Prefer TypeScript for
application code, automation, tooling, and tests.

Use PowerShell, Bash, or another language when the platform or task genuinely
calls for it.