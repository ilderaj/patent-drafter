"""PNA Spike: HTTPS 页面(自签证书) -> http://127.0.0.1 Bridge 真实浏览器验证"""
import http.server, ssl, json, os, threading, sys
from playwright.sync_api import sync_playwright

BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "0"))

# ---- Bridge: http://127.0.0.1 ----
class BridgeHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def _cors(self):
        origin = self.headers.get("Origin", "")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Session-Token,Content-Type")
        if os.environ.get("NO_PNA") != "1":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()
    def do_OPTIONS(self):
        pna = self.headers.get("Access-Control-Request-Private-Network")
        print(f"[bridge] OPTIONS {self.path} origin={self.headers.get('Origin')} pna={pna}", flush=True)
        self._cors()
    def do_GET(self):
        origin = self.headers.get("Origin", "")
        print(f"[bridge] GET {self.path} origin={origin} token={self.headers.get('X-Session-Token')}", flush=True)
        body = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        if os.environ.get("NO_PNA") != "1":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

bridge = http.server.ThreadingHTTPServer(("127.0.0.1", BRIDGE_PORT), BridgeHandler)
bridge_port = bridge.server_address[1]
print(f"BRIDGE_HTTP http://127.0.0.1:{bridge_port}", flush=True)
threading.Thread(target=bridge.serve_forever, daemon=True).start()

# ---- Web: https://127.0.0.1 ----
HTML = """<!doctype html><html><body><h1>Patent Drafter spike</h1><script>
async function probe() {
  const results = [];
  try {
    const r = await fetch("http://127.0.0.1:%d/api/ping", { headers: { "X-Session-Token": "t1" } });
    results.push({ step: "simple-fetch", status: r.status, body: await r.text() });
  } catch (e) { results.push({ step: "simple-fetch", error: String(e) }); }
  document.body.dataset.results = JSON.stringify(results);
}
probe();
</script></body></html>""" % bridge_port

class WebHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def do_GET(self):
        body = HTML.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

web = http.server.ThreadingHTTPServer(("192.168.50.158", 0), WebHandler)
web_port = web.server_address[1]
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain("certs/cert.pem", "certs/key.pem")
web.socket = ctx.wrap_socket(web.socket, server_side=True)
threading.Thread(target=web.serve_forever, daemon=True).start()
print(f"WEB_HTTPS https://127.0.0.1:{web_port}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome", args=["--ignore-certificate-errors", "--enable-features=PrivateNetworkAccessCheckForAllAddressSpaces,BlockInsecurePrivateNetworkRequests"])
    page = browser.new_page()
    page.on("console", lambda m: print(f"[page.console:{m.type}] {m.text}", flush=True))
    page.on("pageerror", lambda e: print(f"[page.error] {e}", flush=True))
    r = page.goto(f"https://192.168.50.158:{web_port}", wait_until="domcontentloaded")
    print(f"[page.goto] status={r.status}", flush=True)
    try:
        page.wait_for_function("document.body.dataset.results !== undefined", timeout=15000)
    except Exception as e:
        print(f"[wait] timeout: {e}", flush=True)
    results = page.evaluate("JSON.parse(document.body.dataset.results || '[]')")
    print("RESULTS=" + json.dumps(results, ensure_ascii=False, indent=2), flush=True)
    browser.close()
sys.exit(0)
