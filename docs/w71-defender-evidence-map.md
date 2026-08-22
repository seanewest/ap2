# W71 defender evidence map

This note separates Microsoft records retained from
`AP2-RACHEL-FIRSTLEG-20260821T180118Z` from the AP2-side receipts used to
construct and validate that run. The inspection was read-only and used the
existing Entra and Defender application authority. It did not recreate any
activity or change collection, permissions, policy, or licensing.

## Decision

W71 now has a useful native investigation seam. A defender can correlate an
MDE process start and successful network connection on Rachel's assigned device
with an Entra-authenticated Rachel session from a different operating system,
browser, device posture, and source address roughly one minute later. The seam
is available in Defender advanced hunting and Entra sign-in logs without AP2
receipts.

The native evidence does **not** show the page click, the text rendered by the
page, a browser-history artifact, or a GitHub Pages server request. Those claims
remain construction evidence. There was no alert or incident and no GSA/SWG
traffic record for the run, so a learner must begin with hunting or the device
timeline and Entra sign-ins rather than an alert queue.

## Native Microsoft chronology

| UTC | Natural record | What it establishes |
| --- | --- | --- |
| 18:36:23 | MDE `DeviceProcessEvents` | `msedge.exe` started on `ap2fastrachel` as Rachel's Azure AD account in her interactive logon. Its top-level command line contains the public AP2 company-access URL and exact run marker. Child Edge processes preserve the same marked temporary browser context. |
| 18:36:26 | MDE `DeviceNetworkEvents` | The same marked Edge network process, Rachel UPN, and session 2 made a successful TCP/443 connection to `https://seanewest.github.io`; the row carries the resolved remote address. This centrally attributes the external destination to Rachel's endpoint process. |
| 18:37:27 | Entra sign-in log and Defender `AADSignInEventsBeta` | Rachel began an interactive `After Party Exploratory` / Microsoft Graph browser sign-in from unmanaged, noncompliant Linux Chrome with no device ID, display name, or trust type. The expected keep-signed-in interrupt records successful X.509 certificate authentication. |
| 18:37:28 | Entra sign-in log and Defender `AADSignInEventsBeta` | The same app, source, user agent, and device posture produced an interactive success, followed by successful noninteractive app/resource records. This is the natural proof that the later authentication completed, rather than only reaching an interrupt. |

The later Entra source address differs from the Windows endpoint address in
Defender's sign-in hunting data. Its Linux/Chrome/unmanaged/no-device posture
also differs from the managed Windows 11 endpoint, while the UPN is the same.
This supports a distinct same-user authentication context. It does not prove
credential theft, token replay, MFA bypass, or an adversary-controlled session.

## Evidence map

| Surface | Retained result | Learner/defender use and boundary |
| --- | --- | --- |
| Defender advanced hunting: endpoint | Exact `DeviceProcessEvents` and `DeviceNetworkEvents` rows are available through the supported Microsoft Graph hunting API under standing `ThreatHunting.Read.All`. | This is the strongest native external-visit evidence: device, user/UPN, logon/session, Edge process, exact launch URL/run marker, external hostname, remote address, port, protocol, action, and timestamps. The network row exposes the origin hostname, not the full path or page content. |
| Defender advanced hunting: identity | Five `AADSignInEventsBeta` rows from 18:37:27-18:37:29 show the interrupt, interactive success, and subsequent noninteractive successes for Rachel from Linux Chrome. | Provides the same investigation surface in Defender as Entra, including the different source address and blank device name. The detailed authentication method is richer in Entra. |
| Device timeline | The raw endpoint events that normally feed the device timeline are retained and huntable. The standing MDE application has no supported machine-timeline API route; the attempted exact machine/window route returned `404`. | A portal user with the appropriate Defender role can pivot from the device into its timeline, but this inspection did not create a fresh human portal session or claim a separately exported timeline artifact. The supported, reproducible read-only seam is Graph advanced hunting. |
| Alerts and incidents | Exact-window MDE machine alerts, Graph `alerts_v2`, Graph incidents, `AlertInfo`, and exact `AlertEvidence` all returned zero. | There is no alert-queue entry point and no alert evidence entity for this run. Empty alert results do not negate the raw endpoint events. |
| Entra sign-in logs and authentication details | Entra retains the interactive X.509 step at 18:37:27 and the completed interactive sign-in at 18:37:28, with Rachel, app/resource, source, user agent, Linux/Chrome posture, unmanaged/noncompliant state, blank device identity, Conditional Access `notApplied`, and no sign-in risk. `isThroughGlobalSecureAccess` is false and the GSA address and network-location detail are empty. | This is the authoritative native second-session record. The interrupt and success are two records in one supported sign-in flow, not two sessions. The earlier controller primer and Windows App setup records share the same Linux source, so time, application, and the post-visit success must be used to identify the claimed later context. |
| Entra directory audit | The exact window contains no directory-audit record initiated by or targeting Rachel. | Expected: authentication is represented by sign-in logs, not a directory mutation. There is no audit-log claim to teach here. |
| GSA/SWG | No GSA service was in the endpoint path. The later Entra records explicitly say they were not through GSA. | Do not imply network-access or SWG evidence. |
| GitHub Pages | GitHub Pages provides the public HTTPS destination but no AP2-held access log. | MDE proves the endpoint connection. There is no server-side request record owned by AP2. |

## AP2 construction receipts only

The following retained facts validated W71 but are not SOC-native evidence:

- the protected screenshot showing the exact page and trusted-click result;
- the guest-side process ownership, DNS, and public-egress checks;
- the secondary browser screenshot and worker-side egress check;
- the controller timestamps for starting and closing the disposable browser;
- the staging checks for page deployment, endpoint session creation, cleanup,
  unchanged authentication methods, and absence of marked temporary state.

These receipts can support engineering confidence but should not be presented as
learner discoveries. In particular, Microsoft telemetry establishes a visit to
the AP2 origin and a later Rachel-authenticated context; only the AP2 screenshot
establishes that Rachel clicked and what the page rendered.

## Access boundary

Standing Graph authority is sufficient for the useful raw `Device*` and
`AADSignInEventsBeta` hunting surfaces. The older MDE advanced-query endpoint is
inaccessible because its token has `Alert.Read.All` and `Machine.Read.All`, not
`AdvancedQuery.Read.All`; its exact request returned `403` naming that missing
application role. No permission broadening is warranted because Graph advanced
hunting already returns the retained rows. The machine-specific MDE profile and
alert endpoints remain readable, while no supported machine-timeline endpoint
was exposed through that application API.
