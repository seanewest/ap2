import fs from "node:fs";

const EXPECTED_USER = "kobe@corywest.onmicrosoft.com";
const EXPECTED_WINDOWS_IDENTITY = "AzureAD\\KobeWest";
const EXPECTED_AUTHENTICATION = "CloudAP";
const EXPECTED_DOCUMENTS = [
  "AP2-Synthetic-Account-Plan.txt",
  "AP2-Synthetic-Travel-Notes.txt",
];
const RESOURCE_GROUP = "RG-AP2-AVD-FLA-KOBE";
const VM_NAME = "ap2flakobe-vm";
const HOST_POOL = "ap2flakobe-hp";
const SESSION_HOST = "ap2flakobe";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Usage: node scripts/w52-kobe-collection-boundary.mjs --mode <state|start|stage|inspect|cleanup|finish|print-guest-script> --run-id <AP2-KOBE-COLLECT-YT-...> [--config <protected-json>]");
    }
    values.set(key.slice(2), value);
  }
  const mode = values.get("mode");
  const runId = values.get("run-id");
  if (!mode || !runId) throw new Error("--mode and --run-id are required");
  if (!/^AP2-KOBE-COLLECT-YT-[A-Z0-9]{8,32}$/.test(runId)) {
    throw new Error("The run ID must be a unique AP2 Kobe collection marker");
  }
  return { mode, runId, configPath: values.get("config") };
}

function guestCollectionScript(runId, archiveName) {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = '${runId}'
$started = (Get-Date).ToUniversalTime().ToString('o')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$self = Get-Process -Id $PID
$root = Join-Path $env:LOCALAPPDATA "AP2\CollectionEgress\$runId"
if (Test-Path -LiteralPath $root) { throw "Exact run root already exists: $root" }
if ($identity.Name -ne '${EXPECTED_WINDOWS_IDENTITY}' -or $identity.AuthenticationType -ne '${EXPECTED_AUTHENTICATION}') { throw 'Kobe CloudAP identity guard failed' }
if ($self.SessionId -le 0) { throw 'Interactive-session guard failed' }
$integrityLine = (@(whoami /groups 2>$null | Where-Object { $_ -match 'Mandatory Label' } | Select-Object -First 1) -join '')
if ($integrityLine -notmatch 'Medium Mandatory Level') { throw 'Medium-integrity guard failed' }
$source = Join-Path $root 'synthetic-source'
New-Item -ItemType Directory -Path $source -Force | Out-Null
$documents = @(
  [ordered]@{ name='${EXPECTED_DOCUMENTS[0]}'; body=(@('AP2 SYNTHETIC ONLY',"Run: $runId",'Fictional account plan: Contoso demo renewal.','') -join [Environment]::NewLine) },
  [ordered]@{ name='${EXPECTED_DOCUMENTS[1]}'; body=(@('AP2 SYNTHETIC ONLY',"Run: $runId",'Fictional travel note: demo conference itinerary.','') -join [Environment]::NewLine) }
)
$created = @()
foreach ($document in $documents) {
  $path = Join-Path $source $document.name
  [IO.File]::WriteAllText($path, $document.body, [Text.UTF8Encoding]::new($false))
  $item = Get-Item -LiteralPath $path
  $created += [ordered]@{ name=$document.name; path=$path; bytes=$item.Length; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
}
$archivePath = Join-Path $root '${archiveName}'
Compress-Archive -LiteralPath @($created.path) -DestinationPath $archivePath -CompressionLevel Optimal
$archive = Get-Item -LiteralPath $archivePath
$summary = [ordered]@{
  schemaVersion=1
  runId=$runId
  startedUtc=$started
  completedUtc=(Get-Date).ToUniversalTime().ToString('o')
  identity=[ordered]@{
    windowsIdentityName=$identity.Name
    userSid=$identity.User.Value
    authenticationType=$identity.AuthenticationType
    environmentUsername=$env:USERNAME
    userProfile=$env:USERPROFILE
    processId=$PID
    processSessionId=$self.SessionId
    integrityLine=$integrityLine
    quserLines=@(quser 2>$null)
  }
  collection=[ordered]@{ sourceRoot=$source; selectedDocumentCount=$created.Count; documents=$created; realDataTouched=$false }
  staging=[ordered]@{ archivePath=$archivePath; archiveName=$archive.Name; archiveBytes=$archive.Length; archiveSha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash }
}
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $root 'summary.json') -Encoding UTF8
`;
}

const { mode, runId, configPath } = parseArgs(process.argv.slice(2));
const archiveName = `AP2-Kobe-Collection-${runId}.zip`;
const stageRoot = `C:\\ProgramData\\AP2\\CollectionEgress\\${runId}`;
const collectionScript = guestCollectionScript(runId, archiveName);

if (mode === "print-guest-script") {
  process.stdout.write(collectionScript);
  process.exit(0);
}
if (!configPath) throw new Error("--config is required for ARM modes");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const field of ["tenantId", "clientId", "subscriptionId", "certificatePath"]) {
  if (!config[field]) throw new Error(`Protected config is missing ${field}`);
}

const { ClientCertificateCredential } = await import("@azure/identity");
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: config.certificatePath,
});
const token = (await credential.getToken("https://management.azure.com/.default")).token;
const armOrigin = "https://management.azure.com";
const providers = `${armOrigin}/subscriptions/${config.subscriptionId}/resourceGroups/${RESOURCE_GROUP}/providers`;
const vm = `${providers}/Microsoft.Compute/virtualMachines/${VM_NAME}`;
const hostPool = `${providers}/Microsoft.DesktopVirtualization/hostPools/${HOST_POOL}`;
const host = `${hostPool}/sessionHosts/${SESSION_HOST}`;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${url} -> ${response.status} ${text.slice(0, 1800)}`);
  return { response, body: text ? JSON.parse(text) : null };
}

