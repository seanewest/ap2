import { chmodSync, mkdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const outputDirectory = "/tmp/ap2-playwright-recent-operations";
mkdirSync(outputDirectory, { mode: 0o700, recursive: true });
chmodSync(outputDirectory, 0o700);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "recent-operations.spec.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: outputDirectory,
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    locale: "en-US",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
