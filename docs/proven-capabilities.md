# Proven capabilities

This is an inventory of live Pass 3 evidence, not a roadmap. A capability is
listed only when it was exercised through the hosted product path or by a
bounded direct canary against the Student tenant. Unit tests, deployment alone,
and code that has not touched Microsoft are not counted as live proof.

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
| Directory-role posture | One beta Graph request expanded directory-role definitions without retaining role names or identities and found zero directory-role assignments for all four fixed simulated users. | Dev diagnostic app | Read-only; the beta response shape is not production-stable, and zero directory roles does not prove absence of workload-specific privilege |
| Device-registration posture | One app-only metadata read found one enabled Windows device with Workplace registration and approximate activity within 30 days; no device identity or owner was retained. | Dev diagnostic app | Read-only; registration and approximate activity do not prove health, compliance, or current ownership |
| Empty Azure resource group | Created one tagged, empty Student resource group through ARM, confirmed it contained no resources, and deleted it. | Dev diagnostic app | Later exact GET returned `404` |
| Azure Virtual Desktop personal host | A fresh private, direct-assigned Windows 11 Enterprise 24H2 host repeated deployment-time Entra join, compliant Intune MDM enrollment, and marker-bound Defender onboarding before learner sign-in. The fixed learner then completed Windows App onboarding, discovered the one assigned SessionDesktop, completed the separate resource authentication naming the exact user and remote device, and reached the first Windows 11 desktop without retry or configuration. AVD independently recorded the same user's Desktop session and its disconnected state after the tab closed; Intune remained compliant and associated that user after sign-in, while Defender remained Active/Onboarded/Intune. Live offboarding then stopped Sense and set local onboarding state to `0`. | Fixed learner for the one desktop session; Dev diagnostic app for Azure, Intune, and Defender orchestration; independent administrator for the bounded temporary-permission lifecycle and final Entra-device cleanup | Both EDR policies, the active marker group, Azure resource group, Intune record, and Entra device are absent. Both temporary Graph roles were revoked and are absent from a fresh Dev token and complete assignment read. The approximately 1.37-hour lifecycle remained below the conservative USD 4.66920548 eight-hour public-price upper bound and USD 8 hard stop; ordinary audit, deleted-group, and stale Defender device-history residue can remain. |
| Retained AVD endpoint-compromise background | On Marge's retained personal host `ap2margefresh`, run `AP2-ENDPOINT-BG-20260815T1004Z` launched a marked child PowerShell with `-ExecutionPolicy Bypass` from `10:05:28Z` to `10:05:38Z`. Under unchanged endpoint posture it created one harmless marker, completed local/user/process/network discovery (four local users, 139 processes, 18 established TCP connections, and 19 DNS answers for `login.microsoftonline.com`), and created and verified one no-op `HKLM` Run canary. This proves bounded compromise-background staging, not employee-user attribution. | Dev diagnostic app through Azure Run Command; guest actor `NT AUTHORITY\SYSTEM` on Marge's assigned host | The exact Run value and seven marked files are absent; zero marked processes and zero interactive or AVD sessions remained. The VM is deallocated and its AVD session host is `Shutdown`. A read-only Defender follow-up about 59 minutes after execution found zero device-related MDE alerts, zero Graph alerts or incidents since `09:45Z`, and zero `AlertInfo` or exact `AlertEvidence` rows. Raw device process, file, registry, and network hunting tables were unavailable to the authorized Graph schema, the legacy MDE query lacked `AdvancedQuery.Read.All`, and the device's `lastSeen` full-report time preceded execution. No detection was observed; raw event and timeline recording remains unproven rather than absent. No protection or detection setting was changed. |
| Retained AVD user-context endpoint background | Kobe authenticated to his assigned AVD desktop and launched exact run `AP2-KOBE-USER-BG-20260815T1105Z` through the remote canvas at `11:11:36Z`. Its surviving summary recorded execution from `11:11:42Z` to `11:11:57Z` as `AzureAD\KobeWest`, CloudAP-authenticated, medium-integrity PowerShell in interactive session 2. Under unchanged endpoint posture it created a marker whose SHA-256 was independently revalidated, observed four local users, 203 processes, 59 established TCP connections, and two DNS answers for `ap2-tester123.youtrack.cloud`, received HTTP `200` from one benign `HEAD` to that host, and created and verified the no-op `HKCU` Run value `AP2KobeIncidentBackgroundCanary` without triggering it. The original post-launch inspector failed only because it assumed profile `C:\Users\kobe`; recovery found the evidence under the actual `C:\Users\KobeWest` profile, so the activity was not replayed. | Kobe in his assigned AVD session; the Dev diagnostic app only staged the fixed script and independently recovered its output | Recovery removed the exact HKCU value, user evidence root, ProgramData staging root, and orphaned browser parent; zero marked processes survived. Kobe's sole disconnected AVD session was force-logged off, session count reached zero, and `ap2flakobe-vm` was explicitly deallocated with session host `Shutdown`. No Defender alert, incident, hunting, or detection query was performed, so this proves only the user-context background actions and cleanup. |
| Retained AVD user-context synthetic file impact | Homer authenticated to `ap2timedhomer` and launched exact run `AP2-HOMER-RANSOM-BG-20260815T1112Z` through the remote canvas. As `AzureAD\HomerSimpson`, CloudAP-authenticated and medium-integrity in interactive session 2, it created and read six uniquely marked synthetic company text files under Homer's existing `C:\Users\HomerSimpson\OneDrive` folder, then in 3.4 seconds renamed each with `.ap2locked`, applied reversible bytewise XOR `0x5A`, and created one harmless `AP2-RESTORE-NOTE.txt`. The existing same-session OneDrive process did not expose a loaded account configuration, and three exact Graph path reads through `11:35:10Z` returned `404 itemNotFound`; this proves local activity in the retained OneDrive folder, not cloud synchronization or cloud-file impact. | Homer in his assigned AVD session; the Dev diagnostic app only staged the fixed script, signaled its two bounded phases, and recovered its output | Cleanup reversed the transform, matched all six original SHA-256 hashes, and removed the exact folder, note, staged script, user evidence, and marked processes. Homer's session was logged off and the VM was deallocated with session host `Shutdown`. No Defender query was performed, so detection and telemetry remain a separate question. |
| Security group and membership | Created an inert cloud-only security group, later added Kobe, observed him as the sole member after natural propagation time, removed him, observed the group empty, and deleted it. | Dev diagnostic app | Later exact-name read returned zero |
| User profile field | Set Kobe's `officeLocation` to an AP2 marker and later observed that marker. | Dev diagnostic app | Restored to `null`; later exact read confirmed restoration |
| User manager | Set Cory as Kobe's manager, later observed the exact relationship, and removed it. | Dev diagnostic app | Later read confirmed no manager |
| Disabled Conditional Access policy | Added only the two needed Dev-app permissions, created one exact policy in `disabled` state, validated its inert contract, and deleted it. The policy was never enabled or put in report-only mode. | Dev diagnostic app | Zero active exact-name matches; Entra audit and deleted-policy retention accepted |
| Exchange and message-trace diagnostics | Connected app-only to Exchange Online, read bounded organization configuration, and ran bounded message-trace diagnostics. The official Transport Data Platform Graph service principal also returned a successful trace read. | Dev diagnostic app and Microsoft Transport Data Platform service principal | Read-only; the Dev permissions and Exchange Administrator assignment remain |
| Defender posture snapshot | Read the latest Microsoft Secure Score and reduced 69 controls to tenant-level and category-level score aggregates. Older score history was reported as truncated and deliberately not paged. | Dev diagnostic app | Read-only |
| MDE Cloud Discovery telemetry | The MDE-only Cloud Discovery stream recorded one ChatGPT transaction attributed to `kobe@corywest.onmicrosoft.com` on managed endpoint `ap2flakobe`. This proves that the enabled MDE integration can contribute attributable endpoint network activity to Cloud Discovery, not completeness for other users, devices, or applications. | Kobe on `ap2flakobe` | Read-only; the MDE integration remains enabled |
| Endpoint DLP paste enforcement by destination | With one scoped Devices policy whose general browser-paste action was `Audit` and whose built-in `LLM Websites` override was `Block`, Edge 151 allowed the same synthetic Credit Card Number clipboard value into an unsaved YouTrack dashboard-name field and retained it unchanged for 60 seconds, but kept an unsent `chatgpt.com` prompt empty and displayed the Purview block notice after 22 seconds. Activity Explorer later attributed the corresponding `Pasted to browser` records to Kobe, `ap2flakobe`, and `msedge.exe`: `ap2-tester123.youtrack.cloud` at `2026-08-14T04:54Z` with enforcement mode `Audit`, and `chatgpt.com` at `2026-08-14T04:56Z` with enforcement mode `Block` and site group `LLM Websites`. This proves destination-specific allow/audit versus block for this exact policy, content, endpoint, browser, and two fields; it does not establish behavior for other destinations or policy compositions. | Kobe on `ap2flakobe` | The exact retest policy is deleted, Windows device monitoring is off, the synthetic file, browser/process, and interactive-session state are absent, and the VM is deallocated. Policy delivery previously took about eight minutes. In this retest Activity Explorer showed no items roughly eight minutes after the pastes and showed both attributable paste records about 50 minutes after the first paste, so telemetry is usable retrospectively but not prompt confirmation. |
| Universal CAE through Global Secure Access | With supported GSA client 2.31.125, a fresh PRT, and attributable traffic, disabling Kobe at 00:56:02Z caused `AADSTS50057` reauthentication prompts from 00:59:32Z, disconnected the Internet channel at 01:03:33Z, and disconnected all GSA channels by 01:05:03Z. Restoring Kobe reconnected all channels at 01:09:43Z and attributable traffic resumed. | Kobe through the Global Secure Access client | Kobe is enabled, the temporary client is removed, and the VM is deallocated. This contained the GSA channels; it did not isolate the endpoint or block all direct HTTPS. |
| Global Secure Access PDF upload control | From Kobe's managed endpoint, the same harmless PDF upload to a benign external HTTPS destination was first allowed and then blocked with HTTP `403` after applying the narrow GSA content rule, while an ordinary `GET` to that destination still returned `200`. GSA transactions attributed the enforcement to Kobe, the managed device, the intended security profile and rule, and TLS inspection. | Kobe through the Global Secure Access client | The experimental tenant policy, client, certificate, and endpoint artifacts were removed, and the VM was deallocated. |
| Purview Network Data Security and Git-over-HTTPS boundary | A direct upload of a harmless PDF returned `201`; a direct upload of the same file class containing a synthetic credit-card pattern returned `403`. Purview record `589fdb2c-5f8e-4442-8c17-5154aaae1b6b` classified Credit Card Number at confidence 85 with `PatternMatch` and `Block`, correlated with GSA transaction `9e403483-1196-41f2-85d1-8e810a4b3cf9`. The identical protected SHA-256 then passed in Windows Git HTTPS `receive-pack` under transaction `662007d3-ceb8-41c2-ba26-a9126ccd9b9a`: GSA intercepted TLS but produced no content-policy match. This proves the tested direct-upload control and an observed Git protocol-opacity boundary, not equivalent inspection for other protocols or clients. | Homer on the managed Windows endpoint through Global Secure Access | WSL was absent, so its optional Git path was not tested. Temporary state was removed and the Homer VM was deallocated. |
| YouTrack SCIM deactivation persistence and outbound delivery | Before deactivation, Kobe's permanent token read `DEMO-13` with HTTP `200` and configured a harmless custom app marker. After Entra group removal and SCIM deactivation, YouTrack reported Kobe banned and retained the token record, but the same token read returned `403`; after restoration, the unchanged token returned to `200`. A later one-cycle proof preserved the authorization distinction: a fresh temporary Kobe token configured an app marker and was deleted before deactivation. The app delivered once to a lab-owned receiver before deactivation and, while Kobe was banned, an administrator invoked the still-running app and it delivered the distinct deactivated checkpoint with HTTP `204`. This proves that user-configured app state and backend outbound delivery can remain operational while the configuring user is banned; it does not mean the banned user's own token remains authorized, and it does not prove that every native webhook or integration has the same ownership model. | Kobe for temporary app configuration; YouTrack administrator for state observation and bounded app invocation | Kobe is restored in `AP2 YouTrack Users` and unbanned. Both SCIM jobs are active. The temporary token, app, receiver, container image, managed identity, role assignment, marker, and local artifacts are absent. |
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

