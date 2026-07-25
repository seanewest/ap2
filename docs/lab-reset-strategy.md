# Lab reset strategy

The eventual product should clean up a complete lab run rather than requiring a
student to reverse every operation separately.

## Baseline model

Each lab run should retain:

- a unique lab run ID and construction start time;
- the target tenant and simulated users;
- original values for settings that will be changed;
- created artifact IDs, stable markers, and parent-child relationships;
- accepted operations whose final visibility has not yet been observed;
- cleanup progress and conflicts.

Cleanup should run in reverse dependency order:

1. stop pending jobs;
2. remove shares, memberships, permissions, and relationships;
3. remove child content;
4. remove parent containers;
5. restore changed settings;
6. later confirm that active effects are absent.

Audit logs, recoverable deletion, mail retention, and recycle-bin history may
remain. A successful reset means that the lab has no active effect, not that
Microsoft has erased its history.

## Broad cleanup

Azure labs should prefer a dedicated resource group with the lab run ID in
tags. Deleting the resource group is the broadest and simplest cleanup
boundary.

Microsoft 365 has no equivalent universal container. Use dedicated simulated
users and marker namespaces, then provide workload-specific cleanup modules.
Microsoft365DSC can later restore tenant configuration, but mailbox, calendar,
To Do, SharePoint, and other content still require content cleanup.

The first content-reset experiment produced a one-off TypeScript calendar
preview using the Dev app. Preview remains the only supported calendar-reset
operation. No apply command is retained, and the operation must not be
productized behind the API managed identity without a new safe mutation
contract.

The tool should:

1. require an immutable allowlist of simulated-user IDs and UPNs and a UTC lab
   construction timestamp;
2. enumerate each user's events with only cleanup-relevant fields and follow
   every page;
3. select events whose `createdDateTime` is on or after that timestamp and,
   initially, require an AP2 marker or approved AP2 contract;
4. freeze a dry-run manifest, count, and refusal summary for review;
5. initially refuse series masters, occurrences, exceptions, malformed events,
   and events involving attendees outside the allowlist;
6. make no Graph mutation from the preview tool;
7. use separately reviewed workload-specific cleanup only if a future
   conditional contract is proven;
8. confirm active absence read-only without polling or permanent purge.

Deleting an organizer event can generate attendee cancellation behavior.
The preview therefore retains organizer/attendee distinctions and refuses
unsafe shapes, but it does not dispatch either action. A dedicated user, fixed
window, or marker does not compensate for the missing conditional-delete
guard, so the current design must not broaden to mailbox mutation. Its
schema-v2 contract has no apply scope: `classifiedAction` is diagnostic only,
every otherwise actionable item is explicitly `apply_scope_disabled`,
`plannedAction` is always `null`, and planned-action summary counts remain
zero.

## Calendar conditional-delete canary result

The bounded canary sent one event `DELETE` with a genuinely stale event ETag.
Microsoft Graph returned HTTP `204`, demonstrating that `If-Match` was ignored
on the tested event DELETE route. Read-only follow-up confirmed the exact event
was absent, the marker count was zero, and a fresh schema-v2 preview contained
zero eligible and zero indeterminate events.

The fixture is therefore confirmed absent, but the canary disproved the
conditional safety assumption needed for a broad calendar reset. This
repository retains no executable calendar mutation or apply path. Organizer
cancellation, attendee-copy deletion, appointment deletion, and broad calendar
apply remain unsupported. Any future experiment requires a newly reviewed
mutation contract and a separate bounded canary; the existing result must not
be treated as authorization to retry or broaden deletion.
