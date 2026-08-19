import crypto from "node:crypto";
import fs from "node:fs";

// Fixed commands from the Kobe proof. This runner deliberately types into the
// interactive guest's Run dialog; it never transfers a client clipboard value.
const BRANCHES = Object.freeze({
  A: "powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand VwByAGkAdABlAC0ASABvAHMAdAAgACcASABlAGwAbABvACAAVwBvAHIAbABkACcA",
  B: 'powershell.exe -w 1 -c "$f=\\"$HOME\\Desktop\\CLICKFIX-SIMULATION.txt\\";Set-Content $f \'SIMULATION ONLY\';Resolve-DnsName example.com;notepad $f"',
});

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function commandReceipt(branch) {
  const command = BRANCHES[branch];
  if (!command) throw new Error("AP2_BRANCH must be A or B");
  const receipt = {
    branch,
    command,
    sha256: crypto.createHash("sha256").update(command).digest("hex").toUpperCase(),
  };
  if (branch === "A") {
    const encoded = command.split(" -EncodedCommand ")[1];
    const bytes = Buffer.from(encoded, "base64");
    receipt.encodedBytes = bytes.length;
    receipt.validUtf16LeLength = bytes.length % 2 === 0;
    receipt.decodedUtf16Le = bytes.toString("utf16le");
    receipt.decodedMatchesExpected = receipt.decodedUtf16Le === "Write-Host 'Hello World'";
    if (!receipt.validUtf16LeLength || !receipt.decodedMatchesExpected) throw new Error("Branch A encoding is not the approved UTF-16LE source");
  }
  return receipt;
}

async function dismissWindowsAppOnboarding(page) {
  for (let index = 0; index < 10; index += 1) {
    const button = page.getByText(/^(Next|Done|Finish|Get started|Continue|Close|Skip|Not now)$/i, { exact: true }).last();
    if (!(await button.isVisible().catch(() => false))) break;
    await button.evaluate((element) => element.click());
    await page.waitForTimeout(1200);
  }
}

async function openKobeDesktop(context, tenantId, upn) {
  const page = await context.newPage();
  await page.goto("https://client.wvd.microsoft.com/arm/webclient/index.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator('input[name="loginfmt"]').fill(upn);
  await page.locator('input[type="submit"]').click();
  const no = page.getByRole("button", { name: "No", exact: true });
  if (await no.waitFor({ state: "visible", timeout: 60_000 }).then(() => true).catch(() => false)) await no.click();
  await page.waitForURL((url) => url.hostname === "windows.cloud.microsoft", { timeout: 90_000 });
  await page.waitForTimeout(8000);
  await dismissWindowsAppOnboarding(page);
  const devices = page.getByText("Devices", { exact: true });
  if (await devices.isVisible({ timeout: 10_000 }).catch(() => false)) await devices.click();
  const resource = page.getByText("SessionDesktop", { exact: true });
  await resource.waitFor({ state: "visible", timeout: 45_000 });
  const sessionPromise = context.waitForEvent("page");
  await resource.click();
  const session = await sessionPromise;
  await session.waitForLoadState("domcontentloaded");
  await session.getByRole("button", { name: "Connect", exact: true }).click();
  for (let attempt = 0; attempt < 300; attempt += 1) {
    for (const candidate of context.pages().filter((entry) => !entry.isClosed())) {
      const text = (await candidate.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").trim();
      const login = candidate.locator('input[name="loginfmt"]:visible').first();
      if (await login.isVisible().catch(() => false)) {
        await login.fill(upn);
        await candidate.locator('#idSIButton9,input[type="submit"]').first().click();
        await candidate.waitForTimeout(900);
        continue;
      }
      const choices = [
        candidate.getByText(/use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i).first(),
        candidate.getByText(/sign-in options|sign in another way/i).first(),
      ];
      let handled = false;
      for (const choice of choices) if (await choice.isVisible().catch(() => false)) { await choice.click(); handled = true; break; }
      if (handled) continue;
      if (/stay signed in/i.test(text)) {
        const no = candidate.locator('#idBtn_Back,button:has-text("No")').first();
        if (await no.isVisible().catch(() => false)) { await no.click(); continue; }
      }
      const actions = [
        [/allow remote desktop connection/i, candidate.getByRole("button", { name: /^yes$/i }).first()],
        [/in session settings|choose what to use in your remote session/i, candidate.getByRole("button", { name: /^connect$/i }).first()],
        [/sign in to your session|authenticate to the session|grant permission to connect/i, candidate.getByRole("button", { name: /sign in/i }).first()],
      ];
      for (const [pattern, button] of actions) if (pattern.test(text) && await button.isVisible().catch(() => false)) { await button.click(); break; }
    }
    const largest = await session.locator("canvas").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()).sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]);
    if (largest?.width >= 1200 && largest?.height >= 700) return session;
    await session.waitForTimeout(1000);
  }
  throw new Error("Expected Kobe remote canvas was absent after bounded authentication polling");
}

