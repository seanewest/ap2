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
│   ├── only called by the student operator and development automation app
│   │
│   └── Runtime managed identity
│       ├── calls Azure as the runtime
│       └── calls Microsoft Graph as the runtime
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

Use a CBA-enabled student operator for SPA tests, reusing saved browser sessions
when possible.

Test simulated-user login locally in a container that resembles the deployed
backend browser environment.
