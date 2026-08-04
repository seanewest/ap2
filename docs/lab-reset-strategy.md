# Sandbox reset strategy

The AP2 tenant is a dedicated sandbox. Reset aims to leave it ready enough for
another capability or scenario run, not to restore an exact snapshot or erase
ordinary Microsoft history. Automated and manual cleanup are both acceptable.
This repository does not yet provide general reset automation.

## Baseline model

A practical baseline may retain simulated users, licenses, applications, and
selected configuration because recreating them is slow. Those objects are not
valuable production data and do not require exact preservation unless a
specific experiment says otherwise.

A capability or scenario run should retain only the state needed to understand
and later reconcile its effects:

- a run marker and approximate start time;
- the target tenant, subscription, and actors;
- created or changed artifact IDs and useful relationships;
- accepted operations whose later visibility is still unknown;
- cleanup progress, known residue, and any manual step still needed.

When cleanup is automated, reverse dependency order is often useful:

1. stop pending jobs;
2. remove shares, memberships, permissions, and relationships;
3. remove child content;
4. remove parent containers;
5. restore changed settings;
6. later confirm that active effects are absent.

Audit logs, recoverable deletion, mail retention, recycle-bin history, and
known remnants may remain. Record incomplete cleanup and use manual steps when
useful; the dedicated sandbox makes imperfect cleanup acceptable. Reset
must not claim that Microsoft erased history or restored an exact prior state.

## Broad cleanup

Azure experiments should prefer a dedicated resource group with the run marker in
tags. Deleting the resource group is the broadest and simplest cleanup
boundary.

Microsoft 365 has no equivalent universal container. Use dedicated simulated
users and marker namespaces, then combine workload-specific automation with
documented manual steps as needed. Microsoft365DSC could later help restore
tenant configuration, but mailbox, calendar, To Do, SharePoint, and other
content still require workload-specific handling.

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

Deleting an organizer event can generate attendee cancellation behavior. The
dedicated-tenant contract permits cleanup to delete marked sandbox
calendar content, but the current preview only records organizer/attendee
distinctions and refuses every mutation. Its schema-v2 contract has no apply
scope: `classifiedAction` is diagnostic only, every otherwise actionable item
is explicitly `apply_scope_disabled`, `plannedAction` is always `null`, and
planned-action summary counts remain zero.

## Calendar conditional-delete canary result

The bounded canary sent one event `DELETE` with a genuinely stale event ETag.
Microsoft Graph returned HTTP `204`, demonstrating that `If-Match` was ignored
on the tested event DELETE route. Read-only follow-up confirmed the exact event
was absent, the marker count was zero, and a fresh schema-v2 preview contained
zero eligible and zero indeterminate events.

The fixture is therefore confirmed absent, and the canary showed that
`If-Match` cannot be used for selective drift protection on this route. Under
the dedicated-tenant contract, that result does not forbid a future reset from
deleting marked sandbox calendar content. This repository still retains no
executable calendar mutation or apply path: organizer cancellation,
attendee-copy deletion, appointment deletion, and broad calendar apply remain
unsupported. Any future automation must be implemented and reviewed
separately; the existing result is not an executable cleanup feature.