async function operation(result) {
  const url = result.response.headers.get("azure-asyncoperation") || result.response.headers.get("location");
  if (!url) return result.body;
  for (let index = 0; index < 180; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const current = await request(url);
    const status = current.body?.status || current.body?.properties?.provisioningState;
    if (/succeeded/i.test(status)) return current.body;
    if (/failed|canceled/i.test(status)) throw new Error(JSON.stringify(current.body));
  }
  throw new Error("ARM operation timeout");
}

async function state() {
  const [view, poolState, hostState, sessions] = await Promise.all([
    request(`${vm}/instanceView?api-version=2024-11-01`).then((value) => value.body),
    request(`${hostPool}?api-version=2024-04-03`).then((value) => value.body),
    request(`${host}?api-version=2024-04-03`).then((value) => value.body),
    request(`${host}/userSessions?api-version=2024-04-03`).then((value) => value.body.value || []),
  ]);
  return {
    observedAt: new Date().toISOString(),
    powerState: view.statuses?.find((item) => String(item.code).startsWith("PowerState/"))?.code,
    hostStatus: hostState.properties?.status,
    hostSessionCount: hostState.properties?.sessions,
    startVMOnConnect: poolState.properties?.startVMOnConnect,
    userSessions: sessions.map((item) => ({
      id: item.id,
      userPrincipalName: item.properties?.userPrincipalName,
      sessionState: item.properties?.sessionState,
    })),
  };
}

async function runCommand(script) {
  return operation(await request(`${vm}/runCommand?api-version=2024-11-01`, {
    method: "POST",
    body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }),
  }));
}

async function waitFor(predicate, description, attempts = 100) {
  let observed;
  for (let index = 0; index < attempts; index += 1) {
    observed = await state();
    if (predicate(observed)) return observed;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`${description}: ${JSON.stringify(observed)}`);
}

