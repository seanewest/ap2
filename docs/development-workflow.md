# Pass 3 development workflow

This is the shared workflow for exploring Microsoft 365 and Azure capabilities
without turning each experiment into production architecture.

## Choose the actor first

| Intended behavior | Actor |
| --- | --- |
| Activity should appear as Cory, Homer, or another simulated user | That user's delegated token through the shared c91 CBA client |
| Backend or infrastructure operation is not meant to appear as a user | The API runtime managed identity |
| Fast readiness, response-shape discovery, or bounded diagnostics | The Pass 3 Dev app |
| Operator authorization and human product path | The SPA and AP2 API |

The Dev app is deliberately broad and does not exist in the future student
product. A successful Dev canary proves the Microsoft operation and response
shape. It does not prove that the deployed API has the correct identity,
permission, configuration, or route.

When a scenario claims an independent detection or audit observation, the
observer must authenticate as a different application identity from the
workload actor. Authentication transport remains a separate field: two
application-only sessions are not independent when they resolve to the same
client. Environment-validation canaries may reuse a diagnostic identity only
when they make no learner-scenario or independent-detector claim.

For Azure or another platform, apply the same principle: use the identity that
matches the behavior being tested. A development identity can prove a platform
contract, but it does not prove that the eventual product identity or learner
path works.

## Separate scenario roles

Choosing the Microsoft workload actor is necessary but not sufficient for a
learner scenario. Every source-backed staged scenario must explicitly assign:

- **evidence producer/orchestrator** — the agent, app, instructor, simulated
  attacker, or lab harness that stages the evidence;
- **workload actor** — the Microsoft identity, service principal, or device
  that performs the underlying operation;
- **learner/observer** — the person expected to receive, inspect, and interpret
  the evidence; and
- **detector/observer** — required when the scenario claims an independent
  audit or detection result, and distinct from the workload actor; and
- **responder** — the optional actor authorized to remediate after
  interpretation.

The scenario manifest fails closed when the evidence producer and learner
resolve to the same actor. A scenario may make them the same only by declaring
an explicit `self-triggered` exercise with a non-empty rationale explaining why
the learner action is intentionally the event under investigation.
An `independent` detection claim additionally requires an explicit detector
role and fails closed when that role resolves to the workload actor.

Actor identity and authentication transport are separate fields. For example,
Kobe is the workload actor while a licensed Teams client session is the
transport. Changing from a browser to an app-only or delegated token does not
silently change who Microsoft records as the actor.

The existing fixed proof operations and bounded direct canaries remain
backward-compatible capability rehearsals. They validate environment and
operation contracts and are not implicitly learner scenarios. A rehearsal
becomes a learner scenario only when it is deliberately migrated into the
validated scenario registry and its learner-facing evidence plan is explicit.
The [scenario manifest contract](scenario-manifest.md) is the executable
authoring boundary for those migrated scenarios. It binds setup, evidence,
learner interpretation, response, cleanup, retention, permissions, expiry, and
cost; runtime validation must pass before the UI consumes a manifest.
The [local scenario planner](scenario-planner.md) can compile that contract
into a deterministic sanitized readiness plan. Planning remains local and does
not prove or execute external activity.
The
[canonical scenario surface inventory](scenario-surface-inventory.md) shows
which validated scenarios also have repository adapters, rehearsal
composition, authenticated API/client support, and operator surfaces. It is a
source-coverage view, not readiness or live proof.

## Work inside the lab boundary

The tenant and explicitly selected subscriptions are dedicated lab
environments. Post-construction lab state is disposable.

Before acting, establish the correct:

- tenant, subscription, account, or target environment;
- workload or infrastructure actor;
- intended external effect;
- administrative recovery path;
- spending boundary.

Within that boundary, read-only retries, local tooling fixes, approved
transport changes, and marked reversible experiments are ordinary work.

Do not automatically repeat an ambiguous non-idempotent mutation. Reconcile it
read-only first.

Use one focused mutation-safety review when the action is broadly destructive,
difficult to recover from, or changes a real boundary. Routine bounded canaries
do not need a review chain.

## Capability loop

1. Run the smallest read-only query that can disprove readiness.
2. Use one bounded direct canary to learn the real platform request, response,
   normalization, propagation, and cleanup behavior.
