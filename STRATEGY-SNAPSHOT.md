# Strategy snapshot — 2026-08-09

This is a point-in-time orientation artifact for a replacement strategy session
or read-only observer. It is **not** live execution state. Use the Durable
Coordinator MCP bridge or the coordinator's durable state for current execution
status. Canonical project documents remain authoritative for durable product and
workflow rules.

Completed capability evidence belongs in `docs/proven-capabilities.md`; durable
product and agent-workflow rules belong in `AGENTS.md` and the focused strategy
documents.

## Strategic frontier

AP2 is still in capability exploration. The current frontier is third-party SaaS
identity/security integration rather than more AVD timing optimization.

Two complementary SaaS paths are now clear:

- **YouTrack** proves a non-gallery Entra SSO + SCIM lifecycle and a genuine
  Defender for Cloud Apps Conditional Access App Control session-control path.
- **GitHub Enterprise Cloud with Enterprise Managed Users** has proven Entra
  OIDC + SCIM managed-user lifecycle and enterprise administration. The open
  question is the first-party Defender for Cloud Apps GitHub API App Connector.

The SPA remains Sean's internal capability notebook/operator console, not the
learner product or a generalized lab framework. Continue favoring small,
decisive capability experiments over infrastructure or ceremony that is not
needed to answer the current question.

## Endpoint / AVD state

Recent timing work established a useful learner-side calibration for a genuinely
fresh generalized-image Marge endpoint:

- fresh deployment -> learner connection accepted: about **9m00s**;
- fresh deployment -> genuinely usable desktop: about **11m13s**;
- the final Windows `Welcome` / first-profile phase was about **2m13s**.

Earlier clean raw-marketplace runs were roughly **14-15 minutes** to visible
usable desktop. Do not restart endpoint optimization unless a later learner or
product need makes it worthwhile.

The retained Marge endpoint has been used for the live YouTrack/Defender proof.
Verify current Azure power state when it matters rather than relying on this
snapshot. The live `AP2 Simulated User CBA` Entra group remains authoritative
for current simulated-user CBA membership.

An unrelated AVD clipboard annoyance was observed earlier: VM -> local Windows
clipboard worked while local Windows -> VM paste did not. Keep that conceptually
separate from Defender browser/session clipboard controls.

## Coordinator / peer workflow

The current Codex team is `AP2 Coordinator` plus durable peers Alpha through
Epsilon. All five peers are **AVAILABLE** as of this snapshot.

Preserve **bottom-up judgment**. A peer owns the outcome, not a checklist or a
proposed implementation. Goal cards should not repeat standing project rules or
remembered prior mistakes; task-specific constraints are only facts that truly
narrow what counts as a valid answer. A reversible change of means inside the
same goal is not escalation.

Recent workflow/doc changes reinforced this after repeated over-specification
caused agents to treat implementation details as contracts. The generic durable
peer prompt in `codex-agent-tools` was also shortened so it no longer injects
large standing judgment/completion paragraphs into every assignment.

`state.json` remains the durable assignment/goal state and `journal.jsonl` the
event history; there is no separate live `goals.json`.

### New Durable Coordinator MCP bridge

A new project-agnostic ChatGPT MCP bridge in `codex-agent-tools` is now installed
and connected as the **Durable Coordinator** custom app. This should be the
replacement strategist's normal control/observation surface instead of arbitrary
Local Shell whenever possible.

It exposes a bounded 13-tool surface for:

- workflow status, durable goals/reports/state/journal;
- recent coordinator or peer messages;
- timeout-safe durable coordinator turn submission plus exact later result
  reconciliation/cached retrieval;
- allowlisted repository text reads, race-aware conditional whole-file writes, and targeted unique exact-text replacement with prior-version compare-and-swap.

The timeout-safe coordinator contract matters: the older workflow sometimes
looked ambiguous when the ChatGPT Local Shell caller stopped waiting after five
seconds even though `agent-turn` had already submitted the coordinator turn.
The new MCP bridge separates fast durable submission from later result retrieval,
so caller timeout should no longer create that uncertainty.

