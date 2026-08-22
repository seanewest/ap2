# Student tenant technical desired state

AP2 uses Microsoft Graph Tenant Configuration Management (TCM), the current
Microsoft successor path from Microsoft365DSC, for resources that round-trip
cleanly. The first set is deliberately limited to the three standing W73
Conditional Access policies in
`infra/student-tenant-desired-state/conditional-access.json`. Their existing
object IDs are part of the contract. The two YouTrack policies and all other
tenant, endpoint, SaaS, Azure, scenario, and recovery state remain outside this
set.

The checked-in JSON is non-secret desired state in TCM's native resource shape.
Generated monitor metadata and observations are written with owner-only
permissions under the AP2 durable runtime, never into Git.

## Development path

Run these commands from a protected AP2 development host with the standing Dev
Graph certificate available through the normal runtime root:

```sh
node scripts/student-tenant-desired-state.mjs bootstrap
node scripts/student-tenant-desired-state.mjs ensure-monitor
node scripts/student-tenant-desired-state.mjs inspect
```

`bootstrap` reconciles only the official TCM service principal, its documented
read permissions for Conditional Access, the Security Reader role, and the
Dev app's `ConfigurationMonitoring.ReadWrite.All` permission. It also requires
the official M365 Admin Services service principal to already exist.

`ensure-monitor` first requires all three exact live policy IDs and shapes to
match, then creates the one TCM monitor if absent. It refuses duplicates or an
existing monitor with a different baseline. TCM evaluates monitors every six
hours; `inspect` also performs an immediate exact Graph comparison, so a safe
read does not depend on the next service evaluation.

TCM detects drift but does not automatically remediate it. The bounded apply
path is therefore explicit:

```sh
AP2_DESIRED_STATE_APPLY=PATCH-EXISTING-W73-POLICIES \
  node scripts/student-tenant-desired-state.mjs apply
```

Apply requires the exact TCM monitor and confirmation string, patches only the
three committed object IDs, refuses missing/renamed/duplicate resources, never
creates or deletes a Conditional Access policy, and refuses to overwrite
unmodeled controls. Re-run `inspect` afterward. Keep using the supported Graph,
Intune, Azure, and workload paths for anything outside this small set.

The concurrent Windows update baseline was not included because no authoritative
live object had reached `origin/main` when this set was established. Add it only
after its exact identity is known and TCM round-trips its current Intune resource
without semantic loss.

Microsoft references:

- [Tenant Configuration Management API overview](https://learn.microsoft.com/graph/api/resources/unified-tenant-configuration-management-api-overview?view=graph-rest-1.0)
- [TCM authentication setup](https://learn.microsoft.com/graph/utcm-authentication-setup)
- [Supported TCM Microsoft Entra resources](https://learn.microsoft.com/graph/utcm-entra-resources)
- [Microsoft365DSC transition to TCM](https://microsoft365dsc.com/blog/2026/utcm-transition/utcm-transition/)
