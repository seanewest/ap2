import { generateKeyPairSync, sign } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, type JWK } from "jose";
import { expect, test } from "@playwright/test";
import { defaultCallerPolicy } from "../api/auth-policy";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity";
import { InMemoryOperationTelemetryCollector } from "../api/operation-telemetry-collector";
import { InMemoryScenarioPlanService } from "../api/scenario-plan";
import { createApiServer } from "../api/server";
import { JoseTokenVerifier } from "../api/token-verifier";
import { SCENARIO_MANIFESTS } from "../src/scenarios/scenarios";

const ISSUER = "https://fixture.invalid/operator/v2.0";
const AUDIENCE = "api://ap2-local-fixture";
const KEY_ID = "local-fixture-key";
const NOW = 2_000_000_000;
const APP_ORIGIN = "http://127.0.0.1:5173";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: KEY_ID,
  alg: "RS256",
  use: "sig",
} as JWK;

let apiServer: Server;
let apiBaseUrl: string;
let accessToken: string;

test.beforeAll(async () => {
  const collector = new InMemoryOperationTelemetryCollector();
  collector.record({
    schemaVersion: 1,
    markerHash: "m1_0123456789abcdef01234567",
    operationKind: "calendar.create",
    phase: "execution",
    outcome: "succeeded",
    durationMs: 18,
    reason: "none",
    ambiguityState: "none",
    recoveryState: "not-needed",
    upstreamStatus: 201,
  });
  collector.record({
    schemaVersion: 1,
    markerHash: "m1_89abcdef0123456701234567",
    operationKind: "calendar.cancel",
    phase: "recovery",
    outcome: "ambiguous",
    durationMs: 1_250,
    reason: "upstream-unavailable",
    ambiguityState: "possible-mutation",
    recoveryState: "unresolved",
    upstreamStatus: 503,
  });
  apiServer = createApiServer({
    tokenVerifier: new JoseTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keyResolver: createLocalJWKSet({ keys: [publicJwk] }),
      now: () => NOW,
    }),
    callerPolicy: defaultCallerPolicy,
    rehearsalStatusProvider: {
      getStatus: () => {
        throw new Error("Not used by this fixture.");
      },
    },
    operationTelemetryReader: collector,
    scenarioPlanService: new InMemoryScenarioPlanService(),
    allowedOrigin: APP_ORIGIN,
  });
  await new Promise<void>((resolve) =>
    apiServer.listen(0, "127.0.0.1", resolve)
  );
  const address = apiServer.address() as AddressInfo;
  apiBaseUrl = `http://127.0.0.1:${address.port}`;
  accessToken = fixtureToken({
    tid: STUDENT_TENANT_ID,
    oid: STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
    scp: REQUIRED_DELEGATED_SCOPE,
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    apiServer.close((error) => error ? reject(error) : resolve())
  );
});

test("manually loads sanitized recent operations through the local product path", async ({
  page,
}) => {
  await page.addInitScript(
    ({ apiBaseUrl, accessToken }) => {
      Object.defineProperty(window, "__AP2_LOCAL_OPERATOR__", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: { apiBaseUrl, accessToken },
      });
    },
    { apiBaseUrl, accessToken },
  );
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let readRequests = 0;
  await page.route("**/api/operation-events?order=newest", async (route) => {
    readRequests += 1;
    await requestGate;
    await route.continue();
  });

  await page.goto("/e2e/recent-operations.html");
  await expect(page.getByText("Signed in as Fixture Operator")).toBeVisible();
  const panel = page.getByRole("region", { name: "Recent operations" });
  const refresh = panel.getByRole("button", {
    name: "Refresh recent operations",
  });
  await expect(panel.getByText("Select Refresh")).toBeVisible();
  expect(readRequests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    candidate.url() === `${apiBaseUrl}/api/operation-events?order=newest`
  );
  await refresh.click();
  await expect(panel.getByText("Loading recent operations…")).toBeVisible();
  await expect(refresh).toBeDisabled();
  releaseRequest();
  expect((await response).status()).toBe(200);

  await expect(panel.getByText("Calendar cancel")).toBeVisible();
  await expect(panel.getByText("Ambiguous")).toBeVisible();
  await expect(panel.getByText("Upstream Unavailable")).toBeVisible();
  await expect(panel.getByText("Possible Mutation")).toBeVisible();
  await expect(panel.getByText("1.3 seconds")).toBeVisible();
  await expect(panel.getByText("503")).toBeVisible();
  await expect(panel).not.toContainText("m1_");
  await expect(panel).not.toContainText(accessToken);
  await expect(panel).toContainText("disappear when it restarts");
  await page.waitForTimeout(100);
  expect(readRequests).toBe(1);
});

