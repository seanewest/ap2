# AP2

AP2 is a minimal TypeScript SPA that signs operators in with their Microsoft
work or school account. It uses the multitenant `After Party Exploratory`
application registration and requests identity scopes only.

## Architecture

See [Identities](docs/identities.md).

## Developer bootstrap

See the [Microsoft Entra developer bootstrap guide](gh-docs/developer-bootstrap.md)
to create or tear down the minimal multi-tenant application registration from
Azure Cloud Shell.

## Develop

Install dependencies and start Vite:

```sh
npm install
npm run dev
```

Open <http://localhost:5173/>. The exact local URL must be registered as an SPA
redirect URI in Microsoft Entra.

Run the deterministic checks without Azure:

```sh
npm test
npm run typecheck
npm run build
```

## Student-owned API

The API is a separate, framework-free Node/TypeScript process. `GET /health` is
public for container health checks. `GET /api/whoami` first verifies an RS256
Bearer token's signature, issuer, audience, and lifetime, then permits only:

- delegated tokens from Student operator object ID
  `ba97e987-da4c-43e1-ab79-3daa8014440e`; or
- app-only tokens from development automation client ID
  `7eb78f18-b49c-495c-a571-af03f06b58a9`.

Both must be issued in immutable Student tenant
`92563293-315c-4b6c-9b90-bcb47ee8c970`. Delegated and app-only claim shapes are
kept distinct. Azure and Microsoft Graph calls are not implemented; future
use-case-specific calls belong behind `api/cloud-operations.ts`.

Build and start the API locally with explicit verification configuration:

```sh
npm run build:api
AUTH_ISSUER='https://issuer.example/tenant/v2.0' \
AUTH_AUDIENCE='api://audience' \
AUTH_JWKS_URL='https://issuer.example/discovery/v2.0/keys' \
npm run api
```

Startup fails if any of those three settings is absent. The allowed operator
and automation IDs can be overridden with `AUTH_OPERATOR_OBJECT_ID` and
`AUTH_AUTOMATION_CLIENT_ID`; the Student tenant cannot be overridden. Plain
HTTP JWKS is disabled unless `AUTH_ALLOW_INSECURE_JWKS=true`, which exists only
for isolated local tests.

`npm test` includes claims-policy unit tests and signed-JWT tests through a real
local HTTP server. With rootless Podman available, the following also builds and
starts the image, waits for container health, sends signed delegated and app-only
Bearer requests, checks a rejection, and verifies SIGTERM shutdown:

```sh
npm run test:container
```

The real browser CBA check is intentionally separate because it signs the
Student operator in and out against Microsoft Entra. See the
[CBA browser test guide](docs/cba-browser-test.md).

Run an Azure CLI command only after asserting the exact tenant selected by the
CLI and its access token:

```sh
scripts/az-in-tenant.sh '<tenant-id>' -- account show
```

Summarize a local Codex transcript, including wall and Codex-reported active
time, slow tool calls, likely stalls, token use, and automatic goal retries.
Select the worker explicitly when several agents share `CODEX_HOME`:

```sh
npm run report:codex -- --name Lebron
npm run report:codex -- --name Durant
```

You can also select with `--thread-id` or `--path`. For valid JSON with no npm
banner, use npm's silent mode or invoke the script directly:

```sh
npm run --silent report:codex -- --name Lebron --json
node scripts/codex-session-report.ts --name Lebron --json
```

See the [Codex session report guide](docs/codex-session-report.md) for timing
semantics and selection fallbacks.

## Deploy

GitHub Actions builds the Vite `dist/` output and deploys it to
<https://seanewest.github.io/ap2/>. The public client ID lives in
`src/auth/config.ts`; it is configuration, not a secret.
