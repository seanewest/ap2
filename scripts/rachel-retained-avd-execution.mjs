import fs from "node:fs";
import { ClientCertificateCredential } from "@azure/identity";
import { chromium } from "playwright";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

const MODE = process.argv[2];
const RUN_ID = process.env.AP2_RUN_ID?.trim();
const UPN = "rachel.green@corywest.onmicrosoft.com";
const TARGET_URL = process.env.AP2_TARGET_URL?.trim() ??
  `https://seanewest.github.io/ap2/company-access.html?retainedAvdRun=${encodeURIComponent(RUN_ID ?? "")}`;

if (!new Set(["run", "state", "cleanup"]).has(MODE)) {
  throw new Error("mode must be run, state, or cleanup");
}
if (MODE !== "state" && !/^AP2-RACHEL-AVD-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID ?? "")) {
  throw new Error("AP2_RUN_ID must be AP2-RACHEL-AVD-YYYYMMDDTHHMMSSZ");
}
const target = new URL(TARGET_URL);
if (MODE === "run" && (target.protocol !== "https:" || target.hostname !== "seanewest.github.io" || !target.pathname.startsWith("/ap2/"))) {
  throw new Error("AP2_TARGET_URL must be an HTTPS URL under seanewest.github.io/ap2/");
}
if (MODE === "run" && !TARGET_URL.includes(RUN_ID)) throw new Error("AP2_TARGET_URL must contain AP2_RUN_ID");

const runtime = resolveAp2RuntimeRoot();
const output = RUN_ID ? `${runtime}/runs/${RUN_ID}` : null;
const config = JSON.parse(fs.readFileSync(`${runtime}/secrets/dev-graph/config.json`, "utf8"));
const credential = new ClientCertificateCredential(config.tenantId, config.clientId, {
  certificatePath: `${runtime}/secrets/dev-graph/credential.pem`,
});
const armToken = (await credential.getToken("https://management.azure.com/.default"))?.token;
if (!armToken) throw new Error("Protected credential could not obtain an ARM token");
const graphToken = (await credential.getToken("https://graph.microsoft.com/.default"))?.token;
if (!graphToken) throw new Error("Protected credential could not obtain a Graph token");
const subscription = `/subscriptions/${config.subscriptionId}`;
const vm = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.Compute/virtualMachines/ap2fastrachel-vm`;
const host = `${subscription}/resourceGroups/rg-ap2-avd-fast-rachel/providers/Microsoft.DesktopVirtualization/hostPools/ap2fastrachel-hp/sessionHosts/ap2fastrachel`;
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
  try { body = text ? JSON.parse(text) : null; } catch { body = { text: text.slice(0, 800) }; }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${pathname} -> ${response.status}: ${body?.error?.message ?? "no message"}`);
  return { response, body };
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

async function waitForState(predicate, label, attempts = 120) {
  let state;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    state = await avdState();
    if (predicate(state)) return state;
    await sleep(3000);
  }
  throw new Error(`${label} did not reconcile: ${JSON.stringify(state)}`);
}

async function ensureHostReady() {
  const before = await avdState();
  if (before.assignedUser?.toLowerCase() !== UPN || before.sessions.length !== 0) {
    throw new Error(`Rachel retained endpoint is outside the safe start boundary: ${JSON.stringify(before)}`);
  }
  if (!new Set(["PowerState/deallocated", "PowerState/running", "PowerState/starting"]).has(before.power)) {
    throw new Error(`Rachel retained VM has an unreconciled power transition: ${JSON.stringify(before)}`);
  }
  if (before.power === "PowerState/deallocated") {
    // VM start can remain InProgress after the instance and AVD agent are
    // already ready. Submit it once, then reconcile the observable states.
    await arm(`${vm}/start?api-version=2024-11-01`, { method: "POST", body: "{}" });
  }
  const controlPlane = await waitForState(
    (state) => state.power === "PowerState/running" && state.hostStatus === "Available" && state.sessions.length === 0,
    "Rachel AVD control-plane readiness",
  );
  return { before, controlPlane };
}

