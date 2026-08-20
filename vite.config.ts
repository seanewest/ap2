import { defineConfig } from "vite";
import { loadInstallationConfig } from "./installation/server.ts";

export default defineConfig(({ command }) => {
  const installation = loadInstallationConfig();
  return {
    base: command === "serve" ? "/" : "/ap2/",
    define: {
      __AP2_INSTALLATION__: JSON.stringify(installation),
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        "/__ap2_api": {
          target: installation.spa.apiBaseUrl,
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
  };
});
