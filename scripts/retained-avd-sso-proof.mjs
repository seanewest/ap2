import fs from "node:fs";
import { ClientCertificateCredential } from "@azure/identity";
import { chromium } from "playwright";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const ACTOR = process.env.AP2_ACTOR?.trim().toLowerCase();
const RUN_ID = process.env.AP2_RUN_ID?.trim();
const MODE = process.argv[2];
const TARGETS = Object.freeze({
  rachel: {
    upn: "rachel.green@corywest.onmicrosoft.com",
    windowsIdentity: "AzureAD\\RachelGreen",
    profile: "RachelGreen",
    resourceGroup: "rg-ap2-avd-fast-rachel",
    vm: "ap2fastrachel-vm",
    hostPool: "ap2fastrachel-hp",
    sessionHost: "ap2fastrachel",
    debugPort: 9321,
  },
  kobe: {
    upn: "kobe@corywest.onmicrosoft.com",
    windowsIdentity: "AzureAD\\KobeWest",
    profile: "KobeWest",
    resourceGroup: "rg-ap2-avd-fla-kobe",
    vm: "ap2kobefresh-vm",
    hostPool: "ap2flakobe-hp",
    sessionHost: "ap2kobefresh",
    debugPort: 9322,
  },
});
if (!TARGETS[ACTOR]) throw new Error("AP2_ACTOR must be rachel or kobe");
if (!new Set(["state", "run", "cleanup"]).has(MODE)) throw new Error("mode must be state, run, or cleanup");
if (MODE !== "state" && !new RegExp(`^AP2-${ACTOR.toUpperCase()}-SSO-[0-9]{8}T[0-9]{6}Z$`).test(RUN_ID ?? "")) {
  throw new Error(`AP2_RUN_ID must be AP2-${ACTOR.toUpperCase()}-SSO-YYYYMMDDTHHMMSSZ`);
}

const target = TARGETS[ACTOR];
const runtime = resolveAp2RuntimeRoot();
const output = RUN_ID ? `${runtime}/runs/${RUN_ID}` : null;
const config = JSON.parse(fs.readFileSync(`${runtime}/secrets/dev-graph/config.json`, "utf8"));
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: `${runtime}/secrets/dev-graph/credential.pem`,
});
const armToken = (await credential.getToken("https://management.azure.com/.default"))?.token;
if (!armToken) throw new Error("Protected credential could not obtain an ARM token");
const subscription = `/subscriptions/${config.subscriptionId}`;
const vm = `${subscription}/resourceGroups/${target.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${target.vm}`;
const host = `${subscription}/resourceGroups/${target.resourceGroup}/providers/Microsoft.DesktopVirtualization/hostPools/${target.hostPool}/sessionHosts/${target.sessionHost}`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function save(name, value) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${output}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function arm(pathname, init = {}) {
  const response = await fetch(pathname.startsWith("http") ? pathname : `https://management.azure.com${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${armToken}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status}: ${body?.error?.message ?? "no message"}`);
  return { response, body };
}

async function operation(initial) {
  const url = initial.response.headers.get("azure-asyncoperation") ?? initial.response.headers.get("location");
  if (!url) return initial.body;
  let latest;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await sleep(3000);
    latest = await arm(url);
    const state = latest.body?.status ?? latest.body?.properties?.provisioningState;
    if (/succeeded/i.test(state ?? "")) return latest.body;
    if (/failed|canceled/i.test(state ?? "")) throw new Error(`ARM operation failed: ${JSON.stringify(latest.body)}`);
  }
  throw new Error(`ARM operation remained ambiguous; inspect before retrying: ${JSON.stringify(latest?.body)}`);
}

async function runCommand(script) {
  return operation(await arm(`${vm}/runCommand?api-version=2024-11-01`, {
    method: "POST",
    body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }),
  }));
}