async function connect(context, onSessionObserved) {
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
    await locator.click();
    return true;
  };
  let resourceLaunched = false;
  let latestState;
  for (let attempt = 1; attempt <= 240; attempt += 1) {
    for (const candidate of context.pages().filter((entry) => !entry.isClosed())) {
      const text = (await candidate.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
      const login = candidate.locator('input[name="loginfmt"]:visible').first();
      if (await login.isVisible().catch(() => false) && once(candidate, "username")) {
        await login.fill(UPN); await candidate.locator('#idSIButton9,input[type="submit"]').first().click(); continue;
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
      if (/in session settings|choose what to use in your remote session/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^connect$/i }).first())) continue;
      if (/sign in to your session|credentials|authenticate to the session|grant permission to connect to your resource/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /sign in/i }).first())) continue;
      if (/allow remote desktop connection/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^yes$/i }).first())) continue;
      if (/disconnected/i.test(text) && await click(candidate, candidate.getByRole("button", { name: /^reconnect$/i }).first())) continue;
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
    latestState = await avdState();
    if (latestState.sessions.length === 1 && latestState.sessions[0].userPrincipalName?.toLowerCase() === UPN) {
      onSessionObserved(latestState.sessions[0]);
    }
    const exactSession = latestState.sessions.length === 1 && latestState.sessions[0].userPrincipalName?.toLowerCase() === UPN && latestState.sessions[0].sessionState === "Active";
    const canvas = (await page.locator("canvas").evaluateAll((nodes) => nodes.map((node) => ({ rect: node.getBoundingClientRect().toJSON() }))).catch(() => []))
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0];
    if (exactSession && canvas?.rect.width >= 1200 && canvas?.rect.height >= 700) return { page, canvas, session: latestState.sessions[0] };
    if (attempt % 30 === 0) {
      const pages = await Promise.all(context.pages().filter((entry) => !entry.isClosed()).map(async (entry) => ({
        url: entry.url(),
        text: (await entry.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim().slice(0, 800),
      })));
      console.log(JSON.stringify({ sessionEstablishmentPending: true, attempt, state: latestState, pages }));
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Rachel interactive session did not reconcile: ${JSON.stringify(latestState)}`);
}

async function launchBenignAction(page, canvas) {
  await page.mouse.click(canvas.rect.x + canvas.rect.width / 2, canvas.rect.y + canvas.rect.height / 2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+R");
  const command = `\"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\" --new-window \"${TARGET_URL}\"`;
  await page.keyboard.type(command, { delay: 2 });
  const launchedUtc = new Date().toISOString();
  await page.keyboard.press("Enter");
  return { launchedUtc, targetUrl: TARGET_URL, marker: RUN_ID, remoteKeyboardEnterCount: 1 };
}

async function observeAction(action) {
  const expectedUrl = `${target.origin}${target.pathname}`;
  const filter = encodeURIComponent(`userPrincipalName eq '${UPN}' and createdDateTime ge ${action.launchedUtc} and destinationFQDN eq '${target.hostname}'`);
  let latest = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`https://graph.microsoft.com/beta/networkAccess/logs/traffic?$filter=${filter}&$orderby=createdDateTime%20desc&$top=100`, {
      headers: { Authorization: `Bearer ${graphToken}`, Prefer: "include-unknown-enum-members" },
    });
    if (!response.ok) throw new Error(`GSA traffic observation failed: ${response.status}`);
    latest = (await response.json()).value ?? [];
    const exact = latest.find((entry) =>
      entry.userPrincipalName?.toLowerCase() === UPN && entry.destinationUrl === expectedUrl &&
      entry.initiatingProcessName === "msedge.exe" && entry.httpMethod?.toLowerCase() === "get" &&
      entry.responseCode === 200 && entry.action === "allow" && entry.operationStatus === "success"
    );
    if (exact) return {
      observedUtc: new Date().toISOString(),
      transactionId: exact.transactionId,
      createdDateTime: exact.createdDateTime,
      userPrincipalName: exact.userPrincipalName,
      deviceId: exact.deviceId,
      destinationUrl: exact.destinationUrl,
      initiatingProcessName: exact.initiatingProcessName,
      httpMethod: exact.httpMethod,
      responseCode: exact.responseCode,
      action: exact.action,
      operationStatus: exact.operationStatus,
      tls: { action: exact.tlsDetails?.action, status: exact.tlsDetails?.status },
    };
    await sleep(10000);
  }
  throw new Error(`Rachel action traffic did not propagate; latest matching-user rows: ${latest.length}`);
}

