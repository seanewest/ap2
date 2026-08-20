import { defineConfig } from "vitest/config";
import { loadInstallationConfig } from "./installation/server.ts";

export default defineConfig({
  define: {
    __AP2_INSTALLATION__: JSON.stringify(loadInstallationConfig()),
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**/*.spec.ts"],
    maxWorkers: "25%",
  },
});
