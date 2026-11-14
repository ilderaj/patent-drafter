// Drives headless Chrome over CDP through the V6-09 appearance panel.
// Usage: node browser-drive.mjs <outDir> <baseUrl>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function recordStep(name, fn, { log, appearance, shot }) {
  try {
    const result = await fn();
    log.push({ step: name, ok: true, state: await appearance(), ...(result ? { notes: result } : {}) });
    await shot(name);
  } catch (error) {
    log.push({ step: name, ok: false, error: String(error), state: await appearance().catch(() => ({})) });
    await shot(name).catch(() => {});
  }
}

export function reportResult({ steps, consoleErrors, finalState }) {
  const ok = steps.length > 0 && steps.every((step) => step.ok) && consoleErrors.length === 0;
  console.log(JSON.stringify({ ok, failed: steps.filter((step) => !step.ok), finalState, errors: consoleErrors }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

async function main() {
const [outDir, base] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "v6-09-profile-"));
const port = 9334;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,860", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const waitFor = async (expression, label) => {
  for (let i = 0; i < 70; i++) { if (await evaluate(expression)) return; await sleep(150); }
  throw new Error(`timeout waiting for ${label}`);
};
const go = async (path) => { await send("Page.navigate", { url: base + path }); await sleep(350); };
const reload = async () => { await send("Page.reload"); await sleep(700); };
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
};
const emulateScheme = async (value) => {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
  await sleep(200);
};
const press = async (key, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

const appearance = () => evaluate(`(() => {
  const raw = localStorage.getItem("patent-drafter.v6.appearance");
  let stored = null;
  try { stored = raw === null ? null : JSON.parse(raw); } catch { stored = "unparseable"; }
  return {
    path: location.pathname,
    theme: document.documentElement.dataset.theme ?? null,
    mode: document.documentElement.dataset.mode ?? null,
    status: document.querySelector("[data-testid=appearance-status]")?.textContent ?? null,
    saved: document.querySelector("[data-testid=appearance-save]")?.textContent ?? null,
    failed: document.querySelector("[data-testid=appearance-save-failed]")?.textContent ?? null,
    readNote: document.querySelector("[data-testid=appearance-read-note]")?.textContent ?? null,
    notification: document.querySelector("[data-testid=notification-capability]")?.textContent ?? null,
    themes: [...document.querySelectorAll("input[name=theme]")].map((input) => input.value),
    modes: [...document.querySelectorAll("input[name=color-mode]")].map((input) => input.value),
    checkedTheme: document.querySelector("input[name=theme]:checked")?.value ?? null,
    checkedMode: document.querySelector("input[name=color-mode]:checked")?.value ?? null,
    stored,
    fakeMenu: document.querySelector(".v6-shell [role=menubar], .v6-shell .traffic-lights, .v6-shell .traffic-light") !== null,
    width: innerWidth,
    focused: document.activeElement?.getAttribute?.("name") ?? document.activeElement?.tagName ?? null,
    focusVisible: document.activeElement?.matches?.(":focus-visible") ?? false,
  };
})()`);

const assert = (condition, message, state) => {
  if (!condition) throw new Error(`${message} :: ${JSON.stringify(state)}`);
};

const log = [];
const step = (name, fn) => recordStep(name, fn, { log, appearance, shot });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const original = Storage.prototype.setItem;
    window.__v6FailWrites = false;
    Storage.prototype.setItem = function (key, value) {
      if (window.__v6FailWrites) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, key, value);
    };
  })();`,
});
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});

await step("01-settings-light", async () => {
  await emulateScheme("light");
  await go("/patent/v6/settings");
  await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "appearance panel");
  const s = await appearance();
  assert(s.theme === "native", "theme should be native", s);
  assert(s.mode === "light", "system + light OS should resolve light", s);
  assert(s.checkedTheme === "native" && s.checkedMode === "system", "default radios", s);
  assert(JSON.stringify(s.themes) === JSON.stringify(["native", "graphite", "cyan", "celadon"]), "four theme choices", s);
  assert(JSON.stringify(s.modes) === JSON.stringify(["system", "light", "dark"]), "three colour modes", s);
  assert(s.status.includes("原生") && s.status.includes("跟随系统") && s.status.includes("当前浅色"), "text state", s);
  assert(s.saved === null, "no save claim before a save", s);
  assert(s.fakeMenu === false, "no fake macOS menu", s);
  assert(s.notification.includes("不发送邮件") && s.notification.includes("尚未配置"), "notification limit", s);
  assert(s.width === 1280, "desktop width", s);
});

await step("02-switch-dark", async () => {
  await evaluate(`document.querySelector('input[name=color-mode][value=dark]').click()`);
  await waitFor(`document.documentElement.dataset.mode === "dark"`, "dark mode");
  const s = await appearance();
  assert(s.stored?.colorMode === "dark", "dark persisted", s);
  assert(s.stored?.themeId === "native", "theme unchanged", s);
  assert(s.saved?.includes("已保存"), "save confirmation", s);
  assert(s.status.includes("深色"), "status names dark", s);
});

await step("03-reload-dark", async () => {
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]") && document.querySelector("input[name=color-mode]:checked")?.value === "dark"`, "dark after reload");
  const s = await appearance();
  assert(s.mode === "dark", "dark applied after refresh", s);
  assert(s.stored?.colorMode === "dark", "dark still stored", s);
  assert(s.saved === null, "refresh does not claim a fresh save", s);
});

