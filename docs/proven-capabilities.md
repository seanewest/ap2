# Proven capabilities

This is an inventory of live Pass 3 evidence, not a roadmap. A capability is
listed only when it was exercised through the hosted product path or by a
bounded direct canary against the Student tenant. Unit tests, deployment alone,
and code that has not touched Microsoft are not counted as live proof.

Use this as a searchable evidence ledger, not cover-to-cover orientation. Search
by workload, actor, product, or capability, then read the relevant row and its
limitations. Entries are completed evidence, not an implied backlog.

A bounded canary proves only the action or observation it exercised. It is not
automatically a scenario or lab, and future capability work does not require a
generalized manifest or learner contract.

Historical producer and learner actor labels are experiment-local, not current
product roles or backlog signals.

Actor shorthand:

- **c91 delegated — user**: the shared `c91c7af4-...` client acquired a
  delegated Microsoft token for the named simulated user through that user's
  CBA certificate.
- **API MI**: the deployed Container App's system-assigned managed identity.
- **Dev diagnostic app**: the broad Pass 3 certificate app used by agents for
  diagnostics and direct canaries. It is not part of the future student
  product.

The dedicated operator signed in to the hosted SPA and authorized the AP2 API.
For a user-like operation, that operator was only the trigger; the named
simulated user was the Microsoft 365 workload actor.

## Productized hosted SPA/API capabilities

| Capability | What the live rehearsal proved | Workload actor | Cleanup / final state |
| --- | --- | --- | --- |
| Hosted sign-in and API access | GitHub Pages completed operator CBA, acquired the custom delegated API scope, called the cross-origin Container App API, showed safe `/api/whoami` output, and signed out without exposing a token. A Dev app-only call to the same API was also accepted. | Operator for the browser path; Dev diagnostic app for the app-only check | Sign-out survived reload; no tenant artifact |
| Tenant API discovery | The development Student tenant retained one non-secret AP2 organization extension naming its W64 installation and existing API URL. In a fresh hosted operator CBA context, the SPA read that record with its already-consented delegated Graph `User.Read`, built the API client from the discovered HTTPS URL, received `200` from `/api/whoami` for the same delegated tenant, and enabled actions without invoking them. A signed-in page reload independently repeated both `GET` requests with `200`, proving rediscovery without browser-local mapping state. | Dedicated CBA operator for both delegated reads; existing Student API for identity confirmation | The organization extension is retained as standing installation metadata. This discovers only the selected W64 installation's API URL; it does not provision infrastructure or dynamically replace the selected tenant, actors, authorization boundary, or Azure metadata. |
| Rehearsal status | An authorized hosted caller caused the API to read the fixed Container App and return its name, region, running state, and latest ready revision. | API MI | Read-only |
| Fixed email | One controlled hosted action made the fixed Homer-to-Marge `sendMail` attempt. The API received Graph `202`, and a later Defender message trace independently showed the message delivered to Marge's Inbox with Homer as sender. | c91 delegated — Homer | Message and mail/audit history intentionally retained |
| OneDrive read-only share | The hosted path created the exact 58-byte Homer file and configured Marge's direct read permission. Sean then signed in separately as Marge, opened the exact protected direct URL, and read only its expected harmless sentence. The OneDrive Shared view remained empty, so Shared-view discovery failed and interpretation beyond reading is unclaimed. | c91 delegated — Homer; Marge's separate human browser session for observation | The reviewed one-shot cleanup removed the exact permission and file. Producer path, item, and permission reads plus an isolated Marge-authenticated direct-URL read returned `404`; deleted-item/recycle-bin history can remain |
| Calendar meeting | The hosted path created the fixed Cory meeting for Kobe and Marge, verified the organizer and attendee copies, and exercised explicit cancellation, including recovery after an ambiguous API response. | c91 delegated — Cory | No active Cory event; Kobe and Marge retained one cancelled copy each, with calendar/audit history |
| Contact | One hosted create and one hosted delete of the fixed Cory contact both succeeded. | c91 delegated — Cory | Exact contact absent |
| Disabled Inbox rule | One hosted create and one hosted delete of the exact harmless, disabled rule both succeeded. | c91 delegated — Cory | Exact rule absent |
| Outlook category | One hosted create and one hosted delete of the fixed category both succeeded. | c91 delegated — Cory | Exact category absent |
| SharePoint file | One hosted create and one hosted delete of the exact fixed-site file both succeeded. | API MI | Active path returned `404`; recycle-bin/audit history retained |
| Unsent draft | One hosted create and one hosted delete of the fixed Cory draft both succeeded. Route evidence showed no send, reply, forward, or recipient-mailbox operation. | c91 delegated — Cory | Exact draft absent; no message sent |
| To Do task | The hosted path read Cory's existing default, owned, unshared list, created the fixed task there, and deleted it. It did not create/share a list or complete the task. | c91 delegated — Cory | Exact task absent |

## Bounded direct canaries

These prove that Microsoft accepted and exposed the operation shape. They do
not mean the operation has been added to the SPA/API product path.

