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
if (!new Set(["preflight", "stage", "drive", "secondary", "observe", "signins", "cleanup", "baseline-cba-session", "state"]).has(MODE)) throw new Error("mode must be preflight, stage, drive, secondary, observe, signins, cleanup, baseline-cba-session, or state");

const UPN = "rachel.green@corywest.onmicrosoft.com";
const COMPUTER = "ap2fastrachel";
const EXTERNAL_PAGE = `https://seanewest.github.io/ap2/company-access.html?run=${encodeURIComponent(RUN_ID)}`;
const AP2_APP = "https://seanewest.github.io/ap2/";
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
  const external = await fetch(EXTERNAL_PAGE, { redirect: "error" });
  if (!external.ok || !(await external.text()).includes("AP2 COMPANY ACCESS")) throw new Error(`external company-access page unavailable: ${external.status}`);
  const staged = { stagedUtc: new Date().toISOString(), externalPage: EXTERNAL_PAGE, externalPageStatus: external.status };
  save("stage.json", { before, ready, staged }); console.log(JSON.stringify({ before, ready, staged }, null, 2));
}

async function authenticateAp2(context, screenshotPath) {
  const page = await context.newPage();
  const click = async (locator) => { if (await locator.isVisible().catch(() => false)) { await locator.click(); await page.waitForTimeout(700); return true; } return false; };
  let usernameSubmitted = false, certificateSelected = false, signInOptionsOpened = false;
  await page.goto(AP2_APP, { waitUntil: "domcontentloaded", timeout: 90000 });
  const signIn = page.getByRole("button", { name: "Sign in with Microsoft" });
  await signIn.waitFor({ state: "visible", timeout: 60000 });
  await signIn.click();
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const text = (await page.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
    if (attempt > 0 && attempt % 30 === 0) console.log(JSON.stringify({ ap2AuthenticationPending: true, attempt, url: page.url(), text: text.slice(0, 1200) }));
    const username = page.locator('input[name="loginfmt"]:visible').first();
    if (!usernameSubmitted && await username.isVisible().catch(() => false)) { await username.fill(UPN); await page.locator('#idSIButton9,input[type="submit"]').first().click(); usernameSubmitted = true; await page.waitForTimeout(800); continue; }
    const organizationInput = page.locator('input[name="domainName"]:visible,input[placeholder*="domain" i]:visible').first();
    if (await organizationInput.isVisible().catch(() => false)) { await organizationInput.fill("corywest.onmicrosoft.com"); await page.locator('input[type="submit"],button[type="submit"]').first().click(); await page.waitForTimeout(800); continue; }
    if (/pick an account|choose an account/i.test(text) && await click(page.getByText(/use another account|sign in with another account/i).first())) continue;
    if (await click(page.getByText(/sign in to an organization/i).first())) continue;
    if (!certificateSelected && await click(page.getByText(/use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i).first())) { certificateSelected = true; continue; }
    if (!signInOptionsOpened && await click(page.getByText(/sign-in options|sign in another way/i).first())) { signInOptionsOpened = true; continue; }
    if (/stay signed in/i.test(text) && await click(page.locator('#idBtn_Back,button:has-text("No")').first())) continue;
    if (text.includes("Signed in as Rachel Green") && text.includes(UPN)) break;
    if (attempt === 179) throw new Error(`AP2 session did not authenticate as Rachel: ${text.slice(0, 1200)}`);
    await page.waitForTimeout(500);
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  const browserContext = await page.evaluate(() => ({ userAgent: navigator.userAgent, platform: navigator.platform, languages: navigator.languages, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  return { page, browserContext };
}

async function connect(context) {
  let page = await context.newPage();
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  const click = async (candidate, locator) => { if (await locator.isVisible().catch(() => false)) { await locator.click(); await candidate.waitForTimeout(800); return true; } return false; };
  const usernameSubmitted = new WeakSet(), certificateSelected = new WeakSet(), signInOptionsOpened = new WeakSet();
  let active = [], resourceLaunched = false;
  for (let attempt = 1; attempt <= 420; attempt += 1) {
    for (const candidate of context.pages().filter((p) => !p.isClosed())) {
      const text = (await candidate.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
      const login = candidate.locator('input[name="loginfmt"]:visible').first();
      if (!usernameSubmitted.has(candidate) && await login.isVisible().catch(() => false)) { await login.fill(UPN); await candidate.locator('#idSIButton9,input[type="submit"]').first().click(); usernameSubmitted.add(candidate); await candidate.waitForTimeout(900); continue; }
      const organizationInput = candidate.locator('input[name="domainName"]:visible,input[placeholder*="domain" i]:visible').first();
      if (await organizationInput.isVisible().catch(() => false)) { await organizationInput.fill("corywest.onmicrosoft.com"); await candidate.locator('input[type="submit"],button[type="submit"]').first().click(); await candidate.waitForTimeout(900); continue; }
      if (/pick an account|choose an account/i.test(text) && await click(candidate, candidate.getByText(/use another account|sign in with another account/i).first())) continue;
      if (await click(candidate, candidate.getByText(/sign in to an organization/i).first())) continue;
      if (!certificateSelected.has(candidate) && await click(candidate, candidate.getByText(/use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i).first())) { certificateSelected.add(candidate); continue; }
      if (!signInOptionsOpened.has(candidate) && await click(candidate, candidate.getByText(/sign-in options|sign in another way/i).first())) { signInOptionsOpened.add(candidate); continue; }
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
    if (attempt % 60 === 0) {
      const pages = await Promise.all(context.pages().filter((entry) => !entry.isClosed()).map(async (entry) => ({ url: entry.url(), text: (await entry.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim().slice(0, 1200) })));
      await page.screenshot({ path: `${OUTPUT}/connection-${attempt}.png` }).catch(() => {});
      console.log(JSON.stringify({ connectionPending: true, attempt, active, pages }));
    }
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
    const primer = await authenticateAp2(context);
    receipt.controllerSessionPrimedUtc = new Date().toISOString();
    await primer.page.close();
    const { page, canvas, session } = await connect(context); receipt.session = session; receipt.connectedUtc = new Date().toISOString();
    const fullScreen = page.getByRole("button", { name: /enter full screen/i }).first();
    if (await fullScreen.isVisible().catch(() => false)) await fullScreen.click();
    await page.waitForTimeout(800);
    await page.mouse.click(canvas.rect.x + canvas.rect.width * 0.346, canvas.rect.y + canvas.rect.height * 0.973);
    await page.waitForTimeout(700); await page.keyboard.type("run", { delay: 50 }); await page.keyboard.press("Enter"); await page.waitForTimeout(1000);
    await page.keyboard.type(`msedge.exe --inprivate "${EXTERNAL_PAGE}"`, { delay: 2 }); await page.keyboard.press("Enter"); await page.waitForTimeout(10000);
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

async function secondary() {
  const execution = JSON.parse(fs.readFileSync(`${OUTPUT}/execution.json`, "utf8"));
  if (execution.finish !== "external-confirmed") throw new Error("user-endpoint external visit was not confirmed");
  const pfx = `${RUNTIME}/secrets/cba/users/rachel/certificate.pfx`, passphrase = fs.readFileSync(`${RUNTIME}/secrets/cba/users/rachel/pfx-passphrase.txt`, "utf8").trim();
  const hostEgress = await fetch("https://api.ipify.org?format=json").then((response) => response.json());
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    clientCertificates: [
      { origin: "https://certauth.login.microsoftonline.com", pfxPath: pfx, passphrase },
      { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath: pfx, passphrase },
    ],
  });
  context.setDefaultTimeout(3000);
  const startedUtc = new Date().toISOString();
  try {
    const authenticated = await authenticateAp2(context, `${OUTPUT}/secondary-session.png`);
    const { browserContext } = authenticated;
    const result = { runId: RUN_ID, startedUtc, authenticatedUtc: new Date().toISOString(), app: AP2_APP, userPrincipalName: UPN, displayName: "Rachel Green", hostEgressIp: hostEgress.ip, browserContext, screenshot: "secondary-session.png", disposableContextClosed: true };
    save("secondary.json", result); console.log(JSON.stringify(result, null, 2));
  } finally { await context.close().catch(() => {}); await browser.close().catch(() => {}); }
}

async function baselineCbaSession() {
  const before = await avdState();
  const identityBefore = await identitySnapshot();
  if (
    before.power !== "PowerState/deallocated" ||
    before.hostStatus !== "Shutdown" ||
    before.sessions.length !== 0 ||
    before.declaredSessions !== 0 ||
    before.assignedUser !== UPN
  ) throw new Error(`Rachel endpoint not clean for baseline validation: ${JSON.stringify(before)}`);
  await operation(await request(`${vm}/start?api-version=2024-11-01`, {
    method: "POST",
    body: "{}",
  }));
  const ready = await waitReady();
  const pfx = `${RUNTIME}/secrets/cba/users/rachel/certificate.pfx`;
  const passphrase = fs.readFileSync(
    `${RUNTIME}/secrets/cba/users/rachel/pfx-passphrase.txt`,
    "utf8",
  ).trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    clientCertificates: [
      { origin: "https://certauth.login.microsoftonline.com", pfxPath: pfx, passphrase },
      { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath: pfx, passphrase },
    ],
  });
  context.setDefaultTimeout(2500);
  let connected;
  let connectionError;
  try {
    const primer = await authenticateAp2(context);
    await primer.page.close();
    const result = await connect(context);
    connected = {
      connectedUtc: new Date().toISOString(),
      sessionId: result.session.id,
      userPrincipalName: result.session.properties?.userPrincipalName,
      sessionState: result.session.properties?.sessionState,
      canvas: result.canvas.rect,
    };
    if (
      connected.userPrincipalName?.toLowerCase() !== UPN ||
      connected.sessionState !== "Active" ||
      connected.canvas.width < 1200 ||
      connected.canvas.height < 700
    ) throw new Error(`AVD CBA session was not exact: ${JSON.stringify(connected)}`);
  } catch (error) {
    connectionError = error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  let current = await avdState();
  if (current.sessions.some((session) =>
    session.properties?.userPrincipalName?.toLowerCase() !== UPN
  )) throw new Error(`Foreign AVD session appeared: ${JSON.stringify(current.sessions)}`);
  for (const session of current.sessions) {
    await operation(await request(`${session.id}?api-version=2024-04-03`, {
      method: "DELETE",
    }));
  }
  await operation(await request(`${vm}/deallocate?api-version=2024-11-01`, {
    method: "POST",
    body: "{}",
  }));
  let final;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    final = await avdState();
    if (
      final.power === "PowerState/deallocated" &&
      final.hostStatus === "Shutdown" &&
      final.sessions.length === 0 &&
      final.declaredSessions === 0
    ) break;
    await sleep(3000);
  }
  if (
    final.power !== "PowerState/deallocated" ||
    final.hostStatus !== "Shutdown" ||
    final.sessions.length !== 0 ||
    final.declaredSessions !== 0
  ) throw new Error(`Rachel endpoint cleanup did not settle: ${JSON.stringify(final)}`);
  const identityAfter = await identitySnapshot();
  if (
    JSON.stringify(identityBefore.authenticationMethods) !==
    JSON.stringify(identityAfter.authenticationMethods)
  ) throw new Error("Rachel authentication methods changed during AVD validation");
  if (connectionError) throw connectionError;
  const result = {
    runId: RUN_ID,
    observedUtc: new Date().toISOString(),
    before,
    ready,
    connected,
    final,
    authenticationMethodsUnchanged: true,
  };
  save("baseline-cba-session.json", result);
  console.log(JSON.stringify(result, null, 2));
}

async function observe() {
  const execution = JSON.parse(fs.readFileSync(`${OUTPUT}/execution.json`, "utf8"));
  const secondary = JSON.parse(fs.readFileSync(`${OUTPUT}/secondary.json`, "utf8"));
  const guest = await runCommand(String.raw`$run='${RUN_ID}';$edges=@();foreach($p in @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -notmatch ' --type='})){try{$o=Invoke-CimMethod -InputObject $p -MethodName GetOwner;$edges+=[ordered]@{processId=$p.ProcessId;parentProcessId=$p.ParentProcessId;sessionId=$p.SessionId;owner=($o.Domain+'\'+$o.User);commandLine=[string]$p.CommandLine;externalMarker=([string]$p.CommandLine -like ('*'+$run+'*'))}}catch{}};$explorer=@(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'"|Select-Object ProcessId,SessionId);$dns=@(Resolve-DnsName seanewest.github.io -Type A -ErrorAction Stop|Select-Object Name,IPAddress);$egress=(Invoke-RestMethod 'https://api.ipify.org?format=json' -TimeoutSec 20).ip;$gsa=@(Get-Service -Name 'GlobalSecureAccess*','MicrosoftEntraPrivateAccess*' -ErrorAction SilentlyContinue|Select-Object Name,Status);[ordered]@{observedUtc=(Get-Date).ToUniversalTime().ToString('o');edge=$edges;explorer=$explorer;dns=$dns;endpointEgressIp=$egress;externalUrl='${EXTERNAL_PAGE}';gsaServices=$gsa;quser=(quser.exe 2>&1|Out-String)}|ConvertTo-Json -Depth 8 -Compress`);
  const edges = Array.isArray(guest.local?.edge) ? guest.local.edge : guest.local?.edge ? [guest.local.edge] : [];
  const visuals = fs.readdirSync(OUTPUT).filter((name) => /^drive-\d+\.png$/.test(name)).sort();
  const externalVisual = visuals.at(-1);
  if (execution.finish !== "external-confirmed" || !edges.some((p) => /RachelGreen/i.test(p.owner) && p.externalMarker) || !externalVisual || secondary.userPrincipalName !== UPN || !fs.existsSync(`${OUTPUT}/secondary-session.png`) || guest.local?.endpointEgressIp === secondary.hostEgressIp) throw new Error(`distinct provenance proof not exact: ${JSON.stringify({ guest: guest.local, secondary, externalVisual })}`);
  const identityAfter = await identitySnapshot();
  const userId = identityAfter.user.id;
  const start = encodeURIComponent(new Date(Date.parse(execution.startedUtc) - 60000).toISOString());
  const signIns = await graph(`/beta/auditLogs/signIns?$filter=userId%20eq%20'${userId}'%20and%20createdDateTime%20ge%20${start}&$orderby=createdDateTime%20desc&$top=50`);
  const bounded = (signIns.value || []).map((s) => ({ createdDateTime: s.createdDateTime, appDisplayName: s.appDisplayName, resourceDisplayName: s.resourceDisplayName, clientAppUsed: s.clientAppUsed, ipAddress: s.ipAddress, deviceDetail: s.deviceDetail, status: s.status, conditionalAccessStatus: s.conditionalAccessStatus, isInteractive: s.isInteractive, authenticationRequirement: s.authenticationRequirement, authenticationDetails: (s.authenticationDetails || []).map((d) => ({ authenticationMethod: d.authenticationMethod, authenticationStepResultDetail: d.authenticationStepResultDetail, succeeded: d.succeeded })) }));
  const defenderToken = (await credential.getToken("https://api.securitycenter.microsoft.com/.default")).token;
  const machines = await request("https://api.securitycenter.microsoft.com/api/machines", {}, defenderToken).then((v) => v.body.value || []);
  const machine = machines.find((m) => String(m.computerDnsName).toLowerCase() === COMPUTER);
  if (!machine) throw new Error("Rachel MDE machine absent");
  const alerts = await request(`https://api.securitycenter.microsoft.com/api/machines/${machine.id}/alerts`, {}, defenderToken).then((v) => (v.body.value || []).filter((a) => Date.parse(a.alertCreationTime || a.firstEventTime || 0) >= Date.parse(execution.startedUtc) - 60000).map((a) => ({ id: a.id, title: a.title, alertCreationTime: a.alertCreationTime, severity: a.severity, status: a.status, detectionSource: a.detectionSource })));
  const result = { observedUtc: new Date().toISOString(), execution, externalVisual, guest: guest.local, secondary, distinctEgress: true, identityAfter, signIns: bounded, defender: { machineId: machine.id, onboardingStatus: machine.onboardingStatus, healthStatus: machine.healthStatus, lastSeen: machine.lastSeen, alerts } };
  save("observation.json", result); console.log(JSON.stringify(result, null, 2));
}

async function signins() {
  const execution = JSON.parse(fs.readFileSync(`${OUTPUT}/execution.json`, "utf8"));
  const identity = await identitySnapshot();
  const start = encodeURIComponent(new Date(Date.parse(execution.startedUtc) - 60000).toISOString());
  const response = await graph(`/beta/auditLogs/signIns?$filter=userId%20eq%20'${identity.user.id}'%20and%20createdDateTime%20ge%20${start}&$orderby=createdDateTime%20desc&$top=50`);
  const result = { observedUtc: new Date().toISOString(), signIns: (response.value || []).map((s) => ({ createdDateTime: s.createdDateTime, appDisplayName: s.appDisplayName, resourceDisplayName: s.resourceDisplayName, clientAppUsed: s.clientAppUsed, ipAddress: s.ipAddress, deviceDetail: s.deviceDetail, status: s.status, conditionalAccessStatus: s.conditionalAccessStatus, isInteractive: s.isInteractive, authenticationRequirement: s.authenticationRequirement, authenticationDetails: (s.authenticationDetails || []).map((d) => ({ authenticationMethod: d.authenticationMethod, authenticationStepResultDetail: d.authenticationStepResultDetail, succeeded: d.succeeded })) })) };
  save("signins-final.json", result); console.log(JSON.stringify(result, null, 2));
}

async function cleanup() {
  let before = await avdState();
  if (before.sessions.some((s) => s.properties?.userPrincipalName?.toLowerCase() !== UPN)) throw new Error(`foreign session appeared: ${JSON.stringify(before.sessions)}`);
  const guest = await runCommand(String.raw`$run='${RUN_ID}';Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -like ('*'+$run+'*')}|ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue};Start-Sleep 2;[ordered]@{cleanedUtc=(Get-Date).ToUniversalTime().ToString('o');markedEdgeCount=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -like ('*'+$run+'*')}).Count}|ConvertTo-Json -Compress`);
  if (guest.local?.markedEdgeCount !== 0) throw new Error(`guest cleanup failed: ${JSON.stringify(guest.local)}`);
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
else if (MODE === "secondary") await secondary();
else if (MODE === "observe") await observe();
else if (MODE === "signins") await signins();
else if (MODE === "cleanup") await cleanup();
else if (MODE === "baseline-cba-session") await baselineCbaSession();
else console.log(JSON.stringify(await avdState(), null, 2));
