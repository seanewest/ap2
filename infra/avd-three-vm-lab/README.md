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

- Windows 11 Enterprise 24H2 on `Standard_D2s_v3`, with an E10 128-GiB
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

## Cost contract

[`scripts/avd-three-vm-cost.ts`](../../scripts/avd-three-vm-cost.ts) uses
fresh public East US retail-rate inputs. Four billed hours, 20 GB of bounded
NAT and internet egress, and 100,000 operations per disk total
`$4.21490411`. A full extra billed provisioning hour totals `$4.59363014`.
Both are below the `$5` learning target and the lane's `$10` ceiling.

AVD control-plane resources, the VNet, NICs, and NSGs have no incremental
meter in this contract. The model excludes disk-mount meters because no
shared disk is mounted. Refresh every rate before a live run.

## Cleanup contract

Offboard the Windows endpoint while it is alive. Then delete only the captured
run-owned Intune policies/group/device and Entra device, delete the exact
resource group, reconcile absence, revoke captured temporary Graph roles, and
prove their absence with a fresh Dev token. Disable and remove expiry units
only after Azure absence, then permanently remove exact run credentials,
caches, and trashed expiry artifacts. Provider registration and ordinary
platform history remain.
