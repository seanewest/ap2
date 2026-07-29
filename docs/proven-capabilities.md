# Proven capabilities

This is an inventory of live Pass 3 evidence, not a roadmap. A capability is
listed only when it was exercised through the hosted product path or by a
bounded direct canary against the Student tenant. Unit tests, deployment alone,
and code that has not touched Microsoft are not counted as live proof.

A capability rehearsal or environment-validation canary proves a platform
contract. It is not automatically a learner scenario. Source-backed learner
scenarios additionally name the evidence producer, workload actor,
learner/observer, and optional responder, and explain what evidence the learner
receives.

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
| OneDrive read-only share | The hosted path created the exact 58-byte Homer file and configured Marge's direct read permission. Sean then signed in separately as Marge, found the shared file, and opened its exact harmless contents before using the hosted cleanup action. | c91 delegated — Homer; Marge's separate human browser session for observation | Active path absent and no Marge share remained; deleted-item/recycle-bin history retained |
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
| Application cross-workload reconnaissance | One app-only execution used one token and four fixed reads to observe Cory's directory memberships and mailbox-folder metadata plus the roots of Cory's OneDrive and the fixed SharePoint drive. The bounded collections were not truncated, and the output retained only counts and reachability—not tenant object details. | Dev diagnostic app | Read-only |
| Authentication-method posture | After the new read-only role reached a fresh token, one app-only execution read the four fixed simulated users without paging or user sign-in. The aggregate contained six methods: four password and two Microsoft Authenticator registrations. A separate one-request registration report found two of four users MFA registered/capable and SSPR registered/capable, all four SSPR enabled, and none passwordless capable. Method details were not retained; registration and capability do not prove enforcement or a successful challenge. | Dev diagnostic app | Read-only; the `UserAuthenticationMethod.Read.All` assignment and its private cleanup identity are retained |
| Directory-role posture | One beta Graph request expanded directory-role definitions without retaining role names or identities and found zero directory-role assignments for all four fixed simulated users. | Dev diagnostic app | Read-only; the beta response shape is not production-stable, and zero directory roles does not prove absence of workload-specific privilege |
| Device-registration posture | One app-only metadata read found one enabled Windows device with Workplace registration and approximate activity within 30 days; no device identity or owner was retained. | Dev diagnostic app | Read-only; registration and approximate activity do not prove health, compliance, or current ownership |
| Empty Azure resource group | Created one tagged, empty Student resource group through ARM, confirmed it contained no resources, and deleted it. | Dev diagnostic app | Later exact GET returned `404` |
| Azure Virtual Desktop personal host | A fresh private, direct-assigned Windows 11 Enterprise 24H2 host repeated deployment-time Entra join, compliant Intune MDM enrollment, and marker-bound Defender onboarding before learner sign-in. The fixed learner then completed Windows App onboarding, discovered the one assigned SessionDesktop, completed the separate resource authentication naming the exact user and remote device, and reached the first Windows 11 desktop without retry or configuration. AVD independently recorded the same user's Desktop session and its disconnected state after the tab closed; Intune remained compliant and associated that user after sign-in, while Defender remained Active/Onboarded/Intune. Live offboarding then stopped Sense and set local onboarding state to `0`. | Fixed learner for the one desktop session; Dev diagnostic app for Azure, Intune, and Defender orchestration; independent administrator for the bounded temporary-permission lifecycle and final Entra-device cleanup | Both EDR policies, the active marker group, Azure resource group, Intune record, and Entra device are absent. Both temporary Graph roles were revoked and are absent from a fresh Dev token and complete assignment read. The approximately 1.37-hour lifecycle remained below the conservative USD 4.66920548 eight-hour public-price upper bound and USD 8 hard stop; ordinary audit, deleted-group, and stale Defender device-history residue can remain. |
| Security group and membership | Created an inert cloud-only security group, later added Kobe, observed him as the sole member after natural propagation time, removed him, observed the group empty, and deleted it. | Dev diagnostic app | Later exact-name read returned zero |
| User profile field | Set Kobe's `officeLocation` to an AP2 marker and later observed that marker. | Dev diagnostic app | Restored to `null`; later exact read confirmed restoration |
| User manager | Set Cory as Kobe's manager, later observed the exact relationship, and removed it. | Dev diagnostic app | Later read confirmed no manager |
| Disabled Conditional Access policy | Added only the two needed Dev-app permissions, created one exact policy in `disabled` state, validated its inert contract, and deleted it. The policy was never enabled or put in report-only mode. | Dev diagnostic app | Zero active exact-name matches; Entra audit and deleted-policy retention accepted |
| Exchange and message-trace diagnostics | Connected app-only to Exchange Online, read bounded organization configuration, and ran bounded message-trace diagnostics. The official Transport Data Platform Graph service principal also returned a successful trace read. | Dev diagnostic app and Microsoft Transport Data Platform service principal | Read-only; the Dev permissions and Exchange Administrator assignment remain |
| Defender posture snapshot | Read the latest Microsoft Secure Score and reduced 69 controls to tenant-level and category-level score aggregates. Older score history was reported as truncated and deliberately not paged. | Dev diagnostic app | Read-only |
| Mail folder | Created and deleted one ordinary visible top-level Cory mail folder. No message or send route was used. | c91 delegated — Cory | Exact folder absent |
| Help-desk scenario email | One app-only authorized local API request invoked the merged fixed operation. Exact Kobe CBA submitted one marker-bound Outlook email to Cory; Graph returned `202`, and the second of three allowed marker reads found exactly one non-draft message in Cory's Inbox with the exact Kobe sender, sole Cory recipient, subject, and body. | Dev diagnostic app triggered the API; c91 delegated — Kobe was the Microsoft mail actor; c91 delegated — Cory performed the learner-mailbox read | The message is intentionally retained and privately inventoried for later cleanup; this proves Outlook email only, not a Teams call, missed call, or voicemail |
| Private document staging | One reviewed delegated canary created a unique private run folder and fixed harmless text document in the producer-owned tenant-local business drive, then reconciled one direct signed-in learner `read` permission with no link or invitation. | c91 delegated — fictional document producer for staging and cleanup; c91 delegated — distinct fictional learner for the bounded visibility read | The learner backend read did not prove visibility, so interpretation, response, audit, and detection are unclaimed. Permission, file, and empty-folder cleanup succeeded; three fresh-token terminal rounds proved producer object absence and learner access absence. |
| Disabled Inbox rule | Created and deleted one exact harmless disabled rule. | c91 delegated — Cory | Exact rule absent |
| Outlook category | Created and deleted one exact category. | c91 delegated — Cory | Exact category absent |
| Unsent draft | Created and deleted one exact draft while keeping send, reply, forward, and recipient routes at zero. | c91 delegated — Cory | Exact draft absent |
| SharePoint file | Uploaded the exact bounded file to the fixed site, validated its bytes, and deleted it by exact identity/eTag. | Dev diagnostic app | Active path returned `404`; recycle-bin/audit history retained |
| Temporary To Do list | Created and deleted one temporary list without tasks or sharing. | c91 delegated — Cory | Exact list absent |
| Temporary To Do list/task lifecycle | Created a temporary list and task, completed the task, then deleted both. No sharing or mail route was used. | c91 delegated — Cory | Exact task and list absent |
| Calendar event conditional-delete check | Graph accepted one event `DELETE` carrying a genuinely stale event ETag with HTTP `204`, proving that `If-Match` was ignored on the tested route. | Dev diagnostic app | Read-only follow-up found the exact event absent, marker count zero, and preview eligible `0` / indeterminate `0` |