| Canary | What was directly proven | Actor | Cleanup / final state |
| --- | --- | --- | --- |
| Application cross-workload reconnaissance | One app-only execution used one token and four fixed reads to observe Cory's directory memberships and mailbox-folder metadata plus the roots of Cory's OneDrive and the fixed SharePoint drive. A different fixed application, temporarily granted only audit-read authority, independently found the successful Dev-app service-principal sign-in for Microsoft Graph. The bounded output retained only counts, reachability, and a sanitized correlation result—not tenant object details. | Dev diagnostic app for the workload; separate fixed audit observer for detection | Workload read-only; the temporary audit grant is absent and the detector's original grant set is unchanged. One attempted marked observer app and service principal are inactive; their local private key was removed, while normal deleted-object and audit history remains. |
| Authentication-method posture | After the new read-only role reached a fresh token, one app-only execution read the four fixed simulated users without paging or user sign-in. The aggregate contained six methods: four password and two Microsoft Authenticator registrations. A separate one-request registration report found two of four users MFA registered/capable and SSPR registered/capable, all four SSPR enabled, and none passwordless capable. Method details were not retained; registration and capability do not prove enforcement or a successful challenge. | Dev diagnostic app | Read-only; the `UserAuthenticationMethod.Read.All` assignment and its private cleanup identity are retained |
| Homer self-service passkey registration | A fresh nonpersistent browser context signed in to My Sign-Ins as exact simulated user Homer through his retained CBA certificate. The tenant's enabled FIDO2 policy allowed self-service registration for all users without attestation or AAGUID restrictions, and Homer's initial Graph inventory contained only his password method. In that authenticated session, the normal **Add sign-in method → Passkey** flow created one marked device-bound FIDO2 method through a Playwright CTAP2 virtual USB authenticator. Graph returned the marked method with creation time `2026-08-21T02:27:33Z`, and Homer's Security info page independently displayed it as `Passkey (Device bound)`. Authentication Methods audit then recorded successful `Get passkey creation options`, `User started security info registration`, `User registered Passkey`, and `User registered Fido2 Authentication Method` events, each initiated by Homer's immutable object and UPN. My Sign-Ins separately recorded the matching interactive `My Signins` X.509 certificate step as successful, followed by successful `Microsoft Account Controls V2` Graph interactions in the registration window. | Homer in his genuine CBA-authenticated My Sign-Ins session; Dev diagnostic app only for read-only policy, method, audit, registration-report, and sign-in observation | Homer's fresh portal session deleted the exact marked passkey. Authentication Methods recorded successful `User deleted security info` / `User deleted Fido`, again initiated by Homer, and Graph now shows only his original password method. Browser context and virtual authenticator were discarded. The reporting aggregate remained stale during the short experiment, consistent with Microsoft's documented report latency, so it is not claimed as immediate evidence. User/session and Entra attribution are authentic, but authenticator presence, verification, and key storage were Chromium-emulated: this proves deterministic self-service device-bound FIDO2 registration, not a physical security-key touch, Windows Hello/platform storage, or a human gesture. The bounded method is `scripts/homer-self-service-auth-proof.mjs`. |
| Standing MFA enforcement baseline | On 2026-08-22 AP2 replaced the prior password-only standing premise with three enabled Conditional Access policies: all users and all resources require MFA for every client type; all users and all resources are blocked when the client is Exchange ActiveSync or another legacy client; and all users and all resources are blocked when the authentication flow is device code. None has a user, group, app, risk, location, platform, or device exclusion, and none adds a session, risk, compliance, or phishing-resistant-only control. Security Defaults remains off so Conditional Access remains usable. The two narrow YouTrack session-control policies remain enabled with their exact IDs and shapes. Conditional Access What If independently applied MFA to Homer's ordinary Graph browser access, added the legacy block for an `other` client, added the device-code block for `deviceCodeFlow`, and applied none of the user policies to the Dev service principal. | Dev diagnostic app for exact policy creation, reconciliation, What If, Graph, and ARM reads; dedicated operator and Homer in fresh CBA browser contexts; Rachel in her genuine Windows App/AVD context | The human Global Administrator retains password plus Microsoft Authenticator recovery, and the independent CBA Global Administrator completed a fresh hosted-SPA sign-in after enforcement. X.509 remains high-affinity multifactor, so Homer completed fresh CBA, registered one marked device-bound passkey through normal self-service, and deleted it back to his original password method. Rachel then completed an active 1440x860 Windows App/AVD session under the enforced baseline; cleanup logged her off and returned the retained VM to deallocated/`Shutdown` with zero sessions and unchanged methods. Fresh app-only Graph and ARM tokens continued to work. The earlier 2026-08-21 audit of 16 simulated users remains valid historical evidence that the gap existed before this change, but its conclusion that password-only Microsoft 365 access is a standing premise is superseded. The retained implementation is `scripts/entra-security-baseline.mjs`; the focused AVD validation mode is in `scripts/rachel-enrollment-session-proof.mjs`. |
| Retained Windows update baseline | On 2026-08-22 Intune accepted one Windows Update for Business ring assigned only through the exact four-member `AP2 retained managed Windows endpoints` device group. It offers Microsoft quality/security updates after a three-day deferral, uses Windows intelligent install/restart timing, gives a seven-day quality deadline plus two-day grace period, permits pre-deadline restart attempts outside active use, retains restart warnings, prevents user pause/scan overrides, and excludes driver updates from this ring. A separate assigned feature-update profile holds the scope at Windows 11 24H2 through its reported 2027-10-12 support end; all four retained devices already reported 24H2 build `26100`, so assignment offered no immediate feature upgrade. | Dev diagnostic app for exact Intune and Entra reads, bounded temporary configuration authority, creation, assignment, reconciliation, and zero-session client policy reads | Rachel, Marge, and Kobe are compliant full-MDM records. Each completed a fresh MDM cycle, logged the ring's Update CSP values as set, exposed the same effective device policy, and reached a native compliant device-context row. The effective values are `AllowAutoUpdate=6`, Microsoft updates allowed, drivers excluded, quality deferral `3`, feature/quality deadlines `14`/`7`, grace `2`, no-auto-reboot `0`, restart-warning notification level `1`, and pause/scan UI disabled. Rachel additionally retains a duplicate user-context `error` row with the same device/profile identity; its device-context `System account` row is compliant, and the sole contemporaneous client policy error was the generic `ADMXInstall/.../FakePolicy/Version` path while no Update CSP setting logged failure. Homer remains different: the exact active Entra join and Intune discovery URL are healthy, but the guest has only a type-26 discovery placeholder, no real type-6 Intune enrollment or Intune MDM device certificate, and Intune exposes only its MDE `msSense` record. The exact group assignment is ready for Homer, but application requires a supported user-credential enrollment; repeating the AAD-login reinstall would recreate a previously disproven identity path. Homer, Marge, and Kobe were started with zero sessions for system-context inspection and were left to the retained scaling plan; no VM was restarted, stopped, or manually deallocated. Both temporary Intune write roles are absent. The retained reconciliation/observation implementation is `scripts/windows-update-baseline.mjs`. |
| Directory-role posture | One beta Graph request expanded directory-role definitions without retaining role names or identities and found zero directory-role assignments for all four fixed simulated users. | Dev diagnostic app | Read-only; the beta response shape is not production-stable, and zero directory roles does not prove absence of workload-specific privilege |
| Device-registration posture | One app-only metadata read found one enabled Windows device with Workplace registration and approximate activity within 30 days; no device identity or owner was retained. | Dev diagnostic app | Read-only; registration and approximate activity do not prove health, compliance, or current ownership |
| Empty Azure resource group | Created one tagged, empty Student resource group through ARM, confirmed it contained no resources, and deleted it. | Dev diagnostic app | Later exact GET returned `404` |
| Azure Virtual Desktop personal host | A fresh private, direct-assigned Windows 11 Enterprise 24H2 host repeated deployment-time Entra join, compliant Intune MDM enrollment, and marker-bound Defender onboarding before learner sign-in. The fixed learner then completed Windows App onboarding, discovered the one assigned SessionDesktop, completed the separate resource authentication naming the exact user and remote device, and reached the first Windows 11 desktop without retry or configuration. AVD independently recorded the same user's Desktop session and its disconnected state after the tab closed; Intune remained compliant and associated that user after sign-in, while Defender remained Active/Onboarded/Intune. Live offboarding then stopped Sense and set local onboarding state to `0`. | Fixed learner for the one desktop session; Dev diagnostic app for Azure, Intune, and Defender orchestration; independent administrator for the bounded temporary-permission lifecycle and final Entra-device cleanup | Both EDR policies, the active marker group, Azure resource group, Intune record, and Entra device are absent. Both temporary Graph roles were revoked and are absent from a fresh Dev token and complete assignment read. The approximately 1.37-hour lifecycle remained below the conservative USD 4.66920548 eight-hour public-price upper bound and USD 8 hard stop; ordinary audit, deleted-group, and stale Defender device-history residue can remain. |
| Retained AVD endpoint-compromise background | On Marge's retained personal host `ap2margefresh`, run `AP2-ENDPOINT-BG-20260815T1004Z` launched a marked child PowerShell with `-ExecutionPolicy Bypass` from `10:05:28Z` to `10:05:38Z`. Under unchanged endpoint posture it created one harmless marker, completed local/user/process/network discovery (four local users, 139 processes, 18 established TCP connections, and 19 DNS answers for `login.microsoftonline.com`), and created and verified one no-op `HKLM` Run canary. This proves bounded compromise-background staging, not employee-user attribution. | Dev diagnostic app through Azure Run Command; guest actor `NT AUTHORITY\SYSTEM` on Marge's assigned host | The exact Run value and seven marked files are absent; zero marked processes and zero interactive or AVD sessions remained. The VM is deallocated and its AVD session host is `Shutdown`. A read-only Defender follow-up about 59 minutes after execution found zero device-related MDE alerts, zero Graph alerts or incidents since `09:45Z`, and zero `AlertInfo` or exact `AlertEvidence` rows. Raw device process, file, registry, and network hunting tables were unavailable to the authorized Graph schema, the legacy MDE query lacked `AdvancedQuery.Read.All`, and the device's `lastSeen` full-report time preceded execution. No detection was observed; raw event and timeline recording remains unproven rather than absent. No protection or detection setting was changed. Evidence commits `d565dc2` and `af3eaed` changed documentation only; the recovered W45 staging method is `scripts/endpoint-background-system.mjs`, and the later recovered [`observe-defender-endpoint-follow-up.ts`](../scripts/observe-defender-endpoint-follow-up.ts) retains only the supported, bounded alert and hunting query shape and not the unavailable raw-device queries. |
| Kobe guest-local Run-dialog PowerShell behavior | On fresh `ap2kobefresh`, one worker-owned AVD session used guest-local keyboard input, not client clipboard transfer, to submit each fixed command once through Win+R. Branch A created the exact `explorer.exe` → `powershell.exe` process with its supplied encoded command line; MDE named `Suspicious PowerShell download or encoded command execution`, `Suspicious command in RunMRU registry`, `Suspicious PowerShell command in registry`, and `Suspicious process executed PowerShell command`. The supplied Base64 is 93 bytes and not valid-length UTF-16LE, so it is not equivalent to the claimed `Write-Host 'Hello World' -ForegroundColor Green` and proves no Hello World behavior. Branch B created `CLICKFIX-SIMULATION.txt` with `SIMULATION ONLY` and opened it in Notepad; MDE named `Suspicious PowerShell command in registry` and `Suspicious process executed PowerShell command`. The exact command invoked `Resolve-DnsName example.com`, but neither its answer nor a bounded DNS Client event survived, so successful resolution is unproven rather than blocked. These results are only for the two exact commands under the observed default protection settings; all protection booleans were enabled, but signature `1.437.1.0` was already reported out of date. | Kobe in his assigned AVD session; Dev diagnostic app for bounded Azure and Defender observation | The marked file, staging root, verifier tasks, matching processes, and two exact RunMRU values are absent. Kobe is logged off; `ap2kobefresh-vm` is deallocated with host `Shutdown`, zero sessions, no managed Run Command child, compliant Intune, and Defender Active/Onboarded. Selected local Defender Operational and DNS Client Operational reads returned zero events; raw MDE process hunting remained unavailable without `AdvancedQuery.Read.All`. The corrected no-clipboard, externally gated, one-Enter runner is `scripts/kobe-run-dialog-defender-proof.mjs`. |
| Corrected benign EncodedCommand behavior | On fresh D2as_v7 host `ap2homerfresh`, the independently decoded 48-byte UTF-16LE value for exact source `Write-Host 'Hello World'` was read back exactly in Win+R before one remote-keyboard Enter. `explorer.exe` launched the exact PowerShell command, and the console displayed `Hello World`, so default Defender/MDE allowed execution. MDE then created the single High alert `Suspicious command in RunMRU registry` 90.12 seconds after process start; four bounded reads through 5 minutes 10 seconds found no additional alert, making this exact result detect-only rather than block. | Homer in his assigned AVD session; Dev diagnostic app for bounded Azure and Defender observation | The exact process, RunMRU value, verifier/observer tasks, staging root, browser context, and session are absent. Homer and the earlier non-executing Kobe connection fallback both finish deallocated with host `Shutdown` and zero sessions. No protection setting changed; raw MDE process hunting remained unavailable without `AdvancedQuery.Read.All`. The corrected externally gated runner is `scripts/kobe-run-dialog-defender-proof.mjs`. |
| Retained AVD user-context inbox-rule effect | During exact run `AP2-MARGE-USER-RULE-20260815T1347Z`, Windows App established one active Marge session on `ap2margefresh`. A fresh CBA flow independently bound the delegated Graph token to Marge's tenant object and `/me`; that token created one enabled Inbox rule with the unique subject marker as its sole condition and mark-read as its sole effective action. Only after Graph returned `201` and an exact read confirmed the full rule shape, one non-retried Homer-delegated `sendMail` returned `202`. Exactly one harmless, attachment-free, Homer-to-Marge Inbox message arrived three seconds later and was already read. This proves creation and effect in Marge's authenticated user context, unlike the earlier Dev-app rule result. | Marge's genuine CBA/delegated user authority while her assigned AVD session was active; Homer used separate delegated authority only for the one internal delivery | Marge's delegated cleanup removed the exact rule and message. Exact reads found zero matching rules, zero matching Inbox messages, and zero matching messages across her mailbox. Browser state was discarded, the sole AVD session was logged off, and `ap2margefresh-vm` was explicitly deallocated with session host `Shutdown`; the standing scaling plan was unchanged. No detection surface was inspected. Evidence commit `9c369f2` changed documentation only; the recovered W53 method is `scripts/marge-user-inbox-rule-proof.ts`. |
| Rachel cloud-first marker execution | In exact run `AP2-RACHEL-CLOUD-EXEC-20260816T0240Z`, Homer created and shared one 1,583-byte OneDrive `.cmd` lure with Rachel and Microsoft delivered exactly one internal sharing invitation. Scripted Windows App automation reached the item from Rachel's genuine `ap2fastrachel` session, accepted Edge's normal download warning, and independently matched the downloaded file to frozen SHA-256 `A8BAF9A24F991B4C25A4BF621B2D0A7672445A2E2503BCF527C516CADBDC78A2` before one activation. Windows displayed its normal unknown-publisher warning; accepting it produced only the fixed marker and receipt. The receipt bound execution to authenticated, non-SYSTEM `AzureAD\RachelGreen`, SID `S-1-12-1-513388829-1315959728-1260107142-3910291705`, CloudAP, interactive session 2, and `AzureAdPrt=true`, and revalidated the executed payload hash. | c91 delegated — Homer for the OneDrive share; Rachel's CloudAP-authenticated Windows token for browser retrieval and marker execution; c91 delegated — Rachel only for exact invitation confirmation and cleanup | The exact permission and item were deleted and both item-ID and active-path reads returned `404`; OneDrive recycle-bin history can remain. Rachel's exact invitation was deleted and its prior ID returned `404`; normal Deleted Items history can remain. The downloaded payload and evidence root are absent. Force-logoff terminated Rachel's browser and user processes, but her persistent Edge profile can retain the exact file's download/navigation history and the first-run choices completed during this proof. Rachel's AVD session count is zero, and the VM is deallocated with session host `Shutdown`. The standing four-pool scaling plan is unchanged. No protection or detection setting was changed, and no detection surface was inspected. Evidence commit `f6ed079` changed documentation only; the complete executable method was not retained in Git. |
| Retained AVD user-context endpoint background | Kobe authenticated to his assigned AVD desktop and launched exact run `AP2-KOBE-USER-BG-20260815T1105Z` through the remote canvas at `11:11:36Z`. Its surviving summary recorded execution from `11:11:42Z` to `11:11:57Z` as `AzureAD\KobeWest`, CloudAP-authenticated, medium-integrity PowerShell in interactive session 2. Under unchanged endpoint posture it created a marker whose SHA-256 was independently revalidated, observed four local users, 203 processes, 59 established TCP connections, and two DNS answers for `ap2-tester123.youtrack.cloud`, received HTTP `200` from one benign `HEAD` to that host, and created and verified the no-op `HKCU` Run value `AP2KobeIncidentBackgroundCanary` without triggering it. The original post-launch inspector failed only because it assumed profile `C:\Users\kobe`; recovery found the evidence under the actual `C:\Users\KobeWest` profile, so the activity was not replayed. | Kobe in his assigned AVD session; the Dev diagnostic app only staged the fixed script and independently recovered its output | Recovery removed the exact HKCU value, user evidence root, ProgramData staging root, and orphaned browser parent; zero marked processes survived. Kobe's sole disconnected AVD session was force-logged off, session count reached zero, and `ap2flakobe-vm` was explicitly deallocated with session host `Shutdown`. No Defender alert, incident, hunting, or detection query was performed, so this proves only the user-context background actions and cleanup. Evidence commit `e77e554` changed documentation only; the recovered W49/W51 method is `scripts/endpoint-background-kobe.mjs`. |
| Kobe collection-to-YouTrack boundary | In exact run `AP2-KOBE-COLLECT-YT-20260815T1345Z`, CloudAP-authenticated `AzureAD\KobeWest` created only two new synthetic marked text files (108 and 112 bytes) and collected them into one 516-byte ZIP in interactive AVD session 2. Independent guest inspection matched both source hashes, the archive SHA-256 `83502B778DAC54FE3D9A7D255F1EBE3B56C21AB5737917FF424DB5B49C0CEA02`, and the ZIP's exact two-entry inventory. The same unattended session launched Edge through the AP2 staged-SAML My Apps path and reached YouTrack genuinely signed in as Kobe West, but `/issues` returned an explicit insufficient-permission page and `DEMO-13` returned no accessible content. Under this unchanged SaaS posture, Kobe therefore has no practical reversible issue-attachment destination; no file chooser, upload request, or SaaS artifact was created, and permissions were not changed. | Kobe in his assigned AVD session; the Dev diagnostic app only staged and independently inspected the fixed local script | The exact source files, archive, user root, and ProgramData script are absent with zero marked processes. The browser container is absent, Kobe's sole session was force-logged off, and `ap2flakobe-vm` is deallocated with zero sessions and session host `Shutdown`. The standing AVD scaling plan remained enabled. No detection surface was inspected. Executable provenance: [controller](../scripts/w52-kobe-collection-boundary.mjs) and [browser path](../scripts/w52-kobe-youtrack-boundary.mjs). |
| Retained AVD user-context synthetic file impact | Homer authenticated to `ap2timedhomer` and launched exact run `AP2-HOMER-RANSOM-BG-20260815T1112Z` through the remote canvas. As `AzureAD\HomerSimpson`, CloudAP-authenticated and medium-integrity in interactive session 2, it created and read six uniquely marked synthetic company text files under Homer's existing `C:\Users\HomerSimpson\OneDrive` folder, then in 3.4 seconds renamed each with `.ap2locked`, applied reversible bytewise XOR `0x5A`, and created one harmless `AP2-RESTORE-NOTE.txt`. The existing same-session OneDrive process did not expose a loaded account configuration, and three exact Graph path reads through `11:35:10Z` returned `404 itemNotFound`; this proves local activity in the retained OneDrive folder, not cloud synchronization or cloud-file impact. | Homer in his assigned AVD session; the Dev diagnostic app only staged the fixed script, signaled its two bounded phases, and recovered its output | Cleanup reversed the transform, matched all six original SHA-256 hashes, and removed the exact folder, note, staged script, user evidence, and marked processes. Homer's session was logged off and the VM was deallocated with session host `Shutdown`. No Defender query was performed, so detection and telemetry remain a separate question. Evidence commit `ad1c179` changed documentation only; the inert guest-side source is `scripts/homer-synthetic-file-impact.ps1.source`. |
| Security group and membership | Created an inert cloud-only security group, later added Kobe, observed him as the sole member after natural propagation time, removed him, observed the group empty, and deleted it. | Dev diagnostic app | Later exact-name read returned zero |
| User profile field | Set Kobe's `officeLocation` to an AP2 marker and later observed that marker. | Dev diagnostic app | Restored to `null`; later exact read confirmed restoration |
| User manager | Set Cory as Kobe's manager, later observed the exact relationship, and removed it. | Dev diagnostic app | Later read confirmed no manager |
| Disabled Conditional Access policy | Added only the two needed Dev-app permissions, created one exact policy in `disabled` state, validated its inert contract, and deleted it. The policy was never enabled or put in report-only mode. | Dev diagnostic app | Zero active exact-name matches; Entra audit and deleted-policy retention accepted |
| Exchange and message-trace diagnostics | Connected app-only to Exchange Online, read bounded organization configuration, and ran bounded message-trace diagnostics. The official Transport Data Platform Graph service principal also returned a successful trace read. | Dev diagnostic app and Microsoft Transport Data Platform service principal | Read-only; the Dev permissions and Exchange Administrator assignment remain |
| Defender posture snapshot | Read the latest Microsoft Secure Score and reduced 69 controls to tenant-level and category-level score aggregates. Older score history was reported as truncated and deliberately not paged. | Dev diagnostic app | Read-only |
| Microsoft security entitlement and activation baseline | A fresh Student-tenant audit found 25 active Defender/Purview add-on seats assigned to all 18 enabled members, including MDE P2, Entra ID P2, Endpoint DLP, Defender for Cloud Apps, advanced audit, insider-risk, communication-compliance, Defender for Identity, and Defender for IoT plans. The same users also retain Business Premium. After exact coverage checks, the Defender portal accepted one irreversible experience change from Defender for Business to Defender for Endpoint Plan 2: the single confirmation `POST` returned `200`, subsequent reads returned `overrideMdeFlavor: P2`, and the portal selected Plan 2 while warning that full propagation can take six hours. | Dedicated CBA operator for the supported portal change; Dev diagnostic app for read-only licensing, endpoint, Intune, Entra, GSA, Purview Audit, and Azure reconciliation | Existing endpoint optional-feature state was byte-for-byte unchanged, the four retained D2as_v7 endpoints remained onboarded and compliant, and all four VMs remained deallocated. The classic machine-group backend was reachable with an empty set, while its direct settings page still redirected during early propagation; no group, unified-RBAC role, endpoint policy, or other security setting was created or changed. A later authenticated follow-up repaired the expired operator CBA with one short-lived leaf under AP2's existing trusted issuer and standing authority, then restored the original mapping and removed all temporary credential state without changing any role or group. More than nine hours after the switch, portal-generated `GET` requests returned `overrideMdeFlavor: P2` and `200` with an empty classic machine-group set, and the Licenses page selected Plan 2. However, Endpoint settings still omitted Device groups, Microsoft's documented direct page redirected home, the subscription page retained its six-hour switch warning and mixed Business-protection text, and the Permissions page still offered trying the unified model rather than showing it as activated. The supported classic surface is therefore not currently usable in AP2, and narrow device-group indicator scope must not be relied on; the remaining boundary is Microsoft's tenant subscription/UI provisioning state rather than authentication or an AP2 configuration change. Protected evidence remains outside Git. |
| MDE Cloud Discovery telemetry | The MDE-only Cloud Discovery stream recorded one ChatGPT transaction attributed to `kobe@corywest.onmicrosoft.com` on managed endpoint `ap2flakobe`. This proves that the enabled MDE integration can contribute attributable endpoint network activity to Cloud Discovery, not completeness for other users, devices, or applications. | Kobe on `ap2flakobe` | Read-only; the MDE integration remains enabled |
| Endpoint DLP paste enforcement by destination | With one scoped Devices policy whose general browser-paste action was `Audit` and whose built-in `LLM Websites` override was `Block`, Edge 151 allowed the same synthetic Credit Card Number clipboard value into an unsaved YouTrack dashboard-name field and retained it unchanged for 60 seconds, but kept an unsent `chatgpt.com` prompt empty and displayed the Purview block notice after 22 seconds. Activity Explorer later attributed the corresponding `Pasted to browser` records to Kobe, `ap2flakobe`, and `msedge.exe`: `ap2-tester123.youtrack.cloud` at `2026-08-14T04:54Z` with enforcement mode `Audit`, and `chatgpt.com` at `2026-08-14T04:56Z` with enforcement mode `Block` and site group `LLM Websites`. This proves destination-specific allow/audit versus block for this exact policy, content, endpoint, browser, and two fields; it does not establish behavior for other destinations or policy compositions. | Kobe on `ap2flakobe` | The exact retest policy is deleted, Windows device monitoring is off, the synthetic file, browser/process, and interactive-session state are absent, and the VM is deallocated. Policy delivery previously took about eight minutes. In this retest Activity Explorer showed no items roughly eight minutes after the pastes and showed both attributable paste records about 50 minutes after the first paste, so telemetry is usable retrospectively but not prompt confirmation. Evidence commit `a78d41c` changed documentation only; the executable policy, browser, and telemetry method was not retained in Git. |
| Universal CAE through Global Secure Access | With supported GSA client 2.31.125, a fresh PRT, and attributable traffic, disabling Kobe at 00:56:02Z caused `AADSTS50057` reauthentication prompts from 00:59:32Z, disconnected the Internet channel at 01:03:33Z, and disconnected all GSA channels by 01:05:03Z. Restoring Kobe reconnected all channels at 01:09:43Z and attributable traffic resumed. | Kobe through the Global Secure Access client | Kobe is enabled, the temporary client is removed, and the VM is deallocated. This contained the GSA channels; it did not isolate the endpoint or block all direct HTTPS. |
| Standing Global Secure Access Internet acquisition | Rachel's retained AVD endpoint now has supported Global Secure Access client 2.31.125 and a direct assignment to the enabled built-in Internet traffic forwarding profile. The client reported that it loaded the forwarding profile, established the Internet channel, and connected all channels. A harmless ordinary Edge visit to AP2's existing public company-access page was independently visible through the supported Graph traffic-log API as transaction `4ae1f5b2-757f-4b72-b1f3-9a30c19b3b3f`: `rachel.green@corywest.onmicrosoft.com`, user ID `1e99b11d-f3b0-4e6f-86b5-1b4bf95012e9`, device ID `732767fb-a200-48bf-af95-817ed3906d76`, Windows 11 Enterprise, agent 2.31.125, `internet`, `seanewest.github.io:443`, `allow`, `success`, `msedge.exe`, and `EastUS2`. | Rachel through Edge on `ap2fastrachel` | The client, its four automatic services, and Rachel's minimum direct Internet-profile assignment intentionally remain standing. The five W73/YouTrack Conditional Access policies remained enabled, the installer stage is absent, Rachel is logged off with zero AVD sessions, and the VM was left running for its standing automatic idle-deallocation policy; no manual shutdown or deallocation was issued. Without a filtering/TLS-inspection profile, this HTTPS allow record exposed FQDN and initiating process but not path, HTTP method, or response (`destinationUrl` empty, `httpMethod` null, `responseCode` 0), so path-level HTTPS telemetry is not claimed. |
| Standing narrow Global Secure Access TLS inspection | Rachel's standing Internet Access path now uses one dedicated enabled security profile assigned only to her through Conditional Access. Its TLS policy defaults to bypass, retains Microsoft's enabled system bypass plus the recommended Education, Finance, Government, and Health and Medicine bypass categories, and adds one enabled inspect rule only for AP2's existing `seanewest.github.io` proof host. The customer CA is enabled and its protected root is trusted once in Rachel's local-machine root store. After one fresh Rachel AVD session and exactly one marked Edge navigation, supported Graph traffic transaction `6ca48e8b-0a1f-442c-8949-104c87a099b7` independently retained Rachel, her managed device, agent 2.31.125, `msedge.exe`, `seanewest.github.io:443`, `allow`, `success`, and East US 2 plus materially richer HTTPS details: `https://seanewest.github.io/ap2/company-access/`, method `GET`, response `404`, and TLS `intercepted` / `success` tied to the exact narrow policy and rule. | Rachel through Edge on `ap2fastrachel`; Dev diagnostic app for supported Graph/ARM reconciliation and backend observation | The query-string proof marker was not retained in `destinationUrl`, but the distinguishable HTTPS path, method, and response were. No content-blocking rule exists. The CA, endpoint trust, narrow TLS policy/rule, single-policy enabled security profile, Rachel-only assignment, GSA client, and direct Internet-profile assignment intentionally remain standing. The five W73/YouTrack policies remain enabled. Protected CA material is included in the existing encrypted development-runtime vault snapshot, whose 48-file restore set passed hash validation and an ARM subscription read. The nonpersistent controller closed, Rachel's exact disconnected session was logged off, zero Rachel processes and AVD sessions survived, and the VM remained running/available without a power operation for automatic idle deallocation. Reconciliation and traffic observation are in `scripts/rachel-gsa-standing.mjs`; the bounded actor request and no-power cleanup are in `scripts/rachel-gsa-edge-proof.mjs`. |
| Global Secure Access PDF upload control | From Kobe's managed endpoint, the same harmless PDF upload to a benign external HTTPS destination was first allowed and then blocked with HTTP `403` after applying the narrow GSA content rule, while an ordinary `GET` to that destination still returned `200`. GSA transactions attributed the enforcement to Kobe, the managed device, the intended security profile and rule, and TLS inspection. | Kobe through the Global Secure Access client | The experimental tenant policy, client, certificate, and endpoint artifacts were removed, and the VM was deallocated. |
| AP2 mock URL prevention timing | On Rachel's fresh D2as v7 desktop, Edge reached the AP2-owned mock URL before controls. An exact Defender URL indicator was accepted at the supported `All devices` scope, but Edge still reached it at 57 seconds, 1 minute 57 seconds, and 9 minutes 33 seconds; endpoint enforcement was not proven before removal. The parallel Entra Internet Access path used an FQDN block, Rachel-only filtering profile/Conditional Access policy, direct Internet-profile assignment, and GSA client 2.31.125. A fresh session connected all channels and Edge first returned `ERR_CONNECTION_RESET` 8 minutes 55 seconds after assignment; the exact URL returned `{"status":"ok"}` again 1 minute 23 seconds after the enforcement link was removed. | Rachel through Edge; Dev diagnostic app for bounded Defender and GSA configuration | The Defender indicator, temporary API grants, GSA policy/profile/link/Conditional Access policy, direct assignment, temporary existing-suite seat, client, services, installer stage, and sessions are absent. Rachel and Marge are deallocated with zero sessions. This proves only the observed exact URL/FQDN timing and does not infer coverage for other URLs, browsers, or endpoints. |
| Purview Network Data Security and Git-over-HTTPS boundary | A direct upload of a harmless PDF returned `201`; a direct upload of the same file class containing a synthetic credit-card pattern returned `403`. Purview record `589fdb2c-5f8e-4442-8c17-5154aaae1b6b` classified Credit Card Number at confidence 85 with `PatternMatch` and `Block`, correlated with GSA transaction `9e403483-1196-41f2-85d1-8e810a4b3cf9`. The identical protected SHA-256 then passed in Windows Git HTTPS `receive-pack` under transaction `662007d3-ceb8-41c2-ba26-a9126ccd9b9a`: GSA intercepted TLS but produced no content-policy match. This proves the tested direct-upload control and an observed Git protocol-opacity boundary, not equivalent inspection for other protocols or clients. | Homer on the managed Windows endpoint through Global Secure Access | WSL was absent, so its optional Git path was not tested. Temporary state was removed and the Homer VM was deallocated. |
| YouTrack SCIM deactivation persistence and outbound delivery | Before deactivation, Kobe's permanent token read `DEMO-13` with HTTP `200` and configured a harmless custom app marker. After Entra group removal and SCIM deactivation, YouTrack reported Kobe banned and retained the token record, but the same token read returned `403`; after restoration, the unchanged token returned to `200`. A later one-cycle proof preserved the authorization distinction: a fresh temporary Kobe token configured an app marker and was deleted before deactivation. The app delivered once to a lab-owned receiver before deactivation and, while Kobe was banned, an administrator invoked the still-running app and it delivered the distinct deactivated checkpoint with HTTP `204`. This proves that user-configured app state and backend outbound delivery can remain operational while the configuring user is banned; it does not mean the banned user's own token remains authorized, and it does not prove that every native webhook or integration has the same ownership model. | Kobe for temporary app configuration; YouTrack administrator for state observation and bounded app invocation | Kobe is restored in `AP2 YouTrack Users` and unbanned. Both SCIM jobs are active. The temporary token, app, receiver, container image, managed identity, role assignment, marker, and local artifacts are absent. Evidence commit `0f5f808` changed documentation only; the recovered fixed-identity method is in `scripts/youtrack-deactivated-app-delivery.mjs`. |
| Mail folder | Created and deleted one ordinary visible top-level Cory mail folder. No message or send route was used. | c91 delegated — Cory | Exact folder absent |
| Help-desk scenario email | The fixed operation succeeded once through the local product route and twice through the hosted SPA/API route. The latest authorized hosted button click made exactly one API `POST`, received `202`, and added exactly one non-draft message in Cory's Inbox with the exact Kobe sender, sole Cory recipient, subject, and body. | Dev diagnostic app triggered the local proof and observed the mailbox; the dedicated CBA operator triggered the hosted proofs; c91 delegated — Kobe was the Microsoft mail actor | Three exact messages are intentionally retained and privately inventoried for later cleanup; this proves Outlook email only, not a Teams call, missed call, or voicemail |
| Private document staging | One reviewed delegated canary used two simulated users: the first created a unique private run folder and fixed harmless text document in their tenant-local business drive, then reconciled one direct signed-in `read` permission for the second user with no link or invitation. The second user's backend read did not prove visibility, so interpretation, response, audit, and detection are unclaimed; this is historical staging evidence, not unfinished learner-workflow work. Later OneDrive read-only-share evidence separately proved actual direct cross-user readability through Marge's protected URL. | c91 delegated — first simulated user for staging and cleanup; c91 delegated — second simulated user for the bounded read | Permission, file, and empty-folder cleanup succeeded; three fresh-token terminal rounds proved the first user's object absence and the second user's access absence. |
| Disabled Inbox rule | Created and deleted one exact harmless disabled rule. | c91 delegated — Cory | Exact rule absent |
| Outlook category | Created and deleted one exact category. | c91 delegated — Cory | Exact category absent |
| Unsent draft | Created and deleted one exact draft while keeping send, reply, forward, and recipient routes at zero. | c91 delegated — Cory | Exact draft absent |
| SharePoint file | Uploaded the exact bounded file to the fixed site, validated its bytes, and deleted it by exact identity/eTag. | Dev diagnostic app | Active path returned `404`; recycle-bin/audit history retained |
| Temporary To Do list | Created and deleted one temporary list without tasks or sharing. | c91 delegated — Cory | Exact list absent |
| Temporary To Do list/task lifecycle | Created a temporary list and task, completed the task, then deleted both. No sharing or mail route was used. | c91 delegated — Cory | Exact task and list absent |
| Calendar event conditional-delete check | Graph accepted one event `DELETE` carrying a genuinely stale event ETag with HTTP `204`, proving that `If-Match` was ignored on the tested route. | Dev diagnostic app | Read-only follow-up found the exact event absent, marker count zero, and preview eligible `0` / indeterminate `0` |
| Application-owned draft observation | The Dev diagnostic app placed one marker-bound draft in Cory's mailbox without Cory signing in. The draft had no recipient, attachment, link, or send-family action. A separate aggregate Drafts inventory found exactly one recipient-free, attachment-free, low-importance AP2-marked draft. | Dev diagnostic app for creation; separate bounded inventory for observation | This adds app-only actor semantics to the draft capability; it does not prove delivery or message influence. The draft remains privately identifiable for deferred cleanup. |

