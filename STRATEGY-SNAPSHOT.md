# Strategy snapshot — 2026-08-22

This is the point-in-time handoff for a fresh AP2 Strategist. It is intentionally
compact and judgment-oriented. It is **not** live workflow state, a backlog, or
a request to resume old work. Inspect the Durable Coordinator before assuming
anything below is still active, and use `docs/proven-capabilities.md` only for
the evidence relevant to the question at hand.

## Recover the project

Read the shared Strategist guidance in `agent-tools`, then this repository's
`AGENTS.md`, `chatgpt-strategy.md`, `docs/product-direction.md`,
`docs/product-model.md`, and `docs/student-environment-baseline.md`. Read
`docs/durable-runtime.md` when execution or credentials matter. Search, rather
than ingest, the relevant portions of `docs/proven-capabilities.md`.

The Strategist owns product direction and strategy documents. The Coordinator
owns orchestration/integration of approved technical work. Workers own
implementation and evidence. Do not turn old work numbers, negative results,
worker suggestions, or technical leftovers into a backlog merely because they
exist.

## Product mental model

AP2 is still an exploration project moving from isolated capability proofs toward
**direct composition of realistic technical incident backgrounds**. The useful
progression remains:

**capability -> realistic scenario / incident background -> later detection,
prevention, response, and teaching work**

AP2 does not yet need a generalized scenario engine, learner contract,
assessment framework, or publishing system. Prefer direct code and direct
composition until repeated concrete work proves an abstraction is useful.

The current SPA is Sean's internal capability notebook/operator console, not the
learner product.

### Connected-Student architecture

The Product/Central tenant owns the multitenant After Party app registration.
It does **not** centrally operate every Student tenant.

A connected Student installation owns its own AP2 runtime:

- the After Party enterprise application/service principal in that Student
  tenant;
- the Student-local API/backend and supporting Azure resources;
- simulated users, licensing, endpoint estate, security configuration, and SaaS
  integrations;
- a Student-local runtime identity/managed identity for backend operations.

The SPA signs the user in, discovers the Student API URL from tenant-persisted
configuration, and calls that Student-local backend. W64/W65 already moved the
runtime toward per-installation configuration plus tenant-persisted API discovery.
The full Connect -> consent -> provision -> configure flow is still future work.

## Standing environment should look like a normal enterprise

A central strategic requirement is now explicit in
`docs/student-environment-baseline.md`: **standing infrastructure should use
conventional enterprise deployment, targeting, and management patterns where
practical.**

A direct-user assignment, manual install, one-off endpoint mutation, or narrow
proof technique can be entirely appropriate while exploring. It should not
silently become the canonical baseline just because it worked. Once a capability
is promoted to standing infrastructure, prefer to normalize it toward the
ordinary centrally managed pattern a typical enterprise would reasonably use.

Current baseline direction:

- normal users are standard users, not local admins;
- retained Windows endpoints are Entra joined, Intune managed/compliant, and
  Defender for Endpoint protected;
- there is no standing AppLocker/WDAC default-deny application whitelist;
- Windows quality/security updates are centrally managed through Intune/WUfB;
- normal corporate software should increasingly be Intune-managed where useful;
- Security Defaults is off because Conditional Access supplies the standing
  identity controls;
- standing CA broadly requires MFA and blocks legacy auth and device-code flow;
- CBA remains a supported high-affinity development/simulated-user method;
- passkey/FIDO2 self-service is enabled for all users, including the ordinary
  device-bound/synced default profile plus a separate Windows Hello device-bound
  profile;
- GSA can be standing corporate network/SWG infrastructure, but its standing
  deployment should use ordinary central management rather than proof-only
  direct-user mechanics;
- TLS inspection is optional and intentionally narrow; Rachel may remain a
  development endpoint for comparing decrypted versus non-decrypted telemetry.

### Desired-state tooling

The desired model is deliberately mixed rather than forcing everything through
one configuration system:

- **Microsoft365DSC** = provision/converge stable supported Microsoft 365/Intune
  resources;
- **Graph Tenant Configuration Management (TCM)** = independent drift visibility,
  not a substitute for convergence;