async function state() {
  const [instance, sessionHost, sessions, pool] = await Promise.all([
    arm(`${vm}/instanceView?api-version=2024-11-01`).then(({ body }) => body),
    arm(`${host}?api-version=2024-04-03`).then(({ body }) => body),
    arm(`${host}/userSessions?api-version=2024-04-03`).then(({ body }) => body.value ?? []),
    arm(`${subscription}/resourceGroups/${target.resourceGroup}/providers/Microsoft.DesktopVirtualization/hostPools/${target.hostPool}?api-version=2024-04-03`).then(({ body }) => body),
  ]);
  return {
    observedUtc: new Date().toISOString(),
    actor: ACTOR,
    vm: target.vm,
    power: instance.statuses?.find((entry) => entry.code?.startsWith("PowerState/"))?.code,
    hostStatus: sessionHost.properties?.status,
    assignedUser: sessionHost.properties?.assignedUser,
    declaredSessions: sessionHost.properties?.sessions,
    entraRdpSso: /(?:^|;)enablerdsaadauth:i:1(?:;|$)/i.test(pool.properties?.customRdpProperty ?? ""),
    sessions: sessions.map((entry) => ({
      id: entry.id,
      userPrincipalName: entry.properties?.userPrincipalName,
      sessionState: entry.properties?.sessionState,
    })),
  };
}

async function waitForState(predicate, label, attempts = 120) {
  let latest;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await state();
    if (predicate(latest)) return latest;
    await sleep(3000);
  }
  throw new Error(`${label} did not reconcile: ${JSON.stringify(latest)}`);
}