await step("04-system-follows-os", async () => {
  await evaluate(`document.querySelector('input[name=color-mode][value=system]').click()`);
  await waitFor(`document.querySelector("input[name=color-mode]:checked")?.value === "system"`, "system selected");
  await emulateScheme("dark");
  await waitFor(`document.documentElement.dataset.mode === "dark"`, "OS dark applied");
  let s = await appearance();
  assert(s.status.includes("跟随系统（当前深色）"), "status reflects OS dark", s);
  await emulateScheme("light");
  await waitFor(`document.documentElement.dataset.mode === "light"`, "OS light applied");
  await emulateScheme("dark");
  await waitFor(`document.documentElement.dataset.mode === "dark"`, "OS dark applied again");
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]") && document.documentElement.dataset.mode === "dark"`, "dark after reload with system mode");
  s = await appearance();
  assert(s.stored?.colorMode === "system", "system persisted, not the resolved colour", s);
  assert(s.checkedMode === "system", "system radio after reload", s);
  assert(JSON.stringify(s.themes) === JSON.stringify(["native", "graphite", "cyan", "celadon"]), "themes still present", s);
});

await step("05-theme-selection", async () => {
  const palettes = {
    graphite: ["#14171b", "#86b4ea"],
    cyan: ["#0b1d31", "#5ccbea"],
    celadon: ["#151b19", "#7cc1c9"],
    native: ["#17150f", "#ff9636"],
  };
  for (const [theme, [background, primary]] of Object.entries(palettes)) {
    await evaluate(`document.querySelector('input[name=theme][value=${theme}]').click()`);
    await waitFor(`document.documentElement.dataset.theme === "${theme}"`, `theme ${theme}`);
    const tokens = await evaluate(`(() => {
      const cs = getComputedStyle(document.documentElement);
      return { background: cs.getPropertyValue("--background").trim(), primary: cs.getPropertyValue("--primary").trim() };
    })()`);
    assert(tokens.background === background && tokens.primary === primary, `palette ${theme}`, tokens);
    const s = await appearance();
    assert(s.stored?.themeId === theme, `theme ${theme} persisted`, s);
    assert(s.stored?.colorMode === "system", `mode unchanged for ${theme}`, s);
    assert(s.themes.length === 4, `four themes with ${theme}`, s);
  }
});

await step("06-write-failure", async () => {
  await evaluate(`window.__v6FailWrites = true`);
  await evaluate(`document.querySelector('input[name=color-mode][value=dark]').click()`);
  await waitFor(`!!document.querySelector("[data-testid=appearance-save-failed]")`, "save failure notice");
  const s = await appearance();
  assert(s.failed?.includes("尚未保存"), "failure notice", s);
  assert(s.saved === null, "no save claim after failure", s);
  assert(s.stored?.colorMode === "system", "failed write persisted nothing", s);
  assert(s.mode === "dark", "live preview kept", s);
});

await step("07-refresh-after-failure", async () => {
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "panel after failed save + reload");
  const s = await appearance();
  assert(s.stored?.colorMode === "system", "stored value is still system", s);
  assert(s.checkedMode === "system", "radio shows persisted value", s);
  assert(s.mode === "dark", "emulated OS still dark", s);
  assert(s.saved === null, "refresh does not claim the failed value", s);
});

