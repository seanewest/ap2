import { expect, test, type Page } from "@playwright/test";
import {
  STUDENT_OPERATOR,
  STUDENT_TENANT_ID,
} from "./cba-settings";

test("signs in, checks delegated API access, and signs out through Microsoft CBA", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByText("You are signed out.")).toBeVisible();

  await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
  const certificateAuthentication = page.waitForRequest((request) => {
    const hostname = new URL(request.url()).hostname;
    return (
      hostname === "certauth.login.microsoftonline.com" ||
      hostname.endsWith(".certauth.login.microsoftonline.com")
    );
  });
  await enterStudentOperator(page);
  await chooseCertificateAuthentication(page);
  await certificateAuthentication;
  await finishMicrosoftPrompt(page);

  await expect(page.getByText(/^Signed in as /)).toBeVisible();
  await expect(
    page.locator("dd").getByText(STUDENT_OPERATOR, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("dd").getByText(STUDENT_TENANT_ID, { exact: true }),
  ).toBeVisible();

  const whoAmIResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/whoami"
    );
  });
  const whoAmIFailure = new Promise<never>((_resolve, reject) => {
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET" &&
        url.pathname === "/api/whoami"
      ) {
        reject(
          new Error(
            `Browser API request to ${url.origin} failed: ` +
              (request.failure()?.errorText ?? "unknown transport error"),
          ),
        );
      }
    });
  });
  await page.getByRole("button", { name: "Check API access" }).click();
  await expect(page.getByText("Checking API access…")).toBeVisible();
  expect((await Promise.race([whoAmIResponse, whoAmIFailure])).status()).toBe(200);
  await expect(page.getByText("API access confirmed.")).toBeVisible();
  await expect(
    page.locator("dd").getByText("delegated", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("dd").getByText(STUDENT_TENANT_ID, { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText(/bearer|access token|eyJ/i)).toHaveCount(0);

  const logoutRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.hostname === "login.microsoftonline.com" &&
      url.pathname.toLowerCase().includes("/logout")
    );
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await logoutRequest;

  await finishMicrosoftSignOut(page);
  await expect(page.getByText("You are signed out.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("button", { name: "Sign in with Microsoft" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check API access" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("You are signed out.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check API access" }),
  ).toHaveCount(0);
});

async function enterStudentOperator(page: Page): Promise<void> {
  const useAnotherAccount = page.getByText("Use another account", {
    exact: true,
  });
  if (await useAnotherAccount.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await useAnotherAccount.click();
  }

  const username = page.locator('input[name="loginfmt"]');
  await username.waitFor({ state: "visible" });
  await username.fill(STUDENT_OPERATOR);
  await page.locator('input[type="submit"]').click();
}

async function chooseCertificateAuthentication(page: Page): Promise<void> {
  const noButton = page.getByRole("button", { name: "No", exact: true });
  if (await noButton.isVisible().catch(() => false)) {
    return;
  }

  const certificateOption = page.getByText(
    /use a certificate or smart card|sign in with a certificate/i,
  );
  if (!(await certificateOption.isVisible({ timeout: 3_000 }).catch(() => false))) {
    const signInOptions = page.getByText(/sign-in options/i);
    if (await signInOptions.isVisible().catch(() => false)) {
      await signInOptions.click();
    }
  }

  const certificateHandle = await certificateOption.elementHandle({
    timeout: 3_000,
  }).catch(() => null);
  if (certificateHandle) {
    await certificateHandle
      .evaluate((element) => (element as HTMLElement).click())
      .catch(() => undefined);
  }
}

async function finishMicrosoftPrompt(page: Page): Promise<void> {
  const noButton = page.getByRole("button", { name: "No", exact: true });
  const signedInStatus = page.getByText("Signed in as", { exact: false });
  await Promise.race([
    noButton.waitFor({ state: "visible", timeout: 60_000 }),
    signedInStatus.waitFor({ state: "visible", timeout: 60_000 }),
  ]);
  if (await noButton.isVisible()) {
    await noButton.click();
  }
}

async function finishMicrosoftSignOut(page: Page): Promise<void> {
  const account = page.getByRole("button", {
    name: new RegExp(`Sign out ${STUDENT_OPERATOR}`, "i"),
  });
  const signedOutStatus = page.getByText("You are signed out.");
  await Promise.race([
    account.waitFor({ state: "visible", timeout: 60_000 }),
    signedOutStatus.waitFor({ state: "visible", timeout: 60_000 }),
  ]);
  if (await account.isVisible()) {
    await account.click();
  }
}
