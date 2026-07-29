import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { createLocalJWKSet, type JWK } from "jose";
import { expect, test } from "@playwright/test";
import { defaultCallerPolicy } from "../api/auth-policy";
import {
  REQUIRED_DELEGATED_SCOPE,
  STUDENT_PRODUCT_OPERATOR_OBJECT_ID,
  STUDENT_TENANT_ID,
} from "../api/identity";
import { InMemoryOperationTelemetryCollector } from "../api/operation-telemetry-collector";
import {
  InMemoryMultiScenarioFeasibilityService,
} from "../api/multi-scenario-feasibility";
import {
  InMemoryScenarioEvidenceVerificationService,
} from "../api/scenario-evidence-verification";
import {
  InMemoryRehearsalOutputVerificationService,
} from "../api/rehearsal-output-verification";
import {
  InMemoryPrivateDocumentRehearsalVerificationService,
} from "../api/private-document-rehearsal-verification";
import {
  InMemoryHelpDeskEmailRehearsalVerificationService,
} from "../api/help-desk-email-rehearsal-verification";
import {
  InMemoryTeamsMissedCallRehearsalVerificationService,
} from "../api/teams-missed-call-rehearsal-verification";
import { InMemoryScenarioPlanService } from "../api/scenario-plan";
import { createApiServer } from "../api/server";
import { JoseTokenVerifier } from "../api/token-verifier";
import { SCENARIO_MANIFESTS } from "../src/scenarios/scenarios";
import {
  CANONICAL_RECEIPT_FIXTURES,
  NEGATIVE_RECEIPT_FIXTURES,
} from "../src/scenarios/scenario-evidence-receipt.fixtures";
import {
  canonicalAvdThreeVmRehearsalOutput,
} from "../scripts/verify-avd-three-vm-rehearsal-output";
import {
  parsePrivateDocumentRehearsalVerificationRequest,
} from "../src/api/private-document-rehearsal-verification-contract";
import {
  parseHelpDeskEmailRehearsalVerificationRequest,
} from "../src/api/help-desk-email-rehearsal-verification-contract";
import {
  parseTeamsMissedCallRehearsalVerificationRequest,
} from "../src/api/teams-missed-call-rehearsal-verification-contract";

const ISSUER = "https://fixture.invalid/operator/v2.0";
const AUDIENCE = "api://ap2-local-fixture";
const KEY_ID = "local-fixture-key";
const NOW = 2_000_000_000;
const APP_ORIGIN = "http://127.0.0.1:5173";
const PRIVATE_DOCUMENT_REHEARSAL_OUTPUT =
  parsePrivateDocumentRehearsalVerificationRequest(JSON.parse(readFileSync(
    resolve("scripts/fixtures/private-document-rehearsal-output-learner.json"),
    "utf8",
  )) as unknown);
const HELP_DESK_REHEARSAL_OUTPUT =
  parseHelpDeskEmailRehearsalVerificationRequest(JSON.parse(readFileSync(
    resolve("scripts/fixtures/help-desk-email-rehearsal-output-cleaned.json"),
    "utf8",
  )) as unknown);
const TEAMS_REHEARSAL_OUTPUT =
  parseTeamsMissedCallRehearsalVerificationRequest(JSON.parse(readFileSync(
    resolve(
      "scripts/fixtures/teams-missed-call-rehearsal-output-native-cleaned.json",
    ),
    "utf8",
  )) as unknown);
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
    multiScenarioFeasibilityService:
      new InMemoryMultiScenarioFeasibilityService(),
    scenarioPlanService: new InMemoryScenarioPlanService(),
    scenarioEvidenceVerificationService:
      new InMemoryScenarioEvidenceVerificationService(),
    rehearsalOutputVerificationService:
      new InMemoryRehearsalOutputVerificationService(),
    privateDocumentRehearsalVerificationService:
      new InMemoryPrivateDocumentRehearsalVerificationService(),
    helpDeskEmailRehearsalVerificationService:
      new InMemoryHelpDeskEmailRehearsalVerificationService(),
    teamsMissedCallRehearsalVerificationService:
      new InMemoryTeamsMissedCallRehearsalVerificationService(),
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