test("navigates the read-only scenario catalog without network activity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  let apiRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests += 1;
    }
  });

  await page.goto("/e2e/recent-operations.html");
  await expect(page.getByText("Signed in as Fixture Operator")).toBeVisible();
  const catalog = page.getByRole("region", { name: "Scenario catalog" });
  await expect(catalog).toBeVisible();
  await expect(catalog.locator(".scenario-catalog-card")).toHaveCount(
    SCENARIO_MANIFESTS.length,
  );
  await expect(catalog.getByText("Purview audit boundary")).toBeVisible();
  await expect(catalog.getByText(
    "Private three-VM AVD lab substrate",
  )).toBeVisible();
  const planLinks = catalog.getByRole("button", {
    name: /Use .+ in plan preview/,
  });
  await expect(planLinks).toHaveCount(SCENARIO_MANIFESTS.length);
  await expect(catalog.locator(
    "a, form, input, select, textarea, [data-action]",
  )).toHaveCount(0);
  apiRequests = 0;

  const firstDetails = catalog.locator("details").first();
  const firstSummary = firstDetails.locator("summary");
  await firstSummary.focus();
  await expect(firstSummary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(firstDetails).toHaveAttribute("open", "");
  await expect(firstDetails.getByText("Role separation")).toBeVisible();

  await firstSummary.focus();
  await page.keyboard.press("Tab");
  await expect(planLinks.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(catalog.locator("summary").nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(planLinks.nth(1)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(catalog.locator("summary").nth(1)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(planLinks.nth(0)).toBeFocused();

  await planLinks.nth(2).press("Enter");
  const preview = page.getByRole("region", {
    name: "Scenario plan preview",
  });
  const scenario = preview.getByLabel("Canonical scenario");
  await expect(scenario).toBeFocused();
  await expect(scenario).toHaveValue("2");
  await expect(preview.getByText(
    /Selected Private three-VM AVD lab substrate, registry version 2/,
  )).toBeVisible();
  await expect(preview.getByLabel("Maximum budget (USD)")).toHaveValue("10");
  await expect(preview.getByLabel(/Expiry window/)).toHaveValue("5");
  await expect(preview.getByText("No preview requested")).toHaveCount(0);
  await planLinks.nth(3).click();
  await expect(scenario).toHaveValue("3");
  await planLinks.nth(2).click();
  await expect(scenario).toHaveValue("2");
  await planLinks.nth(2).click();
  await expect(scenario).toBeFocused();
  await expect(scenario).toHaveValue("2");
  await page.waitForTimeout(100);
  expect(apiRequests).toBe(0);
  expect(
    await planLinks.nth(2).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);
});

test("keeps the catalog descriptive when the API session is unauthorized", async ({
  page,
}) => {
  await configureOperator(page, "invalid-fixture-token");
  await page.goto("/e2e/recent-operations.html");
  const catalog = page.getByRole("region", { name: "Scenario catalog" });
  await expect(catalog).toBeVisible();

  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/whoami"
  );
  await page.getByRole("button", { name: "Check API access" }).click();
  expect((await response).status()).toBe(401);
  await expect(page.getByText(
    "API access needs Microsoft authorization. Try again.",
  )).toBeVisible();
  await expect(catalog).toBeVisible();
  await expect(catalog.locator(".scenario-catalog-card")).toHaveCount(
    SCENARIO_MANIFESTS.length,
  );
  await expect(catalog.locator("[data-action]")).toHaveCount(0);
});

test("previews one deterministic plan per manual signed-operator request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await configureOperator(page, accessToken);
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const planRequests: string[] = [];
  await page.route("**/api/scenario-plan", async (route) => {
    planRequests.push(route.request().postData() ?? "");
    await requestGate;
    await route.continue();
  });
  await page.goto("/e2e/recent-operations.html");
  await page.getByRole("button", {
    name: "Use Kobe help-desk email for Cory in plan preview",
  }).click();
  const preview = page.getByRole("region", {
    name: "Scenario plan preview",
  });
  const button = preview.getByRole("button", { name: "Preview plan" });
  await expect(preview.getByText(
    /Selected Kobe help-desk email for Cory, registry version 2/,
  )).toBeVisible();
  expect(planRequests).toHaveLength(0);

  const firstResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/scenario-plan"
  );
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    preview.getByText("Preparing the deterministic preview…"),
  ).toBeVisible();
  await expect(button).toBeDisabled();
  expect(planRequests).toHaveLength(1);
  releaseRequest();
  expect((await firstResponse).status()).toBe(200);

  await expect(preview.getByText("Deterministic preview")).toBeVisible();
  await expect(preview.getByText("Ordered phases and ownership")).toBeVisible();
  await expect(preview.getByRole("heading", {
    name: "Terminal verification",
    exact: true,
  })).toBeVisible();
  await expect(preview.getByText("Categorical limitations")).toBeVisible();
  await expect(preview.getByText("Plan digest")).toBeVisible();
  await expect(preview).not.toContainText("teams-missed-call-observation");
  await expect(preview).not.toContainText("step-");
  await expect(preview).not.toContainText("ap2-");
  expect(planRequests[0]).not.toMatch(
    /@|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}|\/home\/|token|credential/i,
  );

  const secondResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/scenario-plan"
  );
  await button.click();
  expect((await secondResponse).status()).toBe(200);
  expect(planRequests).toHaveLength(2);
  await preview.locator("input[name='alias-learner']").fill("learner-two");
  await expect(preview.getByText("No preview requested")).toBeVisible();
  await expect(preview.getByText("Deterministic preview")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);
  expect(planRequests.map((body) => JSON.parse(body).scenarioId)).toEqual([
    SCENARIO_MANIFESTS[1].id,
    SCENARIO_MANIFESTS[1].id,
  ]);
});