if (mode === "state") {
  console.log(JSON.stringify(await state(), null, 2));
} else if (mode === "start") {
  const before = await state();
  if (before.powerState !== "PowerState/deallocated" || before.userSessions.length !== 0 || before.hostSessionCount !== 0) {
    throw new Error(`Unsafe start precondition: ${JSON.stringify(before)}`);
  }
  await operation(await request(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  const after = await waitFor(
    (value) => value.powerState === "PowerState/running" && value.hostStatus === "Available" && value.userSessions.length === 0,
    "VM did not become safely ready",
  );
  console.log(JSON.stringify({ before, after }, null, 2));
} else if (mode === "stage") {
  const before = await state();
  if (before.powerState !== "PowerState/running" || before.hostStatus !== "Available" || before.userSessions.length !== 0) {
    throw new Error(`Unsafe staging precondition: ${JSON.stringify(before)}`);
  }
  const bytes = Buffer.from(collectionScript, "utf8").toString("base64");
  const script = `$ErrorActionPreference='Stop'; $root='${stageRoot}'; if(Test-Path -LiteralPath $root){throw 'Exact staging root already exists'}; New-Item -ItemType Directory -Path $root -Force|Out-Null; [IO.File]::WriteAllBytes((Join-Path $root 'collect.ps1'),[Convert]::FromBase64String('${bytes}')); [ordered]@{runId='${runId}';stagedUtc=(Get-Date).ToUniversalTime().ToString('o');sha256=(Get-FileHash -LiteralPath (Join-Path $root 'collect.ps1') -Algorithm SHA256).Hash}|ConvertTo-Json -Compress`;
  console.log(JSON.stringify({ runId, archiveName, result: await runCommand(script) }, null, 2));
} else if (mode === "inspect") {
  const script = String.raw`$ErrorActionPreference='Stop'
$runId='${runId}'
$expectedNames=@('${EXPECTED_DOCUMENTS.join("','")}')
$roots=@(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\CollectionEgress\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
if($roots.Count -ne 1){throw "Expected one exact run root, found $($roots.Count)"}
$root=$roots[0]
$summary=Get-Content -LiteralPath (Join-Path $root 'summary.json') -Raw|ConvertFrom-Json
if($summary.runId -ne $runId -or $summary.identity.windowsIdentityName -ne '${EXPECTED_WINDOWS_IDENTITY}' -or $summary.identity.authenticationType -ne '${EXPECTED_AUTHENTICATION}' -or $summary.identity.processSessionId -le 0 -or $summary.identity.integrityLine -notmatch 'Medium Mandatory Level'){throw 'Kobe interactive identity/session guard failed'}
if($summary.collection.realDataTouched -ne $false -or $summary.collection.selectedDocumentCount -ne 2){throw 'Synthetic-only collection guard failed'}
$documents=@(Get-ChildItem -LiteralPath $summary.collection.sourceRoot -File)
if($documents.Count -ne 2 -or @(Compare-Object @($documents.Name|Sort-Object) @($expectedNames|Sort-Object)).Count -ne 0){throw 'Exact source inventory mismatch'}
$documentChecks=@($summary.collection.documents|ForEach-Object { $expected=$_; $item=Get-Item -LiteralPath $expected.path; $hash=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash; if($hash -ne $expected.sha256 -or $item.Length -ne $expected.bytes){throw "Source hash/size mismatch: $($expected.name)"}; [ordered]@{name=$expected.name;bytes=$item.Length;sha256=$hash;hashMatches=$true} })
$archive=Get-Item -LiteralPath $summary.staging.archivePath
$archiveHash=(Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash
if($archive.Name -ne '${archiveName}' -or $archiveHash -ne $summary.staging.archiveSha256 -or $archive.Length -ne $summary.staging.archiveBytes){throw 'Archive name/hash/size mismatch'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive.FullName)
try { $entries=@($zip.Entries|ForEach-Object { [ordered]@{name=$_.Name;bytes=$_.Length} }) } finally { $zip.Dispose() }
if($entries.Count -ne 2 -or @(Compare-Object @($entries.name|Sort-Object) @($expectedNames|Sort-Object)).Count -ne 0){throw 'Exact ZIP inventory mismatch'}
[ordered]@{runId=$runId;identity=$summary.identity;documentChecks=$documentChecks;archive=[ordered]@{name=$archive.Name;bytes=$archive.Length;sha256=$archiveHash;hashMatches=$true};zipEntries=$entries;realDataTouched=$false}|ConvertTo-Json -Depth 10 -Compress`;
  console.log(JSON.stringify({ runId, state: await state(), result: await runCommand(script) }, null, 2));
} else if (mode === "cleanup") {
  const script = String.raw`$ErrorActionPreference='Stop'
$runId='${runId}'
$stageRoot='${stageRoot}'
$roots=@(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\CollectionEgress\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
if($roots.Count -gt 1){throw "Expected no more than one exact run root, found $($roots.Count)"}
$marked=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*"})
foreach($process in $marked){Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop}
if($roots.Count -eq 1){$root=$roots[0];$summary=Get-Content -LiteralPath (Join-Path $root 'summary.json') -Raw|ConvertFrom-Json;if($summary.runId -ne $runId -or $summary.identity.windowsIdentityName -ne '${EXPECTED_WINDOWS_IDENTITY}'){throw 'Exact run identity mismatch'};Remove-Item -LiteralPath $root -Recurse -Force}
if(Test-Path -LiteralPath $stageRoot){Remove-Item -LiteralPath $stageRoot -Recurse -Force}
$survivors=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -like "*$runId*"})
$remainingRoots=@(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName "AppData\Local\AP2\CollectionEgress\$runId" } | Where-Object { Test-Path -LiteralPath $_ })
if($remainingRoots.Count -ne 0 -or (Test-Path -LiteralPath $stageRoot) -or $survivors.Count -ne 0){throw 'Exact cleanup verification failed'}
[ordered]@{runId=$runId;stoppedMarkedProcessCount=$marked.Count;userRootAbsent=$true;stageRootAbsent=$true;survivingMarkedProcessCount=0}|ConvertTo-Json -Compress`;
  console.log(JSON.stringify({ runId, before: await state(), result: await runCommand(script) }, null, 2));
} else if (mode === "finish") {
  const before = await state();
  const kobeSessions = before.userSessions.filter((session) => session.userPrincipalName?.toLowerCase() === EXPECTED_USER);
  if (before.userSessions.length !== kobeSessions.length || kobeSessions.length > 1) {
    throw new Error(`Unexpected AVD sessions: ${JSON.stringify(before.userSessions)}`);
  }
  if (kobeSessions.length === 1) {
    await request(`${armOrigin}${kobeSessions[0].id}?api-version=2024-04-03&force=true`, { method: "DELETE" });
  }
  const loggedOff = await waitFor(
    (value) => value.userSessions.length === 0 && value.hostSessionCount === 0,
    "Kobe session cleanup failed",
    60,
  );
  if (loggedOff.powerState !== "PowerState/deallocated") {
    await operation(await request(`${vm}/deallocate?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  }
  const final = await waitFor(
    (value) => value.powerState === "PowerState/deallocated" && value.hostStatus === "Shutdown" && value.userSessions.length === 0 && value.hostSessionCount === 0,
    "Final VM/session safety check failed",
  );
  console.log(JSON.stringify({ runId, before, loggedOff, final }, null, 2));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
