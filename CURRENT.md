# Current work

At each material checkpoint, the Captain checks and updates this docket against repository state and protected evidence. Worker completion is a dependency checkpoint, not a stopping condition; advance the next safe action unless Sean, new authority, or an external wait is required.

## Tooling prerequisite

- Sanitized reusable source is published in the private `seanewest/codex-agent-tools` repository. The live installation and its Captain/worker mappings are separate state. After the Captain and five peer workers are recreated, an agent must configure and verify their new thread IDs before detached assignment or overnight liveness is used; old IDs must not be reused.

## Future endpoint automation

- **AVD personal prototype — Intune permission gate:** One reviewed direct registration request converged to `Microsoft.DesktopVirtualization: Registered`; provider and possible Microsoft provider-identity residue are accepted and must not be removed. Fresh East US image, `Standard_D2s_v3` zone/quota, private NAT network, stable AVD API, Azure RBAC, and conservative eight-hour USD 4.6693 price contracts passed. Deployment stopped before creating resources because the established Dev actor lacks both `DeviceManagementConfiguration.ReadWrite.All` for the run-scoped EDR policy and `DeviceManagementManagedDevices.ReadWrite.All` for exact Intune-device cleanup. Granting/admin-consenting those tenant-wide application permissions was outside the authorized boundary. No billable or run-owned state exists; after narrow permission authorization, begin a fresh enrollment/cleanup readiness pass.
- **Later shared-device alternative — unattended WCD boundary:** The ordinary
  private-VM experiment stopped before tenant mutation, VM creation, or spend.
  No protected package existed, and Microsoft's supported bulk-token step
  requires interactive password or CBA authentication in the Windows
  Configuration Designer desktop wizard; `ICD.exe` can build from existing
  customization input but is not a documented unattended token-acquisition
  API. A brief WCD readiness attempt touched a shared physical Windows session
  and was stopped as out of boundary; the process, Store app, project directory,
  package/project files, marker resources/devices, package identity, and tenant
  mutation are all absent. Do not drive a host desktop, pointer, keyboard, or
  hidden session. The executable alternative is a separately authorized
  attended package-authoring pass in an isolated Windows client, followed by
  the repository's fail-closed readiness gate and a headless private-VM
  executor. See [the shared-device package contract](docs/shared-device-provisioning-package.md).

## API durability decision

- **Non-idempotent operation journal — shared store required:** The real
  OneDrive share/cleanup and calendar create/cancel consumers still use
  process-local boundaries and require `maxReplicas=1`. The main API has no
  production shared store, endpoint/configuration contract, storage SDK, or
  managed-identity data role. The calling bot's separate single-replica Azure
  Files journal is not a cross-replica claim store. Azure Table Storage is the
  smallest supported fit, but selecting/provisioning it is a material
  persistence architecture decision. Do not substitute memory or filesystem
  state. See the
  [durable operation journal decision](docs/durable-operation-journal-decision.md).
- **Bounded operation telemetry — locally productized:** Calendar create,
  cancel, and explicit read-only recovery use a sink-agnostic in-process
  structured event contract. Correlation is a bounded marker hash; dimensions
  are enums; raw identity, scenario content, credentials, browser state, and
  Microsoft responses cannot enter the event shape. The console sink is
  observational and introduces no persistence or retry. See
  [operation telemetry](docs/operation-telemetry.md).

## Cleanup later

- Reconcile and remove only the retained Teams chat/calling artifacts during a separately authorized cleanup pass, plus the privately inventoried `ap2-help-desk-email-20260729-001` Cory Inbox message, temporary workload roles, broad diagnostic permissions, delegated consent, retained drafts/messages where approved, and obsolete certificates/keys. Preserve accepted audit, quarantine, transport, deleted-object, and other historical residue.

## Closed/do not reopen

