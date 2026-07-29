# Operator panel failure-isolation audit

This Linux-headless audit covers the authenticated operator SPA without tenant,
cloud, workload, or Windows-host activity. The SPA uses DOM panel factories,
not a component framework.

## Measured boundary

A synchronous exception from one panel factory previously prevented the
signed-in shell from replacing its loading state. The affected panel therefore
blocked every unrelated panel and Sign out. One shared render boundary now
replaces only that panel with a fixed accessible `unavailable` region. It does
not render raw exception detail, add a retry action, or start any retry or
additional request. Initial-construction fault tests separately prove zero
product API requests before an explicit operator action.

The product-path test injects one deterministic synchronous exception into
each existing panel factory in a fresh 320-pixel, reduced-motion browser
context:

| Panel | Existing non-render failure behavior |
| --- | --- |
| Recent operations | Typed fixed loading/empty/unauthorized/error states; malformed snapshot is contained by the render boundary |
| Capability building blocks | Malformed registry fails locally without partial cards |
| Scenario plan preview | Malformed registry, typed refusal/size/error, and stale completion stay local |
| Scenario batch feasibility | Malformed registry, typed refusal/size/error, and stale completion stay local |
| Receipt verification | Pre-auth validation, typed refusal/size/error, duplicate blocking, and stale completion stay local |
| AVD rehearsal verification | Pre-auth validation, typed refusal/size/error, duplicate blocking, and stale completion stay local |
| Private-document rehearsal verification | Pre-auth validation, typed refusal/size/error, duplicate blocking, and stale completion stay local |
| Help-desk rehearsal verification | Pre-auth validation, typed refusal/size/error, duplicate blocking, and stale completion stay local |
| Teams rehearsal verification | Pre-auth validation, typed refusal/size/error, duplicate blocking, and stale completion stay local |
| Application-reconnaissance rehearsal verification | Pre-auth validation, typed refusal/size/error, duplicate blocking, and stale completion stay local |
| Scenario surface matrix | Invalid injected inventory fails closed without partial rows |

For every injected render fault, unrelated navigation and panels remain
visible, Sign out remains keyboard-focusable, the page stays within the narrow
viewport, reduced-motion styles remain effective, and no product API request
occurs before an explicit operator action. Existing focused tests separately
prove fixed rejection, oversized/refused response, duplicate, and stale-async
behavior. No automatic retry, polling, persistence, or execution path is
introduced.