await step("08-retry-saves", async () => {
  await evaluate(`window.__v6FailWrites = true`);
  await evaluate(`document.querySelector('input[name=color-mode][value=light]').click()`);
  await waitFor(`!!document.querySelector("[data-testid=appearance-save-failed]")`, "failure notice for retry");
  await evaluate(`window.__v6FailWrites = false`);
  await evaluate(`document.querySelector("[data-testid=appearance-save-failed] button").click()`);
  await waitFor(`!document.querySelector("[data-testid=appearance-save-failed]") && !!document.querySelector("[data-testid=appearance-save]")`, "retry saves");
  let s = await appearance();
  assert(s.stored?.colorMode === "light", "retry persisted the value", s);
  assert(s.mode === "light", "retry applied the value", s);
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]") && document.querySelector("input[name=color-mode]:checked")?.value === "light"`, "light after reload");
  s = await appearance();
  assert(s.mode === "light" && s.stored?.colorMode === "light", "retry survives refresh", s);
});

await step("09-keyboard-375", async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]") && innerWidth === 375`, "375px panel");
  let s = await appearance();
  assert(s.width === 375, "viewport is 375", s);

  // Tab from the top until the checked theme radio has focus.
  let reached = false;
  for (let i = 0; i < 30; i++) {
    await press("Tab", "Tab", 9);
    const focused = await evaluate(`document.activeElement?.getAttribute?.("name") ?? null`);
    if (focused === "theme") { reached = true; break; }
  }
  assert(reached, "Tab reaches the theme group", await appearance());
  await press("ArrowRight", "ArrowRight", 39);
  await waitFor(`document.querySelector("input[name=theme]:checked")?.value === "graphite"`, "keyboard changes theme");
  s = await appearance();
  assert(s.stored?.themeId === "graphite", "keyboard selection persisted", s);
  assert(s.focusVisible === true, "keyboard focus ring is visible", s);

  await press("Tab", "Tab", 9);
  const afterTab = await evaluate(`document.activeElement?.getAttribute?.("name") ?? null`);
  assert(afterTab === "color-mode", "Tab moves into the colour group", await appearance());
  await press("ArrowDown", "ArrowDown", 40);
  await waitFor(`document.querySelector("input[name=color-mode]:checked")?.value === "dark"`, "keyboard changes mode");
  s = await appearance();
  assert(s.stored?.colorMode === "dark", "keyboard mode persisted", s);
  assert(s.mode === "dark", "keyboard mode applied", s);
});

await step("10-final-native-light", async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await evaluate(`document.querySelector('input[name=theme][value=native]').click()`);
  await evaluate(`document.querySelector('input[name=color-mode][value=light]').click()`);
  await waitFor(`document.documentElement.dataset.theme === "native" && document.documentElement.dataset.mode === "light"`, "native light");
  const s = await appearance();
  assert(s.stored?.themeId === "native" && s.stored?.colorMode === "light" && s.saved?.includes("已保存"), "final state", s);
});

await step("11-final-native-dark", async () => {
  await evaluate(`document.querySelector('input[name=color-mode][value=dark]').click()`);
  await waitFor(`document.documentElement.dataset.mode === "dark" && document.querySelector("input[name=color-mode]:checked")?.value === "dark"`, "native dark");
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]") && document.documentElement.dataset.mode === "dark"`, "native dark after reload");
});