The contact and disabled-rule operations were also exercised through the
production-shaped local SPA, rootless API container, operator CBA, and Cory
CBA before their hosted proofs. Those runs corroborate the same product paths;
they are not additional tenant capabilities.

## Proven scenarios

These capability compositions were performed against Microsoft. They are
factual evidence, not entries in a registry or templates for future work.

| Scenario | Staged activity | Observation and cleanup | Boundary still visible |
| --- | --- | --- | --- |
| External enrollment visit to a distinct authenticated source | In run `AP2-RACHEL-FIRSTLEG-20260821T180118Z`, Rachel established her assigned healthy AVD desktop through genuine Windows App X.509 authentication; AVD attributed session 2 to her exact UPN and `AzureAD\RachelGreen`. From that Windows session, Rachel's Edge process opened the deployed AP2 company-access page at `seanewest.github.io` with the exact run marker. Protected visual evidence shows the public HTTPS URL and, after one click at `18:37:01Z`, `Trusted user action: true`. The endpoint resolved the public GitHub Pages addresses and reported Azure egress `20.124.123.141`; a guest process read bound the marked top-level Edge command to Rachel. | At `18:37:25Z`, after the endpoint interaction, a new disposable Chromium context on separate AP2-controlled Linux worker infrastructure completed supported X.509 sign-in to the AP2 SPA. By `18:37:30Z`, protected visual evidence showed `Signed in as Rachel Green` and her exact UPN while the SPA disabled actions because this tenant had no usable API connection. The new context reported Linux/HeadlessChrome 149 and worker egress `173.61.152.119`, distinct from the Windows endpoint. Entra then recorded `After Party Exploratory` / Microsoft Graph at `18:37:27Z` from unmanaged Linux Chrome and the worker's IPv6 address; its expected keep-signed-in interrupt records `X.509 Certificate` and `succeeded: true`. MDE remained onboarded and healthy with no matching alert, and no GSA service was present. The marked Edge process and temporary browser root were removed, the disposable Linux context was closed, Rachel's authentication-method inventory remained password-only, and the VM finished deallocated with host `Shutdown` and zero sessions. A later read-only inspection found the matching raw MDE process/network rows and Entra's completed `18:37:28Z` interactive success; see the [W71 defender evidence map](w71-defender-evidence-map.md). The 2026-08-22 standing MFA baseline now prevents that inventory fact from implying password-only resource access. | This strengthens the first-leg transition with a real AP2-owned external site, user-endpoint process and network provenance, and a separate same-user Microsoft-authenticated browser on materially different controlled infrastructure. It does not reproduce credential theft, token replay, MFA bypass, attacker infrastructure, or an adversary obtaining access. One pre-visit AP2 X.509 primer and the Windows App flow shared the controller context only to establish the user endpoint; the claimed second source is the fresh post-visit context, and no credential was exposed or transferred. No payload, persistence, authentication-method registration, policy change, or post-ATO activity occurred. GitHub Pages supplies public HTTPS hosting but no AP2-held request log, so the external visit is proven by the endpoint-side URL, trusted interaction, process ownership, DNS, and egress evidence rather than a server access record. |
| Inbox-rule persistence and effect | The Dev diagnostic app created one enabled Cory Inbox rule limited to an exact AP2 subject marker, mark-read, and stop-processing actions. A later single, non-retried app-only send delivered that harmless marker message from Homer to Cory. | After one bounded wait, one unpaged Inbox read found exactly one matching message already marked read with no attachment. A separate inventory had confirmed the rule shape and tenant-wide mailbox-settings reach. | This proves the mark-read effect, not runtime stop-processing. A later exact-rule deletion returned `204`, but two separately authorized exact-ID confirmation reads returned `500`; rule absence is therefore unconfirmed, and no second message was sent. |
| Dormant OAuth application remediation | The Dev diagnostic app registered one single-tenant application with one short-lived password credential, then discarded the generated secret without storing or using it. The application had no service principal, permissions, roles, scopes, keys, or redirect URI. | A tenant-wide aggregate inventory found exactly one full dormant-configuration match. Defender remediation later deleted that exact inert application; after natural propagation, its exact lookup returned `404` and the bounded aggregate inventory contained zero dormant matches. | The application never obtained workload access. Immediate and naturally delayed directory-audit reads did not produce an exact actor-and-target correlation, so audit visibility remains unproven. |
| SharePoint document tampering and recovery | The Dev diagnostic app created one uniquely named, unshared harmless file and overwrote it once with different harmless content. One capped, unpaged version read returned exactly the expected original and overwritten versions. | Defender recovery restored the unambiguous original version and proved the exact original bytes before conditionally deleting the file. Exact ID and path reads then returned `404`. A later distinct fixed detector reached Microsoft Graph v1 Purview Audit Search app-only without changing authority. | Overwrite and version restoration were unconditional, so this proves only the fresh, canary-owned file contract. Both retained audit searches later reached `succeeded`; their capped pages contained the same two records with the exact frozen producer application, allowed operations, marker target, target type, event window, and correlation. Correcting only the supported Graph record-type casing makes operation-level producer attribution `live-proven`. This does not prove content collection or every workload operation. The product minimum is `AuditLogsQuery-SharePoint.Read.All`; the retained diagnostic detector currently has a broader audit role. See also the [Purview operation-audit contract](purview-audit-contract.md). |
| Defender email-attachment prevention | One internal Homer-to-Cory message carried Microsoft's standard EICAR test attachment and was submitted exactly once. | Within five minutes, message trace and Defender hunting correlated one quarantined message and attachment with malware, blocked, quarantine, and antimalware-engine evidence; Cory's Inbox contained no matching message. | No exact alert or incident appeared. The learner evidence is in Threat Explorer or the email entity, message trace, hunting, and Quarantine. The attachment must not be released, previewed, downloaded, or opened; quarantine and audit residue can remain. |
| Teams group-chat membership remediation | Homer created one marked group chat with Cory and Kobe, later added Marge with a frozen history cutoff, and posted one harmless plaintext insider-style lab message. | Exact retained-identity reads proved the marked topic, Homer/Cory/Kobe/Marge roster, Marge's cutoff, and the sole Homer-authored message. Cory then identified and removed only the unexpected participant through the learner UI. One exact post-action membership read proved Cory, Homer, and Kobe retained and Marge absent; protected learner evidence showed the original warning message still visible. | The native member-add system-event predicate did not match, and Purview audit correlation remains unproven. The marked chat, its three intended members, warning message, membership history, and audit history remain for the separately authorized broader cleanup pass. |
| Guest-local fake verification click through Win+R | In run `AP2-RACHEL-CLICKFIX-20260820T031600Z`, Rachel used one worker-owned session on fresh retained D2as_v7 host `ap2fastrachel`. Guest Edge loaded the AP2-owned localhost fake Verify page. Its visible result recorded a trusted click, exact corrected command SHA-256 `055394DB9160D87BEDE49F3E0455049923A8CFF7C0A5A5C700F7E7508B569DB8`, and successful `navigator.clipboard.writeText`; without disconnecting, the same guest clipboard value was pasted into Win+R and submitted once. | The exact `explorer.exe` child PowerShell command decoded to `Write-Host 'Hello World'`, remained allowed under unchanged default posture, and visibly printed `Hello World`. MDE produced one High `Suspicious command in RunMRU registry` alert whose first event was 75.8 seconds before alert creation. The exact PowerShell process, mock task/stage, and RunMRU value were removed; Rachel finished deallocated with host `Shutdown` and zero sessions. | This is safe incident mimicry inside AP2-owned infrastructure: the page, user, endpoint, and command were controlled lab assets, and the fixed command was harmless while still producing the realistic browser → clipboard → Run → `explorer.exe` → PowerShell evidence chain. The mock's optional localhost POST receipt failed after the clipboard write, so the trusted event, exact command/digest, and `writeSucceeded` result are retained as protected visible guest evidence rather than a server receipt. This proves that bounded interaction/evidence chain, not a real compromise, and it does not rely on or prove any external Windows App clipboard transfer. The retained direct automation is `scripts/guest-clickfix-proof.mjs`. |

