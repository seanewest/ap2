import fs from "node:fs";
import path from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import { chromium } from "playwright";
import { resolveAp2RuntimeRoot } from "./ap2-runtime-root.mjs";

// Use one fresh AP2_RUN_ID across inspect, register, observe, and cleanup.
// Register refuses any existing Homer FIDO2 method; cleanup accepts only the
// one exact run marker and deletes it through Homer's own Security info page.
const TENANT_ID = "92563293-315c-4b6c-9b90-bcb47ee8c970";
const HOMER = Object.freeze({
  objectId: "6e54e3a9-7651-4520-a331-047550ae6fca",
  userPrincipalName: "homer.simpson@corywest.onmicrosoft.com",
});
const RUN_ID = process.env.AP2_RUN_ID?.trim();
if (!RUN_ID || !/^AP2-HOMER-AUTH-[0-9]{8}T[0-9]{6}Z$/.test(RUN_ID)) {
  throw new Error("AP2_RUN_ID must be AP2-HOMER-AUTH-YYYYMMDDTHHMMSSZ");
}
const mode = process.argv[2];
if (!new Set(["inspect", "register", "observe", "cleanup"]).has(mode)) {
  throw new Error("mode must be inspect, register, observe, or cleanup");
}
// The Microsoft registration UI enforces a 30-character display-name limit.
const METHOD_NAME = RUN_ID.slice(0, 30);

const runtimeRoot = resolveAp2RuntimeRoot();
const output = path.join(runtimeRoot, "runs", RUN_ID);
const pfxPath = path.join(
  runtimeRoot,
  "secrets/cba/users/homer/certificate.pfx",
);
const pfxPassphrase = fs
  .readFileSync(
    path.join(runtimeRoot, "secrets/cba/users/homer/pfx-passphrase.txt"),
    "utf8",
  )
  .trim();
const devConfig = JSON.parse(
  fs.readFileSync(
    path.join(runtimeRoot, "secrets/dev-graph/config.json"),
    "utf8",
  ),
);
if (devConfig.tenantId !== TENANT_ID) {
  throw new Error("Dev credential is not bound to the Student tenant");
}
fs.mkdirSync(output, { recursive: true, mode: 0o700 });

const credential = new ClientCertificateCredential(
  devConfig.tenantId,
  devConfig.clientId,
  {
    certificatePath: path.join(
      runtimeRoot,
      "secrets/dev-graph/credential.pem",
    ),
  },
);
const graphToken = (
  await credential.getToken("https://graph.microsoft.com/.default")
).token;

async function graph(pathname) {
  const response = await fetch(`https://graph.microsoft.com${pathname}`, {
    headers: { Authorization: `Bearer ${graphToken}` },
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      `Graph read failed: ${response.status} ${body?.error?.code ?? "unknown"}`,
    );
  }
  return body;
}