test("audits every manual-only operator panel at the shared accessibility boundary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  const manualApiPaths = new Set([
    "/api/operation-events",
    "/api/scenario-plan",
    "/api/multi-scenario-feasibility",
    "/api/scenario-evidence-verification",
    "/api/rehearsal-output-verification",
    "/api/private-document-rehearsal-verification",
    "/api/help-desk-email-rehearsal-verification",
    "/api/teams-missed-call-rehearsal-verification",
  ]);
  let manualRequests = 0;
  page.on("request", (request) => {
    if (manualApiPaths.has(new URL(request.url()).pathname)) {
      manualRequests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");

  const panels = [
    "Recent operations",
    "Scenario catalog",
    "Scenario plan preview",
    "Scenario batch feasibility",
    "Receipt verification",
    "AVD rehearsal verification",
    "Private-document rehearsal verification",
    "Help-desk email rehearsal verification",
    "Teams missed-call rehearsal verification",
  ];
  for (const name of panels) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  expect(manualRequests).toBe(0);
  const refreshOperations = page.getByRole("region", {
    name: "Recent operations",
  }).getByRole("button", { name: "Refresh recent operations" });
  await expect(refreshOperations).toBeVisible();

  const formPanels = [
    ["Scenario plan preview", "Preview plan"],
    ["Scenario batch feasibility", "Evaluate feasibility"],
    ["Receipt verification", "Verify receipt"],
    ["AVD rehearsal verification", "Verify rehearsal output"],
    [
      "Private-document rehearsal verification",
      "Verify private-document rehearsal",
    ],
    [
      "Help-desk email rehearsal verification",
      "Verify help-desk rehearsal",
    ],
    [
      "Teams missed-call rehearsal verification",
      "Verify Teams rehearsal",
    ],
  ] as const;
  for (const [panelName, actionName] of formPanels) {
    const panel = page.getByRole("region", { name: panelName });
    const action = panel.getByRole("button", { name: actionName });
    await expect(action).toBeVisible();
    expect(await panel.locator("[aria-live='polite']").count()).toBeGreaterThan(
      0,
    );
    expect(
      await panel.locator("form").evaluate((form) => {
        const actionElement = form.querySelector("button[type='submit']");
        const firstControl = form.querySelector("input, select, textarea");
        return Boolean(
          actionElement &&
            firstControl &&
            (
              firstControl.compareDocumentPosition(actionElement) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        );
      }),
    ).toBe(true);
    expect(
      await action.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.animationDuration, style.transitionDuration];
      }),
    ).toEqual(["0s", "0s"]);
  }
  for (
    const panelName of [
      "Receipt verification",
      "AVD rehearsal verification",
      "Private-document rehearsal verification",
      "Help-desk email rehearsal verification",
    ]
  ) {
    const input = page.getByRole("region", { name: panelName }).locator(
      "textarea",
    );
    const descriptionId = await input.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    await expect(page.locator(`#${descriptionId}`)).not.toBeEmpty();
  }

  const catalogAction = page.getByRole("region", {
    name: "Scenario catalog",
  }).getByRole("button", { name: /Use .* in plan preview/ }).first();
  expect(await catalogAction.getAttribute("aria-describedby")).toBeTruthy();
  for (const action of [refreshOperations, catalogAction]) {
    expect(
      await action.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.animationDuration, style.transitionDuration];
      }),
    ).toEqual(["0s", "0s"]);
  }
  await catalogAction.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Scenario plan preview" })
      .getByLabel("Canonical scenario"),
  ).toBeFocused();
  expect(manualRequests).toBe(0);

  for (const [panelName, actionName] of formPanels.slice(2)) {
    const panel = page.getByRole("region", { name: panelName });
    await panel.getByRole("button", { name: actionName }).focus();
    await page.keyboard.press("Enter");
    await expect(panel.locator("[aria-live='polite']")).toBeFocused();
  }
  expect(manualRequests).toBe(0);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);
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

test("manually evaluates bounded scenario batches through the signed local product path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  let requests = 0;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/multi-scenario-feasibility", async (route) => {
    await requestGate;
    await route.continue();
  });
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/multi-scenario-feasibility"
    ) {
      requests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Scenario batch feasibility",
  });
  const evaluate = panel.getByRole("button", {
    name: "Evaluate feasibility",
  });
  const addScenario = panel.getByRole("button", { name: "Add scenario" });
  await addScenario.focus();
  await page.keyboard.press("Enter");
  const scenarios = panel.getByLabel("Canonical scenario");
  await scenarios.nth(1).selectOption("1");
  expect(requests).toBe(0);

  let response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/multi-scenario-feasibility"
  );
  await evaluate.focus();
  await expect(evaluate).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    panel.getByText("Evaluating the bounded batch"),
  ).toBeVisible();
  await expect(evaluate).toBeDisabled();
  releaseRequest();
  expect((await response).status()).toBe(200);
  expect(requests).toBe(1);
  let result = panel.getByRole("region", {
    name: "Batch feasibility result",
  });
  await expect(result).toContainText("arithmetically infeasible");
  await expect(result).toContainText("Concurrency overrun");
  await expect(result).not.toContainText("scenario-1");
  await expect(panel.locator(".batch-feasibility-output")).toBeFocused();

  await panel.getByLabel("Concurrency limit").fill("2");
  await expect(result).toHaveCount(0);
  response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/multi-scenario-feasibility"
  );
  await evaluate.click();
  expect((await response).status()).toBe(200);
  expect(requests).toBe(2);
  result = panel.getByRole("region", {
    name: "Batch feasibility result",
  });
  await expect(result).toContainText("arithmetically feasible");
  await expect(result).toContainText("USD 0.00");
  await expect(result).toContainText("None in this deterministic calculation");
  await expect(result).not.toContainText("SCENARIO_FEASIBILITY");
  expect(
    await evaluate.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);

  const moveUp = panel.getByRole("button", { name: "Move up scenario 2" });
  await moveUp.focus();
  await page.keyboard.press("Enter");
  await expect(result).toHaveCount(0);
  const remove = panel.getByRole("button", { name: "Remove scenario 2" });
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(panel.locator(".batch-feasibility-row")).toHaveCount(1);
  expect(requests).toBe(2);
});