## Identity and infrastructure proofs

- A 2026-08-19 live reconciliation distinguished 16 enabled simulated users
  from two enabled control-plane humans, with no guest or disabled user in the
  tenant. The first pass preserved Kobe and an overlapping temporary Rachel
  assignment while adding the Suite only to the other 14 users. After that
  experiment removed Rachel's temporary assignment, a fresh reconciliation
  preserved the other 15 and restored only Rachel. All 16 now have active
  direct assignments with no disabled plans; Entra Premium Internet Access,
  Entra Premium Private Access, and AAD Premium P2 each report `Success` for
  every user. The 25-seat pool has 16 consumed and 9 available. The temporary
  GSA filtering and Conditional Access objects remain absent, Rachel has no
  forwarding-profile assignment, and Kobe's pre-existing assignment remains;
  the bounded repair wrote only Rachel's Suite license.
- The retained AVD sizing preference is `Standard_D2as_v7`, with
  `Standard_D2as_v5` and `Standard_D2s_v3` as bounded in-place fallbacks.
  Rachel, Homer, Marge, and Kobe are at that preferred size. Homer, Marge, and
  Kobe were rebuilt with fresh Windows 11 guest state as `ap2homerfresh-vm`,
  `ap2margev7-vm`, and `ap2kobefresh-vm`, each with a new NVMe OS disk, NIC,
  managed identity, Entra device, compliant Intune record, onboarded Defender
  machine, and AVD session-host identity. Their existing personal host pools,
  direct assignments, desktop application groups, workspaces, `SessionDesktop`
  resources, Start VM on Connect, RDP properties, user roles, and the four-pool
  scaling-plan relationship were preserved. The old `ap2timedhomer`,
  `ap2margefresh`, and `ap2flakobe` hosts, VMs, disks, NICs, managed identities,
  Entra devices, and Intune records are absent. Homer's marked recovery
  snapshot and ordinary stale Defender history remain; Marge and Kobe retained
  no snapshot or old billable resource, only ordinary stale Defender history.
  Homer, Marge, and Kobe finished deallocated with host `Shutdown` and zero
  sessions. Kobe's replacement opened no interactive Kobe session and made no
  Marge, Rachel, or Homer change.
