# AGENTS.md

## Working principles

### Testability

Prefer architecture that is easy and efficient to test.

Prefer end to end testing that uses a similar path as the product itself, when possible.

### Speed

Use subagents when you can parallelize work.

Prefer fast feedback loops.

Try to avoid repeated operations that incur wait times (e.g. merging, github or tenant operations)

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
