# SPA CBA browser test

This test signs `admin@corywest.onmicrosoft.com` in and out through the real
local SPA and Microsoft Entra. It uses Playwright's direct client-certificate
support with a new disposable Chromium context on every run. It does not use a
human browser profile, save browser authentication state, revoke sessions, or
print certificate material.

## Run it

Install Chromium once:

```sh
npx playwright install chromium
```

Keep the PFX and its passphrase outside the repository. The PFX must have mode
`0600`; its directory should have mode `0700`.

```sh
export AP2_CBA_PFX_PATH=/absolute/private/path/operator-certificate.pfx
export AP2_CBA_PFX_PASSPHRASE="$(</absolute/private/path/pfx-passphrase.txt)"
npm run test:e2e:cba
```

The command starts Vite at <http://localhost:5173/>, clicks the product sign-in
button, completes Entra CBA, verifies the Student UPN and tenant ID, clicks the
product sign-out button, completes Microsoft's logout redirect, and verifies
the signed-out state again after a reload. Browser output defaults to
`/tmp/ap2-playwright-cba` and contains no reusable storage state.

## Student tenant state

The test is fixed to Student tenant
`92563293-315c-4b6c-9b90-bcb47ee8c970`. Before changing tenant state, use an
isolated Azure CLI configuration and the repository tenant guard.

The proof performed on July 22, 2026 owns only these two Student values:

- User `5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f` has certificate user ID
  `X509:<SKI>071DD0F2CBBB9DAA284A6D810AE13A8E961F0786`.
- That user is a direct member of group
  `2fb79180-fa16-44ce-8e74-272ab056ffa6`.

The test did not create or change the existing trusted CA, X.509 authentication
policy, target group, or development-operator user. Do not remove those shared
objects when cleaning up this proof. The local certificate and rollback record
are outside Git under `~/.config/after-party/ap2-cba-e2e/`; the certificate
expires August 5, 2026.

## Remove the owned state

Set `AZURE_CONFIG_DIR` to an isolated Student context, then verify the exact
tenant before either change:

```sh
export AZURE_CONFIG_DIR=/absolute/path/to/student-azure-config
scripts/az-in-tenant.sh 92563293-315c-4b6c-9b90-bcb47ee8c970 -- account show
```

First read the user's authorization information. Continue only if the listed
value is the single owned certificate user ID above, then clear it:

```sh
scripts/az-in-tenant.sh 92563293-315c-4b6c-9b90-bcb47ee8c970 -- rest \
  --method get \
  --url 'https://graph.microsoft.com/v1.0/users/5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f?$select=authorizationInfo' \
  --headers ConsistencyLevel=eventual

scripts/az-in-tenant.sh 92563293-315c-4b6c-9b90-bcb47ee8c970 -- rest \
  --method patch \
  --url 'https://graph.microsoft.com/v1.0/users/5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f' \
  --headers Content-Type=application/json \
  --body '{"authorizationInfo":{"certificateUserIds":[]}}'
```

Read the exact direct group membership before removing it. Continue only if the
response identifies the same operator user, then remove that membership:

```sh
scripts/az-in-tenant.sh 92563293-315c-4b6c-9b90-bcb47ee8c970 -- rest \
  --method get \
  --url 'https://graph.microsoft.com/v1.0/groups/2fb79180-fa16-44ce-8e74-272ab056ffa6/members/5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f?$select=id,userPrincipalName'

scripts/az-in-tenant.sh 92563293-315c-4b6c-9b90-bcb47ee8c970 -- rest \
  --method delete \
  --url 'https://graph.microsoft.com/v1.0/groups/2fb79180-fa16-44ce-8e74-272ab056ffa6/members/5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f/$ref'
```

Repeat the authorization-information read above; `certificateUserIds` should be
empty. Then verify that the operator query below returns an empty array:

```sh
scripts/az-in-tenant.sh 92563293-315c-4b6c-9b90-bcb47ee8c970 -- rest \
  --method get \
  --url 'https://graph.microsoft.com/v1.0/groups/2fb79180-fa16-44ce-8e74-272ab056ffa6/members?$select=id' \
  --query "value[?id=='5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f']"
```

If other certificate user IDs or an unexpected membership appear, stop rather
than overwriting them. After both read-backs confirm removal, delete only the
dedicated local `ap2-cba-e2e` directory. Leave the shared CA directory intact.