- Native Azure Virtual Desktop personal-host scaling now provides standing cost
  control for the four retained endpoint pools. The single East US plan in
  `rg-ap2-avd-fast-rachel`,
  `ap2-retained-personal-host-cost-control` references and enables
  `ap2fastrachel-hp`, `ap2flakobe-hp`, `ap2imgmarge-hp`, and
  `ap2timedhomer-hp`. Its seven-day personal schedule has scheduled ramp-up
  starts disabled (`None`), enables Start VM on Connect in ramp-up, peak,
  ramp-down, and off-peak, and uses `Deallocate` after 120 minutes for both
  disconnected and logged-off sessions in every phase. Azure propagated Start
  VM on Connect to all four host pools. The Azure Virtual Desktop service
  principal `14ae7dce-2410-4728-89fb-13c3c66233b9` has exactly one matching
  assignment: built-in `Desktop Virtualization Power On Off Contributor`
  (`40c5ff49-9181-41f8-ae61-143b0e78555e`) at the subscription scope required
  by native power-management autoscale. An initial read found no sessions and
  all four VMs deallocated. The immediate mutation gate again found no sessions;
  three VMs remained deallocated while Kobe was already starting from a
  separately attributable Dev-app VM-start request accepted before the scaling
  schedule existed. The configuration performed no direct VM or guest
  operation and did not disturb that overlapping experiment. Exact rollback is
  to delete child schedule `ap2-all-days`,
  delete that scaling plan, delete role assignment
  `095b11b2-054c-45c0-abe8-50ce96bfa85b`, and restore each of the four host
  pools' recorded prior `startVMOnConnect=false` value.
  Evidence commits `2108b9b` and `cda5c3c` changed documentation only; the
  exact provisioning and reconciliation executables were not retained in Git.
  A 2026-08-18 live reconciliation found the same complete
  `redirectclipboard:i:1` property on all four pools without changing their
  other RDP properties. Intune contained no clipboard or Remote Desktop
  configuration, and Marge's running host had no effective clipboard-blocking
  registry value; its current `rdpclipcdv.exe` and `rdpinputcdv.exe` processes
  were running in Marge's active session with no matching AppLocker or Code
  Integrity block event. No Azure, Intune, guest, session, VM, or scaling-plan
  setting was changed. A fresh Rachel Windows App context then reloaded its
  `SessionDesktop` resource and established a new connection. A unique text
  marker written to the client clipboard appeared exactly in the remote Run
  dialog; a Rachel-owned guest receipt independently read the same clipboard
  value as `AzureAD\RachelGreen` in interactive session 2. Cleanup removed the
  receipt and guest root, logged Rachel off, and deallocated her VM while the
  standing scaling plan and Marge's exact active session remained unchanged.
  This proves the reconciled AP2 server path and a freshly loaded Windows App
  web client. Marge's observed failure is therefore isolated to her cached
  resource/existing connection or local client state: refresh Windows App
  resources, fully disconnect that connection, and establish a new one before
  retesting clipboard. A later Rachel W32 recovery did not reproduce that
  client-to-guest transfer on either its existing or newly created session,
  despite proving trusted `navigator.clipboard.writeText` and exact immediate
  readback on the AP2 localhost page; an empty guest paste is therefore not
  evidence that a guest prevention control blocked the value.
