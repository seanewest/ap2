import { expect, test } from "@playwright/test";

const FIXTURE = {
  apiBaseUrl: "http://127.0.0.1:9",
  accessToken: "local-browser-fixture",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixture) => {
    Object.defineProperty(window, "__AP2_LOCAL_OPERATOR__", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: fixture,
    });
  }, FIXTURE);
});

test("signed-in primary SPA contains only understandable product surfaces", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith("/api/") &&
      ["fetch", "xhr"].includes(request.resourceType())
    ) {
      apiRequests.push(path);
    }
  });

  await page.goto("/e2e/recent-operations.html");

  await expect(page.getByText("Signed in as Fixture Operator")).toBeVisible();
  await expect(page.getByRole("region", { name: "Lab catalog" })).toContainText(
    "No complete labs are published yet",
  );
  await expect(
    page.getByRole("region", { name: "Capability building blocks" }),
  ).toContainText("atomic capability, not a complete learner lab");
  await expect(page.getByText(
    /Capability actions below make the specific Microsoft 365 change/,
  )).toBeVisible();

  await expect(
    page.getByRole("button", {
      name: "Send one internal email: Homer → Marge",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create one help desk email: Kobe → Cory",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create and share OneDrive proof" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create calendar meeting" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  expect(apiRequests).toEqual([]);
});

test("developer contracts and raw-input controls are absent", async ({
  page,
}) => {
  await page.goto("/e2e/recent-operations.html");

  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByText(/REHEARSAL_ONLY/)).toHaveCount(0);
  await expect(page.getByText(/PR #\d+/)).toHaveCount(0);
  for (const name of [
    "Scenario plan preview",
    "Scenario surface availability",
    "Scenario batch feasibility",
    "Receipt verification",
    "Application-reconnaissance rehearsal verification",
    "Recent operations",
    "Check API access",
    "Check rehearsal status",
    "Failed-rehearsal support bundle",
  ]) {
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
});

test("retained actions expose their effect and cleanup boundary", async ({
  page,
}) => {
  await page.goto("/e2e/recent-operations.html");

  await expect(page.getByText(
    /one internal email from Homer Simpson to Marge Simpson.*no email cleanup action/,
  )).toBeVisible();
  await expect(page.getByText(
    /Homer creates one fixed harmless file, shares it read-only with Marge/,
  )).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clean up OneDrive proof" }),
  ).toBeDisabled();
  await expect(page.getByText(
    /Cory creates one fixed harmless unsent Outlook draft.*never sends mail/,
  )).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove unsent draft proof" }),
  ).toBeDisabled();
});

test("narrow viewport and keyboard navigation preserve comprehension", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto("/e2e/recent-operations.html");

  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  const firstAction = page.getByRole("button", {
    name: "Send one internal email: Homer → Marge",
  });
  await firstAction.focus();
  await expect(firstAction).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Create one help desk email: Kobe → Cory",
    }),
  ).toBeFocused();
});