These five capability compositions were performed against Microsoft. They are
factual evidence, not entries in a registry or templates for future work.

| Scenario | Staged activity | Observation and cleanup | Boundary still visible |
| --- | --- | --- | --- |
| Inbox-rule persistence and effect | The Dev diagnostic app created one enabled Cory Inbox rule limited to an exact AP2 subject marker, mark-read, and stop-processing actions. A later single, non-retried app-only send delivered that harmless marker message from Homer to Cory. | After one bounded wait, one unpaged Inbox read found exactly one matching message already marked read with no attachment. A separate inventory had confirmed the rule shape and tenant-wide mailbox-settings reach. | This proves the mark-read effect, not runtime stop-processing. A later exact-rule deletion returned `204`, but two separately authorized exact-ID confirmation reads returned `500`; rule absence is therefore unconfirmed, and no second message was sent. |
| Dormant OAuth application remediation | The Dev diagnostic app registered one single-tenant application with one short-lived password credential, then discarded the generated secret without storing or using it. The application had no service principal, permissions, roles, scopes, keys, or redirect URI. | A tenant-wide aggregate inventory found exactly one full dormant-configuration match. Defender remediation later deleted that exact inert application; after natural propagation, its exact lookup returned `404` and the bounded aggregate inventory contained zero dormant matches. | The application never obtained workload access. Immediate and naturally delayed directory-audit reads did not produce an exact actor-and-target correlation, so audit visibility remains unproven. |
| SharePoint document tampering and recovery | The Dev diagnostic app created one uniquely named, unshared harmless file and overwrote it once with different harmless content. One capped, unpaged version read returned exactly the expected original and overwritten versions. | Defender recovery restored the unambiguous original version and proved the exact original bytes before conditionally deleting the file. Exact ID and path reads then returned `404`. A later distinct fixed detector reached Microsoft Graph v1 Purview Audit Search app-only without changing authority. | Overwrite and version restoration were unconditional, so this proves only the fresh, canary-owned file contract. Both retained audit searches later reached `succeeded`; their capped pages contained the same two records with the exact frozen producer application, allowed operations, marker target, target type, event window, and correlation. Correcting only the supported Graph record-type casing makes operation-level producer attribution `live-proven`. This does not prove content collection or every workload operation. The product minimum is `AuditLogsQuery-SharePoint.Read.All`; the retained diagnostic detector currently has a broader audit role. See also the [Purview operation-audit contract](purview-audit-contract.md). |
| Defender email-attachment prevention | One internal Homer-to-Cory message carried Microsoft's standard EICAR test attachment and was submitted exactly once. | Within five minutes, message trace and Defender hunting correlated one quarantined message and attachment with malware, blocked, quarantine, and antimalware-engine evidence; Cory's Inbox contained no matching message. | No exact alert or incident appeared. The learner evidence is in Threat Explorer or the email entity, message trace, hunting, and Quarantine. The attachment must not be released, previewed, downloaded, or opened; quarantine and audit residue can remain. |
| Teams group-chat membership remediation | Homer created one marked group chat with Cory and Kobe, later added Marge with a frozen history cutoff, and posted one harmless plaintext insider-style lab message. | Exact retained-identity reads proved the marked topic, Homer/Cory/Kobe/Marge roster, Marge's cutoff, and the sole Homer-authored message. Cory then identified and removed only the unexpected participant through the learner UI. One exact post-action membership read proved Cory, Homer, and Kobe retained and Marge absent; protected learner evidence showed the original warning message still visible. | The native member-add system-event predicate did not match, and Purview audit correlation remains unproven. The marked chat, its three intended members, warning message, membership history, and audit history remain for the separately authorized broader cleanup pass. |

