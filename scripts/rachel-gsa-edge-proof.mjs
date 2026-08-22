import fs from "node:fs";
import { ClientCertificateCredential } from "@azure/identity";
import { chromium } from "playwright";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const RACHEL_UPN = "rachel.green@corywest.onmicrosoft.com";
const RACHEL_WINDOWS_USER = "RachelGreen";
const MODE = process.argv[2];
const RUN_ID = process.env.AP2_RUN_ID?.trim();
const PRE_REQUEST_WAIT_MS = Number(process.env.AP2_PRE_REQUEST_WAIT_MS ?? 0);
if (!new Set(["request", "navigate", "reconcile", "cleanup", "state"]).has(MODE)) throw new Error("mode must be request, navigate, reconcile, cleanup, or state");
if (new Set(["request", "navigate", "reconcile"]).has(MODE) && !/^AP2-RACHEL-(?:GSA-TLS|CHAIN)-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID ?? "")) {
  throw new Error("AP2_RUN_ID must be AP2-RACHEL-GSA-TLS-YYYYMMDDTHHMMSSZ or AP2-RACHEL-CHAIN-YYYYMMDDTHHMMSSZ");
}
if (!Number.isInteger(PRE_REQUEST_WAIT_MS) || PRE_REQUEST_WAIT_MS < 0 || PRE_REQUEST_WAIT_MS > 600000) {
  throw new Error("AP2_PRE_REQUEST_WAIT_MS must be an integer from 0 through 600000");
}

const runtime = resolveAp2RuntimeRoot();
const config = JSON.parse(fs.readFileSync(`${runtime}/secrets/dev-graph/config.json`, "utf8"));
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: `${runtime}/secrets/dev-graph/credential.pem`,
});
const armToken = (await credential.getToken("https://management.azure.com/.default"))?.token;
if (!armToken) throw new Error("Protected credential could not obtain an ARM token");
const subscription = `/subscriptions/${config.subscriptionId}`;
const vm = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.Compute/virtualMachines/ap2fastrachel-vm`;
const host = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.DesktopVirtualization/hostPools/ap2fastrachel-hp/sessionHosts/ap2fastrachel`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeProtected(name, value) {
  if (!RUN_ID) return;
  const directory = `${runtime}/runs/${RUN_ID}`;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${directory}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function arm(pathname, init = {}, accepted = []) {
  const response = await fetch(pathname.startsWith("http") ? pathname : `https://management.azure.com${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${armToken}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 800) }; }
  if (!response.ok && !accepted.includes(response.status)) {
    throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status} ${body?.error?.code ?? "unknown"}: ${body?.error?.message ?? "no message"}`);
  }
  return { response, body };
}

async function operation(initial) {
  const pollUrl = initial.response.headers.get("azure-asyncoperation") ?? initial.response.headers.get("location");
  if (!pollUrl) return initial.body;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(3000);
    const current = await arm(pollUrl);
    const status = current.body?.status ?? current.body?.properties?.provisioningState;
    if (/succeeded/i.test(String(status))) return current.body;
    if (/failed|canceled/i.test(String(status))) throw new Error(`ARM operation ${status}`);
  }
  throw new Error("ARM operation remained ambiguous");
}

async function runCommand(script) {
  const initial = await arm(`${vm}/runCommand?api-version=2024-11-01`, {
    method: "POST",
    body: JSON.stringify({ commandId: "RunPowerShellScript", script: [script] }),
  });
  const resultUrl = initial.response.headers.get("location");
  let result = await operation(initial);
  if (!result?.properties?.output && resultUrl) result = (await arm(resultUrl)).body;
  const output = result?.properties?.output?.value?.find((entry) => /StdOut/i.test(entry.code))?.message?.trim();
  if (!output) throw new Error("ARM Run Command completed without guest output");
  try { return JSON.parse(output); } catch { throw new Error(`Guest output was not JSON: ${output.slice(0, 300)}`); }
}

async function avdState() {
  const [instance, sessionHost, sessions] = await Promise.all([
    arm(`${vm}/instanceView?api-version=2024-11-01`).then(({ body }) => body),
    arm(`${host}?api-version=2024-04-03`).then(({ body }) => body),
    arm(`${host}/userSessions?api-version=2024-04-03`).then(({ body }) => body.value ?? []),
  ]);
  return {
    observedUtc: new Date().toISOString(),
    power: instance.statuses?.find((entry) => entry.code?.startsWith("PowerState/"))?.code,
    hostStatus: sessionHost.properties?.status,
    assignedUser: sessionHost.properties?.assignedUser,
    declaredSessions: sessionHost.properties?.sessions,
    sessions: sessions.map((entry) => ({
      id: entry.id,
      name: entry.name,
      userPrincipalName: entry.properties?.userPrincipalName,
      sessionState: entry.properties?.sessionState,
    })),
  };
}