- A 2026-08-19 Homer-only prevention probe kept the AP2 mock page inside the
  guest, independently of Windows App clipboard transfer. With Intune's Edge
  `DefaultClipboardSetting=2` locally effective, one trusted text-only
  `navigator.clipboard.writeText` call still succeeded while `readText` was
  denied; this policy does not prevent that trusted sanitized write. With
  device-scoped `NoRun=1` locally effective, one Win+R probe produced no Run
  dialog and launched nothing. The smallest tested AppLocker CSP profile used
  one Homer-device group and one EXE collection intended to allow the baseline
  while denying Windows PowerShell, but Intune reported the profile remediated
  without creating its exact local WMI Bridge CSP instance or a matching MDM
  event. Empty `Get-AppLockerPolicy` and `SrpV2` results are not CSP evidence:
  Microsoft's AppLocker cmdlets cover local/domain Group Policy only. A
  follow-up reproduced the remediated-without-CSP result, then applied the same
  Homer-SID-only rule through supported local AppLocker policy. Local and
  effective views showed `EnforcementMode=Enabled`, the Homer SID matched the
  intended profile, a syntax/path evaluation returned denied, AppIDSvc was
  running, and event 8001 confirmed policy application. The exact approved
  Branch 3b input sequence was sent once through Homer's AVD session, but that
  path did not independently read back the Run field before Enter and produced
  no AppLocker allow/block event, process creation record, PowerShell host
  event, or benign marker. Its behavioral result is therefore indeterminate
  with no launch evidence, not a proved block, and it was not retried. A bounded
  continuation reused the Kobe no-clipboard Run-dialog method in Homer's same
  standard-user context. Guest UI Automation read back the complete approved
  Branch 3b command exactly before one remote-keyboard Enter. AppLocker event
  8004 for Homer's exact SID recorded `%SYSTEM32%\WINDOWSPOWERSHELL\V1.0\POWERSHELL.EXE`
  prevented 363 milliseconds later; no benign marker, Notepad, matching
  PowerShell process, matching PowerShell host event, or Security 4688 record
  appeared. This is a definite block for that exact command and rule. RunMRU
  did not change on the blocked launch, so it is not submission evidence for
  this path. Cleanup restored the empty local policy,
  removed the temporary CSP/profile/scope/grants and the prior NoRun provider
  residue plus the continuation's tasks/files, and left Edge clipboard and
  NoRun absent. Homer finished deallocated with AVD host `Shutdown`, zero
  sessions, and the standing four-pool scaling plan unchanged. No
  runtime-specific executable was retained in Git.
