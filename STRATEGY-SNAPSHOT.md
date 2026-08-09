# Strategy snapshot — 2026-08-09

This is a point-in-time orientation artifact for a replacement strategy session
or read-only observer. It is **not** live execution state. For worker status use
`coordinator-dispatcher peer-status`; durable coordinator state wins for current
execution status. Canonical project documents remain authoritative for durable
product and workflow rules.

Completed capability evidence belongs in `docs/proven-capabilities.md`; durable
product and agent-workflow rules belong in `AGENTS.md` and the focused strategy
and architecture documents.

## Strategic frontier

The active frontier is third-party SaaS identity/security integration. YouTrack
has now proven a useful non-gallery Entra SSO + SCIM lifecycle, and the immediate
open question is Defender for Cloud Apps Conditional Access App Control. GitHub
Enterprise Cloud with Enterprise Managed Users is the next likely SaaS because
it can add a first-party Defender API App Connector / deeper CASB example rather
than merely repeating YouTrack.

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
usable desktop. A newer/faster CPU improved pre-login readiness, but its full
desktop comparison was contaminated by Rachel initially lacking the retained
simulated-user CBA prerequisites. Rachel was then given a certificate mapping and
added to the live CBA group; the successful run reached a real Rachel desktop.
Do not use a static repo list as current CBA authority: query the live
`AP2 Simulated User CBA` Entra group.

Current retained VM state:

- `ap2margefresh-vm`: **running** for the current YouTrack/Defender browser work;
- Rachel, Kobe, and Homer retained test VMs: **deallocated**;
- the older duplicate Marge VM/NIC/disk was already removed.

An unrelated AVD clipboard annoyance was observed on Marge: VM -> local Windows
clipboard worked while local Windows -> VM paste did not, despite host-pool
clipboard redirection being enabled. Treat that as a separate endpoint-policy
issue; do not confuse it with Defender browser/session clipboard controls.

## Coordinator / peer workflow

The current Codex team is:

- `AP2 Coordinator`: GPT-5.6 Sol, **High** reasoning;
- `AP2 Alpha`, `Beta`, `Gamma`, `Delta`, `Epsilon`: GPT-5.6 Sol, **Medium**;
- approvals `never`, using the hardened app-server boundary;
- `coordinator-dispatcher peer-status` is the intended human watch interface.

As of this snapshot all five peers are **AVAILABLE**.

The source/install for the workflow is the separate
`/home/west/codex-agent-tools-source` repository. For a replacement strategist,
read that repo's human-facing `README.md` and then its compact agent-oriented
`AGENTS.md`; the latter is intentionally the fast operating/state/recovery model
and keeps project-specific AP2 strategy out of the reusable tooling repo.
Important recent reliability fixes are on its `main`:

- PR #22: automatic durable peer-report capture;
- PR #23: durable completion reconciliation across app-server connections;
- PR #24 / merge `d994839`: peer reports now derive PEER and QUESTION from the
  trusted durable assignment rather than requiring brittle model-authored exact
  copies. The existing Delta ambiguity was safely recovered from exact durable
  assignment/thread/turn/prompt identity.

`state.json` remains the durable assignment/goal state and `journal.jsonl` the
event history; there is no separate live `goals.json`. Preserve these recovery
properties when changing dispatcher behavior.

First-contact `agent-turn` can still show interrupted reconciliation transport
noise. `chatgpt-strategy.md` documents the intended internal recovery: do not
blindly resend an accepted turn; inspect the exact durable turn, and resume the
exact configured thread only when it is merely not loaded.

Local Shell can also be transiently blocked upstream by ChatGPT safety behavior,
especially around direct raw-secret handling. A later benign `pwd` succeeded
without restarting the local systemd tunnel. Prefer local helpers/peers that
consume secrets without printing them, and test a harmless command before
assuming the tunnel itself is broken.

## Judgment and coordination

Preserve **bottom-up judgment**. The coordinator should translate strategist/user
intent into a bounded durable goal, preserve the real purpose and invariants,
and leave ordinary implementation judgment to the peer worker. Do not react to
one peer mistake by making every later goal increasingly prescriptive.

Use peers primarily for substantial local/Azure/API/code work and longer local
execution. Ordinary internet/vendor research is usually strategist work. Avoid
procedural ceremony: goal cards, reports, independent review, or another peer
are useful only when they reduce a real risk or answer an independent question.

Sean usually wants to perform learner-style actions himself when the action is
the evidence: navigating the SaaS UI, inspecting logs, or attempting an action
that should be denied. Automation is more valuable for backstory/evidence setup,
policy toggles, tenant configuration, and development infrastructure.

## YouTrack state

The original YouTrack integration is now substantially proven:

- `AP2 YouTrack` uses YouTrack's Microsoft/Entra auth path and remains a working
  SSO fallback;
- separate `AP2 YouTrack SCIM` remains active as a working provisioning fallback;
- `AP2 YouTrack Users` contains exactly Homer, Cory, Marge, and Kobe and is the
  entitlement group for the YouTrack experiment;
- SCIM creation/update was proven, group removal sent `active=false` and YouTrack
  banned Marge rather than deleting her, and reactivation/rejoin is the intended
  reversible lifecycle;
- Marge successfully signed in to YouTrack through Entra.

A parallel, more conventional non-gallery combined integration is also staged:

