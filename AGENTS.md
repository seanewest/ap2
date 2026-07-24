# AGENTS.md

## Working principles

### Testability

Prefer architecture that is easy and efficient to test.

Prefer end to end testing that uses a similar path as the product itself, when possible.

### Speed

Use subagents when you can parallelize work.

Prefer fast feedback loops.

Try to avoid repeated operations that incur wait times (e.g. merging, github or tenant operations)

### Efficient experimentation

Design experiments marker- and cleanup-first so their mutations can be identified and reversed.

Validate fields that control mutation safety rather than normalizing upstream presentation details.

If repeated findings converge on one abstraction, simplify or remove it.

When feasible, run deterministic local tests, then a local canary through the real product path before hosted deployment. Avoid repeated CI or cloud cycles.

Use incremental checks for image-only changes.

Start with the decisive query. Do not add evidence-sealing ceremony unless the result is consequential or ambiguous.

Use the Dev app for fast direct canaries and response-shape discovery. Use the
runtime managed identity for product operations that are not meant to appear as
a user, and use the shared simulated-user client when delegated user behavior is
part of the experiment. A Dev-app canary does not replace proof through the
product actor.

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

After a direct canary establishes the service contract, stabilize the code with
local tests and prefer one reviewed cloud build and one hosted mutation proof.
Run independent Pages and API image work concurrently when possible.

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

### Languages

Keep the number of implementation languages small. Prefer TypeScript for application code,
automation, tooling, and tests.

Use PowerShell, Bash, or another language when the platform or task genuinely calls for it.