async function ensureReady() {
  const before = await state();
  if (before.assignedUser?.toLowerCase() !== target.upn || before.sessions.length !== 0 || !before.entraRdpSso) {
    throw new Error(`Endpoint is outside the safe SSO proof boundary: ${JSON.stringify(before)}`);
  }
  if (!new Set(["PowerState/deallocated", "PowerState/running", "PowerState/starting"]).has(before.power)) {
    throw new Error(`Endpoint has an unreconciled power transition: ${JSON.stringify(before)}`);
  }
  if (before.power === "PowerState/deallocated") {
    await operation(await arm(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  }
  const ready = await waitForState(
    (current) => current.power === "PowerState/running" && current.hostStatus === "Available" && current.sessions.length === 0,
    `${ACTOR} AVD readiness`,
  );
  return { before, ready };
}

async function connect(context, observeSession) {
  let page = await context.newPage();
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  const handled = new WeakMap();
  const once = (candidate, key) => {
    const keys = handled.get(candidate) ?? new Set();
    if (keys.has(key)) return false;
    keys.add(key); handled.set(candidate, keys); return true;
  };
  const click = async (candidate, locator) => {
    if (!await locator.isVisible().catch(() => false)) return false;
    await locator.click(); return true;
  };
  let resourceLaunched = false;
  let latest;
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    for (const candidate of context.pages().filter((entry) => !entry.isClosed())) {
      const text = (await candidate.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
      const login = candidate.locator('input[name="loginfmt"]:visible').first();
      if (await login.isVisible().catch(() => false) && once(candidate, "username")) {
        await login.fill(target.upn); await candidate.locator('#idSIButton9,input[type="submit"]').first().click(); continue;
      }
      const organization = candidate.locator('input[name="domainName"]:visible,input[placeholder*="domain" i]:visible').first();
      if (await organization.isVisible().catch(() => false)) {
        await organization.fill("corywest.onmicrosoft.com"); await candidate.locator('input[type="submit"],button[type="submit"]').first().click(); continue;
      }
      if (/pick an account|choose an account/i.test(text) && await click(candidate, candidate.getByText(/use another account|sign in with another account/i).first())) continue;
      const certificate = candidate.getByText(/use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i).first();
      if (await certificate.isVisible().catch(() => false) && once(candidate, "certificate")) { await certificate.click(); continue; }
      const options = candidate.getByText(/sign-in options|sign in another way/i).first();
      if (await options.isVisible().catch(() => false) && once(candidate, "options")) { await options.click(); continue; }
      if (/stay signed in/i.test(text) && await click(candidate, candidate.locator('#idBtn_Back,button:has-text("No")').first())) continue;
      if (await click(candidate, candidate.getByText(/^(Next|Done|Finish|Get started|Continue|Close|Skip|Not now)$/i, { exact: true }).last())) continue;
      if (/in session settings|choose what to use in your remote session/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^connect$/i }).last())) continue;
      if (/sign in to your session|credentials|authenticate to the session|grant permission to connect to your resource/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /sign in/i }).last())) continue;
      if (/allow remote desktop connection/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^yes$/i }).last())) continue;
      if (/disconnected/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^reconnect$/i }).last())) continue;
      if (!resourceLaunched && candidate === page) {
        const devices = candidate.getByText("Devices", { exact: true });
        if (await devices.isVisible().catch(() => false)) await devices.click().catch(() => {});
        const resource = candidate.getByText("SessionDesktop", { exact: true });
        if (await resource.isVisible().catch(() => false)) {
          const opened = context.waitForEvent("page", { timeout: 15000 });
          await resource.click(); page = await opened; await page.waitForLoadState("domcontentloaded");
          const button = page.getByRole("button", { name: "Connect", exact: true });
          if (await button.isVisible({ timeout: 30000 }).catch(() => false)) await button.click();
          resourceLaunched = true;
        }
      }
    }
    latest = await state();
    if (latest.sessions.length === 1 && latest.sessions[0].userPrincipalName?.toLowerCase() === target.upn) observeSession(latest.sessions[0]);
    const active = latest.sessions.length === 1 && latest.sessions[0].userPrincipalName?.toLowerCase() === target.upn && latest.sessions[0].sessionState === "Active";
    const canvas = (await page.locator("canvas").evaluateAll((nodes) => nodes.map((node) => ({ rect: node.getBoundingClientRect().toJSON() }))).catch(() => []))
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0];
    if (active && canvas?.rect.width >= 1200 && canvas?.rect.height >= 700) return { page, canvas, session: latest.sessions[0] };
    if (attempt % 30 === 0) {
      const pages = await Promise.all(context.pages().filter((entry) => !entry.isClosed()).map(async (entry) => ({
        url: entry.url(),
        text: (await entry.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim().slice(0, 800),
      })));
      console.log(JSON.stringify({ sessionEstablishmentPending: true, actor: ACTOR, attempt, state: latest, pages }));
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`${ACTOR} interactive session did not reconcile: ${JSON.stringify(latest)}`);
}

