import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const KOBE_USER = "kobe@corywest.onmicrosoft.com";
const MY_APPS_URL = `https://myapps.microsoft.com/signin/AP2%20YouTrack%20SAML%20%2B%20SCIM%20%28staged%29/873e0f87-b451-49d5-9ac6-17c0c4e2a532?tenantId=${TENANT_ID}`;
const ISSUE_URL = "https://ap2-tester123.youtrack.cloud/issue/DEMO-13";
const ISSUES_URL = "https://ap2-tester123.youtrack.cloud/issues";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Arguments must be --name value pairs");
    values.set(key.slice(2), value);
  }
  for (const key of ["mode", "run-id", "out"]) {
    if (!values.get(key)) throw new Error(`--${key} is required`);
  }
  const mode = values.get("mode");
  if (!new Set(["run", "cleanup"]).has(mode)) throw new Error("--mode must be run or cleanup");
  if (mode === "run") {
    for (const key of ["pfx", "passphrase-file"]) {
      if (!values.get(key)) throw new Error(`--${key} is required in run mode`);
    }
  }
  const runId = values.get("run-id");
  if (!/^AP2-KOBE-COLLECT-YT-[A-Z0-9]{8,32}$/.test(runId)) throw new Error("Invalid W52 run ID");
  return { mode, runId, pfxPath: values.get("pfx"), passphrasePath: values.get("passphrase-file"), out: values.get("out") };
}

const { mode, runId, pfxPath, passphrasePath, out } = parseArgs(process.argv.slice(2));
if (mode === "cleanup") {
  const receiptPath = path.join(out, "boundary.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (receipt.runId !== runId || receipt.uploadAttempted !== false || receipt.permissionChangeAttempted !== false) {
    throw new Error("Refusing browser-output cleanup: exact no-egress receipt mismatch");
  }
  const expected = new Set([
    "boundary.json",
    "youtrack-authenticated.png",
    "youtrack-demo-13-boundary.png",
    "youtrack-issues-boundary.png",
  ]);
  const present = fs.readdirSync(out);
  const unexpected = present.filter((name) => !expected.has(name));
  if (unexpected.length !== 0) throw new Error(`Refusing browser-output cleanup with unexpected files: ${unexpected.join(", ")}`);
  for (const name of present) fs.unlinkSync(path.join(out, name));
  fs.rmdirSync(out);
  console.log(JSON.stringify({ runId, outputDirectoryAbsent: !fs.existsSync(out) }));
  process.exit(0);
}
fs.mkdirSync(out, { recursive: false, mode: 0o700 });
const pfx = fs.readFileSync(pfxPath);
const passphrase = fs.readFileSync(passphrasePath, "utf8").trim();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  clientCertificates: [
    { origin: "https://certauth.login.microsoftonline.com", pfx, passphrase },
    { origin: `https://t${TENANT_ID}.certauth.login.microsoftonline.com`, pfx, passphrase },
  ],
});

function writeJson(name, value) {
  fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function screenshot(page, name) {
  const target = path.join(out, name);
  await page.screenshot({ path: target });
  fs.chmodSync(target, 0o600);
}

async function navigateRemoteEdge(sessionPage, url, screenshotName) {
  await sessionPage.keyboard.press("Control+L");
  await sessionPage.keyboard.type(url, { delay: 1 });
  await sessionPage.keyboard.press("Enter");
  await sessionPage.waitForTimeout(18_000);
  await screenshot(sessionPage, screenshotName);
}

const page = await context.newPage();
try {
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  const login = page.locator('input[name="loginfmt"]');
  await login.waitFor({ state: "visible", timeout: 60_000 });
  await login.fill(KOBE_USER);
  await page.locator('input[type="submit"]').click();
  const no = page.getByRole("button", { name: "No", exact: true });
  if (await no.waitFor({ state: "visible", timeout: 60_000 }).then(() => true).catch(() => false)) await no.click();
  await page.waitForURL((url) => url.hostname === "windows.cloud.microsoft", { timeout: 90_000 });
  await page.waitForTimeout(8_000);
  for (let index = 0; index < 10; index += 1) {
    const next = page.getByText(/^(Next|Done|Finish|Get started|Continue|Close|Skip|Not now)$/i, { exact: true }).last();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.evaluate((element) => element.click());
    await page.waitForTimeout(1200);
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
  const target = canvases.sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height))[0];
  await sessionPage.mouse.click(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);

  await sessionPage.keyboard.press("Meta+R");
  await sessionPage.waitForTimeout(1500);
  await sessionPage.keyboard.type(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\ProgramData\\AP2\\CollectionEgress\\${runId}\\collect.ps1"`, { delay: 2 });
  await sessionPage.keyboard.press("Enter");
  await sessionPage.waitForTimeout(18_000);

  await sessionPage.keyboard.press("Meta+R");
  await sessionPage.waitForTimeout(1500);
  await sessionPage.keyboard.type(`msedge.exe --new-window "${MY_APPS_URL}"`, { delay: 1 });
  await sessionPage.keyboard.press("Enter");
  await sessionPage.waitForTimeout(35_000);
  await screenshot(sessionPage, "youtrack-authenticated.png");
  await navigateRemoteEdge(sessionPage, ISSUE_URL, "youtrack-demo-13-boundary.png");
  await navigateRemoteEdge(sessionPage, ISSUES_URL, "youtrack-issues-boundary.png");

  writeJson("boundary.json", {
    runId,
    authenticatedAvdUser: KOBE_USER,
    navigation: ["staged YouTrack SAML My Apps path", ISSUE_URL, ISSUES_URL],
    expectedArchivedBoundary: "Kobe is signed in, but DEMO-13 is inaccessible and /issues denies permission",
    reviewRequired: "Confirm the three screenshots show the same boundary before cleanup; do not continue to an attachment control",
    uploadAttempted: false,
    permissionChangeAttempted: false,
  });
  console.log(JSON.stringify({ runId, boundaryReceipt: path.join(out, "boundary.json"), uploadAttempted: false, permissionChangeAttempted: false }));
} finally {
  await Promise.race([context.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
  await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
}
