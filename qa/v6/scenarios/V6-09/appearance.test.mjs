/**
 * V6-09 — appearance preference scenarios (S01 主题与设置).
 *
 * The suite drives `styles/preferences.ts` through its public interface with
 * in-memory storage and media fakes. A "reload" is a new storage object over
 * the same map plus a fresh read, which is all a reloaded page has. The React
 * lifecycle cases at the end bundle `lifecycle-app.tsx` (the real `/v6` app
 * under a BrowserRouter) and drive it in headless Chrome across route changes,
 * OS changes, a failed-save departure and the V6 unmount. The last case checks
 * that `qa/v6/evidence/V6-09/browser-drive.mjs` exits nonzero on failure.
 */
import test, { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { recordStep, reportResult } from "../../evidence/V6-09/browser-drive.mjs";

import {
  APPEARANCE_INVALID,
  APPEARANCE_SAVE_FAILED,
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_VERSION,
  COLOR_MODES,
  DEFAULT_APPEARANCE,
  MODE_LABELS,
  THEME_IDS,
  THEME_LABELS,
  applyAppearance,
  appearanceAttributes,
  describeAppearance,
  isAppearancePreference,
  parseAppearance,
  readAppearance,
  resolveColorMode,
  saveAppearance,
  systemPrefersDark,
  watchSystemColorMode,
} from "../../../../apps/web/src/v6/styles/preferences.ts";

/** Shared map = persistent device; the object = one page's storage handle. */
class MemoryStorage {
  constructor(map = new Map(), { failReads = 0, failWrites = 0 } = {}) {
    this.map = map;
    this.failReads = failReads;
    this.failWrites = failWrites;
    this.writes = [];
  }

  getItem(key) {
    if (this.failReads > 0) {
      this.failReads -= 1;
      throw new Error("read denied: /Users/jared/secret");
    }
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new Error("write denied: /Users/jared/secret");
    }
    this.writes.push([key, value]);
    this.map.set(key, value);
  }

  /** A new page over the same device storage. */
  reload() {
    return new MemoryStorage(this.map);
  }
}

function fakeMedia({ matches = false } = {}) {
  return {
    matches,
    listeners: new Set(),
    addEventListener(type, listener) {
      if (type === "change") this.listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "change") this.listeners.delete(listener);
    },
    emit(next) {
      this.matches = next;
      for (const listener of this.listeners) listener({ matches: next });
    },
  };
}