function guestScript() {
  return String.raw`$ErrorActionPreference = 'Stop'
$runId = '${RUN_ID}'
$userRoot = 'C:/Users/${target.profile}/AppData/Local/AP2/SsoProof/${RUN_ID}'
$edgeRoot = Join-Path $userRoot 'Edge'
$resultPath = Join-Path $userRoot 'result.json'
if (-not (Test-Path -LiteralPath $userRoot) -or (Test-Path -LiteralPath $resultPath)) { throw 'Exact user proof root was not cleanly staged' }
try {
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$self = Get-Process -Id $PID
$integrity = (@(whoami /groups 2>$null | Where-Object { $_ -match 'Mandatory Label' } | Select-Object -First 1) -join '')
if ($identity.Name -cne '${target.windowsIdentity}' -or $identity.AuthenticationType -cne 'CloudAP' -or $self.SessionId -le 0 -or $integrity -notmatch 'Medium Mandatory Level') { throw 'Interactive CloudAP user guard failed' }
$dsreg = (& dsregcmd.exe /status | Out-String)
function Match-Field([string]$name) { ([regex]::Match($dsreg, '(?mi)^\s*' + [regex]::Escape($name) + '\s*:\s*(.*?)\s*$')).Groups[1].Value.Trim() }
$joined = Match-Field 'AzureAdJoined'
$prt = Match-Field 'AzureAdPrt'
$prtUpdate = Match-Field 'AzureAdPrtUpdateTime'
$prtExpiry = Match-Field 'AzureAdPrtExpiryTime'
$prtAuthority = Match-Field 'AzureAdPrtAuthority'
$wamDefaultSet = Match-Field 'WamDefaultSet'
$wamDefaultAuthority = Match-Field 'WamDefaultAuthority'
$wamDefaultId = Match-Field 'WamDefaultId'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edge)) { throw 'Edge executable absent' }
$targetUrl = 'https://outlook.office.com/mail/?realm=corywest.onmicrosoft.com'
$arguments = @('--user-data-dir=' + $edgeRoot, '--remote-debugging-port=${target.debugPort}', '--new-window', $targetUrl)
$process = Start-Process -FilePath $edge -ArgumentList $arguments -PassThru
$targets = @()
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:${target.debugPort}/json/list' -TimeoutSec 2
    $targets = @(foreach ($entry in $response) { if ($entry.type -eq 'page') { [ordered]@{ url=$entry.url; title=$entry.title } } })
  } catch { $targets = @() }
  if (@($targets | Where-Object { $_.url -match '^https://outlook\.office\.com/mail/' }).Count -gt 0) { break }
  if (@($targets | Where-Object { $_.url -match '^https://login\.microsoftonline\.com/' }).Count -gt 0 -and $i -ge 20) { break }
}
$marked = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $runId + '*') })
$owners = @($marked | ForEach-Object { $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner; if ($owner.ReturnValue -eq 0) { $owner.Domain + '\' + $owner.User } } | Sort-Object -Unique)
$authenticated = @($targets | Where-Object { $_.url -match '^https://outlook\.office\.com/mail/' }).Count -gt 0
$loginPrompt = @($targets | Where-Object { $_.url -match '^https://login\.microsoftonline\.com/' }).Count -gt 0
$result = [ordered]@{
  schemaVersion=1; runId=$runId; observedUtc=(Get-Date).ToUniversalTime().ToString('o')
  identity=[ordered]@{ name=$identity.Name; sid=$identity.User.Value; authenticationType=$identity.AuthenticationType; sessionId=$self.SessionId; mediumIntegrity=($integrity -match 'Medium Mandatory Level') }
  device=[ordered]@{ azureAdJoined=$joined; azureAdPrt=$prt; azureAdPrtUpdateTime=$prtUpdate; azureAdPrtExpiryTime=$prtExpiry; azureAdPrtAuthority=$prtAuthority; wamDefaultSet=$wamDefaultSet; wamDefaultAuthority=$wamDefaultAuthority; wamDefaultId=$wamDefaultId }
  browser=[ordered]@{ targetUrl=$targetUrl; cleanDataDirectoryCreated=$true; priorCookieStateAvailable=$false; privateMode=$false; markedProcessCount=$marked.Count; processOwners=$owners; targets=$targets; authenticatedOutlook=$authenticated; loginPromptObserved=$loginPrompt }
}
[IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
@($marked | Where-Object { $_.ProcessId -ne $PID }) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $edgeRoot) { Remove-Item -LiteralPath $edgeRoot -Recurse -Force }
} catch {
  $failure = [ordered]@{ schemaVersion=1; runId=$runId; observedUtc=(Get-Date).ToUniversalTime().ToString('o'); error=[ordered]@{ message=$_.Exception.Message; line=$_.InvocationInfo.ScriptLineNumber } }
  [IO.File]::WriteAllText($resultPath, ($failure | ConvertTo-Json -Depth 4 -Compress), [Text.UTF8Encoding]::new($false))
}
`;
}

