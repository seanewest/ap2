# SPA CBA browser test

This test signs the dedicated Student operator
`after-party-operator@corywest.onmicrosoft.com` in and out through the real
local SPA and Microsoft Entra. It uses Playwright's direct client-certificate
support with a new disposable Chromium context on every run. It does not use a
human browser profile, save browser authentication state, revoke sessions, or
print certificate material.

## Run it

> **Current identity state:** on 2026-08-20 AP2 replaced the expired dedicated
> operator leaf with a standing certificate under the existing trusted Lisa CBA
> issuer. The replacement preserves the operator key and SKI mapping and is valid
> through 2027-08-12. Do not weaken CBA or reuse another identity if this standing
> credential later needs renewal.

Install Chromium once:

```sh
npx playwright install chromium
```

Use the operator PFX in the durable AP2 runtime. Keep the runtime directories at
mode `0700` and private files at mode `0600`.

Start the local API at `http://127.0.0.1:3000` with the real Student
issuer/JWKS, Product audience, and
`CORS_ALLOWED_ORIGIN=http://localhost:5173` described in
[Hosted API contracts](api-identity.md). Then run:

```sh
test -n "$AP2_RUNTIME_ROOT"
export AP2_CBA_PFX_PATH="$AP2_RUNTIME_ROOT/secrets/cba/operator/operator-certificate.pfx"
export AP2_CBA_PFX_PASSPHRASE_FILE="$AP2_RUNTIME_ROOT/secrets/cba/operator/operator-pfx-passphrase.txt"
export VITE_API_BASE_URL=http://127.0.0.1:3000
npm run test:e2e:cba
```

The command starts Vite at <http://localhost:5173/>, clicks the product sign-in
button, completes Entra CBA, verifies the dedicated operator UPN and the enabled
operator actions without invoking them, then clicks the product sign-out button.
It completes Microsoft's logout redirect and verifies the signed-out state and
disabled actions again after a reload. The explicit local API override is a
development path and does not prove tenant-side discovery. Browser output
defaults to `/tmp/ap2-playwright-cba` and contains no reusable storage state.

For a hosted non-mutating preflight, point both targets explicitly:

```sh
export AP2_E2E_APP_URL=https://seanewest.github.io/ap2/
export AP2_E2E_API_BASE_URL=https://ca-ap2-api.happycliff-97dcb6b8.eastus.azurecontainerapps.io
export AP2_PLAYWRIGHT_OUTPUT_DIR=/tmp/ap2-playwright-cba
npm run test:e2e:cba
```

The hosted preflight proves tenant-side discovery. It requires one successful
Graph read of the selected installation record and one successful `/api/whoami`
read at the discovered URL before enabling actions. It reloads the signed-in
page and requires both reads to succeed again, then signs out. It records no
request headers, bodies, tokens, full URLs, or raw responses.

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
- delegated Microsoft Graph `User.Read` consent for the existing AP2 service
  principal; and
- the selected installation's `com.seanewest.ap2.installation` organization
  extension described in [Tenant API discovery](tenant-installation-discovery.md).

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
