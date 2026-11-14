#!/usr/bin/env python3
"""Real-mode browser acceptance (link acceptance, NOT model-quality acceptance).

Runs against the local environment started by accept-env.mjs:
  full          -> real mode (status -> access code -> consent -> chat via a synthetic upstream)
  unconfigured  -> falls back to test mode and says why
  undisclosed   -> configured but processor facts missing: real drafting unavailable
The original test-mode full-flow regression is kept: run_online.py (unchanged) is executed against
the `unconfigured` instance as a subprocess (see run_test_mode_regression()).

Business changes use only visible controls. Read-only IndexedDB/storage inspection is used for two
assertions (cancel does not touch the matter; the access code is never persisted) and is declared in
the evidence constraints. No storage fixture injection, no product code changes.

Env: REAL_AI_STATE=<state.json from accept-env.mjs>  REAL_AI_OUT=<output dir>
     REAL_AI_ONLY=<comma list of scenario names>  REAL_AI_SKIP_TIMEOUT=1 (skip the ~95 s timeout case)
     REAL_AI_DRY_RUN=1 marks the run as a dry run (written into the report; formal runs must not set it)
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from playwright.sync_api import Page, TimeoutError, sync_playwright

HERE = Path(__file__).resolve().parent
WORKTREE = HERE.parents[2]
STATE = json.loads(Path(os.environ["REAL_AI_STATE"]).read_text(encoding="utf-8"))
OUT = Path(os.environ.get("REAL_AI_OUT", HERE / "run-1"))
OUT.mkdir(parents=True, exist_ok=True)
ONLY = {s for s in os.environ.get("REAL_AI_ONLY", "").split(",") if s}
FULL = STATE["instances"]["full"]["url"]
UNCONFIGURED = STATE["instances"]["unconfigured"]["url"]
UNDISCLOSED = STATE["instances"]["undisclosed"]["url"]
UPSTREAM = STATE["upstream"]["url"]
SECRETS = STATE["secrets"]
FIXTURE = HERE / "fixtures/intake-source.txt"
EXTRA_FIXTURE = HERE / "fixtures/extra-source.txt"
PASSPHRASE = "V6-real-ai-acceptance-only-2026"

os.environ["ONLINE_BASE"] = FULL
os.environ["ONLINE_OUT"] = str(OUT / "_helpers")
ONLINE = WORKTREE / "qa/v6/evidence/release/deploy/2026-11-11/run_online.py"
spec = importlib.util.spec_from_file_location("run_online", ONLINE)
assert spec and spec.loader
ro = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ro
spec.loader.exec_module(ro)
acc = ro.acc
visible, wait_dom, goto, wait_ready = ro.visible, ro.wait_dom, ro.goto, ro.wait_ready
TEST_MARKER = re.compile(r"测试输出|本地测试稿|测试生成|测试草稿|stub", re.I)
SYNTH = "合成验收输出"
ANSWER_ONLY = {
    "problem": SECRETS["answer1"],
    "difference": SECRETS["answer2"],
    "inventor": SECRETS["localInventor"],
    "disclosure": SECRETS["localDisclosure"],
    "maturity": SECRETS["localMaturity"],
}


def use_instance(url: str) -> None:
    """run_online helpers read these module globals."""
    ro.APP_ROOT = url
    ro.BASE = f"{url}/v6"


# ---- fake upstream ------------------------------------------------------------------------------
def up_call(path: str, body: Any | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"{UPSTREAM}{path}", data=data, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode())


def up_stats() -> dict[str, Any]:
    return up_call("/__stats")


def up_fault(mode: str, times: int | None = None) -> None:
    up_call("/__control", {"mode": mode, **({"times": times} if times else {})})


# ---- network / log observation ------------------------------------------------------------------
class Net:
    """Metadata only. Bodies are inspected in memory for secrets and then dropped."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.api: list[dict[str, Any]] = []
        self.console: list[str] = []
        self.set_cookie: list[str] = []
        self.body_flags: list[dict[str, Any]] = []
        self.t0 = time.time()

    def attach_context(self, context: Any) -> None:
        context.on("request", self._request)
        context.on("response", self._response)

    def attach_page(self, page: Page) -> None:
        page.on("console", lambda m: self.console.append(f"{m.type}: {m.text}"[:400]))

    def _request(self, request: Any) -> None:
        parsed = urlparse(request.url)
        item = {"t": round(time.time() - self.t0, 2), "method": request.method, "origin": f"{parsed.scheme}://{parsed.netloc}",
                "path": parsed.path, "type": request.resource_type}
        self.requests.append(item)
        if parsed.path in ("/api/v6/chat", "/api/v6/session") and request.method == "POST":
            body = request.post_data or ""
            self.body_flags.append({"path": parsed.path, "bytes": len(body.encode()),
                                    "containsAccessCode": SECRETS["accessCode"] in body and parsed.path != "/api/v6/session",
                                    "containsModelKey": SECRETS["modelKey"] in body, "containsSessionSecret": SECRETS["sessionSecret"] in body})

    def _response(self, response: Any) -> None:
        parsed = urlparse(response.url)
        if parsed.path == "/api/v6/session":
            try:
                values = response.header_values("set-cookie")
            except Exception:
                values = []
            for value in values:
                self.set_cookie.append(value)
        if parsed.path.startswith("/api/v6/"):
            self.api.append({"t": round(time.time() - self.t0, 2), "path": parsed.path, "method": response.request.method, "status": response.status})

    def count(self, path: str, method: str = "POST") -> int:
        return len([r for r in self.requests if r["path"] == path and r["method"] == method])

    def statuses(self, path: str) -> list[int]:
        return [r["status"] for r in self.api if r["path"] == path and r["method"] == "POST"]


NET = Net()


# ---- evidence helpers ---------------------------------------------------------------------------
EVIDENCE = acc.Evidence(OUT / "acceptance-evidence")
EVIDENCE.started_at = datetime.now(timezone.utc).isoformat()
RESULTS: list[dict[str, Any]] = []


def consent_count() -> int:
    return NET.count("/api/v6/consent")


def ck(name: str, ok: bool, detail: str = "", page: Page | None = None, **extra: Any) -> bool:
    RESULTS.append({"name": name, "ok": bool(ok), "detail": detail[:600], **extra})
    if page is not None:
        ro.rec(EVIDENCE, name, page, "pass" if ok else "fail", detail[:600], **extra)
    else:
        EVIDENCE.records.append({"name": name, "status": "pass" if ok else "fail", "detail": detail[:600], **extra})
    if not ok:
        EVIDENCE.failures.append({"step": name, "reason": detail[:600]})
    EVIDENCE.write_partial()
    return bool(ok)


def note(name: str, page: Page, detail: str = "", **extra: Any) -> None:
    ro.rec(EVIDENCE, name, page, "observed", detail, **extra)


def blocked(name: str, reason: str, page: Page | None = None) -> None:
    RESULTS.append({"name": name, "ok": False, "blocked": True, "detail": reason[:600]})
    EVIDENCE.block(name, reason, page)


def tid(page: Page, testid: str):
    return visible(page.get_by_test_id(testid))


def chat_ok(expected_total: int | None = None) -> tuple[int, int]:
    """(browser chat requests, upstream requests) — both must agree."""
    return NET.count("/api/v6/chat"), up_stats()["total"]


IDB_JS = """async () => {
  const out = {}; const dbs = await indexedDB.databases();
  for (const {name} of dbs) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    out[name] = {};
    for (const store of [...db.objectStoreNames]) {
      const keys = await new Promise(res => { const r = db.transaction(store).objectStore(store).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
      let h = 0; for (const ch of JSON.stringify(keys)) h = (h * 31 + ch.charCodeAt(0)) | 0;
      out[name][store] = keys.length + ':' + h;
    }
    db.close();
  }
  return out;
}"""

STORAGE_SCAN_JS = """async (needle) => {
  const hit = {localStorage: false, sessionStorage: false, indexedDB: false, cookie: document.cookie.includes(needle)};
  for (const area of ['localStorage', 'sessionStorage']) {
    for (let i = 0; i < window[area].length; i++) { const k = window[area].key(i); if (k.includes(needle) || (window[area].getItem(k) || '').includes(needle)) hit[area] = true; }
  }
  const dbs = await indexedDB.databases();
  for (const {name} of dbs) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const store of [...db.objectStoreNames]) {
      const all = await new Promise(res => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
      try { if (JSON.stringify(all, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) ? '' : v).includes(needle)) hit.indexedDB = true; } catch (e) {}
    }
    db.close();
  }
  return hit;
}"""


def idb_snapshot(page: Page) -> dict[str, Any]:
    return page.evaluate(IDB_JS)


def storage_leaks(page: Page, needle: str) -> dict[str, bool]:
    return page.evaluate(STORAGE_SCAN_JS, needle)


def new_context(browser: Any, base: str, **kw: Any) -> tuple[Any, Page]:
    context = browser.new_context(**acc.BASELINE, accept_downloads=True, color_scheme="light", **kw)
    NET.attach_context(context)
    EVIDENCE.attach_context(context, urlparse(base).netloc)
    page = context.new_page()
    EVIDENCE.attach(page)
    NET.attach_page(page)
    page._acceptance_base = base  # type: ignore[attr-defined]
    return context, page