async function cleanup(ownedSession, ownedSessionObservedUtc) {
  const before = await avdState();
  if (before.sessions.some((entry) => entry.userPrincipalName?.toLowerCase() !== UPN)) {
    throw new Error(`A foreign AVD session prevents cleanup: ${JSON.stringify(before.sessions)}`);
  }
  const placeholderAge = Date.now() - Date.parse(ownedSessionObservedUtc ?? "");
  const pendingPlaceholder = ownedSession?.sessionState === "Pending" && ownedSession.id?.endsWith("/-1") &&
    Number.isFinite(placeholderAge) && placeholderAge >= 0 && placeholderAge <= 15 * 60 * 1000;
  const reconciledPlaceholder = pendingPlaceholder && before.sessions.length === 1;
  if (before.sessions.length && (!ownedSession || (!reconciledPlaceholder && before.sessions.some((entry) => entry.id !== ownedSession.id)))) {
    throw new Error(`Rachel session is not owned by this run: ${JSON.stringify(before.sessions)}`);
  }
  // Logoff can outpace its ARM operation receipt. Submit each exact session
  // once and reconcile zero sessions rather than replaying an ambiguous delete.
  for (const session of before.sessions) await arm(`${session.id}?api-version=2024-04-03`, { method: "DELETE" });
  const final = await waitForState((state) => state.sessions.length === 0 && state.declaredSessions === 0, "Rachel session cleanup", 40);
  const result = { cleanedUtc: new Date().toISOString(), before, final, vmPowerChanged: false };
  save("cleanup.json", result);
  return result;
}

async function execute() {
  const readiness = await ensureHostReady();
  save("host-ready.json", readiness);
  const pfxPath = `${runtime}/secrets/cba/users/rachel/certificate.pfx`;
  const passphrase = fs.readFileSync(`${runtime}/secrets/cba/users/rachel/pfx-passphrase.txt`, "utf8").trim();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfxPath, passphrase },
    { origin: `https://t${config.tenantId}.certauth.login.microsoftonline.com`, pfxPath, passphrase },
  ] });
  context.setDefaultTimeout(2500);
  let result;
  let action;
  let ownedSession;
  let ownedSessionObservedUtc;
  try {
    const connected = await connect(context, (session) => {
      const placeholderTransition = ownedSession?.sessionState === "Pending" && ownedSession.id?.endsWith("/-1") && session.sessionState === "Active";
      if (ownedSession && ownedSession.id !== session.id && !placeholderTransition) throw new Error("Rachel session identity changed during establishment");
      if (!ownedSession || placeholderTransition) {
        ownedSession = session;
        ownedSessionObservedUtc = new Date().toISOString();
        save("owned-session.json", { runId: RUN_ID, observedUtc: ownedSessionObservedUtc, session });
      }
    });
    const guest = {
      observedUtc: new Date().toISOString(),
      hostStatus: "Available",
      remoteCanvas: connected.canvas.rect,
      exactActiveRachelSession: true,
    };
    action = await launchBenignAction(connected.page, connected.canvas);
    result = { runId: RUN_ID, readyUtc: new Date().toISOString(), session: connected.session, guest, action };
    save("execution.json", result);
    result.observation = await observeAction(action);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    const cleaned = await cleanup(ownedSession, ownedSessionObservedUtc);
    if (result) result.cleanup = cleaned;
  }
  save("execution.json", result);
  return result;
}

let result;
if (MODE === "run") result = await execute();
else if (MODE === "cleanup") {
  const receiptPath = `${output}/owned-session.json`;
  if (!fs.existsSync(receiptPath)) throw new Error("This run has no protected owned-session receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.runId !== RUN_ID || !receipt.session?.id) throw new Error("Owned-session receipt is invalid");
  result = await cleanup(receipt.session, receipt.observedUtc);
} else result = await avdState();
console.log(JSON.stringify(result, null, 2));
