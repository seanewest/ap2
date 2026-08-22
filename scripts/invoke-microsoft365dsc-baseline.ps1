[CmdletBinding()]
param
(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Compile', 'Test', 'Apply')]
    [System.String]
    $Mode,

    [Parameter()]
    [System.String]
    $ConfigurationPath = (Join-Path $PSScriptRoot '..\infra\microsoft365dsc\AP2StudentBaseline.ps1'),

    [Parameter()]
    [System.String]
    $OutputPath = $env:AP2_M365DSC_OUTPUT_PATH
)

$ErrorActionPreference = 'Stop'
$requiredModuleVersion = [Version]'1.26.715.1'
$applyConfirmation = 'APPLY-AP2-STUDENT-M365DSC-BASELINE'

function Assert-ProtectedOutputPath
{
    param([Parameter(Mandatory = $true)][System.String]$Path)

    if ([System.String]::IsNullOrWhiteSpace($Path))
    {
        throw 'OutputPath must name a protected runtime directory outside Git.'
    }
    if (-not [System.IO.Path]::IsPathRooted($Path))
    {
        throw 'OutputPath must be an absolute protected runtime path outside Git.'
    }

    $resolvedConfiguration = [System.IO.Path]::GetFullPath($ConfigurationPath)
    $repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path (Split-Path $resolvedConfiguration -Parent) '..\..'))
    $resolvedOutput = [System.IO.Path]::GetFullPath($Path)
    if ($resolvedOutput.TrimEnd('\') -eq $repositoryRoot.TrimEnd('\') -or
        $resolvedOutput.StartsWith($repositoryRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase))
    {
        throw 'Generated MOFs must stay outside the AP2 repository.'
    }

    return $resolvedOutput
}

if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5)
{
    throw 'Compile and apply this baseline with elevated Windows PowerShell 5.1; empty-array semantics require it.'
}

if (-not (Test-Path -LiteralPath $ConfigurationPath -PathType Leaf))
{
    throw "Configuration not found: $ConfigurationPath"
}

$tenantId = $env:AP2_M365DSC_TENANT_DOMAIN
$accessToken = $env:AP2_M365DSC_GRAPH_ACCESS_TOKEN
if ($tenantId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*\.onmicrosoft\.com$')
{
    throw 'AP2_M365DSC_TENANT_DOMAIN must contain the target Student tenant verified onmicrosoft.com domain.'
}
if ([System.String]::IsNullOrWhiteSpace($accessToken))
{
    throw 'AP2_M365DSC_GRAPH_ACCESS_TOKEN must contain a current app-only Microsoft Graph token.'
}

$installed = Get-Module -Name Microsoft365DSC -ListAvailable |
    Where-Object Version -EQ $requiredModuleVersion |
    Select-Object -First 1
if ($null -eq $installed)
{
    throw "Microsoft365DSC $requiredModuleVersion is required. Install that exact version and its dependencies before running this script."
}

$resolvedOutput = Assert-ProtectedOutputPath -Path $OutputPath
if (Test-Path -LiteralPath $resolvedOutput)
{
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$acl = Get-Acl -LiteralPath $resolvedOutput
$acl.SetAccessRuleProtection($true, $false)
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
$administrators = New-Object System.Security.Principal.NTAccount('BUILTIN', 'Administrators')
$system = New-Object System.Security.Principal.NTAccount('NT AUTHORITY', 'SYSTEM')
foreach ($principal in @($administrators, $system))
{
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $principal,
        'FullControl',
        'ContainerInherit,ObjectInherit',
        'None',
        'Allow'
    )
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $resolvedOutput -AclObject $acl

. $ConfigurationPath
AP2StudentBaseline -TenantId $tenantId -AccessTokens @($accessToken) -OutputPath $resolvedOutput | Out-Null
$mofPath = Join-Path $resolvedOutput 'localhost.mof'
if (-not (Test-Path -LiteralPath $mofPath -PathType Leaf))
{
    throw 'Microsoft365DSC compilation did not emit localhost.mof.'
}

if ($Mode -eq 'Compile')
{
    [ordered]@{
        status        = 'compiled'
        moduleVersion = $requiredModuleVersion.ToString()
        resourceCount = 6
        outputPath    = $resolvedOutput
    } | ConvertTo-Json -Compress
    exit 0
}

$Global:M365DSCSkipDependenciesValidation = $true
$before = Test-DscConfiguration -Path $resolvedOutput
if ($Mode -eq 'Test')
{
    [ordered]@{
        status        = if ($before) { 'compliant' } else { 'drifted' }
        moduleVersion = $requiredModuleVersion.ToString()
        resourceCount = 6
    } | ConvertTo-Json -Compress
    if (-not $before) { exit 2 }
    exit 0
}

if ($env:AP2_M365DSC_APPLY -ne $applyConfirmation)
{
    throw "Apply requires AP2_M365DSC_APPLY=$applyConfirmation."
}

try
{
    $convergenceExecuted = $false
    if ($before)
    {
        $after = $true
    }
    else
    {
        Start-DscConfiguration -Path $resolvedOutput -Wait -Force
        $convergenceExecuted = $true
        $after = Test-DscConfiguration -Path $resolvedOutput
    }
    if (-not $after)
    {
        throw 'Microsoft365DSC apply completed but the selected baseline is still drifted.'
    }
    [ordered]@{
        status          = 'compliant'
        compliantBefore = [bool]$before
        compliantAfter  = [bool]$after
        convergenceExecuted = $convergenceExecuted
        moduleVersion   = $requiredModuleVersion.ToString()
        resourceCount   = 6
    } | ConvertTo-Json -Compress
}
finally
{
    Stop-DscConfiguration -Force -ErrorAction SilentlyContinue
    Remove-DscConfigurationDocument -Stage Current -Force -ErrorAction SilentlyContinue
    Remove-DscConfigurationDocument -Stage Pending -Force -ErrorAction SilentlyContinue
    $env:AP2_M365DSC_GRAPH_ACCESS_TOKEN = $null
}