test("refuses unsafe preview input locally without an API request", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let planRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/scenario-plan") {
      planRequests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const preview = page.getByRole("region", {
    name: "Scenario plan preview",
  });
  const button = preview.getByRole("button", { name: "Preview plan" });
  await preview.getByLabel("Canonical scenario").selectOption({
    label: "Private three-VM AVD lab substrate",
  });
  await preview.getByLabel("Maximum budget (USD)").fill("9");
  await button.click();
  await expect(preview.getByText(/must cover the catalog maximum/)).toBeVisible();

  await preview.getByLabel("Maximum budget (USD)").fill("10");
  await preview.getByLabel(/Expiry window/).fill("0");
  await button.click();
  await expect(preview.getByText(/Expiry must be greater than zero/)).toBeVisible();

  await preview.getByLabel(/Expiry window/).fill("1");
  await preview.getByLabel("Optional response").evaluate((select) => {
    const option = document.createElement("option");
    option.value = "999";
    option.textContent = "Tampered response";
    select.append(option);
    (select as HTMLSelectElement).value = "999";
  });
  await button.click();
  await expect(preview.getByText(/response is not supported/)).toBeVisible();

  await preview.getByLabel("Optional response").selectOption("");
  await preview.locator("input[name='alias-learner']").fill(
    "learner@example.invalid",
  );
  await button.click();
  await expect(preview.getByText(/raw identifiers are not accepted/)).toBeVisible();
  await preview.locator("input[name='alias-learner']").fill("session-token");
  await button.click();
  await expect(preview.getByText(
    /credential, token, session, and other raw-identifier terms/,
  )).toBeVisible();
  expect(planRequests).toBe(0);
});

test("maps authenticated preview refusals to fixed safe states", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let responseKind: "compiler" | "oversized" | "general" = "compiler";
  await page.route("**/api/scenario-plan", async (route) => {
    if (responseKind === "compiler") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "scenario_plan_refused",
          category: "EXPIRY_INVALID",
        }),
      });
      return;
    }
    await route.fulfill({
      status: responseKind === "oversized" ? 413 : 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "raw private upstream body" }),
    });
  });
  await page.goto("/e2e/recent-operations.html");
  const preview = page.getByRole("region", {
    name: "Scenario plan preview",
  });
  const button = preview.getByRole("button", { name: "Preview plan" });

  await button.click();
  await expect(preview.getByText(/planner refused/)).toBeVisible();
  responseKind = "oversized";
  await button.click();
  await expect(preview.getByText(/safe preview limit/)).toBeVisible();
  responseKind = "general";
  await button.click();
  await expect(preview.getByText(/preview is unavailable/)).toBeVisible();
  await expect(preview).not.toContainText("raw private upstream body");
});

test("distinguishes an expired session from a forbidden operator", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "session expired"],
    [
      fixtureToken({
        tid: STUDENT_TENANT_ID,
        oid: "fixture-unapproved-operator",
        scp: REQUIRED_DELEGATED_SCOPE,
      }),
      403,
      "not authorized",
    ],
  ] as const;
  for (const [token, status, message] of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await configureOperator(page, token);
    await page.goto(`${APP_ORIGIN}/e2e/recent-operations.html`);
    const preview = page.getByRole("region", {
      name: "Scenario plan preview",
    });
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/scenario-plan"
    );
    await preview.getByRole("button", { name: "Preview plan" }).click();
    expect((await response).status()).toBe(status);
    await expect(preview.getByText(new RegExp(message))).toBeVisible();
    await context.close();
  }
});

async function configureOperator(
  page: import("@playwright/test").Page,
  token: string,
): Promise<void> {
  await page.addInitScript(
    ({ apiBaseUrl, accessToken }) => {
      Object.defineProperty(window, "__AP2_LOCAL_OPERATOR__", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: { apiBaseUrl, accessToken },
      });
    },
    { apiBaseUrl, accessToken: token },
  );
}

function fixtureToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    kid: KEY_ID,
    typ: "JWT",
  })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    iat: NOW - 60,
    nbf: NOW - 60,
    exp: NOW + 300,
    ...claims,
  })).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
