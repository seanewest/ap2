# Purview operation-audit contract

AP2 treats Microsoft Purview operation evidence as a separate capability from
Microsoft Entra service-principal sign-in evidence. A sign-in can prove that an
application authenticated; it cannot prove that application performed a
particular SharePoint or directory operation.

## Supported surface

The supported AP2 surface is Microsoft Graph v1 Purview Audit Search:

- `POST /security/auditLog/queries`
- `GET /security/auditLog/queries/{id}`
- `GET /security/auditLog/queries/{id}/records`

The API supports application-only access. For a SharePoint-only detector, the
narrowest application permission is
`AuditLogsQuery-SharePoint.Read.All`
(`91c64a47-a524-4fce-9bf3-3d569a344ecf`); it requires administrator consent.
`AuditLogsQuery.Read.All` reaches every supported workload and is not the
least-privileged product grant.

Application-only Graph authorization has no signed-in user to place in a
Purview role group. The supported contract is the consented Graph application
permission. Purview's Audit Reader and Audit Manager role groups govern people
using the portal, export, cmdlet, or delegated path; the least-privileged
delegated alternative combines the delegated
`AuditLogsQuery-SharePoint.Read.All` scope
(`30630b65-ed12-4a81-9130-e3a964109fae`) with the **View-Only Audit Logs**
role, normally through **Audit Reader**. **Audit Manager** also works but adds
the broader **Audit Logs** role and audit-settings authority.

Audit Search Graph API is included in both Audit (Standard) and Audit
(Premium). Standard retains ordinary audit records for 180 days. Premium adds
longer retention and higher Management Activity API bandwidth; neither is
needed merely to make Graph Audit Search application-only. Readiness still
fails closed when the tenant's audit availability or unified-audit ingestion
state is unknown or unavailable.

Microsoft documents SharePoint audit availability as typically 60–90 minutes
after an event, without a guaranteed maximum. Search execution can take much
longer for broad workloads, so a submitted query is not a synchronous result.
Completed search jobs are normally visible in audit-search history for 30
days. The Graph v1 resource exposes list, create, get, and list-record methods,
but no delete method, so the product must accept that service-managed history
before submitting a query.

Official references:

