import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/patent/",
  plugins: [react()],
  resolve: {
    alias: {
      "@patent/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
      "@patent/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
