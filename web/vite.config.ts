import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Same values as packages/core/src/server/internalUiHeaders.ts (dev-proxy only).
const CCRELAY_UI_HEADER_NAME = "X-CCRelay-Internal-UI";
const CCRELAY_UI_HEADER_VALUE = "ccrelay-internal-1";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "/ccrelay/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  server: {
    proxy: {
      "/ccrelay/api": {
        target: "http://127.0.0.1:7575",
        changeOrigin: true,
        rewrite: p => p.replace(/^\/ccrelay\/api/, "/ccrelay/api"),
        configure: proxy => {
          proxy.on("proxyReq", proxyReq => {
            proxyReq.setHeader(CCRELAY_UI_HEADER_NAME, CCRELAY_UI_HEADER_VALUE);
            const token = process.env.CCRELAY_DEV_API_BEARER;
            if (token?.trim()) {
              proxyReq.setHeader("Authorization", `Bearer ${token.trim()}`);
            }
          });
        },
      },
    },
  },
});