The contact and disabled-rule operations were also exercised through the
production-shaped local SPA, rootless API container, operator CBA, and Cory
CBA before their hosted proofs. Those runs corroborate the same product paths;
they are not additional tenant capabilities.

## Attack-inspired scenarios

The validated source-backed registry now includes the controlled Teams
missed-call observation, application reconnaissance, the Kobe-to-Cory
help-desk email, and the private three-VM AVD substrate. Scenario cards are
plans and perform no tenant operation merely by rendering:

| Scenario | Evidence producer / orchestrator | Workload actor | Learner / observer | Responder | Learner receives |
| --- | --- | --- | --- | --- | --- |
| Controlled Teams missed-call observation | AP2 instructor, who owns the one-attempt staging boundary | Kobe lab user through a separate licensed Teams client session | Learner using Cory's lab Teams view | None; observation only | One `Missed incoming` call entry and one matching Teams activity item to correlate without returning the call |
| Application reconnaissance and audit observation | AP2 reconnaissance lab harness, which owns the bounded window | Dev diagnostic app through an application-only Graph session | Security learner receiving sanitized output | None; observation only | Counts and reachability for four fixed reads plus a successful service-principal sign-in summary collected through a distinct audit observer application |
| Kobe help-desk email | AP2 orchestrator with one private one-shot journal | Kobe through exact delegated `Mail.Send` | Learner using Cory's Inbox | Learner reports an interpretation only | One fixed platform-native Outlook email; no Teams or voicemail semantics |
| Private three-VM AVD substrate | Dev application owns infrastructure, endpoint lifecycle, and cleanup | Windows 11 endpoint for the Entra/Intune/Defender lifecycle | Fixed learner is assigned but did not start a session | Dev application owns cleanup | Protected control-plane evidence for one AVD host, two Ubuntu nodes, shared NAT, and endpoint posture; learner visibility and task completion are not proven |
| Private document evidence staging | AP2 orchestrator owns the one-shot journal and claim boundary | Distinct fictional producer through delegated Files access | Distinct fictional learner through a bounded delegated read | None; cleanup is producer-owned | Producer-side platform acceptance of one private text artifact and direct learner-only read grant; learner visibility and interpretation remain unproven |