- YouTrack proved an Entra-managed SaaS lifecycle: assignment through `AP2 YouTrack Users` and SCIM created/updated Marge, Entra SSO succeeded, removal from scope sent `active=false` and YouTrack retained the account as banned rather than deleting it, and the entitlement group now contains exactly Homer, Cory, Marge, and Kobe.
- A parallel non-gallery `AP2 YouTrack SAML + SCIM (staged)` enterprise app successfully provisioned all four assigned users through its own Entra SCIM job. Marge completed the staged Entra SAML path under Defender Conditional Access App Control, remained on the `.mcas.ms` reverse-proxy origin, and had an ordinary Cut/Copy action explicitly blocked. After making that staged SAML module YouTrack's default authentication provider, Sean also live-proved the learner-facing one-click path: a fresh My Apps tile launch went directly into the authenticated proxied YouTrack workspace without either provider-chooser click, while Cut/Copy remained blocked.
- Defender allowed Cory to download a DOCX through the proxied YouTrack path, applied the existing `Confidential - All Employees` encrypted Purview label to the downloaded CDFV2 copy, and left the original attachment's SHA-256 unchanged. This proves protected download transformation without source-file mutation; it does not prove enforcement for other labels or file types.
- After repairing the learner-session identity mapping and project access, Cory and Marge both opened the same YouTrack issue through the proxied staged SAML path. Sean then proved the intended user distinction against the same shared attachment: Cory downloaded it, while Marge received the Defender download block. This proves the narrow user-scoped policy effect, not a device-state distinction.
- GitHub Enterprise Cloud with Enterprise Managed Users proved Entra OIDC SSO, Entra SCIM managed-user lifecycle, managed enterprise administration, and attributable organization activity in the `ap2-v2` enterprise. The Microsoft Defender for Cloud Apps GitHub API App Connector is telemetry-proven: Defender `CloudAppEvents` recorded `repo.create` for `ap2-v2-lab/defender-connector-proof` attributed to managed administrator `admin_ap2`, and GitHub's organization audit log independently recorded the same action, repository, actor, and millisecond timestamp. This proves SaaS-native connector ingestion, distinct from browser session proxying. A later reversible control probe in `ap2-v2-lab/maintainer-control-proof` produced GitHub audit records for `protected_branch.destroy` and `protected_branch.create`, both attributed to `admin_ap2`; an Advanced Hunting recheck about 45 minutes later returned zero GitHub `CloudAppEvents` matching either action in the normalized action type or raw connector payload. The connector therefore did not surface those branch-protection actions in the observed window. After the enterprise deploy-key policy was cleared and `ap2-v2-lab` enabled deploy keys, the decisive disposable Ed25519 key created with `read_only=false` cloned the private `maintainer-control-proof` repository and pushed temporary commit `2c1939d78ff08becb05495196e5874ed8ab48936` to a temporary branch. SSH `ls-remote` returned that exact commit and GitHub populated the key's `last_used`. Enterprise audit attributed `public_key.create`, `public_key.verify`, and `public_key.delete` for the exact write key to `admin_ap2`; this records key lifecycle and use, but not a distinct push action. Defender Advanced Hunting returned zero matching GitHub `CloudAppEvents` at roughly four and ten minutes, which is only a bounded ingestion observation. The temporary branch, marker, key, and private material are absent, the deploy-key list is empty, and `main` remains at `34a2a17402f289aec68b0a808eb9d7105405bcc7`. The recovered bounded canary is `scripts/github-deploy-key-probe.mjs`; evidence commit `aa0820e` changed documentation only.
- A lab-owned YouTrack-to-GitHub workflow reused the proven same-attachment outcome: Marge was blocked while Cory downloaded `DEMO-13` attachment `12-2` through the controlled session. A fresh YouTrack read found the original still 1,621 bytes with SHA-256 `c40351f62d0d52216080ddd4721c6a87bffb3edf06efe45e665a1fef06edc11f`; the Cory-downloaded copy remained a distinct 46,592-byte CDFV2-encrypted file with SHA-256 `6f97649b63c81a43396b33d1a8d38d2f0e5e10a852d73b57c71883b27fe276e3`. Cory received temporary ordinary member/write access and used his managed `cory_ap2` browser session to commit that exact encrypted blob to private `ap2-v2-lab/youtrack-protected-artifact-proof`; repository history attributed commit `07b5411` to `cory_ap2`. YouTrack's attachment activity recorded the source attachment addition but no download, and no endpoint event was collected; the transition proof at that layer is file type, size, and hashes. GitHub's complete organization audit feed recorded `repo.create` and `repo.add_member` by `admin_ap2` but no Cory/git event. Defender ingested those surrounding administrator events yet still showed no file-commit event after eight minutes, so the connector cannot presently evidence the developer's artifact movement. Cleanup reset `main` to its exact initial commit, removed the protected path, and left Cory with no repository permission or organization membership. The inert private repository shell remains because the managed-admin token lacks repository-delete scope and the delete attempt returned `403`; temporary browser state was removed.
- A Product-owned multitenant app can produce a Student service principal
  through real external-tenant sign-in.
- Real delegated operator tokens and real Dev app-only tokens pass the same
  fail-closed API boundary only with the fixed Student issuer, audience,
  signature, lifetime, caller ID, and exact delegated scope or application
  role. Delegated and app-only claim shapes remain separate.
- Homer, Cory, Marge, Kobe, and Rachel have each completed fresh CBA sign-in
  through the shared simulated-user client for the delegated scopes needed by
  the bounded rehearsals. For Rachel, live policy reads also confirmed that
  `AP2 Simulated User CBA` is an explicit X.509 policy include target and that
  Rachel is a direct member; her fresh RSA/MFA token and Graph `/me` bound the
  new standing protected credential to her exact Student object. The reusable
  CBA flow is in `api/simulated-user-cba.ts`; five-user local readiness is in
  `scripts/check-ap2-durable-runtime.mjs` as updated by `ff96632`.
- The deployed in-memory MSAL cache completed one cold Cory workload action
  followed by a different-scope Cory action without a second interactive CBA
  flow, then removed both created artifacts.
- The deployed HTTPS shape is GitHub Pages -> exact-origin CORS -> one Azure
  Container App, backed by an ACR and Container Apps environment. No private
  network, custom domain, Log Analytics workspace, or CI-gated API deployment
  was added for this rehearsal.
- The API MI has called both Azure Resource Manager (rehearsal status) and
  Microsoft Graph (the hosted SharePoint write). Its ACR pull path is also
  live.
- The production container has been built and run rootlessly, launched its
  bundled headless Chromium, served health and authenticated routes, exercised
  delegated and app-only tokens, and shut down cleanly on `SIGTERM`.

## Accepted residue and limitations

- **The Homer retained-AVD variant remains blocked at Microsoft guest
  authorization after its supported repair paths were exhausted; it is not a
  scenario-wide blocker.** The Rachel composition above proves the broader
  enrollment-to-distinct-session first leg on a healthy retained endpoint. The
  follow-up began from the clean result of
  `AP2-HOMER-ENROLL-20260821T052732Z`: the retained personal host was assigned
  only to Homer, deallocated with zero sessions, and Homer had only his original
  password method. Readiness checks found the exact Desktop Virtualization User
  and Virtual Machine User Login assignments, a healthy Entra join and
  `AADLoginForWindows` 2.2 handler, Homer as the sole member of Remote Desktop
  Users, and no applicable Conditional Access or legacy per-user MFA policy.
  Windows allowed Administrators and Remote Desktop Users through Remote
  Desktop Services and had no remote-interactive deny; its network and local
  deny entries covered only the built-in Guest account.

  The repair chronology stayed inside supported controls. Windows Cloud Login
  tenant RDP authentication was disabled, so it was enabled once and reconciled
  `true`. The pool was tested with modern `enablerdsaadauth:i:1` alone and then
  restored to its retained compatible pair with `targetisaadjoined:i:1`; the
  retired web-client URL now redirects to the same Windows App service. Exact
  Homer or Remote Desktop Users grants were separately tested for network,
  local-interactive, and remote-interactive logon while every deny entry was
  held unchanged. None changed the result, so all experimental grants were
  removed and the original allow and deny lists were verified exactly. A
  supported reinstall of the healthy Entra login extension also did not change
  the result. It securely rejoined the same VM under a new Entra device object;
  its required Intune `mdmId` setting was restored, the new device authenticated
  successfully and auto-enrolled, and the old device is soft-deleted. The new
  Intune record is still `unknown` and has no primary user; the existing Dev app
  can read but received `403` when asked to assign Homer, so that management
  association now requires an Intune-authorized owner path or natural service
  reconciliation.

  The decisive connection evidence is from protected run
  `AP2-HOMER-FIRSTLEG-20260821T074300Z` and was reproduced after every later
  repair. Windows App parsed `enablerdsaadauth=1`, explicitly selected RDSAAD,
  acquired an `AadAccessToken` silently, and completed the RDSAAD assertion.
  The guest then returned `0xD000015B` / `LogonTypeNotGranted`. Windows Security
  independently recorded Homer at domain `AzureAD`, null target SID, logon type
  3, status `0xC000015B`, initiated by TermService as NetworkService; the local
  session log remained empty and AVD exposed only a `Pending` Homer session.
  This separates attribution cleanly: Chromium/Windows App and Entra supplied
  genuine Homer X.509 and AVD authentication; AVD delivered the connection and
  token; the retained endpoint rejected it before creating a Homer Windows
  token. Consequently Edge never opened, the AP2 loopback enrollment page
  retained no click receipt, and the public AP2 site was never visited. MDE is
  only the naturally onboarded endpoint surface and no alert is claimed; the
  endpoint still has no GSA client and no GSA event is claimed.

  A final independent guest recovery path ruled out corruption unique to the
  retained disk and stale AVD registration. The marked 2026-08-08 Trusted
  Launch recovery snapshot was copied to a private, no-public-IP disposable
  `Standard_D2s_v3` VM while `ap2homerfresh` stayed untouched. The restored
  image's deleted Entra join was removed through the supported extension
  lifecycle, producing a fresh active device object. Its stale AVD agent and
  boot-loader packages were uninstalled and the official host-pool DSC package
  installed them again with a short-lived registration token that was then
  deleted. The resulting `ap2timedhomer` recovery host was `Available`, had zero
  sessions, and passed every reported health check, including its fresh Entra
  device ID. Homer's exact VM User Login role and personal-host assignment were
  moved to it only after those checks.

  The first connection to that separate host reproduced the boundary in run
  `AP2-HOMER-FIRSTLEG-RECOVERY-20260821T100000Z`. Entra recorded a successful
  interactive `Windows App - Web` / `Azure Virtual Desktop` sign-in at
  `10:19:32Z`; the preceding expected keep-signed-in interrupt recorded Homer's
  X.509 step as successful. AVD created one `Pending` Homer session, while the
  recovery guest independently recorded RDSAAD failure `0xD000015B` followed by
  handshake failure `0x8007052E` at `10:19:51Z`. No Homer Windows token or local
  session was created. This cross-host reproduction uses a different disk, VM
  identity, Entra device, managed-device record, and freshly installed AVD
  agent, so further retained-guest rebuilding is no longer a useful repair
  path; the remaining dependency is external Microsoft RDSAAD guest
  authorization.

  Final cleanup across both paths removed every exact staging task/root and
  pending session. The disposable recovery session host, VM, disk, NIC, role,
  Entra device, and Intune record are absent, and the registration token is
  absent. Homer's assignment is restored to `ap2homerfresh`, deallocated with
  host `Shutdown`, zero sessions, original logon rights, healthy extensions,
  compatible pool properties, and Homer's authentication-method inventory still
  contained only his password. The 2026-08-22 standing MFA policy now supersedes
  the inference that this permits password-only resource access. Edge never opened
  on either failed path; the enrollment visit and trusted-Continue receipts and
  an AP2 SPA session are absent. MDE participated only as the naturally
  onboarded endpoint surface, with no alert claimed; neither endpoint had a GSA
  client or claimed GSA event. No passkey, other authentication method,
  post-ATO activity, credential capture, token replay, MFA bypass, payload,
  persistence, or fabricated telemetry occurred. Owner-authorized Intune
  primary-user/compliance reconciliation remains relevant only to the retained
  replacement device identity; further local allow grants, guest rebuilds, or
  authentication-policy changes would repeat disproven techniques or weaken
  the retained boundary.

