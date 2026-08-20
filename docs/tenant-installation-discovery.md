# Tenant API discovery

The hosted AP2 SPA discovers the selected Student installation's API after
Microsoft sign-in. It does not keep an API mapping in browser storage and does
not call a central AP2 mapping service.

Each installed Student tenant stores one Microsoft Graph open extension on its
`organization` object:

```text
com.seanewest.ap2.installation
```

The non-secret record has three AP2 fields:

```json
{
  "schemaVersion": 1,
  "installationId": "the selected W64 installation ID",
  "apiBaseUrl": "https://the-student-api.example"
}
```

Microsoft documents `organization` as a supported open-extension resource. A
signed-in work or school user can read a known organization extension with the
delegated `User.Read` permission. Creating or changing the record is an
installation-time administrative operation that requires
`Organization.ReadWrite.All`; the SPA never requests that permission. See
[Get open extension](https://learn.microsoft.com/graph/api/opentypeextension-get)
and
[Create open extension](https://learn.microsoft.com/graph/api/opentypeextension-post-opentypeextension).

On every signed-in startup, including a reload or a fresh browser, the SPA:

1. acquires a Microsoft Graph `User.Read` token for the signed-in account;
2. reads the named extension directly from that account's tenant;
3. requires the tenant and `installationId` to match the selected W64
   installation and accepts only a credential-free HTTPS API URL;
4. creates its API client from that discovered URL; and
5. calls the existing read-only `/api/whoami` route and requires the API to
   confirm the same delegated tenant before enabling actions.

An absent, malformed, cross-installation, or unreachable record leaves the user
signed in but keeps every AP2 action disabled. Tokens and raw tenant responses
remain in browser memory and are not displayed or persisted.

## Current limitation

This is API-location discovery, not tenant onboarding or infrastructure
provisioning. W64's selected installation record still supplies the tenant,
actors, API authorization boundary, and Azure deployment metadata. The open
extension only lets that selected installation rediscover its existing API URL
across visits, browsers, or devices. Moving an installation to another API
requires an authorized update of this one tenant record; changing the other
installation facts still uses the normal W64 installation configuration.