- **Intune** = endpoint policy and ordinary centrally managed software;
- **Azure-native provisioning** = Student backend, AVD, managed identities, and
  other Azure resources;
- **direct Microsoft APIs/AP2 logic** = installation-specific or awkwardly
  modeled resources.

The first real Microsoft365DSC baseline is live and covers the three standing CA
policies plus the Windows update ring/feature-update profile. TCM independently
monitors the three CA policies.

## Endpoint, AVD, and learner-access model

AVD is transport to retained Windows endpoints, not part of the fictional
incident. The endpoint should be reasoned about like an ordinary managed employee
PC.

Retained VMs already have idle auto-deallocation. Workers should clean temporary
artifacts and log off their exact sessions, but **must not manually stop or
deallocate retained VMs merely as ordinary cleanup**. Let the standing idle
policy handle that unless an experiment specifically requires a power action.

W80 turned Rachel's retained AVD path into a much more deterministic reusable
seam. The important meaning of “deterministic” is not a fixed number of seconds;
it is:

**same requested state/action -> same eventual outcome, with asynchronous
transitions explicitly observed and reconciled.**

The reusable path reconciles VM/host state, AVD's pending-to-active session
transition, a real Rachel remote canvas, one Rachel-attributed Edge action,
native GSA evidence, and exact-session cleanup. Azure start receipts, AVD host
registration, session activation/canvas rendering, and Microsoft telemetry
publication remain asynchronous and should be handled by state observation, not
fragile sleeps.

Do not assume Azure Run Command is a reliable interactive-readiness dependency;
its serialized extension was live-observed busy while the endpoint itself was
usable.

### Intended learner experience on a simulated endpoint

The learner should normally drop into an endpoint that is **already genuinely
running as the simulated user** and should not need to know or type that user's
password just to use ordinary Microsoft 365 resources.

The preferred foundation is Windows/Entra in-session SSO (PRT/CloudAP or the
supported equivalent), not merely stale Edge cookies. Separate Edge profiles are
still useful for simulated-user browsing state, history, cookies, and visual
separation, but the browser profile itself should not be treated as the durable
authentication foundation.

At this handoff, W83 is actively checking Rachel and Kobe for exactly this
behavior and is authorized to implement the smallest sensible standing fix if
OS-backed Microsoft 365 SSO is missing. Inspect its result before making a new
assumption.

For access from a learner's **own** computer, the tenant now allows ordinary
cross-platform synced passkeys and Windows Hello-backed Entra passkeys. This is a
separate concern from the already-authenticated simulated endpoint. Temporary
Access Pass is the clean bootstrap when a user has no usable MFA method; after
registration, a learner can use the normal passkey provider for their Windows,
Mac, Chromebook, or other supported device.

## Realistic scenario construction

AP2 realism is about safely reproducing the **observable evidence shape** of an
incident, not harmful outcomes.

The Product/Student tenants, simulated identities, retained endpoints, AP2-owned
SaaS, and synthetic data are controlled sandbox assets. Use the smallest benign
action that creates the evidence actually needed.

Important rules:

- **Actor semantics matter.** If evidence should look user-originated, use that
  real simulated user's Microsoft 365 or Windows context when attribution,
  browser history, user registry state, process ancestry, or workload audit
  matters.
- **Use control-plane automation when actor identity is irrelevant.** Graph, ARM,
  Defender APIs, Azure Run Command, and similar mechanisms are often better for
  neutral setup/cleanup/observation.
- **Do not let simulation machinery become the incident.** Avoid a generic
  permanent guest execution agent whose own service/process/network artifacts
  contaminate evidence. A tiny helper is acceptable only if a concrete remaining
  readiness gap justifies it and it stays outside evidence-sensitive ancestry.
- **Stage before the learner arrives.** The learner should investigate the
  resulting tenant/endpoint state rather than watch construction machinery run.
- **Retain the smallest reusable deterministic path** after a scenario is proven.
  One useful runner does not justify a generalized scenario framework.

Recent scenario work established a strong composition anchor: a managed Rachel
endpoint visited an AP2-controlled fake company/enrollment page, GSA/TLS and MDE
captured native endpoint/network evidence, a meaningfully distinct Rachel
Microsoft-authenticated session appeared from separate controlled infrastructure,
and Rachel registered a marked passkey with native Entra Authentication Methods
evidence before cleanup. The importance is the composition/evidence seam, not
that this exact BlackFile/UNC6671-inspired chain must dominate future work.