function writeJson(name, value) {
  fs.writeFileSync(
    path.join(output, name),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}

const policy = await graph(
  "/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2",
);
const methods = await graph(
  `/v1.0/users/${HOMER.objectId}/authentication/methods`,
);
const preflight = {
  observedUtc: new Date().toISOString(),
  homer: HOMER,
  policy: {
    state: policy.state,
    isSelfServiceRegistrationAllowed: policy.isSelfServiceRegistrationAllowed,
    isAttestationEnforced: policy.isAttestationEnforced,
    keyRestrictions: policy.keyRestrictions,
    includeTargets: policy.includeTargets,
    excludeTargets: policy.excludeTargets,
  },
  methods: methods.value.map((method) => ({
    id: method.id,
    type: method["@odata.type"],
    displayName: method.displayName,
    model: method.model,
    createdDateTime: method.createdDateTime,
  })),
};
const fidoMethods = methods.value.filter(
  (method) =>
    method["@odata.type"] === "#microsoft.graph.fido2AuthenticationMethod",
);
if (
  ((mode === "inspect" || mode === "register") &&
    (policy.state !== "enabled" ||
      policy.isSelfServiceRegistrationAllowed !== true ||
      policy.isAttestationEnforced !== false ||
      !policy.includeTargets?.some((target) => target.id === "all_users") ||
      fidoMethods.length !== 0)) ||
  (mode === "cleanup" &&
    (fidoMethods.length !== 1 || fidoMethods[0].displayName !== METHOD_NAME))
) {
  throw new Error(`Unsafe or changed preflight: ${JSON.stringify(preflight)}`);
}
writeJson("preflight.json", preflight);

async function observeEvidence() {
  const runTimestamp = RUN_ID.match(/([0-9]{8}T[0-9]{6}Z)$/)?.[1];
  const runStart = runTimestamp
    ? `${runTimestamp.slice(0, 4)}-${runTimestamp.slice(4, 6)}-${runTimestamp.slice(6, 8)}T${runTimestamp.slice(9, 11)}:${runTimestamp.slice(11, 13)}:${runTimestamp.slice(13, 15)}Z`
    : undefined;
  const [currentMethods, registration, targetedAudits, recentAudits] =
    await Promise.all([
      graph(`/v1.0/users/${HOMER.objectId}/authentication/methods`),
      graph(
        `/v1.0/reports/authenticationMethods/userRegistrationDetails/${HOMER.objectId}`,
      ),
      graph(
        `/v1.0/auditLogs/directoryAudits?$filter=targetResources/any(t:t/id%20eq%20%27${HOMER.objectId}%27)&$orderby=activityDateTime%20desc&$top=30`,
      ),
      graph(
        `/v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%20${encodeURIComponent(runStart)}&$orderby=activityDateTime%20desc&$top=100`,
      ),
    ]);
  const audits = [...targetedAudits.value, ...recentAudits.value].filter(
    (audit, index, values) =>
      values.findIndex((candidate) => candidate.id === audit.id) === index,
  );
  const authenticationMethodAudits = audits.filter(
    (audit) =>
      /security info|passkey|authentication method|fido/i.test(
        `${audit.activityDisplayName} ${audit.resultReason}`,
      ) &&
      (audit.initiatedBy?.user?.id === HOMER.objectId ||
        audit.targetResources?.some((target) => target.id === HOMER.objectId)),
  );
  const auditTimes = authenticationMethodAudits.map((audit) =>
    Date.parse(audit.activityDateTime),
  );
  const fallbackStart = Date.parse(runStart) - 2 * 60_000;
  const evidenceWindowStart = auditTimes.length
    ? Math.min(...auditTimes) - 2 * 60_000
    : fallbackStart;
  const evidenceWindowEnd = auditTimes.length
    ? Math.max(...auditTimes) + 2 * 60_000
    : Date.now();
  const signIns = await graph(
    `/beta/auditLogs/signIns?$filter=userId%20eq%20%27${HOMER.objectId}%27%20and%20createdDateTime%20ge%20${encodeURIComponent(new Date(evidenceWindowStart).toISOString())}%20and%20createdDateTime%20le%20${encodeURIComponent(new Date(evidenceWindowEnd).toISOString())}&$orderby=createdDateTime%20desc&$top=200`,
  );
  const signInsInWindow = signIns.value.filter((signIn) => {
    const timestamp = Date.parse(signIn.createdDateTime);
    return timestamp >= evidenceWindowStart && timestamp <= evidenceWindowEnd;
  });
  const x509SignIns = signInsInWindow.filter((signIn) =>
    signIn.authenticationDetails?.some((detail) =>
      /X\.509 Certificate/i.test(detail.authenticationMethod),
    ),
  );
  const accountControlSignIns = signInsInWindow.filter(
    (signIn) =>
      /Microsoft Account Controls/i.test(signIn.appDisplayName) &&
      signIn.status?.errorCode === 0,
  );
  const firstAuditTime = Math.min(...auditTimes);
  const lastAuditTime = Math.max(...auditTimes);
  const registrationX509 = x509SignIns.find(
    (signIn) => Date.parse(signIn.createdDateTime) <= firstAuditTime,
  );
  const cleanupX509 = x509SignIns.find(
    (signIn) => Date.parse(signIn.createdDateTime) <= lastAuditTime,
  );
  const registrationAccountControl = accountControlSignIns
    .filter((signIn) => Date.parse(signIn.createdDateTime) >= firstAuditTime)
    .at(-1);
  const selectedSignIns = [
    registrationX509,
    registrationAccountControl,
    cleanupX509,
    accountControlSignIns[0],
  ].filter(
    (signIn, index, values) =>
      signIn &&
      values.findIndex((candidate) => candidate?.id === signIn.id) === index,
  );
  return {
    observedUtc: new Date().toISOString(),
    methods: currentMethods.value.map((method) => ({
      id: method.id,
      type: method["@odata.type"],
      displayName: method.displayName,
      model: method.model,
      createdDateTime: method.createdDateTime,
    })),
    registration: {
      isMfaRegistered: registration.isMfaRegistered,
      isMfaCapable: registration.isMfaCapable,
      isPasswordlessCapable: registration.isPasswordlessCapable,
      isSsprRegistered: registration.isSsprRegistered,
      methodsRegistered: registration.methodsRegistered,
      lastUpdatedDateTime: registration.lastUpdatedDateTime,
    },
    authenticationMethodAudits: authenticationMethodAudits.map((audit) => ({
      id: audit.id,
      activityDateTime: audit.activityDateTime,
      activityDisplayName: audit.activityDisplayName,
      result: audit.result,
      resultReason: audit.resultReason,
      loggedByService: audit.loggedByService,
      correlationId: audit.correlationId,
      initiatedBy: audit.initiatedBy?.user
        ? {
            id: audit.initiatedBy.user.id,
            userPrincipalName: audit.initiatedBy.user.userPrincipalName,
          }
        : undefined,
    })),
    signIns: selectedSignIns.map((signIn) => ({
      id: signIn.id,
      createdDateTime: signIn.createdDateTime,
      appDisplayName: signIn.appDisplayName,
      resourceDisplayName: signIn.resourceDisplayName,
      isInteractive: signIn.isInteractive,
      status: signIn.status,
      authenticationRequirement: signIn.authenticationRequirement,
      authenticationDetails: signIn.authenticationDetails?.map((detail) => ({
        authenticationMethod: detail.authenticationMethod,
        authenticationMethodDetail: detail.authenticationMethodDetail,
        succeeded: detail.succeeded,
        authenticationStepDateTime: detail.authenticationStepDateTime,
        authenticationStepResultDetail: detail.authenticationStepResultDetail,
      })),
      conditionalAccessStatus: signIn.conditionalAccessStatus,
      correlationId: signIn.correlationId,
    })),
  };
}

if (mode === "observe") {
  const evidence = await observeEvidence();
  writeJson("evidence.json", evidence);
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  clientCertificates: [
    {
      origin: "https://certauth.login.microsoftonline.com",
      pfxPath,
      passphrase: pfxPassphrase,
    },
    {
      origin: `https://t${TENANT_ID}.certauth.login.microsoftonline.com`,
      pfxPath,
      passphrase: pfxPassphrase,
    },
  ],
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const authenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "usb",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});

