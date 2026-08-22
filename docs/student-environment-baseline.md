# Student environment standing baseline

This document describes the **standing environment AP2 wants a connected Student
installation to converge toward**. It is desired product/environment state, not
scenario state, historical evidence, or a promise that every row is automated
today.

Use `docs/proven-capabilities.md` to establish what has actually been live-proven.
Use per-installation configuration for Student-specific identifiers. Scenario
runs may add and remove incident artifacts around this baseline, but should not
silently redefine it.

## Baseline principle

The Student tenant and its retained Windows endpoints should resemble a normally
managed enterprise environment before AP2 stages an incident:

- ordinary users are standard users rather than local administrators;
- identity, devices, software, updates, endpoint security, and network controls
  are centrally managed;
- Defender/EDR and other security products observe normal activity;
- there is **no assumption of a strict default-deny application allowlist**;
- scenario-specific controls and artifacts remain separate from standing
  infrastructure;
- standing infrastructure should use **conventional enterprise deployment,
  targeting, and management patterns** where practical. A narrow direct-user,
  manual, or endpoint-local technique can be appropriate while proving a
  capability, but it should not silently become the canonical baseline merely
  because it worked. Before a proven capability becomes standing infrastructure,
  prefer to normalize it toward the ordinary centrally managed pattern a typical
  enterprise would reasonably use.

This distinction matters for realism. A standard user may still execute software
in their own context when Windows and the standing security controls permit it,
even though system-wide installation, drivers, services, and protected locations
require elevation.

## Desired standing state

| Area | Standing target |
| --- | --- |
| Product identity | The Product tenant retains the multitenant After Party application registration. A connected Student tenant receives its own enterprise application/service principal; the Product tenant does not operate the Student backend. |
| Student runtime | The Student installation owns its AP2 API/backend and Azure support resources. The SPA discovers and calls that Student-local API after sign-in. |
| Administration and recovery | Retain an independent human administrative recovery path plus the dedicated AP2 operator path. Development automation and managed identities remain separate from simulated users. |
| Simulated users and licensing | Retain the configured simulated-user roster and the licenses required by the installation. Current development uses Business Premium plus the intentionally acquired Defender/Purview and Entra Suite capabilities. Exact roster and object IDs are installation-specific rather than product constants. |
| Authentication | Security Defaults remains off when Conditional Access is in use. The standing CA baseline requires MFA broadly and blocks legacy authentication and device-code flow. CBA is configured as multifactor for the AP2 operator/simulated-user paths that use it. Passkey/FIDO2 self-service remains available through the unchanged device-bound/synced Default profile; all users additionally receive the device-bound, no-attestation `AP2 Windows Hello passkeys` profile with only Microsoft's three supported Windows Hello AAGUIDs allowed. |
| Devices | Retained Windows endpoints are Entra joined, Intune enrolled/managed, compliant under the chosen baseline, and assigned to the intended simulated users. Normal learners/users do not receive local-administrator rights merely for AP2. |
| Defender / endpoint security | Microsoft Defender Antivirus and Defender for Endpoint P2 are standing endpoint protections. AP2 does not assume a standing AppLocker/WDAC default-deny policy unless a specific future baseline decision adds one. Reputation, EDR, ASR, browser, DLP, and related controls may still restrict activity without creating a universal application whitelist. |
| Windows updates | Windows quality/security updating is centrally managed through Intune/Windows Update for Business with deliberate restart/deadline behavior. Feature-update movement is controlled rather than left to consumer defaults. The exact current policy is technical desired state and should be represented declaratively where practical. |
| Standard software | Corporate software should increasingly be represented as centrally managed Intune applications rather than one-off endpoint setup. A standing application baseline does not imply that all user-context executables must originate from Intune. |
| Global Secure Access | Where licensed for the installation, retained endpoints can carry the supported GSA client and normal Internet traffic acquisition as standing infrastructure. The standing form should follow ordinary enterprise administration: centrally deploy the client (normally through Intune for managed Windows endpoints) and target traffic profiles through normal organizational groups or equivalent managed scope rather than preserve proof-only direct-user/manual assignments. Narrow development-only controls such as Rachel's TLS-inspection profile can remain separately scoped when they are intentionally exceptional. This provides attributable corporate network/SWG telemetry in addition to MDE. |
| TLS inspection | TLS inspection is an available enterprise-control option, not an assumption every AP2 lab must rely on. Development may keep a known endpoint/profile capable of decryption so AP2 can compare FQDN-only traffic evidence with full URL/HTTP transaction evidence. Labs that depend on decrypted SWG evidence should say so explicitly. Technical/system and appropriate privacy/incompatibility bypasses remain part of a realistic inspection configuration. |
| AVD transport | AVD is learner/development transport to retained Windows endpoints, not part of the fictional incident. Retained VMs use standing idle auto-deallocation. After ordinary work, clean temporary state and log off worker-owned sessions, but do not manually deallocate merely as cleanup. |
| SaaS integrations | Required SaaS integrations such as YouTrack and GitHub are standing installation infrastructure when a lab family relies on them. Their identity/lifecycle integration is distinct from disposable scenario content inside those services. |