3. Freeze only the mutation-critical contract. Do not validate presentation
   details that do not control safe follow-up or cleanup.
4. Implement the fixed operation with deterministic tests, typechecking, a
   production build, and the existing container fixture where relevant.
5. When the capability has a human-facing path, operate the local product in a
   browser before another hosted push or tenant mutation when that can reveal
   product integration, authentication, or communication problems.
6. Build the API image and Pages preview concurrently when they are independent.
7. Invoke the hosted mutation inside the established authority, verify its
   meaningful outcome, clean up, and merge the reviewed tree.

Avoid a second direct mutation merely because a response was normalized
differently than expected. Reconcile the existing artifact read-only, improve
the validator, and use the retained or marked artifact for cleanup.

A local browser harness exists to shorten the feedback loop. Time-box harness
repair and stop improving it when the harness costs more time than the product
risk it removes.

## Worker ownership of the capability loop

One peer worker should normally own a capability through the full loop rather
than returning to the Captain after every numbered stage.

The owning worker may use subagents for parallel research, implementation,
testing, or internal review. It should correct ordinary local defects and
continue under the same goal.

Return to the Captain only when:

- the capability is complete;
- a genuine human action or material decision is required;
- the established safety boundary must change;
- the result changes another active goal; or
- an external blocker prevents useful progress.

A platform propagation wait is an intermediate state inside the owning goal,
not necessarily the end of the worker's assignment.

## Authentication feedback loops

The backend keeps one in-memory MSAL public-client application and cache per
simulated-user provider. It attempts `acquireTokenSilent` for the fixed Student
authority, account, and requested scopes before falling back to the existing
Playwright CBA interaction when Microsoft requires interaction. The interactive
request includes `offline_access`, Graph tokens remain opaque, and every token
result is followed by exact fixed-user verification through Graph `/me`.

Within one controlled QA batch:

- reuse the warm API replica and its access-token cache;
- reuse a verified agent-only browser profile or session when authentication
  itself is not being tested;
- use a fresh browser context for sign-in/sign-out tests, account-isolation
  tests, or evidence that specifically requires fresh authentication;
- keep every human and simulated-user certificate and token cache isolated;
- never replace a delegated-user proof with the Dev app when the simulated
  actor is part of the behavior.

The cache does not survive a fresh container or revision and does not remove
the operator browser's CBA interaction. Do not persist it during Pass 3: a
persistent cache contains durable refresh-token credentials and needs
encryption, locking, eviction, revocation handling, and cross-replica design.

## Eventual consistency

Treat documented `201`, `202`, and `204` responses as platform acceptance when
that is the contract. Do not turn every accepted operation into a synchronous
recipient-observation loop.

Tenant setup and platform propagation may take more than an hour. A lab may
also include clearly identified manual steps. Neither case should be disguised
as a short synchronous operation or treated as automatic failure.

When a later mutation depends on convergence, use deliberate stages:

1. perform one mutation;
2. continue other useful work or wait without holding a synchronous loop;
3. later perform one exact observation;
4. perform the dependent mutation only after that observation;
5. later confirm cleanup.

The owning peer worker should normally retain the goal across these stages. It
does not need to report every stage to the Captain.

During Pass 3, workers can schedule those stages as separate actions within
their owned goal. A future lab product may store readiness state in a durable
lab run and use background checks to resume after long propagation. The SPA can
display recorded status, manual instructions, or an explicit refresh; it does
not need a tight polling loop. This repository does not yet provide that
durable product orchestration.

## Focused mutation-safety review

Use a focused review when the operation is broadly destructive, difficult to
recover from, or capable of crossing a real lab boundary.

The review checks that:

- the target environment, actor, fixed target, and permissions are correct;
- an ambiguous response cannot cause an automatic duplicate mutation;
- markers, retained IDs, or equivalent ownership evidence prevent cleanup of
  the wrong object;
- malformed, mismatched, or incomplete reconciliation stops before a dangerous
  mutation;
- partial success has an acceptable recovery or cleanup path;
- credentials, tokens, private evidence, and raw sensitive responses do not
  escape;
- external effects, public exposure, administrative recovery, and spending
  remain inside the established boundary;
- unrelated product operations and authentication behavior remain unchanged.

It is not a request to harden every defensive edge in controlled development
tooling. Correctable local issues remain with the owning worker and do not
begin another review cycle.
