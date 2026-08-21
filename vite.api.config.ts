import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist-api",
    rollupOptions: {
      output: {
        entryFileNames: "index.js",
      },
    },
    sourcemap: true,
    ssr: "api/index.ts",
    target: "node22",
  },
});
