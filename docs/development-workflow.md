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

## Capability loop

1. Run the smallest read-only query that can disprove readiness.
2. Use one bounded direct canary to learn the real Microsoft request, response,
   normalization, propagation, and cleanup behavior.
3. Freeze the mutation-critical contract. Do not validate presentation details
   that do not control safe follow-up or cleanup.
4. Implement the fixed operation with deterministic tests, typechecking, a
   production build, and the existing container fixture where relevant.
5. Run a local browser product path only when it is likely to find a product
   integration issue. Time-box harness repair; a harness exists to save time.
6. After review, build the API image and Pages preview concurrently when they
   are independent.
7. Invoke the hosted mutation once, verify its meaningful outcome, clean up,
   and merge the reviewed tree.

Avoid a second direct mutation merely because a response was normalized
differently than expected. Reconcile the existing artifact read-only, improve
the validator, and use the retained or marked artifact for cleanup.

## Authentication feedback loops

The backend currently keeps access tokens in an isolated in-process cache per
simulated-user provider and exact scope. This makes a second action using the
same actor and scope fast while the replica remains alive. The cache does not
survive a restart, does not request `offline_access` or retain a refresh token,
and does not help the operator's SPA browser session. The current manual
implementation also decodes Graph access-token claims; a replacement should
treat Graph tokens as opaque and verify the fixed identity through Graph
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

An in-memory `@azure/msal-node` cache can improve this without durable token
storage. Keep one public-client application and cache per simulated user,
request `offline_access`, attempt `acquireTokenSilent` first, and fall back to
the existing fresh Playwright CBA interaction only when Microsoft requires it.
After the first CBA interaction for a user, newly requested consented Graph
scopes can usually be obtained silently. This can collapse several first-use
scope-specific browser flows into one user login on a warm API or reused local
process.

That cache still does not survive a fresh container or revision and does not
remove the operator browser's CBA interaction. Do not persist it during Pass 3:
a persistent cache contains durable refresh-token credentials and needs
encryption, locking, eviction, revocation handling, and cross-replica design.

## Eventual consistency

Treat documented `201`, `202`, and `204` responses as Microsoft acceptance when
that is the contract. Do not turn every accepted operation into a synchronous
recipient-observation loop.

When a later mutation depends on convergence, use deliberate stages:

1. perform one mutation;
2. return or work on something independent;
3. later perform one exact observation;
4. perform the dependent mutation only after that observation;
5. later confirm cleanup.

During Pass 3, workers can schedule those stages as separate actions. A future
lab product should store them in a durable lab run and let a background worker
resume them. The SPA can display recorded status or offer an explicit refresh;
it does not need a tight polling loop.

## Mutation-safety review

A focused mutation-safety review checks that:

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