test("refuses unsafe batch inputs locally without authorization", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/multi-scenario-feasibility"
    ) {
      requests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Scenario batch feasibility",
  });
  const evaluate = panel.getByRole("button", {
    name: "Evaluate feasibility",
  });
  await panel.getByRole("button", { name: "Add scenario" }).click();
  const aliases = panel.getByLabel("Local instance alias");
  await aliases.nth(1).fill("scenario-1");
  await evaluate.click();
  await expect(panel.getByText(/distinct local alias/)).toBeVisible();
  await aliases.nth(1).fill(["user", "example.invalid"].join("@"));
  await evaluate.click();
  await expect(panel.getByText(/2–32 character lowercase/)).toBeVisible();
  await aliases.nth(1).fill("scenario-2");
  await panel.getByLabel("Aggregate budget ceiling (USD)").fill("1.001");
  await evaluate.click();
  await expect(panel.getByText(/bounded USD amount/)).toBeVisible();
  expect(requests).toBe(0);
});

test("distinguishes planner refusal, size, and general safe failures", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Scenario batch feasibility",
  });
  const evaluate = panel.getByRole("button", {
    name: "Evaluate feasibility",
  });
  let kind: "refusal" | "request-size" | "response-size" | "general" =
    "refusal";
  await page.route("**/api/multi-scenario-feasibility", async (route) => {
    if (kind === "response-size") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: `"${"x".repeat(10_000)}"`,
      });
      return;
    }
    if (kind === "refusal") {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "batch_feasibility_refused",
          category: "PLAN_INVALID",
        }),
      });
      return;
    }
    await route.fulfill({
      status: kind === "request-size" ? 413 : 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "raw private backend payload" }),
    });
  });
  await evaluate.click();
  await expect(panel.getByText(/planner refused/)).toBeVisible();
  kind = "request-size";
  await evaluate.click();
  await expect(panel.getByText(/request-size limit/)).toBeVisible();
  kind = "response-size";
  await evaluate.click();
  await expect(panel.getByText(/response-size limit/)).toBeVisible();
  kind = "general";
  await evaluate.click();
  await expect(panel.getByText(/evaluation is unavailable/)).toBeVisible();
  await expect(panel).not.toContainText("raw private backend payload");
});

test("distinguishes expired and forbidden batch feasibility sessions", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "operator session expired"],
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
    const panel = page.getByRole("region", {
      name: "Scenario batch feasibility",
    });
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/multi-scenario-feasibility"
    );
    await panel.getByRole("button", {
      name: "Evaluate feasibility",
    }).click();
    expect((await response).status()).toBe(status);
    await expect(panel.getByText(new RegExp(message))).toBeVisible();
    await context.close();
  }
});

test("manually verifies one sanitized receipt through the signed local product path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  const receipt = CANONICAL_RECEIPT_FIXTURES[0]!.receipt;
  let verificationRequests = 0;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/scenario-evidence-verification", async (route) => {
    await requestGate;
    await route.continue();
  });
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/scenario-evidence-verification"
    ) {
      verificationRequests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", { name: "Receipt verification" });
  const input = panel.getByLabel("Sanitized receipt JSON");
  const verify = panel.getByRole("button", { name: "Verify receipt" });
  await expect(panel.getByText("No receipt submitted")).toBeVisible();
  await input.fill(JSON.stringify(receipt));
  expect(verificationRequests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/scenario-evidence-verification"
  );
  await verify.focus();
  await expect(verify).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Verifying the sanitized receipt…")).toBeVisible();
  await expect(verify).toBeDisabled();
  releaseRequest();
  expect((await response).status()).toBe(200);
  expect(verificationRequests).toBe(1);

  const result = panel.getByRole("region", {
    name: "Receipt verification result",
  });
  await expect(result).toBeVisible();
  await expect(result).toContainText(receipt.scenario.id);
  await expect(result).toContainText("Manifest version");
  await expect(result).toContainText("Deterministic claim states");
  await expect(result).toContainText("Missing coverage categories");
  await expect(result).not.toContainText(receipt.claims[0]!.id);
  await expect(result).not.toContainText("proofReference");
  await expect(panel.locator(".scenario-evidence-verification-output"))
    .toBeFocused();
  expect(
    await verify.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);

  await input.pressSequentially(" ");
  await expect(result).toHaveCount(0);
  await expect(panel.getByText("Input changed")).toBeVisible();
  expect(verificationRequests).toBe(1);
});

