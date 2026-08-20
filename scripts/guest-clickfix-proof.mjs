import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);
const { ClientCertificateCredential } = require("@azure/identity");
const { chromium } = require("playwright");

const RUNTIME = process.env.AP2_RUNTIME_ROOT ?? "/var/lib/codex-agent-tools-replacement/worker/ap2-runtime";
const ACTOR = (process.env.AP2_ACTOR ?? "homer").toLowerCase();
const TARGETS = Object.freeze({
  homer: { upn: "homer.simpson@corywest.onmicrosoft.com", computer: "ap2homerfresh", resourceGroup: "rg-ap2-avd-timed-homer", vm: "ap2homerfresh-vm", hostPool: "ap2timedhomer-hp", sessionHost: "ap2homerfresh", profile: "C:\\Users\\HomerSimpson" },
  rachel: { upn: "rachel.green@corywest.onmicrosoft.com", computer: "ap2fastrachel", resourceGroup: "rg-ap2-avd-fast-rachel", vm: "ap2fastrachel-vm", hostPool: "ap2fastrachel-hp", sessionHost: "ap2fastrachel", profile: "C:\\Users\\RachelGreen" },
});
const target = TARGETS[ACTOR];
if (!target) throw new Error("AP2_ACTOR must be homer or rachel");
const RUN_ID = process.env.AP2_RUN_ID?.trim();
if (!RUN_ID || !new RegExp(`^AP2-${ACTOR.toUpperCase()}-CLICKFIX-[0-9]{8}T[0-9]{6}Z$`).test(RUN_ID)) {
  throw new Error(`AP2_RUN_ID must be AP2-${ACTOR.toUpperCase()}-CLICKFIX-YYYYMMDDTHHMMSSZ`);
}
const MODE = process.argv[2];
if (!new Set(["preflight", "start-stage", "restart-mock", "execute", "resume-paste", "compose-fast", "observe", "cleanup", "state"]).has(MODE)) {
  throw new Error("mode must be preflight, start-stage, restart-mock, execute, resume-paste, compose-fast, observe, cleanup, or state");
}

const COMMAND = "powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand VwByAGkAdABlAC0ASABvAHMAdAAgACcASABlAGwAbABvACAAVwBvAHIAbABkACcA";
const COMMAND_SHA256 = crypto.createHash("sha256").update(COMMAND).digest("hex").toUpperCase();
const EXPECTED_SHA256 = "055394DB9160D87BEDE49F3E0455049923A8CFF7C0A5A5C700F7E7508B569DB8";
const UPN = target.upn;
const COMPUTER = target.computer;
const OUTPUT = `${RUNTIME}/runs/${RUN_ID}`;
const config = JSON.parse(fs.readFileSync(`${RUNTIME}/secrets/dev-graph/config.json`, "utf8"));
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: `${RUNTIME}/secrets/dev-graph/credential.pem`,
});
const armToken = (await credential.getToken("https://management.azure.com/.default")).token;
const subscription = `/subscriptions/${config.subscriptionId}`;
const vm = `${subscription}/resourceGroups/${target.resourceGroup}/providers/Microsoft.Compute/virtualMachines/${target.vm}`;
const host = `${subscription}/resourceGroups/${target.resourceGroup}/providers/Microsoft.DesktopVirtualization/hostPools/${target.hostPool}/sessionHosts/${target.sessionHost}`;
const origin = "https://management.azure.com";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (Buffer.from(COMMAND.split(" -EncodedCommand ")[1], "base64").toString("utf16le") !== "Write-Host 'Hello World'") {
  throw new Error("approved command no longer decodes to exact harmless source");
}
if (COMMAND_SHA256 !== EXPECTED_SHA256) throw new Error("approved command digest changed");

fs.mkdirSync(OUTPUT, { recursive: true, mode: 0o700 });

async function request(path, options = {}, token = armToken) {
  const response = await fetch(path.startsWith("http") ? path : origin + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
  });
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
  const initial = await request(`${vm}/runCommand?api-version=2024-11-01`, {
    method: "POST",
    body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }),
  });
  const location = initial.response.headers.get("location");
  let result = await operation(initial);
  if (!result?.properties?.output && location) {
    result = (await request(location)).body;
  }
  const stdout = result.properties?.output?.value?.find((entry) => /StdOut/i.test(entry.code))?.message;
  return { operation: result, local: stdout ? JSON.parse(stdout) : null };
}

