import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/ap2/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/__ap2_api": {
        target:
          "https://ca-ap2-api.happycliff-97dcb6b8.eastus.azurecontainerapps.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__ap2_api/, ""),
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
          });
        },
      },
    },
  },
}));