test("refuses unsafe or malformed receipt input locally without authorization", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let apiRequests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/scenario-evidence-verification"
    ) {
      apiRequests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", { name: "Receipt verification" });
  const input = panel.getByLabel("Sanitized receipt JSON");
  const verify = panel.getByRole("button", { name: "Verify receipt" });

  await input.fill("{");
  await verify.click();
  await expect(panel.getByText(/exact bounded receipt JSON shape/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...CANONICAL_RECEIPT_FIXTURES[0]!.receipt,
    rawIdentity: "operator@example.invalid",
  }));
  await verify.click();
  await expect(panel.getByText(/Receipt validation failed/)).toBeVisible();
  expect(apiRequests).toBe(0);
});

test("distinguishes receipt verification refusal, size, and general safe failures", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", { name: "Receipt verification" });
  const input = panel.getByLabel("Sanitized receipt JSON");
  const verify = panel.getByRole("button", { name: "Verify receipt" });
  const refused = NEGATIVE_RECEIPT_FIXTURES.find(
    ({ expectedCode }) => expectedCode === "state-promotion",
  )!;

  let response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/scenario-evidence-verification"
  );
  await input.fill(JSON.stringify(refused.receipt));
  await verify.click();
  expect((await response).status()).toBe(400);
  await expect(panel.getByText(/claims do not satisfy/)).toBeVisible();

  let kind: "request-size" | "response-size" | "general" = "request-size";
  await page.route("**/api/scenario-evidence-verification", async (route) => {
    if (kind === "response-size") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: `"${"x".repeat(140_000)}"`,
      });
      return;
    }
    await route.fulfill({
      status: kind === "request-size" ? 413 : 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "raw private backend payload" }),
    });
  });
  await input.fill(JSON.stringify(CANONICAL_RECEIPT_FIXTURES[0]!.receipt));
  await verify.click();
  await expect(panel.getByText(/request-size limit/)).toBeVisible();
  kind = "response-size";
  await verify.click();
  await expect(panel.getByText(/response-size limit/)).toBeVisible();
  kind = "general";
  await verify.click();
  await expect(panel.getByText(/verification is unavailable/)).toBeVisible();
  await expect(panel).not.toContainText("raw private backend payload");
});

test("distinguishes expired and forbidden receipt verification sessions", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "operator session expired"],
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
    const panel = page.getByRole("region", { name: "Receipt verification" });
    await panel.getByLabel("Sanitized receipt JSON").fill(
      JSON.stringify(CANONICAL_RECEIPT_FIXTURES[0]!.receipt),
    );
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/scenario-evidence-verification"
    );
    await panel.getByRole("button", { name: "Verify receipt" }).click();
    expect((await response).status()).toBe(status);
    await expect(panel.getByText(new RegExp(message))).toBeVisible();
    await context.close();
  }
});

test("manually verifies one canonical rehearsal output through the signed local product path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  const output = canonicalAvdThreeVmRehearsalOutput();
  if (output.planDigestSha256 === null) {
    throw new Error("Canonical rehearsal fixture must include a plan digest.");
  }
  let verificationRequests = 0;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/rehearsal-output-verification", async (route) => {
    await requestGate;
    await route.continue();
  });
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/rehearsal-output-verification"
    ) {
      verificationRequests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "AVD rehearsal verification",
  });
  const input = panel.getByLabel("Sanitized REHEARSAL_ONLY output JSON");
  const verify = panel.getByRole("button", {
    name: "Verify rehearsal output",
  });
  await expect(panel.getByText("No rehearsal output submitted")).toBeVisible();
  await input.fill(JSON.stringify(output));
  expect(verificationRequests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/rehearsal-output-verification"
  );
  await verify.focus();
  await expect(verify).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    panel.getByText("Verifying the network-free rehearsal output…"),
  ).toBeVisible();
  await expect(verify).toBeDisabled();
  releaseRequest();
  expect((await response).status()).toBe(200);
  expect(verificationRequests).toBe(1);

  const result = panel.getByRole("region", {
    name: "AVD rehearsal verification result",
  });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Network-free contract verified");
  await expect(result).toContainText("Terminal Complete");
  await expect(result).toContainText("Synthetic Only");
  await expect(result).toContainText("All Uninspected");
  await expect(result).not.toContainText(output.planDigestSha256);
  await expect(result).not.toContainText("runnerJournal");
  await expect(result).not.toContainText("avd-three-vm-substrate");
  await expect(panel.locator(".avd-rehearsal-verification-output"))
    .toBeFocused();
  expect(
    await verify.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);

  await input.pressSequentially(" ");
  await expect(result).toHaveCount(0);
  await expect(panel.getByText("Input changed")).toBeVisible();
  expect(verificationRequests).toBe(1);
});

