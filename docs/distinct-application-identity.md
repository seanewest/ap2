# Distinct application identity validation

`verifyDistinctApplicationIdentityReadiness` is a pure, network-free check for
the direct OAuth reconnaissance observer. It verifies that the application
performing the Microsoft Graph reads and the application observing the
resulting sign-in are distinct. It performs no token acquisition, role
assignment, Microsoft operation, or evidence query.

The check binds exact application, service-principal, tenant, role-assignment,
fresh-token, marker, window, evidence-origin, and recovery-principal values to
the fixed OAuth reconnaissance boundary. A ready result retains those runtime
values so the credential and query path can compare them before authentication.
That protected object must not be logged, persisted, or returned.
`summarizeDistinctApplicationIdentityReadiness` is the safe categorical and
digest-only projection for durable output.

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

The OAuth application reconnaissance operation's four producer reads require
`GroupMember.Read.All`, `Mail.Read`, and `Files.Read.All`; its sign-in observer
requires `AuditLog.Read.All`. A verified binding is required before the direct
observer runs. The observation proves one producer token event, not attribution
of each individual Graph GET.
The role identifiers follow the official
[Microsoft Graph permissions reference](https://learn.microsoft.com/graph/permissions-reference),
and the detector remains bounded to the documented
[service-principal sign-in list](https://learn.microsoft.com/graph/api/signin-list?view=graph-rest-beta).

The direct observer CLI requires a mode-owner-only readiness JSON path in
`AP2_APPLICATION_IDENTITY_READINESS_PATH`. It validates that file, then compares
the exact producer application and service principal, detector application and
tenant, marker, and requested observation window before constructing the
detector credential or acquiring a token.

The prior proven run established this correlation with distinct fixed
applications. Current tenant-specific metadata is intentionally not embedded
in the repository. The retained diagnostic producer is broader than this fixed
operation boundary, while the fixed observer no longer has the temporary audit
role. Consequently, the current tenant is not ready for this observation, and
no role change is implied or authorized.
