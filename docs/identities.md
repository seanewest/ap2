# Identities

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
│   └── Homer simulated-user identity
│       ├── signs in with CBA in a fresh headless browser context
│       └── calls Microsoft Graph with a delegated token
```

## Backend identities

Prefer delegated simulated-user identities for user-like actions, such as
sending email or Teams messages.

Use Entra user certificate-based auth (CBA) when fresh login is required, with
a separate token cache per simulated user.

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
