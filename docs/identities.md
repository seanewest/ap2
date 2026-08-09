# Identities

The identities and API shown below form the AP2 control plane for the current
architecture. It spans the Product tenant's multitenant app/API registration and
the Student tenant's enterprise application, development and runtime identities,
permissions, simulated-user identities, licensing, and authentication setup.
Preserve both sides during routine capability and scenario cleanup unless an
explicit infrastructure goal changes or replaces them.

A simulated-user identity is baseline infrastructure; that user's mailbox,
calendar, files, Teams activity, scenario-specific memberships, and temporary
permissions are not. Existing broad development permissions are also baseline
for Pass 3 and should not be churned between experiments. A grant is ordinary
cleanup only when it was explicitly introduced as temporary for the current
experiment.

## Identity diagram

```text
After Party product tenant
│
├── After Party multitenant app registration
└── No backend operations occur here


Student tenant
│
├── After Party service principal
│   └── local Enterprise Application for the central app
│
├── Development automation app identity
│   ├── used by agents, TypeScript scripts, and az
│   ├── authenticates with an app certificate
│   ├── calls API with an app-only token
│   └── has broad development permissions
│
├── Student-owned Container App / API
│   ├── delegated callers
│   │   ├── human product operator: admin@corywest.onmicrosoft.com
│   │   └── CBA browser-test operator: after-party-operator@corywest.onmicrosoft.com
│   ├── app-only caller: development automation app
│   │
│   ├── Runtime managed identity
│   │   └── calls Azure as the runtime
│   │
│   └── Shared simulated-user client
│       ├── Homer: sends email and owns the fixed OneDrive proof
│       ├── Cory: creates and cancels the fixed calendar rehearsal
│       ├── signs each simulated user in with their own CBA certificate
│       │   in a fresh headless browser context
│       └── keeps delegated tokens only in isolated process-memory caches
```

## Architectural credential boundary

The SPA is a public client. It may contain public identifiers and request
delegated access, but it must never contain client secrets, certificates, private
keys, refresh tokens, or backend credentials. Development certificates and
privileged tokens remain outside the repository and browser and are used only by
the appropriate backend or local development process.

## Backend identities

Prefer delegated simulated-user identities for user-like actions, such as
sending email or Teams messages.

Use Entra user certificate-based auth (CBA) when fresh login is required, with
a separate token cache per simulated user. Treat the live membership of the
`AP2 Simulated User CBA` Entra group as the authority for which simulated users
currently have CBA enabled; do not infer current membership from a static list
in this repository.

Use the runtime managed identity for other backend operations.

## Testing identities

Prefer fast tests that minimize human intervention.

Use the development automation app for backend and infrastructure tests.

Use the dedicated CBA-enabled test operator for SPA browser tests. The human
admin remains the real product operator.

The [SPA CBA browser test](cba-browser-test.md) uses a fresh Playwright context
instead of a human browser profile or shared browser session.

Test simulated-user login locally in a container that resembles the deployed
backend browser environment.
