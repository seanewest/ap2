# AGENTS.md

## Disposable-lab authority

AP2 operates only in a dedicated disposable lab tenant and explicitly selected
lab subscriptions. Safety protects the correct tenant/subscription,
credentials, admin recovery, external parties/effects, public exposure, abuse
limits, predating assets, and authorized spend—not preservation of disposable
lab state.

| Risk | Scope | Default authority |
| --- | --- | --- |
| **R0 — observe** | Read-only inspection of an authorized tenant, subscription, repository, or protected evidence | Autonomous. Use proportionate bounded retries or an alternate local transport. Fix local clock, URI, parsing, or tooling defects and continue. No sealing or independent review is required. |
| **R1 — bounded lab change** | Reversible, marked, bounded-cost mutation of post-construction lab state with a known cleanup path | Autonomous while the persistent authorization conditions below hold. Prefer idempotent operations, reconcile before repeating an ambiguous request, and perform best-effort cleanup. |
| **R2 — broad lab change** | Broad or destructive mutation of post-construction lab state, such as a reset or resource-group deletion | Require proven admin recovery and one focused review of the mutation-critical boundary. Do not add review chains. |
| **R3 — boundary/high impact** | Any uncertain or changed tenant/subscription, credential or trust change, external person/effect, public exposure, admin-lockout risk, abuse-limit risk, predating asset, or spend beyond authority | Stop and require Sean's explicit decision. |

Authorization persists while the objective, actor, exact tenant/subscription,
blast radius and external effect, cleanup boundary, and spend ceiling remain
unchanged. A clock/window refresh, harmless read retry, transport change, or
local tool correction does not create a new approval gate. Re-review or reseal
only the part whose actor, blast radius/external effect, cleanup boundary, or
spend authority changed. Never replay an ambiguous non-idempotent mutation;
reconcile it read-only first.

Classify a HOLD before escalating it:

| HOLD category | Treatment |
| --- | --- |
| Boundary risk | Stop; resolve the R3 boundary with Sean. |
| Learning invalidation | Fix the evidence path or narrow the claim; use only the review required by its risk level. |
| Local/tooling defect | Correct and continue under the existing authority. |
| Optional hardening | Record separately and continue. |

R0 needs no review, R1 has no mandatory independent review, R2 gets one focused
review, and R3 goes to Sean. Do not review a review or rebuild/reseal unchanged
artifacts. The Captain must challenge blockers and ceremony that do not protect
a listed safety boundary or the learning claim.

For isolated Azure experiments, use one unique run ID and resource group with
AP2 marker and expiry tags. Deploy idempotently within that group and delete the
exact group deterministically at expiry. Older marked groups are cleanup
backlog, not a global-absence gate, unless they create a quota, cost, or naming
conflict. Budget alerts are backup signals, not hard caps; the authorized spend
ceiling and run stop remain controlling.

## Working principles

### Testability

Prefer architecture that is easy and efficient to test.

Prefer end to end testing that uses a similar path as the product itself, when possible.

### Speed

For Captain-led work, use the five shared peer-worker threads through the
detached assignment process in [captains-strategy.md](captains-strategy.md).
Those durable peer threads are not personal `/root` child subagents. The
Captain must not create child subagents for project work.

Prefer fast feedback loops.

Try to avoid repeated operations that incur wait times (e.g. merging, github or tenant operations)

### Efficient experimentation

Design experiments marker- and cleanup-first so their mutations can be identified and reversed.

Validate fields that control mutation safety rather than normalizing upstream presentation details.

If repeated findings converge on one abstraction, simplify or remove it.

When feasible, run deterministic local tests, then a local canary through the real product path before hosted deployment. Avoid repeated CI or cloud cycles.

Use incremental checks for image-only changes.

Start with the decisive query. Follow the canonical risk level instead of
adding evidence-sealing ceremony.

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

### Simplicity

Prefer solutions that keep the overall system simple.

Be cautious about adding new architecture.

If you see leftover code or unnecessary architecture then refactor or remove it.

Avoid overengineering.

### Autonomy and human interaction

Do not create unconventional workarounds or add new complexity simply to avoid asking the human for input.

Ask for input when a decision meaningfully affects the mental model or overall architecture.

Agents should perform all testing and QA they can perform themselves, including operating the SPA in a browser. Involve Sean only when human judgment, a meaningful product or architecture decision, credentials or access only he has, or deliberate evaluation of the human experience is needed.

Agent QA does not replace intentionally requested human-experience testing.

### Human comprehension

When communicating with a human, write like a person, not an agent status report. Keep it simple and understandable

Prefer solutions that are easy to explain at a high level to a human.

Keep worker-to-Captain reports concise. State the outcome, blockers, material changes, and only the decisive evidence or references. Prefer one short paragraph. Leave step-by-step logs, exhaustive checks, routine unchanged-state details, and full timing data in the worker thread or evidence files unless they explain an ambiguity, risk, or requested decision.

### Languages

Keep the number of implementation languages small. Prefer TypeScript for application code,
automation, tooling, and tests.

Use PowerShell, Bash, or another language when the platform or task genuinely calls for it.
