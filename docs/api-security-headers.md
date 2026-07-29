# API response security headers

The production API emits one fixed, credential-free response boundary. Every
JSON success or refusal, including shutdown admission refusal, has:

- `Cache-Control: no-store`
- `Content-Type: application/json; charset=utf-8`
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

Successful protected preflights are body-free `204` responses with the same
fixed security headers except JSON `Content-Type`. They expose only methods
and request headers derived from the exact route registry.

The API never emits `Access-Control-Allow-Credentials` or a wildcard origin.
If an `Origin` header is present, it must exactly match the configured HTTP(S)
origin before authentication or body reading. Accepted-origin responses use
that exact `Access-Control-Allow-Origin` value plus `Vary: Origin`.
Unconfigured origins receive a fixed `403` without CORS permission headers.

Host and forwarding headers do not participate in routing, origin selection,
or response construction. The listener uses only the request target and the
configured CORS origin, so an untrusted `Host`, `X-Forwarded-Host`, or
`X-Forwarded-Proto` value is neither reflected nor trusted.

`npm run test:api-security-headers-container` builds the real production image
and verifies health, bounded preflight acceptance/refusal, pre-auth origin
refusal, authentication refusal, pure success, body validation and size
refusal, a bounded mutation-route failure, not-found, and host/proxy handling.
`npm run test:api-lifecycle-container` separately proves the same fixed headers
on an in-flight pure response and a mutation refused after shutdown begins,
while preserving shutdown-before-origin/auth/body semantics.
