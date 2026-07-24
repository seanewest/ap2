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
`POST`, the OneDrive proof allows `POST` and `DELETE`, and both calendar routes
allow `POST`. The contact proof allows `POST` and `DELETE`. Requests without an
`Origin` header remain available to app-only and other non-browser clients.

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

`POST` and `DELETE /api/onedrive-share-proof` use the same exact delegated and
app-only caller policy. The two methods are deliberately separate human
actions:

- `POST` refuses an existing `/AP2-OneDrive-share-proof.txt`, creates that
  fixed file with the exact rehearsal sentence, and grants only
  `marge.simpson@corywest.onmicrosoft.com` read access. Sign-in is required and
  no invitation is sent. Configured success requires exactly one no-link
  permission with role `read` and `grantedToV2.user.id` equal to Marge's
  immutable object ID. If Graph's `200` response does not contain that shape,
  AP2 performs one owner-side permissions read and accepts only one matching
  effective permission. It never repeats the invite.
- `DELETE` resolves the fixed item and its permissions, revokes only the exact
  Marge read permission, then re-resolves and validates the 58-byte file before
  deleting once with its current eTag. OneDrive moves the item to the recycle
  bin. If a prior revoke succeeded but its response was lost, a later cleanup
  can safely continue when no Marge permission remains.

The API never retries an upload-session creation, upload, invite, permission
revoke, or file delete. “Configured” means Microsoft Graph confirmed the exact
Marge read permission; it does not claim that Marge opened the file or that
OneDrive has exposed every inheritance detail.

After an uncertain mutation response, the UI disables sharing and offers only
cleanup. Its stage is stored per signed-in account in browser storage so a
reload does not blindly repeat a mutation. After configured success, a human
can sign in to OneDrive as Marge in a separate browser or profile, open
**Shared > Shared with you**, find `AP2-OneDrive-share-proof.txt`, then return
to the SPA and click Cleanup.

Homer uses delegated `Files.ReadWrite` through the same shared public client
and exact callback used by the email operation. The OneDrive runtime requires
only Homer's existing certificate settings. Its in-memory token cache and
disposable Playwright context are not shared with a browser profile. The
repository does not embed or persist the certificate.
The operation returns only its safe stage, fixed path, identity, and access
summary; it never returns tokens, credentials, item IDs, eTags, upload URLs, or
raw Graph responses.

One process-local boundary serializes share and cleanup across operator and
Dev-app callers. Concurrent requests receive
`proof_operation_busy`. This is rehearsal-only coordination: it has no durable
lock, database, queue, or cross-replica protection. The live proof therefore
requires Container Apps `maxReplicas=1`.

## One calendar rehearsal

`POST /api/calendar-meeting` and
`POST /api/calendar-meeting/cancel` use the same exact delegated and app-only
caller policy. They are separate explicit human actions. Signing in does not
call either route.

Create signs in only `cory@corywest.onmicrosoft.com` through the existing
shared simulated-user client and requests delegated `User.Read` and
`Calendars.ReadWrite`. It submits one Graph create request with the fixed
transaction ID `cfc3b7d3-2ab8-4ec0-b93a-9ea24fcb5ba4` and:

- subject `AP2 Pass 3 calendar rehearsal — no action required`
- plain body `Harmless AP2 calendar rehearsal. No action or response is
  required. The organizer will cancel it after observation.`
- July 24, 2026, 19:00–19:15 UTC (3:00–3:15 PM EDT)
- required attendees only `kobe@corywest.onmicrosoft.com` and
  `marge.simpson@corywest.onmicrosoft.com`
- free availability, no reminder or response request, no new-time proposals,
  low importance, normal sensitivity, and no online meeting, location,
  recurrence, attachment, or link
- one hidden string marker with ID
  `String {c352ae90-352e-4c3f-8f7c-ab63d2ca32cc} Name AP2RunId` and value
  `ap2-calendar-20260724-002`

Only a strict `201` response matching the fixed meeting becomes `Configured`.
For Graph's documented HTML normalization, the response must retain the exact
full fixed `bodyPreview` and report HTML body content; AP2 does not interpret
Graph's generated HTML markup.
That means Graph accepted the meeting and invitations; it does not claim
attendee receipt or response. The validated event ID remains private in the
operation's process memory.

Cancel normally uses that retained validated ID. If process state was lost or
Create returned an uncertain result, the explicit Cancel action first filters
Cory's events server-side for the exact marker ID and value. It requests at
most two matches and proceeds only when the unpaginated response contains
exactly one non-cancelled event with the exact marker and full immutable run
contract, including the new transaction ID. It then submits one Graph
`POST /me/events/{id}/cancel` request with the fixed harmless cleanup comment.
Zero, duplicate, mismatched, cancelled, malformed, or paginated recovery
results cause no mutation.
Only `202` becomes `Cancellation accepted`. Neither mutation is retried.
Before either API mutation, the SPA stores an `uncertain` stage for the signed-in
operator. Every stage after Create starts blocks a second create; uncertain and
configured stages offer the separate explicit Cancel action. Once cancellation
starts, a separate cancellation-uncertain stage blocks another attempt if its
response is not confirmed. Signing in never performs recovery.
The per-account browser cache key includes `ap2-calendar-20260724-002`, so the
previous cancelled rehearsal does not block this fresh run. No migration or
automatic lookup runs.