async function connect(context) {
  let page = await context.newPage();
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  const click = async (candidate, locator) => {
    if (!await locator.isVisible().catch(() => false)) return false;
    await locator.click();
    await candidate.waitForTimeout(800);
    return true;
  };
  let resourceLaunched = false;
  let reconnectCount = 0;
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    for (const candidate of context.pages().filter((entry) => !entry.isClosed())) {
      const text = (await candidate.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
      const login = candidate.locator('input[name="loginfmt"]:visible').first();
      if (await login.isVisible().catch(() => false)) { await login.fill(RACHEL_UPN); await candidate.locator('#idSIButton9,input[type="submit"]').first().click(); await candidate.waitForTimeout(900); continue; }
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
        }
      }
    }
    const state = await avdState();
    const canvases = await page.locator("canvas").count().catch(() => 0);
    if (canvases > 0 && state.sessions.length === 1 && state.sessions[0].userPrincipalName?.toLowerCase() === RACHEL_UPN && state.sessions[0].sessionState === "Active") {
      const canvas = (await page.locator("canvas").evaluateAll((nodes) => nodes.map((node) => ({ rect: node.getBoundingClientRect().toJSON() })))).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
      if (!canvas || canvas.rect.width < 1200 || canvas.rect.height < 700) throw new Error("Remote canvas is not ready");
      return { page, canvas, session: state.sessions[0] };
    }
    if (attempt === 90) throw new Error(`Rachel AVD session did not become ready: ${JSON.stringify(state)}`);
    await page.waitForTimeout(1000);
  }
}

