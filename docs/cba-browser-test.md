# SPA CBA browser test

This test signs the dedicated Student operator
`after-party-operator@corywest.onmicrosoft.com` in and out through the real
local SPA and Microsoft Entra. It uses Playwright's direct client-certificate
support with a new disposable Chromium context on every run. It does not use a
human browser profile, save browser authentication state, revoke sessions, or
print certificate material.

## Run it

Install Chromium once:

```sh
npx playwright install chromium
```

Use the existing operator PFX under
`~/.config/after-party/spa-operator/`. Keep the directory at mode `0700` and
private files at mode `0600`.

Start the local API at `http://127.0.0.1:3000` with the real Student
issuer/JWKS, Product audience, and
`CORS_ALLOWED_ORIGIN=http://localhost:5173` described in
[API identity](api-identity.md). Then run:

```sh
export AP2_CBA_PFX_PATH=/home/west/.config/after-party/spa-operator/operator-certificate.pfx
export AP2_CBA_PFX_PASSPHRASE="$(</home/west/.config/after-party/spa-operator/operator-pfx-passphrase.txt)"
export VITE_API_BASE_URL=http://127.0.0.1:3000
npm run test:e2e:cba
```

The command starts Vite at <http://localhost:5173/>, clicks the product sign-in
button, completes Entra CBA, verifies the dedicated operator UPN and Student
tenant ID, clicks the API-access button, and verifies the delegated caller
without exposing its token. It then clicks the product sign-out button,
completes Microsoft's logout redirect, and verifies the signed-out state again
after a reload. Browser output defaults to `/tmp/ap2-playwright-cba` and
contains no reusable storage state.

## Required Student state

The test is fixed to Student tenant
`92563293-315c-4b6c-9b90-bcb47ee8c970` and expects:

- operator object `ba97e987-da4c-43e1-ab79-3daa8014440e` to be enabled;
- certificate user ID
  `X509:<SKI>FD87C3B1D81FB19B0CD9136268D41A2B079EA729`;
- direct membership in CBA group
  `2fb79180-fa16-44ce-8e74-272ab056ffa6`;
- the Global Administrator role;
- usage location `US`;
- licenses `SPB` (`cbdc14ab-d96c-4c30-b9f4-6ada7cdc1d46`) and
  `DEFENDER_AND_PURVIEW_SUITES_FOR_BUSINESS_PREMIUM_NEW`
  (`3c9fe495-e4c9-4e70-9669-6d0a4347aa38`).

The test does not provision or modify this state. Before any separate tenant
maintenance, use an isolated Azure CLI configuration with
`scripts/az-in-tenant.sh` and verify the immutable Student tenant ID.

## Ownership and cleanup

The dedicated operator, certificate, CBA group, trusted CA, CBA policy, and
Global Administrator assignment predate this browser test and are shared AP2
development identity state. Do not delete them as test cleanup. The correction
that introduced this guide added the operator's usage location and two licenses
and removed the temporary CBA mapping and group membership previously added to
the human admin.

The browser test owns no temporary tenant object and performs no tenant write.
Each Playwright context is disposed after the run. Remove only its external
output directory if retained; keep the operator certificate material outside
Git while this test remains in use.
