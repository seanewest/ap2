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
scope and operator object ID. App-only access requires the exact application
role, `idtyp: app`, and development automation client ID. Both paths also
require the Student tenant, configured issuer and audience, and a verified
Microsoft signature.

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

The existing CBA browser harness proves SPA sign-in and sign-out but does not
request or expose an API access token. The delegated `access_as_user` proof is
therefore intentionally deferred to the integration/join goal so it can use the
concurrently developed SPA API button without duplicating that UI work.
