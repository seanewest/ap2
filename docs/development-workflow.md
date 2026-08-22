# Pass 3 exploration workflow

This workflow is for learning what AP2 can do without turning each experiment
into production architecture or a learner-lab design exercise.

## 1. State the question

Begin with one plain-language question and the observation that would answer it.
Examples:

- Can AP2 create a calendar invitation as Homer and later remove it?
- Can a controlled Teams call create authentic history for Cory?
- Can a SharePoint change be attributed to the intended application?
- Can several proven capabilities be staged together without conflicting?

Also state why the answer matters now. Do not begin by designing a general
contract.

## 2. Choose the actor that matters

Use the identity whose behavior the experiment is meant to represent:

- a simulated user's delegated identity when Microsoft should record that user;
- the API or infrastructure identity for backend actions;
- the broad Pass 3 development identity for quick platform discovery when actor
  attribution is not the question;
- a distinct observer only when independent observation is part of the claim.

Do not create additional identities merely to make a diagram more complete.

### Keep development authority stable

Pass 3 intentionally avoids permission churn. Reuse existing standing Dev-app,
API-managed-identity, directory-role, Defender, Azure, and simulated-user
authority when it supports the question. If ordinary sandbox exploration exposes
a missing supported permission or role, workers may grant that authority through
the existing administrative path and should normally leave it standing for later
work. Do not repeatedly revoke, narrow, and regrant permissions between
experiments to simulate production hardening.

A newly granted permission is not temporary merely because one worker first
needed it. Remove it only when Sean explicitly made it temporary, when the grant
is itself scenario state or changes the actor semantics under test, or when
retaining it would cross a real architectural or recovery boundary. Microsoft
splits broad authority across Graph application permissions, directory roles,
Azure RBAC, Defender permissions, delegated user roles, and other surfaces; there
is no single universal development permission to grant once.

Stable broad development authority does not permit secrets in the SPA. Public
browser code may contain public IDs but never client secrets, certificates,
private keys, refresh tokens, or privileged backend credentials.

Browser, CBA, and Dev/Graph experiments use the Proxmox-side owner-only
[durable runtime](durable-runtime.md). WSL is not a normal execution dependency.

## 3. Run the smallest decisive test

Start with a read that can disprove readiness cheaply. Then perform one live
canary that answers the real question.

Capture enough identity, marker, time, target, and returned identifiers to find
the result and avoid an accidental duplicate. Do not seal every response into a
new schema when ordinary notes or existing code are enough.

An ambiguous non-idempotent mutation should be inspected before another attempt.
Read-only and idempotent failures can use proportionate retries or another
available transport.

## 4. Observe what actually happened

Separate:

- what the platform accepted;
- what later became visible;
- what can reasonably be inferred;
- what remains unknown.

Microsoft acceptance is sometimes the result being tested. Do not automatically
turn every accepted operation into a long synchronous observation loop.

Use the real product path when that path is itself part of the question. Use a
direct development command when the question is the Microsoft capability rather
than the current UI or deployment.

## 5. Treat propagation as staged work

Creation, permission changes, audit records, endpoint enrollment, cleanup, and
absence confirmation may converge slowly.

Record the submitted action and the later observation needed. Continue other
useful work or stop the active turn. Return at a sensible time rather than
holding a tight loop.

A staged sequence may be:

```text
act → record accepted state → wait → observe → investigate or compose → clean up
    → wait → confirm ready enough
```

Do not build a general background orchestration system until repeated scenarios
show what state actually needs to be durable.

## 6. Clean up in proportion to the next need

The tenant is a dedicated sandbox. Cleanup should make the next experiment
practical and prevent unintended continuing effects. It does not need to erase
all history or restore an exact snapshot.

Prefer broad cleanup boundaries when the platform provides them, such as an
Azure resource group. Microsoft 365 cleanup may be workload-specific and
piece-by-piece. Keep simulated users and useful baseline configuration unless a
reset experiment is specifically testing their recreation.

If cleanup is not needed to answer the current question, it may be recorded as a
later operational dependency rather than silently expanding the goal.

## 7. Decide what deserves to remain

After the result is known, choose the smallest useful artifact:

- a note in `docs/proven-capabilities.md` for a live fact and its limitation;
- temporary code that can be removed after preserving the result;
- reusable code and tests when another scenario or product path needs it;
- a focused technical document when the contract cannot be understood from code
  and tests.

Do not automatically add a manifest, planner, verifier, receipt adapter, hosted
route, UI surface, deployment artifact, telemetry layer, or hardening pass.
Those additions need a concrete current use.

## 8. Compose scenarios only when useful

A scenario combines already useful capabilities to create incident-like state.
Scenario exploration should answer technical questions about ordering, identity,
evidence, coexistence, and reset.

Do not introduce teaching objectives, learner-role rules, assessment, or a
publishable-lab contract unless Sean explicitly changes the goal to lab design.

## Worker ownership

One goal-owned worker can own a coherent exploration question through research,
live proof, ordinary correction, and the minimum useful record. The worker may
use subagents, but it remains responsible for the original question.

Return to the Coordinator when the question is answered, a real human or
strategy decision is needed, a boundary must change, or an external dependency
prevents useful progress.

A test failure, local tooling problem, read timeout, or correctable review note
is not automatically a new project phase.

## Review and hardening

Use focused independent review only when an action could cross the sandbox
boundary, cause a meaningful unintended external effect, lose administrative
recovery, exceed spending, or make the claimed result untrustworthy.

Production reliability, least privilege, multi-replica coordination, generalized
persistence, exhaustive validation, and defensive edge hardening are later work
unless they directly block the current experiment.

## Stop

Stop when the stated question is answered well enough for the next decision.
Do not continue merely because adjacent work exists, a worker is idle, or the
prototype could be made more complete.