test("refuses unsafe rehearsal output locally without authorization", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let apiRequests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/rehearsal-output-verification"
    ) {
      apiRequests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "AVD rehearsal verification",
  });
  const input = panel.getByLabel("Sanitized REHEARSAL_ONLY output JSON");
  const verify = panel.getByRole("button", {
    name: "Verify rehearsal output",
  });

  await input.fill("{");
  await verify.click();
  await expect(panel.getByText(/exact bounded PR #83 envelope/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...canonicalAvdThreeVmRehearsalOutput(),
    label: "LIVE_RESULT",
  }));
  await verify.click();
  await expect(panel.getByText(/exact REHEARSAL_ONLY label/)).toBeVisible();
  const unsafe = canonicalAvdThreeVmRehearsalOutput();
  await input.fill(JSON.stringify({
    ...unsafe,
    observations: {
      ...unsafe.observations,
      unexpectedField: ["operator", "example.invalid"].join("@"),
    },
  }));
  await verify.click();
  await expect(panel.getByText(/Local validation failed/)).toBeVisible();
  expect(apiRequests).toBe(0);
});

test("distinguishes rehearsal tampering, size, and general safe failures", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "AVD rehearsal verification",
  });
  const input = panel.getByLabel("Sanitized REHEARSAL_ONLY output JSON");
  const verify = panel.getByRole("button", {
    name: "Verify rehearsal output",
  });
  const tampered = canonicalAvdThreeVmRehearsalOutput();
  tampered.runnerJournal.entries += 1;

  let response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/rehearsal-output-verification"
  );
  await input.fill(JSON.stringify(tampered));
  await verify.click();
  expect((await response).status()).toBe(400);
  await expect(panel.getByText(/inconsistent or tampered/)).toBeVisible();

  let kind: "request-size" | "response-size" | "general" = "request-size";
  await page.route("**/api/rehearsal-output-verification", async (route) => {
    if (kind === "response-size") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: `"${"x".repeat(10_000)}"`,
      });
      return;
    }
    await route.fulfill({
      status: kind === "request-size" ? 413 : 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "raw private backend payload" }),
    });
  });
  await input.fill(JSON.stringify(canonicalAvdThreeVmRehearsalOutput()));
  await verify.click();
  await expect(panel.getByText(/request-size limit/)).toBeVisible();
  kind = "response-size";
  await verify.click();
  await expect(panel.getByText(/response-size limit/)).toBeVisible();
  kind = "general";
  await verify.click();
  await expect(panel.getByText(/verification is unavailable/)).toBeVisible();
  await expect(panel).not.toContainText("raw private backend payload");
});

test("distinguishes expired and forbidden rehearsal verification sessions", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "operator session expired"],
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
    const panel = page.getByRole("region", {
      name: "AVD rehearsal verification",
    });
    await panel.getByLabel("Sanitized REHEARSAL_ONLY output JSON").fill(
      JSON.stringify(canonicalAvdThreeVmRehearsalOutput()),
    );
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/rehearsal-output-verification"
    );
    await panel.getByRole("button", {
      name: "Verify rehearsal output",
    }).click();
    expect((await response).status()).toBe(status);
    await expect(panel.getByText(new RegExp(message))).toBeVisible();
    await context.close();
  }
});

