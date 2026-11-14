# G3 UX 三分支最小复验（2026-11-14，最新构建 indexSha256=6b7c27bd16e1…）

固定合成密钥（仅环境变量）、假上游 + 实际 workerd、单次服务未重启、未改产品代码、未调真实供应商。
每个场景独立案件与独立 JSON。

## A 同授权 429 → retry（5/5 pass）

- 429 失败后：`generation-retry` 存在；`generation-consent-updated` **不出现**。
- 点击 retry → 新作业 `succeeded`。

## B 换授权（13/13 pass）

- 撤回后在草稿页重新 grant：出现 `generation-consent-updated`，文案「授权已更新，请以新授权开始新任务。／旧的失败任务保留在记录里，不会按旧授权重试。」
- 主按钮 `generation-start-new-authorization`「以新授权开始任务」；**无** `generation-retry`、**无** `generation-start`。
- 无循环 Sheet（`workbench-consent-disclosure` 不在）；点击前上游 chat 增量 0；点击后新作业 `succeeded`（chat→14）。
- 旧失败记录保留（提示文案与「不会按旧授权重试」一致）。

## C 同授权 + 材料变化（9/9 pass）

- 从**第二标签页**新增并解析材料（本页引擎不卸载、不整页跳转）。
- 本页 retry → `generation-action-error[data-code=INPUT_STALE]`，文案「材料已变化，请开始新任务。」；chat 增量 0；**不显示** `generation-consent-updated`。
- 「新建任务」可用；点击后因新范围弹出外发确认，明确 grant 后新作业 `succeeded`。

## 未单独构造

「无 grant / stub 不显示新按钮」由 `shouldOfferNewAuthorization` 的守卫（stub 或无 consentId 时 false）保证；
B 流程中 grant 之前该按钮同样不存在（面板在确认弹层下不挂载）。未为此另开环境。

## 现场

服务已停止，无残留进程。证据：`ux-test.py`、`A-results.json`、`B-results.json`、`C-results.json`、`acceptance-evidence/`。
