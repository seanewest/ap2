# AP2

AP2 is a minimal TypeScript SPA that signs operators in with their Microsoft
work or school account. It uses the multitenant `After Party Exploratory`
application registration and requests identity scopes only.

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

## Deploy

GitHub Actions builds the Vite `dist/` output and deploys it to
<https://seanewest.github.io/ap2/>. The public client ID lives in
`src/auth/config.ts`; it is configuration, not a secret.