- enterprise app: `AP2 YouTrack SAML + SCIM (staged)`;
- service principal object `2624fbca-43b9-49a0-8fea-aa813ddc47f8`;
- YouTrack SAML module `f97de8a7-286d-4f98-93ba-c9218897b60a`;
- one Entra-managed SCIM job on that same enterprise app successfully provisioned
  all four assigned users;
- the old OIDC + separate-SCIM paths intentionally remain active for rollback;
- the temporary YouTrack admin token file was deleted and no secret was retained
  in repo/dispatcher state.

Marge proved the new **SP-initiated SAML** path: from the YouTrack login chooser,
clicking the red `Microsoft Entra ID SAML (staged)` provider completed Entra SAML
and landed in YouTrack as Marge. The staged Conditional Access policy
`ad0f2a27-e0c6-4f54-b23f-9adcb8f08da7` applied to that successful sign-in.

### My Apps tile

The My Apps tile is useful as a learner-facing federation anchor, but it is not a
security boundary and does not itself cause Defender proxying. Current safe
state: the tile's `loginUrl` is restored to the YouTrack root. It therefore opens
YouTrack's login chooser, after which the user clicks the red staged SAML icon.

A direct module-specific login URL was tested to try to make the tile one-click.
Its initial backend probe returned a plausible `303`, but a real Marge browser
launch failed after successful SAML at YouTrack `/hub/auth/oauth/error` because
the shortcut lacked chooser-generated OAuth client/redirect/scope/state context.
That shortcut was rolled back. One-click tile polish remains desirable, but it
must not destabilize the proven SP-initiated SAML path.

### Defender Conditional Access App Control blocker

Entra routing is **not** the current blocker: Marge's staged SAML sign-in shows
the CA App Control policy applied. However Defender for Cloud Apps still reports
an empty `proxy_apps` inventory / no apps deployed with Conditional Access App
Control. Because YouTrack has not materialized as an onboarded proxy app, the
clipboard-blocking session policy cannot yet be created.

Immediate next YouTrack/Defender experiment: explicitly onboard/deploy
`AP2 YouTrack SAML + SCIM (staged)` into Defender Conditional Access App Control
until it appears in proxy-app inventory, then create the smallest Marge-scoped
session policy that blocks Copy. The learner-style proof should then use the
known-good SAML path and attempt **YouTrack -> Notepad inside Marge's VM** so the
result is not confused with the separate AVD clipboard boundary.

Security Defaults was disabled during the CA experiment as required for the
Conditional Access setup. Remember this retained tenant-state change when later
cleaning up or rebuilding baseline policy.

## GitHub Enterprise direction

The next SaaS should be **GitHub Enterprise Cloud with Enterprise Managed Users
(EMU), hosted on GitHub.com**, rather than ordinary personal GitHub accounts for
simulated learners. The purpose is to add capabilities YouTrack does not have:

- first-party Defender for Cloud Apps **GitHub Enterprise Cloud API App
  Connector** / deeper CASB visibility and SSPM-style posture;
- Microsoft Entra as IdP with managed-user lifecycle through SCIM;
- simulated developer identities provisioned from Entra rather than requiring
  each fictional user to maintain a personal GitHub account.

The GitHub "organization owner" requirement for the Defender connector is an
authorization role, not real-world proof that a human is vouching for a company.
The EMU setup user/bootstrap enterprise owner can handle initial configuration;
simulated users should later come from Entra.

Sean has begun the GitHub Enterprise Managed Users trial setup. Current intended
form choices are:

- host on GitHub.com without data residency;
- enterprise name `After Party`;
- a sensible available enterprise slug such as `after-party` or
  `after-party-labs`;
- immutable username shortcode **`ap2`**;
- Microsoft Entra ID as identity provider;
- United States, Education if offered, and the smallest truthful employee-size
  bracket for this disposable lab setup.

Do not use or inspect Sean's unrelated personal GitHub repositories/accounts as
part of AP2 automation. The bootstrap account is only for creating/administering
the lab enterprise. No `AP2 GitHub Developers` entitlement group exists yet; a
new group of that sort would be a natural next Entra object once the enterprise
exists and the desired simulated developers are chosen.

## Other SaaS / network notes

Webex remains lower priority. The free self-signup path is not yet proven to
provide the managed Control Hub customer organization needed for the desired
SSO+SCIM lifecycle; trial/paid organization setup may be required.

Keep Defender API App Connectors, Defender Conditional Access App Control, and
Global Secure Access / Entra Internet Access conceptually separate:

- API App Connector = deeper SaaS telemetry/governance where vendor integration
  exists (GitHub is the intended example);
- CA App Control = real-time controls inside an authenticated SaaS session
  (YouTrack clipboard blocking is the current experiment);
- GSA / Entra Internet Access = identity-aware web/network path controls such as
  URL/domain filtering or requiring compliant network access. It does not force
  users to click My Apps; direct SaaS navigation can still be federated through
  Entra and controlled by CA.

## Strategy reminders

- Before acting on worker status, inspect durable coordinator state rather than
  treating this snapshot as a live docket.
- Strategist co-creates goals with Sean; the coordinator executes approved work
  through peers.
- Preserve original purpose through delegation and let peers exercise technical
  judgment inside the real boundaries.
- Prefer fast empirical experiments over speculative architecture.
- Do not turn endpoint optimization back into the active project unless a later
  learner/product need makes it worthwhile.
- The Student tenant and endpoint infrastructure remain disposable and should be
  reproducible; nothing important should depend on preserving one specific VM.