test("manually verifies one private-document rehearsal through the signed local product path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  let requests = 0;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    "**/api/private-document-rehearsal-verification",
    async (route) => {
      await requestGate;
      await route.continue();
    },
  );
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/private-document-rehearsal-verification"
    ) {
      requests += 1;
    }
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Private-document rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized private-document REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify private-document rehearsal",
  });
  await input.fill(JSON.stringify(PRIVATE_DOCUMENT_REHEARSAL_OUTPUT));
  expect(requests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/private-document-rehearsal-verification"
  );
  await verify.focus();
  await page.keyboard.press("Enter");
  await expect(verify).toBeDisabled();
  await expect(panel.getByText(/Verifying the network-free/)).toBeVisible();
  releaseRequest();
  expect((await response).status()).toBe(200);
  expect(requests).toBe(1);

  const result = panel.getByRole("region", {
    name: "Private-document rehearsal verification result",
  });
  await expect(result).toContainText("Network-free contract verified");
  await expect(result).toContainText("Learner Observation");
  await expect(result).toContainText("All Uninspected");
  await expect(result).toContainText(
    "does not prove live learner visibility",
  );
  await expect(result).toContainText(
    "cannot substitute for pre-cleanup access",
  );
  await expect(result).not.toContainText("planDigestSha256");
  await expect(result).not.toContainText("fakeRunDigestSha256");
  await expect(result).not.toContainText("journalEntries");
  await expect(
    panel.locator(".private-document-rehearsal-verification-output"),
  ).toBeFocused();
  expect(
    await verify.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);

  await input.pressSequentially(" ");
  await expect(result).toHaveCount(0);
  expect(requests).toBe(1);
});

test("refuses unsafe private-document rehearsal input locally without authorization", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/private-document-rehearsal-verification"
    ) requests += 1;
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Private-document rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized private-document REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify private-document rehearsal",
  });

  await input.fill("{");
  await verify.click();
  await expect(panel.getByText(/exact bounded PR #90 envelope/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...PRIVATE_DOCUMENT_REHEARSAL_OUTPUT,
    label: "LIVE_RESULT",
  }));
  await verify.click();
  await expect(panel.getByText(/exact REHEARSAL_ONLY label/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...PRIVATE_DOCUMENT_REHEARSAL_OUTPUT,
    unsafe: ["operator", "example.invalid"].join("@"),
  }));
  await verify.click();
  await expect(panel.getByText(/Local validation failed/)).toBeVisible();
  expect(requests).toBe(0);
});

test("distinguishes private-document tampering and safe transport failures", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Private-document rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized private-document REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify private-document rehearsal",
  });
  const tampered = JSON.parse(
    JSON.stringify(PRIVATE_DOCUMENT_REHEARSAL_OUTPUT),
  ) as {
    fakeRun: { journalEntries: number };
  };
  tampered.fakeRun.journalEntries += 1;
  let response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/private-document-rehearsal-verification"
  );
  await input.fill(JSON.stringify(tampered));
  await verify.click();
  expect((await response).status()).toBe(400);
  await expect(panel.getByText(/inconsistent or tampered/)).toBeVisible();

  let kind: "request-size" | "response-size" | "general" = "request-size";
  await page.route(
    "**/api/private-document-rehearsal-verification",
    async (route) => {
      if (kind === "response-size") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: `"${"x".repeat(10_000)}"`,
        });
        return;
      }
      await route.fulfill({
        status: kind === "request-size" ? 413 : 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "raw private backend payload" }),
      });
    },
  );
  await input.fill(JSON.stringify(PRIVATE_DOCUMENT_REHEARSAL_OUTPUT));
  await verify.click();
  await expect(panel.getByText(/request-size limit/)).toBeVisible();
  kind = "response-size";
  await verify.click();
  await expect(panel.getByText(/response-size limit/)).toBeVisible();
  kind = "general";
  await verify.click();
  await expect(panel.getByText(/verification is unavailable/)).toBeVisible();
  await expect(panel).not.toContainText("raw private backend payload");
});

test("distinguishes private-document expired and forbidden sessions", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "operator session expired"],
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
    const panel = page.getByRole("region", {
      name: "Private-document rehearsal verification",
    });
    await panel.getByLabel(
      "Sanitized private-document REHEARSAL_ONLY output JSON",
    ).fill(JSON.stringify(PRIVATE_DOCUMENT_REHEARSAL_OUTPUT));
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/private-document-rehearsal-verification"
    );
    await panel.getByRole("button", {
      name: "Verify private-document rehearsal",
    }).click();
    expect((await response).status()).toBe(status);
    await expect(panel.getByText(new RegExp(message))).toBeVisible();
    await context.close();
  }
});

