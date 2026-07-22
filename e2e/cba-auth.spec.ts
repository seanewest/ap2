import { expect, test, type Page } from "@playwright/test";
import {
  STUDENT_OPERATOR,
  STUDENT_TENANT_ID,
} from "./cba-settings";

test("signs the Student operator in and out through Microsoft CBA", async ({
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

  await page.reload();
  await expect(page.getByText("You are signed out.")).toBeVisible();
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
