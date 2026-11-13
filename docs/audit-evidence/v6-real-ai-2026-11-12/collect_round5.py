#!/usr/bin/env python3
"""Round-5 visual comparison: implementation (local real-mode acceptance env) vs the V6 prototype.

Same method as round 4: getComputedStyle sampling, 1440x900 screenshots in light and dark,
1800px pair composites, plus the small `small-*.jpg` review images (<= 45 KB).

Additions this round: the outbound-consent sheet, the disabled route cards on the route step,
and the AI page service-status block.

Requires the environment from accept-env.mjs:
  REAL_AI_STATE=<state.json>  python3 -I collect_round5.py
The seed uses the real chain (access code -> consent -> generation -> adoption -> approval -> export)
so the captured pages are the ones a real-mode user actually sees.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import Page, TimeoutError, sync_playwright

HERE = Path(__file__).resolve().parent
ROUND = HERE / "round-5"
ROUND.mkdir(parents=True, exist_ok=True)
WORKTREE = HERE.parents[2]
PROTO = Path("/Users/jared/Personal Projects/Patent/docs/design/patent-saas-v6/prototype/index.html")
STATE = json.loads(Path(os.environ["REAL_AI_STATE"]).read_text(encoding="utf-8"))
BASE = os.environ.get("VISUAL_BASE", STATE["instances"]["full"]["url"]).rstrip("/") + "/v6"
PAGES = [
    "start", "upload", "parse", "questions", "route", "generate", "preview", "done",
    "inbox", "matters", "matter:overview", "matter:sources", "matter:facts", "matter:draft",
    "matter:check", "matter:deliver", "activity", "ai", "settings", "services", "pricing", "billing",
]
EXTRAS = ["consent-sheet", "workbench-consent", "route-cards", "ai-status"]
MODES = tuple(os.environ.get("VISUAL_MODES", "light,dark").split(","))
_only_pages = [p for p in os.environ.get("VISUAL_PAGES", "").split(",") if p]
if _only_pages:
    PAGES = [p for p in PAGES if p in _only_pages]
_only_extras = [p for p in os.environ.get("VISUAL_EXTRAS", "").split(",") if p]
if _only_extras:
    EXTRAS = [p for p in EXTRAS if p in _only_extras]

os.environ.setdefault("REAL_AI_OUT", str(ROUND / "_seed"))
os.environ.setdefault("REAL_AI_ONLY", "env")
spec = importlib.util.spec_from_file_location("real_ai", HERE / "run_real_ai.py")
assert spec and spec.loader
rai = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = rai
spec.loader.exec_module(rai)
helpers = rai
acc = rai.acc
goto, wait_dom = rai.goto, rai.wait_dom

MEASURE_JS = r"""() => {
  const isVisible = el => {
    if (!el) return false;
    const s=getComputedStyle(el), r=el.getBoundingClientRect();
    return s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)!==0 && r.width>0 && r.height>0;
  };
  const all = selector => [...document.querySelectorAll(selector)].filter(isVisible);
  const first = selectors => { for (const s of selectors) { const el = all(s)[0]; if (el) return el; } return null; };
  const css = el => {
    if (!el) return null;
    const s=getComputedStyle(el), r=el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), className: typeof el.className==='string'?el.className:'',
      text:(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,100),
      x:+r.x.toFixed(1), y:+r.y.toFixed(1), width:+r.width.toFixed(1), height:+r.height.toFixed(1),
      maxWidth:s.maxWidth, padding:s.padding, fontFamily:s.fontFamily, fontSize:s.fontSize, lineHeight:s.lineHeight,
      color:s.color, backgroundColor:s.backgroundColor, border:s.border, borderRadius:s.borderRadius,
      display:s.display, gridTemplateColumns:s.gridTemplateColumns, gap:s.gap };
  };
  const content = first(['.wiz-card','.q-wrap','.gen-wrap','.pane','.sheet','.doc','.card']);
  return {
    headings: [...document.querySelectorAll('h1,h2,.tb-title,.card-title,.wiz-h1')].filter(isVisible).slice(0,10)
      .map(e => (e.innerText||'').trim().replace(/\s+/g,' ').slice(0,80)),
    body: (() => { const s = getComputedStyle(document.body); return { fontFamily:s.fontFamily, fontSize:s.fontSize, lineHeight:s.lineHeight, backgroundColor:s.backgroundColor }; })(),
    toolbar: css(first(['.toolbar'])), content: css(content), sheet: css(first(['.sheet'])),
    consentbox: css(first(['.consentbox'])), tag: css(first(['.tag'])), callout: css(first(['.callout'])),
    routeCard: css(first(['.route-card'])),
    features: { toolbar: all('.toolbar').length > 0, sidebar: all('.sidebar').length > 0, tabs: all('.tabs').length > 0,
                sheet: all('.sheet').length > 0, callout: all('.callout').length > 0, cards: all('.card,.group,.optcard').length > 0 },
    viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
    htmlTheme: document.documentElement.getAttribute('data-theme'), htmlMode: document.documentElement.getAttribute('data-mode'),
    text: (document.body?.innerText || '').slice(0, 1600),
  };
}"""


def appearance(page: Page, mode: str) -> None:
    goto(page, f"{BASE}/settings")
    panel = helpers.visible(page.get_by_test_id("appearance"))
    if panel is None:
        raise RuntimeError("appearance panel missing")
    panel.locator('.seg[aria-label="主题"] label').filter(has_text="原生").first.click()
    panel.locator('.seg[aria-label="颜色模式"] label').filter(has_text="深色" if mode == "dark" else "浅色").first.click()
    wait_dom(page)
    page.wait_for_function("([theme, mode]) => document.documentElement.dataset.theme===theme && document.documentElement.dataset.mode===mode",
                           arg=["native", mode], timeout=10000)


def route_for(key: str, matter_id: str, target_id: str) -> str:
    if key == "start": return BASE
    if key in ("upload", "parse"): return f"{BASE}/new/{matter_id}/upload"
    if key == "questions": return f"{BASE}/new/{matter_id}/questions"
    if key == "route": return f"{BASE}/new/{matter_id}/route"
    if key == "generate": return f"{BASE}/new/{matter_id}/generate?target={target_id}"
    if key == "preview": return f"{BASE}/new/{matter_id}/preview?target={target_id}"
    if key == "done": return f"{BASE}/new/{matter_id}/done?target={target_id}"
    if key == "inbox": return f"{BASE}/inbox"
    if key == "matters": return f"{BASE}/matters"
    if key == "activity": return f"{BASE}/activity"
    if key.startswith("matter:"): return f"{BASE}/matters/{matter_id}/targets/{target_id}/{key.split(':', 1)[1]}"
    return f"{BASE}/{key}"


def composite(left_path: Path, right_path: Path, out_path: Path, key: str, mode: str) -> None:
    left = Image.open(left_path).convert("RGB").resize((900, 563), Image.Resampling.LANCZOS)
    right = Image.open(right_path).convert("RGB").resize((900, 563), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1800, 595), "white")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=15)
    draw.text((14, 8), f"PROTOTYPE | {key} | {mode}", fill="#111111", font=font)
    draw.text((914, 8), f"IMPLEMENTATION | {key} | {mode}", fill="#111111", font=font)
    canvas.paste(left, (0, 32))
    canvas.paste(right, (900, 32))
    canvas.save(out_path, "JPEG", quality=60, optimize=True, progressive=True)


def small(source: Path, target: Path, width: int = 1200, limit: int = 45 * 1024) -> dict[str, Any]:
    image = Image.open(source).convert("RGB")
    height = round(image.height * width / image.width)
    resized = image.resize((width, height), Image.Resampling.LANCZOS)
    quality = 50
    while quality >= 30:
        resized.save(target, "JPEG", quality=quality, optimize=True, progressive=True)
        if target.stat().st_size <= limit:
            break
        quality -= 5
    return {"file": target.name, "bytes": target.stat().st_size, "quality": quality, "size": [width, height]}


def seed(page: Page) -> dict[str, str]:
    """Real-mode matter: material -> questions -> target -> consent -> generation -> adoption -> approval -> export."""
    helpers.s_seed(page)
    helpers.s_authenticate_and_agree(page)
    helpers.s_generate_and_adopt(page)
    # adoption invalidates the grant; re-confirm so later captures show the steady state
    goto(page, helpers.draft_url(rai.S["matter"], rai.S["target"]))
    helpers.wait_for_consent_prompt(page)
    agree = helpers.tid(page, "workbench-consent-agree")
    if agree is not None and agree.is_enabled():
        agree.click()
        page.wait_for_timeout(1200)
    helpers.s_finish_flow_and_download(page)
    return {"matterId": rai.S["matter"], "targetId": rai.S["target"], "base": BASE, "exported": bool(rai.S.get("exported"))}


def capture_pair(page: Page, key: str, url: str, mode: str, prototype: bool, data: dict[str, Any]) -> dict[str, Any]:
    slug = key.replace(":", "-")
    proto_png = ROUND / f"prototype-{slug}-{mode}.png"
    impl_png = ROUND / f"implementation-{slug}-{mode}.png"
    pair = ROUND / f"pair-{slug}-{mode}.jpg"
    item: dict[str, Any] = {"key": key, "mode": mode, "prototypeUrl": f"{PROTO.as_uri()}#s={quote(key, safe=':')}&p=web&m={mode}&ui=0", "implementationUrl": url}
    try:
        page.goto(item["prototypeUrl"], wait_until="domcontentloaded", timeout=30000)
        page.reload(wait_until="domcontentloaded", timeout=30000)
        page.locator("#app .window").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(180)
        page.evaluate("window.scrollTo(0,0)")
        item["prototype"] = page.evaluate(MEASURE_JS)
        page.screenshot(path=str(proto_png), full_page=False, animations="disabled")
    except Exception as error:
        item["prototypeError"] = f"{type(error).__name__}: {error}"
    try:
        goto(page, url)
        page.evaluate("window.scrollTo(0,0)")
        item["implementation"] = page.evaluate(MEASURE_JS)
        page.screenshot(path=str(impl_png), full_page=False, animations="disabled")
    except Exception as error:
        item["implementationError"] = f"{type(error).__name__}: {error}"
    if proto_png.is_file() and impl_png.is_file():
        composite(proto_png, impl_png, pair, key, mode)
        item["pair"] = pair.name
    else:
        data["failures"].append({"step": f"capture:{key}:{mode}", "reason": item.get("prototypeError") or item.get("implementationError")})
    return item


def capture_extra(page: Page, name: str, mode: str, matter: str, target: str, data: dict[str, Any]) -> dict[str, Any]:
    """New this round: no prototype counterpart; reviewed as a single implementation image."""
    item: dict[str, Any] = {"key": name, "mode": mode}
    if name == "consent-sheet":
        goto(page, f"{BASE}/new/{matter}/generate?target={target}")
        helpers.wait_for_consent_prompt(page)
        if helpers.tid(page, "self-consent-disclosure") is None:
            opener = helpers.tid(page, "self-runtime-consent-open")
            if opener is not None:
                opener.click()
                page.wait_for_timeout(600)
        item["present"] = helpers.tid(page, "self-consent-disclosure") is not None
    elif name == "workbench-consent":
        goto(page, f"{BASE}/matters/{matter}/targets/{target}/draft")
        page.wait_for_timeout(1500)
        # The generation strip is a <details open={false}>: React re-closes it on every render,
        # so force it open again right before each attempt.
        for _ in range(6):
            if helpers.tid(page, "workbench-consent-disclosure") is not None:
                break
            page.evaluate("() => { const d = document.querySelector('[data-testid=workbench-generation-panel]'); if (d) d.open = true; }")
            if page.locator(".scrim").count():
                # a sheet is already open (auto-opened for a required consent); let it paint
                page.wait_for_timeout(700)
                continue
            opener = helpers.tid(page, "workbench-runtime-consent-open")
            if opener is not None and opener.is_enabled():
                try:
                    opener.click(timeout=5000)
                except Exception:
                    pass
                page.wait_for_timeout(800)
            page.wait_for_timeout(600)
        item["present"] = helpers.tid(page, "workbench-consent-disclosure") is not None
    elif name == "route-cards":
        goto(page, f"{BASE}/new/{matter}/route")
        page.wait_for_timeout(600)
        item["present"] = helpers.tid(page, "self-route-us_nonprovisional") is not None
    else:
        goto(page, f"{BASE}/ai")
        page.wait_for_timeout(1500)
        item["present"] = helpers.tid(page, "ai-service-status") is not None
    png = ROUND / f"implementation-{name}-{mode}.png"
    page.evaluate("window.scrollTo(0,0)")
    page.screenshot(path=str(png), full_page=False, animations="disabled")
    item["png"] = png.name
    item["measure"] = page.evaluate(MEASURE_JS)
    if not item["present"]:
        data["failures"].append({"step": f"extra:{name}:{mode}", "reason": "expected element not visible"})
    return item


def main() -> int:
    data: dict[str, Any] = {"startedAt": datetime.now(timezone.utc).isoformat(), "base": BASE, "prototype": str(PROTO),
                            "pages": PAGES, "extras": EXTRAS, "modes": list(MODES), "seed": {}, "captures": [], "failures": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN", timezone_id="Asia/Shanghai",
                                      device_scale_factor=1, accept_downloads=True)
        page = context.new_page()
        try:
            goto(page, BASE)
            data["seed"] = seed(page)
            data["seed"]["complete"] = True
        except Exception as error:
            data["seed"]["error"] = f"{type(error).__name__}: {error}"
            data["failures"].append({"step": "seed", "reason": data["seed"]["error"]})
            (ROUND / "visual-parity.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()
            return 1
        matter, target = data["seed"]["matterId"], data["seed"]["targetId"]
        for mode in MODES:
            appearance(page, mode)
            for key in PAGES:
                data["captures"].append(capture_pair(page, key, route_for(key, matter, target), mode, True, data))
                (ROUND / "visual-parity.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            for name in EXTRAS:
                data["captures"].append(capture_extra(page, name, mode, matter, target, data))
                (ROUND / "visual-parity.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        # small review images (<=45KB) for the new states
        data["small"] = []
        for name in EXTRAS:
            source = ROUND / f"implementation-{name}-light.png"
            if source.is_file():
                data["small"].append({"key": name, **small(source, ROUND / f"small-{name}.jpg")})
        for key in ("matter:draft", "ai", "route", "preview"):
            source = ROUND / f"implementation-{key.replace(':', '-')}-light.png"
            if source.is_file():
                data["small"].append({"key": key, **small(source, ROUND / f"small-{key.replace(':', '-')}.jpg")})
        data["finishedAt"] = datetime.now(timezone.utc).isoformat()
        (ROUND / "visual-parity.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()
    return 0 if not data["failures"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