test("manually verifies one help-desk rehearsal through the signed local product path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  let requests = 0;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    "**/api/help-desk-email-rehearsal-verification",
    async (route) => {
      await requestGate;
      await route.continue();
    },
  );
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/help-desk-email-rehearsal-verification"
    ) requests += 1;
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Help-desk email rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized help-desk REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify help-desk rehearsal",
  });
  await input.fill(JSON.stringify(HELP_DESK_REHEARSAL_OUTPUT));
  expect(requests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/help-desk-email-rehearsal-verification"
  );
  await verify.focus();
  await page.keyboard.press("Enter");
  await expect(verify).toBeDisabled();
  await expect(panel.locator("form")).toHaveAttribute("aria-busy", "true");
  releaseRequest();
  expect((await response).status()).toBe(200);
  expect(requests).toBe(1);

  const result = panel.getByRole("region", {
    name: "Help-desk email rehearsal verification result",
  });
  await expect(result).toContainText("Network-free contract verified");
  await expect(result).toContainText("Learner Observed Cleaned");
  await expect(result).toContainText("All Uninspected");
  await expect(result).toContainText(
    "Send acceptance does not prove Inbox visibility",
  );
  await expect(result).toContainText(
    "cannot replace pre-cleanup learner observation",
  );
  await expect(result).not.toContainText("planDigestSha256");
  await expect(result).not.toContainText("fakeRunDigestSha256");
  await expect(result).not.toContainText("journalEntries");
  await expect(
    panel.locator(".help-desk-rehearsal-verification-output"),
  ).toBeFocused();
  expect(
    await verify.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);

  await input.pressSequentially(" ");
  await expect(result).toHaveCount(0);
  expect(requests).toBe(1);
});

test("refuses unsafe help-desk rehearsal input locally without authorization", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/help-desk-email-rehearsal-verification"
    ) requests += 1;
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Help-desk email rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized help-desk REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify help-desk rehearsal",
  });
  await input.fill("{");
  await verify.click();
  await expect(panel.getByText(/exact bounded PR #103 envelope/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...HELP_DESK_REHEARSAL_OUTPUT,
    label: "LIVE_RESULT",
  }));
  await verify.click();
  await expect(panel.getByText(/exact REHEARSAL_ONLY label/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...HELP_DESK_REHEARSAL_OUTPUT,
    unsafe: ["operator", "example.invalid"].join("@"),
  }));
  await verify.click();
  await expect(panel.getByText(/Local validation failed/)).toBeVisible();
  expect(requests).toBe(0);
});

test("distinguishes help-desk tampering and safe transport failures", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Help-desk email rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized help-desk REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify help-desk rehearsal",
  });
  const tampered = JSON.parse(JSON.stringify(HELP_DESK_REHEARSAL_OUTPUT)) as {
    fakeRun: { journalEntries: number };
  };
  tampered.fakeRun.journalEntries += 1;
  let response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/help-desk-email-rehearsal-verification"
  );
  await input.fill(JSON.stringify(tampered));
  await verify.click();
  expect((await response).status()).toBe(400);
  await expect(panel.getByText(/inconsistent or tampered/)).toBeVisible();

  let kind: "request-size" | "response-size" | "general" = "request-size";
  await page.route(
    "**/api/help-desk-email-rehearsal-verification",
    async (route) => {
      if (kind === "response-size") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: `"${"x".repeat(10_000)}"`,
        });
        return;
      }
      await route.fulfill({
        status: kind === "request-size" ? 413 : 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "raw private backend payload" }),
      });
    },
  );
  await input.fill(JSON.stringify(HELP_DESK_REHEARSAL_OUTPUT));
  await verify.click();
  await expect(panel.getByText(/request-size limit/)).toBeVisible();
  kind = "response-size";
  await verify.click();
  await expect(panel.getByText(/response-size limit/)).toBeVisible();
  kind = "general";
  await verify.click();
  await expect(panel.getByText(/verification is unavailable/)).toBeVisible();
  await expect(panel).not.toContainText("raw private backend payload");
});

test("distinguishes help-desk expired and forbidden sessions", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "operator session expired"],
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
    const panel = page.getByRole("region", {
      name: "Help-desk email rehearsal verification",
    });
    await panel.getByLabel(
      "Sanitized help-desk REHEARSAL_ONLY output JSON",
    ).fill(JSON.stringify(HELP_DESK_REHEARSAL_OUTPUT));
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/help-desk-email-rehearsal-verification"
    );
    await panel.getByRole("button", {
      name: "Verify help-desk rehearsal",
    }).click();
    expect((await response).status()).toBe(status);
    await expect(panel.getByText(new RegExp(message))).toBeVisible();
    await context.close();
  }
});

