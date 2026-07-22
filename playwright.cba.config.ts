import { chmodSync, mkdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { LOCAL_APP_URL, loadCbaE2eSettings } from "./e2e/cba-settings";

const settings = loadCbaE2eSettings();
mkdirSync(settings.outputDirectory, { mode: 0o700, recursive: true });
chmodSync(settings.outputDirectory, 0o700);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "cba-auth.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: settings.outputDirectory,
  use: {
    baseURL: settings.appUrl,
    browserName: "chromium",
    clientCertificates: settings.certificateOrigins.map((origin) => ({
      origin,
      passphrase: settings.passphrase,
      pfx: settings.pfx,
    })),
    locale: "en-US",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer:
    settings.appUrl === LOCAL_APP_URL
      ? {
          command: "npm run dev",
          url: LOCAL_APP_URL,
          reuseExistingServer: false,
          timeout: 30_000,
        }
      : undefined,
});