def wait_generation_control(page: Page, timeout_ms: int = 25000) -> Any:
    """The engine mounts after the runtime resolves (status + consent); wait for its control."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        control = tid(page, "generation-retry") or tid(page, "generation-start")
        if control is not None and control.is_enabled():
            return control
        page.wait_for_timeout(400)
    return None


def click_and_wait_job(page: Page, control: Any, timeout_ms: int) -> str | None:
    """Click start/retry and wait for *this* job to reach a terminal state.

    The panel keeps the previous job's terminal state until React re-renders, so a
    change signal (a new chat request) is required before the state is trusted.
    """
    before = NET.count("/api/v6/chat")
    control.click()
    # Observe the new job's running phase first, so the previous job's terminal state is not reused.
    try:
        page.wait_for_selector('[data-testid="generation-cancel"]', timeout=8000)
    except TimeoutError:
        pass
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        node = page.get_by_test_id("generation")
        if node.count() == 0:
            page.wait_for_timeout(250)
            continue
        state = node.first.get_attribute("data-job-state")
        if state in ("succeeded", "failed", "cancelled", "interrupted") and NET.count("/api/v6/chat") > before:
            return state
        page.wait_for_timeout(250)
    node = page.get_by_test_id("generation")
    return node.first.get_attribute("data-job-state") if node.count() else None


def wait_job_end(page: Page, timeout_ms: int) -> str | None:
    try:
        page.wait_for_function(
            """() => { const g = document.querySelector('[data-testid="generation"]');
                       const s = g && g.getAttribute('data-job-state');
                       return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(s); }""", timeout=timeout_ms)
    except TimeoutError:
        return None
    return page.get_by_test_id("generation").first.get_attribute("data-job-state")


def safe_goto(page: Page, url: str, attempts: int = 2) -> None:
    for attempt in range(attempts):
        try:
            goto(page, url)
            return
        except Exception:
            if attempt == attempts - 1:
                raise
            page.wait_for_timeout(1500)


def status_json(base: str) -> dict[str, Any]:
    with urllib.request.urlopen(f"{base}/api/v6/status", timeout=10) as r:
        return json.loads(r.read().decode())


# ---- scenario state shared across steps ---------------------------------------------------------
S: dict[str, Any] = {}


def self_generate_url(matter_id: str, target_id: str) -> str:
    return f"{FULL}/v6/new/{matter_id}/generate?target={target_id}"


def draft_url(matter_id: str, target_id: str) -> str:
    return f"{FULL}/v6/matters/{matter_id}/targets/{target_id}/draft"


def open_consent(page: Page, trigger: str = "self-runtime-consent-open", panel: str = "self-consent-disclosure") -> None:
    """Click the opener and wait until the sheet is painted with its content."""
    button = tid(page, trigger)
    if button is None or not button.is_enabled():
        raise RuntimeError(f"{trigger} unavailable")
    button.click()
    page.get_by_test_id(panel).wait_for(state="visible", timeout=15000)
    page.wait_for_function(
        """id => { const el = document.querySelector(`[data-testid="${id}"]`); return !!el && el.innerText.trim().length > 20; }""",
        arg=panel, timeout=10000)


NOTICE_JS = """() => {
  const ids = ['preview-test-output','done-test-output-label','delivery-test-output-label','workbench-test-output','generation-test-output'];
  const counts = {};
  for (const id of ids) counts[id] = [...document.querySelectorAll(`[data-testid="${id}"]`)].filter(e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }).length;
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.flagged = [...document.querySelectorAll('[data-test-output="true"]')].length;
  return counts;
}"""


def notice_counts(page: Page) -> dict[str, int]:
    return page.evaluate(NOTICE_JS)


def agree_consent(page: Page, attempts: int = 2) -> tuple[bool, str]:
    """Open the consent sheet if needed and agree.

    A grant can be refused when the material manifest is still settling (parsing right
    after an upload) or when the server configuration changed; the sheet then stays open
    with an error, so the next attempt re-reads the runtime and tries again.
    """
    last = "no attempt"
    for _ in range(attempts):
        page.evaluate("() => { const d = document.querySelector('[data-testid=workbench-generation-panel]'); if (d) d.open = true; }")
        if tid(page, "workbench-consent-disclosure") is None and page.locator(".scrim").count() > 0:
            try:
                page.wait_for_selector(".scrim", state="detached", timeout=3000)
            except TimeoutError:
                pass
        if tid(page, "workbench-consent-disclosure") is None:
            # The opener is disabled while the runtime is (re)resolving; wait, then click.
            try:
                page.wait_for_selector('[data-testid="workbench-runtime-consent-open"]:not([disabled])', timeout=15000)
            except TimeoutError:
                last = "opener stayed disabled"
                page.wait_for_timeout(1500)
                continue
            page.get_by_test_id("workbench-runtime-consent-open").first.click()
            page.wait_for_timeout(500)
        try:
            page.wait_for_selector('[data-testid="workbench-consent-disclosure"]', timeout=15000)
        except TimeoutError:
            last = "sheet did not open"
            continue
        try:
            page.wait_for_selector('[data-testid="workbench-consent-agree"]:not([disabled])', timeout=15000)
        except TimeoutError:
            last = "agree button stayed disabled"
            continue
        page.get_by_test_id("workbench-consent-agree").first.click()
        try:
            page.wait_for_selector('[data-testid="workbench-consent-disclosure"]', state="detached", timeout=15000)
            return True, "agreed"
        except TimeoutError:
            err = tid(page, "workbench-consent-error")
            last = (err.inner_text() if err else "sheet stayed open").strip()[:200]
            cancel = page.get_by_role("button", name="取消")
            if cancel.count():
                cancel.first.click()
            page.wait_for_timeout(1500)
    return False, last


def card_state(page: Page, testid: str) -> dict[str, Any]:
    """Visibility-independent card facts (a card inside a scroll container can be off-screen)."""
    return page.evaluate("""(id) => {
      const nodes = [...document.querySelectorAll('[data-testid="' + id + '"]')];
      const el = nodes[0];
      if (!el) return { exists: false, count: 0 };
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      const input = el.querySelector('input[type=radio]');
      return { exists: true, count: nodes.length, display: s.display, visibility: s.visibility, opacity: s.opacity,
               width: Math.round(r.width), height: Math.round(r.height), text: (el.innerText || '').slice(0, 300),
               reason: el.getAttribute('data-disabled-reason'), inputDisabled: input ? input.disabled : null };
    }""", testid)


def wait_for_consent_prompt(page: Page, timeout: int = 40000) -> None:
    """A real-mode page shows either the consent sheet (auto-opened) or the 'needs consent' callout.

    Resolving the runtime re-reads status, targets, materials and the consent ledger, which can
    take a while right after an adoption; the sheet opens on the first real+required resolution.
    """
    try:
        page.wait_for_selector('[data-testid="workbench-consent-disclosure"]', timeout=timeout)
        return
    except TimeoutError:
        pass
    try:
        page.wait_for_selector('[data-testid="workbench-runtime-consent-required"]', timeout=5000)
    except TimeoutError:
        pass


def open_gen_strip(page: Page) -> None:
    details = visible(page.get_by_test_id("workbench-generation-panel"))
    if details is not None and not page.evaluate("el => el.open", details.element_handle()):
        details.locator("summary").first.click()
        page.wait_for_timeout(300)


# ---- scenarios ----------------------------------------------------------------------------------
def s_env(page: Page) -> None:
    """Server contract as the browser will see it."""
    full = status_json(FULL)
    ck("env-full-status", full["available"] and full["configured"] and not full["authenticated"],
       f"available={full['available']} configured={full['configured']} authenticated={full['authenticated']} model={full['model']}")
    S["status"] = full
    unc = status_json(UNCONFIGURED)
    ck("env-unconfigured-status", not unc["configured"] and not unc["available"] and bool(unc["unavailableReason"]), unc["unavailableReason"] or "")
    und = status_json(UNDISCLOSED)
    ck("env-undisclosed-status", und["configured"] and not und["available"] and bool(und["unavailableReason"]), und["unavailableReason"] or "")
    leaked = json.dumps([full, unc, und], ensure_ascii=False)
    ck("env-status-no-secrets", not any(SECRETS[k] in leaked for k in ("modelKey", "accessCode", "sessionSecret")) and "invalid" not in leaked,
       "status 不含密钥/访问码/会话 secret/上游地址")
    root = page.context.request.get(f"{FULL}/", max_redirects=0)
    ck("env-root-redirect", root.status in (301, 302, 303, 307, 308) and root.headers.get("location") == "/v6", f"{root.status} {root.headers.get('location')}")


def s_seed(page: Page) -> None:
    """Material path up to the self-service generate step, plus the synthetic fact/figure used by the test flow."""
    use_instance(FULL)
    matter_id = ro.upload_and_enter_questions(page, FIXTURE, EVIDENCE)
    if not matter_id:
        raise RuntimeError("upload/question entry failed")
    S["matter"] = matter_id
    if not ro.answer_questions(page, FULL, matter_id, True, EVIDENCE):
        raise RuntimeError("questions failed")
    target = ro.choose_route(page, FULL, matter_id, EVIDENCE)
    if not target:
        raise RuntimeError("route failed")
    S["target"] = target
    acc.confirm_synthetic_fact(page, FULL, matter_id, EVIDENCE)
    acc.ensure_synthetic_figure_when_missing(page, FULL, matter_id, target, EVIDENCE)
    ck("seed-no-chat-before-consent", NET.count("/api/v6/chat") == 0 and up_stats()["total"] == 0,
       f"browser chat={NET.count('/api/v6/chat')} upstream={up_stats()['total']}")


def s_gate_before_consent(page: Page) -> None:
    goto(page, self_generate_url(S["matter"], S["target"]))
    page.wait_for_timeout(1500)
    test_note = tid(page, "self-runtime-test")
    ck("gate-unauthenticated-explains-test-mode", test_note is not None and "访问码" in test_note.inner_text(),
       (test_note.inner_text() if test_note else "no self-runtime-test")[:200], page)
    ck("gate-no-chat-on-load", NET.count("/api/v6/chat") == 0 and up_stats()["total"] == 0, "页面加载与状态读取不发 /api/v6/chat")
    ck("gate-no-consent-before-confirm", consent_count() == 0, "读取状态/打开确认弹层不调用 POST /api/v6/consent（resolver 只读）")
    # AI page before any session: server status decides the state
    goto(page, f"{FULL}/v6/ai")
    page.get_by_test_id("ai-service-status").wait_for(state="visible", timeout=15000)
    page.wait_for_selector('[data-testid="ai-service-status"]:not([data-state="unknown"])', timeout=15000)
    st = tid(page, "ai-service-status")
    ck("ai-state-auth_required", st.get_attribute("data-state") == "auth_required", st.inner_text()[:200], page)
    ck("ai-state-processor-fields", all(tid(page, f"ai-service-{k}") is not None for k in ("processor", "region", "retention", "training", "model"))
       and S["status"]["processor"]["name"] in st.inner_text(), "")
    ck("ai-no-hardcoded-gate-text", "RELEASE_GATE_CLOSED" not in page.content() and "外发门" not in page.inner_text("body"), "")
    goto(page, self_generate_url(S["matter"], S["target"]))
    page.wait_for_timeout(600)
    ck("gate-status-requested-same-origin", NET.count("/api/v6/status", "GET") >= 1, f"status GET={NET.count('/api/v6/status', 'GET')}")
    # open the sheet: disclosure is the server's own status, material list unknown until a session exists
    open_consent(page)
    sheet = tid(page, "self-consent-disclosure")
    text = sheet.inner_text() if sheet else ""
    st = S["status"]
    ck("sheet-discloses-processor", sheet is not None and st["processor"]["name"] in text and st["processor"]["region"] in text
       and st["processor"]["retention"] in text and (st["processor"]["termsVersion"] or "") in text and (st["model"] or "") in text,
       text[:300], page)
    materials = tid(page, "self-consent-materials")
    ck("sheet-materials-unknown-before-session", materials is not None and "未知" in materials.inner_text(), (materials.inner_text() if materials else "")[:160])
    agree = tid(page, "self-consent-agree")
    ck("sheet-agree-disabled-before-session", agree is not None and not agree.is_enabled(), "")
    S["idb_before_cancel"] = idb_snapshot(page)

    # wrong code
    tid(page, "self-consent-access-code").fill("definitely-wrong-code")
    tid(page, "self-consent-authenticate").click()
    err = None
    try:
        page.get_by_test_id("self-consent-error").wait_for(state="visible", timeout=10000)
        err = page.get_by_test_id("self-consent-error").inner_text()
    except TimeoutError:
        pass
    ck("wrong-code-rejected-in-chinese", err is not None and re.search(r"访问码|验证", err) is not None and 401 in NET.statuses("/api/v6/session"),
       f"error={err!r} session statuses={NET.statuses('/api/v6/session')}", page)
    field = tid(page, "self-consent-access-code")
    ck("wrong-code-input-cleared", field is not None and field.input_value() == "", "")
    cookies = [c for c in page.context.cookies() if c["name"].startswith("__Rmyb")]
    ck("wrong-code-no-session-cookie", not cookies, f"cookies={len(cookies)}")
    ck("wrong-code-no-chat", NET.count("/api/v6/chat") == 0 and up_stats()["total"] == 0, "")

    # cancel changes nothing in the matter
    page.get_by_role("button", name="取消").first.click()
    page.wait_for_timeout(500)
    after = idb_snapshot(page)
    ck("cancel-closes-sheet", tid(page, "self-consent-disclosure") is None, "", page)
    ck("cancel-matter-unchanged", after == S["idb_before_cancel"], "IndexedDB 各库/表键集合在取消前后一致" if after == S["idb_before_cancel"]
       else json.dumps({"before": S["idb_before_cancel"], "after": after}, ensure_ascii=False)[:500])
    ck("cancel-no-chat", NET.count("/api/v6/chat") == 0 and up_stats()["total"] == 0, "")


def s_authenticate_and_agree(page: Page) -> None:
    goto(page, self_generate_url(S["matter"], S["target"]))
    page.wait_for_timeout(1000)
    open_consent(page)
    page.get_by_test_id("self-consent-access-code").wait_for(state="visible", timeout=10000)
    tid(page, "self-consent-access-code").fill(SECRETS["accessCode"])
    tid(page, "self-consent-authenticate").click()
    try:
        page.get_by_test_id("self-consent-materials").wait_for(state="visible", timeout=10000)
        page.wait_for_function("""() => { const m = document.querySelector('[data-testid="self-consent-materials"]');
                                         return m && !m.innerText.startsWith('未知'); }""", timeout=15000)
    except TimeoutError:
        pass
    materials = tid(page, "self-consent-materials")
    mt = materials.inner_text() if materials else ""
    ck("verify-code-shows-actual-materials", "intake-source.txt" in mt and re.search(r"\d+ 条事实", mt) is not None, mt[:240], page)
    ck("verify-code-session-established", 200 in NET.statuses("/api/v6/session"), f"statuses={NET.statuses('/api/v6/session')}")
    header = NET.set_cookie[-1] if NET.set_cookie else ""
    ck("session-cookie-flags", bool(re.search(r"HttpOnly", header)) and bool(re.search(r"Secure", header))
       and bool(re.search(r"SameSite=Strict", header)) and "Path=/" in header, header.replace(re.search(r"=[^;]+", header).group(0), "=<redacted>") if header else "no Set-Cookie")
    ck("session-cookie-not-readable-by-script", "__Rmyb" not in page.evaluate("document.cookie"), "HttpOnly：document.cookie 中不可见")
    ck("session-established-server-side", page.evaluate("fetch('/api/v6/status').then(r => r.json()).then(j => j.authenticated)") is True, "")
    ck("verify-code-is-not-consent", NET.count("/api/v6/chat") == 0 and up_stats()["total"] == 0, "验证访问码不发送材料")
    ck("verify-code-does-not-consent", consent_count() == 0, "验证访问码不会自动 POST /api/v6/consent")
    leaks = storage_leaks(page, SECRETS["accessCode"])
    ck("access-code-memory-only", not any(leaks.values()), json.dumps(leaks))
    field = tid(page, "self-consent-access-code")
    ck("access-code-field-gone-or-empty", field is None or field.input_value() == "", "")
    agree = tid(page, "self-consent-agree")
    ck("agree-enabled-after-verify", agree is not None and agree.is_enabled(), "", page)
    agree.click()
    try:
        page.get_by_test_id("self-consent-disclosure").wait_for(state="detached", timeout=15000)
    except TimeoutError:
        pass
    page.wait_for_timeout(800)
    ck("consent-sheet-closes-after-agree", tid(page, "self-consent-disclosure") is None, "")
    ck("real-runtime-shown", tid(page, "self-runtime-real") is not None and tid(page, "self-runtime-test") is None,
       (tid(page, "self-runtime-real").inner_text() if tid(page, "self-runtime-real") else "")[:200], page)
    ck("agree-gets-server-credential", consent_count() == 1, f"POST /api/v6/consent 次数={consent_count()}")
    ck("agree-itself-sends-nothing", NET.count("/api/v6/chat") == 0 and up_stats()["total"] == 0, "同意只写授权，不调用模型")


def s_generate_and_adopt(page: Page) -> None:
    start = wait_generation_control(page)
    if start is None or not start.is_enabled():
        blocked("generate-start", "同意后没有可用的 generation-start / generation-retry。", page)
        raise RuntimeError("no start")
    end = click_and_wait_job(page, start, 180000)
    ck("generate-succeeds-through-real-chain", end == "succeeded", f"job state={end}", page)
    if end != "succeeded":
        raise RuntimeError(f"generation ended {end}")
    result = tid(page, "generation-result")
    ck("candidate-not-test-output", result is not None and result.get_attribute("data-test-output") == "false"
       and tid(page, "generation-test-output") is None, f"data-test-output={result.get_attribute('data-test-output') if result else None}")
    body = page.get_by_test_id("generation").first.inner_text()
    ck("candidate-has-synthetic-marker-no-test-marker", SYNTH in body and not TEST_MARKER.search(body), body[:200])
    stats = up_stats()
    browser_chat = NET.count("/api/v6/chat")
    stages = sorted(stats["byStage"])
    ck("browser-and-upstream-counts-agree", browser_chat == stats["total"] and browser_chat > 0, f"browser={browser_chat} upstream={stats['total']}")
    ck("every-upstream-call-authorised", stats["authFailures"] == 0 and all(r["authOk"] for r in stats["requests"]), f"authFailures={stats['authFailures']}")
    # The fixture is an interview transcript, so words like 「已有测试样品」 can legitimately appear as
    # *material* text. The personal-answer rule is asserted in the answer-only window below.
    credential_leaks = [r for r in stats["requests"] if r["leaked"].get("accessCode") or r["leaked"].get("modelKey") or r["leaked"].get("sessionSecret")]
    ck("material-reached-upstream-credentials-did-not", any(r["carried"].get("material") for r in stats["requests"]) and not credential_leaks,
       f"requests={len(stats['requests'])}；材料到达={sum(1 for r in stats['requests'] if r['carried'].get('material'))}；凭据泄漏={len(credential_leaks)}")
    ck("all-llm-stages-seen", {"extract_invention_facts", "draft_claims", "draft_specification", "draft_abstract"} <= set(stages), ",".join(stages))
    ck("chat-bodies-carry-no-secret", not any(f["containsAccessCode"] or f["containsModelKey"] or f["containsSessionSecret"] for f in NET.body_flags), f"checked={len(NET.body_flags)}")
    S["revision_labels_before_adopt"] = None
    adopt = tid(page, "generation-adopt")
    if adopt is None or not adopt.is_enabled():
        blocked("adopt", "真实候选没有可用的采纳按钮。", page)
        raise RuntimeError("no adopt")
    adopt.click()
    page.wait_for_timeout(2500)
    ck("adopted", True, page.url, page)
    S["upload_chat_end"] = NET.count("/api/v6/chat")


def s_invocations(page: Page) -> None:
    """AI page invocation table: count matches the chat calls, metadata only, Chinese failure reasons."""
    expected = S.get("upload_chat_end", 0) - S.get("upload_chat_start", 0)
    goto(page, f"{FULL}/v6/ai")
    page.get_by_test_id("ai-invocations").wait_for(state="visible", timeout=20000)
    try:
        page.wait_for_selector('[data-testid^="ai-invocation-"]', timeout=20000)
    except TimeoutError:
        pass
    rows = page.locator('[data-testid^="ai-invocation-"]')
    ids = [value for value in page.evaluate("() => [...document.querySelectorAll('[data-testid^=\"ai-invocation-\"]')].map(e => e.getAttribute('data-testid'))")
           if re.fullmatch(r"ai-invocation-[0-9a-f-]{36}", value)]
    count = len(ids)
    ck("invocations-rows-present", count > 0, f"rows={count}；本案件 chat 请求={expected}", page)
    ck("invocations-count-matches-chat", count == expected, f"rows={count} chat={expected}")
    times = page.locator('[data-testid^="ai-invocation-time-"]').all_inner_texts()
    execs = page.locator('[data-testid^="ai-invocation-execution-"]').all_inner_texts()
    statuses = page.locator('[data-testid^="ai-invocation-status-"]').all_inner_texts()
    ck("invocations-have-time", bool(times) and all(t.strip() and t.strip() != "—" for t in times), f"sample={times[:3]}")
    ck("invocations-execution-column", bool(execs) and all(x.strip().startswith(("测试", "真实")) for x in execs), f"sample={execs[:3]}")
    failed = [x for x in statuses if "失败" in x]
    ck("invocations-failed-rows-have-chinese-reason", bool(failed) and all(re.search(r"[一-鿿]", x) for x in failed), f"failed={len(failed)}；sample={failed[:2]}")
    codes = r"PROVIDER_[A-Z_]+|RATE_LIMITED|UPSTREAM_ERROR|CONSENT_[A-Z_]+|AUTH_FAILED|TIMEOUT"
    visible = ro.main_view_text(page)
    ck("invocations-english-code-only-in-tech-details", re.search(codes, visible) is None, f"主视图命中={re.findall(codes, visible)[:3]}")
    tech = [t or "" for t in page.locator('[data-testid="ai-invocations"] details code').all_text_contents()]
    ck("invocations-tech-details-have-code", any(re.search(codes, x) for x in tech), f"技术详情条目={len(tech)}；sample={(tech[:2])}")
    body = page.inner_text("body")
    ck("invocations-no-body-text", SYNTH not in body and SECRETS["materialSentinel"] not in body and "输入上下文" not in body,
       "页面不含合成输出、材料标记或提示词片段")


def s_no_test_marker_everywhere(page: Page) -> None:
    m, t = S["matter"], S["target"]
    goto(page, draft_url(m, t))
    page.get_by_test_id("draft-editor").wait_for(state="visible", timeout=30000)
    editor = page.get_by_test_id("draft-editor").first.inner_text()
    ck("draft-contains-synthetic-marker", SYNTH in editor, editor[:160], page)
    for name, url in (("draft", draft_url(m, t)), ("preview", f"{FULL}/v6/new/{m}/preview?target={t}"),
                      ("done", f"{FULL}/v6/new/{m}/done?target={t}"), ("deliver", f"{FULL}/v6/matters/{m}/targets/{t}/deliver"),
                      ("check", f"{FULL}/v6/matters/{m}/targets/{t}/check"), ("overview", f"{FULL}/v6/matters/{m}/targets/{t}/overview")):
        goto(page, url)
        page.wait_for_timeout(1200)
        counts = notice_counts(page)
        ck(f"no-test-notice-{name}", counts["total"] == 0 and counts["flagged"] == 0, json.dumps(counts), page)


def s_reconfirm_after_adopt(page: Page) -> None:
    """Adoption changed the disclosed scope; the user re-confirms before continuing to delivery."""
    m, t = S["matter"], S["target"]
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    wait_for_consent_prompt(page)
    sheet = tid(page, "workbench-consent-disclosure")
    required = tid(page, "workbench-runtime-consent-required")
    ck("adoption-invalidates-old-consent", sheet is not None or required is not None,
       f"sheet={sheet is not None} required-callout={required is not None}", page)
    ok, why = agree_consent(page)
    S["reconsent_ok"] = ok
    ck("reconfirm-sheet-lists-new-scope", ok, why, page)
    open_gen_strip(page)
    page.wait_for_timeout(500)
    ck("reconfirmed-real-runtime", tid(page, "workbench-runtime-real") is not None, "", page)


def s_finish_flow_and_download(page: Page) -> None:
    m, t = S["matter"], S["target"]
    goto(page, draft_url(m, t))
    wait_for_consent_prompt(page)
    if page.locator(".scrim").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    acc.acknowledge_first_risk_and_reload(page, FULL, m, t, EVIDENCE)
    ro.confirm_paragraphs(page, FULL, m, t, EVIDENCE)
    # self-read confirmation without asserting a test marker (real revisions have none)
    page.goto(f"{FULL}/v6/new/{m}/preview", wait_until="domcontentloaded")
    wait_dom(page)
    panel = tid(page, "preview-confirmation")
    if panel is not None:
        box = visible(panel.locator('input[type="checkbox"]'))
        button = visible(panel.get_by_role("button", name=re.compile("确认通读|已通读")))
        if box is not None and button is not None:
            box.check()
            button.click()
            page.get_by_test_id("preview-confirmed").wait_for(state="visible", timeout=15000)
    ck("self-read-confirmed", tid(page, "preview-confirmed") is not None, "", page)
    if not ro.approve_with_details(page, FULL, m, t, EVIDENCE):
        blocked("approve", "批准未通过，无法验证下载。")
        return
    goto(page, f"{FULL}/v6/new/{m}/done?target={t}")
    pass_field = tid(page, "done-passphrase")
    button = tid(page, "done-export-button")
    if pass_field is None or button is None:
        blocked("export", "完成页没有导出表单。", page)
        return
    pass_field.fill(PASSPHRASE)
    page.wait_for_timeout(200)
    if not button.is_enabled():
        gate = tid(page, "done-gate")
        detail = (gate.inner_text() if gate else "")[:300]
        blocked("export", f"填入口令后导出按钮仍不可用；门禁：{detail}", page)
        return
    button.click()
    try:
        page.wait_for_function("""() => !!document.querySelector('[data-testid^="done-file-"][data-status="ready"]')""", timeout=90000)
    except TimeoutError:
        pass
    rows = page.locator('[data-testid^="done-file-"][data-status="ready"]')
    ck("export-files-ready", rows.count() > 0, f"ready files={rows.count()}", page)
    ck("done-no-test-notice", notice_counts(page)["total"] == 0, json.dumps(notice_counts(page)))
    for i in range(rows.count()):
        btn = visible(rows.nth(i).get_by_role("button", name=re.compile("下载")))
        if btn is None:
            ck(f"download-{i + 1}", False, "没有下载按钮")
            continue
        with page.expect_download(timeout=30000) as info:
            btn.click()
        dl = info.value
        target = EVIDENCE.out_dir / dl.suggested_filename
        dl.save_as(str(target))
        check = acc.validate_download(target)
        EVIDENCE.downloads.append({"path": target.name, **check})
        marker = (check.get("testOutputMarkerPresent") or check.get("testOutputFlagSeen") or check.get("firstParagraphTestOutputMarker")
                  or check.get("bodyTestOutputMarker") or check.get("pdfMetadataTestOutputMarker") or check.get("manifestTestOutput")
                  or TEST_MARKER.search(dl.suggested_filename) is not None)
        ck(f"download-{i + 1}-valid-no-test-marker", bool(check.get("valid")) and not marker,
           f"{dl.suggested_filename} kind={check.get('kind')} valid={check.get('valid')} marker={bool(marker)}")
        if check.get("kind") == "docx":
            ck(f"download-{i + 1}-docx-has-synthetic-marker", SYNTH in (check.get("documentText") or ""), "")
    S["exported"] = True


def s_material_change_needs_reconsent(page: Page) -> None:
    """The generation strip survives re-reads; new material invalidates the grant and can be re-confirmed."""
    m, t = S["matter"], S["target"]
    before = NET.count("/api/v6/chat")
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    # the generation strip must stay open across the workbench's own refresh/focus re-reads
    opened = page.evaluate("document.querySelector('[data-testid=workbench-generation-panel]')?.open === true")
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    page.wait_for_timeout(17000)
    still = page.evaluate("document.querySelector('[data-testid=workbench-generation-panel]')?.open === true")
    ck("strip-stays-open-after-refresh", opened and still, f"opened={opened} after-17s-and-focus={still}", page)

    # explicit material change: a second file
    goto(page, f"{FULL}/v6/matters/{m}/targets/{t}/sources")
    page.get_by_test_id("upload-input").set_input_files(str(EXTRA_FIXTURE))
    page.get_by_test_id("upload-rows").wait_for(state="visible", timeout=15000)
    save_button = tid(page, "upload-save")
    if save_button is None or not save_button.is_enabled():
        blocked("material-change-upload", "专业材料页的保存按钮不可用。", page)
    else:
        save_button.click()
        page.wait_for_selector('[data-testid^="upload-row-"]', timeout=30000)
        ck("extra-material-saved", page.locator('[data-testid^="upload-row-"]').count() >= 1, "第二个来源文件已保存", page)
        try:
            page.wait_for_selector('[data-testid^="parse-status-"]', timeout=15000)
            page.wait_for_function("""() => [...document.querySelectorAll('[data-testid^="parse-status-"]')]
                .every(el => el.innerText.includes('已解析'))""", timeout=60000)
        except TimeoutError:
            note("parse-settle-timeout", page, "解析状态未在时限内变为已解析；继续用当前清单确认。")
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    wait_for_consent_prompt(page, timeout=30000)
    ck("new-material-requires-fresh-consent",
       tid(page, "workbench-consent-disclosure") is not None or tid(page, "workbench-runtime-consent-required") is not None,
       "修改材料后旧同意不再覆盖当前范围", page)
    ck("new-material-no-chat", NET.count("/api/v6/chat") == before, "")
    goto(page, f"{FULL}/v6/ai")
    page.wait_for_timeout(1500)
    note("ai-after-material-change", page, f"ai-stale={'present' if tid(page, 'ai-stale') else 'absent'}")
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    wait_for_consent_prompt(page, timeout=60000)
    ok, why = agree_consent(page, attempts=3)
    S["reconsent_ok"] = ok
    if ok:
        ck("material-change-reconsent", True, why, page)
    else:
        state = card_state(page, "workbench-runtime-consent-open")
        blocked("material-change-reconsent",
                f"重新确认未完成：{why}；opener={json.dumps(state, ensure_ascii=False)[:160]}", page)


def s_revoke_blocks_sends(page: Page, context: Any) -> None:
    m, t = S["matter"], S["target"]
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    page.wait_for_timeout(800)
    # A stale-but-active grant is still revocable; whether the runtime is "ready" is only an observation.
    note("revoke-precondition", page, f"runtime-real={'present' if tid(page, 'workbench-runtime-real') else 'absent'}")
    other = context.new_page()
    EVIDENCE.attach(other)
    NET.attach_page(other)
    goto(other, f"{FULL}/v6/ai")
    other.wait_for_timeout(1500)
    revoke = other.locator('[data-testid^="ai-revoke-"]:not([disabled])').first
    if revoke.count() == 0:
        ck("revoke-listed-on-ai-page", False, "AI 页没有可撤回的运行时授权（ai-revoke-*）；撤回入口缺失", other)
        other.close()
        return
    ck("revoke-listed-on-ai-page", True, "", other)
    before = NET.count("/api/v6/chat")
    revoke.click()
    other.wait_for_timeout(1200)
    ck("revoked-state-shown", other.locator("text=已撤回").count() > 0 or tid(other, "ai-notice") is not None,
       (tid(other, "ai-notice").inner_text() if tid(other, "ai-notice") else "")[:120], other)
    other.close()
    # stale page that was ready before revocation must not send
    start = tid(page, "generation-start")
    if start is not None and start.is_enabled():
        end = click_and_wait_job(page, start, 60000)
        err = tid(page, "generation-error")
        # A revoked grant must never reach the provider. A local test run (no chat) is allowed.
        ck("revoked-start-sends-nothing", NET.count("/api/v6/chat") == before,
           f"state={end}；chat before={before} after={NET.count('/api/v6/chat')}；error={(err.inner_text() if err else '')[:120]!r}", page)
    else:
        ck("revoked-start-unavailable", True, "撤回后启动入口不可用", page)
    ck("revoked-no-chat-after-revoke", NET.count("/api/v6/chat") == before, f"before={before} after={NET.count('/api/v6/chat')}")
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    wait_for_consent_prompt(page)
    ck("revoked-consent-required-again", tid(page, "workbench-consent-disclosure") is not None or tid(page, "workbench-runtime-consent-required") is not None, "", page)


def s_upstream_faults(page: Page) -> None:
    m, t = S["matter"], S["target"]
    S["upload_chat_start"] = NET.count("/api/v6/chat")
    # The workbench asks for its own consent for the same target (the self page's grant does not
    # cover it); agree here before the fault cases use this page's engine.
    goto(page, draft_url(m, t))
    wait_for_consent_prompt(page)
    ok, why = agree_consent(page, attempts=3)
    ck("workbench-consent-accepted", ok, why, page)
    page.wait_for_timeout(800)
    ck("workbench-engine-mounted", tid(page, "generation-start") is not None or tid(page, "generation-retry") is not None,
       "工作台在确认后挂载生成面板", page)
    cases = [("rate_limit", r"请求过多|上限|稍后|限流", 60000), ("unavailable", r"暂时不可用", 60000),
             ("unauthorized", r"凭据未被接受", 60000), ("invalid_json", r"结构|无法解析|不符合", 90000),
             ("redirect", r"拒绝了请求|服务配置有误", 60000)]
    if not os.environ.get("REAL_AI_SKIP_TIMEOUT"):
        cases.append(("timeout", r"超时", 170000))
    for mode, pattern, wait_ms in cases:
        goto(page, draft_url(m, t))
        open_gen_strip(page)
        wait_for_consent_prompt(page, timeout=15000)
        if tid(page, "workbench-consent-disclosure") is not None or tid(page, "workbench-runtime-consent-required") is not None:
            agree_consent(page)
        label_before = (tid(page, "draft-editor").inner_text() if tid(page, "draft-editor") else "")
        up_fault(mode)
        control = wait_generation_control(page)
        if control is None or not control.is_enabled():
            blocked(f"fault-{mode}", "没有可用的 generation-start/retry 入口。", page)
            continue
        end = click_and_wait_job(page, control, wait_ms)
        up_fault("ok")
        err = tid(page, "generation-error")
        err_text = err.inner_text() if err else ""
        ck(f"fault-{mode}-job-fails", end == "failed", f"state={end}", page)
        ck(f"fault-{mode}-chinese-message", bool(re.search(pattern, err_text)) and bool(re.search(r"[一-鿿]", err_text)), err_text[:200])
        ck(f"fault-{mode}-no-candidate-or-fake-draft", tid(page, "generation-result") is None and tid(page, "generation-adopt") is None, "失败后没有候选稿或采纳按钮")
        after = (tid(page, "draft-editor").inner_text() if tid(page, "draft-editor") else "")
        ck(f"fault-{mode}-draft-unchanged", after == label_before, "已采纳草稿未被失败任务改动")
    statuses = [r["status"] for r in NET.api if r["path"] == "/api/v6/chat"]
    ck("faults-mapped-by-worker", any(s == 429 for s in statuses) and any(s in (502, 504) for s in statuses), f"chat statuses seen={sorted(set(statuses))}")


def open_answer_only_matter(page: Page) -> str:
    """New self-service matter without any upload, then the five questions."""
    goto(page, f"{FULL}/v6")
    entry = tid(page, "entry-self")
    if entry is None:
        raise RuntimeError("entry-self missing")
    entry.click()
    page.wait_for_url(re.compile(r"/v6/new/[^/]+/upload"), timeout=20000)
    page.get_by_test_id("self-upload-step").wait_for(state="visible", timeout=20000)
    tid(page, "answer-without-documents").click()
    page.wait_for_url(re.compile(r"/questions"), timeout=20000)
    match = re.search(r"/v6/new/([0-9a-f-]{36})/", page.url)
    if not match:
        raise RuntimeError(f"no matter id: {page.url}")
    return match.group(1)


def s_answer_only(page: Page) -> None:
    """Answer-only path: no documents, real drafting from answers 1-2 only."""
    before_chat = NET.count("/api/v6/chat")
    matter = open_answer_only_matter(page)
    if not ro.answer_questions(page, FULL, matter, False, EVIDENCE):
        raise RuntimeError("answer-only questions failed")
    target = ro.choose_route(page, FULL, matter, EVIDENCE)
    if not target:
        raise RuntimeError("answer-only target failed")
    S["answer_matter"], S["answer_target"] = matter, target
    goto(page, self_generate_url(matter, target))
    page.wait_for_timeout(1500)
    wait_for_consent_prompt(page)
    sheet = tid(page, "self-consent-disclosure")
    ck("answer-only-sheet-opened", sheet is not None, "无文档的新案件在真实模式先出外发确认", page)
    no_files = tid(page, "self-consent-no-files")
    ck("answer-only-no-files-explained", no_files is not None and "没有上传文档" in (no_files.inner_text() if no_files else ""), "")
    answers = tid(page, "self-consent-answers")
    text = answers.inner_text() if answers else ""
    ck("answer-only-answers-summary", answers is not None and "已回答 5/5" in text and "2 条技术回答" in text, text[:200], page)
    ck("answer-only-lists-q1-q2", "第 1 题" in text and "第 2 题" in text and "第 3 题" not in text, text[:240])
    ck("answer-only-local-only-note", "发明人、公开历史、成熟度只在本机" in text, "")
    ck("answer-only-no-chat-before-consent", NET.count("/api/v6/chat") == before_chat, "")
    # reset the upstream window, then consent and generate
    up_call("/__reset", {})
    agree = tid(page, "self-consent-agree")
    ck("answer-only-agree-enabled", agree is not None and agree.is_enabled(), "", page)
    if agree is None or not agree.is_enabled():
        blocked("answer-only", "无法同意外发，后续断言不执行。", page)
        return
    agree.click()
    try:
        page.get_by_test_id("self-consent-disclosure").wait_for(state="detached", timeout=15000)
    except TimeoutError:
        pass
    page.wait_for_timeout(800)
    ck("answer-only-real-runtime", tid(page, "self-runtime-real") is not None, "", page)
    start = wait_generation_control(page)
    if start is None or not start.is_enabled():
        blocked("answer-only-generate", "回答路径没有可用的 generation-start。", page)
        return
    end = click_and_wait_job(page, start, 180000)
    ck("answer-only-generation-succeeds", end == "succeeded", f"state={end}", page)
    adopt = tid(page, "generation-adopt")
    if adopt is not None and adopt.is_enabled():
        adopt.click()
        page.wait_for_timeout(2500)
        ck("answer-only-adopted", True, "", page)
    else:
        ck("answer-only-adopted", False, "没有采纳按钮", page)
    counts = notice_counts(page)
    ck("answer-only-no-test-notice", counts["total"] == 0, json.dumps(counts))
    stats = up_stats()
    requests = stats["requests"]
    ck("answer-only-upstream-saw-both-answers",
       any(r["carried"].get("answer1") for r in requests) and any(r["carried"].get("answer2") for r in requests),
       f"requests={len(requests)}；Q1 到达={sum(1 for r in requests if r['carried'].get('answer1'))}；Q2 到达={sum(1 for r in requests if r['carried'].get('answer2'))}")
    ck("answer-only-upstream-never-saw-personal-answers",
       bool(requests) and not any(r["leaked"].get("inventor") or r["leaked"].get("disclosure") or r["leaked"].get("maturity") for r in requests),
       json.dumps({"requests": len(requests), "bytes": sorted({r["requestBytes"] for r in requests}),
                   "perRequest": [{"inventor": r["leaked"].get("inventor"), "disclosure": r["leaked"].get("disclosure"),
                                   "maturity": r["leaked"].get("maturity")} for r in requests[:3]]}, ensure_ascii=False))
    ck("answer-only-counts-agree", NET.count("/api/v6/chat") == before_chat + stats["total"] and stats["total"] > 0,
       f"browser={NET.count('/api/v6/chat')} upstream={stats['total']} before={before_chat}")
    # changing an answer invalidates the grant
    goto(page, f"{FULL}/v6/new/{matter}/questions?q=1")
    page.get_by_test_id("self-questions-step").wait_for(state="visible", timeout=20000)
    area = visible(page.locator("textarea"))
    if area is not None:
        area.fill(ANSWER_ONLY["difference"] + "（已修改，合成验收）")
        primary = visible(page.locator(".q-nav button.btn.primary"))
        if primary is not None and primary.is_enabled():
            primary.click()
            page.wait_for_timeout(800)
    goto(page, draft_url(matter, target))
    open_gen_strip(page)
    wait_for_consent_prompt(page, timeout=30000)
    ck("answer-change-requires-reconsent",
       tid(page, "workbench-consent-disclosure") is not None or tid(page, "workbench-runtime-consent-required") is not None,
       "修改回答后旧同意不再覆盖当前范围", page)
    ck("answer-change-no-chat", NET.count("/api/v6/chat") == before_chat + stats["total"], "")
    if page.locator(".scrim").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)


def s_missing_answers(page: Page) -> None:
    """No documents + incomplete answers: real drafting is disabled in the workbench and links to the questions."""
    before = NET.count("/api/v6/chat")
    matter = open_answer_only_matter(page)
    if not ro.open_question(page, FULL, matter, 0):
        blocked("missing-answers", "无法打开第 1 题。", page)
        return
    if not ro.fill_question(page, "problem", False, EVIDENCE, "missing", FULL, matter):
        blocked("missing-answers", "第 1 题未保存。", page)
        return
    primary = visible(page.locator(".q-nav button.btn.primary"))
    if primary is not None:
        primary.click()
        page.wait_for_timeout(600)
    # create a target from the professional overview (the wizard itself requires all five answers)
    goto(page, f"{FULL}/v6/matters/{matter}/overview")
    page.get_by_test_id("workbench-target-settings").wait_for(state="visible", timeout=20000)
    page.get_by_role("button", name="打开设置").first.click()
    page.wait_for_selector('[data-testid="targets-create-route-card-cn_um"]', timeout=15000)
    save = tid(page, "targets-create-save")
    if save is None or not save.is_enabled():
        blocked("missing-answers", "无法创建目标（新建目标按钮不可用）。", page)
        return
    save.click()
    page.wait_for_timeout(2500)
    target = page.evaluate("""() => {
      const el = document.querySelector('[data-testid^="targets-switch-"]');
      return el ? el.getAttribute('data-testid').replace('targets-switch-', '') : null;
    }""")
    page.keyboard.press("Escape")
    if not target:
        blocked("missing-answers", "创建目标后没有目标切换项。", page)
        return
    goto(page, draft_url(matter, target))
    open_gen_strip(page)
    page.wait_for_timeout(1500)
    notice = tid(page, "workbench-answer-incomplete")
    ck("missing-answers-notice", notice is not None and "还缺" in (notice.inner_text() if notice else ""),
       (notice.inner_text() if notice else "")[:240], page)
    link = tid(page, "workbench-answer-link")
    ck("missing-answers-link", link is not None, "去回答入口存在")
    opener = tid(page, "workbench-runtime-consent-open")
    if opener is not None and opener.is_enabled():
        opener.click()
        page.wait_for_selector('[data-testid="workbench-consent-disclosure"]', timeout=20000)
        gate = tid(page, "workbench-consent-answer-gate")
        ck("missing-answers-sheet-gate", gate is not None and "五题答完后才能真实起草" in (gate.inner_text() if gate else ""),
           (gate.inner_text() if gate else "")[:240], page)
        ck("missing-answers-sheet-link", tid(page, "workbench-consent-answer-link") is not None, "")
        agree = tid(page, "workbench-consent-agree")
        ck("missing-answers-agree-blocked", agree is None or not agree.is_enabled(), "缺题时不能确认真实起草")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    else:
        ck("missing-answers-sheet-gate", False, "没有可用的「查看外发确认」入口", page)
    real_panel = tid(page, "workbench-runtime-real")
    test_notice = tid(page, "workbench-runtime-test")
    ck("missing-answers-no-real-engine", real_panel is None and test_notice is not None,
       "缺题时不挂载真实引擎；本机测试引擎仍在（本地固定输出，不外发）", page)
    ck("missing-answers-no-chat", NET.count("/api/v6/chat") == before, "")



def s_credentials(page: Page, context: Any) -> None:
    """Protocol-level credential matrix (new session -> status -> consent -> chat). No bodies are logged."""
    goto(page, f"{FULL}/v6/ai")
    page.wait_for_timeout(1200)
    status = page.evaluate("fetch('/api/v6/status').then(r => r.json())")
    version = status.get("profileVersion")
    ck("status-carries-session-id", isinstance(status.get("sessionId"), str) and len(status["sessionId"]) == 64,
       "status.sessionId 存在且为 64 位摘要（非令牌本身）")
    manifest = None
    for _ in range(20):
        node = tid(page, "ai-manifest-hash")
        if node is not None:
            manifest = node.inner_text().strip()
            break
        page.wait_for_timeout(300)
    if not manifest:
        blocked("credentials", "AI 页没有可读取的清单摘要。", page)
        return
    cookie = "; ".join(f"{c['name']}={c['value']}" for c in context.cookies())
    headers = {"content-type": "application/json", "origin": FULL, "cookie": cookie}
    ck("api-request-has-session-cookie", "__Rmyb" in cookie, "APIRequestContext 显式携带会话 cookie")

    def post(path: str, body: dict[str, Any]) -> int:
        response = context.request.post(f"{FULL}{path}", data=json.dumps(body), headers=headers)
        return response.status

    def upstream() -> int:
        return up_stats()["total"]

    before = upstream()
    ck("unknown-stage-rejected", post("/api/v6/chat", {"requestId": f"sec-{uuid4()}", "prompt": "合成验收：协议检查",
        "stage": "not_a_stage", "profileVersion": version, "manifestHash": manifest}) == 400, "未知阶段返回 400", page)
    ck("local-stage-rejected", post("/api/v6/chat", {"requestId": f"sec-{uuid4()}", "prompt": "合成验收：协议检查",
        "stage": "ingest_sources", "profileVersion": version, "manifestHash": manifest}) == 400, "本地阶段不能走 chat（400）", page)
    ck("missing-credential-rejected", post("/api/v6/chat", {"requestId": f"sec-{uuid4()}", "prompt": "合成验收：协议检查",
        "stage": "extract_invention_facts", "profileVersion": version, "manifestHash": manifest}) == 400, "缺少同意凭证返回 400", page)
    ck("no-upstream-for-rejected-shapes", upstream() == before, f"上游调用未增加（{before} -> {upstream()}）")

    grant = context.request.post(f"{FULL}/api/v6/consent", data=json.dumps({"profileVersion": version, "manifestHash": manifest}), headers=headers)
    ck("consent-endpoint-returns-credential", grant.status == 200, f"POST /api/v6/consent -> {grant.status}")
    credential = None
    try:
        body = grant.json()
        credential = body.get("credential")
        stages = body.get("allowedStages") or []
        ck("credential-binds-stage-allowlist", isinstance(credential, str) and len(stages) >= 13 and "ingest_sources" not in stages,
           f"allowedStages={len(stages)}")
    except Exception:
        credential = None
    if not credential:
        blocked("credentials-ok-path", "没有取得服务端凭证，后续凭证校验用例未执行。", page)
        return

    bad_hash = ("0" if manifest[0] != "0" else "1") + manifest[1:]
    before = upstream()
    ck("wrong-hash-rejected", post("/api/v6/chat", {"requestId": f"sec-{uuid4()}", "prompt": "合成验收：协议检查",
        "stage": "extract_invention_facts", "profileVersion": version, "manifestHash": bad_hash,
        "consentCredential": credential}) == 409, "摘要不匹配返回 409", page)
    ck("credential-with-unknown-stage-rejected", post("/api/v6/chat", {"requestId": f"sec-{uuid4()}", "prompt": "合成验收：协议检查",
        "stage": "not_a_stage", "profileVersion": version, "manifestHash": manifest, "consentCredential": credential}) == 400,
       "凭证不能扩展阶段白名单", page)
    ck("rejected-credential-cases-send-nothing", upstream() == before, f"上游调用未增加（{before} -> {upstream()}）")
    # a second browser context holds a different session; the first credential must not work there
    other_context = context.browser.new_context(**acc.BASELINE)
    try:
        login = other_context.request.post(f"{FULL}/api/v6/session", data=json.dumps({"accessCode": SECRETS["accessCode"]}),
                                            headers=headers)
        if login.status == 200:
            before = upstream()
            cross = other_context.request.post(f"{FULL}/api/v6/chat", data=json.dumps({"requestId": f"sec-{uuid4()}",
                "prompt": "合成验收：协议检查", "stage": "extract_invention_facts", "profileVersion": version,
                "manifestHash": manifest, "consentCredential": credential}), headers=headers)
            ck("cross-session-credential-rejected", cross.status in (400, 401, 403, 409), f"跨会话凭证 -> {cross.status}")
            ck("cross-session-sends-nothing", upstream() == before, "跨会话尝试未到达上游")
        else:
            blocked("cross-session", f"第二个会话未能建立（{login.status}）。")
    finally:
        other_context.close()


def s_title_logout(page: Page) -> None:
    """Title changes invalidate the grant; the title is disclosed as text; logout clears the session only."""
    m, t = S["matter"], S["target"]
    payload = '<img src=x onerror="window.__xss=1">合成验收标题'
    goto(page, f"{FULL}/v6/matters")
    page.get_by_test_id("matters-list").wait_for(state="visible", timeout=20000)
    rename = page.locator("button", has_text="重命名").first
    if rename.count() == 0:
        blocked("title-change", "案件列表没有重命名入口。", page)
        return
    rename.click()
    field = page.locator('input[aria-label="案件标题"]').first
    field.wait_for(state="visible", timeout=10000)
    field.fill(payload)
    page.get_by_role("button", name="保存").first.click()
    page.wait_for_timeout(2000)
    if "合成验收标题" not in page.inner_text("body"):
        blocked("title-change", "重命名没有保存成功，后续标题断言未执行。", page)
        return
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    wait_for_consent_prompt(page)
    ck("title-change-invalidates-consent",
       tid(page, "workbench-consent-disclosure") is not None or tid(page, "workbench-runtime-consent-required") is not None,
       "改标题后旧同意不再覆盖当前范围", page)
    chat_before = NET.count("/api/v6/chat")
    ck("title-change-no-chat", chat_before == S.get("upload_chat_end", chat_before), "改标题后未发出 chat")
    sheet = tid(page, "workbench-consent-disclosure")
    if sheet is None:
        opener = tid(page, "workbench-runtime-consent-open")
        if opener is not None and opener.is_enabled():
            opener.click()
            page.wait_for_timeout(1000)
    title_node = tid(page, "workbench-consent-title") or tid(page, "self-consent-title")
    text = title_node.inner_text() if title_node else ""
    injected = page.evaluate("() => document.querySelectorAll('[data-testid$=\"-consent-title\"] img').length")
    ck("title-disclosed-as-text", title_node is not None and "合成验收标题" in text and injected == 0,
       f"标题以文本显示，注入元素={injected}；样例={text[:80]!r}", page)
    ck("title-payload-not-executed", page.evaluate("() => window.__xss === undefined"), "")
    if page.locator(".scrim").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    # logout clears the browser session only
    goto(page, f"{FULL}/v6/ai")
    page.wait_for_timeout(1200)
    logout = page.locator("button", has_text="退出起草会话").first
    if logout.count() == 0:
        blocked("logout", "AI 页没有退出起草会话入口。", page)
        return
    logout.click()
    page.wait_for_timeout(2000)
    cookies = [c for c in page.context.cookies() if c["name"].startswith("__Rmyb")]
    ck("logout-clears-session-cookie", not cookies, f"剩余 cookie={len(cookies)}")
    status = page.evaluate("fetch('/api/v6/status').then(r => r.json())")
    ck("logout-status-unauthenticated", status.get("authenticated") is False, "status.authenticated=false")
    goto(page, f"{FULL}/v6/matters")
    page.get_by_test_id("matters-list").wait_for(state="visible", timeout=20000)
    ck("logout-keeps-matter", "合成验收标题" in page.inner_text("body") or page.locator('[data-testid^="matter-row-"]').count() > 0,
       "案件与标题保留")
    before = NET.count("/api/v6/chat")
    goto(page, draft_url(m, t))
    open_gen_strip(page)
    page.wait_for_timeout(2000)
    start = tid(page, "generation-start")
    if start is not None and start.is_enabled():
        click_and_wait_job(page, start, 60000)
    ck("logout-old-runtime-sends-nothing", NET.count("/api/v6/chat") == before, "退出后旧页面不再发出 chat")


def s_ai_page_states(browser: Any, page: Page) -> None:
    """Main page (seeded matter, active session) + the other two instances."""
    safe_goto(page, f"{FULL}/v6/ai")
    page.get_by_test_id("ai-service-status").wait_for(state="visible", timeout=15000)
    page.wait_for_selector('[data-testid="ai-service-status"][data-state="ready"]', timeout=20000)
    st = tid(page, "ai-service-status")
    ck("ai-state-ready", st.get_attribute("data-state") == "ready", st.inner_text()[:240], page)
    ck("ai-consent-list-present", tid(page, "ai-consent-list") is not None, "")
    note("ai-page-selected-matter", page, f"rows-on-default-matter={page.locator('[data-testid^=\"ai-invocation-\"]').count()}")
    text = page.inner_text("body")
    ck("ai-invocations-no-body-text", SYNTH not in text.replace("合成验收处理方", "") and SECRETS["materialSentinel"] not in text and "输入上下文" not in text,
       "页面不含材料标记、合成输出或提示词片段")
    ck("ai-no-hardcoded-gate-text-after-session", "RELEASE_GATE_CLOSED" not in page.content() and "外发门" not in page.inner_text("body"), "")
    # unreachable
    page.route("**/api/v6/status", lambda route: route.abort())
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector('[data-testid="ai-service-status"][data-state="unreachable"]', timeout=25000)
    ck("ai-state-unreachable", True, tid(page, "ai-service-status").inner_text()[:200], page)
    page.unroute("**/api/v6/status")
    # unknown (loading): delay the status response and observe before it resolves
    def slow(route: Any) -> None:
        time.sleep(1.5)
        route.continue_()
    page.route("**/api/v6/status", slow)
    page.reload(wait_until="domcontentloaded")
    seen = None
    try:
        page.wait_for_selector('[data-testid="ai-service-status"][data-state="unknown"]', timeout=4000)
        seen = "unknown"
    except TimeoutError:
        pass
    ck("ai-state-unknown-while-loading", seen == "unknown", f"observed={seen}", page)
    page.unroute("**/api/v6/status")
    # other instances: status-only, fresh contexts are fine (no matter data needed)
    for name, base, state, needle in (("unconfigured", UNCONFIGURED, "unconfigured", "尚未配置"), ("undisclosed", UNDISCLOSED, "unavailable", "尚未核实")):
        context, other = new_context(browser, base)
        safe_goto(other, f"{base}/v6/ai")
        other.get_by_test_id("ai-service-status").wait_for(state="visible", timeout=15000)
        other.wait_for_selector('[data-testid="ai-service-status"]:not([data-state="unknown"])', timeout=15000)
        st2 = tid(other, "ai-service-status")
        ck(f"ai-state-{name}", st2.get_attribute("data-state") == state and needle in st2.inner_text(), st2.inner_text()[:200], other)
        context.close()


def s_fallback_instances(browser: Any) -> None:
    """Unconfigured worker: the runtime must fall back to test mode and say why."""
    base = UNCONFIGURED
    before = NET.count("/api/v6/chat")
    context, page = new_context(browser, base)
    use_instance(base)
    goto(page, f"{base}/v6")
    matter = ro.upload_and_enter_questions(page, FIXTURE, EVIDENCE)
    if not matter:
        blocked("fallback-seed", "未配置实例上的上传/问答流程未完成。", page)
        context.close(); use_instance(FULL)
        return
    ro.answer_questions(page, base, matter, True, EVIDENCE)
    goto(page, f"{base}/v6/new/{matter}/route")
    page.get_by_test_id("self-route-cn_um").wait_for(state="visible", timeout=20000)
    # route narrowing, on the real self-service page (V6 UI)
    for route, label in (("us_nonprovisional", "美国"), ("pct", "PCT")):
        card = tid(page, f"self-route-{route}")
        state = card_state(page, f"self-route-{route}")
        ok = card is not None and not card.is_enabled() and "即将支持" in card.inner_text()
        ck(f"self-route-{route}-disabled-with-reason", ok, json.dumps(state, ensure_ascii=False)[:220], page if route == "pct" else None)
    inv = tid(page, "self-route-cn_invention")
    ck("self-route-invention-limit", inv is not None and "仅中文准备稿" in inv.inner_text(), (inv.inner_text() if inv else "")[:200])
    page.get_by_test_id("self-route-cn_um").click()
    page.get_by_role("button", name=re.compile("生成材料")).first.click()
    try:
        page.wait_for_url(re.compile(r"/generate\?.*target="), timeout=20000)
    except TimeoutError:
        pass
    match = re.search(r"target=([0-9a-f-]{36})", page.url)
    if not match:
        blocked("fallback-target", f"未生成目标：{page.url}", page)
        context.close(); use_instance(FULL)
        return
    S["alt"] = {"matter": matter, "target": match.group(1), "base": base}
    page.wait_for_timeout(1800)
    note_el = tid(page, "self-runtime-test")
    text = note_el.inner_text() if note_el else ""
    ck("fallback-unconfigured-explains-test-mode", note_el is not None and "尚未配置" in text and "不发送材料" in text, text[:240], page)
    ck("fallback-unconfigured-no-real-runtime", tid(page, "self-runtime-real") is None, "")
    ck("fallback-unconfigured-no-chat", NET.count("/api/v6/chat") == before, "")
    # Keep this context for the route/settings checks: IndexedDB is per browser context.
    S["alt_ctx"] = (context, page)
    use_instance(FULL)


def s_route_narrowing(browser: Any) -> None:
    """Professional target settings sheet keeps the same narrowing; the matters filter keeps every route."""
    if "alt" not in S:
        blocked("routes", "路线收窄检查依赖 fallback 场景创建的未配置实例案件；本次未运行 fallback。")
        return
    alt = S["alt"]
    if "alt_ctx" not in S:
        blocked("routes", "路线收窄检查需要 fallback 场景打开的浏览器上下文。")
        return
    context, page = S["alt_ctx"]
    use_instance(alt["base"])
    target_url = f"{alt['base']}/v6/matters/{alt['matter']}/targets/{alt['target']}/overview"
    safe_goto(page, target_url)
    try:
        page.get_by_test_id("workbench-target-settings").wait_for(state="visible", timeout=20000)
    except TimeoutError:
        body = page.inner_text("body")[:500].replace("\n", " ")
        ck("routes-overview-loaded", False, f"url={page.url} text={body}", page)
        context.close(); use_instance(FULL)
        return
    page.get_by_role("button", name="打开设置").first.click()
    page.locator(".sheet").wait_for(timeout=15000)
    page.wait_for_selector('[data-testid="targets-create-route-card-cn_um"]', timeout=15000)
    for route in ("us_nonprovisional", "pct"):
        state = card_state(page, f"targets-create-route-card-{route}")
        ok = state.get("exists") and bool(state.get("reason")) and state.get("inputDisabled") is True and "即将支持" in (state.get("text") or "")
        ck(f"settings-{route}-disabled-with-reason", bool(ok), json.dumps(state, ensure_ascii=False)[:260], page if route == "pct" else None)
    inv = tid(page, "targets-create-route-card-cn_invention")
    ck("settings-invention-real-limits", inv is not None and "R1 本地浏览器版只生成中文准备稿" in inv.inner_text() and "需专业人员复核" in inv.inner_text(),
       (inv.inner_text() if inv else "")[:240])
    um = tid(page, "targets-create-route-card-cn_um")
    ck("settings-utility-model-usable", um is not None and not um.locator("input[type=radio]").is_disabled(), "")
    page.keyboard.press("Escape")
    goto(page, f"{alt['base']}/v6/matters")
    options = page.locator('.subbar label:has-text("路线") select option').all_inner_texts()
    ck("matters-filter-keeps-all-routes", all(x in " ".join(options) for x in ("中国实用新型", "中国发明", "美国非临时申请", "PCT")), " / ".join(options))
    EVIDENCE.skip("existing-foreign-target-openable", "UI 已不能新建海外目标，浏览器内造数据需要存储注入（本验收禁止）；该路径由 V6-14 渲染测试与 V6-14 S03-A10 覆盖。")
    context.close()
    use_instance(FULL)


def s_hygiene(contexts_note: str = "") -> None:
    hosts = sorted({r["origin"] for r in NET.requests})
    allowed = {FULL, UNCONFIGURED, UNDISCLOSED, "about://", "data://"}
    ck("network-all-same-origin", all(h in allowed or h.startswith(("blob:", "data:", "about:")) for h in hosts), f"origins={hosts}")
    ck("network-no-upstream-from-browser", not any(UPSTREAM.split("//")[1] in r["origin"] for r in NET.requests), "浏览器从未直接访问上游/假上游")
    files = [STATE["upstream"]["log"], *[i["wranglerLog"] for i in STATE["instances"].values()]]
    needles = {"materialSentinel": SECRETS["materialSentinel"], "extraSentinel": "SENTINEL-EXTRA-2b8e04d1", "accessCode": SECRETS["accessCode"],
               "modelKey": SECRETS["modelKey"], "sessionSecret": SECRETS["sessionSecret"], "promptFragment": "输入上下文（JSON", "syntheticOutput": SYNTH}
    report: dict[str, Any] = {}
    for f in files:
        text = Path(f).read_text(encoding="utf-8", errors="replace") if Path(f).exists() else ""
        report[Path(f).parent.name + "/" + Path(f).name] = {k: (v in text) for k, v in needles.items()} | {"bytes": len(text)}
    console = "\n".join(NET.console)
    report["browserConsole"] = {k: (v in console) for k, v in needles.items()} | {"lines": len(NET.console)}
    ck("logs-contain-no-bodies-or-secrets", not any(v for entry in report.values() for k, v in entry.items() if k in needles), json.dumps(report, ensure_ascii=False)[:700], hygiene=report)
    flags = NET.body_flags
    ck("request-bodies-carry-no-credentials", not any(f["containsModelKey"] or f["containsSessionSecret"] or f["containsAccessCode"] for f in flags), f"{len(flags)} POST bodies checked in memory")


def run_test_mode_regression() -> dict[str, Any]:
    """The unchanged test-mode full flow against the `unconfigured` instance."""
    env = {**os.environ, "ONLINE_BASE": UNCONFIGURED, "ONLINE_OUT": str(OUT / "test-mode-regression"), "PYTHONUNBUFFERED": "1"}
    proc = subprocess.run([sys.executable, "-I", str(ONLINE)], env=env, capture_output=True, text=True, timeout=1500)
    (OUT / "test-mode-regression.log").write_text(proc.stdout + "\n" + proc.stderr, encoding="utf-8")
    summary = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
    ck("test-mode-full-regression-on-unconfigured", proc.returncode == 0, f"exit={proc.returncode} {summary}")
    return {"exit": proc.returncode, "summary": summary}


# ---- driver -------------------------------------------------------------------------------------
def want(name: str) -> bool:
    return not ONLY or name in ONLY


def main() -> int:
    if os.environ.get("REAL_AI_DUMP_STACKS"):
        import faulthandler
        faulthandler.dump_traceback_later(90, repeat=True)
    up_call("/__reset", {})
    run: dict[str, Any] = {"startedAt": EVIDENCE.started_at, "dryRun": os.environ.get("REAL_AI_DRY_RUN") == "1",
                           "redirectWorkaround": STATE.get("redirectWorkaround"), "build": STATE["build"],
                           "scope": "链路验收：status→session→同意→chat→采纳→导出；不是真实模型质量验收；上游为本地合成假上游。"}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        context, page = new_context(browser, FULL)
        steps: list[tuple[str, Any]] = [
            ("env", lambda: s_env(page)), ("seed", lambda: s_seed(page)), ("gate", lambda: s_gate_before_consent(page)),
            ("authenticate", lambda: s_authenticate_and_agree(page)), ("faults", lambda: s_upstream_faults(page)),
            ("generate", lambda: s_generate_and_adopt(page)),
            ("invocations", lambda: s_invocations(page)),
            ("credentials", lambda: s_credentials(page, context)),
            ("markers", lambda: s_no_test_marker_everywhere(page)),
            ("reconfirm", lambda: s_reconfirm_after_adopt(page)), ("finish", lambda: s_finish_flow_and_download(page)),
            ("reconsent", lambda: s_material_change_needs_reconsent(page)), ("revoke", lambda: s_revoke_blocks_sends(page, context)),
            ("answeronly", lambda: s_answer_only(page)), ("missing", lambda: s_missing_answers(page)),
        ]
        for name, fn in steps:
            if not want(name):
                continue
            try:
                fn()
            except Exception as error:  # a broken step must not hide the rest
                if name == "seed":
                    # The question flow has a known reload-readback flake; retry the seed once.
                    note("seed-retry", page, f"第一次建案失败，重试：{type(error).__name__}: {error}")
                    try:
                        page.goto(f"{FULL}/v6", wait_until="domcontentloaded")
                        wait_dom(page)
                        s_seed(page)
                        continue
                    except Exception as second:
                        error = second
                ck(f"step-{name}-aborted", False, f"{type(error).__name__}: {error}", page)
                try:
                    page.screenshot(path=str(OUT / f"failure-{name}.png"), full_page=True)
                except Exception:
                    pass
        for name, fn in (("ai", lambda: s_ai_page_states(browser, page)), ("fallback", lambda: s_fallback_instances(browser)),
                         ("routes", lambda: s_route_narrowing(browser)), ("titlelogout", lambda: s_title_logout(page))):
            if want(name):
                try:
                    fn()
                except Exception as error:
                    ck(f"step-{name}-aborted", False, f"{type(error).__name__}: {error}")
        context.close()
        browser.close()
    if want("hygiene"):
        s_hygiene()
    if want("testmode") and not os.environ.get("REAL_AI_SKIP_TESTMODE"):
        run["testModeRegression"] = run_test_mode_regression()
    run["finishedAt"] = datetime.now(timezone.utc).isoformat()
    run["results"] = RESULTS
    run["failures"] = [r for r in RESULTS if not r["ok"]]
    run["upstreamStats"] = {k: v for k, v in up_stats().items() if k != "requests"}
    run["chatStatuses"] = sorted({r["status"] for r in NET.api if r["path"] == "/api/v6/chat"})
    run["sessionStatuses"] = sorted({r["status"] for r in NET.api if r["path"] == "/api/v6/session"})
    run["pageerrors"] = EVIDENCE.pageerrors
    expected_http_noise = len([r for r in NET.api if r["status"] >= 400])
    unexpected = [c for c in EVIDENCE.console_errors
                  if not re.search(r"Failed to load resource: the server responded with a status of (4|5)\d\d", c["text"])
                  and not (c["text"].endswith("net::ERR_FAILED") and c["url"].endswith("/v6/ai"))]
    run["consoleErrors"] = {"unexpected": unexpected, "expectedHttpErrorLines": len(EVIDENCE.console_errors) - len(unexpected), "apiNon2xxResponses": expected_http_noise}
    run["constraints"] = {"readOnlyIndexedDbInspection": True, "storageFixtureInjection": False, "productCodeChanged": False, "externalNetwork": False}
    (OUT / "real-ai-results.json").write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"checks": len(RESULTS), "failures": len(run["failures"]), "pageErrors": len(EVIDENCE.pageerrors), "unexpectedConsoleErrors": len(unexpected)}, ensure_ascii=False))
    return 1 if run["failures"] or EVIDENCE.pageerrors or unexpected else 0


if __name__ == "__main__":
    raise SystemExit(main())
