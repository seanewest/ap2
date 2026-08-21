import fs from "node:fs";
import readline from "node:readline/promises";
import { createRequire } from "node:module";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const require = createRequire(`${process.cwd()}/package.json`);
const { ClientCertificateCredential } = require("@azure/identity");
const { chromium } = require("playwright");

const RUN_ID = process.env.AP2_RUN_ID?.trim();
if (!RUN_ID || !/^AP2-RACHEL-FIRSTLEG-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID)) throw new Error("AP2_RUN_ID must be AP2-RACHEL-FIRSTLEG-YYYYMMDDTHHMMSSZ");
const MODE = process.argv[2];
if (!new Set(["preflight", "stage", "drive", "observe", "signins", "cleanup", "state"]).has(MODE)) throw new Error("mode must be preflight, stage, drive, observe, signins, cleanup, or state");

const UPN = "rachel.green@corywest.onmicrosoft.com";
const COMPUTER = "ap2fastrachel";
const RUNTIME = resolveAp2RuntimeRoot();
const OUTPUT = `${RUNTIME}/runs/${RUN_ID}`;
const config = JSON.parse(fs.readFileSync(`${RUNTIME}/secrets/dev-graph/config.json`, "utf8"));
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, { certificatePath: `${RUNTIME}/secrets/dev-graph/credential.pem` });
const armToken = (await credential.getToken("https://management.azure.com/.default")).token;
const subscription = `/subscriptions/${config.subscriptionId}`;
const vm = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.Compute/virtualMachines/ap2fastrachel-vm`;
const host = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.DesktopVirtualization/hostPools/ap2fastrachel-hp/sessionHosts/ap2fastrachel`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(OUTPUT, { recursive: true, mode: 0o700 });

