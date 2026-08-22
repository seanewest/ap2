# Student control-plane reconstruction specification

Status: **historical Pass 3 reconstruction capture; not the current connected-Student baseline**

The authoritative machine-readable desired state is
[`infra/student-control-plane.manifest.json`](../infra/student-control-plane.manifest.json).
This document explains how to read it. Together they capture the intentional
broad AP2 Pass 3 Student baseline; they are not a bootstrap, backup, migration,
teardown, or least-privilege design.

For current product direction, standing security/device/network expectations, and
the future connected-Student convergence boundary, use
[`student-environment-baseline.md`](student-environment-baseline.md). This older
reconstruction capture remains useful technical provenance but must not override
newer live baseline decisions such as the Conditional Access, retained-endpoint,
update-management, GSA, or installation-specific configuration direction.

The capture used current repository architecture plus read-only Microsoft Graph,
ARM, licensing, CBA, and role observations from the Self Employed tenant. No
mail, files, chats, meetings, alerts, token contents, private keys, PFX contents,
passphrases, cookies, or browser state were read into the specification.

## Binding language

Every desired binding is classified in the manifest:

- `stable`: a public identifier, role, logical alias, name, or architecture
  contract intended to survive reconstruction;
- `human-supplied`: Sean supplies it when creating the fresh tenant or
  subscription;
- `generated`: create a new value or object and protect any private material;
- `discovered`: resolve the fresh instance by a stable name or relationship;
- `intentionally-excluded-historical`: old state must not be reconstructed.

Literal `generate` and `discover` values are instructions, never old IDs.
Stable public permission, role, and Product application IDs are intentionally
present. The manifest contains no old Student tenant, subscription, principal,
resource, user, group, drive, SKU-instance, certificate, or secret identifier.

## Fresh boundary and retained roster

Sean supplies a new Microsoft 365 trial tenant, its initial administrator, and
a separate Azure pay-as-you-go subscription associated with that tenant. The
Product tenant continues to own the multitenant After Party application/API;
the new Student tenant installs its enterprise application by the stable Product
client ID.

Only six licensed users are intentional:

| Role | Retained purpose |
| --- | --- |
| Human admin/operator | Initial administration, recovery, licensing, consent, and the human operator path |
| Dedicated CBA SPA operator | Hosted/local SPA browser testing, distinct from the human administrator |
| Cory | Calendar, contacts, mailbox settings, drafts, To Do, inbox rules, Teams, and learner mailbox work |
| Homer | Delegated mail and OneDrive production |
| Kobe | Delegated help-desk mail and controlled Teams calling |
| Marge | Delegated recipient and learner/observer work |

Each receives usage location `US`, Microsoft 365 Business Premium (`SPB`), and
Microsoft Defender and Purview Suites for Microsoft 365 Business Premium
(`DEFENDER_AND_PURVIEW_SUITES_FOR_BUSINESS_PREMIUM_NEW`). Discover each fresh
`skuId` from its part number. The current 18-user assignment pattern and other
fictional personas are not authoritative.

The human administrator and dedicated SPA operator retain their observed broad
Global Administrator and Azure roles. Dev automation retains subscription
Owner plus Exchange Administrator, Security Reader, and Teams Administrator.
The four simulated users have no directory roles. The manifest records the
stable template/role-definition IDs and exact scopes.

## Applications, consent, and broad authority

Dev automation is a fresh Student application/service principal with a newly
generated, externally protected application certificate. It supports agents,
TypeScript scripts, `az`, app-only API calls, deployment, diagnostics, and the
retained broad Purview detector path. It receives exactly the manifest's 48
application-role assignments: 44 Microsoft Graph roles, Exchange
`Exchange.ManageAsApp`, two WindowsDefenderATP roles, and Product API
`access_as_application`.

The Product enterprise application receives exactly the 16 listed tenant-wide
delegated Graph scopes and the all-principals custom `access_as_user` consent.
The current display name differs across live state and older documentation, so
reconstruction binds it only by Product client ID. There is no outgoing
application-role set on that enterprise application.

