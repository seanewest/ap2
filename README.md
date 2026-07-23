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
