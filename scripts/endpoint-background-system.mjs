#!/usr/bin/env node
import fs from "node:fs";
import { ClientCertificateCredential } from "@azure/identity";

// Recovered from archived W45. This is deliberately separate from Kobe's
// interactive-user method: Azure Run Command executes this payload as SYSTEM.
const RUN_VALUE_NAME = "AP2IncidentBackgroundCanary";
const RUN_VALUE_DATA = "cmd.exe /d /c exit 0";
const RUN_ID_PATTERN = /^AP2-ENDPOINT-BG-\d{8}T\d{4}Z$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function systemStage(runId) {
  const id = quotePowerShell(runId);
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${id}
$root = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
$runKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = '${RUN_VALUE_NAME}'
$runData = '${RUN_VALUE_DATA}'
if (Test-Path -LiteralPath $root) { throw "Exact run root already exists" }
if ($null -ne (Get-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue)) { throw "Exact Run value already exists" }
New-Item -Path $root -ItemType Directory -Force | Out-Null
$stagePath = Join-Path $root 'system-background.ps1'
$stage = @'
$ErrorActionPreference = 'Continue'
$runId = ${id}
$root = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
$markerPath = Join-Path $root 'harmless-compromise-marker.txt'
$runKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = '${RUN_VALUE_NAME}'
$runData = '${RUN_VALUE_DATA}'
$result = [ordered]@{
  schemaVersion = 1; runId = $runId
  startedUtc = (Get-Date).ToUniversalTime().ToString('o')
  actor = (& whoami.exe 2>$null | Out-String).Trim()
  processSessionId = (Get-Process -Id $PID).SessionId
  marker = $null; localDiscovery = $null; userDiscovery = $null
  processDiscovery = $null; networkDiscovery = $null; persistence = $null
}
try {
  Set-Content -LiteralPath $markerPath -Value "Harmless AP2 incident-background marker $runId" -Encoding UTF8 -Force
  $result.marker = [ordered]@{ outcome='created'; sha256=(Get-FileHash -LiteralPath $markerPath -Algorithm SHA256).Hash }
} catch { $result.marker = [ordered]@{ outcome='blocked'; errorType=$_.Exception.GetType().Name } }
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $result.localDiscovery = [ordered]@{ outcome='completed'; osCaption=$os.Caption; osVersion=$os.Version; domain=$cs.Domain; partOfDomain=[bool]$cs.PartOfDomain }
} catch { $result.localDiscovery = [ordered]@{ outcome='blocked'; errorType=$_.Exception.GetType().Name } }
try {
  $users = @(Get-LocalUser)
  $result.userDiscovery = [ordered]@{ outcome='completed'; localUserCount=$users.Count; interactiveSessionLines=@(quser 2>$null) }
} catch { $result.userDiscovery = [ordered]@{ outcome='blocked'; errorType=$_.Exception.GetType().Name } }
try {
  $result.processDiscovery = [ordered]@{ outcome='completed'; processCount=@(Get-CimInstance Win32_Process).Count }
} catch { $result.processDiscovery = [ordered]@{ outcome='blocked'; errorType=$_.Exception.GetType().Name } }
try {
  $tcp = @(Get-NetTCPConnection -State Established -ErrorAction Stop)
  $dns = @(Resolve-DnsName login.microsoftonline.com -ErrorAction Stop)
  $result.networkDiscovery = [ordered]@{ outcome='completed'; establishedTcpCount=$tcp.Count; dnsAnswerCount=$dns.Count; destination='login.microsoftonline.com' }
} catch { $result.networkDiscovery = [ordered]@{ outcome='blocked'; errorType=$_.Exception.GetType().Name } }
try {
  New-ItemProperty -Path $runKey -Name $runName -Value $runData -PropertyType String -Force -ErrorAction Stop | Out-Null
  $actual = Get-ItemPropertyValue -Path $runKey -Name $runName -ErrorAction Stop
  $result.persistence = [ordered]@{ mechanism='HKLM Run'; valueClass='no-op cmd exit'; createdAndVerified=($actual -eq $runData); triggered=$false }
} catch { $result.persistence = [ordered]@{ mechanism='HKLM Run'; outcome='blocked'; errorType=$_.Exception.GetType().Name } }
$result.completedUtc = (Get-Date).ToUniversalTime().ToString('o')
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'summary.json') -Encoding UTF8
'@
[IO.File]::WriteAllText($stagePath, $stage, [Text.UTF8Encoding]::new($false))
$child = Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$stagePath) -Wait -PassThru
if ($child.ExitCode -ne 0) { throw "Marked child exited $($child.ExitCode)" }
Get-Content -LiteralPath (Join-Path $root 'summary.json') -Raw`;
}

function systemInspect(runId) {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${quotePowerShell(runId)}
$root = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
$summaryPath = Join-Path $root 'summary.json'
if (!(Test-Path -LiteralPath $summaryPath)) { [ordered]@{runId=$runId; evidencePresent=$false} | ConvertTo-Json -Compress; exit 0 }
$summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
if ($summary.runId -ne $runId -or $summary.actor -ne 'nt authority\system' -or $summary.processSessionId -ne 0) { throw 'SYSTEM identity/session mismatch' }
$marker = Join-Path $root 'harmless-compromise-marker.txt'
$actual = Get-ItemPropertyValue -Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' -Name '${RUN_VALUE_NAME}' -ErrorAction Stop
[ordered]@{ runId=$runId; evidencePresent=$true; summary=$summary; markerHashMatches=((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -eq $summary.marker.sha256); persistenceMatchesNoOp=($actual -eq '${RUN_VALUE_DATA}'); markedProcessCount=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*" }).Count } | ConvertTo-Json -Depth 10 -Compress`;
}