function legacyMedia({ matches = false } = {}) {
  return {
    matches,
    listeners: new Set(),
    addListener(listener) {
      this.listeners.add(listener);
    },
    removeListener(listener) {
      this.listeners.delete(listener);
    },
    emit(next) {
      this.matches = next;
      for (const listener of this.listeners) listener({ matches: next });
    },
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

test("V6-09-A01: the default is native/system and a saved choice reads back in a new page", () => {
  const storage = new MemoryStorage();
  const first = readAppearance(storage);
  assert.equal(first.state, "default");
  assert.deepEqual(first.preference, { themeId: "native", colorMode: "system" });

  assert.deepEqual(saveAppearance(storage, { themeId: "native", colorMode: "dark" }), { ok: true });

  const afterReload = readAppearance(storage.reload());
  assert.equal(afterReload.state, "stored");
  assert.deepEqual(afterReload.preference, { themeId: "native", colorMode: "dark" });
  assert.deepEqual(appearanceAttributes(afterReload.preference, false), {
    "data-theme": "native",
    "data-mode": "dark",
  });
});

test("V6-09-A01: every theme and colour mode is stored and read unchanged", () => {
  assert.deepEqual([...THEME_IDS], ["native", "graphite", "cyan", "celadon"]);
  assert.deepEqual([...COLOR_MODES], ["system", "light", "dark"]);

  for (const themeId of THEME_IDS) {
    for (const colorMode of COLOR_MODES) {
      const storage = new MemoryStorage();
      assert.deepEqual(saveAppearance(storage, { themeId, colorMode }), { ok: true });
      assert.deepEqual(readAppearance(storage.reload()), {
        state: "stored",
        preference: { themeId, colorMode },
      });
    }
  }
});

test("V6-09-A01: the stored record has exactly the version and the two preference fields", () => {
  const storage = new MemoryStorage();
  saveAppearance(storage, { themeId: "celadon", colorMode: "light" });
  assert.equal(storage.writes.length, 1);
  const [key, value] = storage.writes[0];
  assert.equal(key, APPEARANCE_STORAGE_KEY);
  assert.deepEqual(JSON.parse(value), {
    version: APPEARANCE_VERSION,
    themeId: "celadon",
    colorMode: "light",
  });
});

test("V6-09-A02: invalid, stale and foreign records fall back to the defaults and are reported", () => {
  const records = [
    "{not json",
    "null",
    "[]",
    JSON.stringify({ version: APPEARANCE_VERSION + 1, themeId: "native", colorMode: "system" }),
    JSON.stringify({ version: APPEARANCE_VERSION, themeId: "orange", colorMode: "system" }),
    JSON.stringify({ version: APPEARANCE_VERSION, themeId: "native", colorMode: "auto" }),
    JSON.stringify({ version: APPEARANCE_VERSION, themeId: 7, colorMode: true }),
  ];
  for (const raw of records) {
    const storage = new MemoryStorage(new Map([[APPEARANCE_STORAGE_KEY, raw]]));
    const read = readAppearance(storage);
    assert.equal(read.state, "invalid", raw);
    assert.deepEqual(read.preference, { themeId: "native", colorMode: "system" }, raw);
  }
});

test("V6-09-A02: a missing or unreadable storage is reported and a later save still works", () => {
  assert.deepEqual(readAppearance(null), {
    state: "unavailable",
    preference: { themeId: "native", colorMode: "system" },
  });

  const storage = new MemoryStorage(new Map(), { failReads: 1 });
  assert.equal(readAppearance(storage).state, "unavailable");
  assert.deepEqual(saveAppearance(storage, { themeId: "graphite", colorMode: "system" }), { ok: true });
  assert.equal(readAppearance(storage).state, "stored");
});

test("V6-09-A02: a write failure reports 尚未保存 with static text and persists nothing", () => {
  const storage = new MemoryStorage(new Map(), { failWrites: 1 });
  const result = saveAppearance(storage, { themeId: "native", colorMode: "dark" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STORAGE_UNAVAILABLE");
  assert.equal(result.message, APPEARANCE_SAVE_FAILED);
  assert.doesNotMatch(result.message, /jared|denied|secret/);
  assert.equal(storage.writes.length, 0);
  assert.equal(readAppearance(storage).state, "default");

  assert.equal(saveAppearance(null, { themeId: "native", colorMode: "dark" }).code, "STORAGE_UNAVAILABLE");
});

test("V6-09-A02: invalid save input is refused before storage is touched", () => {
  const storage = new MemoryStorage();
  const result = saveAppearance(storage, { themeId: "orange", colorMode: "dark" });
  assert.deepEqual(result, { ok: false, code: "INVALID_INPUT", message: APPEARANCE_INVALID });
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.map.size, 0);
});

test("V6-09-A02: unknown fields in a stored record are ignored, not trusted", () => {
  const raw = JSON.stringify({
    version: APPEARANCE_VERSION,
    themeId: "cyan",
    colorMode: "light",
    matters: [{ title: "秘密案件" }],
    modelKey: "sk-secret",
  });
  const storage = new MemoryStorage(new Map([[APPEARANCE_STORAGE_KEY, raw]]));
  const read = readAppearance(storage);
  assert.equal(read.state, "stored");
  assert.deepEqual(read.preference, { themeId: "cyan", colorMode: "light" });
  assert.deepEqual(Object.keys(read.preference).sort(), ["colorMode", "themeId"]);
});

test("V6-09-A03: saving the same preference twice produces one identical record", () => {
  const storage = new MemoryStorage();
  const preference = { themeId: "graphite", colorMode: "dark" };
  saveAppearance(storage, preference);
  saveAppearance(storage, preference);
  assert.equal(storage.writes.length, 2);
  assert.equal(new Set(storage.writes.map(([, value]) => value)).size, 1);
  assert.equal(storage.map.size, 1);
  assert.deepEqual(readAppearance(storage.reload()).preference, preference);
});

test("V6-09-A03: a failed save followed by a retry persists the retried value once", () => {
  const storage = new MemoryStorage(new Map(), { failWrites: 1 });
  const preference = { themeId: "celadon", colorMode: "dark" };

  const first = saveAppearance(storage, preference);
  assert.equal(first.ok, false);
  assert.equal(readAppearance(storage).state, "default");

  const retry = saveAppearance(storage, preference);
  assert.deepEqual(retry, { ok: true });
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(readAppearance(storage.reload()).preference, preference);
});

test("V6-09-A03: a reload does not claim a value whose write failed", () => {
  const storage = new MemoryStorage();
  saveAppearance(storage, { themeId: "native", colorMode: "dark" });

  const failing = new MemoryStorage(storage.map, { failWrites: 1 });
  const result = saveAppearance(failing, { themeId: "native", colorMode: "light" });
  assert.equal(result.ok, false);

  // Refresh: the stored record from the last successful write is what shows.
  assert.deepEqual(readAppearance(storage.reload()).preference, {
    themeId: "native",
    colorMode: "dark",
  });
});

test("V6-09-A03: pure calls repeat identically and never mutate their input", () => {
  const preference = deepFreeze({ themeId: "cyan", colorMode: "system" });
  assert.equal(isAppearancePreference(preference), true);

  const first = appearanceAttributes(preference, true);
  const second = appearanceAttributes(preference, true);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { "data-theme": "cyan", "data-mode": "dark" });
  assert.equal(Object.isFrozen(preference), true);

  const root = { dataset: {} };
  applyAppearance(root, preference, true);
  applyAppearance(root, preference, true);
  assert.deepEqual(root.dataset, { theme: "cyan", mode: "dark" });

  const parsed = parseAppearance(preference);
  assert.deepEqual(parsed, preference);
  assert.notEqual(parsed, preference);
  assert.equal(describeAppearance(preference, true), describeAppearance(preference, true));
});

test("V6-09-A03: applying a new preference overwrites stale attributes", () => {
  const root = { dataset: { theme: "graphite", mode: "dark" } };
  applyAppearance(root, { themeId: "native", colorMode: "light" }, true);
  assert.deepEqual(root.dataset, { theme: "native", mode: "light" });
});

test("S01-A03: system follows the OS and an explicit mode ignores it", () => {
  assert.equal(resolveColorMode({ themeId: "native", colorMode: "system" }, false), "light");
  assert.equal(resolveColorMode({ themeId: "native", colorMode: "system" }, true), "dark");
  assert.equal(resolveColorMode({ themeId: "native", colorMode: "light" }, true), "light");
  assert.equal(resolveColorMode({ themeId: "native", colorMode: "dark" }, false), "dark");
  assert.equal(systemPrefersDark(null), false);
});

test("S01-A03: a runtime OS change reaches the subscriber and unsubscribe stops it", () => {
  const media = fakeMedia({ matches: false });
  const seen = [];
  const stop = watchSystemColorMode(media, (prefersDark) => seen.push(prefersDark));
  assert.deepEqual(seen, []);

  media.emit(true);
  media.emit(false);
  assert.deepEqual(seen, [true, false]);

  stop();
  media.emit(true);
  assert.deepEqual(seen, [true, false]);
});

test("S01-A03: the legacy addListener fallback works and is removed by the same stop call", () => {
  const media = legacyMedia({ matches: true });
  const seen = [];
  const stop = watchSystemColorMode(media, (prefersDark) => seen.push(prefersDark));
  media.emit(false);
  assert.deepEqual(seen, [false]);
  stop();
  media.emit(true);
  assert.deepEqual(seen, [false]);
  assert.equal(watchSystemColorMode(null, () => {})(), undefined);
});

test("S01-A03: the status text names the theme and the resolved mode", () => {
  assert.equal(describeAppearance({ themeId: "native", colorMode: "system" }, true), "原生 · 跟随系统（当前深色）");
  assert.equal(describeAppearance({ themeId: "native", colorMode: "system" }, false), "原生 · 跟随系统（当前浅色）");
  assert.equal(describeAppearance({ themeId: "graphite", colorMode: "light" }, true), "石墨 · 浅色");
  assert.equal(describeAppearance({ themeId: "cyan", colorMode: "dark" }, false), "晒图 · 深色");
  assert.deepEqual(THEME_LABELS, { native: "原生", graphite: "石墨", cyan: "晒图", celadon: "青瓷" });
  assert.deepEqual(MODE_LABELS, { system: "跟随系统", light: "浅色", dark: "深色" });
  assert.deepEqual(DEFAULT_APPEARANCE, { themeId: "native", colorMode: "system" });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const KEY = JSON.stringify(APPEARANCE_STORAGE_KEY);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The React regressions below run the real provider, page, shell and
 * BrowserRouter. A local HTTP server inside the test serves the bundle; Chrome
 * is driven over CDP and nothing reaches a provider. Each case starts from a
 * full-page navigation, so state from a previous case cannot mask a defect.
 */
describe("V6-09 React lifecycle in headless Chrome", () => {
  let chrome;
  let server;
  let ws;
  let send;
  let evaluate;
  let waitFor;
  let reset;
  let click;
  let documentAttributes;
  let emulateScheme;
  const errors = [];

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "v6-09-lifecycle-"));
    const outfile = join(dir, "app.js");
    await esbuild.build({
      entryPoints: [join(HERE, "lifecycle-app.tsx")],
      bundle: true,
      outfile,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const bundle = readFileSync(outfile, "utf8");
    const index = `<!doctype html><html><head><meta charset="utf-8"><title>V6-09 lifecycle</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (pathname === "/app.js") {
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        response.end(bundle);
      } else if (pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
      } else {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(index);
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${server.address().port}`;

    const profile = mkdtempSync(join(tmpdir(), "v6-09-chrome-"));
    chrome = spawn(CHROME, [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--window-size=1280,860", "about:blank",
    ], { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
    assert.ok(existsSync(portFile), "Chrome did not expose a DevTools port");
    const [port] = readFileSync(portFile, "utf8").split("\n");

    let targets;
    for (let i = 0; i < 50; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        if (targets.some((target) => target.type === "page")) break;
      } catch {}
      await sleep(100);
    }
    const page = targets?.find((target) => target.type === "page");
    assert.ok(page, "Chrome exposed no page target");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      ws.addEventListener("open", done, { once: true });
      ws.addEventListener("error", fail, { once: true });
    });

    let id = 0;
    const pending = new Map();
    send = (method, params = {}) => new Promise((resolveSend, reject) => {
      const next = ++id;
      pending.set(next, (message) => (message.error ? reject(new Error(JSON.stringify(message.error))) : resolveSend(message.result)));
      ws.send(JSON.stringify({ id: next, method, params }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
      }
      if (message.method === "Page.javascriptDialogOpening") {
        void send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    });

    evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} :: ${expression}`);
      return result.result.value;
    };
    waitFor = async (expression, label) => {
      for (let i = 0; i < 80; i++) {
        if (await evaluate(expression)) return;
        await sleep(100);
      }
      throw new Error(`timeout waiting for ${label}`);
    };
    click = (selector) => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("missing " + ${JSON.stringify(selector)});
      element.click();
      return true;
    })()`);
    documentAttributes = () => evaluate(`({
      theme: document.documentElement.getAttribute("data-theme"),
      mode: document.documentElement.getAttribute("data-mode"),
    })`);
    emulateScheme = async (value) => {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
      await sleep(150);
    };
    reset = async (path) => {
      await send("Page.navigate", { url: base + "/patent/projects" });
      await waitFor(`!!document.querySelector("[data-testid=legacy]")`, "legacy reset page");
      await evaluate(`localStorage.clear(); window.__v6FailWrites = false; window.__v6ConfirmAnswer = true; true`);
      await emulateScheme("light");
      await send("Page.navigate", { url: base + path });
      await sleep(200);
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const original = Storage.prototype.setItem;
        window.__v6FailWrites = false;
        window.__v6ConfirmAnswer = true;
        window.confirm = () => window.__v6ConfirmAnswer;
        Storage.prototype.setItem = function (key, value) {
          if (window.__v6FailWrites) throw new DOMException("Quota exceeded", "QuotaExceededError");
          return original.call(this, key, value);
        };
      })();`,
    });
  });

  after(async () => {
    ws?.close();
    chrome?.kill();
    if (server) await new Promise((done) => server.close(done));
  });

  it("keeps a saved preference across navigation and runtime OS changes", async () => {
    await reset("/patent/v6/settings");
    await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "appearance panel");
    await click("input[name=theme][value=celadon]");
    await waitFor(
      `JSON.parse(localStorage.getItem(${KEY}) ?? "null")?.themeId === "celadon" && !!document.querySelector("[data-testid=appearance-save]")`,
      "celadon saved",
    );

    await click('[aria-label="全局导航"] a[href="/patent/v6/matters"]');
    await waitFor(`location.pathname === "/patent/v6/matters" && !document.querySelector("[data-testid=appearance]")`, "matters page");
    assert.equal((await documentAttributes()).theme, "celadon", "the saved theme survives leaving settings");

    // Fails if a shell-level copy of the first-read preference repaints the
    // root when the OS changes after the user saved and navigated away.
    await emulateScheme("dark");
    await waitFor(`document.documentElement.dataset.mode === "dark" && document.documentElement.dataset.theme === "celadon"`, "OS dark with celadon");
    await emulateScheme("light");
    await waitFor(`document.documentElement.dataset.mode === "light" && document.documentElement.dataset.theme === "celadon"`, "OS light with celadon");

    await click('[aria-label="全局导航"] a[href="/patent/v6/settings"]');
    await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "settings again");
    assert.deepEqual(await evaluate(`({
      theme: document.querySelector("input[name=theme]:checked")?.value ?? null,
      mode: document.querySelector("input[name=color-mode]:checked")?.value ?? null,
      stored: JSON.parse(localStorage.getItem(${KEY}) ?? "null"),
    })`), {
      theme: "celadon",
      mode: "system",
      stored: { version: APPEARANCE_VERSION, themeId: "celadon", colorMode: "system" },
    });
    assert.deepEqual(errors, [], "no console errors");
  });

  it("keeps a failed save until the user explicitly discards it", async () => {
    await reset("/patent/v6/settings");
    await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "appearance panel");
    await click('[aria-label="全局导航"] a[href="/patent/v6/matters"]');
    await waitFor(`location.pathname === "/patent/v6/matters"`, "matters before failure");
    await click('[aria-label="全局导航"] a[href="/patent/v6/settings"]');
    await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "settings before failure");

    await evaluate(`window.__v6FailWrites = true`);
    await click("input[name=color-mode][value=dark]");
    await waitFor(`!!document.querySelector("[data-testid=appearance-save-failed]")`, "failure notice");
    assert.equal(await evaluate(`localStorage.getItem(${KEY})`), null, "failed write stored nothing");
    assert.equal((await documentAttributes()).mode, "dark", "live preview kept");

    const unloadAllowed = await evaluate(`window.dispatchEvent(new Event("beforeunload", { cancelable: true }))`);
    assert.equal(unloadAllowed, false, "unload is blocked while the save failed");

    await evaluate(`window.__v6ConfirmAnswer = false`);
    await click('[aria-label="全局导航"] a[href="/patent/v6/matters"]');
    await sleep(250);
    assert.equal(await evaluate(`location.pathname`), "/patent/v6/settings", "Stay keeps the link on settings");
    assert.ok(await evaluate(`!!document.querySelector("[data-testid=appearance-save-failed]")`), "failure notice remains");

    await evaluate(`history.back()`);
    await sleep(500);
    assert.equal(await evaluate(`location.pathname`), "/patent/v6/settings", "Stay keeps browser Back on settings");
    assert.ok(await evaluate(`!!document.querySelector("[data-testid=appearance-save-failed]")`), "failure notice remains after Back");
    assert.equal(await evaluate(`document.querySelector("input[name=color-mode]:checked")?.value`), "dark", "unsaved choice remains after Back");

    await evaluate(`window.__v6ConfirmAnswer = true`);
    await click('[aria-label="全局导航"] a[href="/patent/v6/matters"]');
    await waitFor(`location.pathname === "/patent/v6/matters"`, "discard leaves settings");
    await click('[aria-label="全局导航"] a[href="/patent/v6/settings"]');
    await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "settings after discard");
    assert.deepEqual(await evaluate(`({
      failed: !!document.querySelector("[data-testid=appearance-save-failed]"),
      mode: document.querySelector("input[name=color-mode]:checked")?.value ?? null,
      root: document.documentElement.dataset.mode,
      stored: localStorage.getItem(${KEY}),
    })`), { failed: false, mode: "system", root: "light", stored: null });
    assert.equal(
      await evaluate(`window.dispatchEvent(new Event("beforeunload", { cancelable: true }))`),
      true,
      "unload is allowed again after discarding",
    );
    assert.deepEqual(errors, [], "no console errors");
  });

  it("restores the previous document attributes when V6 unmounts", async () => {
    await reset("/patent/projects");
    await waitFor(`!!document.querySelector("[data-testid=legacy]")`, "legacy page");
    await evaluate(`document.documentElement.setAttribute("data-theme", "legacy-orange"); document.documentElement.setAttribute("data-mode", "dark"); true`);
    await click("[data-testid=legacy-to-v6]");
    await waitFor(`!!document.querySelector("[data-testid=appearance]")`, "appearance panel");
    await click("input[name=theme][value=graphite]");
    await waitFor(`document.documentElement.dataset.theme === "graphite"`, "graphite applied");

    await click('a[href="/patent/projects"]');
    await waitFor(`!!document.querySelector("[data-testid=legacy]")`, "legacy after V6");
    assert.deepEqual(await documentAttributes(), { theme: "legacy-orange", mode: "dark" }, "legacy attributes restored");
    assert.equal(
      await evaluate(`JSON.parse(localStorage.getItem(${KEY})).themeId`),
      "graphite",
      "unmount does not undo a successful save",
    );
    assert.deepEqual(errors, [], "no console errors");
  });
});

test("V6-09 browser harness exits nonzero on failed steps or console errors", async () => {
  const log = [];
  const shots = [];
  const context = {
    log,
    appearance: async () => ({ path: "/patent/v6/settings" }),
    shot: async (name) => shots.push(name),
  };

  await recordStep("passes", async () => "ok", context);
  await recordStep("fails", async () => { throw new Error("assertion exploded"); }, context);
  await recordStep("cannot read page", async () => { throw new Error("assertion exploded"); }, {
    log,
    appearance: async () => { throw new Error("page gone"); },
    shot: async () => { throw new Error("no screenshot"); },
  });
  assert.equal(log[0].ok, true);
  assert.equal(log[1].ok, false);
  assert.match(log[1].error, /assertion exploded/);
  assert.equal(log[2].ok, false);
  assert.deepEqual(log[2].state, {});
  assert.deepEqual(shots, ["passes", "fails"]);

  const originalLog = console.log;
  const originalExit = process.exitCode;
  console.log = () => {};
  try {
    process.exitCode = 0;
    reportResult({ steps: [{ ok: true }], consoleErrors: [], finalState: {} });
    assert.equal(process.exitCode, 0, "a clean run exits 0");

    process.exitCode = 0;
    reportResult({ steps: [{ ok: false }], consoleErrors: [], finalState: {} });
    assert.equal(process.exitCode, 1, "a failed step exits nonzero");

    process.exitCode = 0;
    reportResult({ steps: [{ ok: true }], consoleErrors: ["Uncaught TypeError"], finalState: {} });
    assert.equal(process.exitCode, 1, "console errors fail the run even when every step passed");

    process.exitCode = 0;
    reportResult({ steps: [], consoleErrors: [], finalState: {} });
    assert.equal(process.exitCode, 1, "a run without steps is not a pass");
  } finally {
    console.log = originalLog;
    process.exitCode = originalExit;
  }
});