- Bounded operation telemetry now has a pure fail-closed bridge to candidate
  post-run receipt operation rows. It preserves completed, refused, ambiguous,
  reconciled, unresolved, and uninspected lifecycle strength while always
  leaving artifact, detector, learner, response, cleanup, retention, and
  terminal proof to separate observations. No API, UI, persistence, or
  external execution is included. See
  [the telemetry receipt adapter](docs/operation-telemetry-receipt-adapter.md).
- Post-run scenario truth now has a runtime-validated sanitized receipt
  contract over the generalized manifest. It requires exact role bindings and
  terminal categorical rows for operations, artifacts, independent
  observation, learner visibility and interpretation, response, cleanup,
  retention, and proof. Empty or blocked audit queries, human-assisted
  artifacts, cleanup mutations, and weaker terminal states cannot be promoted
  into stronger claims. Five canonical positive/negative fixtures cover the
  help-desk email, three-VM AVD, Teams missed call, application
  reconnaissance, and Purview boundary. The offline CLI reads one bounded JSON
  receipt and performs no network work. See
  [post-run scenario evidence receipts](docs/scenario-evidence-receipts.md).
- Microsoft Graph v1 Purview Audit Search is officially supported for
  application-only SharePoint observation, with
  `AuditLogsQuery-SharePoint.Read.All` as the product-minimum application
  permission. A fixed detector distinct from the API managed-identity producer
  reached the live endpoint using already-retained diagnostic authority. One
  historical keyword query succeeded with zero records, while one reviewed
  exact-path correction remained `notStarted` through all three bounded status
  reads; no records page was read for that correction. Authorization stayed
  unchanged and no content or workload mutation occurred. Operation-level
  producer attribution is therefore `licensing-or-latency-blocked`, not
  proven. Do not repeat either search or the workload event under this lane.
  See [the fail-closed audit contract](docs/purview-audit-contract.md).
- The one authorized Teams Call Canary create was submitted exactly once for
  Cory with audio-only service-hosted media. Microsoft Graph returned a
  definitive HTTP `403` / code `7505` tenant-mismatch refusal before assigning
  a call identity, so no incoming call, callback, or hang-up occurred and
  calling was not proven. Exact follow-up reads proved every exposed token,
  tenant, application, service-principal, Azure Bot, Teams channel, catalog,
  Cory, and runtime binding while Microsoft exposes no internal calling-
  registration read or official `7505` repair. The healthy single replica is
  literal call-disabled. Do not retry Graph without a specific Microsoft
  backend repair. A separately authorized controlled client call from licensed
  fictional lab user Kobe to Cory subsequently produced one authentic native
  `Missed incoming` Calls-history row and one matching missed-call Activity
  notification. That proves the human-assisted Teams-user path only, not
  unattended automation; exact duration and voicemail behavior remain
  unproven.
- The retained Teams chat learner remediation is complete. Sean removed only
  Marge once; one exact post-action membership read proved Cory, Homer, and
  Kobe retained and Marge absent, while protected learner evidence showed the
  original warning message still visible. The chat and message remain for the
  separately authorized broader cleanup pass.
- The standalone Bastion canary expired and its isolated marked run was deleted and confirmed absent without any learner sign-in. It proved deployment and cleanup, not Intune enrollment or Defender onboarding.
- PRs #44 and #45 are merged to `main`; their old branch/handoff actions are not current work.
- Retained Defender/EICAR mail correlation is complete and agent-proven: the message was blocked/quarantined, Cory's Inbox contained no matching message, and no related alert or incident was found. Never release, preview, download, or open the attachment; any endpoint follow-on belongs to a future separately authorized endpoint lane.
- `Standard_B2ms` is obsolete for the standalone canary; the reviewed design uses `Standard_D2s_v3`. The erroneous actor bundle is superseded and unusable, and the completed Teams package upload must not be repeated.
- The Defender custom-detection and temporary-application lifecycle lanes are closed. Keep their honest limitations and cleanup evidence; do not run another attempt.
