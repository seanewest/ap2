# Microsoft365DSC Student baseline

Microsoft365DSC is AP2's bounded convergence layer for the first stable
connected-Student resources. The checked-in configuration is
`infra/microsoft365dsc/AP2StudentBaseline.ps1`. It pins Microsoft365DSC
`1.26.715.1` and owns six resources by stable name:

- the empty security-group shell named `AP2 retained managed Windows endpoints`;
- the three W73 Conditional Access policies;
- the W76 Windows update ring; and
- the W76 Windows 11 24H2 feature-update profile.

The configuration contains no development tenant, group, policy, assignment, or
device object ID. Both Intune assignments bind to the group by
`groupDisplayName`. DSC creates the group shell in a fresh tenant but deliberately
does not own its device members; retained-device discovery and membership are
installation-specific and remain in `scripts/windows-update-baseline.mjs`.

## Authentication and generated artifacts

Run the configuration from an elevated Windows PowerShell 5.1 host with the
pinned module installed. PowerShell 5.1 is deliberate because Microsoft365DSC
documents that PowerShell 7 compilation can omit empty arrays. The configuration
uses a short-lived app-only Microsoft Graph access token supplied at runtime; no
credential, certificate, private key, tenant ID, token, MOF, or export is checked
in.

Install the complete dependency set declared by the pinned module manifest: the
local configuration manager validates that manifest even though this baseline
uses only four resource types. Revalidate the pinned runtime before upgrading;
current module guidance warns that PowerShell 7 becomes required for
installation in October 2026, while this version still needs Windows PowerShell
5.1 to preserve the selected resources' empty-array semantics.

The app identity needs the Microsoft365DSC application permissions for
`AADGroup`, `AADConditionalAccessPolicy`,
`IntuneWindowsUpdateForBusinessRingUpdateProfileWindows10`, and
`IntuneWindowsUpdateForBusinessFeatureUpdateProfileWindows10`. In particular,
apply needs `Policy.ReadWrite.ConditionalAccess`,
`DeviceManagementConfiguration.ReadWrite.All`, and the directory/group write
permissions required to create the scope-group shell. Use the module's
`Get-M365DSCCompiledPermissionList` command when preparing a new runner rather
than copying the development app's broader permission set.

Set these values only in the protected process environment:

```powershell
$env:AP2_M365DSC_TENANT_DOMAIN = '<student-tenant>.onmicrosoft.com'
$env:AP2_M365DSC_GRAPH_ACCESS_TOKEN = '<short-lived-app-only-graph-token>'
$env:AP2_M365DSC_OUTPUT_PATH = 'C:\ProgramData\AP2\Microsoft365DSC\StudentBaseline'
```

Compile and perform a live desired-state test with:

```powershell
.\scripts\invoke-microsoft365dsc-baseline.ps1 -Mode Compile
.\scripts\invoke-microsoft365dsc-baseline.ps1 -Mode Test
```

`Test` exits with code 2 when drift exists and does not mutate the tenant. A
bounded one-off convergence requires a separate confirmation:

```powershell
$env:AP2_M365DSC_APPLY = 'APPLY-AP2-STUDENT-M365DSC-BASELINE'
.\scripts\invoke-microsoft365dsc-baseline.ps1 -Mode Apply
```

Every invocation recompiles with the current token. Apply stops after the live
test when the tenant is already compliant, avoiding the timestamp-only policy
rewrites that an unnecessary LCM consistency run can cause. When drift exists,
it runs convergence and tests again afterward. The output directory is
recreated with access limited to local Administrators and SYSTEM and must be
outside the repository. Treat the MOF as a secret because it contains the
short-lived token. After convergence it removes the current and pending LCM
documents so this one-off path does not establish an
unattended endpoint-local correction loop. Remove the generated directory when
the operational receipt is no longer needed.

## Modeling boundary

All six selected Microsoft365DSC resources implement `Ensure = 'Present'` using
name-based create and update, and their official resource implementations also
implement `Ensure = 'Absent'` deletion. AP2 uses only `Present`; live baseline
objects must never be deleted merely to prove recreation.

The feature-profile setting
`InstallLatestWindows10OnWindows11IneligibleDevice` is create-time immutable in
Microsoft Graph. Microsoft365DSC can set it when provisioning a new profile but
intentionally excludes it from update comparison and update requests. AP2 fixes
it at `false`, independently verifies it through the retained Graph inspection,
and treats a conflicting existing profile as a manual replacement boundary, not
something to delete automatically. Group membership, generated rollout dates,
device enrollment, GSA, AVD, Defender, SaaS, Azure, recovery material, and
scenario state remain outside this configuration.

W77's TCM monitor remains an independent detector over the three exact live W73
policy IDs. `scripts/student-tenant-desired-state.mjs inspect` verifies that
monitor and its immediate Graph comparison. TCM does not provision or converge
this DSC baseline.

Official references:

- [Microsoft365DSC 1.26.715.1 release](https://github.com/microsoft/Microsoft365DSC/releases/tag/1.26.715.1)
- [Deploying Microsoft365DSC configurations](https://microsoft365dsc.com/user-guide/get-started/deploying-configurations/)
- [Microsoft365DSC authentication and permissions](https://microsoft365dsc.com/user-guide/get-started/authentication-and-permissions/)
- [Microsoft365DSC PowerShell 7 limitations](https://microsoft365dsc.com/user-guide/get-started/powershell7-support/)