async function clickIfVisible(locator) {
  if (await locator.isVisible().catch(() => false)) {
    await locator.click();
    await page.waitForTimeout(700);
    return true;
  }
  return false;
}

try {
  await page.goto("https://mysignins.microsoft.com/security-info", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const text = (await page.locator("body").innerText().catch(() => ""))
      .replaceAll(/\s+/g, " ")
      .trim();
    const username = page.locator('input[name="loginfmt"]:visible').first();
    if (await username.isVisible().catch(() => false)) {
      await username.fill(HOMER.userPrincipalName);
      await page.locator('#idSIButton9,input[type="submit"]').first().click();
      await page.waitForTimeout(800);
      continue;
    }
    if (
      await clickIfVisible(
        page
          .getByText(
            /use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i,
          )
          .first(),
      )
    ) {
      continue;
    }
    if (
      await clickIfVisible(
        page.getByText(/sign-in options|sign in another way/i).first(),
      )
    ) {
      continue;
    }
    if (
      /stay signed in/i.test(text) &&
      (await clickIfVisible(
        page.locator('#idBtn_Back,button:has-text("No")').first(),
      ))
    ) {
      continue;
    }
    if (/security info/i.test(text) && /add sign-in method/i.test(text)) {
      break;
    }
    if (attempt === 179) {
      throw new Error(`Security info did not load: ${text.slice(0, 1000)}`);
    }
    await page.waitForTimeout(500);
  }

  if (mode === "cleanup") {
    const beforeText = (await page.locator("body").innerText())
      .replaceAll(/\s+/g, " ")
      .trim();
    if (!beforeText.includes(METHOD_NAME)) {
      throw new Error("Exact marked passkey is not visible for Homer cleanup");
    }
    await page.locator('button[aria-label="Delete Passkey"]:visible').click();
    await page.waitForTimeout(500);
    const confirm = page
      .locator("button:visible")
      .filter({ hasText: /^Delete$/ })
      .last();
    await confirm.click();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const text = await page.locator("body").innerText().catch(() => "");
      if (!text.includes(METHOD_NAME)) break;
      if (attempt === 59) {
        throw new Error("Marked passkey remained visible after user deletion");
      }
      await page.waitForTimeout(500);
    }
    let remaining;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      remaining = await graph(
        `/v1.0/users/${HOMER.objectId}/authentication/methods`,
      );
      if (
        !remaining.value.some(
          (method) =>
            method["@odata.type"] ===
            "#microsoft.graph.fido2AuthenticationMethod",
        )
      ) {
        break;
      }
      if (attempt === 29) {
        throw new Error("Marked passkey deletion did not reach Graph inventory");
      }
      await page.waitForTimeout(1_000);
    }
    const cleanup = {
      completedUtc: new Date().toISOString(),
      actor: HOMER,
      removedDisplayName: METHOD_NAME,
      remainingMethods: remaining.value.map((method) => ({
        id: method.id,
        type: method["@odata.type"],
        displayName: method.displayName,
      })),
    };
    writeJson("cleanup.json", cleanup);
    console.log(JSON.stringify(cleanup, null, 2));
  } else {
    await page.getByText(/add sign-in method/i).first().click();
    await page.waitForTimeout(1_000);
    await page.getByText("Passkey", { exact: true }).click();
    await page.waitForTimeout(1_000);
    if (mode === "register") {
      await page.getByRole("button", { name: "Next", exact: true }).click();
      for (let attempt = 0; attempt < 240; attempt += 1) {
        const credentials = await cdp.send("WebAuthn.getCredentials", {
          authenticatorId: authenticator.authenticatorId,
        });
        const text = (await page.locator("body").innerText().catch(() => ""))
          .replaceAll(/\s+/g, " ")
          .trim();
        const username = page.locator('input[name="loginfmt"]:visible').first();
        if (await username.isVisible().catch(() => false)) {
          await username.fill(HOMER.userPrincipalName);
          await page.locator('#idSIButton9,input[type="submit"]').first().click();
          await page.waitForTimeout(800);
          continue;
        }
        if (
          await clickIfVisible(
            page
              .getByText(
                /use (?:a )?certificate or smart card|sign in with (?:a )?certificate|certificate-based authentication/i,
              )
              .first(),
          )
        ) {
          continue;
        }
        if (
          await clickIfVisible(
            page.getByText(/sign-in options|sign in another way/i).first(),
          )
        ) {
          continue;
        }
        if (
          /stay signed in/i.test(text) &&
          (await clickIfVisible(
            page.locator('#idBtn_Back,button:has-text("No")').first(),
          ))
        ) {
          continue;
        }
        const nameInput = page.locator('input[type="text"]:visible').last();
        if (
          credentials.credentials.length === 1 &&
          (await nameInput.isEditable().catch(() => false))
        ) {
          await nameInput.fill(METHOD_NAME);
          const done = page.getByRole("button", { name: /^(Done|Next)$/i }).last();
          await done.click();
          await page.waitForTimeout(1_000);
          continue;
        }
        if (
          credentials.credentials.length === 1 &&
          /security info/i.test(text) &&
          text.includes(METHOD_NAME)
        ) {
          break;
        }
        if (attempt === 239) {
          writeJson("register-debug.json", {
            observedUtc: new Date().toISOString(),
            url: page.url(),
            visibleText: text.slice(0, 8_000),
            credentialCount: credentials.credentials.length,
            buttons: await page.getByRole("button").allTextContents(),
          });
          await page.screenshot({ path: path.join(output, "register-debug.png") });
          throw new Error(`Passkey registration did not complete: ${text.slice(0, 1000)}`);
        }
        await page.waitForTimeout(500);
      }
    }
  }
  const visibleText = (await page.locator("body").innerText())
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);
  const buttons = await page
    .getByRole("button")
    .allTextContents()
    .then((values) => values.map((value) => value.trim()).filter(Boolean));
  const options = await page
    .getByRole("option")
    .allTextContents()
    .then((values) => values.map((value) => value.trim()).filter(Boolean));
  const credentials = await cdp.send("WebAuthn.getCredentials", {
    authenticatorId: authenticator.authenticatorId,
  });
  const result = {
    observedUtc: new Date().toISOString(),
    url: new URL(page.url()).origin + new URL(page.url()).pathname,
    visibleText,
    buttons,
    options,
    virtualAuthenticatorCredentialCount: credentials.credentials.length,
  };
  writeJson("browser-inspect.json", result);
  await page.screenshot({ path: path.join(output, "browser-inspect.png") });
  console.log(JSON.stringify(result, null, 2));
  if (mode === "register") {
    const evidence = await observeEvidence();
    writeJson("evidence.json", evidence);
  }
} finally {
  await cdp
    .send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: authenticator.authenticatorId,
    })
    .catch(() => undefined);
  await context.close();
  await browser.close();
}
