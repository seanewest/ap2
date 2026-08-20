# AP2

AP2 is an exploratory project for learning what can be created, changed,
observed, detected, controlled, and reset across Microsoft 365, Azure,
endpoints, SaaS applications, and related security systems.

The long-term direction is a realistic cybersecurity learning environment where
incident-like state can be staged across those systems and investigated with the
real administrative and security products. AP2 is **not at the lab-authoring
stage yet**. Current work is primarily capability exploration and early scenario
composition: first learn which technical building blocks are reliable, then
combine them into useful incident backgrounds, and only later build teaching and
assessment around them.

The current SPA is an internal operator console and capability notebook. It
shows runnable capabilities, other things AP2 has proven, and a few proven
scenario compositions. It is not the eventual learner interface or a prototype
of the final product.

## Start here

The repository has many focused technical notes. These are the useful orientation
points:

- [Product direction](docs/product-direction.md) — what AP2 is trying to learn
  now and how that differs from the eventual product.
- [Capability, scenario, and lab vocabulary](docs/product-model.md) — the core
  distinctions used throughout the project.
- [Proven capabilities](docs/proven-capabilities.md) — the factual inventory of
  live evidence and known limitations.
- [Exploration workflow](docs/development-workflow.md) — the short loop used to
  investigate a new capability without prematurely building a framework.
- [Identities](docs/identities.md) — the Product/Student tenant and simulated-user
  identity model.
- [AGENTS.md](AGENTS.md) — durable project guidance for agents working in this
  repository.
- [Strategy snapshot](STRATEGY-SNAPSHOT.md) — a point-in-time handoff for the
  next AP2 Strategist. It is not normal Coordinator orientation; live execution
  state comes from the Durable Coordinator.

The AP2-specific role supplements are
[chatgpt-strategy.md](chatgpt-strategy.md) and
[coordinator-strategy.md](coordinator-strategy.md). The generic role and workflow
contract lives in `seanewest/agent-tools`.

## Development

The SPA and API are TypeScript/Node projects. Install dependencies and start the
local SPA with:

```sh
npm install
npm run dev
```

Open <http://localhost:5173/>. The local URL must be registered as an SPA
redirect URI in Microsoft Entra for authenticated actions.

The checked-in development Student tenant is represented by the non-secret
[`installations/development.json`](installations/development.json) installation
record. To build or run against another Student tenant, copy
[`installations/student.example.json`](installations/student.example.json), fill
in that installation's tenant, actor, Azure, and SPA/API values, and set
`AP2_INSTALLATION_CONFIG` to its path. The same selected record drives the SPA
build/dev proxy, API identity bindings, and Azure target. The hosted SPA then
uses the selected installation's
[tenant-side API discovery record](docs/tenant-installation-discovery.md) after
sign-in instead of relying on the API URL compiled into a prior browser visit.
Credentials, certificate paths, and passphrases remain runtime secrets and are
not part of either non-secret record. This does not provision an API or broader
Student infrastructure.

Run the deterministic checks with:

```sh
npm test
npm run typecheck
npm run build
```

Build the API with:

```sh
npm run build:api
```

The API has its own authentication and runtime configuration. See the
[hosted API contracts](docs/api-identity.md) rather than copying tenant IDs,
client IDs, or secrets from examples in source or old transcripts.

When rootless Podman is available, AP2 can also exercise the production-shaped
container path:

```sh
npm run test:container
```

That test builds and starts the API image, exercises the authenticated boundary,
checks container health, launches the bundled headless browser path, and verifies
clean shutdown. Browser CBA tests that interact with Microsoft are intentionally
separate; see the [CBA browser test guide](docs/cba-browser-test.md).

For Azure CLI work, use the tenant guard rather than assuming the current CLI
context:

```sh
scripts/az-in-tenant.sh '<tenant-id>' -- account show
```

The Microsoft Entra control-plane bootstrap is documented separately in
[gh-docs/developer-bootstrap.md](gh-docs/developer-bootstrap.md).

## Repository principles

AP2 is deliberately optimized for exploration speed rather than production
architecture. A capability does not automatically need a generalized manifest,
planner, learner contract, hosted route, or reset framework. Prefer the smallest
live experiment that answers the current question, record what was actually
proven, and keep reusable code only when another capability or product path needs
it.

The Product and Student tenant control plane is retained infrastructure; staged
mail, files, meetings, SaaS activity, endpoint state, temporary grants, and other
experiment-specific artifacts are disposable or resettable. Secrets and
privileged credentials stay out of the public SPA and repository.

## Deployment

GitHub Actions builds the Vite SPA and deploys it to
<https://seanewest.github.io/ap2/>. The hosted API is deployed separately; its
current identity and deployment contract is documented in
[docs/api-identity.md](docs/api-identity.md).
