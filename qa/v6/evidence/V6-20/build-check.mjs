import { build } from "vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP_ROOT = join(ROOT, "apps/web");
const results = await build({
  configFile: join(APP_ROOT, "vite.config.ts"),
  root: APP_ROOT,
  build: { write: false },
});
const outputs = (Array.isArray(results) ? results : [results]).flatMap((result) => result.output);
const chunks = outputs.filter((item) => item.type === "chunk").length;
const assets = outputs.filter((item) => item.type === "asset").length;
console.log(`Vite production build completed in memory. ${chunks} chunks, ${assets} assets; no build files written.`);
