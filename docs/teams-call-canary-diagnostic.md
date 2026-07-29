# Teams Call Canary diagnostic

This note records the post-canary contract decision. It does not authorize a
call. The first canary retained only a definitive pre-identity `4xx` class, so
it proves that no call existed but cannot prove a root cause.

## Current one-target Graph contract

Microsoft's current
[create call](https://learn.microsoft.com/en-us/graph/api/application-post-calls?view=graph-rest-1.0)
Example 1 is the applicable service-hosted peer-to-peer shape:

| Field | Current implementation | Contract decision |
| --- | --- | --- |
| `@odata.type` | Present | Matches the example |
| HTTPS `callbackUri` | Present | Required callback for call events |
| One invitation target | Present | Required peer-to-peer target |
| Target `identity.user.id` | Present | Fixed Cory object ID |
| Target `displayName` | Absent | Optional presentation field |
| `requestedModalities: ["audio"]` | Present | Audio only |
| Service-hosted `mediaConfig` | Present | Required media configuration |
| `callOptions` | Absent | Optional; no recording, transcription, or content sharing requested |

The `direction`, `subject`, explicit application `source`, and
`removeFromDefaultAudioGroup` fields appear in Microsoft's multi-target group
call example, not the one-target example. `direction` is also documented as a
read-only property on the [call
resource](https://learn.microsoft.com/en-us/graph/api/resources/call?view=graph-rest-1.0).
Adding that group-call shape would not be a correction to this peer-to-peer
request and could require the broader `Calls.InitiateGroupCall.All`
permission.

`Calls.Initiate.All` remains the least-privileged application permission for
an app-originated one-to-one call without a signed-in originator. The current
[calling-bot registration
contract](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/registering-calling-bot)
also requires a calling-enabled Teams channel, HTTPS calling webhook, calling
manifest flag, and administrator-consented permission.

## Failure diagnosis and retained evidence

The earlier journal intentionally discarded the response body and retained
only `4xx`. Consequently, malformed input, a service-side eligibility or
policy decision, and a transient bot-registration/configuration mismatch
cannot be distinguished honestly. The suggested missing-field cause is now
disfavored because the prior body already matches the current one-target
example.

Future create responses retain only:

- the exact HTTP status;
- a bounded Microsoft error code and sanitized message;
- safe `request-id`, `client-request-id`, and response date correlation;
- the existing reduced state and digested call identity, if one exists.

Bodies over 16 KiB are discarded. Tokens, raw bodies, URLs, email addresses,
UUIDs, phone-like numbers, control characters, and token-like values are not
retained in the error message.

## Live call-disabled readiness

On 2026-07-28, read-only checks reconfirmed the exact dedicated app and service
principal, sole current certificate, sole `Calls.Initiate.All`, fixed Cory
installation, application-only bot token, Azure Bot F0 identity, calling-enabled
Teams channel, and exact HTTPS calling webhook. Cory is Teams-only, licensed
for Teams, and the effective global calling policy has private calling
enabled.

The diagnostic image is running only on
`ca-ap2-call-18f4cc8ae5--diagnostic-2215`. It has one ready replica,
`TEAMS_CALLING_BOT_RUN_CANARY=false`, the expected image/callback/target,
trusted TLS, and a fresh absent journal. No call-enabled revision or call was
created.

## Authentic artifact options

| Path | Authentic artifact | Human session | Material dependencies |
| --- | --- | --- | --- |
| Graph cloud-communications bot | Incoming call and possibly a native missed-call history row | No originator sign-in; Cory signed in and deliberately does not answer | Existing bot and `Calls.Initiate.All`; learner UI observation remains necessary because Graph does not promise the history row |
| Graph bot to Cloud Voicemail | Native voicemail if this bot call is routed and a prompt is recorded | No originator sign-in; Cory must not answer | Separate longer authorization; Cory currently has voicemail enabled, `RegularVoicemail`, and a 20-second unanswered delay; actual bot-to-voicemail routing remains unproven |
| ACS Teams Phone Extensibility | Branded service/resource-account call | No human originator; Cory signed in and does not answer | Preview surface, ACS resource and usage spend, resource account, Teams Phone/enterprise-voice and possible number/PSTN dependencies |
| ACS as a Teams user | Native call attributed to a licensed user | Originator must authenticate and keep a custom-client session; Cory signed in and does not answer | Delegated Teams permissions, ACS resource/usage, Teams-user calling prerequisites |
| Controlled Teams client | Native user-to-user missed call | Licensed originator signed in and confirms the call; Cory signed in and does not answer | Supported client/deep-link path, but unattended UI automation is not established as a supported calling API and is session-fragile |
| Clearly labeled AP2 narrative | Honest application event/story | Cory signs in only to view it in Teams | Cannot be described as a Teams call, missed call, voicemail, or audit record |

The ACS distinctions follow Microsoft's
[Teams interoperability](https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/teams-interop),
[Teams-user identity](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/manage-teams-identity),
and [Teams Phone Extensibility](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/tpe/teams-phone-extensibility-server-outbound-call)
contracts. Cloud Voicemail behavior and policy values are described in
[Cloud Voicemail setup](https://learn.microsoft.com/en-us/microsoftteams/set-up-phone-system-voicemail)
and the
[Teams calling policy](https://learn.microsoft.com/en-us/microsoftteams/teams-calling-policy).

## Prepared missed-call canary (historical checkpoint)

Prefer one newly authorized Graph bot missed-call canary. There is no signed-in
originator. Cory should be signed into Teams and deliberately not answer.
Expect at most one incoming audio call and, after it ends, a possible native
missed-call row. Stop at the existing approximately 15-second absolute
deadline, or immediately on refusal, uncertainty, or abort; never retry. Then
return to a newly verified literal-false revision. Sean's observed Teams UI is
required to make the missed-call learning claim.

Voicemail is a different experiment. It needs a separately authorized window
longer than Cory's proven 20-second unanswered delay and a prompt plan; it must
not be inferred from the 15-second canary.

## Missed-call canary result

Sean gave a fresh `GO` on 2026-07-28 while signed into Teams as Cory and
deliberately did not answer or dismiss. The one authorized create request used
the request documented above. Microsoft Graph definitively returned HTTP `403`,
error code `7505`, and the sanitized message `Request authorization tenant
mismatch.` before assigning a call identity.

No call, incoming or missed-call UI event, callback, voicemail route, or
hang-up existed. Sean therefore had no UI observation to provide. The exact
Microsoft request correlation is retained only in protected evidence.

The result proves that Graph's communications service classified this request
as a tenant-authorization mismatch. It does not yet prove which hidden
registration or service condition produced that classification: the token,
application, service principal, Azure Bot, and Cory target all exposed the same
verified tenant ID, and current Azure Bot documentation supports single-tenant
bot identities. The earlier missing-group-fields hypothesis is not supported
by either the current contract or this response.

The service recovered to
`ca-ap2-call-18f4cc8ae5--disabled-020613`, one healthy replica with literal
`TEAMS_CALLING_BOT_RUN_CANARY=false`. The journal records one create attempt,
zero callbacks, and zero hang-ups. No second call is authorized. A future
Graph-bot attempt should require a specific repair of the platform's tenant
authorization binding and a new explicit GO; broadening permissions or
changing to a group-call body would not follow from this result.

## Tenant-binding diagnosis

Fresh authoritative reads after the `7505` refusal closed the remaining
visible-identity gaps. The token issuer, `tid`, audience, app ID, `oid`, `sub`,
application identity, and sole `Calls.Initiate.All` role all resolve to the
same Student-tenant application and service principal. The subscription,
organization, single-tenant application, enabled home-tenant service
principal, sole Graph role assignment, and Cory's tenant-local Member identity
also align.

The Azure Bot resource is `SingleTenant`; its `msaAppId`, `msaAppTenantId`,
generic tenant ID, endpoint, and provisioned state are exact. Its Teams
channel is enabled for calling with the expected Graph route and webhook.
Graph's tenant catalog exposes one published app definition, the definition's
bot relationship returns the same application ID, and Cory has that exact
definition installed. The local package additionally has the same manifest
and bot IDs and `supportsCalling: true`.

Microsoft's current official
[Azure Bot contract](https://learn.microsoft.com/en-us/azure/bot-service/provision-and-publish-a-bot?view=azure-bot-service-4.0)
and [calling-bot
registration](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/registering-calling-bot)
support this single-tenant configuration and the existing one-target request.
They do not document error
`7505`, expose the Cloud Communications service's internal calling-registration
record, or provide a deterministic repair for stale backend registration.
Consequently, the strongest honest diagnosis is a Microsoft-internal
registration ambiguity after every exposed tenant binding proved exact.
Re-saving the channel, recreating an identity, adding request fields, or
placing another call would test hypotheses rather than correct a proven
misbinding, so no tenant or deployment mutation was made.

The current service remains on healthy revision
`ca-ap2-call-18f4cc8ae5--disabled-020613`, with one replica and literal
`TEAMS_CALLING_BOT_RUN_CANARY=false`. The retained `7505` request correlation
is sufficient for Microsoft backend support. Until that produces a specific
repair, another Graph-bot call is not technically justified.

If an authentic Teams-native missed-call artifact is needed now, the smallest
decision-ready pivot is a controlled licensed-user call: a clearly identified
lab originator must be signed into Teams, Cory must be signed in and not
answer, and a fresh explicit GO must authorize exactly one call. This sacrifices
unattended service origination but avoids new infrastructure and spend. ACS
Teams Phone server calling remains the unattended fallback, but adds an ACS
resource and preview/resource-account/Teams Phone dependencies; it is not the
smallest next canary.

## Controlled-user result

On 2026-07-29, Sean used the supported Teams client path for exactly one
authorized call from the existing licensed fictional lab user
`kobe@corywest.onmicrosoft.com` to
`cory@corywest.onmicrosoft.com`. Kobe's client showed the active Cory call and
then the post-call quality prompt. Cory remained signed in and did not answer
or dismiss. Cory's Calls history showed one Kobe West entry at 1:10 AM labeled
`Missed incoming`, and Cory's Activity showed one `Missed call from Kobe West`
Teams-call notification. No second call was made or observed, and neither
client showed an active call afterward.

This proves that existing licensed AP2 lab users can produce an authentic,
learner-visible native Teams missed-call artifact through a controlled
user-to-user client action. The exact elapsed duration was not independently
measured; Sean reported that the call may have approached the voicemail
threshold. No greeting or message was heard or left, and voicemail routing,
creation, content, and absence were not inspected. Voicemail therefore remains
unproven.

The result does not prove unattended calling. It required a human to maintain
the exact Kobe session, select the exact Cory target, start one audio call, and
end it. This path is suitable for bounded human-assisted scenario construction
or pre-seeding a lab artifact, but it is not an automated per-learner runtime
capability. The application-originated Graph bot remains blocked by HTTP `403`
/ code `7505` pending a specific Microsoft backend repair.

## Operator-free evidence-producer decision

On 2026-07-29, a bounded browser harness opened fresh non-persistent Teams Web
contexts with service workers blocked and no storage-state export. Kobe's
certificate established an exact `kobe@corywest.onmicrosoft.com` Teams
session. Three bounded Cory readiness attempts did not progress past
Microsoft's authentication surface, including one headed attempt. Every
context closed, no browser state or token was retained, and no call control was
used. This is controlled browser UI automation, not a supported calling API.
Without a deterministic, isolated Cory observation session, placing the one
permitted call would not have produced trustworthy terminal or native-artifact
evidence, so the call allowance was not consumed.

The supported alternatives were also not ready inside the lane:

| Path | Classification | Decisive result |
| --- | --- | --- |
| Existing Graph bot | Supported Cloud Communications API | Exact app remains blocked pre-identity by `7505`; no retry without a Microsoft-specific repair |
| Teams Web harness | Lab browser UI automation | Exact ephemeral Kobe caller session passed; isolated Cory observer readiness failed after three bounded attempts |
| ACS as Teams user | Supported client SDK | No ACS resource or `Teams.ManageCalls` / `Teams.ManageChats` delegated grants exist; it still needs a delegated user session and custom client |
| Teams Phone Extensibility | Preview server/client surface | No ACS resource, Teams Phone resource account, Enterprise Voice, or linkage exists |
| Human Teams client | Supported client operation | One authentic missed-call artifact is proven, but the originator is human-operated |

No ACS resource, credential, permission, enabled revision, call, or incremental
spend was created. The smallest honest non-call fallback is therefore the
already-proven delegated `sendMail` primitive: a new fixed backend operation
can submit one clearly labeled Kobe-to-Cory Outlook help-desk email. Its
subject and body explicitly identify it as an AP2 lab email, not a Teams call
or voicemail; the API and UI expose only the `email` platform claim, verify the
exact Kobe token identity before Graph, accept only Graph `202`, and never
retry inside the one API process after any attempted submission. Like the other
Pass 3 mutations, it has no durable cross-replica exactly-once journal. This
fallback is implemented and deterministically tested but was not
staged in Microsoft during this lane, so delivery remains unproven until a
separately authorized hosted rehearsal.