The Student API runs as `ca-ap2-api`. Its generated system-assigned identity
retains the exact 16 broad Graph application permissions in the manifest plus
subscription Owner, rehearsal-resource-group Reader, and registry-scoped
`AcrPull`. It has no directory role, Exchange role, custom API role, or separate
Defender-resource role. Dev automation itself is the only retained detector;
temporary or attempted observer identities are excluded.

## CBA and protected references

CBA is enabled through two security groups: the dedicated SPA operator group
and `AP2 Simulated User CBA`. The live Entra membership of the simulated-user
group is authoritative; this document intentionally does not duplicate its
current user list. CBA uses high-affinity Subject Key Identifier mapping to one
`certificateUserIds` value per enabled identity, multi-factor mode, no custom
rules, no exclusions, no issuer hints, and no CRL validation.

Reconstruction generates new roots, leaf certificates, encrypted keys, PFX
files, passphrases, SKIs, and protected reference records. Leaf subjects are the
user display names and SAN email values are their fresh UPNs. The observed
simulated-user issuer convention, `After Party Lisa CBA Proof CA`, has a
historical name but backs the simulated-user CBA identities, so it is preserved
as a naming convention without reconstructing the Lisa user or old CBA group.
No old certificate or fingerprint is copied.

Private artifacts remain outside Git in mode-0700 directories with mode-0600
private files. Validate chain and key match, validity, unique SKI mappings,
policy and group shape, then run one fresh nonpersistent CBA `/me` sign-in for
each identity that is expected to be CBA-enabled. The SPA remains a public
client and receives no backend credential.

## Azure runtime and rehearsal shape

Fresh creation supports:

- `rg-ap2-rehearsal` in East US;
- a generated Basic ACR with admin access disabled and immutable `ap2-api`
  digest images;
- public, non-VNet `cae-ap2-rehearsal`;
- one external HTTPS `ca-ap2-api` revision on port 3000, 0.5 CPU/1 GiB,
  `minReplicas=1`, and `maxReplicas=1`;
- regenerated auth, CORS, user-binding, and CBA secret/config references; and
- the private three-VM AVD rehearsal as fresh, marker-bound, expiring resources,
  including its exact topology, SKUs, stable Azure roles, and protected inputs.

The API's operation locks and simulated-user token caches are intentionally
process-local. No main-API shared Azure operation, lock, or token-state store is
live. The Azure Table adapter remains code-only and one replica remains the
accepted Pass 3 topology.

The requested generic Container Apps Job is an unresolved source discrepancy:
no job exists in live ARM state, current code, or repository history. The
manifest covers that fact but asserts no invented name, trigger, identity,
image, or configuration. Replacement-tenant implementation must resolve that
discrepancy before treating a generic job as desired state.

The repository's offline deployment artifact also differs from the proven live
runtime: it describes Key Vault references, probes, and termination grace,
whereas live uses Container App configuration and certificate secret volumes
without probes. This specification records the proven live shape and keeps the
review-only artifact as a discrepancy.

## Readiness and stopping boundary

Readiness is content-free. It checks licensing and usage location; mailbox
settings; OneDrive roots; SharePoint roots/sites; Teams licensing and supported
sign-in; Defender and Purview API reachability; exact CBA, consent, permissions,
directory roles, Exchange roles, and Azure roles; Dev certificate and `az`
automation; Product doorway and both API token paths; every required fresh CBA
sign-in; runtime managed-identity access; and dry AVD planning.

It must not enumerate or export workload content, alerts, audit records, tokens,
or credentials. This capture stops before bootstrap. After review, creating the
replacement tenant and resolving the generic-job discrepancy are separate work.

## Explicit exclusions

Do not carry forward old local apps, unreferenced users or groups, calling-canary
resources and grants, historical storage locks/journals, scenario content,
temporary permissions or memberships, mail/files/chats/meetings/alerts, audit or
deleted-object residue, recycle-bin state, old Azure resources, or any reusable
credential material. The manifest contains the complete categorical exclusion
list.