function stageScript() {
  const encoded = Buffer.from(guestScript(), "utf8").toString("base64");
  return String.raw`$ErrorActionPreference='Stop'
$root='C:/ProgramData/AP2/SsoProof/${RUN_ID}'
if(Test-Path -LiteralPath $root){throw 'Exact system staging root already exists'}
New-Item -ItemType Directory -Path $root -Force|Out-Null
$rootAcl=Get-Acl -LiteralPath $root
$rootRule=New-Object Security.AccessControl.FileSystemAccessRule('${target.windowsIdentity}','ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')
$rootAcl.SetAccessRule($rootRule);Set-Acl -LiteralPath $root -AclObject $rootAcl
$scriptPath=Join-Path $root 'user-proof.ps1'
[IO.File]::WriteAllBytes($scriptPath,[Convert]::FromBase64String('${encoded}'))
$tokens=$null;$parseErrors=$null
[void][Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count-ne 0){throw ('Guest script parse gate failed: '+(($parseErrors|ForEach-Object{$_.Message})-join '; '))}
$taskLog='C:/Users/${target.profile}/AppData/Local/Temp/${RUN_ID}-task.log'
if(Test-Path -LiteralPath $taskLog){throw 'Exact task log already exists'}
$userRoot='C:/Users/${target.profile}/AppData/Local/AP2/SsoProof/${RUN_ID}'
if(Test-Path -LiteralPath $userRoot){throw 'Exact user proof root already exists'}
New-Item -ItemType Directory -Path $userRoot -Force|Out-Null
$acl=Get-Acl -LiteralPath $userRoot
$rule=New-Object Security.AccessControl.FileSystemAccessRule('${target.windowsIdentity}','Modify','ContainerInherit,ObjectInherit','None','Allow')
$acl.SetAccessRule($rule);Set-Acl -LiteralPath $userRoot -AclObject $acl
$launcher=Join-Path $root 'launch.cmd'
$line='@C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "'+$scriptPath+'" > "'+$taskLog+'" 2>&1'
[IO.File]::WriteAllText($launcher,$line+[Environment]::NewLine,[Text.ASCIIEncoding]::new())
[ordered]@{staged=$true;parsed=$true;launcherReady=$true;runId='${RUN_ID}';userResultAbsent=(-not(Test-Path -LiteralPath 'C:/Users/${target.profile}/AppData/Local/AP2/SsoProof/${RUN_ID}/result.json'))}|ConvertTo-Json -Compress`;
}

function inspectScript() {
  return String.raw`$ErrorActionPreference='Stop'
$path='C:/Users/${target.profile}/AppData/Local/AP2/SsoProof/${RUN_ID}/result.json'
if(-not(Test-Path -LiteralPath $path)){$taskLog='C:/Users/${target.profile}/AppData/Local/Temp/${RUN_ID}-task.log';$bytes=if(Test-Path -LiteralPath $taskLog){[IO.File]::ReadAllBytes($taskLog)}else{[byte[]]@()};$sample=if($bytes.Length-gt 0){[Convert]::ToBase64String($bytes[0..([Math]::Min(1999,$bytes.Length-1))])}else{''};$marked=@(Get-CimInstance Win32_Process|Where-Object{$_.CommandLine-like'*${RUN_ID}*'});[ordered]@{evidencePresent=$false;runId='${RUN_ID}';markedProcessCount=$marked.Count;taskLogBytes=$bytes.Length;taskLogBase64=$sample}|ConvertTo-Json -Compress;exit 0}
$result=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
[ordered]@{evidencePresent=$true;runId=$result.runId;error=$result.error;identity=$result.identity;device=$result.device;browser=$result.browser;cleanEdgeDirectoryAbsent=(-not(Test-Path -LiteralPath 'C:/Users/${target.profile}/AppData/Local/AP2/SsoProof/${RUN_ID}/Edge'))}|ConvertTo-Json -Depth 8 -Compress`;
}

