# Ordinary Windows shared-device provisioning package

## Current result

The unattended ordinary-VM path is **not proven**. The bounded 2026-07-29
experiment stopped before tenant mutation, VM creation, or spend because no
protected provisioning package or bulk token existed.

Microsoft's supported flow acquires the bulk token inside the Windows
Configuration Designer (WCD) graphical wizard. It requires an interactive
password or certificate-based authentication and an eligible Entra role. The
supported `ICD.exe` command line builds a package from existing customization
input; Microsoft does not document it as a bulk-token acquisition API.

WCD was briefly installed while readiness was being investigated, but its
wizard opened on a shared physical Windows session. That surface is outside the
isolated-lab boundary. The process, Store package, project directory, and
generated project files were removed. No `.ppkg`, `package_{GUID}` identity,
tenant permission, Azure resource, Entra device, Intune device, or Defender
artifact was created.

Run `npm run check:shared-device-readiness -- <protected-input.json>` before
creating billable state. The gate rejects physical-desktop or coordinate-based
automation, a missing/expired/untrusted package, absent cleanup, quota
contention, an unsafe topology, or a forecast at the lane ceiling.
Rejected or malformed input exits nonzero, so a `check && deploy` pipeline
stops; exit zero is reserved for `READY_FOR_ISOLATED_VM`.

## Supported executable alternative

Split authoring from execution:

1. In a separately authorized **isolated Windows client session**, install WCD
   from Microsoft Store and create the bulk enrollment package in its desktop
   wizard.
2. Use a dedicated token issuer that is in the MDM user scope and has one of
   Microsoft's listed roles: Cloud Device Administrator, Intune Administrator,
   or Password Administrator. Ensure the
   `Microsoft.Azure.SyncFabric` service principal exists.
3. Authenticate in WCD by password or CBA. If the tenant enforces MFA through
   Conditional Access, approve and record the exact exclusion required for this
   unsupported-MFA enrollment process. Select **No, sign in to this app only**
   so the authoring client is not enrolled.
4. Protect the WCD project, `.ppkg`, token expiry, and exact
   `package_{GUID}` cleanup identity. A bulk token is valid for at most 180
   days; update the token or create a new package before expiry.
5. Give the isolated executor only the sealed package and its expiry/custody
   manifest. Do not copy the package into Git, logs, command arguments, a
   public object, or a broad temporary directory.
6. After a fresh quota/cost/cleanup gate, create one ordinary private Windows
   VM with no VM public IP, Bastion, or AVD. Use explicit outbound and retain
   Run Command plus the protected local administrator as independent recovery.
7. Deliver the package through a private run-owned object and VM managed
   identity, then apply it as administrator/SYSTEM with the supported
   `Install-ProvisioningPackage -QuietInstall` or
   `Add-ProvisioningPackage -QuietInstall` command. Do not use an interactive
   desktop session.
8. Prove separately: Entra join; an exact Intune managed-device record;
   compliance state; zero primary users for the userless enrollment; and a
   matching active/onboarded Defender machine after a marker-bound Intune EDR
   policy.
9. While the VM is alive, apply the exact Defender offboarding package once and
   prove local offboarding. Then delete the exact Intune and Entra records,
   marker group/policies, `package_{GUID}` identity, package custody objects,
   resource group, expiry unit, token caches, and temporary permissions.
   Retained audit, deleted-device, and Defender history are normal.

If a genuinely unattended enrollment path is required without an attended WCD
authoring stage, use a separately authorized AVD personal-host deployment with
its native **Enroll the VM with Intune** option. AP2 has proven that distinct
AVD path, but it is not an ordinary-VM provisioning-package proof.

## Product semantics

Bulk provisioning is a userless, corporate-owned enrollment. It creates no
primary-user affinity. A later learner sign-in can receive user-scoped policy,
but that does not retroactively turn the enrollment into a user-driven
workstation enrollment. Entra join alone never proves Intune enrollment, and
an enabled Intune/Defender connector never proves Defender onboarding.

## Official contracts

- [Bulk enrollment for Windows devices](https://learn.microsoft.com/en-us/intune/intune-service/enrollment/windows-bulk-enroll)
- [Install Windows Configuration Designer](https://learn.microsoft.com/en-us/windows/configuration/provisioning-packages/provisioning-install-icd)
- [Windows Configuration Designer CLI](https://learn.microsoft.com/en-us/windows/configuration/provisioning-packages/provisioning-command-line)
- [Provisioning-package PowerShell cmdlets](https://learn.microsoft.com/en-us/windows/configuration/provisioning-packages/provisioning-powershell)
- [Install-ProvisioningPackage](https://learn.microsoft.com/en-us/powershell/module/provisioning/install-provisioningpackage)
- [Configure Defender integration and onboarding](https://learn.microsoft.com/en-us/intune/device-security/microsoft-defender/configure-integration)