The remaining entries below are historical evidence narratives, not migrated
source manifests. Their attacker/defender wording must not be read as silently
assigning the learner to either proof role.

| Scenario | Attacker-side unit | Defender-side observation | Boundary still visible |
| --- | --- | --- | --- |
| OAuth application reconnaissance | One over-permissioned application used four fixed reads to survey identity, mail, personal storage, and shared storage without a user sign-in. | A separate bounded query found the exact successful service-principal token event for Microsoft Graph in the reconnaissance window. A bounded Defender query found no alert in the broader observation window. | The sign-in log proves token acquisition, not the four individual reads; zero visible alerts does not prove that no other detection exists. The Dev diagnostic app performed both proof roles, so separate attacker and defender identities remain unproven. |
| OAuth application mail staging | The Dev diagnostic app placed one marker-bound draft in Cory's mailbox without Cory signing in. The draft has no recipient, attachment, link, or send-family action. | A separate aggregate Drafts inventory found exactly one true, recipient-free, attachment-free, low-importance AP2-marked draft. | This adds app-only actor semantics to the already-proven draft capability; it does not prove delivery or message influence. The draft remains privately identifiable for deferred cleanup. |
| Inbox-rule persistence and effect | The Dev diagnostic app created one enabled Cory Inbox rule limited to an exact AP2 subject marker, mark-read, and stop-processing actions. A later single, non-retried app-only send delivered that harmless marker message from Homer to Cory. | After one bounded wait, one unpaged Inbox read found exactly one matching message already marked read with no attachment. A separate inventory had confirmed the rule shape and tenant-wide mailbox-settings reach. | This proves the mark-read effect, not runtime stop-processing. A later exact-rule deletion returned `204`, but two separately authorized exact-ID confirmation reads returned `500`; rule absence is therefore unconfirmed, and no second message was sent. |
| Dormant OAuth application persistence and remediation | The Dev diagnostic app registered one single-tenant application with one short-lived password credential, then discarded the generated secret without storing or using it. The application had no service principal, permissions, roles, scopes, keys, or redirect URI. | A tenant-wide aggregate inventory found exactly one full dormant-configuration match. Defender remediation later deleted that exact inert application; after natural propagation, its exact lookup returned `404` and the bounded aggregate inventory contained zero dormant matches. | The application never obtained workload access. Immediate and naturally delayed directory-audit reads did not produce an exact actor-and-target correlation, so audit visibility remains unproven. |
| SharePoint content tampering and recovery | The Dev diagnostic app created one uniquely named, unshared harmless file and overwrote it once with different harmless content. One capped, unpaged version read returned exactly the expected original and overwritten versions. | Defender recovery restored the unambiguous original version and proved the exact original bytes before conditionally deleting the file. Exact ID and path reads then returned `404`. A later distinct fixed detector reached Microsoft Graph v1 Purview Audit Search app-only without changing authority. | Overwrite and version restoration were unconditional, so this proves only the fresh, canary-owned file contract. Both retained audit searches later reached `succeeded`; one capped page from each contained two records but no exact marker-bound record satisfying the frozen attribution contract. The capability is `observed-but-incomplete`, while operation-level producer attribution remains ambiguous and unproven. The product minimum is `AuditLogsQuery-SharePoint.Read.All`; the retained diagnostic detector currently has a broader audit role. See [the Purview operation-audit contract](purview-audit-contract.md). |
| Defender email-attachment prevention | One internal Homer-to-Cory message carried Microsoft's standard EICAR test attachment and was submitted exactly once. | Within five minutes, message trace and Defender hunting correlated one quarantined message and attachment with malware, blocked, quarantine, and antimalware-engine evidence; Cory's Inbox contained no matching message. | No exact alert or incident appeared. The learner evidence is in Threat Explorer or the email entity, message trace, hunting, and Quarantine. The attachment must not be released, previewed, downloaded, or opened; quarantine and audit residue can remain. |
| Teams group-chat membership and message staging | Homer created one marked group chat with Cory and Kobe, later added Marge with a frozen history cutoff, and posted one harmless plaintext insider-style lab message. | Exact retained-identity reads proved the marked topic, Homer/Cory/Kobe/Marge roster, Marge's cutoff, and the sole Homer-authored message. Cory then identified and removed only the unexpected participant through the learner UI. One exact post-action membership read proved Cory, Homer, and Kobe retained and Marge absent; protected learner evidence showed the original warning message still visible. | The native member-add system-event predicate did not match, and Purview audit correlation remains unproven. The marked chat, its three intended members, warning message, membership history, and audit history remain for the separately authorized broader cleanup pass. |

