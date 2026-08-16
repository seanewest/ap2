#!/usr/bin/env node
import fs from "node:fs";
import { ClientCertificateCredential } from "@azure/identity";
import { chromium } from "playwright";

// Recovered from W49 and W51. Run Command only stages/inspects this method;
// the marked payload is launched once from Kobe's authenticated AVD canvas.
const RUN_VALUE_NAME = "AP2KobeIncidentBackgroundCanary";
const RUN_VALUE_DATA = "cmd.exe /d /c exit 0";
const RUN_ID_PATTERN = /^AP2-KOBE-USER-BG-\d{8}T\d{4}Z$/;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ps(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function userPayload(runId) {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${ps(runId)}
$started = (Get-Date).ToUniversalTime().ToString('o')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$self = Get-Process -Id $PID
$root = Join-Path $env:LOCALAPPDATA "AP2\IncidentBackground\$runId"
if (Test-Path -LiteralPath $root) { throw "Exact run root already exists" }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$markerPath = Join-Path $root 'employee-marker.txt'
Set-Content -LiteralPath $markerPath -Value "AP2 harmless Kobe user-context marker $runId" -Encoding UTF8
$markerHash = (Get-FileHash -LiteralPath $markerPath -Algorithm SHA256).Hash
$localUserCount = -1; $localDiscoveryError = $null
try { $localUserCount = @(Get-LocalUser -ErrorAction Stop).Count } catch { $localDiscoveryError = $_.Exception.GetType().FullName }
$processCount = @(Get-Process).Count
$establishedTcpCount = -1; $networkDiscoveryError = $null
try { $establishedTcpCount = @(Get-NetTCPConnection -State Established -ErrorAction Stop).Count } catch { $networkDiscoveryError = $_.Exception.GetType().FullName }
$dnsAnswerCount = -1; $dnsError = $null
try { $dnsAnswerCount = @(Resolve-DnsName -Name 'ap2-tester123.youtrack.cloud' -ErrorAction Stop).Count } catch { $dnsError = $_.Exception.GetType().FullName }
$beaconStatus = $null; $beaconError = $null
try { $response = Invoke-WebRequest -Uri "https://ap2-tester123.youtrack.cloud/?ap2-run=$runId" -Method Head -UseBasicParsing -TimeoutSec 20; $beaconStatus = [int]$response.StatusCode } catch { if ($_.Exception.Response.StatusCode) { $beaconStatus = [int]$_.Exception.Response.StatusCode }; $beaconError = $_.Exception.GetType().FullName }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($null -ne (Get-ItemProperty -Path $runKey -Name '${RUN_VALUE_NAME}' -ErrorAction SilentlyContinue)) { throw 'Exact HKCU Run value already exists' }
New-ItemProperty -Path $runKey -Name '${RUN_VALUE_NAME}' -Value '${RUN_VALUE_DATA}' -PropertyType String -Force | Out-Null
$persistenceVerified = ((Get-ItemPropertyValue -Path $runKey -Name '${RUN_VALUE_NAME}') -eq '${RUN_VALUE_DATA}')
$childCommand = '$env:AP2_RUN_ID=''' + $runId + '''; Start-Sleep -Seconds 300'
$child = Start-Process powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-Command',$childCommand) -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
$groups = @(whoami /groups 2>$null)
$integrityLine = @($groups | Where-Object { $_ -match 'Mandatory Label' } | Select-Object -First 1)
[ordered]@{
  schemaVersion=1; runId=$runId; startedUtc=$started; completedUtc=(Get-Date).ToUniversalTime().ToString('o')
  identity=[ordered]@{ windowsIdentityName=$identity.Name; userSid=$identity.User.Value; authenticationType=$identity.AuthenticationType; environmentUsername=$env:USERNAME; userProfile=$env:USERPROFILE; processId=$PID; processSessionId=$self.SessionId; childProcessId=$child.Id; childSessionId=(Get-Process -Id $child.Id).SessionId; integrityLine=($integrityLine -join ''); quserLines=@(quser 2>$null) }
  execution=[ordered]@{ powershellExecutionPolicy=(Get-ExecutionPolicy); markerPath=$markerPath; markerSha256=$markerHash }
  discovery=[ordered]@{ computerName=$env:COMPUTERNAME; localUserCount=$localUserCount; localDiscoveryError=$localDiscoveryError; processCount=$processCount; establishedTcpCount=$establishedTcpCount; networkDiscoveryError=$networkDiscoveryError; dnsAnswerCount=$dnsAnswerCount; dnsError=$dnsError }
  outbound=[ordered]@{ method='HEAD'; destinationHost='ap2-tester123.youtrack.cloud'; statusCode=$beaconStatus; errorType=$beaconError }
  persistence=[ordered]@{ hive='HKCU'; name='${RUN_VALUE_NAME}'; valueClass='no-op cmd exit'; createdAndVerified=$persistenceVerified; triggered=$false }
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'summary.json') -Encoding UTF8`;
}

function stageScript(runId) {
  const payload = userPayload(runId);
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${ps(runId)}
$root = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
if (Test-Path -LiteralPath $root) { throw 'Exact staging root already exists; inspect rather than replay' }
$existing = @(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\IncidentBackground\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
if ($existing.Count -ne 0) { throw 'Exact user evidence already exists; inspect rather than replay' }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$path = Join-Path $root 'user-background.ps1'
[IO.File]::WriteAllText($path, @'
${payload}
'@, [Text.UTF8Encoding]::new($false))
[ordered]@{runId=$runId; staged=$true; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash} | ConvertTo-Json -Compress`;
}

function recoveryInspectScript(runId, expectedIdentity) {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${ps(runId)}
$expectedIdentity = ${ps(expectedIdentity)}
$stageRoot = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
$candidateRoots = @(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\IncidentBackground\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
if ($candidateRoots.Count -gt 1) { throw "Ambiguous recovered profile roots: $($candidateRoots.Count)" }
if ($candidateRoots.Count -eq 0) { [ordered]@{runId=$runId; evidencePresent=$false; stagePresent=(Test-Path -LiteralPath $stageRoot)} | ConvertTo-Json -Compress; exit 0 }
$userRoot = $candidateRoots[0]
$summaryPath = Join-Path $userRoot 'summary.json'
if (!(Test-Path -LiteralPath $summaryPath)) { throw 'Recovered profile root has no summary' }
$summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
if ($summary.runId -ne $runId -or $summary.identity.windowsIdentityName -ne $expectedIdentity) { throw 'Exact evidence identity mismatch' }
if ($summary.identity.authenticationType -ne 'CloudAP' -or $summary.identity.processSessionId -le 0 -or $summary.identity.childSessionId -ne $summary.identity.processSessionId -or $summary.identity.integrityLine -notmatch 'Medium') { throw 'Interactive CloudAP/medium-integrity/session guard failed' }
$markerHashMatches = ((Get-FileHash -LiteralPath $summary.execution.markerPath -Algorithm SHA256).Hash -eq $summary.execution.markerSha256)
$persistPath = "Registry::HKEY_USERS\$($summary.identity.userSid)\Software\Microsoft\Windows\CurrentVersion\Run"
$persistValue = Get-ItemPropertyValue -Path $persistPath -Name '${RUN_VALUE_NAME}' -ErrorAction Stop
$marked = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*" } | ForEach-Object { $ownerResult=Invoke-CimMethod -InputObject $_ -MethodName GetOwner; [ordered]@{processId=$_.ProcessId; sessionId=$_.SessionId; owner=$(if($ownerResult.Domain){"$($ownerResult.Domain)\$($ownerResult.User)"}else{$ownerResult.User})} })
[ordered]@{ runId=$runId; evidencePresent=$true; recoveredProfileRoot=$userRoot; summary=$summary; markerHashMatches=$markerHashMatches; persistenceMatchesNoOp=($persistValue -eq '${RUN_VALUE_DATA}'); markedProcesses=$marked } | ConvertTo-Json -Depth 10 -Compress`;
}

function cleanupScript(runId, expectedIdentity) {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = ${ps(runId)}
$expectedIdentity = ${ps(expectedIdentity)}
$stageRoot = Join-Path $env:ProgramData "AP2\IncidentBackground\$runId"
$candidateRoots = @(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\IncidentBackground\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
if ($candidateRoots.Count -gt 1) { throw "Refusing ambiguous cleanup of $($candidateRoots.Count) profile roots" }
$stopped = 0
if ($candidateRoots.Count -eq 1) {
  $userRoot = $candidateRoots[0]
  $summary = Get-Content -LiteralPath (Join-Path $userRoot 'summary.json') -Raw | ConvertFrom-Json
  if ($summary.runId -ne $runId -or $summary.identity.windowsIdentityName -ne $expectedIdentity) { throw 'Exact cleanup identity mismatch' }
  $marked = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*" })
  foreach ($process in $marked) { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop; $stopped++ }
  $persistPath = "Registry::HKEY_USERS\$($summary.identity.userSid)\Software\Microsoft\Windows\CurrentVersion\Run"
  $actual = Get-ItemPropertyValue -Path $persistPath -Name '${RUN_VALUE_NAME}' -ErrorAction Stop
  if ($actual -ne '${RUN_VALUE_DATA}') { throw 'Refusing to remove a non-canary Run value' }
  Remove-ItemProperty -Path $persistPath -Name '${RUN_VALUE_NAME}' -ErrorAction Stop
  Remove-Item -LiteralPath $userRoot -Recurse -Force
}
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
$rootsAfter = @(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\IncidentBackground\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
$survivors = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*" })
if ($rootsAfter.Count -ne 0 -or (Test-Path -LiteralPath $stageRoot) -or $survivors.Count -ne 0) { throw 'Cleanup verification failed' }
[ordered]@{runId=$runId; stoppedMarkedProcessCount=$stopped; userRootAbsent=$true; stageRootAbsent=$true; survivingMarkedProcessCount=0} | ConvertTo-Json -Compress`;
}

async function launchOnce({ runId, tenantId, userPrincipalName, pfxPath, passphrasePath }) {
  const pfx = fs.readFileSync(pfxPath);
  const passphrase = fs.readFileSync(passphrasePath, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfx, passphrase },
    { origin: `https://t${tenantId}.certauth.login.microsoftonline.com`, pfx, passphrase },
  ] });
  try {
    const page = await context.newPage();
    await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator('input[name="loginfmt"]').fill(userPrincipalName);
    await page.locator('input[type="submit"]').click();
    const no = page.getByRole("button", { name: "No", exact: true });
    if (await no.waitFor({ state: "visible", timeout: 60_000 }).then(() => true).catch(() => false)) await no.click();
    await page.waitForURL((url) => url.hostname === "windows.cloud.microsoft", { timeout: 90_000 });
    await page.waitForTimeout(8000);
    for (let index = 0; index < 10; index += 1) {
      const next = page.getByText(/^(Next|Done|Finish|Get started|Continue|Close|Skip|Not now)$/i, { exact: true }).last();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.evaluate((element) => element.click()); await page.waitForTimeout(1200);
    }
    const devices = page.getByText("Devices", { exact: true });
    if (await devices.isVisible({ timeout: 10_000 }).catch(() => false)) await devices.click();
    const resource = page.getByText("SessionDesktop", { exact: true });
    await resource.waitFor({ state: "visible", timeout: 45_000 });
    const sessionPagePromise = context.waitForEvent("page");
    await resource.click();
    const sessionPage = await sessionPagePromise;
    await sessionPage.waitForLoadState("domcontentloaded");
    await sessionPage.getByRole("button", { name: "Connect", exact: true }).click();
    await sessionPage.waitForTimeout(90_000);
    const canvases = await sessionPage.locator("canvas").evaluateAll((nodes) => nodes.map((node) => ({ width: node.width, height: node.height, rect: node.getBoundingClientRect().toJSON() })));
    if (canvases.length === 0) throw new Error("Remote desktop canvas was not present");
    const target = canvases.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0];
    await sessionPage.mouse.click(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
    await sessionPage.keyboard.press("Meta+R"); await sessionPage.waitForTimeout(1500);
    const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\ProgramData\\AP2\\IncidentBackground\\${runId}\\user-background.ps1"`;
    // Once typing begins the launch is possibly accepted. The caller must inspect;
    // it must never call this function again for the same run ID.
    await sessionPage.keyboard.type(command, { delay: 2 });
    await sessionPage.keyboard.press("Enter");
    await sessionPage.waitForTimeout(30_000);
    return { launchedAt: new Date().toISOString(), authenticatedUser: userPrincipalName, remoteCanvas: true };
  } finally {
    await context.close().catch(() => {}); await browser.close().catch(() => {});
  }
}

async function main() {
  const runId = required("AP2_ENDPOINT_RUN_ID");
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("AP2_ENDPOINT_RUN_ID has the wrong Kobe marker shape");
  const userPrincipalName = required("AP2_KOBE_UPN");
  const expectedIdentity = required("AP2_WINDOWS_IDENTITY");
  const config = JSON.parse(fs.readFileSync(required("AP2_ARM_CONFIG"), "utf8"));
  const credential = new ClientCertificateCredential(config.tenantId, config.clientId, { certificatePath: config.certificatePath });
  const token = (await credential.getToken("https://management.azure.com/.default")).token;
  const origin = "https://management.azure.com";
  const scope = `${origin}/subscriptions/${config.subscriptionId}/resourceGroups/${required("AP2_AVD_RESOURCE_GROUP")}/providers`;
  const vm = `${scope}/Microsoft.Compute/virtualMachines/${required("AP2_AVD_VM")}`;
  const host = `${scope}/Microsoft.DesktopVirtualization/hostPools/${required("AP2_AVD_HOST_POOL")}/sessionHosts/${required("AP2_AVD_SESSION_HOST")}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function request(url, options = {}) { const response=await fetch(url,{...options,headers:{...headers,...(options.headers||{})}}); const text=await response.text(); if(!response.ok)throw new Error(`${options.method||"GET"} ${url} -> ${response.status} ${text.slice(0,800)}`); return {response,body:text?JSON.parse(text):null}; }
  async function operation(result) { const url=result.response.headers.get("azure-asyncoperation")||result.response.headers.get("location"); if(!url)return result.body; for(let index=0;index<180;index+=1){await sleep(3000);const current=await request(url);const state=current.body?.status||current.body?.properties?.provisioningState;if(/succeeded/i.test(state))return current.body;if(/failed|canceled/i.test(state))throw new Error(JSON.stringify(current.body));}throw new Error("ARM operation remained ambiguous; inspect and do not replay"); }
  const runCommand=async(script)=>operation(await request(`${vm}/runCommand?api-version=2024-11-01`,{method:"POST",body:JSON.stringify({commandId:"RunPowerShellScript",script:[script]})}));
  async function state(){const [view,hostState,sessions]=await Promise.all([request(`${vm}/instanceView?api-version=2024-11-01`).then(x=>x.body),request(`${host}?api-version=2024-04-03`).then(x=>x.body),request(`${host}/userSessions?api-version=2024-04-03`).then(x=>x.body.value||[])]);return{power:view.statuses?.find(x=>String(x.code).startsWith("PowerState/"))?.code,hostStatus:hostState.properties?.status,hostSessionCount:hostState.properties?.sessions,sessions};}
  const before=await state();
  if(before.power!=="PowerState/deallocated"||before.sessions.length!==0)throw new Error(`Expected deallocated zero-session Kobe host: ${JSON.stringify(before)}`);
  let staged=false, launchPossiblyAccepted=false, launch=null, inspection=null;
  try {
    await operation(await request(`${vm}/start?api-version=2024-11-01`,{method:"POST",body:"{}"}));
    for(let index=0;index<60;index+=1){const current=await state();if(current.power==="PowerState/running"&&current.sessions.length===0)break;if(index===59)throw new Error("Kobe host did not become running/zero-session");await sleep(3000);}
    const prior=await runCommand(recoveryInspectScript(runId,expectedIdentity));
    if(JSON.stringify(prior).includes('"evidencePresent":true'))throw new Error("Exact evidence exists; recover it instead of replaying");
    await runCommand(stageScript(runId)); staged=true;
    launchPossiblyAccepted=true;
    try { launch=await launchOnce({runId,tenantId:config.tenantId,userPrincipalName,pfxPath:required("AP2_KOBE_PFX"),passphrasePath:required("AP2_KOBE_PFX_PASSPHRASE")}); } catch(error) { launch={ambiguous:true,error:error instanceof Error?error.message:String(error)}; }
    // This read-only recovery path is authoritative even if the browser result was
    // ambiguous. The launch is never repeated for this run ID.
    inspection=await runCommand(recoveryInspectScript(runId,expectedIdentity));
    const serialized=JSON.stringify(inspection);
    if(!serialized.includes('"evidencePresent":true'))throw new Error(`Launch left no decisive evidence and was not replayed: ${JSON.stringify(launch)}`);
    for(const guard of ['"markerHashMatches":true','"persistenceMatchesNoOp":true','"authenticationType":"CloudAP"','"triggered":false'])if(!serialized.includes(guard))throw new Error(`Recovered inspection failed guard ${guard}`);
  } finally {
    let cleanupError=null;
    try{if(staged)await runCommand(cleanupScript(runId,expectedIdentity));}catch(error){cleanupError=error;}
    const current=await state();
    const exact=current.sessions.filter(item=>item.properties?.userPrincipalName?.toLowerCase()===userPrincipalName.toLowerCase());
    const foreign=current.sessions.filter(item=>item.properties?.userPrincipalName?.toLowerCase()!==userPrincipalName.toLowerCase());
    if(foreign.length!==0||exact.length>1)throw new Error(`Refusing ambiguous session cleanup/deallocation: ${JSON.stringify(current.sessions)}; guest cleanup error: ${cleanupError||"none"}`);
    if(exact.length===1)await request(`${origin}${exact[0].id}?api-version=2024-04-03&force=true`,{method:"DELETE"});
    for(let index=0;index<60;index+=1){const after=await state();if(after.sessions.length===0&&after.hostSessionCount===0)break;if(index===59)throw new Error("Kobe session did not end");await sleep(3000);}
    const zero=await state();if(zero.sessions.length!==0)throw new Error("Refusing to deallocate with a surviving session");
    if(zero.power!=="PowerState/deallocated")await operation(await request(`${vm}/deallocate?api-version=2024-11-01`,{method:"POST",body:"{}"}));
    const final=await state();if(final.power!=="PowerState/deallocated"||final.hostStatus!=="Shutdown"||final.sessions.length!==0)throw new Error(`Final deallocation guard failed: ${JSON.stringify(final)}`);
    if(cleanupError)throw cleanupError;
  }
  process.stdout.write(`${JSON.stringify({runId,method:"Kobe interactive CloudAP session",launchPossiblyAccepted,launch,inspection,cleanup:"verified",finalPower:"PowerState/deallocated"},null,2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((error)=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});

export { RUN_ID_PATTERN, RUN_VALUE_DATA, RUN_VALUE_NAME, cleanupScript, recoveryInspectScript, stageScript, userPayload };
