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

The first content-reset experiment should be a one-off TypeScript calendar
cleanup tool using the Dev app. Preview must be the default; applying the plan
must be a separate explicit command. Productize the same operation behind the
API managed identity only after reset becomes a real backend capability.

The tool should:

1. require an immutable allowlist of simulated-user IDs and UPNs and a UTC lab
   construction timestamp;
2. enumerate each user's events with only cleanup-relevant fields and follow
   every page;
3. select events whose `createdDateTime` is on or after that timestamp and,
   initially, require an AP2 marker or approved AP2 contract;
4. freeze a dry-run manifest, count, and refusal summary before applying it;
5. initially refuse series masters, occurrences, exceptions, malformed events,
   and events involving attendees outside the allowlist;
6. cancel an allowlisted organizer meeting once, or delete an appointment or
   attendee-owned copy once, recording each accepted result;
7. reconcile an uncertain response read-only rather than repeating it;
8. later confirm active absence without polling or permanent purge.

Deleting an organizer event can generate attendee cancellation behavior.
Therefore the first implementation should operate on a dedicated simulated
user and a fixed test window before broadening to every simulated mailbox.
Once the sandbox contract explicitly defines “all post-construction calendar
content is disposable,” the marker requirement can become a diagnostic guard
rather than the ownership boundary.
