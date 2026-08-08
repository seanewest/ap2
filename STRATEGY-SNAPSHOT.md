# Strategy snapshot — 2026-08-07

This is a point-in-time orientation artifact for a replacement strategy session
or read-only observer. It is **not** live execution state and is not expected to
track every peer assignment or report. Before relying on who is working on what,
inspect the coordinator's durable state; `coordinator-dispatcher peer-status` is
the quickest human-readable check. Durable coordinator state wins for execution
status. Canonical project documents remain authoritative for durable product and
workflow rules.

Completed capability evidence belongs in `docs/proven-capabilities.md`; durable
product rules belong in `AGENTS.md` and focused architecture documents.

## Strategic frontier at this snapshot

AP2 is exploring how to create, preserve, reopen, and use genuine simulated-user
Windows endpoints while beginning one realistic third-party SaaS
identity-lifecycle integration. The immediate endpoint question is no longer
whether the path works, but how quickly a genuinely fresh disposable endpoint
can become useful without prematurely choosing a long-lived workstation
architecture.

## Recent endpoint evidence

- A genuine Windows 11 Enterprise 24H2 AVD personal-host path is proven through
  Entra join, Intune enrollment/compliance, Defender onboarding, assignment,
  unattended simulated-user sign-in, and a visible user desktop.
- Endpoint-local delegated Graph is proven from a genuine Kobe Windows session:
  Windows-native SSO through WAM used the signed-in Windows account to obtain a
  delegated Graph token and create the fixed OneDrive marker without CBA,
  app-only identity, browser UI, or a runtime LLM.
- Two clean fresh-workstation runs reached a visible usable simulated-user
  desktop in **14m 00.770s** and **15m 11.119s**. In the 15m11s run, the VM was
  running at about 1m22s, Entra registration appeared at about 6m41s, Intune
  enrollment followed roughly 17 seconds later, AVD became Available at about
  11m58s, and the visible Homer desktop arrived at 15m11s.
- The same enrolled workstation, after verified deallocation, returned from an
  explicit open request to a visible Homer desktop in **2m 58.578s** without
  reprovisioning its Entra, Intune, Defender, AVD, profile, assignment, or
  consent state.
- A one-for-one enrolled-disk snapshot resurrection reached Homer in **8m
  19.077s**. Entra, Intune, AVD, and the Defender machine identity were reused,
  but Defender cloud `lastSeen` stayed at its pre-snapshot timestamp through the
  bounded post-restore observation even though local Sense was healthy. The
  restored copy was therefore treated as ambiguous and retired; the original
  source VM/disk remains deallocated with the snapshot retained.

These timings are exploration evidence, not a product architecture decision.
Development cost is low enough that retaining useful deallocated test VMs for
follow-up experiments is acceptable when it accelerates learning.

## Endpoint questions to explore next

Prefer small, fast experiments that answer one timing or dependency question at
a time rather than one long optimization project. Promising questions include:

- whether a newer/faster CPU or more vCPUs materially shorten first boot,
  extension execution, AVD readiness, or first-profile creation;
- whether AVD preparation or connection attempts can begin earlier instead of
  waiting on conservative readiness gates;
- what consumes the several-minute first-user `Welcome`/desktop transition and
  which supported first-logon optimizations matter;
- whether a clean pre-enrollment generalized base image can safely pre-bake
  non-identity work and beat a raw marketplace image while still creating fresh
  Entra/Intune/Defender identity at deployment time;
- which endpoint, app-installation, and access steps can proceed concurrently.

The fresh-marketplace path remains the most generally promising shape because a
future lab may not know its user or required applications in advance. Snapshot
and warm-state approaches remain useful comparison points rather than assumed
answers.

## SaaS exploration at this snapshot

A second exploration line has begun around **YouTrack Cloud**. The first bounded
target is Entra SSO plus SCIM 2.0 lifecycle: Entra assignment/group -> provision
Cory/Kobe -> Entra SSO -> remove Kobe -> observe YouTrack deactivation or ban.
Use a durable personal/admin YouTrack owner account outside the disposable
Microsoft tenant.

Defender for Cloud Apps is a later layer, with two distinct paths worth keeping
separate: native API App Connectors for supported SaaS products, and Conditional
Access App Control/session proxy experiments for suitable SaaS without a native
connector. Do not add that complexity to the first YouTrack lifecycle proof.

## Strategy reminders

Keep experiments bounded and let the coordinator and peer own ordinary execution
judgment inside the approved goal. Treat reversible sandbox prerequisites as
ordinary execution unless they cross a real authority, architecture, spending,
or destructive-state boundary. When this snapshot and live execution differ,
refresh understanding from the durable coordinator state rather than trying to
make this file behave like a live status board.
