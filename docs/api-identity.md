# API identity

The exploratory API uses the existing Product-owned multitenant After Party
registration as both client and API resource.

- Product tenant: `b224230b-e540-4726-bae7-00b92b1c1cbc`
- Student tenant: `92563293-315c-4b6c-9b90-bcb47ee8c970`
- API/client ID: `c91c7af4-b1b8-4730-a240-4a1c6137ab15`
- Application ID URI: `api://c91c7af4-b1b8-4730-a240-4a1c6137ab15`
- Delegated scope: `access_as_user`
- Application role: `access_as_application`

The resource is requested with the Application ID URI. Its v2 access tokens use
the API client ID as the `aud` claim.

The API accepts delegated access only when the signed token contains the exact
scope and one of these Student user object IDs:

- human product operator `admin@corywest.onmicrosoft.com`:
  `5ce59710-7ea3-448c-bd7b-8e8d2b75bb1f`
- dedicated CBA browser-test operator
  `after-party-operator@corywest.onmicrosoft.com`:
  `ba97e987-da4c-43e1-ab79-3daa8014440e`

App-only access requires the exact application role, `idtyp: app`, and
development automation client ID
`7eb78f18-b49c-495c-a571-af03f06b58a9`. Both paths also require the Student
tenant, configured issuer and audience, and a verified Microsoft signature.
The API uses `jose` remote JWKS resolution and JWT verification with only
RS256 accepted.

`AUTH_DELEGATED_USER_OBJECT_IDS` can replace the delegated allowlist with a
comma-separated list. `AUTH_AUTOMATION_CLIENT_ID` can replace the app-only
client ID. The Student tenant cannot be overridden.

Browser access is disabled unless `CORS_ALLOWED_ORIGIN` names one exact
HTTP(S) origin. Protected preflights accept only that origin and the
`Authorization` header. The read endpoints allow `GET`, simulated email allows
`POST`, and the OneDrive proof allows `GET`, `POST`, and `DELETE`. Requests
without an `Origin` header remain available to the app-only proof and other
non-browser clients.

## Rehearsal status

`GET /api/rehearsal-status` uses the same exact delegated and app-only caller
policy. After authorization, the production API uses its runtime managed
identity to read only Container App `ca-ap2-api` in resource group
`rg-ap2-rehearsal` and Student subscription
`6d8ebd0e-017f-401e-950d-e5a35de93dc6`. It returns only the app name, region,
running status, and latest ready revision. Deployment must grant that managed
identity read access to the target; this repository does not assign Azure
roles.

## One internal email

`POST /api/simulated-email` uses the same exact delegated and app-only caller
policy. The authorized caller triggers one fixed operation; the API then uses
Homer's delegated CBA identity to make one Graph `sendMail` attempt:

- sender: `homer.simpson@corywest.onmicrosoft.com`
- recipient: `marge.simpson@corywest.onmicrosoft.com`
- subject: `Dinner tonight`

The API does not retry Graph. A `202` means Microsoft accepted the request, not
that delivery is confirmed. Tokens are cached only in process memory, no
refresh token is requested, and every browser acquisition uses a fresh
non-persistent context.

Production enables Homer's operation only when the shared client and both
Homer certificate settings are present:

- `SIMULATED_USER_CLIENT_ID`: UUID of the existing shared multitenant public
  client
- `HOMER_CBA_PFX_PATH`: absolute path to the externally mounted Homer PFX
- `HOMER_CBA_PFX_PASSPHRASE`: PFX passphrase supplied as a secret

The public client must already allow the exact
`http://localhost/ap2-simulated-user-callback` redirect and have consent for
delegated `User.Read` and `Mail.Send`. Homer must already have working Student
CBA. The container needs outbound access to Microsoft login, certificate
authentication, and Graph endpoints. This application work does not create
consent, identity, certificate, or tenant configuration.

The disposable rehearsal assumes one controlled click against one API replica.
It does not claim exactly-once delivery across callers, replicas, or restarts,
and intentionally adds no job or durable idempotency system.

## OneDrive share proof

`POST`, `GET`, and `DELETE /api/onedrive-share-proof` use the same exact
delegated and app-only caller policy. The three methods are deliberately
separate human actions:

- `POST` refuses an existing `/AP2-OneDrive-share-proof.txt`, creates that
  fixed file with the exact rehearsal sentence, and grants only
  `marge.simpson@corywest.onmicrosoft.com` read access. Sign-in is required and
  no invitation is sent.
- `GET` has Homer resolve and validate the fixed item, then signs in as Marge
  and reads only that exact drive/item content path. Marge succeeds only when
  the bytes match exactly; her access does not depend on a second metadata
  response.