async function avdState() {
  const [instance, hostState, sessionState] = await Promise.all([
    request(`${vm}/instanceView?api-version=2024-11-01`).then((value) => value.body),
    request(`${host}?api-version=2024-04-03`).then((value) => value.body),
    request(`${host}/userSessions?api-version=2024-04-03`).then((value) => value.body.value || []),
  ]);
  return {
    observedUtc: new Date().toISOString(),
    power: instance.statuses.find((entry) => String(entry.code).startsWith("PowerState/"))?.code,
    hostStatus: hostState.properties.status,
    declaredSessions: hostState.properties.sessions,
    assignedUser: hostState.properties.assignedUser,
    sessions: sessionState,
  };
}

function save(name, value) {
  fs.writeFileSync(`${OUTPUT}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function preflight() {
  const graphToken = (await credential.getToken("https://graph.microsoft.com/.default")).token;
  const defenderToken = (await credential.getToken("https://api.securitycenter.microsoft.com/.default")).token;
  const [machine, state, managed, defender] = await Promise.all([
    request(`${vm}?api-version=2024-11-01`).then((value) => value.body),
    avdState(),
    request(`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$filter=deviceName%20eq%20'${COMPUTER}'&$select=id,deviceName,azureADDeviceId,complianceState,lastSyncDateTime`, {}, graphToken).then((value) => value.body.value || []),
    request("https://api.securitycenter.microsoft.com/api/machines", {}, defenderToken).then((value) => (value.body.value || []).filter((entry) => String(entry.computerDnsName).toLowerCase() === COMPUTER)),
  ]);
  const result = {
    observedUtc: new Date().toISOString(),
    command: { value: COMMAND, sha256: COMMAND_SHA256, decodedUtf16Le: "Write-Host 'Hello World'" },
    vm: { id: machine.id, vmId: machine.properties.vmId, size: machine.properties.hardwareProfile.vmSize },
    avd: state,
    intune: managed,
    defender: defender.map((entry) => ({ id: entry.id, onboardingStatus: entry.onboardingStatus, healthStatus: entry.healthStatus, lastSeen: entry.lastSeen })),
  };
  if (result.vm.size !== "Standard_D2as_v7" || state.power !== "PowerState/deallocated" || state.hostStatus !== "Shutdown" || state.declaredSessions !== 0 || state.sessions.length !== 0 || state.assignedUser !== UPN || managed.length !== 1 || managed[0].complianceState !== "compliant" || defender.length !== 1 || defender[0].onboardingStatus !== "Onboarded") {
    throw new Error(`unsafe or changed Homer preflight: ${JSON.stringify(result)}`);
  }
  save("preflight.json", result);
  console.log(JSON.stringify(result, null, 2));
}

async function startAndStage() {
  const before = await avdState();
  if (before.sessions.length !== 0 || !new Set(["PowerState/deallocated", "PowerState/running"]).has(before.power)) throw new Error(`unsafe start state: ${JSON.stringify(before)}`);
  if (before.power === "PowerState/deallocated") await operation(await request(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  let ready;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    ready = await avdState();
    if (ready.power === "PowerState/running" && ready.hostStatus === "Available" && ready.sessions.length === 0) break;
    if (attempt === 119) throw new Error(`host did not become idle and available: ${JSON.stringify(ready)}`);
    await sleep(5000);
  }
  const reconcile = await runCommand(String.raw`$run='${RUN_ID}';$root=Join-Path 'C:\ProgramData\AP2\ClickFix' $run;$task=('AP2 ClickFix Mock '+$run);$receipt=Join-Path $root 'click-receipt.json';$scheduled=Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue;$ready=$false;if($scheduled){try{$r=Invoke-WebRequest http://localhost:8765/ -UseBasicParsing -TimeoutSec 2;$ready=$r.StatusCode -eq 200}catch{}};[ordered]@{rootExists=(Test-Path $root);taskExists=[bool]$scheduled;receiptExists=(Test-Path $receipt);mockReady=$ready}|ConvertTo-Json -Compress`);
  if (!reconcile.local) throw new Error(`stage reconciliation returned no guest output: ${JSON.stringify(reconcile)}`);
  if (reconcile.local?.rootExists || reconcile.local?.taskExists) {
    if (!reconcile.local.rootExists || !reconcile.local.taskExists || reconcile.local.receiptExists || !reconcile.local.mockReady) throw new Error(`ambiguous prior stage: ${JSON.stringify(reconcile.local)}`);
    const result = { before, ready, stage: { ...reconcile.local, reconciledAfterAcceptedRunCommand: true }, completedUtc: new Date().toISOString() };
    save("stage.json", result); console.log(JSON.stringify(result, null, 2)); return;
  }
  const html = `<!doctype html><meta charset="utf-8"><title>AP2 Verify</title><style>body{font-family:Segoe UI,sans-serif;margin:40px}button{width:600px;height:200px;font-size:32px;margin-top:40px}pre{white-space:pre-wrap}</style><h1>Verify you are human</h1><p>Click Verify to continue.</p><button id="verify">Verify</button><pre id="status">Nothing has been copied. A command is copied only by its Verify button.</pre><script>const command=${JSON.stringify(COMMAND)};window.ap2={attempts:[]};document.getElementById("verify").addEventListener("click",async(event)=>{const result={eventIsTrusted:event.isTrusted,attemptOrdinal:window.ap2.attempts.length+1,attemptedAt:new Date().toISOString(),command,commandSha256:${JSON.stringify(COMMAND_SHA256)},writeTextCalled:false,writeSucceeded:false};window.ap2.attempts.push(result);try{result.writeTextCalled=true;await navigator.clipboard.writeText(command);result.writeSucceeded=true}catch(error){result.writeError=String(error?.name||error)+": "+String(error?.message||"")}try{const response=await fetch("/result",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(result)});result.receiptStatus=response.status}catch(error){result.receiptError=String(error)}document.getElementById("status").textContent=JSON.stringify(result,null,2)});</script>`;
  const html64 = Buffer.from(html, "utf8").toString("base64");
  const stageScript = String.raw`$ErrorActionPreference='Stop';$run='${RUN_ID}';$root=Join-Path 'C:\ProgramData\AP2\ClickFix' $run;$task=('AP2 ClickFix Mock '+$run);$server=Join-Path $root 'mock-server.ps1';$receipt=Join-Path $root 'click-receipt.json';if(Test-Path $root){throw 'Exact run stage already exists; inspect instead of replaying'};$edge=(Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' -ErrorAction SilentlyContinue).DefaultClipboardSetting;$noRun=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' -ErrorAction SilentlyContinue).NoRun;$app=(Get-AppLockerPolicy -Effective -Xml);$def=Get-MpComputerStatus;if($null -ne $edge -or $null -ne $noRun -or $app -notmatch '<AppLockerPolicy Version="1"\s*/>' -or !$def.RealTimeProtectionEnabled -or !$def.BehaviorMonitorEnabled -or !$def.IsTamperProtected){throw 'Default endpoint posture changed'};New-Item $root -ItemType Directory -Force|Out-Null;$body=@'
$ErrorActionPreference='Stop';$root='C:\ProgramData\AP2\ClickFix\${RUN_ID}';$receipt=Join-Path $root 'click-receipt.json';$listener=[Net.HttpListener]::new();$listener.Prefixes.Add('http://localhost:8765/');$listener.Start();try{while($listener.IsListening){$ctx=$listener.GetContext();if($ctx.Request.HttpMethod -eq 'POST' -and $ctx.Request.Url.AbsolutePath -eq '/result'){$reader=[IO.StreamReader]::new($ctx.Request.InputStream,$ctx.Request.ContentEncoding);$json=$reader.ReadToEnd();$reader.Dispose();if(Test-Path $receipt){$ctx.Response.StatusCode=409}else{[IO.File]::WriteAllText($receipt,$json,[Text.UTF8Encoding]::new($false));$ctx.Response.StatusCode=201};$ctx.Response.Close();continue};$bytes=[Convert]::FromBase64String('${html64}');$ctx.Response.ContentType='text/html; charset=utf-8';$ctx.Response.Headers.Add('Cache-Control','no-store');$ctx.Response.OutputStream.Write($bytes,0,$bytes.Length);$ctx.Response.Close()}}finally{$listener.Close()}
'@;[IO.File]::WriteAllText($server,$body,[Text.UTF8Encoding]::new($false));$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "'+$server+'"');$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force|Out-Null;Start-ScheduledTask -TaskName $task;for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest http://localhost:8765/ -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){break}}catch{};if($i -eq 29){throw 'Mock did not become ready'};Start-Sleep 1};[ordered]@{stagedUtc=(Get-Date).ToUniversalTime().ToString('o');root=$root;task=$task;receiptAbsent=(-not(Test-Path $receipt));mockReady=$true;defaultPosture=[ordered]@{edgeDefaultClipboardSetting=$edge;noRun=$noRun;effectiveAppLocker=$app;realTimeProtection=$def.RealTimeProtectionEnabled;behaviorMonitor=$def.BehaviorMonitorEnabled;tamperProtected=$def.IsTamperProtected;signaturesOutOfDate=$def.DefenderSignaturesOutOfDate}}|ConvertTo-Json -Depth 5 -Compress`;
  const stage = await runCommand(stageScript);
  if (!stage.local?.mockReady || !stage.local?.receiptAbsent) throw new Error(`stage was not exact: ${JSON.stringify(stage)}`);
  const result = { before, ready, stage: stage.local, completedUtc: new Date().toISOString() };
  save("stage.json", result);
  console.log(JSON.stringify(result, null, 2));
}

async function restartMock() {
  const state = await avdState();
  if (state.power !== "PowerState/running" || state.sessions.some((entry) => entry.properties?.userPrincipalName?.toLowerCase() !== UPN)) throw new Error(`unsafe mock restart state: ${JSON.stringify(state)}`);
  const result = await runCommand(String.raw`$task='AP2 ClickFix Mock ${RUN_ID}';$receipt='C:\ProgramData\AP2\ClickFix\${RUN_ID}\click-receipt.json';if(Test-Path $receipt){throw 'Trusted click receipt already exists; do not replay'};if(!(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)){throw 'Exact mock task absent'};Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue;Start-ScheduledTask -TaskName $task;for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest http://localhost:8765/ -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){break}}catch{};if($i -eq 29){throw 'Mock did not restart'};Start-Sleep 1};[ordered]@{restartedUtc=(Get-Date).ToUniversalTime().ToString('o');receiptAbsent=(-not(Test-Path $receipt));mockReady=$true}|ConvertTo-Json -Compress`);
  if (!result.local?.mockReady || !result.local?.receiptAbsent) throw new Error(`mock restart was not exact: ${JSON.stringify(result.local)}`);
  save("mock-restart.json", result.local); console.log(JSON.stringify(result.local, null, 2));
}

async function connect(context) {
  let page = await context.newPage();
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  const click = async (candidate, locator) => {
    if (await locator.isVisible().catch(() => false)) { await locator.click(); await candidate.waitForTimeout(800); return true; }
    return false;
  };
  let active = [], resourceLaunched = false, reconnectCount = 0;
  for (let attempt = 1; attempt <= 420; attempt += 1) {
    for (const candidate of context.pages().filter((entry) => !entry.isClosed())) {
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
      if (/disconnected/i.test(text) && reconnectCount < 2 && await click(candidate, candidate.getByRole("button", { name: /^reconnect$/i }).first())) { reconnectCount += 1; continue; }
      if (!resourceLaunched && candidate === page) {
        const devices = candidate.getByText("Devices", { exact: true });
        if (await devices.isVisible().catch(() => false)) await devices.click().catch(() => {});
        const resource = candidate.getByText("SessionDesktop", { exact: true });
        if (await resource.isVisible().catch(() => false)) {
          const opened = context.waitForEvent("page", { timeout: 15000 });
          await resource.click();
          page = await opened;
          await page.waitForLoadState("domcontentloaded");
          const connectButton = page.getByRole("button", { name: "Connect", exact: true });
          if (await connectButton.isVisible({ timeout: 30000 }).catch(() => false)) await connectButton.click();
          resourceLaunched = true;
          continue;
        }
      }
    }
    active = (await avdState()).sessions;
    const canvases = await page.locator("canvas").count().catch(() => 0);
    if (canvases > 0 && active.length === 1 && active[0].properties?.userPrincipalName?.toLowerCase() === UPN && active[0].properties?.sessionState === "Active") break;
    if (attempt === 45) {
      const pages = [];
      for (const candidate of context.pages().filter((entry) => !entry.isClosed())) pages.push({ url: candidate.url(), title: await candidate.title().catch(() => ""), text: (await candidate.locator("body").innerText().catch(() => "")).slice(0, 5000) });
      save("connection-debug.json", { observedUtc: new Date().toISOString(), resourceLaunched, active, pages });
      await page.screenshot({ path: `${OUTPUT}/connection-debug.png` }).catch(() => {});
      throw new Error(`connection UI did not progress: ${JSON.stringify(pages).slice(0, 1800)}`);
    }
    if (attempt === 420) throw new Error(`session did not become ready: ${JSON.stringify(active)}`);
    await page.waitForTimeout(1000);
  }
  const canvas = (await page.locator("canvas").evaluateAll((nodes) => nodes.map((node) => ({ rect: node.getBoundingClientRect().toJSON() })))).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  if (!canvas || canvas.rect.width < 1200 || canvas.rect.height < 700) throw new Error("remote canvas absent");
  return { page, canvas, session: active[0] };
}

async function execute() {
  let before = await avdState();
  const pending = before.sessions.filter((entry) => entry.properties?.userPrincipalName?.toLowerCase() === UPN && entry.properties?.sessionState === "Pending");
  if (pending.length === before.sessions.length && pending.length > 0) {
    for (const session of pending) await operation(await request(`${session.id}?api-version=2024-04-03`, { method: "DELETE" }));
    for (let attempt = 0; attempt < 6; attempt += 1) { before = await avdState(); if (before.sessions.length === 0) break; await sleep(2000); }
    if (before.sessions.length > 0) {
      await operation(await request(`${vm}/deallocate?api-version=2024-11-01`, { method: "POST", body: "{}" }));
      await operation(await request(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
      for (let attempt = 0; attempt < 120; attempt += 1) { before = await avdState(); if (before.power === "PowerState/running" && before.hostStatus === "Available" && before.sessions.length === 0) break; if (attempt === 119) throw new Error(`power-cycle did not clear pending worker session: ${JSON.stringify(before)}`); await sleep(5000); }
      const mock = await runCommand(String.raw`$task='AP2 ClickFix Mock ${RUN_ID}';if(!(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)){throw 'Exact mock task absent after power-cycle'};Start-ScheduledTask -TaskName $task;for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest http://localhost:8765/ -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){break}}catch{};if($i -eq 29){throw 'Mock did not restart after power-cycle'};Start-Sleep 1};[ordered]@{restartedUtc=(Get-Date).ToUniversalTime().ToString('o');mockReady=$true}|ConvertTo-Json -Compress`);
      if (!mock.local?.mockReady) throw new Error(`mock restart failed: ${JSON.stringify(mock.local)}`);
    }
  }
  const resumable = before.sessions.length === 1 && before.sessions[0].properties?.userPrincipalName?.toLowerCase() === UPN && before.sessions[0].properties?.sessionState === "Disconnected";
  if ((!resumable && before.sessions.length !== 0) || before.power !== "PowerState/running" || before.hostStatus !== "Available") throw new Error(`unsafe execute state: ${JSON.stringify(before)}`);
  const pfx = `${RUNTIME}/secrets/cba/users/${ACTOR}/certificate.pfx`;
  const passphrase = fs.readFileSync(`${RUNTIME}/secrets/cba/users/${ACTOR}/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfxPath: pfx, passphrase },
    { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath: pfx, passphrase },
  ] });
  context.setDefaultTimeout(2500);
  const receipt = { runId: RUN_ID, command: COMMAND, commandSha256: COMMAND_SHA256, startedUtc: new Date().toISOString(), before };
  try {
    const { page, canvas, session } = await connect(context);
    receipt.session = session;
    receipt.connectedUtc = new Date().toISOString();
    const center = { x: canvas.rect.x + canvas.rect.width / 2, y: canvas.rect.y + canvas.rect.height / 2 };
    await page.mouse.click(center.x, center.y); await page.keyboard.press("Escape"); await page.waitForTimeout(700);
    await page.keyboard.press("Escape"); await page.mouse.dblclick(canvas.rect.x + 38, canvas.rect.y + 170, { delay: 100 }); await page.waitForTimeout(12000);
    await page.keyboard.press("Control+L"); await page.keyboard.type("http://localhost:8765/", { delay: 2 }); await page.keyboard.press("Enter"); await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUTPUT}/mock-loaded.png` });
    receipt.trustedClickSentUtc = new Date().toISOString();
    await page.mouse.click(canvas.rect.x + canvas.rect.width * 0.43, canvas.rect.y + canvas.rect.height * 0.61); await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUTPUT}/mock-after-click.png` });
    const clickCheck = await runCommand(String.raw`$path='C:\ProgramData\AP2\ClickFix\${RUN_ID}\click-receipt.json';if(!(Test-Path $path)){throw 'Trusted click receipt absent'};$click=Get-Content $path -Raw|ConvertFrom-Json;[ordered]@{click=$click}|ConvertTo-Json -Depth 6 -Compress`);
    if (clickCheck.local?.click?.eventIsTrusted !== true || clickCheck.local?.click?.attemptOrdinal !== 1 || clickCheck.local?.click?.writeSucceeded !== true || clickCheck.local?.click?.command !== COMMAND || clickCheck.local?.click?.commandSha256 !== COMMAND_SHA256) throw new Error(`trusted click did not write the exact command: ${JSON.stringify(clickCheck.local)}`);
    receipt.trustedClick = clickCheck.local.click;
    await page.keyboard.press("Alt+F4"); await page.waitForTimeout(1500);
    await page.keyboard.press("Meta+R"); await page.waitForTimeout(1200); await page.keyboard.press("Control+V"); await page.waitForTimeout(1200);
    receipt.guestPasteUtc = new Date().toISOString();
    await page.screenshot({ path: `${OUTPUT}/run-after-paste.png` });
    receipt.enterCount = 1; receipt.enteredUtc = new Date().toISOString(); await page.keyboard.press("Enter"); await page.waitForTimeout(8000);
    await page.screenshot({ path: `${OUTPUT}/hello-world.png` });
    receipt.completedUtc = new Date().toISOString();
    save("execution.json", receipt);
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await context.close().catch(() => {}); await browser.close().catch(() => {});
  }
}

async function resumePaste() {
  const before = await avdState();
  if (before.power !== "PowerState/running" || before.sessions.length !== 1 || before.sessions[0].properties?.userPrincipalName?.toLowerCase() !== UPN || before.sessions[0].properties?.sessionState !== "Disconnected") throw new Error(`exact disconnected session required: ${JSON.stringify(before)}`);
  const pfx = `${RUNTIME}/secrets/cba/users/${ACTOR}/certificate.pfx`;
  const passphrase = fs.readFileSync(`${RUNTIME}/secrets/cba/users/${ACTOR}/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfxPath: pfx, passphrase },
    { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath: pfx, passphrase },
  ] });
  context.setDefaultTimeout(2500);
  const receipt = { runId: RUN_ID, command: COMMAND, commandSha256: COMMAND_SHA256, trustedClickEvidence: "trusted-click-visible.png", startedUtc: new Date().toISOString(), before };
  try {
    const { page, canvas, session } = await connect(context); receipt.session = session; receipt.connectedUtc = new Date().toISOString();
    await page.screenshot({ path: `${OUTPUT}/trusted-click-visible.png` });
    await page.mouse.click(canvas.rect.x + canvas.rect.width - 102, canvas.rect.y + 182); await page.waitForTimeout(1800); await page.screenshot({ path: `${OUTPUT}/after-edge-close.png` });
    await page.keyboard.press("Meta+R"); await page.waitForTimeout(1200); await page.screenshot({ path: `${OUTPUT}/run-open.png` }); await page.keyboard.press("Control+V"); await page.waitForTimeout(1200);
    receipt.guestPasteUtc = new Date().toISOString(); await page.screenshot({ path: `${OUTPUT}/run-after-paste.png` }); save("paste-prepared.json", receipt);
    const signal = `${OUTPUT}/accept-paste`;
    for (let attempt = 0; attempt < 600 && !fs.existsSync(signal); attempt += 1) await page.waitForTimeout(500);
    if (!fs.existsSync(signal)) throw new Error("paste was not accepted; Enter remains unspent");
    receipt.enterCount = 1; receipt.enteredUtc = new Date().toISOString(); await page.keyboard.press("Enter"); await page.waitForTimeout(8000); await page.screenshot({ path: `${OUTPUT}/hello-world.png` }); receipt.completedUtc = new Date().toISOString(); save("execution.json", receipt); console.log(JSON.stringify(receipt, null, 2));
  } finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); }
}