`codex-agent-tools` PR #25 shipped the bridge; PR #26 / merge `b090cde` shipped
the timeout-safe submit/result contract. The dedicated Secure MCP Tunnel is
**Durable Coordinator**, tunnel ID
`tunnel_6a792321dee08191bc9f4a3e3170f636`. Its local profile/service is enabled
and healthy and is separate from the existing Local Codex/Local Shell tunnel.

PR #27 / release `798fe93` added the targeted `repository_edit_text` operation. It replaces one unique exact-text match without requiring the caller to resend the whole file, still requires the SHA-256 from a prior read, and fails closed on stale source, ambiguous targeting, path violations, or symlinks.

This bridge is new. Expect possible small integration kinks and prefer diagnosing
its bounded tool behavior over falling immediately back to raw shell. One known
boundary: repository tools can safely read/write allowlisted text but do not
commit/push; the strategist can own wording through the bridge and use a
coordinator turn for a mechanical publish when needed. The first real handoff
used exactly that pattern successfully.

Local Shell remains useful for genuinely general machine work, but at this
handoff its old `Local Codex` MCP tunnel returned HTTP 404 from ChatGPT. Do not
block strategy work on that: Durable Coordinator covers the routine strategist
surface. Repair/restart the Local Shell tunnel separately if broad shell access
is later needed. The separate tunnels should prevent tool-schema cross-talk
between the two custom apps.

For a replacement strategist, read `codex-agent-tools` `README.md` and
`AGENTS.md` after the AP2 strategy docs, then use Durable Coordinator to inspect
live workflow state before dispatching anything.

## YouTrack state — CA App Control proven

The YouTrack identity lifecycle is proven:

- original OIDC SSO fallback remains working;
- separate SCIM fallback remains working;
- combined non-gallery `AP2 YouTrack SAML + SCIM (staged)` successfully
  provisions the assigned simulated users through Entra SCIM;
- removal from provisioning scope deactivates/bans rather than deletes the
  YouTrack user, and reactivation is reversible;
- Marge successfully signs in through the staged Entra SAML provider.

The Defender Conditional Access App Control experiment is now **end-to-end
proven**. The final successful Marge path was:

1. fresh Edge InPrivate on the retained Marge endpoint;
2. My Apps staged YouTrack tile;
3. red staged SAML provider;
4. Defender monitored-access page and `.mcas.ms` reverse-proxy origin;
5. a second proxied YouTrack login chooser, then the red staged SAML provider
   once more;
6. Marge's YouTrack workspace remained on `.mcas.ms`;
7. Defender explicitly blocked an ordinary Cut/Copy action.

Earlier failed clipboard tests were useful diagnostics rather than policy
semantics: one failure came from Marge still being a Defender onboarding /
maintenance user (`BypassProxy`), and another from having used Defender's
Non-MS-IdP onboarding shape for an Entra-authenticated app. Beta corrected those
premises, restored the native Entra-authenticated SAML shape, and the final
reverse-proxy proof succeeded.

The current session policy is intentionally narrow: Marge + JetBrains YouTrack +
Cut/Copy -> block. Ordinary visible YouTrack text is enough for the proof; the
policy is not merely detection-only.

### My Apps tile is now one-click

The learner-facing launch is now live-proven as a smooth My Apps -> authenticated/proxied YouTrack path. Beta made the proven staged SAML module YouTrack's default authentication provider, so the existing root-targeting My Apps tile generates the SP-initiated SAML request automatically rather than opening the provider chooser. Sean then tested a fresh Marge InPrivate session: one tile click reached the authenticated YouTrack workspace on the `.mcas.ms` reverse-proxy origin with no red-provider clicks, and the existing Cut/Copy block still applied.

The earlier failed direct module-specific shortcut remains useful evidence: bypassing the normal root launch lacked chooser-generated OAuth context and failed after SAML. The successful solution did not require that brittle shortcut; it preserved the root launch and changed the application's default authentication-provider behavior instead.

