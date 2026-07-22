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

Run an Azure CLI command only after asserting the exact tenant selected by the
CLI and its access token:

```sh
scripts/az-in-tenant.sh '<tenant-id>' -- account show
```

Summarize the most recently modified local Codex transcript, including elapsed
turn time, measured tool time, token use, and automatic goal retries:

```sh
npm run report:codex
```

Pass a transcript path to report on a specific session. For clean
machine-readable output, invoke the script directly:

```sh
node scripts/codex-session-report.ts '<session.jsonl>' --json
```

## Deploy

GitHub Actions builds the Vite `dist/` output and deploys it to
<https://seanewest.github.io/ap2/>. The public client ID lives in
`src/auth/config.ts`; it is configuration, not a secret.
