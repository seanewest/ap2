# Three-VM AVD lab substrate

This directory defines the smallest currently available AP2 topology for one
private Windows 11 Enterprise personal AVD desktop and two private Ubuntu
24.04 LTS auxiliary nodes.

The topology deliberately has:

- one VNet with separate session-host and auxiliary subnets;
- one shared Standard NAT Gateway and one Standard static IPv4 address;
- no public VM IP, Bastion, load balancer, firewall appliance, FSLogix,
  backup, Log Analytics workspace, or database;
- a fixed TCP 8080 health endpoint on each auxiliary node, reachable only
  from the session-host subnet;
- Trusted Launch on all three VMs;
- deployment-time Entra join and Intune enrollment only on the Windows AVD
  host; and
- Azure VM Agent/Run Command management for Ubuntu. The Linux nodes are not
  represented as Intune-enrolled clients and are not Defender-onboarded by
  this substrate.

## Supported images and sizing

The live caller must first freeze exact East US image versions and verify
subscription quota. The tested contract uses:

- Windows 11 Enterprise 24H2 on `Standard_D2as_v7`, with an E10 128-GiB
  Standard SSD and `Windows_Client` licensing for the eligible AVD learner;
- Canonical Ubuntu Server 24.04 LTS on two `Standard_F1als_v7` VMs, each with
  an E4 32-GiB Standard SSD.

`Standard_B1s` and `Standard_B1ls` would be nominally smaller, but the AP2
Student subscription currently restricts those SKUs in East US.

## Deployment contract

Deployment is intentionally split into two idempotent resource-group
deployments:

1. Deploy `control-plane.bicep`. This creates the marked network, AVD control
   plane, fixed private NICs, learner assignment, and a fresh host-pool
   registration token.
2. Retrieve that token from the exact marked host pool, hold it only in a
   mode-0600 run directory, and deploy `compute.bicep`. The three VMs start in
   parallel after their already-created NICs are available.

Use a fresh random Windows local password and ephemeral SSH key. Neither
credential is a product interface or learner credential, and both must be
removed after deployment. Create a persistent expiry cleanup unit and a
protected journal before the first resource-group write.

Private topology proof uses Windows VM Run Command to request the two fixed
health URLs. Auxiliary health and management proof uses Linux Run Command,
cloud-init state, VM Agent state, and Trusted Launch metadata. No human
desktop session is required.

## Lifecycle runner

[`scripts/avd-three-vm-runner.ts`](../../scripts/avd-three-vm-runner.ts)
turns this topology into a transport-independent lifecycle. A scenario supplies
its fixed scope at runtime; the repository does not embed tenant, subscription,
learner, token, credential, or protected-run identifiers. The pure planner
rejects malformed or reused markers, scope mismatches, unsupported topology,
insufficient quota, public VM IPs, incorrect temporary roles, missing expiry or
ownership, learner-session overclaims, and a public-rate cost bound above the
lane ceiling.

The frozen plan records exact marker-derived resource names, dependencies,
ownership, journal location, cost, and cleanup graph. The runner creates and
verifies expiry before any billable submission, writes intent before every
mutation, records its definite or ambiguous outcome, and requires an exact
adapter read to reconcile ambiguity without replay. The control phase precedes
compute because the registration token is a stable input; after ARM completion,
independent AVD, Intune, Defender, private-probe, and zero-session observations
run concurrently.

Cleanup verifies every stage before proceeding: Defender offboarding while the
host lives, endpoint policy/group/device removal, Azure deletion, Entra
residue removal, exact temporary-role revocation with fresh-token proof, expiry
removal, and sensitive-artifact removal. Interfaces cover Azure, Graph,
Defender, the local timer, filesystem, clock, and journal; deterministic tests
use only fakes and perform no shell or network access.

The sanitized dry-run command accepts the fixed scope through environment
variables and prints no identity values:

```console
AP2_EXPECTED_TENANT_ID=... AP2_TENANT_ID=... \
AP2_EXPECTED_SUBSCRIPTION_ID=... AP2_SUBSCRIPTION_ID=... \
AP2_EXPECTED_AVD_LEARNER=... AP2_AVD_LEARNER=... \
AP2_READINESS_OBSERVED_AT=... \
AP2_WINDOWS_IMAGE=MicrosoftWindowsDesktop:windows-11:win11-24h2-ent:... \
AP2_LINUX_IMAGE=Canonical:ubuntu-24_04-lts:server:... \
AP2_WINDOWS_QUOTA=1 AP2_LINUX_QUOTA=2 \
npm run plan:avd-three-vm -- \
  --marker ap2lab-YYYYMMDDTHHMMSSZ-abcdef \
  --planned-at 2026-01-01T00:00:00Z \
  --expiry 2026-01-01T08:00:00Z
```

The reduced replay fixture preserves only terminal booleans, distinct evidence
states, and the observed `$3.07872603` upper bound. It contains no protected
run identifier or raw platform object.

Observed and expected scope values are separate inputs so a mismatch cannot
validate itself. Image versions, quota, and their observation timestamp must
come from a fresh readiness read; the CLI does not invent mutation-ready
values. Definite deployment or readiness failure enters the same exact
pre-read cleanup graph, while an ambiguous write remains paused until an exact
read reconciles it. Temporary-role absence requires captured assignment IDs, a
complete unpaged read, and a fresh token with exact tenant, actor, and audience.

## Cost contract

[`scripts/avd-three-vm-cost.ts`](../../scripts/avd-three-vm-cost.ts) uses
fresh public East US retail-rate inputs. Four billed hours, 20 GB of bounded
NAT and internet egress, and 100,000 operations per disk total
`$4.19490411`. A full extra billed provisioning hour totals `$4.56863014`.
Both are below the `$5` learning target and the lane's `$10` ceiling.

AVD control-plane resources, the VNet, NICs, and NSGs have no incremental
meter in this contract. The model excludes disk-mount meters because no
shared disk is mounted. Refresh every rate before a live run.

## Cleanup contract

Offboard the Windows endpoint while it is alive. Then delete only the captured
run-owned Intune policies/group/device, delete the exact resource group and
reconcile its absence, and remove the run-owned Entra residue. Revoke captured
temporary Graph roles and prove their absence with a fresh Dev token. Disable
and remove expiry units only after Azure absence, then permanently remove exact
run credentials, caches, and trashed expiry artifacts. Provider registration
and ordinary platform history remain.
