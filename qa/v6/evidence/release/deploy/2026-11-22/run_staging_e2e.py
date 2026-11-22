#!/usr/bin/env python3
"""Online dual-domain isolation + real AI 13-stage E2E acceptance on https://patent-v6.paymond.me.

Reads ACCESS_PASSWORD from /Users/jared/Personal Projects/Patent/.dev.vars in memory only;
never prints, logs, or persists any secret or credential.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import TimeoutError, sync_playwright

OUT = Path(__file__).resolve().parent
WORKTREE = Path("/Users/jared/Personal Projects/Patent/.claude/worktrees/v6-prototype-alignment")
PROD_ROOT = os.environ.get("PROD_BASE", "https://patent.paymond.me").rstrip("/")
APP_ROOT = os.environ.get("STAGING_BASE", "https://patent-v6.paymond.me").rstrip("/")
BASE = f"{APP_ROOT}/v6"
PROXY = os.environ.get("SMOKE_PROXY", "http://127.0.0.1:7897")
DEV_VARS = Path("/Users/jared/Personal Projects/Patent/.dev.vars")

DEV_UNDISCLOSED_WARNING = "开发验证：处理方信息未核实，仅限合成材料，不得用于真实客户材料。"
EXPECTED_MODEL = "hy4-flash-free"

WATER_METER_PROBLEM = (
    "现有远传水表在地下井室、老旧小区或偏远管网场景中通常仅支持单一无线通信方式，"
    "一旦信号遮挡或基站波动就会丢数断连，且断网期间缺乏本地缓存与恢复补传机制。"
)
WATER_METER_DIFFERENCE = (
    "本合成方案提供一种三模通讯远程抄表智能水表，包括表体、叶轮计量部件、低功耗控制单元与"
    "三模通讯模块（蓝牙 mesh、470MHz 无线、NB-IoT）；控制单元按设定周期采集流量读数并择优"
    "通过任一可用链路上传，三路均不可用时写入本地非易失缓存并在链路恢复后自动补传。"
)
SYNTHETIC_DISCLOSURE = (
    "合成交底材料（仅用于开发与预发验证，非真实客户材料）\n\n"
    "名称：一种三模通讯远程抄表智能水表\n\n"
    "一、技术背景与要解决的问题\n"
    f"{WATER_METER_PROBLEM}\n\n"
    "二、核心结构与技术方案\n"
    f"{WATER_METER_DIFFERENCE}\n"
    "具体结构如下：\n"
    "1. 表体：采用耐腐蚀铜合金壳体，设有进水口、出水口与密封计量腔。\n"
    "2. 计量部件：安装于密封计量腔内的叶轮与霍尔流量传感器，用于实时采集水流脉冲信号。\n"
    "3. 控制单元：内置低功耗微控制器、实时时钟与非易失性闪存，按设定周期换算累计用水量并检测通信链路质量。\n"
    "4. 三模通讯模块：集成蓝牙 mesh 收发器、470MHz 无线射频收发器与 NB-IoT 模组，与控制单元电连接；"
    "通信按预设优先级自动切换，任一链路可用即上报周期数据，均不可用时将带时间戳的抄表记录写入本地闪存，待链路恢复后按序补传。\n"
    "5. 供电部件：内置锂亚硫酰氯电池组，通过电源管理电路向控制单元和三模通讯模块供电。\n"
)

os.environ["ONLINE_BASE"] = APP_ROOT
os.environ["ONLINE_OUT"] = str(OUT)
ONLINE = WORKTREE / "qa/v6/evidence/release/deploy/2026-11-11/run_online.py"
spec = importlib.util.spec_from_file_location("run_online", ONLINE)
ro = importlib.util.module_from_spec(spec)
sys.modules["run_online"] = ro
spec.loader.exec_module(ro)
acc = ro.acc
goto, wait_dom, wait_ready, visible = ro.goto, ro.wait_dom, ro.wait_ready, ro.visible

# Override synthetic answers to match the smart water meter disclosure.
ro.QUESTION_TEXT["problem"] = WATER_METER_PROBLEM
ro.QUESTION_TEXT["difference"] = WATER_METER_DIFFERENCE


def read_access_code() -> str:
    text = DEV_VARS.read_text(encoding="utf-8")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        if k == "ACCESS_PASSWORD":
            if len(v.strip()) < 16:
                raise RuntimeError("ACCESS_PASSWORD shorter than 16 chars")
            return v.strip()
    raise RuntimeError("ACCESS_PASSWORD not found in .dev.vars")


R: list[dict[str, Any]] = []
EVIDENCE: Any = None


def ck(name: str, ok: bool, detail: str = "", page: Any = None) -> None:
    R.append({"name": name, "ok": bool(ok), "detail": str(detail)[:500]})
    if page is not None and EVIDENCE is not None:
        ro.rec(EVIDENCE, name, page, "pass" if ok else "fail", str(detail)[:500])
    print(("PASS " if ok else "FAIL "), name, "|", str(detail)[:200], flush=True)


def wait_generation_terminal(page: Any, timeout_ms: int = 600_000) -> str:
    page.wait_for_function(
        """() => {
          const g = document.querySelector('[data-testid="generation"]');
          if (!g) return false;
          const st = g.getAttribute('data-job-state');
          return st === 'succeeded' || st === 'failed' || st === 'cancelled' || st === 'interrupted';
        }""",
        timeout=timeout_ms,
    )
    return page.locator('[data-testid="generation"]').first.get_attribute("data-job-state") or "unknown"


def main() -> int:
    global EVIDENCE
    access_code = read_access_code()
    fixture_path = OUT / "synthetic-water-meter.txt"
    fixture_path.write_text(SYNTHETIC_DISCLOSURE, encoding="utf-8")

    chat_events: list[dict[str, Any]] = []
    chat_start_times: dict[int, float] = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            channel="chrome",
            headless=True,
            proxy={"server": PROXY} if PROXY else None,
        )
        context = browser.new_context(**acc.BASELINE, accept_downloads=True, color_scheme="light")
        evidence = acc.Evidence(OUT / "acceptance-evidence")
        EVIDENCE = evidence
        evidence.started_at = datetime.now(timezone.utc).isoformat()
        evidence.attach_context(context, "patent-v6.paymond.me")
        page = context.new_page()
        page._acceptance_base = APP_ROOT
        evidence.attach(page)

        def on_request(req: Any) -> None:
            if "/api/v6/chat" in req.url and req.method == "POST":
                chat_start_times[id(req)] = time.monotonic()

        def on_response(resp: Any) -> None:
            if "/api/v6/chat" in resp.url and resp.request.method == "POST":
                t0 = chat_start_times.pop(id(resp.request), None)
                elapsed_ms = int((time.monotonic() - t0) * 1000) if t0 is not None else None
                entry: dict[str, Any] = {
                    "index": len(chat_events) + 1,
                    "status": resp.status,
                    "elapsedMs": elapsed_ms,
                }
                if resp.status != 200:
                    try:
                        body = resp.json()
                        if isinstance(body, dict) and isinstance(body.get("error"), dict):
                            entry["errorCode"] = body["error"].get("code")
                            entry["upstreamStatus"] = body["error"].get("upstreamStatus")
                            entry["reason"] = body["error"].get("reason")
                    except Exception:
                        pass
                chat_events.append(entry)
                print(
                    f"CHAT #{entry['index']} -> HTTP {entry['status']} ({elapsed_ms}ms)"
                    + (f" err={entry.get('errorCode')}" if entry.get("errorCode") else ""),
                    flush=True,
                )

        page.on("request", on_request)
        page.on("response", on_response)

        run: dict[str, Any] = {
            "startedAt": evidence.started_at,
            "prodBase": PROD_ROOT,
            "stagingBase": APP_ROOT,
            "flow": {},
            "chatEvents": chat_events,
        }

        try:
            # 1. Production isolation verification (https://patent.paymond.me)
            prod_root_resp = context.request.get(f"{PROD_ROOT}/", max_redirects=0)
            ck(
                "prod-root-redirect",
                prod_root_resp.status == 302 and prod_root_resp.headers.get("location") == "/v6",
                f"status={prod_root_resp.status} location={prod_root_resp.headers.get('location')}",
            )
            prod_v6_resp = context.request.get(f"{PROD_ROOT}/v6")
            ck("prod-v6-200", prod_v6_resp.status == 200, f"status={prod_v6_resp.status}")
            prod_status = context.request.get(f"{PROD_ROOT}/api/v6/status").json()
            run["prodStatus"] = prod_status
            ck(
                "prod-status-fail-closed",
                prod_status.get("configured") is False
                and prod_status.get("available") is False
                and prod_status.get("devUndisclosed") is False,
                f"configured={prod_status.get('configured')} available={prod_status.get('available')} devUndisclosed={prod_status.get('devUndisclosed')}",
            )

            # 2. Staging status verification (https://patent-v6.paymond.me)
            stg_root_resp = context.request.get(f"{APP_ROOT}/", max_redirects=0)
            ck(
                "staging-root-redirect",
                stg_root_resp.status == 302 and stg_root_resp.headers.get("location") == "/v6",
                f"status={stg_root_resp.status} location={stg_root_resp.headers.get('location')}",
            )
            stg_status = context.request.get(f"{APP_ROOT}/api/v6/status").json()
            run["stagingStatus"] = stg_status
            ck(
                "staging-status-configured-dev-undisclosed",
                stg_status.get("configured") is True
                and stg_status.get("available") is True
                and stg_status.get("devUndisclosed") is True
                and stg_status.get("authenticated") is False
                and stg_status.get("model") == EXPECTED_MODEL,
                f"configured={stg_status.get('configured')} available={stg_status.get('available')} devUndisclosed={stg_status.get('devUndisclosed')} authenticated={stg_status.get('authenticated')} model={stg_status.get('model')}",
            )

            # 3. Create synthetic water meter matter, upload & parse disclosure, answer 5 questions, choose route
            goto(page, BASE)
            matter = ro.upload_and_enter_questions(page, fixture_path, evidence)
            if not matter:
                raise RuntimeError("create matter / upload / parse failed")
            run["flow"]["matterId"] = matter
            ck("matter-created-and-parsed", True, f"matterId={matter}", page)

            if not ro.answer_questions(page, APP_ROOT, matter, True, evidence):
                raise RuntimeError("answer_questions failed")
            ck("questions-completed", True, "5 synthetic water-meter questions saved", page)

            target = ro.choose_route(page, APP_ROOT, matter, evidence)
            if not target:
                raise RuntimeError("choose_route failed")
            run["flow"]["targetId"] = target
            ck("route-chosen", True, f"targetId={target} route=cn_um", page)

            # 4. Generate step: authenticate via UI access code, verify consent sheet & DEV_UNDISCLOSED_WARNING
            goto(page, f"{BASE}/new/{matter}/generate?target={target}")
            page.wait_for_timeout(1200)

            code_input = visible(page.get_by_test_id("self-consent-access-code"))
            if code_input is None:
                open_btn = visible(page.get_by_test_id("self-runtime-consent-open"))
                if open_btn is None:
                    raise RuntimeError("neither access code input nor consent open button visible")
                open_btn.click()
                page.get_by_test_id("self-consent-access-code").wait_for(state="visible", timeout=20000)
                code_input = visible(page.get_by_test_id("self-consent-access-code"))

            assert code_input is not None
            code_input.fill(access_code)
            auth_btn = visible(page.get_by_test_id("self-consent-authenticate"))
            if auth_btn is None or not auth_btn.is_enabled():
                raise RuntimeError("self-consent-authenticate button not enabled")
            auth_btn.click()

            # Wait until authenticated session resolves real runtime inside the consent sheet
            page.wait_for_function(
                """() => {
                  const agree = document.querySelector('[data-testid="self-consent-agree"]');
                  const warn = document.querySelector('[data-testid="self-dev-undisclosed"]');
                  return !!agree && !agree.disabled && !!warn;
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / "consent-sheet.png"), full_page=True)

            disclosure_text = page.get_by_test_id("self-consent-disclosure").inner_text()
            warn_text = page.get_by_test_id("self-dev-undisclosed").inner_text()
            ck(
                "consent-sheet-model-and-dev-warning",
                (EXPECTED_MODEL in disclosure_text) and (DEV_UNDISCLOSED_WARNING in warn_text),
                f"hasModel={EXPECTED_MODEL in disclosure_text} hasWarning={DEV_UNDISCLOSED_WARNING in warn_text}",
                page,
            )

            # 5. Grant explicit consent and start 13-stage real LLM generation
            page.get_by_test_id("self-consent-agree").click()
            page.get_by_test_id("self-runtime-real").wait_for(state="visible", timeout=20000)
            page.get_by_test_id("generation-start").wait_for(state="visible", timeout=20000)
            ck("consent-granted-real-runtime-ready", True, page.get_by_test_id("self-runtime-real").inner_text()[:160], page)

            gen_started = time.monotonic()
            page.get_by_test_id("generation-start").click()

            attempts = 0
            attempt_notes: list[dict[str, Any]] = []
            job_state = "unknown"
            while attempts <= 2:
                job_state = wait_generation_terminal(page, timeout_ms=600_000)
                page.wait_for_timeout(800)
                err_node = visible(page.get_by_test_id("generation-error"))
                err_code = err_node.get_attribute("data-code") if err_node is not None else None
                attempt_notes.append({"attempt": attempts + 1, "state": job_state, "errorCode": err_code})
                if job_state == "succeeded":
                    break
                attempts += 1
                if attempts > 2:
                    break
                retry_btn = visible(page.get_by_test_id("generation-retry")) or visible(
                    page.get_by_test_id("generation-start-new-authorization")
                )
                if retry_btn is None or not retry_btn.is_enabled():
                    break
                print(f"RETRY #{attempts} after state={job_state} code={err_code}", flush=True)
                retry_btn.click()
                page.wait_for_timeout(1000)

            gen_elapsed_ms = int((time.monotonic() - gen_started) * 1000)
            run["flow"]["generation"] = {
                "jobState": job_state,
                "attempts": attempt_notes,
                "elapsedMs": gen_elapsed_ms,
                "chatCount": len(chat_events),
                "chat200Count": sum(1 for e in chat_events if e["status"] == 200),
            }
            page.screenshot(path=str(OUT / "generation-result.png"), full_page=True)

            stages_summary = page.locator('[data-testid^="generation-stage-state-"]').evaluate_all(
                "els => els.map(e => ({id: e.getAttribute('data-testid'), text: e.innerText.trim()}))"
            )
            run["flow"]["generation"]["stages"] = stages_summary
            ck(
                "real-generation-13-stages-succeeded",
                job_state == "succeeded" and sum(1 for e in chat_events if e["status"] == 200) >= 13,
                f"state={job_state} elapsedMs={gen_elapsed_ms} chat200={sum(1 for e in chat_events if e['status'] == 200)}/{len(chat_events)} attempts={len(attempt_notes)}",
                page,
            )
            if job_state != "succeeded":
                raise RuntimeError(f"Real generation failed: {attempt_notes}")

            # 6. Verify candidate is NOT test output, then adopt
            result_node = visible(page.get_by_test_id("generation-result"))
            data_test_output = result_node.get_attribute("data-test-output") if result_node is not None else None
            has_gen_test_notice = visible(page.get_by_test_id("generation-test-output")) is not None
            ck(
                "candidate-not-test-output",
                data_test_output == "false" and not has_gen_test_notice,
                f"data-test-output={data_test_output} testNoticeVisible={has_gen_test_notice}",
                page,
            )

            adopt = visible(page.get_by_test_id("generation-adopt"))
            if adopt is None or not adopt.is_enabled():
                raise RuntimeError("generation-adopt not available")
            adopt.click()
            page.wait_for_timeout(2500)
            ck("adopted-real-draft", True, "adoptedTestOutput=false", page)

            # 7. Preview self-read confirmation + verify no test-output watermark
            goto(page, f"{BASE}/new/{matter}/preview?target={target}")
            preview_test_visible = visible(page.get_by_test_id("preview-test-output")) is not None
            ck("preview-no-test-output-watermark", not preview_test_visible, f"previewTestOutput={preview_test_visible}", page)
            panel = visible(page.get_by_test_id("preview-confirmation"))
            if panel is not None:
                box = visible(panel.locator('input[type="checkbox"]'))
                button = visible(panel.get_by_role("button", name=re.compile("确认通读|已通读")))
                if box is not None and button is not None:
                    box.check()
                    button.click()
                    try:
                        page.get_by_test_id("preview-confirmed").wait_for(state="visible", timeout=15000)
                    except TimeoutError:
                        pass
            ck("self-read-confirmed", visible(page.get_by_test_id("preview-confirmed")) is not None, "", page)

            # 8. Checks & risk acknowledgment (handle 0 or >=1 ackable findings gracefully)
            ack_ids = acc.run_checks(page, APP_ROOT, matter, target, evidence, "staging-real-check")
            page.screenshot(path=str(OUT / "checks-result.png"), full_page=True)
            acknowledged: list[str] = []
            for ack_id in ack_ids:
                btn = visible(page.get_by_test_id(ack_id))
                if btn is not None and btn.is_enabled():
                    btn.click()
                    page.get_by_test_id(ack_id.replace("check-ack-", "check-acknowledged-")).wait_for(state="visible", timeout=15000)
                    page.wait_for_timeout(400)
                    acknowledged.append(ack_id)
            blocker_node = page.locator('[data-testid="checks-count-blocker"]')
            blocker_count = blocker_node.first.inner_text().strip() if blocker_node.count() else "unknown"
            run["flow"]["checks"] = {"ackIds": ack_ids, "acknowledged": acknowledged, "blockerCount": blocker_count}
            ck(
                "checks-and-risk-ack",
                blocker_count == "0" and len(acknowledged) == len(ack_ids),
                f"blockerCount={blocker_count} acked={len(acknowledged)}/{len(ack_ids)}",
                page,
            )

            # 9. Confirm AI paragraphs in draft editor (record & dismiss auto-opened consent modal if present)
            def dismiss_consent_modal_if_open() -> bool:
                page.wait_for_timeout(1200)
                scrim = page.locator(".scrim")
                if scrim.count() and scrim.first.is_visible():
                    cancel = scrim.first.get_by_role("button", name="取消")
                    if cancel.count() and cancel.first.is_visible():
                        cancel.first.click()
                        page.wait_for_timeout(400)
                        return True
                return False

            goto(page, f"{APP_ROOT}/v6/matters/{matter}/targets/{target}/draft")
            page.get_by_test_id("draft-editor").wait_for(state="visible", timeout=30000)
            modal_opened = dismiss_consent_modal_if_open()
            run["flow"]["draftConsentModalAutoOpened"] = modal_opened
            editor = visible(page.get_by_test_id("draft-editor"))
            if editor is None:
                raise RuntimeError("draft-editor not visible")
            pending_initial = editor.locator('.para-actions button:has-text("确认此段")').count()
            for _ in range(pending_initial):
                buttons = editor.locator('.para-actions button:has-text("确认此段")')
                if buttons.count() == 0:
                    break
                btn_c = None
                for idx in range(buttons.count()):
                    cand = buttons.nth(idx)
                    if cand.is_visible() and cand.is_enabled():
                        btn_c = cand
                        break
                if btn_c is None:
                    break
                btn_c.click()
                page.wait_for_timeout(250)
            wait_dom(page)
            page.wait_for_timeout(500)
            confirmed_before_reload = editor.locator(".para-actions .tag.ok").count()
            page.reload(wait_until="domcontentloaded")
            wait_dom(page)
            wait_ready(page)
            page.get_by_test_id("draft-editor").wait_for(state="visible", timeout=30000)
            dismiss_consent_modal_if_open()
            editor = visible(page.get_by_test_id("draft-editor"))
            confirmed_after_reload = editor.locator(".para-actions .tag.ok").count() if editor is not None else 0
            run["flow"]["paragraphs"] = {
                "pendingInitial": pending_initial,
                "confirmedBeforeReload": confirmed_before_reload,
                "confirmedAfterReload": confirmed_after_reload,
            }
            ck(
                "paragraphs-confirmed",
                confirmed_before_reload >= pending_initial and confirmed_after_reload >= pending_initial,
                f"pending={pending_initial} beforeReload={confirmed_before_reload} afterReload={confirmed_after_reload} consentModalAutoOpened={modal_opened}",
                page,
            )

            # 10. Approval on done page
            approved = ro.approve_with_details(page, APP_ROOT, matter, target, evidence)
            ck("approval-recorded", approved, "", page)

            # 11. Done page: verify dev-undisclosed warning & no test-output watermark, export & download package
            goto(page, f"{BASE}/new/{matter}/done?target={target}")
            page.get_by_test_id("self-done-step").wait_for(state="visible", timeout=20000)
            done_body = page.locator("body").inner_text()
            done_test_visible = visible(page.get_by_test_id("done-test-output-label")) is not None
            ck(
                "done-dev-warning-and-no-test-watermark",
                (DEV_UNDISCLOSED_WARNING in done_body) and (not done_test_visible),
                f"hasDevWarning={DEV_UNDISCLOSED_WARNING in done_body} doneTestOutput={done_test_visible}",
                page,
            )

            pf = visible(page.get_by_test_id("done-passphrase"))
            btn = visible(page.get_by_test_id("done-export-button"))
            ack = page.get_by_test_id("done-figure-ack")
            if pf is not None and btn is not None:
                pf.fill("V6-staging-e2e-2026-11-22")
                page.wait_for_timeout(250)
                if ack.count() and ack.first.is_visible() and not ack.first.is_checked():
                    ack.first.check()
                    page.wait_for_timeout(400)

            page.screenshot(path=str(OUT / "done-before-export.png"), full_page=True)
            acc.download_package(page, evidence, '[data-testid="self-done-step"]')
            page.screenshot(path=str(OUT / "done-after-export.png"), full_page=True)

            valid = [d for d in evidence.downloads if d.get("valid")]
            download_summary = [
                {
                    "name": d.get("name"),
                    "kind": d.get("kind"),
                    "bytes": d.get("bytes") if d.get("bytes") is not None else d.get("size"),
                    "valid": d.get("valid"),
                }
                for d in evidence.downloads
            ]
            run["flow"]["downloads"] = download_summary
            ck(
                "downloads-valid-nonempty",
                len(valid) >= 6 and all(((d.get("bytes") or d.get("size") or 0) > 0) for d in valid),
                f"valid={len(valid)} total={len(evidence.downloads)}",
            )

            manifest_entry = next((d for d in evidence.downloads if d.get("kind") == "export-manifest"), None)
            if manifest_entry:
                manifest_rel = manifest_entry.get("path") or manifest_entry.get("name")
                manifest = json.loads((evidence.out_dir / manifest_rel).read_text(encoding="utf-8"))
                run["flow"]["manifestSummary"] = {
                    "devVerification": manifest.get("devVerification"),
                    "testOutput": manifest.get("testOutput"),
                    "figures": manifest.get("figures"),
                    "approvalId": manifest.get("approvalId"),
                    "filesCount": len(manifest.get("files") or []),
                }
                dev_ver = manifest.get("devVerification") or {}
                ck(
                    "manifest-dev-undisclosed-true",
                    dev_ver.get("devUndisclosed") is True
                    and dev_ver.get("note") == DEV_UNDISCLOSED_WARNING
                    and manifest.get("testOutput") is not True,
                    f"devVerification={json.dumps(dev_ver, ensure_ascii=False)} testOutput={manifest.get('testOutput')}",
                )
            else:
                ck("manifest-dev-undisclosed-true", False, "导出清单.json missing")

            pdf_entry = next((d for d in evidence.downloads if str(d.get("name", "")).endswith(".pdf")), None)
            if pdf_entry:
                from pypdf import PdfReader

                pdf_rel = pdf_entry.get("path") or pdf_entry.get("name")
                pdf_path = evidence.out_dir / pdf_rel
                reader = PdfReader(str(pdf_path))
                img_count = sum(len(list(p.images)) for p in reader.pages)
                ck(
                    "checklist-pdf-valid",
                    len(reader.pages) >= 1 and pdf_path.stat().st_size > 0 and img_count >= len(reader.pages),
                    f"pages={len(reader.pages)} bytes={pdf_path.stat().st_size} pageImages={img_count}",
                )
            else:
                ck("checklist-pdf-valid", False, "PDF checklist missing")

            # 12. Zero runtime errors check
            ck(
                "zero-pageerror-and-console-error",
                len(evidence.pageerrors) == 0 and len(evidence.console_errors) == 0,
                f"pageerrors={len(evidence.pageerrors)} consoleErrors={len(evidence.console_errors)}",
            )

        except Exception as error:
            ck("uncaught", False, f"{type(error).__name__}: {error}", page)
            try:
                page.screenshot(path=str(OUT / "failure.png"), full_page=True)
            except Exception:
                pass
        finally:
            run["results"] = R
            run["failures"] = [r for r in R if not r["ok"]]
            run["network"] = evidence.network_summary()
            run["pageerrors"] = evidence.pageerrors
            run["consoleErrors"] = evidence.console_errors
            run["downloadsCount"] = len(evidence.downloads)
            (OUT / "staging-e2e.json").write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
            evidence.write_partial()
            browser.close()

    print(
        json.dumps(
            {
                "checks": len(R),
                "pass": sum(1 for r in R if r["ok"]),
                "fail": sum(1 for r in R if not r["ok"]),
                "chatRequests": len(chat_events),
                "chat200": sum(1 for e in chat_events if e["status"] == 200),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if not [r for r in R if not r["ok"]] else 1


if __name__ == "__main__":
    raise SystemExit(main())