## GitHub Enterprise / EMU state

The lab GitHub Enterprise Cloud EMU environment is now real and substantially
proven:

- enterprise slug: **`ap2-v2`**;
- Entra OIDC SSO works;
- Entra SCIM provisioning works;
- `admin@corywest.onmicrosoft.com` is provisioned as managed GitHub account
  **`admin_ap2`** with **Enterprise Owner** through the existing IdP/SCIM path;
- Cory remains an ordinary simulated managed user rather than an administrator;
- isolated CLI wrapper **`gh-ap2`** uses its own `GH_CONFIG_DIR` and is separate
  from Sean's normal personal `gh` profile;
- managed `admin_ap2` created organization **`ap2-v2-lab`** through GitHub's
  supported enterprise GraphQL API;
- attributable lab activity exists, including a proof repository/issue and
  organization audit events.

The special GitHub EMU setup account `ap2_admin` is distinct from `admin_ap2`.
`ap2_admin` is the GitHub setup/recovery identity originally associated with the
email used to bootstrap the enterprise; normal enterprise administration is
being done by the SCIM-managed `admin_ap2` account.

### Defender GitHub API App Connector connected

The Microsoft Defender for Cloud Apps GitHub API App Connector is now connected. Earlier agent-driven browser attempts had repeatedly observed a disabled GitHub OAuth-consent control for the verified managed Enterprise Owner `admin_ap2`, even after several reasonable scope/session/restriction checks. Read-only role verification later showed that `admin@corywest.onmicrosoft.com` already had permanent Global Administrator and therefore was not missing Defender connector authority; `after-party-operator@corywest.onmicrosoft.com` is a second permanent human Global Administrator.

Sean then manually completed the Defender/GitHub connector flow successfully. Therefore the prior disabled-consent observation must not be carried forward as an EMU/platform blocker or as evidence that a dedicated organization-owner identity is required. The exact reason the agent-controlled browser saw a disabled control remains unknown. This is a useful operating lesson: prefer supported API/CLI paths where available, use straightforward supported browser automation when it works, and hand genuinely tricky interactive browser edge cases to Sean rather than overfitting architecture or identity around an automation failure.

Treat connector creation and connector telemetry as separate claims. The connector itself is now proven connected; matching GitHub `CloudAppEvents` or other ingested Defender evidence should be recorded only after it is actually observed.

Do not make Cory or other simulated learner identities special merely because they are convenient test accounts.

## Other SaaS / network notes

Keep Defender API App Connectors, Defender Conditional Access App Control, and
Global Secure Access / Entra Internet Access conceptually separate:

- API App Connector = deeper SaaS telemetry/governance where vendor integration
  exists (GitHub is the intended example);
- CA App Control = real-time controls inside an authenticated SaaS session
  (YouTrack Cut/Copy blocking is now the proven example);
- GSA / Entra Internet Access = identity-aware web/network path controls such as
  URL/domain filtering or requiring compliant network access.

Webex remains lower priority; a managed Control Hub organization is not yet
proven on the free path.

## Strategy reminders

- Inspect Durable Coordinator live state before acting; this snapshot is not a
  live docket.
- Strategist co-creates goals with Sean; the coordinator executes approved work
  through peers.
- Preserve original purpose through delegation and let peers exercise technical
  judgment inside real boundaries.
- Prefer supported API/CLI paths first, straightforward supported browser UI
  second, and brittle/private workarounds last. When a supported interactive
  browser edge case resists automation without a clear technical reason, a
  bounded human step is preferable to reshaping the architecture around the
  automation failure.
- Learner-style actions that are themselves the evidence are good manual Sean
  actions; backstory/configuration/policy setup should be automated where
  reasonably possible.
- Prefer fast empirical experiments over speculative architecture.
- Do not turn endpoint optimization back into the active project unless a later
  learner/product need makes it worthwhile.
- The Student tenant and endpoint infrastructure remain disposable and should be
  reproducible; nothing important should depend on preserving one specific VM.