- [Create an audit query](https://learn.microsoft.com/en-us/graph/api/security-auditcoreroot-post-auditlogqueries?view=graph-rest-1.0)
- [List audit records](https://learn.microsoft.com/en-us/graph/api/security-auditlogquery-list-records?view=graph-rest-1.0)
- [Audit record resource](https://learn.microsoft.com/en-us/graph/api/resources/security-auditlogrecord?view=graph-rest-1.0)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Get started with Purview Audit permissions](https://learn.microsoft.com/en-us/purview/audit-get-started)
- [Purview Audit Standard and Premium](https://learn.microsoft.com/en-us/purview/audit-solutions-overview)
- [Management Activity API schema](https://learn.microsoft.com/en-us/office/office-365-management-api/office-365-management-activity-api-schema)
- [Audit search and latency](https://learn.microsoft.com/en-us/purview/audit-search)
- [Microsoft Graph throttling](https://learn.microsoft.com/en-us/graph/throttling)

## Bounded readiness plan

`src/audit/purview-audit-readiness.ts` is a pure application-only planner for
one marker-bound SharePoint file operation. It performs no authentication,
tenant read, search, poll, export, or write. It emits a plan only when all of
these are exact:

- Global Microsoft 365 service, Audit Standard or Premium, and enabled unified
  audit ingestion;
- distinct producer and detector application IDs;
- the exact singleton workload-specific application permission, with no
  coexisting broad audit-query permission;
- one safe local marker, one allowed file operation, and a canonical, nonzero
  UTC event window no wider than 30 minutes.

The planner deliberately does not emit delegated readiness. A controlled-human
or delegated implementation must separately bind the signed-in observer actor,
not merely its client application, and then verify View-Only Audit Logs or
Audit Logs RBAC. Until that actor contract exists, delegated input fails
closed.

The plan fixes `sharePointFileOperation`, `SharePoint`, one operation, and the
marker keyword. It caps result inspection at one `$top=10` page. A next link is
therefore `observed-but-incomplete`, never absence. HTTP 429 requires honoring
`Retry-After` on a separately authorized read; it never authorizes replay of
the query POST. An ambiguous POST must be reconciled by one exact display-name
match before any new write.

A `201` means only that Microsoft accepted a search job. `succeeded` means only
that the search completed. Live proof still requires the existing result
parser to match the exact producer application, operation, marker-bearing
target, target type, UTC window, and correlation. Empty, paginated, throttled,
failed, or attribution-incomplete results cannot be promoted.

The same Graph surface documents an Entra-specific application permission,
`AuditLogsQuery-Entra.Read.All`, but AP2 does not infer a directory-marker
contract from that permission. A directory operation needs its own frozen
operation and marker-bearing record field before it can use this planner.

## Fail-closed result model

The runtime parser in
`src/audit/purview-audit-result.ts` accepts five explicit states:

- `officially-supported` — the documented endpoint and permission contract is
  known, without a live claim;
- `live-proven` — one operation record has the exact frozen producer
  application, operation, target marker, time window, and correlation;
- `observed-but-incomplete` — a query completed but the record or required
  attribution was absent;
- `licensing-or-latency-blocked` — a supported query could not produce a
  readable result within its bounded observation contract; and
- `unsupported` — the requested claim has no supported surface.

The parser binds workload actor and detector identities separately and rejects
a conflated detector. A `live-proven` result additionally requires the
SharePoint-file record type, SharePoint workload, exact producer application,
allowed operation, target marker, UTC window, target type, and correlation.
Raw `auditData`, internal IDs, and target URLs are protected evidence and are
not learner output.

The parser accepts the internal `sharePointFileOperation` spelling and the
live Graph `SharePointFileOperation` spelling, normalizing both to the same
internal enum. Other spellings still fail closed.

## Live boundary observed

A distinct fixed detector used its already-retained broad diagnostic audit
permission to search for one historical, already-cleaned file rehearsal
performed by the API managed identity. No permission or workload mutation was
needed.

Fresh read-only metadata reconfirmed the detector and producer are distinct,
the detector token and service-principal assignment contain exactly the
retained `AuditLogsQuery.Read.All` audit role, and the narrower SharePoint-only
role is not currently assigned. The prior successful retained searches prove
the tenant's application-only endpoint availability, not least-privilege
deployment readiness. Replacing the broad diagnostic role requires separate
grant/revoke authority and is not part of this contract discovery.

## Permission migration and revocation readiness

The retained diagnostic detector currently has exactly one
`AuditLogsQuery.Read.All` assignment
(`5e1e9171-754d-478c-812c-f1755a9a4c2d`) and no
`AuditLogsQuery-SharePoint.Read.All` assignment. The repository readiness
planner already requires only the narrow role, but three protected live
readiness consumers still require the retained broad role: the exact
preflight, one-shot search runner, and retained-query reconciler. None is a
product runtime or hosted workflow.

`src/audit/purview-audit-permission-migration.ts` is a pure, non-mutating
readiness verifier for a future separately authorized migration. It refuses
revocation readiness unless:

- the expected and observed detector application and service-principal IDs
  match exactly;
- the broad and narrow Graph application-role assignments each exist exactly
  once, with the narrow assignment itself serving as administrator-consent
  evidence;
- the repository planner and all three protected readiness consumers are
  classified as migrated to the SharePoint-only role;
- no marked audit run is active and unknown run state fails closed;
- an independent recovery administrator, exact grant/revoke reconciliation,
  and exact broad-role regrant rollback are confirmed; and
- a **new token acquired after confirmed revocation** is planned to prove the
  narrow role present and broad role absent. A cached token can never prove
  post-revocation absence.

The frozen order is overlap first, migrate every consumer, reconfirm no active
marked run, revoke only the exact broad assignment once, reconcile an
ambiguous delete by reading assignment absence without blind replay, and then
acquire a fresh token. If the fresh-token or SharePoint readiness check fails,
the independent administrator may regrant the exact broad role to the exact
detector service principal once, reading for exactly one matching assignment
before any retry. The verifier performs none of these mutations and does not
authorize them.

Both the unique-keyword query and the separately reviewed exact-object-path
correction later reached terminal `succeeded`. One fresh `$top=10` page from
each returned two records without a next link. The pages contained the same two
records; offline shape analysis found the exact frozen producer application,
allowed operations, marker-bearing target, target type, event window, and
correlation in both. The original classifier missed them only because live
Graph returned `SharePointFileOperation` while the internal contract compared
`sharePointFileOperation`. After narrow enum normalization, operation-level
producer attribution is `live-proven`. Do not substitute the earlier
service-principal sign-in proof or generalize these exact records into content
collection, learner visibility, or every workload operation.
