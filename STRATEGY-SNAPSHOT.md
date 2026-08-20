# Strategy snapshot — 2026-08-20

This is a compact orientation handoff for a fresh AP2 Strategist. It is not
live workflow state, a backlog, or authorization to resume or create work.
Use the Durable Coordinator for current goals and `docs/proven-capabilities.md`
for the detailed evidence and limitations behind this summary.

## Current direction

AP2 is exploring reliable capabilities across Microsoft 365, Azure, endpoints,
SaaS integrations, and security systems, then directly composing useful
incident-like scenarios. It is not currently building labs, teaching content,
or a generalized scenario framework. The SPA remains Sean's internal
capability notebook and operator console, not a learner interface or a product
prototype.

Prefer the smallest experiment that answers the current product question.
Treat completed positive and negative results as evidence, not as implied next
work. Choose any new question with Sean before dispatching it.

## Learned endpoint architecture

Guest-local ClickFix is now proven end to end: a trusted click in guest Edge
wrote the exact corrected harmless command to the same guest clipboard, Win+R
pasted and submitted it once, and PowerShell printed `Hello World`. Default
Defender allowed the command and MDE later raised one High `Suspicious command
in RunMRU registry` alert. The detailed run and cleanup boundary are recorded in
`docs/proven-capabilities.md`.

AVD is learner transport into the desktop, not part of the fictional endpoint
story. Endpoint background can combine orchestration outside the guest with
genuine interaction in an authenticated user's session. The recent
user-context proofs used the AVD remote canvas as that external control channel;
their attribution came from the real user session, not from pretending the AVD
transport itself was incident activity.

Do not assume that a permanent in-guest AP2 agent is desirable. Its services,
files, processes, credentials, logs, or control traffic could contaminate the
incident evidence that AP2 is trying to create and observe. Machine-level Azure
Run Command already serves cases where user attribution is irrelevant.

A useful future product-design question is how to make deterministic,
user-context endpoint manipulation repeatable without contaminating the
evidence. That is an open design question, not a decision to install a guest
agent and not authorization for new product work or experiments.

## Defender boundary

Defender is authentically on Endpoint Plan 2: more than nine hours after the
switch, authenticated portal reads returned `overrideMdeFlavor: P2`, the
Licenses page selected Plan 2, and classic machine-group `GET` requests returned
`200` with an empty set. The temporary CBA repair used for that confirmation was
fully removed and the original mapping restored.

Classic Device groups nevertheless remained unavailable or inconsistent beyond
Microsoft's documented six-hour window: Endpoint settings omitted the entry,
the documented direct page redirected home, and adjacent portal surfaces still
showed mixed provisioning state. Do not rely on narrow device-group scoping
unless a later Microsoft-side change or support decision establishes that the
surface is usable.

## Worker-goal lesson

Give workers a simple outcome, why it matters, the relevant context, a stopping
point, and real boundaries. Prefer that over blanket read-only restrictions or
procedural command lists. Workers should use ordinary judgment and repair
harmless prerequisites within the authorized outcome, while preserving the
actual tenant, credential, external-system, exposure, and spending boundaries.

For deeper orientation, read `AGENTS.md`, `docs/product-direction.md`,
`docs/product-model.md`, and only the relevant parts of
`docs/proven-capabilities.md`. Then recover live work from the Durable
Coordinator rather than from this snapshot or historical worker threads.
