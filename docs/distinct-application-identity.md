# Distinct application identity contract

`verifyDistinctApplicationIdentityReadiness` is a pure, network-free boundary
for scenarios that claim a simulated attacker or evidence-producing
application was observed by a separate detector application. It performs no
token acquisition, role assignment, scenario operation, or evidence query.

The canonical manifest declares the producer, detector, independent recovery
owner, same-tenant Microsoft Graph audience, exact least application-role IDs,
marker operation, detector observation operation, and maximum evidence window.
The scenario planner carries that declaration and requires a later exact
runtime identity binding. Readiness then binds the plan digest to exact
application, service-principal, tenant, role-assignment, fresh-token, marker,
window, evidence-origin, and recovery-principal values. A ready result retains
those exact runtime values so the credential and query path can compare them
before authentication. That protected object must not be logged, persisted, or
returned. `summarizeDistinctApplicationIdentityReadiness` is the safe
categorical-and-digest projection for display or durable output.

Readiness fails closed when:

- an application or service-principal identity is reused or cross-bound;
- either installation or an exact role assignment is missing;
- the effective role set is broader than the declared least set or overlaps
  the other role in a way that defeats attribution;
- a cached or mismatched token substitutes for a fresh post-assignment token;
- tenant, audience, marker, window, operation owner, or recovery ownership
  differs;
- the detector generated the evidence it claims to observe; or
- the platform record does not correlate the exact producer application and
  service principal inside the marker-bound time window.

The OAuth application reconnaissance scenario is the representative migrated
lane. Its four producer reads require `GroupMember.Read.All`, `Mail.Read`, and
`Files.Read.All`; its sign-in observer requires `AuditLog.Read.All`. A verified
binding digest is required before an observed detector result can promote the
receipt's independent-observation claims. This proves one producer token event,
not attribution of each individual Graph GET.
The role identifiers follow the official
[Microsoft Graph permissions reference](https://learn.microsoft.com/graph/permissions-reference),
and the detector remains bounded to the documented
[service-principal sign-in list](https://learn.microsoft.com/graph/api/signin-list?view=graph-rest-beta).

The direct observer CLI additionally requires a mode-owner-only readiness JSON
path in `AP2_APPLICATION_IDENTITY_READINESS_PATH` and the independently
compiled expected plan digest in `AP2_SCENARIO_PLAN_DIGEST_SHA256`. It validates
both, then compares the exact producer application/service principal, detector
application and tenant, marker, and requested observation window before
constructing the detector credential or acquiring a token.

The prior lab run established this correlation with distinct fixed
applications. Current read-only tenant metadata is intentionally not embedded
in the repository: the retained diagnostic producer remains broader than the
least set, while the fixed observer no longer has the temporary audit role.
Consequently, the current tenant is not ready under this contract, and no
role change is implied or authorized.
