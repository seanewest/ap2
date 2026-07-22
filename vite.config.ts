import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/ap2/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
}));