function systemCleanup(runId) {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${quotePowerShell(runId)}
$root = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
$runKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
$actual = Get-ItemPropertyValue -Path $runKey -Name '${RUN_VALUE_NAME}' -ErrorAction SilentlyContinue
if ($null -ne $actual -and $actual -ne '${RUN_VALUE_DATA}') { throw 'Refusing to remove a non-canary Run value' }
@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*" }) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
if ($null -ne $actual) { Remove-ItemProperty -Path $runKey -Name '${RUN_VALUE_NAME}' -ErrorAction Stop }
if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
$stillPresent = $null -ne (Get-ItemProperty -Path $runKey -Name '${RUN_VALUE_NAME}' -ErrorAction SilentlyContinue)
$survivors = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*" })
if ((Test-Path -LiteralPath $root) -or $stillPresent -or $survivors.Count -ne 0) { throw 'Cleanup verification failed' }
[ordered]@{runId=$runId; rootAbsent=$true; persistenceAbsent=$true; markedProcessCount=0} | ConvertTo-Json -Compress`;
}

async function main() {
  const runId = required("AP2_ENDPOINT_RUN_ID");
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("AP2_ENDPOINT_RUN_ID has the wrong marker shape");
  const config = JSON.parse(fs.readFileSync(required("AP2_ARM_CONFIG"), "utf8"));
  const resourceGroup = required("AP2_AVD_RESOURCE_GROUP");
  const vmName = required("AP2_AVD_VM");
  const hostPool = required("AP2_AVD_HOST_POOL");
  const sessionHost = required("AP2_AVD_SESSION_HOST");
  const credential = new ClientCertificateCredential(config.tenantId, config.clientId, { certificatePath: config.certificatePath });
  const token = (await credential.getToken("https://management.azure.com/.default")).token;
  const origin = "https://management.azure.com";
  const scope = `${origin}/subscriptions/${config.subscriptionId}/resourceGroups/${resourceGroup}/providers`;
  const vm = `${scope}/Microsoft.Compute/virtualMachines/${vmName}`;
  const host = `${scope}/Microsoft.DesktopVirtualization/hostPools/${hostPool}/sessionHosts/${sessionHost}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${options.method || "GET"} ${url} -> ${response.status} ${text.slice(0, 800)}`);
    return { response, body: text ? JSON.parse(text) : null };
  }
  async function operation(result) {
    const url = result.response.headers.get("azure-asyncoperation") || result.response.headers.get("location");
    if (!url) return result.body;
    for (let index = 0; index < 180; index += 1) {
      await sleep(3000);
      const current = await request(url);
      const state = current.body?.status || current.body?.properties?.provisioningState;
      if (/succeeded/i.test(state)) return current.body;
      if (/failed|canceled/i.test(state)) throw new Error(JSON.stringify(current.body));
    }
    throw new Error("ARM operation remained ambiguous after the bounded wait; do not replay it");
  }
  async function runCommand(script) {
    return operation(await request(`${vm}/runCommand?api-version=2024-11-01`, { method: "POST", body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }) }));
  }
  async function state() {
    const [view, hostState, sessions] = await Promise.all([
      request(`${vm}/instanceView?api-version=2024-11-01`).then((x) => x.body),
      request(`${host}?api-version=2024-04-03`).then((x) => x.body),
      request(`${host}/userSessions?api-version=2024-04-03`).then((x) => x.body.value || []),
    ]);
    return { power: view.statuses?.find((item) => String(item.code).startsWith("PowerState/"))?.code, hostStatus: hostState.properties?.status, sessions };
  }

  const before = await state();
  if (before.power !== "PowerState/deallocated" || before.sessions.length !== 0) throw new Error(`Expected a deallocated zero-session host: ${JSON.stringify(before)}`);
  let stageAttempted = false;
  let inspection = null;
  try {
    await operation(await request(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
    for (let index = 0; index < 60; index += 1) { const current = await state(); if (current.power === "PowerState/running" && current.sessions.length === 0) break; if (index === 59) throw new Error("Host did not reach running/zero-session state"); await sleep(3000); }
    const prior = await runCommand(systemInspect(runId));
    if (JSON.stringify(prior).includes('"evidencePresent":true')) throw new Error("Exact run evidence already exists; recover it instead of replaying");
    stageAttempted = true;
    await runCommand(systemStage(runId));
    inspection = await runCommand(systemInspect(runId));
    const serialized = JSON.stringify(inspection);
    if (!serialized.includes('"evidencePresent":true') || !serialized.includes('"markerHashMatches":true') || !serialized.includes('"persistenceMatchesNoOp":true')) throw new Error("Independent SYSTEM inspection failed");
  } finally {
    let cleanupError = null;
    try { if (stageAttempted) await runCommand(systemCleanup(runId)); }
    catch (error) { cleanupError = error; }
    const preDeallocate = await state();
    if (preDeallocate.sessions.length !== 0) throw new Error(`Refusing to deallocate a host with an interactive session; cleanup error: ${cleanupError || "none"}`);
    if (preDeallocate.power !== "PowerState/deallocated") await operation(await request(`${vm}/deallocate?api-version=2024-11-01`, { method: "POST", body: "{}" }));
    const final = await state();
    if (final.power !== "PowerState/deallocated" || final.sessions.length !== 0 || final.hostStatus !== "Shutdown") throw new Error(`Final deallocation guard failed: ${JSON.stringify(final)}`);
    if (cleanupError) throw cleanupError;
  }
  process.stdout.write(`${JSON.stringify({ runId, method: "Azure Run Command / NT AUTHORITY\\SYSTEM", inspection, cleanup: "verified", finalPower: "PowerState/deallocated" }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

export { RUN_ID_PATTERN, RUN_VALUE_DATA, RUN_VALUE_NAME, systemCleanup, systemInspect, systemStage };
