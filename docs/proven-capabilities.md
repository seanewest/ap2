# Proven capabilities

This is an inventory of live Pass 3 evidence, not a roadmap. A capability is
listed only when it was exercised through the hosted product path or by a
bounded direct canary against the Student tenant. Unit tests, deployment alone,
and code that has not touched Microsoft are not counted as live proof.

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
| Empty Azure resource group | Created one tagged, empty Student resource group through ARM, confirmed it contained no resources, and deleted it. | Dev diagnostic app | Later exact GET returned `404` |
| Security group and membership | Created an inert cloud-only security group, later added Kobe, observed him as the sole member after natural propagation time, removed him, observed the group empty, and deleted it. | Dev diagnostic app | Later exact-name read returned zero |
| User profile field | Set Kobe's `officeLocation` to an AP2 marker and later observed that marker. | Dev diagnostic app | Restored to `null`; later exact read confirmed restoration |
| User manager | Set Cory as Kobe's manager, later observed the exact relationship, and removed it. | Dev diagnostic app | Later read confirmed no manager |
| Disabled Conditional Access policy | Added only the two needed Dev-app permissions, created one exact policy in `disabled` state, validated its inert contract, and deleted it. The policy was never enabled or put in report-only mode. | Dev diagnostic app | Zero active exact-name matches; Entra audit and deleted-policy retention accepted |
| Exchange and message-trace diagnostics | Connected app-only to Exchange Online, read bounded organization configuration, and ran bounded message-trace diagnostics. The official Transport Data Platform Graph service principal also returned a successful trace read. | Dev diagnostic app and Microsoft Transport Data Platform service principal | Read-only; the Dev permissions and Exchange Administrator assignment remain |
| Mail folder | Created and deleted one ordinary visible top-level Cory mail folder. No message or send route was used. | c91 delegated — Cory | Exact folder absent |
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

| Scenario | Attacker-side unit | Defender-side observation | Boundary still visible |
| --- | --- | --- | --- |
| OAuth application reconnaissance | One over-permissioned application used four fixed reads to survey identity, mail, personal storage, and shared storage without a user sign-in. | A separate bounded query found the exact successful service-principal token event for Microsoft Graph in the reconnaissance window. | The sign-in log proves token acquisition, not the four individual reads. The Dev diagnostic app performed both proof roles, so separate attacker and defender identities remain unproven. |

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
- The delivered email and cancelled attendee calendar copies are intentionally
  retained. OneDrive and SharePoint deletion can retain recycle-bin content.
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
  there is no durable queue, database, cross-replica lock, or exactly-once
  guarantee across callers, replicas, or restarts.
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
