import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The legacy worker serves the app under /patent/. The standalone
  // patent.paymond.me worker builds the same app at the domain root.
  base: process.env.V6_WEB_BASE ?? "/patent/",
  // Tests/browser evidence point this at a worktree-local directory so the
  // node_modules symlink's shared optimizer cache is not written.
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  plugins: [react()],
  resolve: {
    alias: {
      "@patent/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
      "@patent/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@patent/providers": fileURLToPath(new URL("../../packages/providers/src/index.ts", import.meta.url)),
      "@patent/pipeline": fileURLToPath(new URL("../../packages/pipeline/src/index.ts", import.meta.url)),
      "@patent/export/notes": fileURLToPath(new URL("../../packages/export/src/notes.ts", import.meta.url)),
      "@patent/export": fileURLToPath(new URL("../../packages/export/src/index.ts", import.meta.url)),
      // Browser-safe shims for node-only imports inside packages/*.
      "node:fs/promises": fileURLToPath(new URL("./src/shims/empty.ts", import.meta.url)),
      "node:path": fileURLToPath(new URL("./src/shims/empty.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev-only: proxy the cloud API to a local `wrangler dev` instance
      // (127.0.0.1:8787). When no dev worker is running, answer 502 quickly so
      // mode detection falls back to the local loopback bridge.
      "/patent/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if (res && !res.headersSent) {
              res.writeHead(502, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "cloud dev worker unreachable" }));
            }
          });
        },
      },
      // Dev-only: headless Chrome for Testing lacks macOS Local Network (TCC)
      // permission for direct loopback fetches. Production uses the real
      // http://127.0.0.1:7878 origin (verified via Spike A on Chrome 150).
      "/bridge": {
        target: "http://127.0.0.1:7878",
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/bridge/, ""),
        configure: (proxy) => {
          // Same-origin fetches carry no Origin header; re-inject the dev
          // origin so the bridge's strict allowlist still applies.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", "http://localhost:5173");
          });
        },
      },
    },
  },
  build: {
    outDir: process.env.V6_WEB_OUTDIR ?? "dist/patent",
  },
});