- **Cleanup means no active AP2 artifact or effect.** It does not erase
  Microsoft audit, message, cancellation, recycle-bin, deleted-item, or
  deleted-policy history.
- **Ordinary-VM WCD bulk enrollment is not proven.** The protected design had
  no retained package or bulk token. Microsoft's supported token acquisition
  is an interactive password/CBA step in the Windows Configuration Designer
  desktop wizard, while its CLI only builds from existing customization input.
  The 2026-07-29 unattended experiment stopped before tenant mutation, VM
  creation, or spend after the wizard appeared in a shared physical Windows
  session. WCD, its exact project directory, package/project files, marker
  resources/devices, package identity, and tenant mutation were reconciled
  absent. If a future endpoint question needs this path, the package would need
  to be authored in an isolated interactive Windows client before using the
  retained [headless execution contract](shared-device-provisioning-package.md).
  This is a limitation, not an active backlog item.
- The dedicated Teams Call Canary's first authorized audio-only create attempt
  retained only a `4xx` class. A separately authorized unanswered
  follow-up then made exactly one create attempt with the corrected diagnostic
  image. Microsoft Graph definitively returned HTTP `403`, error code `7505`,
  and `Request authorization tenant mismatch.` before assigning a call
  identity. No incoming or missed-call UI event, callback, voicemail route, or
  hang-up occurred, so Teams calling remains unproven. The visible token,
  application, service principal, Azure Bot, and Cory target tenant bindings
  were exact. Fresh authoritative reads additionally proved the token issuer
  and service-principal claims, subscription tenant, Azure Bot single-tenant
  fields, Cory's tenant-local Member identity, and the catalog definition's
  bot relationship. Microsoft exposes no readable Cloud Communications
  calling-registration record or official `7505` repair contract, so the
  remaining cause is Microsoft-internal and no tenant mutation is justified.
  The request matches Microsoft's current one-target service-hosted example;
  the proposed `direction`, `subject`, `source`, and audio-group additions
  belong to the group-call example. The service is on one healthy,
  exact call-disabled replica with literal
  `TEAMS_CALLING_BOT_RUN_CANARY=false`; its application, sole
  `Calls.Initiate.All` grant, fixed Cory installation, protected certificate,
  disabled revisions, exclusive reduced journal, and platform history remain
  for Microsoft support or separately authorized cleanup. A controlled
  licensed-user Teams call is the smallest authentic artifact pivot; it
  requires a separate originator session and fresh explicit call authority.
- A separately authorized controlled-user canary then proved the authentic
  Teams-native artifact path. Sean placed exactly one client call from licensed
  fictional lab user Kobe to Cory. Cory's Calls history showed one
  `Missed incoming` Kobe entry, and Activity showed one matching missed Teams
  call; both clients were terminal afterward and no second call was observed.
  This proves bounded human-assisted user-to-user artifact creation, not
  unattended automation. Exact elapsed time and all voicemail behavior remain
  unproven and were not inspected. The Graph-bot `7505` blocker is unchanged.
- The later bounded operator-free Teams Web voicemail experiment reached a
  precise negative boundary. Fresh nonpersistent Kobe CBA authentication
  succeeded in Teams Web. Attempt 1, using fresh headless Chromium with the
  deterministic fake-microphone WAV, placed one genuine Kobe-to-Cory call that
  Cory independently recorded as `Missed incoming` at 05:56 UTC with duration
  0:00, but the call control collapsed before the WAV's delayed markers and no
  Cloud Voicemail appeared. Attempt 2 used a technically distinct headed
  Chromium/Xvfb path but failed locally before Microsoft accepted another call,
  and Cory showed no second history entry. Final accepted outbound call count
  was 1 of the authorized maximum 3; both permitted Teams Web variants are
  exhausted. This proves unattended browser automation can originate the native
  missed-call artifact, but **Cloud Voicemail deposit is not proven by this
  path**. A materially different media/calling path or human-assisted voicemail
  deposit would be a new experiment requiring fresh approval; Graph bot error
  `7505` should not be retried as though still unresolved. The separately proven
  Kobe-to-Cory help-desk Outlook email remains an honest non-call fallback and
  must not be described as Teams voicemail. Git retains the fake-media
  prerequisite in `scripts/create-deterministic-voicemail-wav.mjs` and
  `scripts/check-ap2-durable-runtime.mjs`; the Teams Web call automation was not
  retained in Git.
- One reviewed direct provider request registered
  `Microsoft.DesktopVirtualization` in the exact Student lab subscription.
  That provider and possible Microsoft provider-identity residue are accepted
  and must not be removed. Each completed AVD canary temporarily granted the
  Dev actor only Intune configuration write and managed-device write, then
  revoked its two captured assignments after cleanup. The learner-session run
  additionally proved feed discovery, separate resource authentication, and
  the first personal Windows 11 desktop. Complete assignment reads and fresh
  Dev tokens proved all temporary roles absent. Microsoft can retain ordinary
  provider, audit, deleted-group, Intune-report, and stale Defender
  device-history residue; no active run resource, policy, group, device,
  enrollment record, or temporary permission remains.
- The delivered email and cancelled attendee calendar copies are intentionally
  retained. OneDrive and SharePoint deletion can retain recycle-bin content.
- One harmless marker message remains in Cory's Inbox and was observed read.
  The exact rule had no forwarding, redirect, deletion, move, or recipient
  action. Its later deletion returned `204`, but two exact follow-up reads
  returned `500`, so active rule state is unconfirmed. Protected evidence and
  the exact identity remain outside Git; no second message was sent.
- One recipient-free, attachment-free, unsent Cory draft is retained as
  app-only staging evidence. Its protected marker and exact identity are
  retained outside Git for the first authorized residue-cleanup pass.
- One marked Homer/Cory/Kobe Teams group chat and its single harmless
  Homer-authored warning message remain after the completed learner
  remediation. Marge is absent; membership and audit history may remain.
  Protected cleanup identities and learner evidence remain outside Git.
- Immediate Microsoft reads can lag accepted writes. The staged group,
  profile, manager, and calendar canaries waited for natural time rather than
  retrying mutations. The OneDrive Shared view never discovered the retained
  proof, but Marge's exact protected direct URL rendered the expected sentence;
  direct readability and Shared-view discovery are separate claims.
- Broad calendar apply is unsupported. The conditional-delete canary showed
  that event `DELETE` did not enforce `If-Match` on the tested route, so the
  repository retains only the read-only schema-v2 calendar preview. Its
  contract declares no apply scope, and its classified actions are diagnostic
  metadata with no planned or executable action.
- Mutations are deliberately not retried. Some hosted operations use fixed
  markers, IDs, eTags, browser state, and a process-local busy boundary. The
  accepted Pass 3 API keeps one warm replica, which avoids cold starts and keeps
  those process-local boundaries coherent. It does not claim exactly-once
  behavior across multiple replicas or restarts. A shared-journal design is
  retained for a future explicit multi-replica or crash-recovery need; see the
  [durable operation journal decision](durable-operation-journal-decision.md).
- Simulated-user MSAL caches exist only in API process memory. The first
  request after a restart may launch an isolated headless CBA browser; later
  consented scopes can be acquired silently while that replica remains alive.
  No durable token cache has been built.
- Pass 3 intentionally retains broad Dev-app and API-MI permissions, CBA
  mappings/certificates, shared delegated consent, and the rehearsal Azure
  resources. Least privilege and production hardening are deferred.
- Branch-isolated hosted previews, private networking, a custom domain,
  durable orchestration, generalized scenario configuration, drift repair,
  and production observability are not proven here.
