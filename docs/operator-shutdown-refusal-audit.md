# Operator shutdown-refusal audit

This Linux-headless audit covers the authenticated operator SPA and its
browser-safe HTTP client. It does not change API lifecycle behavior or exercise
any tenant, workload, external service, or Windows-host path.

PR #128 established one exact admission refusal after draining begins:
HTTP `503` with the fixed JSON object `{"error":"server_shutting_down"}`.
Before this correction, every scenario client mapped that response to its
general safe failure, and shared read clients discarded the shutdown category.

The shared client boundary now recognizes only the exact one-field response
after its single bounded body read. Expanded, malformed, wrong-status, or
wrong-content responses remain general safe failures. Authentication,
authorization, local validation, request/response size, typed verifier refusal,
network, and general failure categories remain distinct.

The fixed operator message says the API is shutting down, the request was not
accepted, and any later attempt must be manual after readiness is restored.
The message contains no raw response body and introduces no retry, polling, or
background request.

## Measured coverage

- Shared authenticated reads and fixed proof methods all use the same
  `ApiAccessError` shutdown category.
- Scenario plan, batch feasibility, receipt verification, and AVD,
  private-document, help-desk, Teams, and application-reconnaissance rehearsal
  clients, plus the Purview audit-boundary rehearsal client, expose the same
  typed shutdown category.
- Every corresponding manual panel maps that category to the fixed accessible
  message, restores its enabled state, and focuses its live result region.
- API access, rehearsal status, and recent operations distinguish shutdown;
  recent operations replace any prior snapshot rather than preserving stale
  success.
- Generic email, OneDrive, calendar, contact, and fixed-proof panels restore
  their exact prior state because the shutdown boundary proves non-admission.
  Their action remains available for a later manual attempt; ambiguous and
  general failures retain the existing uncertain or terminal behavior.
- The signed local browser path sends exactly one deliberate request per
  surface, observes no pre-action or follow-up request, preserves narrow and
  reduced-motion behavior, and never renders the raw server error token.

Existing construction-fault isolation, stale-completion suppression, and
manual-only submission tests remain authoritative. Shutdown handling does not
alter server dispatch, API routes, client request bodies, execution capability,
persistence, scheduling, or external-call behavior.