async function composeFast() {
  const before = await avdState();
  if (before.power !== "PowerState/running" || before.sessions.length !== 1 || before.sessions[0].properties?.userPrincipalName?.toLowerCase() !== UPN || before.sessions[0].properties?.sessionState !== "Disconnected") throw new Error(`exact disconnected session required: ${JSON.stringify(before)}`);
  const pfx = `${RUNTIME}/secrets/cba/users/${ACTOR}/certificate.pfx`, passphrase = fs.readFileSync(`${RUNTIME}/secrets/cba/users/${ACTOR}/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [{ origin: "https://certauth.login.microsoftonline.com", pfxPath: pfx, passphrase }, { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath: pfx, passphrase }] }); context.setDefaultTimeout(2500);
  const receipt = { runId: RUN_ID, command: COMMAND, commandSha256: COMMAND_SHA256, startedUtc: new Date().toISOString(), before };
  try {
    const { page, canvas, session } = await connect(context); receipt.session = session; receipt.connectedUtc = new Date().toISOString();
    await page.keyboard.press("Escape"); await page.waitForTimeout(500); await page.mouse.dblclick(canvas.rect.x + 38, canvas.rect.y + 170, { delay: 100 }); await page.waitForTimeout(10000); await page.keyboard.press("Control+L"); await page.keyboard.type("http://localhost:8765/", { delay: 2 }); await page.keyboard.press("Enter"); await page.waitForTimeout(5000);
    await page.mouse.click(canvas.rect.x + canvas.rect.width * 0.43, canvas.rect.y + canvas.rect.height * 0.61); receipt.trustedClickUtc = new Date().toISOString(); await page.waitForTimeout(3000); await page.screenshot({ path: `${OUTPUT}/compose-trusted-click.png` });
    await page.mouse.click(canvas.rect.x + canvas.rect.width - 102, canvas.rect.y + 182); await page.waitForTimeout(1500); await page.keyboard.press("Meta+R"); await page.waitForTimeout(1000); await page.keyboard.press("Control+V"); receipt.guestPasteUtc = new Date().toISOString(); await page.waitForTimeout(1000); await page.screenshot({ path: `${OUTPUT}/compose-run-after-paste.png` }); save("compose-prepared.json", receipt);
    const signal = `${OUTPUT}/accept-compose`; for (let attempt = 0; attempt < 600 && !fs.existsSync(signal); attempt += 1) await page.waitForTimeout(500); if (!fs.existsSync(signal)) throw new Error("composed paste was not accepted; Enter remains unspent");
    receipt.enterCount = 1; receipt.enteredUtc = new Date().toISOString(); await page.keyboard.press("Enter"); await page.waitForTimeout(8000); await page.screenshot({ path: `${OUTPUT}/hello-world.png` }); receipt.completedUtc = new Date().toISOString(); save("execution.json", receipt); console.log(JSON.stringify(receipt, null, 2));
  } finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); }
}

async function observe() {
  const inspectionScript = String.raw`$run='${RUN_ID}';$root=Join-Path 'C:\ProgramData\AP2\ClickFix' $run;$receipt=Join-Path $root 'click-receipt.json';$click=$null;if(Test-Path $receipt){$click=Get-Content $receipt -Raw|ConvertFrom-Json};$procs=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'powershell.exe' -and $_.SessionId -eq 2}|Select-Object ProcessId,ParentProcessId,SessionId,CommandLine);$explorer=@(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|Select-Object ProcessId,SessionId);[ordered]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');click=$click;processes=$procs;explorer=$explorer;markerFiles=@(Get-ChildItem C:\Users -Filter CLICKFIX-SIMULATION.txt -Recurse -ErrorAction SilentlyContinue|Select-Object -ExpandProperty FullName)}|ConvertTo-Json -Depth 8 -Compress`;
  const local = await runCommand(inspectionScript);
  const click = local.local?.click;
  const visualClick = fs.existsSync(`${OUTPUT}/compose-trusted-click.png`);
  const clickExact = click == null ? visualClick : click.eventIsTrusted === true && click.attemptOrdinal === 1 && click.writeTextCalled === true && click.writeSucceeded === true && click.command === COMMAND && click.commandSha256 === COMMAND_SHA256;
  const encoded = COMMAND.split(" -EncodedCommand ")[1];
  const matchingProcesses = local.local.processes.filter((entry) => entry.SessionId === 2 && String(entry.CommandLine).includes(encoded));
  if (!clickExact || matchingProcesses.length !== 1 || local.local.markerFiles.length !== 0) {
    throw new Error(`guest observation was not decisive: ${JSON.stringify(local.local)}`);
  }
  const defenderToken = (await credential.getToken("https://api.securitycenter.microsoft.com/.default")).token;
  const machines = await request("https://api.securitycenter.microsoft.com/api/machines", {}, defenderToken).then((value) => value.body.value || []);
  const machine = machines.find((entry) => String(entry.computerDnsName).toLowerCase() === COMPUTER);
  if (!machine) throw new Error("Homer MDE machine absent");
  const execution = JSON.parse(fs.readFileSync(`${OUTPUT}/execution.json`, "utf8"));
  let alerts = [];
  for (let attempt = 0; attempt < 13; attempt += 1) {
    const response = await request(`https://api.securitycenter.microsoft.com/api/machines/${machine.id}/alerts`, {}, defenderToken);
    alerts = (response.body.value || []).filter((entry) => Date.parse(entry.alertCreationTime || entry.firstEventTime || 0) >= Date.parse(execution.enteredUtc) - 5000).map((entry) => ({ id: entry.id, title: entry.title, alertCreationTime: entry.alertCreationTime, firstEventTime: entry.firstEventTime, severity: entry.severity, status: entry.status, detectionSource: entry.detectionSource }));
    if (alerts.length > 0 || attempt === 12) break;
    await sleep(15000);
  }
  const result = { observedUtc: new Date().toISOString(), guest: local.local, trustedClickEvidence: click == null ? "compose-trusted-click.png" : "guest receipt", defender: { machineId: machine.id, onboardingStatus: machine.onboardingStatus, alerts } };
  save("observation.json", result);
  console.log(JSON.stringify(result, null, 2));
}

