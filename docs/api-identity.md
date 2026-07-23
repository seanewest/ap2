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
HTTP(S) origin. The protected endpoint preflights accept only that origin,
`GET`, and the `Authorization` header. Requests without an `Origin` header
remain available to the app-only proof and other non-browser clients.

## Rehearsal status

`GET /api/rehearsal-status` uses the same exact delegated and app-only caller
policy. After authorization, the production API uses its runtime managed
identity to read only Container App `ca-ap2-api` in resource group
`rg-ap2-rehearsal` and Student subscription
`6d8ebd0e-017f-401e-950d-e5a35de93dc6`. It returns only the app name, region,
running status, and active revision. Deployment must grant that managed
identity read access to the target; this repository does not assign Azure
roles.

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