## Identity and infrastructure proofs

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
- YouTrack proved an Entra-managed SaaS lifecycle: assignment through `AP2 YouTrack Users` and SCIM created/updated Marge, Entra SSO succeeded, removal from scope sent `active=false` and YouTrack retained the account as banned rather than deleting it, and the entitlement group now contains exactly Homer, Cory, Marge, and Kobe.
- A parallel non-gallery `AP2 YouTrack SAML + SCIM (staged)` enterprise app successfully provisioned all four assigned users through its own Entra SCIM job. Marge completed the staged Entra SAML path under Defender Conditional Access App Control, remained on the `.mcas.ms` reverse-proxy origin, and had an ordinary Cut/Copy action explicitly blocked. After making that staged SAML module YouTrack's default authentication provider, Sean also live-proved the learner-facing one-click path: a fresh My Apps tile launch went directly into the authenticated proxied YouTrack workspace without either provider-chooser click, while Cut/Copy remained blocked.
- Defender allowed Cory to download a DOCX through the proxied YouTrack path, applied the existing `Confidential - All Employees` encrypted Purview label to the downloaded CDFV2 copy, and left the original attachment's SHA-256 unchanged. This proves protected download transformation without source-file mutation; it does not prove enforcement for other labels or file types.
- After repairing the learner-session identity mapping and project access, Cory and Marge both opened the same YouTrack issue through the proxied staged SAML path. Sean then proved the intended user distinction against the same shared attachment: Cory downloaded it, while Marge received the Defender download block. This proves the narrow user-scoped policy effect, not a device-state distinction.
- GitHub Enterprise Cloud with Enterprise Managed Users proved Entra OIDC SSO, Entra SCIM managed-user lifecycle, managed enterprise administration, and attributable organization activity in the `ap2-v2` enterprise. The Microsoft Defender for Cloud Apps GitHub API App Connector is telemetry-proven: Defender `CloudAppEvents` recorded `repo.create` for `ap2-v2-lab/defender-connector-proof` attributed to managed administrator `admin_ap2`, and GitHub's organization audit log independently recorded the same action, repository, actor, and millisecond timestamp. This proves SaaS-native connector ingestion, distinct from browser session proxying. A later reversible control probe in `ap2-v2-lab/maintainer-control-proof` produced GitHub audit records for `protected_branch.destroy` and `protected_branch.create`, both attributed to `admin_ap2`; an Advanced Hunting recheck about 45 minutes later returned zero GitHub `CloudAppEvents` matching either action in the normalized action type or raw connector payload. The connector therefore did not surface those branch-protection actions in the observed window. After the enterprise deploy-key policy was cleared and `ap2-v2-lab` enabled deploy keys, the decisive disposable Ed25519 key created with `read_only=false` cloned the private `maintainer-control-proof` repository and pushed temporary commit `2c1939d78ff08becb05495196e5874ed8ab48936` to a temporary branch. SSH `ls-remote` returned that exact commit and GitHub populated the key's `last_used`. Enterprise audit attributed `public_key.create`, `public_key.verify`, and `public_key.delete` for the exact write key to `admin_ap2`; this records key lifecycle and use, but not a distinct push action. Defender Advanced Hunting returned zero matching GitHub `CloudAppEvents` at roughly four and ten minutes, which is only a bounded ingestion observation. The temporary branch, marker, key, and private material are absent, the deploy-key list is empty, and `main` remains at `34a2a17402f289aec68b0a808eb9d7105405bcc7`.
- A lab-owned YouTrack-to-GitHub workflow reused the proven same-attachment outcome: Marge was blocked while Cory downloaded `DEMO-13` attachment `12-2` through the controlled session. A fresh YouTrack read found the original still 1,621 bytes with SHA-256 `c40351f62d0d52216080ddd4721c6a87bffb3edf06efe45e665a1fef06edc11f`; the Cory-downloaded copy remained a distinct 46,592-byte CDFV2-encrypted file with SHA-256 `6f97649b63c81a43396b33d1a8d38d2f0e5e10a852d73b57c71883b27fe276e3`. Cory received temporary ordinary member/write access and used his managed `cory_ap2` browser session to commit that exact encrypted blob to private `ap2-v2-lab/youtrack-protected-artifact-proof`; repository history attributed commit `07b5411` to `cory_ap2`. YouTrack's attachment activity recorded the source attachment addition but no download, and no endpoint event was collected; the transition proof at that layer is file type, size, and hashes. GitHub's complete organization audit feed recorded `repo.create` and `repo.add_member` by `admin_ap2` but no Cory/git event. Defender ingested those surrounding administrator events yet still showed no file-commit event after eight minutes, so the connector cannot presently evidence the developer's artifact movement. Cleanup reset `main` to its exact initial commit, removed the protected path, and left Cory with no repository permission or organization membership. The inert private repository shell remains because the managed-admin token lacks repository-delete scope and the delete attempt returned `403`; temporary browser state was removed.
- A Product-owned multitenant app can produce a Student service principal
  through real external-tenant sign-in.
- Real delegated operator tokens and real Dev app-only tokens pass the same
  fail-closed API boundary only with the fixed Student issuer, audience,
  signature, lifetime, caller ID, and exact delegated scope or application
  role. Delegated and app-only claim shapes remain separate.
- Homer, Cory, Marge, and Kobe have each completed fresh CBA sign-in through
  the shared simulated-user client for the delegated scopes needed by the
  bounded rehearsals.
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
  must not be described as Teams voicemail.
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