async function request(path, options = {}, token = armToken) {
  const response = await fetch(path.startsWith("http") ? path : `https://management.azure.com${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 1600) }; }
  if (!response.ok && response.status !== 404) throw new Error(`${response.status}_${path}_${text.slice(0, 1600)}`);
  return { response, body };
}

async function operation(initial) {
  const pollUrl = initial.response.headers.get("azure-asyncoperation") || initial.response.headers.get("location");
  if (!pollUrl) return initial.body;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await sleep(3000);
    const current = await request(pollUrl);
    const status = current.body?.status || current.body?.properties?.provisioningState;
    if (/succeeded/i.test(String(status))) return current.body;
    if (/failed|canceled/i.test(String(status))) throw new Error(`ARM_OPERATION_${status}_${JSON.stringify(current.body).slice(0, 1400)}`);
  }
  throw new Error("ARM operation remained ambiguous");
}

async function runCommand(script) {
  const initial = await request(`${vm}/runCommand?api-version=2024-11-01`, { method: "POST", body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }) });
  const location = initial.response.headers.get("location");
  let result = await operation(initial);
  if (!result?.properties?.output && location) result = (await request(location)).body;
  const stdout = result.properties?.output?.value?.find((entry) => /StdOut/i.test(entry.code))?.message;
  return { operation: result, local: stdout ? JSON.parse(stdout) : null };
}

async function avdState() {
  const [instance, hostState, sessionState] = await Promise.all([
    request(`${vm}/instanceView?api-version=2024-11-01`).then((v) => v.body),
    request(`${host}?api-version=2024-04-03`).then((v) => v.body),
    request(`${host}/userSessions?api-version=2024-04-03`).then((v) => v.body.value || []),
  ]);
  return { observedUtc: new Date().toISOString(), power: instance.statuses.find((e) => String(e.code).startsWith("PowerState/"))?.code, hostStatus: hostState.properties.status, declaredSessions: hostState.properties.sessions, assignedUser: hostState.properties.assignedUser, sessions: sessionState };
}

function save(name, value) { fs.writeFileSync(`${OUTPUT}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }

async function graph(path) {
  const token = (await credential.getToken("https://graph.microsoft.com/.default")).token;
  return request(`https://graph.microsoft.com${path}`, {}, token).then((v) => v.body);
}

async function identitySnapshot() {
  const users = await graph(`/v1.0/users?$filter=userPrincipalName%20eq%20'${UPN}'&$select=id,displayName,userPrincipalName`);
  if (users.value?.length !== 1) throw new Error("Rachel user lookup was not exact");
  const user = users.value[0];
  const methods = await graph(`/v1.0/users/${user.id}/authentication/methods`);
  return { observedUtc: new Date().toISOString(), user, authenticationMethods: (methods.value || []).map((m) => ({ id: m.id, type: m["@odata.type"] })).sort((a, b) => a.type.localeCompare(b.type)) };
}

async function preflight() {
  const [state, identity] = await Promise.all([avdState(), identitySnapshot()]);
  if (state.power !== "PowerState/deallocated" || state.hostStatus !== "Shutdown" || state.sessions.length || state.declaredSessions !== 0 || state.assignedUser !== UPN) throw new Error(`Rachel endpoint not clean: ${JSON.stringify(state)}`);
  const result = { state, identity };
  save("preflight.json", result); console.log(JSON.stringify(result, null, 2));
}

async function waitReady() {
  let state;
  for (let attempt = 0; attempt < 120; attempt += 1) { state = await avdState(); if (state.power === "PowerState/running" && state.hostStatus === "Available" && state.sessions.length === 0) return state; await sleep(5000); }
  throw new Error(`host did not become ready: ${JSON.stringify(state)}`);
}

async function stage() {
  const before = await avdState();
  if (before.sessions.length || !new Set(["PowerState/deallocated", "PowerState/running"]).has(before.power)) throw new Error(`unsafe stage state: ${JSON.stringify(before)}`);
  if (before.power === "PowerState/deallocated") await operation(await request(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  const ready = await waitReady();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AP2 Company Access</title><style>body{font:22px Segoe UI,sans-serif;background:#f4f7fb;color:#182230;margin:0}.card{width:760px;margin:90px auto;background:white;padding:48px;border-radius:18px;box-shadow:0 12px 40px #20304025}h1{font-size:44px;margin:0 0 16px}.eyebrow{color:#52657b;font-weight:700}.note{font-size:17px;color:#52657b}button{width:100%;height:120px;margin-top:26px;border:0;border-radius:12px;background:#1769e0;color:white;font-size:30px;font-weight:700}</style></head><body><main class="card"><div class="eyebrow">AP2 COMPANY ACCESS</div><h1>Welcome, Rachel</h1><p>Continue with Microsoft to finish sign-in on this controlled company session.</p><p class="note">This benign AP2 simulation will not ask for or collect a password, add a sign-in method, or perform activity after sign-in.</p><button id="continue">Continue with Microsoft</button><p id="status" class="note"></p></main><script>document.getElementById("continue").addEventListener("click",async(event)=>{const receipt={runId:${JSON.stringify(RUN_ID)},eventIsTrusted:event.isTrusted,clickedUtc:new Date().toISOString(),userAgent:navigator.userAgent};document.getElementById("status").textContent="Opening AP2…";await fetch("/continue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(receipt)});location.href="https://seanewest.github.io/ap2/"});</script></body></html>`;
  const html64 = Buffer.from(html).toString("base64");
  const script = String.raw`$ErrorActionPreference='Stop';$root=Join-Path 'C:\ProgramData\AP2\Enrollment' '${RUN_ID}';$task='AP2 Enrollment ${RUN_ID}';if(Test-Path $root){throw 'exact stage already exists'};New-Item $root -ItemType Directory -Force|Out-Null;$server=Join-Path $root 'server.ps1';$body=@'
$root=Join-Path 'C:\ProgramData\AP2\Enrollment' '${RUN_ID}';$listener=[Net.HttpListener]::new();$listener.Prefixes.Add('http://localhost:8767/');$listener.Start();try{while($listener.IsListening){$ctx=$listener.GetContext();if($ctx.Request.HttpMethod -eq 'POST' -and $ctx.Request.Url.AbsolutePath -eq '/continue'){$reader=[IO.StreamReader]::new($ctx.Request.InputStream,$ctx.Request.ContentEncoding);$json=$reader.ReadToEnd();$reader.Dispose();[IO.File]::WriteAllText((Join-Path $root 'continue.json'),$json,[Text.UTF8Encoding]::new($false));$ctx.Response.StatusCode=201;$ctx.Response.Close();continue};if($ctx.Request.UserAgent -like '*Edg/*'){[IO.File]::WriteAllText((Join-Path $root 'visit.json'),([ordered]@{visitedUtc=(Get-Date).ToUniversalTime().ToString('o');userAgent=$ctx.Request.UserAgent;remote=$ctx.Request.RemoteEndPoint.ToString()}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))};$bytes=[Convert]::FromBase64String('${html64}');$ctx.Response.ContentType='text/html; charset=utf-8';$ctx.Response.Headers.Add('Cache-Control','no-store');$ctx.Response.OutputStream.Write($bytes,0,$bytes.Length);$ctx.Response.Close()}}finally{$listener.Close()}
'@;[IO.File]::WriteAllText($server,$body,[Text.UTF8Encoding]::new($false));$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "'+$server+'"');$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force|Out-Null;Start-ScheduledTask $task;for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest http://localhost:8767/ -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){break}}catch{};Start-Sleep 1};[ordered]@{stagedUtc=(Get-Date).ToUniversalTime().ToString('o');root=$root;task=$task;ready=$true;visitAbsent=(-not(Test-Path (Join-Path $root 'visit.json')));continueAbsent=(-not(Test-Path (Join-Path $root 'continue.json')))}|ConvertTo-Json -Compress`;
  const staged = await runCommand(script);
  if (!staged.local?.ready || !staged.local?.continueAbsent) throw new Error(`stage failed: ${JSON.stringify(staged.local)}`);
  save("stage.json", { before, ready, staged: staged.local }); console.log(JSON.stringify({ before, ready, staged: staged.local }, null, 2));
}

async function connect(context) {
  let page = await context.newPage();
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  const click = async (candidate, locator) => { if (await locator.isVisible().catch(() => false)) { await locator.click(); await candidate.waitForTimeout(800); return true; } return false; };
  let active = [], resourceLaunched = false;
  for (let attempt = 1; attempt <= 420; attempt += 1) {
    for (const candidate of context.pages().filter((p) => !p.isClosed())) {
      const text = (await candidate.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
      const login = candidate.locator('input[name="loginfmt"]:visible').first();
      if (await login.isVisible().catch(() => false)) { await login.fill(UPN); await candidate.locator('#idSIButton9,input[type="submit"]').first().click(); await candidate.waitForTimeout(900); continue; }
      if (/pick an account|choose an account/i.test(text) && await click(candidate, candidate.getByText(/use another account|sign in with another account/i).first())) continue;
      if (await click(candidate, candidate.getByText(/use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i).first())) continue;
      if (await click(candidate, candidate.getByText(/sign-in options|sign in another way/i).first())) continue;
      if (/stay signed in/i.test(text) && await click(candidate, candidate.locator('#idBtn_Back,button:has-text("No")').first())) continue;
      if (await click(candidate, candidate.getByText(/^(Next|Done|Finish|Get started|Continue|Close|Skip|Not now)$/i, { exact: true }).last())) continue;
      if (/in session settings|choose what to use in your remote session/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^connect$/i }).first())) continue;
      if (/sign in to your session|credentials|authenticate to the session|grant permission to connect to your resource/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /sign in/i }).first())) continue;
      if (/allow remote desktop connection/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^yes$/i }).first())) continue;
      if (!resourceLaunched && candidate === page) {
        if (await candidate.getByText("Devices", { exact: true }).isVisible().catch(() => false)) await candidate.getByText("Devices", { exact: true }).click();
        const resource = candidate.getByText("SessionDesktop", { exact: true });
        if (await resource.isVisible().catch(() => false)) { const opened = context.waitForEvent("page", { timeout: 15000 }); await resource.click(); page = await opened; await page.waitForLoadState("domcontentloaded"); const button = page.getByRole("button", { name: "Connect", exact: true }); if (await button.isVisible({ timeout: 30000 }).catch(() => false)) await button.click(); resourceLaunched = true; continue; }
      }
    }
    active = (await avdState()).sessions;
    if (await page.locator("canvas").count().catch(() => 0) && active.length === 1 && active[0].properties?.userPrincipalName?.toLowerCase() === UPN && active[0].properties?.sessionState === "Active") break;
    if (attempt === 420) throw new Error(`session did not become ready: ${JSON.stringify(active)}`);
    await page.waitForTimeout(1000);
  }
  const canvas = (await page.locator("canvas").evaluateAll((nodes) => nodes.map((node) => ({ rect: node.getBoundingClientRect().toJSON() })))).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  if (!canvas || canvas.rect.width < 1200 || canvas.rect.height < 700) throw new Error("remote canvas absent");
  return { page, canvas, session: active[0] };
}

