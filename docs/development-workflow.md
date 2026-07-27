# Pass 3 development workflow

This is the shared workflow for exploring Microsoft 365 and Azure capabilities
without turning each experiment into production architecture.

Risk, retry, review, and persistent-authorization decisions follow the
canonical [R0–R3 policy](../AGENTS.md#disposable-lab-authority).

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

## Capability loop

1. Run the smallest read-only query that can disprove readiness.
2. Use the smallest bounded direct canary set needed to learn the real
   Microsoft request, response, normalization, propagation, and cleanup
   behavior.
3. Record only the mutation-critical contract required by its risk level. Do
   not validate presentation details that do not control safe follow-up or
   cleanup.
4. Implement the fixed operation with deterministic tests, typechecking, a
   production build, and the existing container fixture where relevant.
5. Run a local browser product path only when it is likely to find a product
   integration issue. Time-box harness repair; a harness exists to save time.
6. When the risk level requires review, perform only that focused review. Build
   the API image and Pages preview concurrently when they are independent.
7. Invoke the hosted path inside its authorized run, verify its meaningful
   outcome, clean up, and merge the reviewed tree. Reconcile ambiguous
   non-idempotent mutations before any new request; idempotent R1 work may
   continue inside the same run identity.

Do not repeat a non-idempotent direct mutation merely because a response was
normalized differently than expected. Reconcile the existing artifact
read-only, improve the validator, and use the retained or marked artifact for
cleanup.

## Authentication feedback loops

The backend keeps one in-memory MSAL public-client application and cache per
simulated-user provider. It attempts `acquireTokenSilent` for the fixed Student
authority, account, and requested scopes before falling back to the existing
Playwright CBA interaction when Microsoft requires interaction. The
interactive request includes `offline_access`, Graph tokens remain opaque, and
every token result is followed by exact fixed-user verification through Graph
`/me`.

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

Treat documented `201`, `202`, and `204` responses as Microsoft acceptance when
that is the contract. Do not turn every accepted operation into a synchronous
recipient-observation loop.

Tenant setup and Microsoft propagation may take more than an hour. A lab may
also include clearly identified manual steps. Neither case should be disguised
as a short synchronous operation or treated as automatic failure.

When a later mutation depends on convergence, use deliberate stages:

1. perform the bounded mutation stage;
2. return or work on something independent;
3. later perform the bounded exact observations allowed by R0;
4. perform the dependent mutation only after that observation;
5. later confirm cleanup.

During Pass 3, workers can schedule those stages as separate actions. A future
lab product may store readiness state in a durable lab run and use background
checks to resume after long propagation. The SPA can display recorded status,
manual instructions, or an explicit refresh; it does not need a tight polling
loop. This repository does not yet provide that durable orchestration.

## Focused R2 mutation-safety review

The one focused review required for R2 checks that:

- tenant, actor, fixed target, and permissions are correct;
- an ambiguous response cannot cause an automatic duplicate mutation;
- exact markers, retained IDs, and eTags prevent cleanup of the wrong object;
- duplicate, paginated, malformed, or mismatched reconciliation stops before a
  mutation;
- partial success has a safe recovery or cleanup path;
- tokens, credentials, raw upstream bodies, and private artifact IDs do not
  escape;
- unrelated product operations and authentication behavior remain unchanged.

It is not a request to harden every defensive edge in controlled development
tooling.