async function run() {
  const playwrightModule = "playwright";
  const { chromium } = await import(playwrightModule);
  const branch = required("AP2_BRANCH").toUpperCase();
  const receipt = commandReceipt(branch);
  const output = required("AP2_OUTPUT_DIR");
  const acceptSignal = required("AP2_ACCEPT_SIGNAL");
  const prepareSignal = required("AP2_PREPARE_SIGNAL");
  const pfx = fs.readFileSync(required("AP2_KOBE_PFX"));
  const passphrase = fs.readFileSync(required("AP2_KOBE_PFX_PASSPHRASE"), "utf8").trim();
  const guardPath = `${output}/branch-${branch.toLowerCase()}-accept.json`;
  if (fs.existsSync(guardPath)) throw new Error("One-cycle guard exists; inspect instead of replaying");
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${output}/branch-${branch.toLowerCase()}-command.json`, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

  const tenantId = required("AP2_TENANT_ID");
  const upn = required("AP2_KOBE_UPN");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    clientCertificates: [
      { origin: "https://certauth.login.microsoftonline.com", pfx, passphrase },
      { origin: `https://t${tenantId}.certauth.login.microsoftonline.com`, pfx, passphrase },
    ],
  });
  try {
    const session = await openKobeDesktop(context, tenantId, upn);
    const canvases = await session.locator("canvas").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    const canvas = canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    if (!canvas || canvas.width < 1200 || canvas.height < 700) throw new Error("Expected Kobe remote canvas was absent");
    fs.writeFileSync(`${output}/session-ready`, `${new Date().toISOString()}\n`, { mode: 0o600, flag: "wx" });
    for (let index = 0; index < 1200 && !fs.existsSync(prepareSignal); index += 1) await session.waitForTimeout(500);
    if (!fs.existsSync(prepareSignal)) throw new Error("Preparation signal was not supplied; Run dialog was not opened");
    await session.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await session.keyboard.press("Meta+R");
    await session.waitForTimeout(1200);
    await session.keyboard.type(receipt.command, { delay: 2 });
    await session.screenshot({ path: `${output}/branch-${branch.toLowerCase()}-typed.png` });

    // A separate exact readback/visual review creates this signal. No key or
    // click is sent while it is absent, so an ambiguous verifier cannot execute.
    for (let index = 0; index < 1200 && !fs.existsSync(acceptSignal); index += 1) await session.waitForTimeout(500);
    if (!fs.existsSync(acceptSignal)) throw new Error("Acceptance signal was not supplied; command remains unaccepted");
    const guard = { branch, commandSha256: receipt.sha256, preparedUtc: new Date().toISOString(), enterCount: 0, clipboardUsed: false };
    fs.writeFileSync(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await session.screenshot({ path: `${output}/branch-${branch.toLowerCase()}-pre-enter.png` });
    await session.keyboard.press("Enter");
    guard.enterCount = 1;
    guard.enteredUtc = new Date().toISOString();
    fs.writeFileSync(guardPath, `${JSON.stringify(guard, null, 2)}\n`, { mode: 0o600 });
    await session.waitForTimeout(15_000);
    await session.screenshot({ path: `${output}/branch-${branch.toLowerCase()}-post-enter.png` });
    process.stdout.write(`${JSON.stringify(guard, null, 2)}\n`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}

export { BRANCHES, commandReceipt };