async function drive() {
  const before = await avdState();
  if (before.power !== "PowerState/running" || before.hostStatus !== "Available" || before.sessions.length) throw new Error(`unsafe drive state: ${JSON.stringify(before)}`);
  const pfx = `${RUNTIME}/secrets/cba/users/rachel/certificate.pfx`, passphrase = fs.readFileSync(`${RUNTIME}/secrets/cba/users/rachel/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [{ origin: "https://certauth.login.microsoftonline.com", pfxPath: pfx, passphrase }, { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath: pfx, passphrase }] });
  context.setDefaultTimeout(2500);
  const receipt = { runId: RUN_ID, startedUtc: new Date().toISOString(), before };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const { page, canvas, session } = await connect(context); receipt.session = session; receipt.connectedUtc = new Date().toISOString();
    await page.keyboard.press("Escape"); await page.waitForTimeout(500); await page.keyboard.press("Meta+R"); await page.waitForTimeout(1000); await page.keyboard.type("msedge.exe --inprivate http://localhost:8767/", { delay: 2 }); await page.keyboard.press("Enter"); await page.waitForTimeout(10000);
    let step = 0;
    while (true) {
      step += 1; const screenshot = `${OUTPUT}/drive-${String(step).padStart(2, "0")}.png`; await page.screenshot({ path: screenshot });
      console.log(JSON.stringify({ readyForAction: true, step, screenshot, canvas: canvas.rect }));
      const line = await rl.question(""); const action = JSON.parse(line);
      if (action.finish) { receipt.finishedUtc = new Date().toISOString(); receipt.finish = action.finish; break; }
      if (action.click) await page.mouse.click(canvas.rect.x + canvas.rect.width * action.click[0], canvas.rect.y + canvas.rect.height * action.click[1]);
      if (action.key) await page.keyboard.press(action.key);
      if (action.text) await page.keyboard.type(action.text, { delay: 2 });
      await page.waitForTimeout(action.waitMs ?? 3000);
    }
    save("execution.json", receipt); console.log(JSON.stringify(receipt, null, 2));
  } finally { rl.close(); await context.close().catch(() => {}); await browser.close().catch(() => {}); }
}

async function observe() {
  const execution = JSON.parse(fs.readFileSync(`${OUTPUT}/execution.json`, "utf8"));
  const guest = await runCommand(String.raw`$root=Join-Path 'C:\ProgramData\AP2\Enrollment' '${RUN_ID}';$visit=$null;$continue=$null;if(Test-Path (Join-Path $root 'visit.json')){$visit=Get-Content (Join-Path $root 'visit.json') -Raw|ConvertFrom-Json};if(Test-Path (Join-Path $root 'continue.json')){$continue=Get-Content (Join-Path $root 'continue.json') -Raw|ConvertFrom-Json};$edges=@();foreach($p in @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -notmatch ' --type='})){try{$o=Invoke-CimMethod -InputObject $p -MethodName GetOwner;$edges+=[ordered]@{processId=$p.ProcessId;parentProcessId=$p.ParentProcessId;sessionId=$p.SessionId;owner=($o.Domain+'\'+$o.User);inPrivate=([string]$p.CommandLine -match '--inprivate')}}catch{}};$explorer=@(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|Select-Object ProcessId,SessionId);$prt=(dsregcmd.exe /status|Select-String 'AzureAdPrt\s*:'|Select-Object -First 1).Line;$gsa=@(Get-Service -Name 'GlobalSecureAccess*','MicrosoftEntraPrivateAccess*' -ErrorAction SilentlyContinue|Select-Object Name,Status);[ordered]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');visit=$visit;continue=$continue;edge=$edges;explorer=$explorer;azureAdPrt=$prt;gsaServices=$gsa;quser=(quser.exe 2>&1|Out-String)}|ConvertTo-Json -Depth 8 -Compress`);
  const edges = Array.isArray(guest.local?.edge) ? guest.local.edge : guest.local?.edge ? [guest.local.edge] : [];
  const inPrivateVisual = fs.existsSync(`${OUTPUT}/drive-20.png`);
  if (guest.local?.continue?.eventIsTrusted !== true || guest.local?.continue?.runId !== RUN_ID || !edges.some((p) => /RachelGreen/i.test(p.owner)) || !inPrivateVisual) throw new Error(`guest proof not exact: ${JSON.stringify(guest.local)}`);
  const identityAfter = await identitySnapshot();
  const userId = identityAfter.user.id;
  const start = encodeURIComponent(new Date(Date.parse(execution.startedUtc) - 60000).toISOString());
  const signIns = await graph(`/beta/auditLogs/signIns?$filter=userId%20eq%20'${userId}'%20and%20createdDateTime%20ge%20${start}&$orderby=createdDateTime%20desc&$top=50`);
  const bounded = (signIns.value || []).map((s) => ({ createdDateTime: s.createdDateTime, appDisplayName: s.appDisplayName, resourceDisplayName: s.resourceDisplayName, clientAppUsed: s.clientAppUsed, ipAddress: s.ipAddress, status: s.status, conditionalAccessStatus: s.conditionalAccessStatus, isInteractive: s.isInteractive, authenticationRequirement: s.authenticationRequirement, authenticationDetails: (s.authenticationDetails || []).map((d) => ({ authenticationMethod: d.authenticationMethod, authenticationStepResultDetail: d.authenticationStepResultDetail, succeeded: d.succeeded })) }));
  const defenderToken = (await credential.getToken("https://api.securitycenter.microsoft.com/.default")).token;
  const machines = await request("https://api.securitycenter.microsoft.com/api/machines", {}, defenderToken).then((v) => v.body.value || []);
  const machine = machines.find((m) => String(m.computerDnsName).toLowerCase() === COMPUTER);
  if (!machine) throw new Error("Rachel MDE machine absent");
  const alerts = await request(`https://api.securitycenter.microsoft.com/api/machines/${machine.id}/alerts`, {}, defenderToken).then((v) => (v.body.value || []).filter((a) => Date.parse(a.alertCreationTime || a.firstEventTime || 0) >= Date.parse(execution.startedUtc) - 60000).map((a) => ({ id: a.id, title: a.title, alertCreationTime: a.alertCreationTime, severity: a.severity, status: a.status, detectionSource: a.detectionSource })));
  const result = { observedUtc: new Date().toISOString(), execution, guest: guest.local, inPrivateVisual: "drive-20.png", identityAfter, signIns: bounded, defender: { machineId: machine.id, onboardingStatus: machine.onboardingStatus, healthStatus: machine.healthStatus, lastSeen: machine.lastSeen, alerts } };
  save("observation.json", result); console.log(JSON.stringify(result, null, 2));
}

async function signins() {
  const execution = JSON.parse(fs.readFileSync(`${OUTPUT}/execution.json`, "utf8"));
  const identity = await identitySnapshot();
  const start = encodeURIComponent(new Date(Date.parse(execution.startedUtc) - 60000).toISOString());
  const response = await graph(`/beta/auditLogs/signIns?$filter=userId%20eq%20'${identity.user.id}'%20and%20createdDateTime%20ge%20${start}&$orderby=createdDateTime%20desc&$top=50`);
  const result = { observedUtc: new Date().toISOString(), signIns: (response.value || []).map((s) => ({ createdDateTime: s.createdDateTime, appDisplayName: s.appDisplayName, resourceDisplayName: s.resourceDisplayName, clientAppUsed: s.clientAppUsed, status: s.status, conditionalAccessStatus: s.conditionalAccessStatus, isInteractive: s.isInteractive, authenticationRequirement: s.authenticationRequirement, authenticationDetails: (s.authenticationDetails || []).map((d) => ({ authenticationMethod: d.authenticationMethod, authenticationStepResultDetail: d.authenticationStepResultDetail, succeeded: d.succeeded })) })) };
  save("signins-final.json", result); console.log(JSON.stringify(result, null, 2));
}

async function cleanup() {
  let before = await avdState();
  if (before.sessions.some((s) => s.properties?.userPrincipalName?.toLowerCase() !== UPN)) throw new Error(`foreign session appeared: ${JSON.stringify(before.sessions)}`);
  const guest = await runCommand(String.raw`$root=Join-Path 'C:\ProgramData\AP2\Enrollment' '${RUN_ID}';$task='AP2 Enrollment ${RUN_ID}';if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue){Stop-ScheduledTask $task -ErrorAction SilentlyContinue;Unregister-ScheduledTask $task -Confirm:$false};if(Test-Path $root){Remove-Item $root -Recurse -Force};[ordered]@{cleanedUtc=(Get-Date).ToUniversalTime().ToString('o');taskAbsent=(-not [bool](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue));rootAbsent=(-not(Test-Path $root))}|ConvertTo-Json -Compress`);
  if (!guest.local?.taskAbsent || !guest.local?.rootAbsent) throw new Error(`guest cleanup failed: ${JSON.stringify(guest.local)}`);
  for (const session of before.sessions) await operation(await request(`${session.id}?api-version=2024-04-03`, { method: "DELETE" }));
  await operation(await request(`${vm}/deallocate?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  let final;
  for (let attempt = 0; attempt < 80; attempt += 1) { final = await avdState(); if (final.power === "PowerState/deallocated" && final.hostStatus === "Shutdown" && final.sessions.length === 0 && final.declaredSessions === 0) break; await sleep(3000); }
  const identityAfterCleanup = await identitySnapshot();
  const baseline = JSON.parse(fs.readFileSync(`${OUTPUT}/preflight.json`, "utf8")).identity.authenticationMethods;
  if (JSON.stringify(baseline) !== JSON.stringify(identityAfterCleanup.authenticationMethods)) throw new Error("Rachel authentication methods changed");
  const result = { completedUtc: new Date().toISOString(), guest: guest.local, final, authenticationMethodsUnchanged: true, identityAfterCleanup };
  save("cleanup.json", result); console.log(JSON.stringify(result, null, 2));
}

if (MODE === "preflight") await preflight();
else if (MODE === "stage") await stage();
else if (MODE === "drive") await drive();
else if (MODE === "observe") await observe();
else if (MODE === "signins") await signins();
else if (MODE === "cleanup") await cleanup();
else console.log(JSON.stringify(await avdState(), null, 2));