async function cleanup() {
  let before = await avdState();
  if (before.sessions.some((entry) => entry.properties?.userPrincipalName?.toLowerCase() !== UPN)) throw new Error(`foreign session appeared: ${JSON.stringify(before.sessions)}`);
  if (before.power === "PowerState/deallocated") {
    await operation(await request(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" }));
    for (let attempt = 0; attempt < 120; attempt += 1) { before = await avdState(); if (before.power === "PowerState/running" && before.hostStatus === "Available" && before.sessions.length === 0) break; if (attempt === 119) throw new Error(`cleanup start did not become ready: ${JSON.stringify(before)}`); await sleep(5000); }
  }
  const guestScript = String.raw`$run='${RUN_ID}';$root=Join-Path 'C:\ProgramData\AP2\ClickFix' $run;$task=('AP2 ClickFix Mock '+$run);$command='${COMMAND.replaceAll("'", "''")}';$encoded='${COMMAND.split(" -EncodedCommand ")[1]}';$matching=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'powershell.exe' -and $_.CommandLine -like ('*'+$encoded+'*')});foreach($p in $matching){Invoke-CimMethod -InputObject $p -MethodName Terminate|Out-Null};if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $task -Confirm:$false};$profiles=@(Get-CimInstance Win32_UserProfile|Where-Object {$_.LocalPath -eq '${target.profile.replaceAll("'", "''")}'});$removed=@();foreach($profile in $profiles){$hive=$profile.SID;$loaded=$false;if(!(Test-Path ('Registry::HKEY_USERS\'+$hive))){$hive='AP2ClickFix';reg.exe load ('HKU\'+$hive) (Join-Path $profile.LocalPath 'NTUSER.DAT')|Out-Null;if($LASTEXITCODE -ne 0){throw 'Could not load exact user hive'};$loaded=$true};$key='Registry::HKEY_USERS\'+$hive+'\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU';if(Test-Path $key){$item=Get-ItemProperty $key;foreach($property in $item.PSObject.Properties|Where-Object {$_.Name -notmatch '^PS'}){$value=[string]$property.Value;if($value -eq $command -or $value -eq ($command+'\1')){Remove-ItemProperty $key -Name $property.Name -Force;$removed+=$property.Name}}};if($loaded){[gc]::Collect();[gc]::WaitForPendingFinalizers();reg.exe unload ('HKU\'+$hive)|Out-Null;if($LASTEXITCODE -ne 0){throw 'Could not unload exact user hive'}}};if(Test-Path $root){Remove-Item $root -Recurse -Force};Start-Sleep 2;[ordered]@{cleanedUtc=(Get-Date).ToUniversalTime().ToString('o');matchingProcessesBefore=$matching.Count;matchingProcessesAfter=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'powershell.exe' -and $_.CommandLine -like ('*'+$encoded+'*')}).Count;taskAbsent=(-not [bool](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue));rootAbsent=(-not(Test-Path $root));runMruValuesRemoved=$removed}|ConvertTo-Json -Compress`;
  const guest = await runCommand(guestScript);
  if (guest.local?.matchingProcessesAfter !== 0 || !guest.local?.taskAbsent || !guest.local?.rootAbsent) throw new Error(`guest cleanup failed: ${JSON.stringify(guest.local)}`);
  for (const session of before.sessions) await operation(await request(`${session.id}?api-version=2024-04-03`, { method: "DELETE" }));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await avdState()).sessions.length === 0) break;
    await sleep(3000);
  }
  await operation(await request(`${vm}/deallocate?api-version=2024-11-01`, { method: "POST", body: "{}" }));
  let final;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    final = await avdState();
    if (final.power === "PowerState/deallocated" && final.hostStatus === "Shutdown" && final.declaredSessions === 0 && final.sessions.length === 0) break;
    if (attempt === 79) throw new Error(`final state not clean: ${JSON.stringify(final)}`);
    await sleep(3000);
  }
  const result = { completedUtc: new Date().toISOString(), guest: guest.local, final };
  save("cleanup.json", result);
  console.log(JSON.stringify(result, null, 2));
}

if (MODE === "preflight") await preflight();
else if (MODE === "start-stage") await startAndStage();
else if (MODE === "restart-mock") await restartMock();
else if (MODE === "execute") await execute();
else if (MODE === "resume-paste") await resumePaste();
else if (MODE === "compose-fast") await composeFast();
else if (MODE === "observe") await observe();
else if (MODE === "cleanup") await cleanup();
else console.log(JSON.stringify(await avdState(), null, 2));

export { COMMAND, COMMAND_SHA256 };