## Identity and infrastructure proofs

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
  absent. A future pass must author the package in a separately authorized
  isolated interactive Windows client, then use the
  [fail-closed headless execution contract](shared-device-provisioning-package.md).
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
- An operator-free Teams Web readiness harness established an exact,
  non-persistent Kobe caller session, but three bounded attempts could not
  establish the independent Cory observer session needed to reconcile a native
  missed-call artifact. No call was placed. No ACS resource exists, the shared
  client lacks ACS `Teams.ManageCalls` and `Teams.ManageChats` delegated
  grants, and no Teams Phone resource account or Enterprise Voice prerequisite
  exists. The repository now includes a deterministic Kobe-to-Cory help-desk
  email generator as the honest non-call fallback. It is explicitly labeled as
  Outlook email—not a Teams call, missed call, or voicemail. One reviewed,
  one-shot local product-route rehearsal received Graph `202` and proved the
  exact message in Cory's Inbox. This establishes the real workload artifact
  and product contract, but not a hosted deployment of the new route.
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
  retrying mutations. OneDrive's Marge-side access never advanced beyond
  pending within the bounded verification window.
- Broad calendar apply is unsupported. The conditional-delete canary showed
  that event `DELETE` did not enforce `If-Match` on the tested route, so the
  repository retains only the read-only schema-v2 calendar preview. Its
  contract declares no apply scope, and its classified actions are diagnostic
  metadata with no planned or executable action.
- Mutations are deliberately not retried. Some hosted operations use fixed
  markers, IDs, eTags, browser state, and a process-local busy boundary, but
  the main API has no durable queue, database, cross-replica lock, or
  exactly-once guarantee across callers, replicas, or restarts. The repository
  has derived the two production consumers and the required claim/recovery
  contract, but implementation is blocked on a production shared-store choice;
  see the
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