function cleanupScript() {
  return String.raw`$ErrorActionPreference='Stop'
$runId='${RUN_ID}'
@(Get-CimInstance Win32_Process|Where-Object{$_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+$runId+'*')})|ForEach-Object{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
$systemRoot='C:/ProgramData/AP2/SsoProof/${RUN_ID}'
$userRoot='C:/Users/${target.profile}/AppData/Local/AP2/SsoProof/${RUN_ID}'
$taskLog='C:/Users/${target.profile}/AppData/Local/Temp/${RUN_ID}-task.log'
if(Test-Path -LiteralPath $systemRoot){Remove-Item -LiteralPath $systemRoot -Recurse -Force}
if(Test-Path -LiteralPath $userRoot){Remove-Item -LiteralPath $userRoot -Recurse -Force}
if(Test-Path -LiteralPath $taskLog){Remove-Item -LiteralPath $taskLog -Force}
$survivors=@(Get-CimInstance Win32_Process|Where-Object{$_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+$runId+'*')})
if((Test-Path -LiteralPath $systemRoot) -or (Test-Path -LiteralPath $userRoot) -or ($survivors.Count -ne 0)){throw 'Exact cleanup verification failed'}
[ordered]@{runId=$runId;systemRootAbsent=$true;userRootAbsent=$true;markedProcessCount=0}|ConvertTo-Json -Compress`;
}

function embeddedJson(operationBody, requiredKey) {
  const strings = [];
  const visit = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(operationBody);
  for (const value of strings) {
    for (const line of value.split(/\r?\n/).reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (Object.hasOwn(parsed, requiredKey)) return parsed;
      } catch { /* unrelated command output */ }
    }
  }
  throw new Error(`Run Command output lacked ${requiredKey}`);
}

async function cleanup(ownedSession, observedUtc) {
  const before = await state();
  if (before.sessions.some((entry) => entry.userPrincipalName?.toLowerCase() !== target.upn)) throw new Error(`Foreign session prevents cleanup: ${JSON.stringify(before.sessions)}`);
  const placeholderAge = Date.now() - Date.parse(observedUtc ?? "");
  const placeholder = ownedSession?.sessionState === "Pending" && ownedSession.id?.endsWith("/-1") && Number.isFinite(placeholderAge) && placeholderAge >= 0 && placeholderAge <= 15 * 60 * 1000;
  if (before.sessions.length && (!ownedSession || (!placeholder && before.sessions.some((entry) => entry.id !== ownedSession.id)))) throw new Error(`Session is not owned by this run: ${JSON.stringify(before.sessions)}`);
  for (const session of before.sessions) {
    const force = session.sessionState === "Pending" && session.id?.endsWith("/-1") ? "&force=true" : "";
    await arm(`${session.id}?api-version=2024-04-03${force}`, { method: "DELETE" });
  }
  const final = await waitForState((current) => current.sessions.length === 0 && current.declaredSessions === 0, `${ACTOR} session cleanup`, 40);
  return { before, final, vmPowerChanged: false };
}

