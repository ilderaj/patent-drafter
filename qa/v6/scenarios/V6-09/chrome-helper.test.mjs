import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeCandidates, chromeLaunchArgs, findChrome, launchChromeWithPageTarget } from "../../helpers/chrome.mjs";

test("CHROME_PATH selects exactly the requested binary and a bad override cannot silently fall back", () => {
  assert.deepEqual(chromeCandidates({ env: { CHROME_PATH: "/custom/chrome", PATH: "/usr/bin" }, platform: "linux" }), ["/custom/chrome"]);
  assert.throws(() => findChrome({ env: { CHROME_PATH: "/missing-v6-ci-browser" }, platform: "linux" }), /没有找到可执行的 Chrome\/Chromium.*linux/s);
});

test("Chrome discovery covers Linux, macOS and executable names on PATH", () => {
  const linux = chromeCandidates({ env: { PATH: "/custom/bin" }, platform: "linux" });
  for (const path of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/google/chrome/chrome", "/custom/bin/chromium"]) {
    assert.ok(linux.includes(path), `missing Linux browser candidate: ${path}`);
  }
  const mac = chromeCandidates({ env: {}, platform: "darwin" });
  assert.equal(mac[0], "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.equal(linux[0], "/usr/bin/google-chrome");
});

test("browser discovery requires execute permission, not just an existing file", () => {
  const directory = mkdtempSync(join(tmpdir(), "v6-chrome-find-"));
  const executable = join(directory, "chrome");
  try {
    writeFileSync(executable, "synthetic browser path");
    chmodSync(executable, 0o600);
    assert.throws(() => findChrome({ env: { CHROME_PATH: executable } }), /没有找到可执行/);
    chmodSync(executable, 0o700);
    assert.equal(findChrome({ env: { CHROME_PATH: executable } }), executable);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Linux browser arguments handle sandbox and shared-memory constraints without affecting macOS", () => {
  const linux = chromeLaunchArgs({ profile: "/tmp/synthetic-profile", platform: "linux" });
  assert.ok(linux.includes("--no-sandbox"));
  assert.ok(linux.includes("--disable-dev-shm-usage"));
  assert.ok(linux.includes("--remote-debugging-port=0"));
  assert.ok(linux.includes("--user-data-dir=/tmp/synthetic-profile"));
  const mac = chromeLaunchArgs({ profile: "/tmp/synthetic-profile", platform: "darwin", width: 390, height: 844 });
  assert.ok(!mac.includes("--no-sandbox"));
  assert.ok(!mac.includes("--disable-dev-shm-usage"));
  assert.ok(mac.includes("--window-size=390,844"));
});

test("early browser exit is retried a bounded number of times with diagnostics and profiles cleaned up", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v6-chrome-exit-"));
  try {
    // Node rejects the browser flags immediately. This exercises spawn/exit
    // diagnostics without requiring Chrome or contacting any application.
    await assert.rejects(launchChromeWithPageTarget({
      executable: process.execPath, attempts: 2, portTimeoutMs: 1500,
      profileRoot: directory, profilePrefix: "failed-attempt-",
    }), (error) => {
      assert.match(error.message, /failed after 2 attempts/);
      assert.match(error.message, /attempt 1\/2/);
      assert.match(error.message, /attempt 2\/2/);
      assert.match(error.message, /Chrome exited before ready/);
      assert.match(error.message, /stderr:/);
      assert.ok(error.message.includes(process.execPath));
      return true;
    });
    assert.deepEqual(readdirSync(directory), [], "failed startup leaves no browser profiles");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("missing browser executable is reported and cleaned up without an unhandled spawn error", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v6-chrome-spawn-"));
  try {
    await assert.rejects(launchChromeWithPageTarget({
      executable: "/missing-v6-ci-browser", attempts: 1, portTimeoutMs: 1500,
      profileRoot: directory,
    }), /Chrome spawn failed:.*ENOENT/s);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
