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
`AuditLogsQuery-SharePoint.Read.All`; it requires administrator consent.
`AuditLogsQuery.Read.All` reaches every supported workload and is not the
least-privileged product grant.

Microsoft documents SharePoint audit availability as typically 60–90 minutes
after an event, without a guaranteed maximum. A query job is retained as
normal audit-search history; Graph documents no delete method for it.

Official references:

- [Create an audit query](https://learn.microsoft.com/en-us/graph/api/security-auditcoreroot-post-auditlogqueries?view=graph-rest-1.0)
- [List audit records](https://learn.microsoft.com/en-us/graph/api/security-auditlogquery-list-records?view=graph-rest-1.0)
- [Audit record resource](https://learn.microsoft.com/en-us/graph/api/resources/security-auditlogrecord?view=graph-rest-1.0)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Management Activity API schema](https://learn.microsoft.com/en-us/office/office-365-management-api/office-365-management-activity-api-schema)
- [Audit search and latency](https://learn.microsoft.com/en-us/purview/audit-search)

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

## Live boundary observed

A distinct fixed detector used its already-retained broad diagnostic audit
permission to search for one historical, already-cleaned file rehearsal
performed by the API managed identity. No permission or workload mutation was
needed.

One unique-keyword query succeeded and returned zero records. A separately
reviewed exact-object-path correction was accepted once but remained
`notStarted` through three capped status reads, so its records endpoint was not
read. Authorization postflight was unchanged. The outcome is therefore
`licensing-or-latency-blocked`: Graph Audit Search and distinct app-only
observation are supported and live-reachable, but operation-level producer
correlation is not yet live-proven. Do not substitute the earlier
service-principal sign-in proof or infer application identity from an empty
result.
