#!/usr/bin/env python3
"""Independent UI-only browser acceptance for the V6 prototype alignment.

Run only after the lead explicitly signals that acceptance may start and supplies
an already-running local base URL. This script never starts a server and never
reads or writes IndexedDB directly. All business changes use visible UI controls.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Locator, Page, TimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_UPLOAD = ROOT / "qa/v6/scenarios/V6-13/fixtures/intake-source.txt"
QA_PERSON = "V6 验收用发明人（合成）"
QA_ANSWERS = {
    "problem": "现有换热装置在低温环境下效率低，运行成本高。",
    "difference": "本方案改进流道结构以降低流动阻力，并保留一套管路。",
    "inventor": QA_PERSON,
    "disclosure": "exhibition",
    "maturity": "sample",
}
QUESTION_KEYS = ("problem", "difference", "inventorIds", "disclosure", "maturity")
QUESTION_TEXT = {
    "problem": QA_ANSWERS["problem"],
    "difference": QA_ANSWERS["difference"],
    "inventorIds": QA_PERSON,
    "disclosure": "上市前曾在 2025 年行业展会公开展示样机；验收数据来自合成 fixture。",
    "maturity": "已有测试样品；验收数据来自合成 fixture。",
}
ROUTE_NAME = "中国实用新型"
TEST_MARKER_PATTERN = re.compile(r"测试输出|本地测试稿|测试生成|测试草稿|stub", re.I)
SYNTHETIC_FACT = "【合成验收事实】验收样本所用换热装置在低温环境下效率低、运行成本高；内容依据本次上传的 intake-source.txt。"
SYNTHETIC_FIGURE_NAME = "synthetic-acceptance-figure.png"
BASELINE = {"viewport": {"width": 1440, "height": 900}, "locale": "zh-CN"}


class Evidence:
    def __init__(self, out_dir: Path):
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.records: list[dict[str, Any]] = []
        self.failures: list[dict[str, str]] = []
        self.blocked: list[dict[str, str]] = []
        self.skipped: list[dict[str, str]] = []
        self.pageerrors: list[dict[str, str]] = []
        self.console_errors: list[dict[str, str]] = []
        self.downloads: list[dict[str, Any]] = []
        self.context: BrowserContext | None = None

    def attach(self, page: Page) -> None:
        page.on("pageerror", lambda error: self.pageerrors.append({"url": page.url, "error": str(error)[:1000]}))
        page.on("console", lambda message: self.console_errors.append({"url": page.url, "text": message.text[:1000]})
                 if message.type == "error" else None)

    def record(self, name: str, page: Page, status: str = "observed", detail: str = "") -> None:
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_")[:100] or "capture"
        screenshot = self.out_dir / f"{safe}.png"
        try:
            page.screenshot(path=str(screenshot), full_page=True, animations="disabled")
        except Exception as error:  # Evidence capture must not hide the original state.
            self.failures.append({"step": f"screenshot:{name}", "reason": str(error)[:500]})
        try:
            info = page.evaluate("""() => ({
              title: document.title,
              text: (document.body?.innerText || '').slice(0, 5000),
              viewport: {width: innerWidth, height: innerHeight},
              documentWidth: document.documentElement?.scrollWidth ?? null,
              theme: document.documentElement?.getAttribute('data-theme'),
              mode: document.documentElement?.getAttribute('data-mode'),
              route: location.pathname + location.search + location.hash,
            })""")
        except Exception as error:
            info = {"text": "", "domError": str(error)[:500]}
        self.records.append({
            "name": name,
            "status": status,
            "detail": detail,
            "url": page.url,
            "screenshot": screenshot.name,
            **info,
        })
        self.write_partial()

    def fail(self, step: str, reason: str, page: Page | None = None) -> None:
        self.failures.append({"step": step, "reason": reason[:1000]})
        if page is not None:
            self.record(f"failure-{step}", page, "fail", reason)
        self.write_partial()

    def block(self, step: str, reason: str, page: Page | None = None) -> None:
        self.blocked.append({"step": step, "reason": reason[:1000]})
        if page is not None:
            self.record(f"blocked-{step}", page, "blocked", reason)
        self.write_partial()

    def skip(self, step: str, reason: str) -> None:
        self.skipped.append({"step": step, "reason": reason[:1000]})
        self.write_partial()

    def write_partial(self) -> None:
        payload = self.as_dict()
        (self.out_dir / "browser-acceptance.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "startedAt": getattr(self, "started_at", None),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "records": self.records,
            "failures": self.failures,
            "blocked": self.blocked,
            "skipped": self.skipped,
            "pageerrors": self.pageerrors,
            "consoleErrors": self.console_errors,
            "downloads": self.downloads,
            "constraints": {
                "directIndexedDbAccess": False,
                "storageFixtureInjection": False,
                "serverStartedByScript": False,
                "externalGeneration": False,
                "submissionOrFiling": False,
            },
        }


def visible(locator: Locator) -> Locator | None:
    try:
        for index in range(locator.count()):
            item = locator.nth(index)
            if item.is_visible():
                return item
    except Exception:
        return None
    return None


def first_visible(page: Page, selectors: list[str]) -> Locator | None:
    for selector in selectors:
        item = visible(page.locator(selector))
        if item is not None:
            return item
    return None


def button_by_testid(page: Page, names: tuple[str, ...]) -> Locator | None:
    for name in names:
        item = visible(page.get_by_test_id(name))
        if item is not None and item.is_enabled():
            return item
    return None


def click_named(page: Page, patterns: tuple[str, ...], *, buttons_only: bool = True) -> bool:
    for pattern in patterns:
        regex = re.compile(pattern)
        candidates = [page.get_by_role("button", name=regex)]
        if not buttons_only:
            candidates.extend([page.get_by_role("link", name=regex)])
        for candidate in candidates:
            item = visible(candidate)
            if item is not None and item.is_enabled():
                item.click()
                return True
    return False


def wait_dom(page: Page) -> None:
    page.locator("body").wait_for(state="visible", timeout=20000)
    page.wait_for_timeout(250)


def question_box(page: Page, key: str) -> Locator | None:
    candidates = [
        page.get_by_test_id(f"self-question-{key}"),
        page.get_by_test_id(f"question-{key}"),
        page.get_by_test_id(f"intake-question-{key}"),
        page.locator(f'[data-question-key="{key}"]'),
    ]
    for candidate in candidates:
        item = visible(candidate)
        if item is not None:
            return item
    return None


def choose_select(select: Locator, preferred: tuple[str, ...], *, allow_first_nonempty: bool = False) -> str | None:
    options = select.locator("option").evaluate_all("els => els.map(e => ({value:e.value, text:e.innerText.trim(), disabled:e.disabled}))")
    for pattern in preferred:
        regex = re.compile(pattern, re.I)
        match = next((item for item in options if not item["disabled"] and item["value"] and regex.search(item["text"])), None)
        if match:
            select.select_option(match["value"])
            return match["text"]
    if allow_first_nonempty:
        match = next((item for item in options if not item["disabled"] and item["value"]), None)
        if match:
            select.select_option(match["value"])
            return match["text"]
    return None


def source_selector(page: Page, key: str, box: Locator | None) -> Locator | None:
    candidate = visible(page.get_by_test_id(f"intake-source-{key}"))
    if candidate is not None:
        return candidate
    scope = box if box is not None else page.locator("main, form, body").last
    selects = scope.locator("select")
    try:
        for index in range(selects.count() - 1, -1, -1):
            item = selects.nth(index)
            if item.is_visible():
                label = (item.get_attribute("aria-label") or "") + " " + (item.get_attribute("name") or "")
                surrounding = item.locator("xpath=ancestor::label[1]")
                if "来源" in label or (surrounding.count() and "来源" in surrounding.inner_text()):
                    return item
    except Exception:
        return None
    return None


def add_or_select_test_person(page: Page, box: Locator | None, evidence: Evidence, step: str) -> bool:
    name_input = first_visible(page, [
        '[data-testid="intake-party-name"]',
        'input[placeholder*="姓名"]',
        'input[aria-label*="发明人"]',
    ])
    if name_input is not None:
        try:
            name_input.fill(QA_PERSON)
            kind = visible(page.get_by_test_id("intake-party-kind"))
            if kind is not None:
                kind.select_option("person")
            add = button_by_testid(page, ("intake-party-add",))
            if add is not None:
                add.click()
            else:
                click_named(page, ("添加人员", "添加发明人", "保存人员"))
        except Exception as error:
            evidence.fail(step, f"无法通过人员表单添加 QA 姓名：{error}", page)
            return False
    # Resolve the control from the exact visible QA name; never select the first
    # arbitrary inventor checkbox on the page.
    for pattern in (QA_PERSON,):
        item = visible(page.get_by_text(pattern, exact=False))
        if item is not None:
            try:
                parent = item.locator("xpath=ancestor::label[1]")
                control = parent.locator('input[type="checkbox"], input[type="radio"]')
                if control.count():
                    if not control.first.is_checked():
                        control.first.check()
                    return control.first.is_checked()
                selected = item.get_attribute("aria-pressed") == "true" or item.get_attribute("data-selected") == "true"
                return selected
            except Exception:
                continue
    evidence.block(step, "页面没有可见的按姓名创建/选择发明人控件；不输入人员 ID。", page)
    return False


def fill_question(page: Page, key: str, has_upload: bool, evidence: Evidence) -> bool:
    box = question_box(page, key)
    text = QUESTION_TEXT[key]
    try:
        if key in ("problem", "difference"):
            control = visible(page.get_by_test_id(f"intake-answer-{key}"))
            if control is None and box is not None:
                control = visible(box.locator("textarea, input[type=text], [contenteditable=true]"))
            if control is None:
                control = first_visible(page, ["textarea", 'input[type="text"]', '[contenteditable="true"]'])
            if control is None:
                evidence.block(f"question:{key}", "当前题目没有可见文本输入控件。", page)
                return False
            control.fill(text)
        elif key == "inventorIds":
            if not add_or_select_test_person(page, box, evidence, "question:inventorIds"):
                return False
        elif key in ("disclosure", "maturity"):
            control = visible(page.get_by_test_id(f"intake-answer-{key}"))
            if control is None and box is not None:
                selects = box.locator("select")
                control = visible(selects.first) if selects.count() else None
            if control is None:
                control = first_visible(page, [f'select[name="{key}"]', "select"])
            if control is None:
                evidence.block(f"question:{key}", "当前题目没有可见选择控件。", page)
                return False
            preferred = ("公开活动|展会|已公开|不确定",) if key == "disclosure" else ("已有测试样品|样品",)
            selected = choose_select(control, preferred, allow_first_nonempty=False)
            if selected is None:
                evidence.block(f"question:{key}", "页面没有可显式选择的预期选项；未接受默认值。", page)
                return False
        src = source_selector(page, key, box)
        if src is None:
            evidence.block(f"question-source:{key}", "当前题目没有可见来源控件；无法证明来源是直接回答或上传材料。", page)
            return False
        if has_upload:
            selected = choose_select(src, ("intake-source.txt", "换热装置", "流道结构", "展会"), allow_first_nonempty=False)
            if selected is None:
                opts = src.locator("option").evaluate_all("els => els.map(e => ({value:e.value,text:e.innerText.trim(),disabled:e.disabled}))")
                evidence.block(f"question-source:{key}", f"没有能确认来自上传材料的来源选项；可见项：{opts[:12]}", page)
                return False
        else:
            selected = choose_select(src, ("用户直接回答", "直接回答"), allow_first_nonempty=False)
            if selected is None:
                evidence.block(f"question-source:{key}", "无文档路径没有可见的直接回答来源选项。", page)
                return False
        return True
    except Exception as error:
        evidence.fail(f"question:{key}", str(error), page)
        return False


def submit_one_question(page: Page) -> bool:
    # Use the question's own action first so unrelated route/target actions cannot be triggered.
    selectors = [
        '[data-testid="self-question-save"]',
        '[data-testid="question-save"]',
        '[data-testid="intake-save"]',
        'button[data-testid*="question-next"]',
    ]
    item = first_visible(page, selectors)
    if item is not None and item.is_enabled():
        item.click()
        return True
    return click_named(page, ("保存并继续", "保存本题", "保存答案", "下一题", "继续"))


def question_readback(page: Page, key: str, expected: str) -> tuple[bool, dict[str, Any]]:
    box = question_box(page, key)
    evidence: dict[str, Any] = {"questionVisible": box is not None}
    if box is not None:
        answered = box.get_attribute("data-answered")
        evidence["dataAnswered"] = answered
        if answered == "true":
            return True, evidence
        controls = box.locator("textarea, input, select")
        values: list[str] = []
        for index in range(controls.count()):
            control = controls.nth(index)
            if control.is_visible():
                try:
                    values.append(control.input_value())
                except Exception:
                    continue
        evidence["visibleValues"] = values
        if any(expected[:12] in value for value in values):
            return True, evidence
        if key == "inventorIds" and any(QA_PERSON in value for value in values):
            return True, evidence
    try:
        visible_text = page.locator("body").inner_text()
    except Exception:
        visible_text = ""
    evidence["expectedTextVisible"] = expected[:18] in visible_text
    return bool(evidence["expectedTextVisible"]), evidence


def reload_and_capture(page: Page, evidence: Evidence, name: str) -> None:
    url = page.url
    page.reload(wait_until="domcontentloaded", timeout=30000)
    wait_dom(page)
    evidence.record(name, page, "observed", f"reload: {url}")


def matter_id_from(page: Page) -> str | None:
    match = re.search(r"/matters/([^/?#]+)|/new/([^/?#]+)", page.url)
    return next((part for part in match.groups() if part), None) if match else None


def create_matter(page: Page, evidence: Evidence, name: str) -> str | None:
    base = getattr(page, "_acceptance_base", None)
    if not base:
        evidence.fail(f"{name}:create", "脚本没有配置应用 base URL。", page)
        return None
    page.goto(f"{base}/v6", wait_until="domcontentloaded")
    wait_dom(page)
    evidence.record(f"{name}-home", page)
    created = click_named(page, (r"^创建案件$", r"^开始准备$", r"开始自助", r"自助起草"))
    if not created:
        evidence.fail(f"{name}:create", "首页没有可用的创建案件/自助起草按钮。", page)
        return None
    try:
        page.wait_for_url(re.compile(r"/(?:matters|new)/[^/]+/(?:upload|questions)?"), timeout=15000)
    except TimeoutError:
        pass
    wait_dom(page)
    mid = matter_id_from(page)
    if mid is None:
        evidence.fail(f"{name}:create", "创建动作后无法从 URL 取得 matterId。", page)
        return None
    evidence.record(f"{name}-created", page, "pass", f"matterId={mid}")
    return mid


def upload_fixture(page: Page, fixture: Path, evidence: Evidence, name: str) -> bool:
    if not fixture.is_file():
        evidence.block(f"{name}:upload", f"上传 fixture 不存在：{fixture}", page)
        return False
    upload = first_visible(page, ['input[type="file"]', '[data-testid="upload-input"]'])
    if upload is None:
        evidence.block(f"{name}:upload", "上传步骤没有可见或可定位的文件选择控件。", page)
        return False
    try:
        upload.set_input_files(str(fixture))
        evidence.record(f"{name}-file-selected", page, "observed", fixture.name)
        save = button_by_testid(page, ("upload-save", "self-upload-save"))
        if save is None:
            save = visible(page.get_by_role("button", name=re.compile("保存材料|保存文件|上传材料")))
        if save is None or not save.is_enabled():
            evidence.block(f"{name}:upload-save", "文件已选择，但页面没有可用的保存材料动作。", page)
            return False
        save.click()
        try:
            page.get_by_test_id("upload-all-saved").wait_for(state="visible", timeout=30000)
        except TimeoutError:
            page.get_by_text(re.compile("已保存|解析完成|材料已保存在本机")).wait_for(state="visible", timeout=30000)
        wait_dom(page)
        evidence.record(f"{name}-file-saved", page, "pass", "等待 UI 显示真实保存/解析完成状态")
        return True
    except Exception as error:
        evidence.fail(f"{name}:upload", str(error), page)
        return False


def run_parse(page: Page, evidence: Evidence) -> bool:
    try:
        page.locator('[data-testid="parse"]').wait_for(state="visible", timeout=20000)
        starts = page.locator('[data-testid^="parse-start-"]')
        if starts.count() > 0:
            starts.first.click()
        page.wait_for_function("""() => {
          const rows = Array.from(document.querySelectorAll('[data-testid^="parse-row-"]'));
          return rows.length > 0 && rows.every(r => ['parsed','partial'].includes(r.getAttribute('data-state') || ''));
        }""", timeout=60000)
        evidence.record("upload-parsed", page, "pass", "页面显示所有材料已解析")
        return True
    except Exception as error:
        evidence.block("upload-parse", f"材料没有在页面显示解析完成：{error}", page)
        return False


def advance_to_questions(page: Page, evidence: Evidence, name: str) -> bool:
    if re.search(r"/(?:new/[^/]+/questions|questions)(?:/|$|[?#])", page.url):
        return True
    if click_named(page, ("继续补充信息", "回答问题", "补充信息", "开始答题", "下一步")):
        wait_dom(page)
        evidence.record(f"{name}-questions-entry", page, "observed", "经页面继续动作进入问答")
        return True
    evidence.block(f"{name}:questions-entry", "页面没有可用的继续/回答问题入口；没有直接写入事实。", page)
    return False


def check_choice_unset(page: Page, key: str, box: Locator | None, evidence: Evidence, name: str) -> bool:
    control = visible(page.get_by_test_id(f"intake-answer-{key}"))
    if control is None:
        step = visible(page.get_by_test_id("self-questions-step"))
        if step is not None and step.get_attribute("data-question") == key:
            control = visible(step.locator("select").first)
    if control is None and box is not None:
        selects = box.locator("select")
        control = visible(selects.first) if selects.count() else None
    if control is None:
        evidence.block(f"{name}:default:{key}", "无法从当前题目的 UI 读取公开历史/成熟度初始选择状态。", page)
        return False
    try:
        value = control.input_value()
        selected = control.locator("option:checked").inner_text()
        is_unset = value == "" or bool(re.search(r"请选择|尚未选择|未选择|不自动填写", selected))
        evidence.record(f"{name}-default-{key}", page, "pass" if is_unset else "fail",
                        f"初始值={value!r}；显示选项={selected}")
        if not is_unset:
            evidence.fail(f"{name}:default:{key}", "公开历史或成熟度在用户选择前已有预选值。", page)
        return is_unset
    except Exception as error:
        evidence.fail(f"{name}:default:{key}", str(error), page)
        return False


def self_question_prefix(page: Page) -> str | None:
    match = re.match(r"^(.*?/v6/new/[^/?#]+/questions)", page.url)
    return match.group(1) if match else None


def open_self_question(page: Page, index: int, evidence: Evidence, name: str) -> bool:
    prefix = self_question_prefix(page)
    if prefix is None:
        # The wizard may currently be on another step; use its questions nav link.
        link = visible(page.locator('[aria-label="自助申请步骤"] a').filter(has_text="补充信息"))
        if link is None:
            evidence.block(f"{name}:question-nav", "页面没有可用的「补充信息」步骤入口。", page)
            return False
        link.click()
        wait_dom(page)
        prefix = self_question_prefix(page)
    if prefix is None:
        evidence.block(f"{name}:question-url", "无法从页面 URL 进入问答步骤。", page)
        return False
    page.goto(f"{prefix}?q={index}", wait_until="domcontentloaded")
    try:
        page.get_by_test_id("self-questions-step").first.wait_for(state="attached", timeout=15000)
    except TimeoutError:
        pass
    wait_dom(page)
    step = visible(page.get_by_test_id("self-questions-step"))
    if step is None:
        evidence.block(f"{name}:question-step", "问答步骤没有渲染 self-questions-step。", page)
        return False
    return True


def fill_self_question(page: Page, key: str, has_upload: bool, evidence: Evidence, name: str) -> bool:
    step = visible(page.get_by_test_id("self-questions-step"))
    if step is None:
        evidence.block(f"{name}:question:{key}", "当前页面没有问答步骤。", page)
        return False
    shown = step.get_attribute("data-question")
    if shown != key:
        evidence.block(f"{name}:question:{key}", f"页面当前题目是 {shown}，不是预期的 {key}。", page)
        return False
    try:
        if key in ("problem", "difference"):
            area = visible(step.locator("textarea"))
            if area is None:
                evidence.block(f"{name}:question:{key}", "当前题目没有可见文本框。", page)
                return False
            area.fill(QUESTION_TEXT[key])
        elif key == "inventorIds":
            name_input = visible(step.locator('input[aria-label="发明人姓名"]'))
            if name_input is None:
                evidence.block(f"{name}:question:inventorIds", "没有按姓名添加发明人的输入框。", page)
                return False
            name_input.fill(QA_PERSON)
            add = visible(step.get_by_role("button", name=re.compile("添加姓名")))
            if add is None or not add.is_enabled():
                evidence.block(f"{name}:question:inventorIds", "按姓名添加发明人的按钮不可用。", page)
                return False
            add.click()
            row = step.locator("label").filter(has_text=QA_PERSON)
            checkbox = visible(row.locator('input[type="checkbox"]'))
            if checkbox is None:
                evidence.block(f"{name}:question:inventorIds", "添加姓名后没有出现可选择的人员项。", page)
                return False
            if not checkbox.is_checked():
                checkbox.check()
        elif key in ("disclosure", "maturity"):
            select = visible(step.locator("select").first)
            if select is None:
                evidence.block(f"{name}:question:{key}", "当前题目没有可见选择框。", page)
                return False
            preferred = ("公开活动|展会",) if key == "disclosure" else ("已有测试样品|样品",)
            if choose_select(select, preferred) is None:
                evidence.block(f"{name}:question:{key}", "页面没有可显式选择的预期选项；未接受默认值。", page)
                return False
        source = visible(step.locator(f'select#self-source-{key}'))
        if source is None:
            source = visible(step.locator("select").last)
        if source is None:
            evidence.block(f"{name}:question-source:{key}", "当前题目没有来源选择框。", page)
            return False
        if has_upload:
            selected = choose_select(source, ("intake-source", "换热装置", "低温环境", "流道结构"))
            if selected is None:
                selected = choose_select(source, ("材料中未找到",))
        else:
            selected = choose_select(source, ("用户直接回答", "直接回答"))
        if selected is None:
            options = source.locator("option").all_text_contents()
            evidence.block(f"{name}:question-source:{key}", f"没有符合路径的来源选项：{options[:10]}", page)
            return False
        evidence.record(f"{name}-question-{key}-filled", page, "observed", f"来源={selected}")
        return True
    except Exception as error:
        evidence.fail(f"{name}:question:{key}", str(error), page)
        return False


def read_self_question(page: Page, key: str) -> dict[str, Any]:
    step = visible(page.get_by_test_id("self-questions-step"))
    if step is None:
        return {"stepVisible": False}
    result: dict[str, Any] = {"stepVisible": True, "shown": step.get_attribute("data-question")}
    if key in ("problem", "difference"):
        area = visible(step.locator("textarea"))
        result["value"] = area.input_value() if area is not None else None
    elif key == "inventorIds":
        checkbox = visible(step.locator("label").filter(has_text=QA_PERSON).locator('input[type="checkbox"]'))
        result["checked"] = checkbox.is_checked() if checkbox is not None else False
    elif key in ("disclosure", "maturity"):
        select = visible(step.locator("select").first)
        result["value"] = select.input_value() if select is not None else None
    return result


def answer_questions(page: Page, has_upload: bool, evidence: Evidence, name: str) -> bool:
    completed = 0
    for index, key in enumerate(QUESTION_KEYS):
        if not open_self_question(page, index, evidence, name):
            return False
        if key in ("disclosure", "maturity") and not check_choice_unset(page, key, None, evidence, name):
            return False
        if not fill_self_question(page, key, has_upload, evidence, name):
            return False
        next_button = visible(page.get_by_test_id("self-questions-step").get_by_role(
            "button", name=re.compile("保存并继续|完成并选择路线")))
        if next_button is None or not next_button.is_enabled():
            evidence.block(f"{name}:question:{key}:save", "当前题没有可用的保存并继续动作。", page)
            return False
        next_button.click()
        wait_dom(page)
        # Return to this question by its app-supported ?q= link and prove the
        # saved value survives a real reload.
        if not open_self_question(page, index, evidence, name):
            return False
        readback = read_self_question(page, key)
        evidence.record(f"{name}-question-{key}-saved", page, "observed", json.dumps(readback, ensure_ascii=False))
        expected = QUESTION_TEXT[key]
        if key in ("problem", "difference"):
            ok = readback.get("value") == expected
        elif key == "inventorIds":
            ok = readback.get("checked") is True
        else:
            ok = readback.get("value") not in (None, "")
        evidence.records[-1]["savedValueMatches"] = ok
        if not ok:
            evidence.block(f"{name}:question:{key}:readback", "重新打开此题时没有读回刚保存的值。", page)
            return False
        reload_and_capture(page, evidence, f"{name}-question-{key}-reload")
        try:
            page.wait_for_function("""key => {
              const e = document.querySelector('[data-testid="self-questions-step"]');
              return !!e && e.getAttribute('data-question') === key;
            }""", arg=key, timeout=15000)
        except TimeoutError:
            pass
        wait_dom(page)
        after = read_self_question(page, key)
        evidence.records[-1]["reloadReadback"] = after
        if key in ("problem", "difference"):
            ok_after = after.get("value") == expected
        elif key == "inventorIds":
            ok_after = after.get("checked") is True
        else:
            ok_after = after.get("value") not in (None, "")
        evidence.records[-1]["reloadValueMatches"] = ok_after
        if not ok_after:
            evidence.block(f"{name}:question:{key}:reload-check", "reload 后没有读回此题的已保存值。", page)
            return False
        completed += 1
    evidence.record(f"{name}-questions-complete", page, "pass", f"{completed} 题均经 UI 保存并在每题后 reload")
    return completed == len(QUESTION_KEYS)


def choose_route_and_create_target(page: Page, evidence: Evidence, name: str) -> str | None:
    if visible(page.get_by_test_id("self-route-step")) is None:
        link = visible(page.locator('[aria-label="自助申请步骤"] a').filter(has_text="选择路线"))
        if link is None:
            evidence.block(f"{name}:route-step", "页面没有可用的「选择路线」步骤入口。", page)
            return None
        link.click()
        wait_dom(page)
    try:
        page.get_by_test_id("self-route-step").first.wait_for(state="attached", timeout=15000)
    except TimeoutError:
        pass
    step = visible(page.get_by_test_id("self-route-step"))
    if step is None:
        evidence.block(f"{name}:route-step", "路线步骤没有渲染 self-route-step。", page)
        return None
    try:
        card = visible(step.get_by_role("radio", name=re.compile(ROUTE_NAME)))
        if card is None:
            evidence.block(f"{name}:route", f"没有可按显示名称「{ROUTE_NAME}」选择的路线卡。", page)
            return None
        card.click()
        if card.get_attribute("aria-checked") != "true":
            evidence.block(f"{name}:route", "点击路线卡后 aria-checked 没有变为 true。", page)
            return None
        person_row = step.locator("label").filter(has_text=QA_PERSON)
        person_checkbox = visible(person_row.locator('input[type="checkbox"]'))
        if person_checkbox is None:
            evidence.block(f"{name}:route-person", "路线页没有按姓名显示的验收人员项；未输入人员 ID。", page)
            return None
        if not person_checkbox.is_checked():
            person_checkbox.check()
        evidence.record(f"{name}-route-selected", page, "observed", f"按名称选择：{ROUTE_NAME}；人员：{QA_PERSON}")
        save = visible(step.get_by_role("button", name=re.compile("保存路线并继续")))
        if save is None or not save.is_enabled():
            evidence.block(f"{name}:target-create", "保存路线并继续按钮不可用。", page)
            return None
        save.click()
        try:
            page.wait_for_url(re.compile(r"/v6/new/[^/]+/generate\?.*target="), timeout=20000)
        except TimeoutError:
            pass
        wait_dom(page)
        match = re.search(r"[?&]target=([0-9a-f-]{36})", page.url)
        target_id = match.group(1) if match else None
        if target_id is None:
            evidence.block(f"{name}:target-id", "保存路线后 URL 没有带出真实 targetId。", page)
            return None
        evidence.record(f"{name}-target-created", page, "pass", f"targetId={target_id}")
        if visible(page.get_by_test_id("self-generation")) is None:
            evidence.block(f"{name}:generate-step", "保存路线后没有进入生成步骤。", page)
        return target_id
    except Exception as error:
        evidence.fail(f"{name}:target-create", str(error), page)
        return None


def capture_global_activity(page: Page, base: str, evidence: Evidence, name: str, matter_ids: tuple[str | None, ...]) -> None:
    activity_page = page.context.new_page()
    evidence.attach(activity_page)
    try:
        activity_page.set_viewport_size({"width": 1440, "height": 900})
        activity_page.goto(f"{base}/v6/activity", wait_until="domcontentloaded")
        wait_dom(activity_page)
        evidence.record(name, activity_page, "observed", f"matters={','.join(value for value in matter_ids if value)}")
        body = activity_page.locator("body").inner_text()
        nodes = activity_page.locator('[data-testid*="activity"], [data-testid*="event"]')
        rows = activity_page.locator('[data-testid^="activity-"]')
        evidence.records[-1]["activityNodeCount"] = nodes.count()
        evidence.records[-1]["activityRowCount"] = rows.count()
        matter_filter = visible(activity_page.locator('[data-testid="activity-filters"] select').first)
        evidence.records[-1]["matterFilterOptions"] = matter_filter.locator("option").all_text_contents() if matter_filter else []
        evidence.records[-1]["visibleMatterIds"] = {value: bool(value and value in body) for value in matter_ids}
    finally:
        activity_page.close()


def target_url(base: str, matter_id: str, target_id: str, tab: str) -> str:
    return f"{base}/v6/matters/{matter_id}/targets/{target_id}/{tab}"


def marker_state(page: Page, scope: str) -> dict[str, Any]:
    root = visible(page.locator(scope))
    if root is None:
        return {"scopeFound": False, "found": False, "markers": [], "text": ""}
    try:
        value = root.evaluate("""root => {
          const nodes = [root, ...root.querySelectorAll('[data-test-output], [data-testid*="test-output"], [data-testid*="test-marker"], [data-testid*="test-label"]')];
          return {
            text: (root.innerText || '').slice(0, 1600),
            markers: nodes.map(node => ({
              testid: node.getAttribute('data-testid'),
              testOutput: node.getAttribute('data-test-output'),
              text: (node.innerText || '').trim().slice(0, 300)
            })).filter(item => item.testid || item.testOutput || item.text)
          };
        }""")
    except Exception as error:
        return {"scopeFound": True, "found": False, "error": str(error)[:300], "markers": [], "text": ""}
    flag_values = [item.get("testOutput") for item in value.get("markers", []) if item.get("testOutput") is not None]
    explicit_true = any(flag == "true" for flag in flag_values)
    explicit_false = any(flag == "false" for flag in flag_values)
    notice = any(
        "test-output" in (item.get("testid") or "") and TEST_MARKER_PATTERN.search(item.get("text", ""))
        for item in value.get("markers", [])
    )
    flagged = explicit_true or notice
    if explicit_false:
        flagged = False
    return {"scopeFound": True, "found": flagged, "testOutputFlags": flag_values, **value}


def assert_test_marker(page: Page, evidence: Evidence, step: str, scope: str) -> bool:
    state = marker_state(page, scope)
    status = "pass" if state.get("found") else "fail"
    evidence.record(step, page, status, "验证测试输出标记仍在（data-testid / data-test-output / 可见文案任一为真）")
    evidence.records[-1]["testOutputMarker"] = state
    if status == "fail":
        evidence.fail(f"{step}:test-output-marker", "作用域内既没有测试输出标记节点，也没有「测试输出」可见文案；或显式标记为 false。", page)
        return False
    return True


def make_synthetic_figure(page: Page, evidence: Evidence) -> Path | None:
    image_page = page.context.new_page()
    evidence.attach(image_page)
    try:
        image_page.goto("about:blank")
        encoded = image_page.evaluate("""async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 360;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('2d canvas unavailable');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = '#202020'; ctx.lineWidth = 5; ctx.strokeRect(12, 12, 616, 336);
          ctx.fillStyle = '#111'; ctx.font = 'bold 58px "PingFang SC", "Noto Sans CJK SC", sans-serif';
          ctx.fillText('验收合成图', 42, 145);
          ctx.font = '28px "PingFang SC", "Noto Sans CJK SC", sans-serif';
          ctx.fillText('仅用于浏览器验收，不代表真实专利附图', 42, 215);
          ctx.fillText('synthetic QA input', 42, 270);
          return canvas.toDataURL('image/png').split(',')[1];
        }""")
        raw = base64.b64decode(encoded, validate=True)
        if not raw.startswith(bytes([137, 80, 78, 71, 13, 10, 26, 10])):
            raise ValueError("canvas output is not a PNG")
        path = evidence.out_dir / SYNTHETIC_FIGURE_NAME
        path.write_bytes(raw)
        evidence.record("synthetic-figure-created", image_page, "pass", "生成带「验收合成图」字样的合成 PNG 测试输入")
        evidence.records[-1]["file"] = path.name
        evidence.records[-1]["bytes"] = len(raw)
        return path
    except Exception as error:
        evidence.fail("synthetic-figure-create", str(error), image_page)
        return None
    finally:
        image_page.close()


def import_and_bind_synthetic_figure(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> bool:
    image_path = make_synthetic_figure(page, evidence)
    if image_path is None:
        return False
    page.goto(target_url(base, matter_id, target_id, "sources"), wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "figures")
    wait_dom(page)
    figures = visible(page.get_by_test_id("figures"))
    if figures is None:
        evidence.block("synthetic-figure-ui", "材料页没有附图导入面板；未写入任何本机存储。", page)
        return False
    file_input = figures.locator('input[type="file"]')
    try:
        file_input.set_input_files({"name": SYNTHETIC_FIGURE_NAME, "mimeType": "image/png", "buffer": image_path.read_bytes()})
        row = page.locator('[data-testid^="figure-row-"]').filter(has_text=SYNTHETIC_FIGURE_NAME)
        row.wait_for(state="visible", timeout=20000)
        testid = row.first.get_attribute("data-testid") or ""
        drawing_id = testid.removeprefix("figure-row-")
        if not drawing_id:
            evidence.block("synthetic-figure-id", "页面导入成功但没有可见 drawing 行标识。", page)
            return False
        if "已编入图集" not in row.first.inner_text():
            append = visible(page.get_by_test_id(f"figure-append-{drawing_id}"))
            if append is None or not append.is_enabled():
                evidence.block("synthetic-figure-bind", "合成图已进入图库，但页面没有可用的「编入图集」按钮。", page)
                return False
            append.click()
        entries = page.get_by_test_id("figures-set-entries")
        entries.wait_for(state="visible", timeout=20000)
        page.get_by_text(SYNTHETIC_FIGURE_NAME, exact=False).wait_for(state="visible", timeout=10000)
        evidence.record("synthetic-figure-bound", page, "pass", f"drawingId={drawing_id}; 通过材料 UI 导入并编入当前目标图集")
        bound_row = page.locator('[data-testid^="figure-row-"]').filter(has_text=SYNTHETIC_FIGURE_NAME)
        evidence.records[-1]["boundVisible"] = "已编入图集" in bound_row.first.inner_text()
        reload_and_capture(page, evidence, "synthetic-figure-reload")
        persisted = "已编入图集" in page.locator('[data-testid^="figure-row-"]').filter(has_text=SYNTHETIC_FIGURE_NAME).first.inner_text()
        evidence.records[-1]["boundAfterReload"] = persisted
        if not persisted:
            evidence.fail("synthetic-figure-reload", "合成图 reload 后没有保持在目标图集中。", page)
        return persisted
    except Exception as error:
        evidence.fail("synthetic-figure-ui", str(error), page)
        return False


def ensure_synthetic_figure_when_missing(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> bool:
    page.goto(target_url(base, matter_id, target_id, "sources"), wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "figures")
    wait_dom(page)
    entries = page.locator('[data-testid^="figure-entry-"]')
    if entries.count() > 0:
        evidence.record("figure-gate-already-satisfied", page, "observed", f"目标已有 {entries.count()} 个图集项；未追加合成图")
        return True
    evidence.record("figure-gate-missing", page, "observed", "目标没有图集项；通过正规 UI 添加合成验收图以继续导出验证")
    return import_and_bind_synthetic_figure(page, base, matter_id, target_id, evidence)


def wait_testid(page: Page, testid: str, timeout: int = 20000) -> bool:
    try:
        page.get_by_test_id(testid).first.wait_for(state="attached", timeout=timeout)
        return True
    except TimeoutError:
        return False


def confirm_synthetic_fact(page: Page, base: str, matter_id: str, evidence: Evidence) -> bool:
    page.goto(f"{base}/v6/matters/{matter_id}/facts", wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "intake")
    wait_testid(page, "intake-fact-statement")
    wait_dom(page)
    rows = page.locator('li[data-testid^="intake-fact-"]')
    existing = rows.filter(has_text="【合成验收事实】")
    if existing.count() and "用户确认" in existing.first.inner_text():
        evidence.record("synthetic-fact-already-confirmed", page, "pass", "页面已有来源可核验且明确标记的合成验收事实")
        return True
    statement = visible(page.get_by_test_id("intake-fact-statement"))
    status = visible(page.get_by_test_id("intake-fact-status"))
    chunk = visible(page.get_by_test_id("intake-fact-chunk"))
    if statement is None or status is None or chunk is None:
        evidence.block("synthetic-fact-ui", "事实页没有可通过 UI 新增并确认来源的控件。", page)
        return False
    statement.fill(SYNTHETIC_FACT)
    kind = visible(page.get_by_test_id("intake-fact-kind"))
    if kind is not None:
        kind.select_option("problem")
    status.select_option("user_confirmed")
    selected = choose_select(chunk, ("低温环境", "换热装置"), allow_first_nonempty=False)
    if selected is None:
        evidence.block("synthetic-fact-source", "上传 fixture 没有可绑定到合成事实的实际解析段落；未新增无来源确认。", page)
        return False
    add = visible(page.get_by_test_id("intake-fact-add"))
    if add is None or not add.is_enabled():
        evidence.block("synthetic-fact-add", "事实页没有可用的添加事实控件。", page)
        return False
    add.click()
    save = button_by_testid(page, ("intake-save",))
    if save is None:
        evidence.block("synthetic-fact-save", "新增合成事实尚未保存，页面保存动作不可用。", page)
        return False
    save.click()
    try:
        page.get_by_test_id("intake-save-status").wait_for(state="visible", timeout=20000)
    except TimeoutError:
        evidence.block("synthetic-fact-save", "页面未确认事实快照已保存。", page)
        return False
    evidence.record("synthetic-fact-saved", page, "observed", f"明确标记合成内容；UI 来源={selected}；状态=用户确认")
    reload_and_capture(page, evidence, "synthetic-fact-reload")
    saved = page.locator('li[data-testid^="intake-fact-"]').filter(has_text="【合成验收事实】")
    ok = saved.count() > 0 and "用户确认" in saved.first.inner_text()
    evidence.records[-1]["userConfirmedAfterReload"] = ok
    if not ok:
        evidence.fail("synthetic-fact-reload", "合成测试事实 reload 后未保留用户确认状态。", page)
    return ok


def manual_draft_fallback(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> None:
    """When stub adoption is unavailable, a real manual draft still lets the
    check/risk UI be exercised through normal controls. It is clearly recorded
    as a fallback, never presented as the generated test revision."""
    page.goto(target_url(base, matter_id, target_id, "draft"), wait_until="domcontentloaded")
    wait_dom(page)
    manual = visible(page.get_by_test_id("draft-manual"))
    if manual is None:
        evidence.block("manual-draft", "草稿空状态没有「手工撰写」入口，无法建立可检查的修订。", page)
        return
    manual.click()
    wait_dom(page)
    section = visible(page.get_by_test_id("draft-section-embodiments"))
    if section is None:
        evidence.block("manual-draft", "手工草稿没有渲染说明书分区。", page)
        return
    add = visible(section.get_by_role("button", name=re.compile("添加段落")))
    if add is not None:
        add.click()
        wait_dom(page)
        area = visible(section.locator("textarea"))
        if area is not None:
            area.fill("【验收合成内容】用于验证检查与确认流程，不是真实申请文本。")
    save = visible(page.get_by_test_id("draft-save"))
    if save is None:
        evidence.block("manual-draft", "手工草稿没有保存修订入口。", page)
        return
    try:
        page.wait_for_function("""() => { const e=document.querySelector('[data-testid="draft-save"]'); return !!e && !e.disabled; }""", timeout=10000)
        save.click()
        page.wait_for_function("""() => {
          const e=document.querySelector('[data-testid="draft-revision"]');
          return !!e && !e.innerText.includes('未保存');
        }""", timeout=20000)
    except TimeoutError as error:
        evidence.block("manual-draft", f"手工草稿没有保存为修订：{error}", page)
        return
    evidence.record("manual-draft-saved", page, "observed", "经页面手工撰写并保存了带明确验收标记的草稿修订（非生成测试输出）")

    ack_ids = run_checks(page, base, matter_id, target_id, evidence, "manual-draft")
    if not ack_ids:
        evidence.block("risk-ack", "当前检查没有真实风险确认控件；A10 无法通过（不制造风险）。", page)
        return
    ack_id = ack_ids[0]
    button = visible(page.get_by_test_id(ack_id))
    if button is None:
        evidence.block("risk-ack", f"风险确认控件 {ack_id} 不可见。", page)
        return
    button.click()
    page.get_by_test_id(ack_id.replace("check-ack-", "check-acknowledged-")).wait_for(state="visible", timeout=15000)
    evidence.record("risk-ack-saved", page, "pass", f"确认真实 finding：{ack_id}")
    reload_and_capture(page, evidence, "risk-ack-reload")
    still = visible(page.get_by_test_id(ack_id.replace("check-ack-", "check-acknowledged-"))) is not None
    evidence.records[-1]["ackStillVisibleAfterReload"] = still
    if still:
        evidence.record("risk-ack-persistence", page, "pass", "reload 后同一风险仍显示已确认")
    else:
        evidence.fail("risk-ack-reload", "风险确认 reload 后没有恢复为已确认状态。", page)

    # A new revision must invalidate the old acknowledgement.
    page.goto(target_url(base, matter_id, target_id, "draft"), wait_until="domcontentloaded")
    wait_dom(page)
    section = visible(page.get_by_test_id("draft-section-embodiments"))
    area = visible(section.locator("textarea")) if section is not None else None
    if area is None:
        evidence.block("old-ack-invalidated", "无法从编辑器修改段落，旧确认失效未验证。", page)
        return
    area.fill(area.input_value().rstrip() + "（修订二）")
    save = visible(page.get_by_test_id("draft-save"))
    try:
        page.wait_for_function("""() => { const e=document.querySelector('[data-testid="draft-save"]'); return !!e && !e.disabled; }""", timeout=10000)
        save.click()
        page.wait_for_timeout(800)
    except Exception as error:
        evidence.block("old-ack-invalidated", f"修订二没有保存：{error}", page)
        return
    evidence.record("revision-two-saved", page, "observed", "保存第二版手工修订")
    verify_old_ack_invalidated(page, base, matter_id, target_id, ack_id, evidence)


def run_generation(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> bool:
    page.goto(target_url(base, matter_id, target_id, "draft"), wait_until="domcontentloaded")
    wait_dom(page)
    evidence.record("generation-before", page)
    start = button_by_testid(page, ("generation-start",))
    if start is None:
        disabled_start = visible(page.get_by_test_id("generation-start"))
        if disabled_start is not None:
            evidence.block("generation:start", "生成入口存在但被禁用；不绕过 blocker。", page)
        else:
            evidence.block("generation:start", "草稿页没有可用的本地生成入口；检查生成引擎提示与 disabled 原因。", page)
        return False
    if not start.is_enabled():
        evidence.block("generation:start", "生成入口存在但被禁用；不绕过 blocker。", page)
        return False
    start.click()
    try:
        page.wait_for_function("""() => {
          const g = document.querySelector('[data-testid="generation"]');
          return !!g && (g.getAttribute('data-job-state') === 'succeeded' || g.getAttribute('data-job-state') === 'failed');
        }""", timeout=120000)
    except TimeoutError:
        evidence.block("generation:wait", "生成没有在 120 秒内显示成功或失败终态；保留当前 UI。", page)
        evidence.record("generation-timeout", page, "blocked")
        return False
    wait_dom(page)
    result = visible(page.get_by_test_id("generation-result"))
    if result is None:
        evidence.block("generation:result", "生成结束但没有候选结果区。", page)
        return False
    flag = result.get_attribute("data-test-output")
    marker_state_before = marker_state(page, '[data-testid="generation-result"]')
    local_label = bool(TEST_MARKER_PATTERN.search(result.inner_text()))
    evidence.record("generation-result", page, "observed", f"data-test-output={flag}; visibleLocalLabel={local_label}")
    evidence.records[-1]["testOutputMarker"] = marker_state_before
    if flag == "false" or not marker_state_before.get("found") or not local_label:
        evidence.fail("generation:label", "候选区没有可见的测试输出标记或文案（或显式标记为 false）。", page)
        return False

    # Simulate the normal job recovery path before adoption. The completed job
    # must reload with its marked candidate intact.
    reload_and_capture(page, evidence, "generation-recovery-reload")
    try:
        page.get_by_test_id("generation-result").wait_for(state="visible", timeout=30000)
    except TimeoutError:
        evidence.block("generation:recovery", "reload 后没有恢复候选结果。", page)
        return False
    if not assert_test_marker(page, evidence, "generation-recovery-marker", '[data-testid="generation-result"]'):
        return False
    recovered_result = visible(page.get_by_test_id("generation-result"))
    if recovered_result is None or not marker_state(page, '[data-testid="generation-result"]').get("found"):
        evidence.fail("generation:recovery", "reload 后候选区的测试输出标记消失。", page)
        return False
    adopt = visible(page.get_by_test_id("generation-adopt"))
    if adopt is None or not adopt.is_enabled():
        notice = visible(page.get_by_test_id("generation-test-output"))
        evidence.record("generation-adopt-unavailable", page, "blocked",
                        f"adopt按钮={'absent' if adopt is None else 'disabled'}；提示={notice.inner_text() if notice else '无'}")
        evidence.block("generation:adopt", "测试候选无法通过页面采纳；记录禁用原因，不修改修订数据。", page)
        return False
    adopt.click()
    try:
        page.get_by_test_id("draft-editor").wait_for(state="visible", timeout=20000)
    except TimeoutError:
        pass
    wait_dom(page)
    evidence.record("generation-adopted", page, "observed", "已通过采纳按钮；检查编辑器修订上的 testOutput 标记")
    return assert_test_marker(page, evidence, "generation-adopted-marker", '[data-testid="professional-workbench"]')


def run_checks(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence, suffix: str) -> list[str]:
    page.goto(target_url(base, matter_id, target_id, "check"), wait_until="domcontentloaded")
    wait_dom(page)
    run = button_by_testid(page, ("checks-run",))
    if run is not None and run.is_enabled():
        run.click()
        page.wait_for_timeout(750)
    wait_dom(page)
    evidence.record(f"checks-{suffix}", page)
    risk_cards = page.locator('[data-testid^="check-finding-"][data-category="risk"]')
    ack_buttons = page.locator('[data-testid^="check-ack-"]')
    ack_ids = ack_buttons.evaluate_all("els => els.map(e => e.getAttribute('data-testid'))")
    evidence.records[-1]["riskFindingCount"] = risk_cards.count()
    evidence.records[-1]["ackButtonIds"] = ack_ids
    return ack_ids


def acknowledge_first_risk_and_reload(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> str | None:
    ack_ids = run_checks(page, base, matter_id, target_id, evidence, "before-ack")
    if not ack_ids:
        evidence.block("risk-ack", "真实检查结果没有可见的风险确认按钮；记录 finding 数量和检查正文，不制造风险。", page)
        return None
    acknowledged: list[str] = []
    for ack_id in ack_ids:
        button = visible(page.get_by_test_id(ack_id))
        if button is None or not button.is_enabled():
            evidence.block("risk-ack", f"风险确认控件 {ack_id} 不可操作。", page)
            continue
        button.click()
        page.get_by_test_id(ack_id.replace("check-ack-", "check-acknowledged-")).wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(500)
        acknowledged.append(ack_id)
    if not acknowledged:
        return None
    time_before = visible(page.get_by_test_id("checks-time"))
    check_time_before = time_before.inner_text() if time_before is not None else None
    evidence.record("risk-ack-saved", page, "pass", f"确认了真实 finding：{', '.join(acknowledged)}")
    page.wait_for_timeout(2000)
    reload_and_capture(page, evidence, "risk-ack-reload")
    try:
        page.wait_for_function("""() => {
          const p = document.querySelector('[data-testid="checks-panel"]');
          return !!p && p.getAttribute('data-state') !== 'loading'
            && !!document.querySelector('[data-testid="checks-time"]');
        }""", timeout=20000)
    except TimeoutError:
        pass
    wait_dom(page)
    time_after = visible(page.get_by_test_id("checks-time"))
    check_time_after = time_after.inner_text() if time_after is not None else None
    evidence.records[-1]["checkTimeBeforeReload"] = check_time_before
    evidence.records[-1]["checkTimeAfterReload"] = check_time_after
    evidence.records[-1]["checkRunChangedOnReload"] = check_time_before != check_time_after
    still = [ack for ack in acknowledged
             if visible(page.get_by_test_id(ack.replace("check-ack-", "check-acknowledged-"))) is not None]
    evidence.records[-1]["ackStillVisibleAfterReload"] = still
    evidence.records[-1]["ackCount"] = len(acknowledged)
    if len(still) != len(acknowledged):
        evidence.fail("risk-ack-reload", f"风险确认 reload 后丢失：{len(still)}/{len(acknowledged)} 恢复；检查时间 {check_time_before} -> {check_time_after}", page)
    return acknowledged[0]


def confirm_professional_paragraphs(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence, name: str) -> int:
    page.goto(target_url(base, matter_id, target_id, "draft"), wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "draft-editor")
    wait_testid(page, "draft-review")
    try:
        page.wait_for_function("""() => {
          const e = document.querySelector('[data-testid="draft-editor"]');
          const r = document.querySelector('[data-testid="draft-review"]');
          return !!e && !!r && e.getAttribute('data-state') !== 'loading' && r.getAttribute('data-state') !== 'loading';
        }""", timeout=30000)
    except TimeoutError:
        pass
    wait_dom(page)
    review = visible(page.get_by_test_id("draft-review"))
    editor = visible(page.get_by_test_id("draft-editor"))
    if review is None or editor is None:
        evidence.block(f"{name}:same-page", "草稿编辑器和逐段审阅面板没有同时出现在当前页面。", page)
        return 0
    positions = page.evaluate("""() => {
      const box = id => { const e=document.querySelector(`[data-testid="${id}"]`); if(!e)return null;
        const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
      return {editor:box('draft-editor'),review:box('draft-review')};
    }""")
    evidence.record(f"{name}-same-page", page, "observed", json.dumps(positions, ensure_ascii=False))
    evidence.records[-1]["samePagePanels"] = positions
    pending = page.locator('[data-testid^="draft-review-confirm-"]')
    ids = pending.evaluate_all("els => els.map(e => e.getAttribute('data-testid'))")
    if not ids:
        no_paragraphs = page.get_by_text(re.compile("没有需要逐段确认|没有.*AI/混合段落"))
        if visible(no_paragraphs) is not None:
            evidence.block(f"{name}:paragraph-confirm", "当前修订没有 AI/混合段落，不能验证逐段确认。", page)
        else:
            evidence.block(f"{name}:paragraph-confirm", "当前修订没有可见的逐段确认控件。", page)
        return 0
    for testid in ids:
        item = visible(page.get_by_test_id(testid))
        if item is None or not item.is_enabled():
            # A previous confirmation can briefly re-render the list; give the
            # control one settle window before calling it unavailable.
            try:
                page.wait_for_function("""testid => {
                  const e = document.querySelector(`[data-testid="${testid}"]`);
                  return !!e && !e.disabled;
                }""", arg=testid, timeout=5000)
                item = visible(page.get_by_test_id(testid))
            except TimeoutError:
                item = None
        if item is None or not item.is_enabled():
            evidence.block(f"{name}:paragraph-confirm", f"逐段确认控件不可操作：{testid}", page)
            continue
        item.click()
        paragraph = page.get_by_test_id(testid.replace("draft-review-confirm-", "draft-review-paragraph-"))
        paragraph.wait_for(state="visible", timeout=10000)
        try:
            page.wait_for_function("""testid => {
              const e = document.querySelector(`[data-testid="${testid}"]`);
              return !!e && e.getAttribute('data-confirmed') === 'true';
            }""", arg=testid.replace("draft-review-confirm-", "draft-review-paragraph-"), timeout=10000)
        except TimeoutError:
            pass
    confirmed = page.locator('[data-testid^="draft-review-paragraph-"][data-confirmed="true"]').count()
    evidence.record(f"{name}-paragraphs-confirmed", page, "observed", f"pending={len(ids)} confirmed={confirmed}")
    reload_and_capture(page, evidence, f"{name}-paragraphs-reload")
    try:
        page.wait_for_function("""() => {
          const r = document.querySelector('[data-testid="draft-review"]');
          return !!r && r.getAttribute('data-state') !== 'loading';
        }""", timeout=20000)
    except TimeoutError:
        pass
    page.wait_for_timeout(1000)
    wait_dom(page)
    after = page.locator('[data-testid^="draft-review-paragraph-"][data-confirmed="true"]').count()
    evidence.records[-1]["confirmedParagraphsAfterReload"] = after
    if after < len(ids):
        evidence.fail(f"{name}:paragraph-confirm-reload", f"逐段确认 reload 后数量减少：before={len(ids)} after={after}", page)
    return after


def edit_title_and_check_marker(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> bool:
    page.goto(target_url(base, matter_id, target_id, "draft"), wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "draft-title")
    wait_dom(page)
    editor = visible(page.get_by_test_id("draft-editor"))
    title = visible(page.get_by_test_id("draft-title"))
    if editor is None or title is None:
        evidence.block("revision-title-edit", "编辑器没有可见的稿件标题控件。", page)
        return False
    revision = visible(page.get_by_test_id("draft-revision"))
    previous_revision = revision.inner_text() if revision is not None else ""
    title.fill(title.input_value().rstrip() + " · 验收标题编辑")
    save = visible(page.get_by_test_id("draft-save"))
    if save is None:
        evidence.block("revision-title-edit", "标题修改后没有可见保存修订控件。", page)
        return False
    try:
        page.wait_for_function("""() => {
          const e=document.querySelector('[data-testid="draft-save"]'); return !!e && !e.disabled;
        }""", timeout=10000)
        save.click()
        if previous_revision:
            page.wait_for_function("""previous => {
              const e=document.querySelector('[data-testid="draft-revision"]'); return !!e && e.innerText !== previous;
            }""", arg=previous_revision, timeout=20000)
    except TimeoutError as error:
        evidence.block("revision-title-edit", f"标题修改没有产生可确认的新修订：{error}", page)
        return False
    evidence.record("revision-title-edited", page, "observed", "通过 UI 修改标题并保存新修订")
    return assert_test_marker(page, evidence, "test-marker-after-title-edit", '[data-testid="professional-workbench"]')


def edit_one_paragraph(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> bool:
    page.goto(target_url(base, matter_id, target_id, "draft"), wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "draft-editor")
    try:
        page.wait_for_function("""() => {
          const e = document.querySelector('[data-testid="draft-editor"]');
          return !!e && e.getAttribute('data-state') !== 'loading';
        }""", timeout=30000)
    except TimeoutError:
        pass
    wait_dom(page)
    editor = visible(page.get_by_test_id("draft-editor"))
    if editor is None:
        evidence.block("revision-edit", "草稿编辑器不可见；不能验证旧确认失效。", page)
        return False
    candidates = editor.locator('textarea[aria-label], [contenteditable="true"][data-draft-paragraph]')
    control = visible(candidates)
    if control is None:
        evidence.block("revision-edit", "编辑器没有可见可编辑段落；未修改 DOM 或存储。", page)
        return False
    try:
        revision = visible(page.get_by_test_id("draft-revision"))
        previous_revision = revision.inner_text() if revision is not None else ""
        old = control.input_value() if control.evaluate("e => 'value' in e") else control.inner_text()
        if not old.strip():
            evidence.block("revision-edit", "找到的编辑控件为空，不能确认它是已保存草稿段落。", page)
            return False
        new = old.rstrip() + "（V6 浏览器验收修订）"
        control.fill(new)
        save = visible(page.get_by_test_id("draft-save"))
        if save is None:
            save = visible(page.get_by_role("button", name=re.compile("保存.*修订|保存草稿|保存更改")))
        if save is None:
            evidence.block("revision-edit", "编辑后没有可见的保存修订控件；没有尝试绕过。", page)
            return False
        try:
            page.wait_for_function("""previous => {
              const e=document.querySelector('[data-testid="draft-save"]');
              return !!e && !e.disabled;
            }""", arg=previous_revision, timeout=10000)
        except TimeoutError:
            if not save.is_enabled():
                evidence.block("revision-edit", "编辑后保存修订仍不可用；没有尝试绕过。", page)
                return False
        save.click()
        if previous_revision:
            try:
                page.wait_for_function("""previous => {
                  const e=document.querySelector('[data-testid="draft-revision"]');
                  return !!e && e.innerText !== previous;
                }""", arg=previous_revision, timeout=20000)
            except TimeoutError:
                evidence.block("revision-edit", "保存后修订标识没有变化；没有声称产生了新修订。", page)
                return False
        page.wait_for_timeout(250)
        evidence.record("revision-edited", page, "observed", "通过页面编辑器保存了一个段落变更并检查修订标识")
        if not assert_test_marker(page, evidence, "test-marker-after-paragraph-edit", '[data-testid="professional-workbench"]'):
            return False
        reload_and_capture(page, evidence, "draft-editor-recovery-reload")
        return assert_test_marker(page, evidence, "test-marker-after-editor-recovery", '[data-testid="professional-workbench"]')
    except Exception as error:
        evidence.fail("revision-edit", str(error), page)
        return False


def verify_old_ack_invalidated(page: Page, base: str, matter_id: str, target_id: str, old_ack_id: str | None, evidence: Evidence) -> None:
    if old_ack_id is None:
        evidence.skip("old-ack-invalidated", "本轮没有可确认的真实风险记录。")
        return
    page.goto(target_url(base, matter_id, target_id, "check"), wait_until="domcontentloaded")
    wait_dom(page)
    evidence.record("old-ack-after-revision", page)
    confirmed_testid = old_ack_id.replace("check-ack-", "check-acknowledged-")
    old_confirmed = visible(page.get_by_test_id(confirmed_testid)) is not None
    pending_ack_ids = page.locator('[data-testid^="check-ack-"]').evaluate_all("els => els.map(e => e.getAttribute('data-testid'))")
    stale_text = bool(re.search(r"已过期|陈旧|失效|需要重新确认", page.locator("body").inner_text()))
    evidence.records[-1]["oldAckStillCurrent"] = old_confirmed
    evidence.records[-1]["newSnapshotPendingAckIds"] = pending_ack_ids
    evidence.records[-1]["staleTextVisible"] = stale_text
    if old_confirmed:
        evidence.fail("old-ack-invalidated", "修订变化后旧风险确认仍显示为当前已确认。", page)
    elif not stale_text and not pending_ack_ids:
        evidence.block("old-ack-invalidated", "旧确认不再显示，但页面也没有待确认风险或陈旧提示，无法从 UI 判定失效原因。", page)
    else:
        evidence.record("old-ack-invalidated-result", page, "pass", "旧风险确认未显示为当前确认；页面显示陈旧或新快照待确认状态。")
    # A new run is allowed through the UI to ensure the old run is not reused as current.
    run_checks(page, base, matter_id, target_id, evidence, "after-revision")
    evidence.record("old-ack-after-new-check", page)


def confirm_self_read(page: Page, base: str, matter_id: str, evidence: Evidence) -> bool:
    route = f"{base}/v6/new/{matter_id}/preview"
    page.goto(route, wait_until="domcontentloaded")
    wait_dom(page)
    evidence.record("self-preview", page)
    if not assert_test_marker(page, evidence, "test-marker-preview", '[data-testid="self-preview-step"]'):
        return False
    panel = visible(page.get_by_test_id("preview-confirmation"))
    if panel is None:
        evidence.block("self-read", "自助预览没有当前修订的通读确认表单（可能尚无可预览修订或路径未开放）。", page)
        return False
    checkbox = visible(panel.locator('input[type="checkbox"]'))
    button = visible(panel.get_by_role("button", name=re.compile("确认通读|已通读")))
    if checkbox is None or button is None:
        evidence.block("self-read", "通读确认复选框或提交按钮不可见。", page)
        return False
    checkbox.check()
    if not button.is_enabled():
        evidence.block("self-read", "勾选后通读确认仍不可用。", page)
        return False
    button.click()
    if visible(page.get_by_test_id("preview-confirmed")) is None:
        try:
            page.get_by_test_id("preview-confirmed").wait_for(state="visible", timeout=15000)
        except TimeoutError:
            evidence.block("self-read", "提交后页面没有显示已通读确认状态。", page)
            return False
    evidence.record("self-read-confirmed", page, "pass", "已通过自助预览 UI 保存通读确认")
    reload_and_capture(page, evidence, "self-read-reload")
    if visible(page.get_by_test_id("preview-confirmed")) is None:
        evidence.fail("self-read-reload", "通读确认 reload 后未恢复。", page)
        return False
    return assert_test_marker(page, evidence, "test-marker-preview-after-reload", '[data-testid="self-preview-step"]')


def approve_and_check_gate(page: Page, base: str, matter_id: str, target_id: str, evidence: Evidence) -> bool:
    page.goto(target_url(base, matter_id, target_id, "deliver"), wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "approval-panel")
    try:
        page.wait_for_function("""() => {
          const e = document.querySelector('[data-testid="approval-panel"]');
          return !!e && e.getAttribute('data-state') !== 'loading';
        }""", timeout=30000)
    except TimeoutError:
        pass
    wait_dom(page)
    evidence.record("approval-before", page)
    approve_gate = visible(page.get_by_test_id("approval-gate-approve"))
    export_gate = visible(page.get_by_test_id("approval-gate-export"))
    evidence.records[-1]["approveAllowedBefore"] = approve_gate.get_attribute("data-allowed") if approve_gate else None
    evidence.records[-1]["exportAllowedBefore"] = export_gate.get_attribute("data-allowed") if export_gate else None
    button = visible(page.get_by_test_id("approval-create-button"))
    if button is None or not button.is_enabled():
        reasons = page.locator('[data-testid="approval-gate-approve"]').inner_text() if approve_gate else "批准门禁不可见"
        evidence.block("approval", f"批准动作被真实门禁阻止；未执行批准。原因：{reasons}", page)
        return False
    button.click()
    page.wait_for_timeout(500)
    current = visible(page.get_by_test_id("approval-gate-export"))
    allowed_after = current.get_attribute("data-allowed") if current else None
    evidence.record("approval-after", page, "observed", f"无需 reload；exportAllowed={allowed_after}")
    count = page.locator('[data-testid^="approval-record-"]').count()
    evidence.records[-1]["approvalRecordCount"] = count
    if count == 0:
        evidence.fail("approval", "批准按钮已点击，但没有可见批准记录。", page)
        return False
    if allowed_after != "true":
        gate_text = current.inner_text() if current else "导出门禁不可见"
        evidence.block("approval-gate-update", f"批准记录已创建但导出门禁未即时开放：{gate_text}", page)
        return False
    evidence.record("approval-gate-open", page, "pass", "批准后同页导出门禁允许")
    return True


def _docx_first_paragraph(xml: bytes) -> str:
    try:
        from xml.etree import ElementTree
        root = ElementTree.fromstring(xml)
        ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        for paragraph in root.iter(f"{ns}p"):
            text = "".join(node.text or "" for node in paragraph.iter(f"{ns}t"))
            if text.strip():
                return text
        return ""
    except Exception:
        match = re.search(r"<w:p[ >].*?</w:p>", xml.decode("utf-8", "replace"), re.S)
        return re.sub(r"<[^>]+>", "", match.group(0)) if match else ""


def _decode_pdf_bytes(raw: bytes) -> str:
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", "replace")
    for encoding in ("utf-8", "latin-1"):
        try:
            return raw.decode(encoding)
        except Exception:
            continue
    return raw.decode("latin-1", "replace")


def _pdf_decode_literal(literal: str) -> str:
    body = literal[1:-1]
    out = bytearray()
    index = 0
    escapes = {"n": 10, "r": 13, "t": 9, "b": 8, "f": 12}
    while index < len(body):
        character = body[index]
        if character != "\\":
            out.extend(character.encode("latin-1", "replace"))
            index += 1
            continue
        index += 1
        if index >= len(body):
            break
        next_character = body[index]
        if next_character in escapes:
            out.append(escapes[next_character])
            index += 1
        elif next_character in "()\\":
            out.append(ord(next_character))
            index += 1
        elif next_character.isdigit():
            digits = ""
            while index < len(body) and len(digits) < 3 and body[index].isdigit():
                digits += body[index]
                index += 1
            out.append(int(digits, 8) & 0xFF)
        elif next_character in "\r\n":
            index += 1
        else:
            out.extend(next_character.encode("latin-1", "replace"))
            index += 1
    return _decode_pdf_bytes(bytes(out))


def _pdf_metadata(raw: bytes) -> dict[str, str]:
    metadata: dict[str, str] = {}
    text = raw.decode("latin-1", "replace")
    for match in re.finditer(r"/(Title|Subject|Keywords)\s*(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>)", text):
        key = match.group(1)
        token = match.group(2)
        try:
            if token.startswith("("):
                value = _pdf_decode_literal(token)
            else:
                value = _decode_pdf_bytes(bytes.fromhex(re.sub(r"\s+", "", token[1:-1])))
        except Exception:
            continue
        if value.strip():
            metadata[key] = value
    xmp_text = text
    for key, tag in (("Title", "dc:title"), ("Subject", "dc:description"), ("Keywords", "pdf:Keywords")):
        for match in re.finditer(rf"<{tag}[^>]*>(.*?)</{tag}>", xmp_text, re.S):
            inner = match.group(1)
            values = re.findall(r"<rdf:li[^>]*>(.*?)</rdf:li>", inner, re.S) or [inner]
            decoded = " ".join(
                _xml_unescape(re.sub(r"<[^>]+>", " ", value)).strip()
                for value in values
            ).strip()
            if decoded:
                metadata.setdefault(key, decoded)
    marker_needles = [
        "测试输出", "仅用于验证流程", "不能作为正式申请材料",
        "测试输出".encode("utf-16-be").decode("latin-1"),
    ]
    metadata["_rawMarker"] = "true" if any(needle in text for needle in marker_needles) else "false"
    return metadata


def _xml_unescape(value: str) -> str:
    import html
    return html.unescape(value)


def _pdf_metadata_has_marker(metadata: dict[str, str]) -> bool:
    fields = [metadata.get(key, "") for key in ("Title", "Subject", "Keywords")]
    joined = " ".join(fields)
    if TEST_MARKER_PATTERN.search(joined):
        return True
    return metadata.get("_rawMarker") == "true"


def validate_download(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"name": path.name, "bytes": path.stat().st_size, "sha256": None, "kind": "unknown", "valid": False, "members": [],
                              "testOutputMarkerPresent": False, "testOutputFlagSeen": False, "testOutputMarkerEntries": []}
    import hashlib
    result["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    raw = path.read_bytes()
    if zipfile.is_zipfile(path) and path.suffix.lower() == ".docx":
        result["kind"] = "docx"
        with zipfile.ZipFile(path) as docx:
            names = docx.namelist()
            result["members"] = names
            xml = docx.read("word/document.xml") if "word/document.xml" in names else b""
            text = xml.decode("utf-8", "replace")
            result["docxChecks"] = [{"name": path.name, "contentTypes": "[Content_Types].xml" in names,
                                     "documentXml": bool(xml), "wellFormedXml": _xml_well_formed(xml)}]
            result["documentText"] = re.sub(r"<[^>]+>", "", text)[:4000]
            first_paragraph = _docx_first_paragraph(xml)
            result["firstParagraph"] = first_paragraph[:500]
            result["firstParagraphTestOutputMarker"] = bool(TEST_MARKER_PATTERN.search(first_paragraph))
            result["bodyTestOutputMarker"] = bool(TEST_MARKER_PATTERN.search(text))
            result["valid"] = "[Content_Types].xml" in names and bool(xml) and _xml_well_formed(xml)
    elif zipfile.is_zipfile(path):
        result["kind"] = "zip"
        with zipfile.ZipFile(path) as archive:
            bad = archive.testzip()
            names = archive.namelist()
            result["members"] = names
            result["badMember"] = bad
            docx_checks = []
            pdf_checks = []
            pack_checks = []
            test_marker_entries = []
            test_flag_seen = False
            for name in names:
                if name.lower().endswith(".docx"):
                    with archive.open(name) as stream:
                        docx_bytes = stream.read()
                    import io
                    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as docx:
                        xml = docx.read("word/document.xml")
                        docx_text = xml.decode("utf-8", "replace")
                        if TEST_MARKER_PATTERN.search(docx_text):
                            test_marker_entries.append(name)
                        docx_checks.append({"name": name, "contentTypes": "[Content_Types].xml" in docx.namelist(),
                                            "documentXml": bool(xml), "wellFormedXml": _xml_well_formed(xml)})
                elif name.lower().endswith(".pdf"):
                    with archive.open(name) as stream:
                        pdf_checks.append({"name": name, "valid": stream.read(5) == b"%PDF-"})
                elif name.lower().endswith(".patentpack"):
                    with archive.open(name) as stream:
                        pack_bytes = stream.read()
                    try:
                        envelope = json.loads(pack_bytes.decode("utf-8"))
                        required = {"v", "alg", "salt", "iv", "ciphertext"}
                        pack_checks.append({"name": name, "valid": required.issubset(envelope) and envelope.get("v") == 1,
                                            "envelopeKeysPresent": required.issubset(envelope)})
                    except Exception as error:
                        pack_checks.append({"name": name, "valid": False, "parseError": str(error)[:300]})
                elif not name.lower().endswith(".pdf"):
                    try:
                        member_text = archive.read(name).decode("utf-8", "replace")
                        compact = "".join(member_text.split())
                        explicit_flag = '"testOutput":true' in compact or "'testOutput':true" in compact
                        if explicit_flag:
                            test_flag_seen = True
                        if explicit_flag or TEST_MARKER_PATTERN.search(member_text):
                            test_marker_entries.append(name)
                    except Exception:
                        pass
            result["docxChecks"] = docx_checks
            result["pdfChecks"] = pdf_checks
            result["patentpackChecks"] = pack_checks
            result["testOutputMarkerPresent"] = bool(test_marker_entries)
            result["testOutputFlagSeen"] = test_flag_seen
            result["testOutputMarkerEntries"] = test_marker_entries
            children_valid = all(item["contentTypes"] and item["documentXml"] and item["wellFormedXml"] for item in docx_checks)
            children_valid = children_valid and all(item["valid"] for item in pdf_checks)
            children_valid = children_valid and all(item["valid"] for item in pack_checks)
            result["valid"] = bad is None and bool(names) and children_valid
    elif path.suffix.lower() == ".patentpack":
        result["kind"] = "patentpack-envelope"
        try:
            envelope = json.loads(raw.decode("utf-8"))
            required = {"v", "alg", "salt", "iv", "ciphertext"}
            result["envelopeKeysPresent"] = required.issubset(envelope)
            result["valid"] = result["envelopeKeysPresent"] and envelope.get("v") == 1
        except Exception as error:
            result["parseError"] = str(error)[:300]
    elif raw.lstrip().startswith(b"{"):
        result["kind"] = "json"
        try:
            document = json.loads(raw.decode("utf-8"))
            if isinstance(document, dict) and document.get("schemaVersion") == "export.v1" and isinstance(document.get("files"), list):
                result["kind"] = "export-manifest"
                result["valid"] = True
                result["packageKind"] = document.get("packageKind")
                result["manifestTestOutput"] = document.get("testOutput") is True
                result["manifestFileNames"] = [item.get("name") for item in document["files"] if isinstance(item, dict)]
            else:
                required = {"v", "alg", "salt", "iv", "ciphertext"}
                result["kind"] = "patentpack-envelope"
                result["envelopeKeysPresent"] = required.issubset(document)
                result["valid"] = result["envelopeKeysPresent"] and document.get("v") == 1
        except Exception as error:
            result["parseError"] = str(error)[:300]
    elif raw.startswith(bytes([137, 80, 78, 71, 13, 10, 26, 10])):
        result["kind"] = "png"
        result["valid"] = len(raw) >= 33 and raw[12:16] == b"IHDR"
    elif raw.startswith(b"%PDF-"):
        result["kind"] = "pdf"
        metadata = _pdf_metadata(raw)
        try:
            from pypdf import PdfReader
            info = PdfReader(str(path)).metadata or {}
            for source_key, target_key in (("/Title", "Title"), ("/Subject", "Subject"), ("/Keywords", "Keywords")):
                value = info.get(source_key)
                if value is not None and str(value).strip():
                    metadata[target_key] = str(value)
            result["pdfMetadataReader"] = "pypdf"
        except Exception as error:
            result["pdfMetadataReader"] = f"raw ({type(error).__name__}: {error})"[:200]
        result["pdfMetadata"] = metadata
        result["pdfMetadataTestOutputMarker"] = _pdf_metadata_has_marker(metadata)
        result["valid"] = True
    result["xmlUnavailableIsSubmission"] = False
    return result


def _xml_well_formed(data: bytes) -> bool:
    try:
        from xml.etree import ElementTree
        ElementTree.fromstring(data)
        return True
    except Exception:
        return False


def download_package(page: Page, evidence: Evidence, marker_scope: str = '[data-testid="self-done-step"]') -> bool:
    assert_test_marker(page, evidence, "test-marker-before-download", marker_scope)
    passphrase = visible(page.get_by_test_id("done-passphrase"))
    if passphrase is None:
        evidence.block("download:form", "当前交付页没有导出表单。", page)
        return False
    passphrase.fill("V6-browser-acceptance-only-2026")
    button = visible(page.get_by_test_id("done-export-button"))
    if button is None or not button.is_enabled():
        reasons = visible(page.get_by_test_id("done-gate"))
        evidence.block("download:create", f"导出门禁/表单未允许创建文件：{reasons.inner_text() if reasons else 'gate unavailable'}", page)
        return False
    button.click()
    try:
        page.wait_for_function("""() => {
          return !!document.querySelector('[data-testid^="done-file-"]') ||
                 !!document.querySelector('[data-testid="done-action-error"]');
        }""", timeout=90000)
    except TimeoutError:
        pass
    wait_dom(page)
    evidence.record("download-created", page)
    files = page.locator('[data-testid^="done-file-"][data-status="ready"]')
    if files.count() == 0:
        evidence.block("download:file-ready", "创建导出后没有 ready 文件行。", page)
        return False
    ok = True
    for index in range(files.count()):
        row = files.nth(index)
        download_button = visible(row.get_by_role("button", name=re.compile("下载")))
        if download_button is None:
            evidence.fail("download:click", f"第 {index + 1} 个 ready 文件没有下载按钮。", page)
            ok = False
            continue
        try:
            with page.expect_download(timeout=30000) as download_info:
                download_button.click()
            download = download_info.value
            target = evidence.out_dir / download.suggested_filename
            download.save_as(str(target))
            check = validate_download(target)
            check["filenameTestOutputMarker"] = bool(TEST_MARKER_PATTERN.search(download.suggested_filename))
            evidence.downloads.append({"path": target.name, **check})
            if not check.get("valid"):
                ok = False
                evidence.fail("download:validate", f"下载文件结构无效：{check}", page)
            if check.get("kind") == "docx" and not check.get("firstParagraphTestOutputMarker"):
                ok = False
                evidence.fail("download:docx-first-paragraph-marker",
                              f"{check['name']} 首段未含测试输出标记：{check.get('firstParagraph', '')[:160]}", page)
            if check.get("kind") == "pdf" and not check.get("pdfMetadataTestOutputMarker"):
                ok = False
                evidence.fail("download:pdf-metadata-marker",
                              f"{check['name']} 的 PDF metadata 未含测试输出标记：{check.get('pdfMetadata')}", page)
            evidence.record(f"download-verified-{index + 1}", page,
                            "pass" if check.get("valid") else "fail", json.dumps(check, ensure_ascii=False))
        except Exception as error:
            ok = False
            evidence.fail("download", f"第 {index + 1} 个文件下载失败：{error}", page)
    filename_marker = any(item.get("filenameTestOutputMarker") for item in evidence.downloads)
    body_marker = any(item.get("bodyTestOutputMarker") for item in evidence.downloads)
    first_paragraph_marker = all(item.get("firstParagraphTestOutputMarker") for item in evidence.downloads if item.get("kind") == "docx")
    pdf_metadata_marker = all(item.get("pdfMetadataTestOutputMarker") for item in evidence.downloads if item.get("kind") == "pdf")
    manifest_marker = any(item.get("manifestTestOutput") for item in evidence.downloads)
    scope_marker = marker_state(page, marker_scope).get("found", False)
    evidence.record("download-marker-summary", page,
                    "pass" if scope_marker and (filename_marker or body_marker or manifest_marker or scope_marker) else "fail",
                    f"filename={filename_marker}; body={body_marker}; firstParagraph={first_paragraph_marker}; "
                    f"pdfMetadata={pdf_metadata_marker}; manifest={manifest_marker}; pageNotice={scope_marker}")
    evidence.records[-1]["downloadOutputMarker"] = {
        "filename": filename_marker, "body": body_marker, "firstParagraph": first_paragraph_marker,
        "pdfMetadata": pdf_metadata_marker, "manifest": manifest_marker, "pageNotice": scope_marker,
    }
    if not (filename_marker or body_marker or manifest_marker or scope_marker):
        evidence.fail("download:test-output-marker", "下载文件、清单、正文与页面均没有测试输出标记。", page)
    if not (filename_marker or body_marker or manifest_marker):
        evidence.block("download:in-file-marker", "下载文件名、清单与正文没有测试输出标记；仅 Done 页可见提示。", page)
    xml_status = visible(page.get_by_test_id("done-format-xml"))
    if xml_status is not None:
        xml_text = xml_status.inner_text()
        evidence.records[-1]["xmlFormatStatus"] = xml_text
        evidence.records[-1]["xmlUnavailableIsSubmission"] = False
    return ok


def set_native_appearance(page: Page, base: str, evidence: Evidence) -> None:
    page.goto(f"{base}/v6/settings", wait_until="domcontentloaded")
    wait_dom(page)
    wait_testid(page, "appearance")
    wait_dom(page)
    appearance = visible(page.get_by_test_id("appearance"))
    if appearance is None:
        evidence.block("appearance:native", "设置页没有外观面板。", page)
        return

    def choose(label_text: str, fieldset_legend: str) -> bool:
        fieldset = appearance.locator("fieldset").filter(has=page.locator(f'legend:text-is("{fieldset_legend}")'))
        label = visible(fieldset.locator("label").filter(has_text=label_text))
        if label is None:
            return False
        label.click()
        wait_dom(page)
        return True

    if not choose("原生", "主题"):
        evidence.block("appearance:native", "设置页没有「原生」主题标签。", page)
        return
    for mode in ("浅色", "深色"):
        if not choose(mode, "颜色模式"):
            evidence.block(f"appearance:{mode}", f"设置页没有「{mode}」颜色模式标签。", page)
            continue
        evidence.record(f"appearance-native-{mode}", page, "observed", "经设置 UI 选择原生主题与颜色模式")
    if choose("跟随系统", "颜色模式"):
        for mode in ("light", "dark"):
            page.emulate_media(color_scheme=mode)
            wait_dom(page)
            evidence.record(f"appearance-native-system-{mode}", page, "observed", f"prefers-color-scheme={mode}")


def mobile_sweep(page: Page, base: str, matter_id: str | None, target_id: str | None, evidence: Evidence) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    routes = [("home", f"{base}/v6"), ("activity", f"{base}/v6/activity"), ("settings", f"{base}/v6/settings")]
    if matter_id:
        routes.extend([
            ("facts", f"{base}/v6/matters/{matter_id}/facts"),
            ("overview", f"{base}/v6/matters/{matter_id}/overview"),
        ])
    if matter_id and target_id:
        routes.extend((tab, target_url(base, matter_id, target_id, tab)) for tab in ("draft", "check", "deliver"))
    for name, url in routes:
        try:
            page.goto(url, wait_until="domcontentloaded")
            wait_dom(page)
            page.wait_for_timeout(800)
            page.evaluate("window.scrollTo(0,0)")
            evidence.record(f"mobile-{name}", page, "observed", "viewport=390")
            width = evidence.records[-1].get("documentWidth")
            overflow = isinstance(width, int) and width > 390
            evidence.records[-1]["horizontalOverflow"] = overflow
            evidence.records[-1]["detail"] = f"viewport=390 documentWidth={width}"
            if overflow:
                evidence.records[-1]["status"] = "fail"
                evidence.fail(f"mobile:{name}", f"documentWidth={width} exceeds viewport 390", page)
        except Exception as error:
            evidence.fail(f"mobile:{name}", str(error), page)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Already-running app base, e.g. http://localhost:5391/patent")
    parser.add_argument("--upload-file", type=Path, default=DEFAULT_UPLOAD, help="Existing sanitized UI upload fixture")
    parser.add_argument("--out", type=Path, default=None, help="Evidence directory; defaults to a timestamped folder beside this script")
    parser.add_argument("--channel", default="chrome", help="Installed Playwright browser channel")
    parser.add_argument("--headed", action="store_true", help="Show browser UI")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    out_dir = args.out or (Path(__file__).resolve().parent / f"browser-acceptance-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    evidence = Evidence(out_dir.resolve())
    evidence.started_at = datetime.now(timezone.utc).isoformat()
    page: Page | None = None
    browser: Browser | None = None
    no_doc_id: str | None = None
    upload_id: str | None = None
    target_id: str | None = None

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel=args.channel, headless=not args.headed)
            context = browser.new_context(**BASELINE, accept_downloads=True, color_scheme="light")
            evidence.context = context
            page = context.new_page()
            page._acceptance_base = base  # type: ignore[attr-defined]
            evidence.attach(page)

            # Confirm only that the lead-supplied local app responds; no service is started here.
            response = page.goto(f"{base}/v6", wait_until="domcontentloaded", timeout=30000)
            wait_dom(page)
            if response is None or response.status >= 400:
                evidence.fail("preflight", f"GET {base}/v6 returned {response.status if response else 'no response'}", page)
                return 2
            evidence.record("preflight", page, "pass", f"HTTP {response.status}")

            # Path A: a real empty matter and no-document choice.
            page.goto(f"{base}/v6", wait_until="domcontentloaded")
            no_doc_id = create_matter(page, evidence, "no-doc")
            if no_doc_id:
                if click_named(page, (r"没有现成文档，直接回答问题", r"直接回答问题")):
                    wait_dom(page)
                    upload_rows = page.locator('[data-testid^="upload-row-"]').count()
                    evidence.record("no-doc-choice", page, "pass" if upload_rows == 0 else "fail",
                                    f"选择无文档路径；可见上传行数={upload_rows}")
                    if upload_rows != 0:
                        evidence.fail("no-doc-empty-materials", "无文档入口创建出了上传材料行。", page)
                    if advance_to_questions(page, evidence, "no-doc") and answer_questions(page, False, evidence, "no-doc"):
                        target_id_a = choose_route_and_create_target(page, evidence, "no-doc")
                        evidence.records.append({"name": "no-doc-target", "matterId": no_doc_id, "targetId": target_id_a})
                else:
                    evidence.block("no-doc-choice", "上传页没有无文档入口。", page)
                capture_global_activity(page, base, evidence, "activity-after-no-doc", (no_doc_id,))

            # Path B: a separate matter with an actual fixture selected and saved through UI.
            page.goto(f"{base}/v6", wait_until="domcontentloaded")
            upload_id = create_matter(page, evidence, "upload")
            if upload_id and upload_fixture(page, args.upload_file.resolve(), evidence, "upload"):
                run_parse(page, evidence)
                evidence.record("upload-parse", page, "observed", "上传后检查真实解析状态")
                capture_global_activity(page, base, evidence, "activity-after-upload", (no_doc_id, upload_id))
                if advance_to_questions(page, evidence, "upload") and answer_questions(page, True, evidence, "upload"):
                    target_id = choose_route_and_create_target(page, evidence, "upload")

            # Use the uploaded matter for the end-to-end generation/check/delivery path.
            if upload_id and target_id:
                # These are explicit, isolated QA inputs entered through normal UI:
                # one fixture-backed confirmed fact and a visibly labeled figure
                # only when the target's real figure set is empty.
                confirm_synthetic_fact(page, base, upload_id, evidence)
                ensure_synthetic_figure_when_missing(page, base, upload_id, target_id, evidence)
                if run_generation(page, base, upload_id, target_id, evidence):
                    old_ack_id = acknowledge_first_risk_and_reload(page, base, upload_id, target_id, evidence)
                    title_changed = edit_title_and_check_marker(page, base, upload_id, target_id, evidence)
                    if title_changed:
                        verify_old_ack_invalidated(page, base, upload_id, target_id, old_ack_id, evidence)
                        old_ack_id = acknowledge_first_risk_and_reload(page, base, upload_id, target_id, evidence)
                    paragraph_changed = edit_one_paragraph(page, base, upload_id, target_id, evidence)
                    if paragraph_changed:
                        verify_old_ack_invalidated(page, base, upload_id, target_id, old_ack_id, evidence)
                        acknowledge_first_risk_and_reload(page, base, upload_id, target_id, evidence)
                    # Confirmations are recorded last, against the final current revision.
                    confirm_professional_paragraphs(page, base, upload_id, target_id, evidence, "professional")
                    confirm_self_read(page, base, upload_id, evidence)
                    approve_and_check_gate(page, base, upload_id, target_id, evidence)
                    # The self-service completion step exports a preparation
                    # package; it must satisfy its own real gate, which we have
                    # only satisfied through UI actions above.
                    page.goto(f"{base}/v6/new/{upload_id}/done?target={target_id}", wait_until="domcontentloaded")
                    wait_dom(page)
                    evidence.record("self-done-before-export", page)
                    download_package(page, evidence, '[data-testid="self-done-step"]')
                else:
                    evidence.skip("generation-dependent", "生成/采纳没有完成；改用真实手工草稿继续验证检查/风险界面，不伪造生成输出。")
                    manual_draft_fallback(page, base, upload_id, target_id, evidence)
            else:
                evidence.skip("generation-dependent", "上传路径未能创建 matter/target；后续链路没有可用业务对象。")

            # Global activity should render events from both UI-created matters.
            capture_global_activity(page, base, evidence, "global-activity-final", (no_doc_id, upload_id))
            activity_by_name = {item["name"]: item for item in evidence.records if item.get("name", "").startswith("activity-")}
            first_count = activity_by_name.get("activity-after-no-doc", {}).get("activityRowCount")
            second_count = activity_by_name.get("activity-after-upload", {}).get("activityRowCount")
            final_count = activity_by_name.get("global-activity-final", {}).get("activityRowCount")
            if first_count is not None and second_count is not None and second_count <= first_count:
                evidence.fail("global-activity-dynamic", f"创建/保存第二案件后全局活动行数没有增长：{first_count} -> {second_count}")
            if upload_id and final_count is not None and len(activity_by_name.get("global-activity-final", {}).get("matterFilterOptions", [])) < 3:
                evidence.block("global-activity-all-matters", "全局动态案件筛选项不足两个案件加默认项。")

            set_native_appearance(page, base, evidence)
            mobile_sweep(page, base, upload_id, target_id, evidence)

            evidence.write_partial()
            context.close()
    except Exception as error:
        evidence.fail("uncaught", f"{type(error).__name__}: {error}", page)
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
        evidence.write_partial()

    result = evidence.as_dict()
    print(json.dumps({
        "out": str(evidence.out_dir),
        "records": len(evidence.records),
        "failures": len(evidence.failures),
        "blocked": len(evidence.blocked),
        "skipped": len(evidence.skipped),
        "pageerrors": len(evidence.pageerrors),
        "consoleErrors": len(evidence.console_errors),
        "downloads": len(evidence.downloads),
    }, ensure_ascii=False))
    return 1 if evidence.failures or evidence.pageerrors or evidence.console_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
