import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/ap2/",
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