Do not require evidence Microsoft does not consistently retain. In particular,
MDE `DeviceNetworkEvents` did not appear in one later composed Rachel run even
though the Edge process and GSA transaction did; GSA is therefore an acceptable
native network record where present. Do not require an alert, Identity Protection
risk, exact source IP, or exact telemetry arrival time unless the specific lab
actually depends on it.

## Standing technical anchors

Useful current anchors, without turning them into a checklist:

- protected development runtime:
  `/home/agent/.local/share/ap2/runtime` on `work`;
- central encrypted development copy:
  `kv-ap2-dev-central-6d8e` in `rg-ap2-development`;
- standing runtime currently includes the simulated-user CBA material, operator
  material, Dev/Graph credential, and Rachel GSA TLS CA material;
- W73 restored the standing MFA/legacy/device-code Conditional Access baseline;
- W76 established the central Intune/WUfB update baseline;
- W77 established TCM drift visibility;
- W79 established real Microsoft365DSC convergence;
- W80 established deterministic retained Rachel AVD execution;
- W82 added the Windows Hello passkey profile without replacing the existing
  synced/default passkey profile.

Homer's retained endpoint is not a useful blocker. It has had an endpoint-specific
AVD/RDSAAD logon failure and is not fully healthy in Intune. If it remains bad,
repair or replace/remove that VM later; use healthier Rachel/Kobe/Marge paths for
scenario development rather than distorting strategy around Homer.

## Active work at this handoff

As of this snapshot, the Durable Coordinator reports two active goals. These may
finish immediately after this document is written, so **read the Coordinator
rather than trusting this section as live state**.

- **W83 — simulated-endpoint Microsoft 365 SSO:** verify Rachel/Kobe have a real
  simulated-user Windows session with OS-backed Entra SSO into ordinary Microsoft
  365 sites, so the learner does not need the user's password; make the smallest
  standing fix if needed.
- **W84 — normalize Global Secure Access:** review the live GSA setup against
  Microsoft's conventional enterprise deployment guidance and normalize client
  deployment, traffic-profile targeting, and learner-facing app exposure where
  appropriate. Preserve Rachel's deliberately narrow TLS-inspection exception;
  do not broaden it accidentally.

W84 exists because Rachel's direct assignment to the built-in
`GSA-Internettrafficforwardingprofile` surfaced as an ugly `GSA-...` tile in the
Microsoft 365 Apps catalog. That direct assignment was a valid proof path, but it
raised the broader baseline question: whether standing GSA should instead look
like ordinary Intune/group-managed enterprise infrastructure.

## Likely next strategic questions

After reconciling W83/W84, the next Strategist should discuss the next useful
product question with Sean rather than automatically spawning work. Reasonable
areas include:

- fold the W83/W84 conclusions back into the standing baseline and desired-state
  machinery;
- continue extending Microsoft365DSC only to stable resources it models cleanly;
- compose more realistic incident backgrounds from already-proven capabilities;
- turn a proven composition into one deterministic staging command when doing so
  solves a real repetition problem, then later move that behind the Student-local
  backend/SPA if the product direction actually needs it;
- continue exploring under-tested Microsoft/security/SaaS surfaces rather than
  over-polishing one scenario family.

Do not prematurely build the eventual learner product, general scenario engine,
or universal reset system.

## Handoff boundary

`docs/proven-capabilities.md` is the canonical evidence ledger; search it when a
specific capability matters. `docs/student-environment-baseline.md` is the
canonical desired standing environment. `docs/product-direction.md` and
`docs/product-model.md` carry durable product meaning. This snapshot only gives
the replacement Strategist enough context to resume judgment without replaying
this conversation.

AP2 product work belongs in `ap2`. Generic Strategist/Coordinator/worker behavior
and shared harness defects/features belong in `agent-tools`.

A fresh Strategist should recover this compact model, inspect the live Durable
Coordinator, note any worker results that landed after this snapshot, and then
ask Sean what product question should come next. Do not keep agents busy merely
because an old limitation or unfinished idea exists.