## Baseline state versus scenario state

**Baseline state** survives ordinary capability and scenario cleanup: identities,
licenses, Conditional Access, authentication setup, device enrollment/compliance,
Defender onboarding, update management, normal managed applications, GSA
acquisition, AP2 runtime resources, and selected SaaS integrations.

**Scenario state** is created for a particular incident background: messages,
files, browser actions, suspicious processes, temporary authentication methods,
temporary memberships or grants, marked registry values, security signals, and
other incident-specific artifacts.

A lab may temporarily change a standing control when that control is itself the
subject of the exercise, but it must not accidentally turn experiment setup into
an undocumented new baseline.

## Desired-state ownership

AP2 should use the simplest supported configuration mechanism for each layer
rather than force the entire environment through one tool.

### Microsoft365DSC

Use Microsoft365DSC for Student-tenant desired state **where it cleanly models the
resource and round-trips without losing important semantics**. Good candidates
include stable Entra Conditional Access and Intune policy resources. The initial
AP2 DSC work should emphasize export/compare/drift visibility and bounded apply,
not an immediate claim that every Student object is DSC-owned.

The first implemented boundary is documented in
`docs/microsoft365dsc-student-baseline.md`: the W73 policies, W76 update policies,
and their stable assignment-group shell are converged by name, while group
membership and other installation-specific state remain outside DSC.

Do not put secrets, private certificate material, generated per-installation
credentials, scenario content, or awkward/unsupported resources into DSC simply
for completeness.

### AP2 / Microsoft APIs

Use AP2's supported Graph and workload integrations for resources that are
installation-specific, dynamic, unsupported by DSC, or more naturally managed
through the product's existing APIs. Preserve actor semantics where a real
simulated-user action matters.

### Azure infrastructure

Use Azure-native provisioning for the Student-local API/backend, AVD, resource
groups, managed identities, and related Azure resources. These are Student-side
resources even though the Product tenant owns the multitenant application.

### Intune endpoint management

Use Intune as the normal management plane for endpoint compliance, Windows
update policy, and centrally delivered standard applications where practical.
Endpoint-local one-off automation remains useful during exploration, but proven
standing software should migrate toward ordinary managed delivery when that
improves reproducibility.

### Scenario staging

Keep incident staging separate from baseline convergence. A future simple
`Start scenario` action may invoke deterministic Student-local staging, but
Microsoft365DSC, Intune baseline management, and Student provisioning should not
become the scenario engine.

## Connected-Student convergence direction

A future Student connection/provisioning flow should be able to establish or
reconcile, in broad order of dependency rather than as a rigid workflow:

1. Product application presence and Student-local AP2 runtime identity/resources;
2. simulated identities, licensing, administrative recovery, and authentication;
3. Conditional Access and other standing identity policy;
4. Intune enrollment/compliance plus Defender/MDE onboarding;
5. centrally managed Windows update policy and normal managed applications;
6. GSA client/traffic acquisition and any deliberately selected TLS-inspection
   posture;
7. retained AVD endpoint configuration and idle lifecycle behavior; and
8. SaaS integrations required by the installation.

The eventual implementation can use Microsoft365DSC, Graph/workload APIs, Azure
provisioning, and Intune together. The product goal is a reproducible known
starting environment, not allegiance to one configuration-management tool.

## Verification boundary

A useful baseline verification answers whether the Student installation is ready
to stage new scenarios without manufacturing incident evidence. Prefer
configuration reads and native management health over user activity. Typical
checks include licenses, CA shape, administrative recovery, CBA/passkey support,
Intune management/compliance, Defender onboarding, update-policy assignment,
required-app state, GSA acquisition, AP2 API discovery, AVD assignment, and
required SaaS connections.

Do not generate user browsing, messages, files, suspicious processes, or other
incident-like activity merely to prove the baseline unless a bounded live
compatibility check is actually necessary.