- `DELETE` resolves the fixed item and its permissions, revokes only the exact
  direct Marge read permission, then re-resolves and validates the 58-byte file
  before deleting once with its current eTag. OneDrive moves the item to the
  recycle bin. If a prior revoke succeeded but its response was lost, a later
  cleanup can safely continue when no Marge permission remains.

The API never retries an upload-session creation, upload, invite, permission
revoke, or file delete.
Immediately after a confirmed share, Marge's read-only content request may
retry only safely formed Microsoft Graph `403`, `404`, `429`, or `503` errors
within one hard 55-second deadline. A deadline returns confirmation pending;
the SPA never polls and a later Verify is an explicit human action.

Microsoft Graph may return an HTTPS preauthenticated `Location` for file
content. AP2 consumes it only from the authenticated Graph content response,
rejects non-HTTPS URLs and URLs containing credentials, and never forwards the
Graph or AP2 Authorization header to that download URL. Pass 3 deliberately
does not guess at a hostname allowlist because Microsoft controls the
preauthenticated download host.

After an uncertain mutation response, the UI disables sharing and offers only
explicit verification or cleanup. Its stage is stored per signed-in account in
browser storage so a reload does not blindly repeat a mutation.

Homer uses delegated `Files.ReadWrite`; Marge uses delegated `Files.Read`.
The shared public client must already have those grants and its existing
`http://localhost/ap2-simulated-user-callback` redirect. In addition to Homer's
settings, verification is enabled only when all three Marge settings are
present:

- `MARGE_CBA_OBJECT_ID`: Marge's immutable Student object ID
- `MARGE_CBA_PFX_PATH`: absolute path to the externally mounted Marge PFX
- `MARGE_CBA_PFX_PASSPHRASE`: PFX passphrase supplied as a secret

Each simulated user has a separate in-memory token cache and disposable
Playwright context. Partial per-user certificate configuration fails startup.
Deployment verification must prove both mounted PFX files and passphrases work;
the repository does not embed or persist either certificate.
The operation returns only its safe stage, fixed path, identity, and access
summary; it never returns tokens, credentials, item IDs, eTags, upload URLs, or
raw Graph responses.

One process-local boundary serializes share, verification, and cleanup across
operator and Dev-app callers. Concurrent requests receive
`proof_operation_busy`. This is rehearsal-only coordination: it has no durable
lock, database, queue, or cross-replica protection. The live proof therefore
requires Container Apps `maxReplicas=1`.

## Identity setup and rollback

Use separate `AZURE_CONFIG_DIR` directories for Product and Student. The setup
tool refuses the normal `~/.azure` directory, asserts both the selected account
tenant and Microsoft Graph token tenant before writes, discovers objects by
immutable application IDs, and refuses duplicates.

```sh
AZURE_CONFIG_DIR='<isolated-product-context>' \
  node scripts/configure-api-identity.ts product-apply '<private-artifact-dir>'

AZURE_CONFIG_DIR='<isolated-student-context>' \
AP2_AUTOMATION_CERTIFICATE_PATH='<certificate-pem-outside-git>' \
  node scripts/configure-api-identity.ts student-apply '<private-artifact-dir>'
```

The mode-0600 artifacts contain the exact pre-change Product properties, the
pre-change Student grants, and the IDs and Graph paths needed to reverse created
Student grants. Roll back Student first by applying the DELETE or rollback PATCH
entries in `student-changes.json`. Then disable the added Product scope and app
role, and PATCH the Product application with `product-before.json`'s exact
`rollbackPatch`. Use the matching asserted tenant context for every step.

Read-only verification is available with `verify-product` and
`verify-student`.

## Real app-only proof

Use a new empty Azure CLI context. The script signs in with the existing
automation certificate, obtains a token for the API's `.default` scope, checks
only the necessary non-secret claims, and sends the bearer token through the
rootless Podman API configured with the Student Microsoft issuer and JWKS.

```sh
AZURE_CONFIG_DIR='<empty-isolated-context>' \
AP2_AUTOMATION_CERTIFICATE_PATH='<certificate-pem-outside-git>' \
  node scripts/test-real-api-token.ts
```

The CBA browser harness proves the delegated path against a rootless Podman API
configured with the Student Microsoft issuer and JWKS, the Product app
audience, and `CORS_ALLOWED_ORIGIN=http://localhost:5173`. It clicks the SPA
sign-in, API-access, and sign-out buttons and exposes no token.

Agents can call the deployed rehearsal-status operation with the existing Dev
app certificate. The command obtains a token in memory and prints only the safe
status response:

```sh
AP2_API_BASE_URL='https://ca-ap2-api.happycliff-97dcb6b8.eastus.azurecontainerapps.io' \
AP2_AUTOMATION_CERTIFICATE_PATH='<certificate-pem-outside-git>' \
  npm run check:rehearsal-status
```