async function execute() {
  const readiness = await ensureReady(); save("readiness.json", readiness);
  const pfxPath = `${runtime}/secrets/cba/users/${ACTOR}/certificate.pfx`;
  const passphrase = fs.readFileSync(`${runtime}/secrets/cba/users/${ACTOR}/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfxPath, passphrase },
    { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath, passphrase },
  ] });
  context.setDefaultTimeout(2500);
  let ownedSession; let observedUtc; let result; let staged = false;
  try {
    const connected = await connect(context, (session) => {
      const transition = ownedSession?.sessionState === "Pending" && ownedSession.id?.endsWith("/-1") && session.sessionState === "Active";
      if (ownedSession && ownedSession.id !== session.id && !transition) throw new Error("Session identity changed during establishment");
      if (!ownedSession || transition) {
        ownedSession = session; observedUtc = new Date().toISOString();
        save("owned-session.json", { runId: RUN_ID, actor: ACTOR, observedUtc, session });
      }
    });
    const prior = embeddedJson(await runCommand(inspectScript()), "evidencePresent");
    if (prior.evidencePresent) throw new Error("Exact proof evidence already exists; reconcile instead of replaying");
    staged = true;
    const stageOperation = await runCommand(stageScript());
    save("stage-operation.json", stageOperation);
    const stage = embeddedJson(stageOperation, "staged");
    if (!stage.staged || !stage.parsed || !stage.launcherReady) throw new Error(`Interactive launcher staging guards failed: ${JSON.stringify(stage)}`);
    await connected.page.mouse.click(connected.canvas.rect.x + connected.canvas.rect.width / 2, connected.canvas.rect.y + connected.canvas.rect.height / 2);
    await connected.page.keyboard.press("Escape");
    await connected.page.keyboard.press("Meta+R");
    await connected.page.waitForTimeout(1800);
    const command = `C:\\ProgramData\\AP2\\SsoProof\\${RUN_ID}\\launch.cmd`;
    await connected.page.keyboard.type(command, { delay: 2 });
    await connected.page.screenshot({ path: `${output}/run-dialog-ready.png` });
    await connected.page.keyboard.press("Enter");
    await connected.page.waitForTimeout(10000);
    await connected.page.screenshot({ path: `${output}/launcher-accepted.png` });
    let proof = embeddedJson(await runCommand(inspectScript()), "evidencePresent");
    if (!proof.evidencePresent && proof.markedProcessCount < 1) {
      throw new Error(`Interactive proof process failed before Edge observation: ${JSON.stringify(proof)}`);
    }
    // The guest proof has its own bounded Edge reconciliation window. Wait once,
    // then perform one authoritative VM-agent read; repeated Run Command polling
    // serializes at the extension and needlessly multiplies that window.
    if (!proof.evidencePresent) {
      await connected.page.waitForTimeout(195000);
      proof = embeddedJson(await runCommand(inspectScript()), "evidencePresent");
    }
    if (!proof?.evidencePresent) throw new Error(`User proof did not produce a receipt within the bounded observation window: ${JSON.stringify(proof)}`);
    save("observed-proof.json", proof);
    const expectedOwner = target.windowsIdentity.toLowerCase();
    if (proof.runId !== RUN_ID || proof.identity?.name?.toLowerCase() !== expectedOwner || proof.identity?.authenticationType !== "CloudAP" || !proof.identity?.mediumIntegrity || proof.device?.azureAdJoined !== "YES" || proof.device?.azureAdPrt !== "YES" || !proof.browser?.cleanDataDirectoryCreated || proof.browser?.priorCookieStateAvailable || !proof.browser?.authenticatedOutlook || proof.browser?.loginPromptObserved || !proof.cleanEdgeDirectoryAbsent) {
      throw new Error(`SSO proof guards failed: ${JSON.stringify(proof)}`);
    }
    result = { runId: RUN_ID, actor: ACTOR, session: connected.session, proof };
    save("proof.json", result);
  } finally {
    await context.close().catch(() => {}); await browser.close().catch(() => {});
    let guestCleanupError;
    try {
      if (staged) {
        const cleanupOperation = await runCommand(cleanupScript());
        save("guest-cleanup-operation.json", cleanupOperation);
        embeddedJson(cleanupOperation, "systemRootAbsent");
      }
    } catch (error) { guestCleanupError = error; }
    const sessionCleanup = await cleanup(ownedSession, observedUtc);
    if (result) result.cleanup = sessionCleanup;
    if (guestCleanupError) throw guestCleanupError;
  }
  save("proof.json", result);
  return result;
}

let result;
if (MODE === "state") result = await state();
else if (MODE === "run") result = await execute();
else {
  const receiptPath = `${output}/owned-session.json`;
  if (!fs.existsSync(receiptPath)) throw new Error("This run has no protected owned-session receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.runId !== RUN_ID || receipt.actor !== ACTOR || !receipt.session?.id) throw new Error("Owned-session receipt is invalid");
  const guest = embeddedJson(await runCommand(cleanupScript()), "systemRootAbsent");
  result = { guest, session: await cleanup(receipt.session, receipt.observedUtc) };
}
console.log(JSON.stringify(result, null, 2));
