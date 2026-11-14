# 精确复核：标题失效（不刷新）与 429 后重试（2026-11-14）

干净环境（accept-env 重启重置 KV）+ 假上游，未改产品代码。只记录布尔、id/摘要、状态与计数，未记录 token/访问码/正文。

## A. 同一页面内改标题（SPA，不整页刷新，保留内存凭证）

| 检查 | 结果 | 事实 |
|---|---|---|
| 草稿页已确认并挂载真实引擎 | pass | `workbench-runtime-real` 可见 |
| 按 `matter-row-<id>` 精确定位改名 | pass | matterId=`b290316c…`（本轮）；仅该行进入编辑态 |
| 行文本更新 | pass | 新标题「复核改名-1794591007」出现在该行 |
| 持久化（只读 IndexedDB） | pass | `matter.title = 复核改名-1794591007` |
| 通过 SPA 返回同案草稿（无整页刷新） | pass | `workbench-runtime*` = consent-open / consent-required / refresh |
| **旧同意失效（无需刷新）** | **pass** | 弹层自动出现（sheet=True）或显示「需要先确认」提示；未出现真实引擎 |
| 失效后 chat 增量 | pass | before=0 after=0 |
| 弹层标题与新标题一致 | pass | 「复核改名-1794591007（可能作为主题背景随本次请求外发）」 |

说明：内存凭证无法从页面取出，因此「旧凭证 POST chat 得 409」以服务端矩阵用例覆盖（`cross-session-check.py`：
换 manifestHash → 409、上游 +0）；本轮浏览器侧以「弹层重现 + 0 chat」证明同一标签页内的旧凭证已不可用。

## A2. 两会话并发改同一案件（同 context 两个标签页）

| 检查 | 结果 | 事实 |
|---|---|---|
| 建两个案件 | pass | matters=2 |
| 冲突前版本 | pass | `matter.version = 1` |
| 并发保存结果 | pass | A 无错误；B 报 **「无法读取或保存。／标题已在其他窗口修改，请刷新后重试。／重试」** |
| 是否为具体冲突文案（非通用失败） | pass | specific=True generic=False（外层仍有通用标题「无法读取或保存。」，正文是具体的版本冲突说明） |
| 版本只递增一次 | pass | version 1 → 2 |
| 最终标题为两者之一 | pass | 「并发A-1794591238」 |

## B. 429 失败后点「重试」（单会话、不导航、保留凭证）

| 检查 | 结果 | 事实 |
|---|---|---|
| 重试前已确认（同一页面） | pass | agreed |
| 首次尝试（注入 429） | pass | `data-job-state=failed` |
| 重试入口可用 | pass | `generation-retry` 可点 |
| 点击重试后的 `generation-action-error` | pass | **无错误提示**（没有出现「需要重新授权」类文案） |
| 重试后执行 | pass | chat 1 → 14，`data-job-state=succeeded` |
| 授权未变化 | pass | consent 记录数 before=3 after=3（未新增授权） |
| job id | 记录 | 生成索引行 id 前后同为 `43f29b90…`（索引行未换 id）；chat 1→14 与 succeeded 证明是新一轮执行，不是旧结果回放 |

结论：三种预设分支中属于「**同一授权下重试并真实执行成功**」：既没有要求重新授权，也不是「新 job 但 0 chat」，也不是「状态/job 全不变且无错误」。

## 证据
- `fixes-recheck.py`、`fixes-recheck-results.json`（17/17 pass）
- `concurrent-rename.py`、`concurrent-rename-results.json`（6/6 pass）
- 截图与 DOM 记录：`../acceptance-evidence/`
