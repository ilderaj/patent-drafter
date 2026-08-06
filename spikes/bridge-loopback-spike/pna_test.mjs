// PNA Spike：HTTPS 页面（自签证书模拟 vibing.paymond.me）→ http://127.0.0.1 Bridge
import https from "node:https";
import fs from "node:fs";
import { chromium } from "playwright";

const CERT = { key: fs.readFileSync("certs/key.pem"), cert: fs.readFileSync("certs/cert.pem") };

// 1. HTTPS 页面服务器（生产 Origin 模拟）
const html = `<!doctype html><html><body><h1>Patent Drafter (spike)</h1>
<script>
async function probe() {
  const results = [];
  try {
    const r = await fetch("http://127.0.0.1:PORT/api/ping", { headers: { "X-Session-Token": "t1" } });
    results.push({ step: "simple-fetch", status: r.status, body: await r.text() });
  } catch (e) { results.push({ step: "simple-fetch", error: String(e) }); }
  try {
    const r = await fetch("http://127.0.0.1:PORT/api/ping", {
      headers: { "X-Session-Token": "t1", "Access-Control-Request-Private-Network": "true" },
    });
    results.push({ step: "pna-header-fetch", status: r.status });
  } catch (e) { results.push({ step: "pna-header-fetch", error: String(e) }); }
  document.body.dataset.results = JSON.stringify(results);
}
probe();
</script></body></html>`;

const webServer = https.createServer(CERT, (req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html.replace("PORT", process.env.BRIDGE_PORT));
});

await new Promise((r) => webServer.listen(0, "127.0.0.1", r));
const webPort = webServer.address().port;
console.log(`WEB_HTTPS https://127.0.0.1:${webPort}`);

// 2. Loopback Bridge（带 PNA/CORS 响应）
const bridge = https.createServer({}, (req, res) => {
  // 这个测试用 http://127.0.0.1 的 Bridge，见下方 http server
});
// 用 http server 模拟 Bridge（真实 Bridge 是 https loopback，但 PNA 规则按 scheme/ip 判断）
import http from "node:http";
const bridgeHttp = http.createServer((req, res) => {
  const origin = req.headers.origin;
  console.log(`[bridge] ${req.method} ${req.url} origin=${origin}`);
  if (req.method === "OPTIONS") {
    const h = { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "X-Session-Token,Content-Type", "Access-Control-Allow-Private-Network": "true" };
    res.writeHead(204, h); res.end(); return;
  }
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Private-Network": "true" });
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((r) => bridgeHttp.listen(0, "127.0.0.1", r));
const bridgePort = bridgeHttp.address().port;
console.log(`BRIDGE_HTTP http://127.0.0.1:${bridgePort}`);

const browser = await chromium.launch({ headless: true, args: ["--ignore-certificate-errors"] });
const page = await browser.newPage();
page.on("console", (m) => console.log(`[page.console:${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[page.error] ${e}`));
const resp = await page.goto(`https://127.0.0.1:${webPort}`, { waitUntil: "domcontentloaded" });
console.log(`[page.goto] status=${resp.status()}`);
await page.waitForFunction(() => document.body.dataset.results !== undefined, null, { timeout: 15000 }).catch(() => console.log("[wait] timeout waiting results"));
const results = await page.evaluate(() => JSON.parse(document.body.dataset.results || "[]"));
console.log("RESULTS=" + JSON.stringify(results, null, 2));
await browser.close();
process.exit(0);