test("manually verifies one Teams rehearsal through the signed local product path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await configureOperator(page, accessToken);
  let requests = 0;
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    "**/api/teams-missed-call-rehearsal-verification",
    async (route) => {
      await requestGate;
      await route.continue();
    },
  );
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/teams-missed-call-rehearsal-verification"
    ) requests += 1;
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Teams missed-call rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized Teams REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify Teams rehearsal",
  });
  await input.fill(JSON.stringify(TEAMS_REHEARSAL_OUTPUT));
  expect(requests).toBe(0);

  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/teams-missed-call-rehearsal-verification"
  );
  await verify.focus();
  await page.keyboard.press("Enter");
  await expect(verify).toBeDisabled();
  await expect(panel.locator("form")).toHaveAttribute("aria-busy", "true");
  await verify.click({ force: true });
  expect(requests).toBe(1);
  releaseRequest();
  expect((await response).status()).toBe(200);
  expect(requests).toBe(1);

  const result = panel.getByRole("region", {
    name: "Teams missed-call rehearsal verification result",
  });
  await expect(result).toContainText("Network-free contract verified");
  await expect(result).toContainText("Native Cleaned");
  await expect(result).toContainText("Two Surface Absent");
  await expect(result).toContainText("All Uninspected");
  await expect(result).toContainText("proves no call or native Teams evidence");
  await expect(result).not.toContainText("planDigestSha256");
  await expect(result).not.toContainText("fakeRunDigestSha256");
  await expect(result).not.toContainText("nativeHistory");
  await expect(
    panel.locator(".teams-rehearsal-verification-output"),
  ).toBeFocused();
  expect(
    await verify.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.animationDuration, style.transitionDuration];
    }),
  ).toEqual(["0s", "0s"]);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    ),
  ).toBe(true);

  await input.pressSequentially(" ");
  await expect(result).toHaveCount(0);
  expect(requests).toBe(1);
});

test("refuses unsafe Teams rehearsal input locally without authorization", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  let requests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
        "/api/teams-missed-call-rehearsal-verification"
    ) requests += 1;
  });
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Teams missed-call rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized Teams REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify Teams rehearsal",
  });
  await input.fill("{");
  await verify.click();
  await expect(panel.getByText(/exact bounded PR #106 envelope/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...TEAMS_REHEARSAL_OUTPUT,
    label: "LIVE_RESULT",
  }));
  await verify.click();
  await expect(panel.getByText(/exact REHEARSAL_ONLY label/)).toBeVisible();
  await input.fill(JSON.stringify({
    ...TEAMS_REHEARSAL_OUTPUT,
    unsafe: ["operator", "example.invalid"].join("@"),
  }));
  await verify.click();
  await expect(panel.getByText(/Local validation failed/)).toBeVisible();
  expect(requests).toBe(0);
});

test("distinguishes Teams tampering and safe transport failures", async ({
  page,
}) => {
  await configureOperator(page, accessToken);
  await page.goto("/e2e/recent-operations.html");
  const panel = page.getByRole("region", {
    name: "Teams missed-call rehearsal verification",
  });
  const input = panel.getByLabel(
    "Sanitized Teams REHEARSAL_ONLY output JSON",
  );
  const verify = panel.getByRole("button", {
    name: "Verify Teams rehearsal",
  });
  const tampered = JSON.parse(JSON.stringify(TEAMS_REHEARSAL_OUTPUT)) as {
    receipt: { candidateClaimCount: number };
  };
  tampered.receipt.candidateClaimCount += 1;
  let response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname ===
      "/api/teams-missed-call-rehearsal-verification"
  );
  await input.fill(JSON.stringify(tampered));
  await verify.click();
  expect((await response).status()).toBe(400);
  await expect(panel.getByText(/inconsistent or tampered/)).toBeVisible();

  let kind: "request-size" | "response-size" | "general" = "request-size";
  await page.route(
    "**/api/teams-missed-call-rehearsal-verification",
    async (route) => {
      if (kind === "response-size") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: `"${"x".repeat(10_000)}"`,
        });
        return;
      }
      await route.fulfill({
        status: kind === "request-size" ? 413 : 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "raw private backend payload" }),
      });
    },
  );
  await input.fill(JSON.stringify(TEAMS_REHEARSAL_OUTPUT));
  await verify.click();
  await expect(panel.getByText(/request-size limit/)).toBeVisible();
  kind = "response-size";
  await verify.click();
  await expect(panel.getByText(/response-size limit/)).toBeVisible();
  kind = "general";
  await verify.click();
  await expect(panel.getByText(/verification is unavailable/)).toBeVisible();
  await expect(panel).not.toContainText("raw private backend payload");
});

test("distinguishes Teams expired and forbidden sessions", async ({
  browser,
}) => {
  const cases = [
    ["invalid-fixture-token", 401, "operator session expired"],
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
    const panel = page.getByRole("region", {
      name: "Teams missed-call rehearsal verification",
    });
    await panel.getByLabel(
      "Sanitized Teams REHEARSAL_ONLY output JSON",
    ).fill(JSON.stringify(TEAMS_REHEARSAL_OUTPUT));
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/teams-missed-call-rehearsal-verification"
    );
    await panel.getByRole("button", {
      name: "Verify Teams rehearsal",
    }).click();
    expect((await response).status()).toBe(status);
    await expect(panel.getByText(new RegExp(message))).toBeVisible();
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
