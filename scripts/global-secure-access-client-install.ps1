$logFile = "$env:ProgramData\GSAInstall\install.log"
New-Item -ItemType Directory -Path (Split-Path $logFile) -Force | Out-Null

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "$timestamp - $Message"
}

try {
    $ErrorActionPreference = 'Stop'
    Write-Log "Starting Global Secure Access client installation."

    # Microsoft's supported Intune installation recipe prefers IPv4 over IPv6.
    $ipv4RegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters"
    $ipv4RegName = "DisabledComponents"
    $expected = 0x20
    $rebootRequired = $false

    if (-not (Test-Path $ipv4RegPath)) {
        New-Item -Path $ipv4RegPath -Force | Out-Null
    }
    try {
        $existing = Get-ItemPropertyValue -Path $ipv4RegPath -Name $ipv4RegName -ErrorAction Stop
        $valueExists = $true
    }
    catch {
        $valueExists = $false
    }
    if (-not $valueExists -or [int]$existing -ne [int]$expected) {
        New-ItemProperty -Path $ipv4RegPath -Name $ipv4RegName -PropertyType DWord -Value $expected -Force | Out-Null
        $rebootRequired = $true
        Write-Log "Configured IPv4 preference."
    }

    $installerPath = Join-Path $PSScriptRoot "GlobalSecureAccessClient.exe"
    if (-not (Test-Path $installerPath)) {
        Write-Log "Installer is absent."
        exit 1
    }
    $installProcess = Start-Process -FilePath $installerPath -ArgumentList "/quiet" -Wait -PassThru
    if ($installProcess.ExitCode -eq 1618) { exit 1618 }
    if ($installProcess.ExitCode -ne 0) { exit $installProcess.ExitCode }

    Write-Log "Installer completed successfully."
    if ($rebootRequired) { exit 3010 }
    exit 0
}
catch {
    Write-Log "Fatal error: $_"
    exit 1603
}