A process-local busy/completed boundary serializes create and cancel across
operator and Dev-app callers. It has no database, queue, or durable lock; the
narrow read-only lookup is used only by an explicit Cancel after process state
loss. The live proof therefore requires `maxReplicas=1`.

Production enables the calendar operation only when the existing Homer/shared
client configuration and all three Cory settings are present:

- `CORY_CBA_OBJECT_ID`: Cory's immutable Student user object ID
- `CORY_CBA_PFX_PATH`: absolute path to the externally mounted Cory PFX
- `CORY_CBA_PFX_PASSPHRASE`: PFX passphrase supplied as a secret

The shared public client must already have delegated
`Calendars.ReadWrite` consent. Cory must already have working Student CBA.
Certificates and tokens remain outside repository and response output.

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

## One contact rehearsal

`POST` and `DELETE /api/contact-proof` are separate explicit actions. They use
Cory's existing CBA settings and delegated `Contacts.ReadWrite`; signing in
does not call either route.

Both actions first filter Cory's contacts by the exact hidden `AP2RunId` marker
with value `ap2-contact-20260724-001`. Create accepts one exact existing contact
or submits one containing only `AP2 Kobe Contact Proof`, the names `AP2` and
`Kobe Contact Proof`, and `kobe@corywest.onmicrosoft.com`. Remove deletes one
exact marker and full-contact match; absence is already removed. Duplicate,
paginated, malformed, or mismatched results cause no mutation. Graph mutations
are never retried. Browser state only explains an explicit attempt and blocks
duplicate clicks; it is not API correctness state.

## One disabled Inbox-rule rehearsal

`POST` and `DELETE /api/inbox-rule-proof` are separate explicit actions. They
use Cory's existing CBA settings and delegated `MailboxSettings.ReadWrite`;
signing in does not call either route or read mail.

Each action lists a bounded set of Cory's Inbox rules once. Create accepts one
exact existing disabled rule or creates `AP2 harmless disabled rule —
ap2-rule-20260725-001` with only the never-match subject condition and
mark-as-read action. Remove deletes that one exact rule; absence is already
removed. A safe sequence is selected from the bounded list. Duplicate,
paginated, malformed, or mismatched state causes no mutation. Graph mutations
are never retried, and omission of `stopProcessingRules` is accepted as its
requested false default. Browser state records an uncertain attempt before
mutation; exact-name Graph reconciliation owns correctness.

## One Outlook category rehearsal

`POST` and `DELETE /api/category-proof` are separate explicit actions. They
reuse Cory's existing CBA provider and delegated `MailboxSettings.ReadWrite`;
signing in does not list or change categories.

Each action performs one bounded, unfiltered list of Cory's Outlook master
categories. Create accepts one exact existing `AP2 Category Proof
[ap2-category-20260725-001]` with color `preset7`, or creates it once. Remove
deletes one exact match by its retained or reconciled ID; absence is already
removed. Duplicate, paginated, malformed, or mismatched results cause no
mutation. Graph mutations are never retried. Browser state records an uncertain
attempt before mutation, while the exact-name Graph reconciliation owns
correctness.

## One SharePoint file rehearsal

`POST` and `DELETE /api/sharepoint-file-proof` are separate explicit actions.
The existing caller policy still admits only an authorized operator or the Dev
app. The operation itself uses the API system managed identity, its existing
Graph `Sites.ReadWrite.All` application permission, and the fixed SharePoint
Documents drive. Signing in does not inspect or change SharePoint.

Create requires the exact root path to be absent, then makes one small-file PUT
with conflict behavior `fail`. The fixed file is `AP2 SharePoint File Proof
[ap2-sharepoint-file-20260725-001].txt` and contains exactly 78 ASCII bytes.
Remove re-resolves that exact marked path, validates its file and drive identity,
and makes one ID-based DELETE with the current eTag in `If-Match`. The filename
owns this rehearsal artifact even if its content changes later; `If-Match`
prevents deleting across a concurrent change. A successful delete moves the
file to the SharePoint recycle bin. The experiment never lists, shares, retries,
polls, or permanently purges content. Browser state records an uncertain attempt
before mutation, while exact-path Graph reconciliation owns correctness.

## One unsent-draft rehearsal

`POST` and `DELETE /api/draft-proof` are separate explicit actions. They reuse
Cory's existing CBA settings and delegated `Mail.ReadWrite`; signing in does not
inspect or change Cory's mailbox.

Each action performs one bounded exact-marker query in Cory's Drafts folder.
Create accepts one exact existing draft or creates one unsent message with the
fixed harmless subject and body, only Kobe and Marge in To, empty Cc/Bcc, low
importance, and no attachments. Remove deletes one exact marker and full-draft
match; absence is already removed. Duplicate, paginated, malformed, sent, or
mismatched results cause no mutation. Graph mutations are never retried. The
feature has no send, reply, or forward route, and it never reads a recipient
mailbox. Browser state records an uncertain attempt before mutation; the marker
query owns correctness.