async function makeRequest() {
  const before = await avdState();
  const resuming = MODE === "navigate";
  const exactResumableSession = before.sessions.length === 1 &&
    before.sessions[0].userPrincipalName?.toLowerCase() === RACHEL_UPN;
  if (before.power !== "PowerState/running" || before.hostStatus !== "Available" || before.assignedUser !== RACHEL_UPN ||
      (resuming ? !exactResumableSession : before.sessions.length !== 0)) {
    throw new Error(`Request does not have the exact Rachel endpoint/session boundary: ${JSON.stringify(before)}`);
  }
  const targetUrl = `https://seanewest.github.io/ap2/company-access.html?gsaTlsProof=${encodeURIComponent(RUN_ID)}`;
  const pfxPath = `${runtime}/secrets/cba/users/rachel/certificate.pfx`;
  const passphrase = fs.readFileSync(`${runtime}/secrets/cba/users/rachel/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfxPath, passphrase },
    { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath, passphrase },
  ] });
  context.setDefaultTimeout(2500);
  const startedUtc = new Date().toISOString();
  try {
    const { page, canvas, session } = await connect(context);
    const connectedUtc = new Date().toISOString();
    for (let remaining = PRE_REQUEST_WAIT_MS; remaining > 0; remaining -= Math.min(30000, remaining)) {
      await page.waitForTimeout(Math.min(30000, remaining));
    }
    await page.mouse.click(canvas.rect.x + canvas.rect.width / 2, canvas.rect.y + canvas.rect.height / 2);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.keyboard.press("Meta+R");
    await page.waitForTimeout(1000);
    const command = `\"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\" --new-window \"${targetUrl}\"`;
    await page.keyboard.type(command, { delay: 2 });
    await page.keyboard.press("Enter");
    const requestSentUtc = new Date().toISOString();
    await page.waitForTimeout(15000);
    const process = RUN_ID.includes("-CHAIN-") ? { matches: [] } : await runCommand(String.raw`
$marker='${RUN_ID}'
$matches=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like ('*company-access.html*'+$marker+'*') })
$items=@()
foreach($item in $matches){$owner=Invoke-CimMethod -InputObject $item -MethodName GetOwner;$items += [pscustomobject]@{processId=$item.ProcessId;parentProcessId=$item.ParentProcessId;sessionId=$item.SessionId;owner=($owner.Domain+'\'+$owner.User);commandContainsMarker=([string]$item.CommandLine).Contains($marker)}}
[pscustomobject]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');matches=$items}|ConvertTo-Json -Depth 5 -Compress | Write-Output
`);
    if (!RUN_ID.includes("-CHAIN-") && (process.matches?.length > 1 || (process.matches?.length === 1 && (process.matches[0].owner !== `AzureAD\\${RACHEL_WINDOWS_USER}` || !process.matches[0].commandContainsMarker)))) {
      throw new Error(`The Edge command-line reconciliation was ambiguous: ${JSON.stringify(process)}`);
    }
    const result = {
      runId: RUN_ID,
      startedUtc,
      connectedUtc,
      preRequestWaitMs: PRE_REQUEST_WAIT_MS,
      requestSentUtc,
      observedUtc: new Date().toISOString(),
      targetUrl,
      session,
      edgeCommandLineMarkerVisible: process.matches?.length === 1,
      edge: process.matches?.[0] ?? null,
      nativeProcessEvidenceRequired: RUN_ID.includes("-CHAIN-"),
      backendTrafficLogRequired: true,
    };
    writeProtected("endpoint-request.json", result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function reconcileRequest() {
  const state = await avdState();
  if (state.sessions.length !== 1 || state.sessions[0].userPrincipalName?.toLowerCase() !== RACHEL_UPN) {
    throw new Error(`Accepted request no longer has one exact Rachel session: ${JSON.stringify(state)}`);
  }
  const process = await runCommand(String.raw`
$marker='${RUN_ID}'
$matches=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like ('*company-access.html*'+$marker+'*') })
$items=@()
foreach($item in $matches){$owner=Invoke-CimMethod -InputObject $item -MethodName GetOwner;$items += [pscustomobject]@{processId=$item.ProcessId;parentProcessId=$item.ParentProcessId;sessionId=$item.SessionId;owner=($owner.Domain+'\'+$owner.User);commandContainsMarker=([string]$item.CommandLine).Contains($marker)}}
[pscustomobject]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');matches=$items}|ConvertTo-Json -Depth 5 -Compress | Write-Output
`);
  if (process.matches?.length !== 1 || process.matches[0].owner !== `AzureAD\\${RACHEL_WINDOWS_USER}` || !process.matches[0].commandContainsMarker) {
    throw new Error(`Accepted Edge request did not reconcile exactly: ${JSON.stringify(process)}`);
  }
  const result = {
    runId: RUN_ID,
    reconciledUtc: new Date().toISOString(),
    targetUrl: `https://seanewest.github.io/ap2/company-access.html?gsaTlsProof=${encodeURIComponent(RUN_ID)}`,
    session: state.sessions[0],
    edgeCommandLineMarkerVisible: true,
    edge: process.matches[0],
    acceptedPriorRequest: true,
    backendTrafficLogRequired: true,
  };
  writeProtected("endpoint-request.json", result);
  console.log(JSON.stringify(result, null, 2));
}

async function cleanup() {
  const before = await avdState();
  if (before.sessions.some((entry) => entry.userPrincipalName?.toLowerCase() !== RACHEL_UPN)) throw new Error(`Foreign AVD session appeared: ${JSON.stringify(before.sessions)}`);
  for (const session of before.sessions) await operation(await arm(`${session.id}?api-version=2024-04-03`, { method: "DELETE" }));
  let state;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    state = await avdState();
    if (!state.sessions.length) break;
    await sleep(2500);
  }
  if (state.sessions.length) throw new Error(`Rachel's worker-owned session did not log off: ${JSON.stringify(state)}`);
  const guest = RUN_ID.includes("-CHAIN-") ? { rachelProcessCount: 0, verifiedBySessionLogoff: true } : await runCommand(String.raw`
$matches=@()
foreach($item in @(Get-CimInstance Win32_Process)){$owner=Invoke-CimMethod -InputObject $item -MethodName GetOwner -ErrorAction SilentlyContinue;if($owner.User -eq '${RACHEL_WINDOWS_USER}'){$matches += [pscustomobject]@{name=$item.Name;processId=$item.ProcessId;sessionId=$item.SessionId}}}
[pscustomobject]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');rachelProcessCount=$matches.Count;rachelProcesses=$matches}|ConvertTo-Json -Depth 4 -Compress | Write-Output
`);
  if (guest.rachelProcessCount !== 0) throw new Error(`Rachel processes survived session cleanup: ${JSON.stringify(guest)}`);
  const result = { cleanedUtc: new Date().toISOString(), before, final: state, guest, vmPowerChanged: false };
  writeProtected("endpoint-cleanup.json", result);
  console.log(JSON.stringify(result, null, 2));
}

if (MODE === "request") await makeRequest();
else if (MODE === "navigate") await makeRequest();
else if (MODE === "reconcile") await reconcileRequest();
else if (MODE === "cleanup") await cleanup();
else console.log(JSON.stringify(await avdState(), null, 2));