await step("12-reduced-motion", async () => {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await reload();
  await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "panel with reduced motion");
  const durations = await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector(".v6-choice"));
    return { transition: style.transitionDuration, animation: style.animationDuration };
  })()`);
  const seconds = durations.transition.split(",").map((value) => {
    const text = value.trim();
    return text.endsWith("ms") ? Number.parseFloat(text) / 1000 : Number.parseFloat(text);
  });
  assert(seconds.every((value) => value < 0.001), "reduced motion disables transitions", durations);
});

// Lifecycle: the shell keeps the saved choice across navigation, a failed save
// guards departure (stay / discard), and leaving V6 releases the root attributes.
const dialogs = [];
let acceptDialog = false;
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method !== "Page.javascriptDialogOpening") return;
  dialogs.push({ type: m.params.type, message: m.params.message, accepted: acceptDialog });
  send("Page.handleJavaScriptDialog", { accept: acceptDialog }).catch(() => {});
});
const clickNav = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const MATTERS = `.side-nav a[href$="/v6/matters"]`;
const SETTINGS = `.side-nav a[href$="/v6/settings"]`;

await step("13-navigation-keeps-saved", async () => {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await evaluate(`document.querySelector('input[name=theme][value=graphite]').click()`);
  await evaluate(`document.querySelector('input[name=color-mode][value=system]').click()`);
  await waitFor(`document.documentElement.dataset.theme === "graphite" && !!document.querySelector("[data-testid=appearance-save]")`, "graphite system saved");
  await clickNav(MATTERS);
  await waitFor(`location.pathname.endsWith("/v6/matters") && !document.querySelector("[data-testid=appearance]")`, "left settings");
  await emulateScheme("light");
  await waitFor(`document.documentElement.dataset.mode === "light"`, "OS light after navigation");
  const s = await appearance();
  assert(s.theme === "graphite", "saved theme survives navigation and OS change", s);
  assert(s.stored?.themeId === "graphite" && s.stored?.colorMode === "system", "stored record unchanged", s);
  await emulateScheme("dark");
  await waitFor(`document.documentElement.dataset.theme === "graphite" && document.documentElement.dataset.mode === "dark"`, "graphite dark after OS dark");
});

await step("14-failed-save-stay", async () => {
  await clickNav(SETTINGS);
  await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "back on settings");
  await evaluate(`window.__v6FailWrites = true`);
  await evaluate(`document.querySelector('input[name=color-mode][value=light]').click()`);
  await waitFor(`!!document.querySelector("[data-testid=appearance-save-failed]") && document.documentElement.dataset.mode === "light"`, "failed unsaved light");
  acceptDialog = false;
  const before = dialogs.length;
  await clickNav(MATTERS);
  await sleep(300);
  let s = await appearance();
  assert(dialogs.length === before + 1 && dialogs.at(-1).type === "confirm", "in-app link asks before leaving", { dialogs });
  assert(s.path.endsWith("/v6/settings") && s.failed?.includes("尚未保存"), "Stay keeps settings and the retry", s);
  await evaluate(`history.back()`);
  await sleep(500);
  s = await appearance();
  assert(dialogs.length === before + 2, "Back asks before leaving", { dialogs });
  assert(s.path.endsWith("/v6/settings") && s.failed?.includes("尚未保存") && s.mode === "light", "Stay on Back keeps the unsaved choice", s);
  return { dialogs: dialogs.slice(before) };
});

await step("15-failed-save-discard", async () => {
  acceptDialog = true;
  const before = dialogs.length;
  await clickNav(MATTERS);
  await waitFor(`location.pathname.endsWith("/v6/matters")`, "left after discard");
  await waitFor(`document.documentElement.dataset.mode === "dark"`, "saved system/dark restored");
  const s = await appearance();
  assert(dialogs.length === before + 1, "discard was confirmed", { dialogs });
  assert(s.theme === "graphite" && s.stored?.colorMode === "system", "discard returns to the saved preference", s);
  await evaluate(`window.__v6FailWrites = false`);
  acceptDialog = false;
});

await step("16-legacy-release", async () => {
  await evaluate(`[...document.querySelectorAll(".v6-shell-foot a")].find((a) => a.textContent.includes("切换到旧版")).click()`);
  await waitFor(`!location.pathname.includes("/v6") && !document.querySelector(".v6-shell")`, "legacy screen");
  let s = await appearance();
  assert(s.theme === null && s.mode === null, "legacy screen has no V6 root attributes", s);
  await evaluate(`history.back()`);
  await waitFor(`!!document.querySelector(".v6-shell") && document.documentElement.dataset.theme === "graphite"`, "V6 reapplies the saved theme");
  s = await appearance();
  assert(s.mode === "dark", "system mode resolves the OS dark on return", s);
});

const finalState = await appearance();
writeFileSync(join(outDir, "browser-log.json"), JSON.stringify({
  base,
  finalState,
  consoleErrors: errors,
  steps: log,
}, null, 2) + "\n");
ws.close();
chrome.kill();
return { log, errors, finalState };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  reportResult({ steps: outcome.log, consoleErrors: outcome.errors, finalState: outcome.finalState });
}
