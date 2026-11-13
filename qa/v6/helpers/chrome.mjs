// Shared Node-only harness for real headless Chrome/Chromium tests. Missing or
// broken browsers fail with diagnostics; callers must never turn that into a skip.
import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function chromeCandidates({ env = process.env, platform = process.platform } = {}) {
  // An explicit override is authoritative: a typo must be reported instead of
  // silently launching a different browser installed on the machine.
  if (env.CHROME_PATH) return [env.CHROME_PATH];
  const linux = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  const mac = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  const candidates = platform === "darwin" ? [...mac, ...linux] : [...linux, ...mac];
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      candidates.push(join(directory, name));
    }
  }
  return [...new Set(candidates)];
}

export function findChrome(options = {}) {
  const candidates = chromeCandidates(options);
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* try next executable */ }
  }
  throw new Error(`没有找到可执行的 Chrome/Chromium（${options.platform ?? process.platform}）。设置 CHROME_PATH；CI 必须安装浏览器后再运行，不能跳过。已检查：\n${candidates.join("\n")}`);
}

export function chromeLaunchArgs({ profile, platform = process.platform, width = 1440, height = 900 } = {}) {
  if (!profile) throw new Error("Chrome harness requires its own temporary profile directory.");
  return ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", `--window-size=${width},${height}`,
    // These flags apply only to the disposable test browser, never the user's browser.
    ...(platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []), "about:blank"];
}

async function waitForExit(child, timeoutMs) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const finished = () => { clearTimeout(timer); child.removeListener("exit", finished); resolve(); };
    const timer = setTimeout(finished, timeoutMs);
    child.once("exit", finished);
  });
}

async function stopChrome(child, socket, profile) {
  try { socket?.close(); } catch { /* the peer may already have exited */ }
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await waitForExit(child, 1500);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 1500);
    }
  }
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

async function connectPage(url, timeoutMs) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      socket.removeEventListener("close", closed);
    };
    const opened = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(`DevTools WebSocket connection failed: ${url}`)); };
    const closed = () => { cleanup(); reject(new Error(`DevTools WebSocket closed before ready: ${url}`)); };
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error(`DevTools WebSocket was not ready within ${timeoutMs}ms: ${url}`));
    }, timeoutMs);
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", failed, { once: true });
    socket.addEventListener("close", closed, { once: true });
  }).catch((error) => { try { socket.close(); } catch {} throw error; });
  return socket;
}

/** Wait for the port file, a page target and its WebSocket, then expose them.
 * Every retry uses a new profile and cleans up the previous attempt. Bounds cover
 * spawn errors, early exits, an empty/missing port file and a delayed page target.
 */
export async function launchChromeWithPageTarget({
  executable = findChrome(),
  attempts = 3,
  portTimeoutMs = 15_000,
  targetTimeoutMs = 10_000,
  socketTimeoutMs = 5_000,
  profileRoot = tmpdir(),
  profilePrefix = "v6-chrome-",
  width = 1440,
  height = 900,
} = {}) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const profile = mkdtempSync(join(profileRoot, profilePrefix));
    let stderr = "", spawnError = null, socket;
    const child = spawn(executable, chromeLaunchArgs({ profile, width, height }), { stdio: ["ignore", "ignore", "pipe"] });
    child.on("error", (error) => { spawnError = error; });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-6000); });
    const checkChild = () => {
      if (spawnError) throw new Error(`Chrome spawn failed: ${spawnError.message}`);
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Chrome exited before ready (code=${child.exitCode}, signal=${child.signalCode})`);
      }
    };
    try {
      const portFile = join(profile, "DevToolsActivePort");
      const portDeadline = Date.now() + portTimeoutMs;
      let port;
      while (Date.now() < portDeadline) {
        checkChild();
        try {
          const value = readFileSync(portFile, "utf8").split("\n")[0];
          if (/^\d+$/.test(value) && Number(value) > 0 && Number(value) < 65536) { port = value; break; }
        } catch { /* Chrome may not have written the file yet. */ }
        await pause(100);
      }
      if (!port) throw new Error(`DevToolsActivePort not ready within ${portTimeoutMs}ms`);
      const targetDeadline = Date.now() + targetTimeoutMs;
      let page, lastError = "";
      while (Date.now() < targetDeadline) {
        checkChild();
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json`, {
            signal: AbortSignal.timeout(Math.min(1000, Math.max(1, targetDeadline - Date.now()))),
          });
          if (!response.ok) throw new Error(`DevTools /json returned ${response.status}`);
          const targets = await response.json();
          page = Array.isArray(targets) ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) : null;
          if (page) break;
        } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
        await pause(100);
      }
      if (!page) throw new Error(`No DevTools page target within ${targetTimeoutMs}ms${lastError ? `; ${lastError}` : ""}`);
      socket = await connectPage(page.webSocketDebuggerUrl, socketTimeoutMs);
      let closing;
      return { child, page, profile, socket, executable, close: () => (closing ??= stopChrome(child, socket, profile)) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`attempt ${attempt}/${attempts}: ${detail}${stderr.trim() ? `\nstderr: ${stderr.trim()}` : ""}`);
      await stopChrome(child, socket, profile);
    }
  }
  throw new Error(`Headless Chrome failed after ${attempts} attempts (${process.platform}, ${executable}):\n${failures.join("\n")}`);
}
