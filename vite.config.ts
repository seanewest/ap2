import { defineConfig } from "vite";
import {
  inventoryCanonicalScenarioSurfaces,
} from "./src/scenarios/scenario-surface-inventory.ts";

const scenarioSurfaceInventory = inventoryCanonicalScenarioSurfaces();

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/ap2/",
  define: {
    __AP2_SCENARIO_SURFACE_INVENTORY__: JSON.stringify(
      scenarioSurfaceInventory,
    ),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          return moduleId.endsWith("/src/scenarios/scenario-manifest.ts")
            ? "scenario-contract"
            : undefined;
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
}));
