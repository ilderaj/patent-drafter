// 最小 Loopback Bridge Spike：模拟 Patent Bridge 的 CORS/PNA 响应
import http from "node:http";
import crypto from "node:crypto";

const ALLOWED_ORIGINS = new Set([
  "https://vibing.paymond.me",
  "http://localhost:5173",
]);

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const pna = req.headers["access-control-request-private-network"];

  console.log(`[req] ${req.method} ${req.url} origin=${origin} pna=${pna}`);

  const allow = origin && ALLOWED_ORIGINS.has(origin);
  if (req.method === "OPTIONS") {
    if (!allow) {
      res.writeHead(403, { "Access-Control-Allow-Origin": "null" });
      res.end("forbidden");
      return;
    }
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Session-Token",
      "Access-Control-Max-Age": "86400",
    };
    if (pna === "true") {
      headers["Access-Control-Allow-Private-Network"] = "true";
    }
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (!allow) {
    res.writeHead(403, { "Access-Control-Allow-Origin": "null" });
    res.end("forbidden");
    return;
  }

  const body = { ok: true, token: crypto.randomBytes(16).toString("hex") };
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`BRIDGE_LISTENING 127.0.0.1:${port}`);
  // 自检：不允许的 origin
  fetch(`http://127.0.0.1:${port}/api/pair`, {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
  }).then(async (r) => {
    console.log(`[selfcheck evil-origin] status=${r.status}`);
    // 自检：允许的 origin + PNA preflight
    const pre = await fetch(`http://127.0.0.1:${port}/api/pair`, {
      method: "OPTIONS",
      headers: {
        origin: "https://vibing.paymond.me",
        "access-control-request-private-network": "true",
        "access-control-request-method": "POST",
      },
    });
    console.log(`[selfcheck pna-preflight] status=${pre.status} allow-pna=${pre.headers.get("access-control-allow-private-network")}`);
    const ok = await fetch(`http://127.0.0.1:${port}/api/pair`, {
      method: "POST",
      headers: { origin: "https://vibing.paymond.me", "content-type": "application/json" },
      body: JSON.stringify({ code: "826419" }),
    });
    console.log(`[selfcheck allowed-origin] status=${ok.status} body=${await ok.text()}`);
    process.exit(0);
  });
});
