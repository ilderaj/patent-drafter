VERDICT: NOT_ACCEPT
# V6-11 解析进度与失败恢复 — 第一轮独立验收复核

复核对象：`codex/patent-saas-v6-foundation-origin` 工作树 `/private/tmp/patent-v6-worktree`，基线 `f89236a`。
复核性质：只读。除本文件外未修改任何工作树文件；探针与临时产物全部位于 `/tmp/v6-11-r1/`。

结论先行：执行者自述的前三项修复（(a) 租约按 leaseMs/3 与每个 checkpoint 续租、(b) 刷新后同标签页孤儿作业立即中断、(c) 上传保存不重挂载 Parse 也不丢作业）均被独立探针证实，40/40 场景与浏览器证据可复现。但发现 1 个阻断级反例：标签页身份只用 sessionStorage 保存，复制标签页/恢复标签页会共用同一 session id，第二个页面挂载时会把第一个页面**正在运行且租约有效**的作业立即标记为 `interrupted`，令从未中断的解析被迫中断（探针 C，可复现）。该行为违反 C11「任务在当前标签页内运行、关闭/刷新后标为 interrupted」与 S02「中断即不再后台继续」的语义前提，并使 V6-11-A03 的恢复一致性断言失去保障。

## 一、复核范围与执行命令

| # | 命令 | 结果 |
|---|------|------|
| 1 | `npm run test:v6 -- V6-11` | exit 0；40 tests / 40 pass / 0 fail / 0 skipped / 0 todo（`/tmp/v6-11-r1/runner-rerun.tap`） |
| 2 | `npm run test:v6 -- V6-10` | exit 0；36 tests / 36 pass / 0 fail / 0 skipped（`/tmp/v6-11-r1/regression-v6-10.tap`） |
| 3 | `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` | exit 0 |
| 4 | `vite build --outDir /tmp/v6-11-r1/build-out`（从 `apps/web`，输出重定向到 /tmp，避免写工作树 dist） | exit 0，`✓ built in 2.56s` |
| 5 | 浏览器证据复跑：`node qa/v6/evidence/V6-11/browser-drive.mjs`（`vite preview` 4176，`.claude/launch.json`） | exit 0，`ok: true`，11 步全过，0 console 错误；步骤 09 `waitedForLeaseMs: 0`，步骤 10 interrupted→cancelled，步骤 11 运行中上传后仍为同一作业、`10746 段 · 199 页 · 已保存` |
| 6 | 探针 A `/tmp/v6-11-r1/probe-a-lease.mjs` | exit 0；见第四节 |
| 7 | 探针 B `/tmp/v6-11-r1/probe-b-orphan.mjs` | exit 0；见第四节 |
| 8 | 探针 C `/tmp/v6-11-r1/probe-c-duplicated-tab.mjs` | exit 0；复现阻断问题，见第三节 |
| 9 | 证据一致性：`/tmp/v6-11-r1/scope-check.mjs`，对照 `/usr/bin/git diff --name-only f89236a` + `ls-files --others --exclude-standard` | 见第五节第 1 条 |
| 10 | `runner.tap` / `regression.txt` / `typecheck.txt` / `build.txt` / `browser-log.json` / 截图 | 与复跑一致；详见第五、六节 |
| 11 | 隐私扫描：`grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|console\.|openai|anthropic|https?://"` on `parse.ts` `Parse.tsx` | exit 1（无任何命中） |

环境限制：工作树开发服务器 5174 对 pdf.js worker 返回 403，证据使用 `vite preview` 4176；复核沿用该方式复跑成功，按任务书视为环境限制而非阻塞项。

## 二、需求逐条对照

需求来源（主检出只读路径）：`docs/implementation/patent-saas-v6/tickets/V6-11.md`（A01–A03、写集）、`specs/S02.md`（阶段、状态机、UI 四态、A04/A05）、`05-contracts.md`（C03、C11、§3、§5、§7、§10）、`specs/S06.md` L46–47（活动白名单）、`01-architecture.md` L70（R1 中断指引）、`06-execution-protocol.md`（回执诚实性）。

| 需求 | 实现位置 | 结论 | 依据 |
|------|----------|------|------|
| V6-11-A01 文本 PDF/DOCX/TXT 生成可定位文本 | `parse.ts:729` `parseSource` → `verifyAsset:1274`、`extractPages:1379`、`buildChunkSet:1501`、`locateQuote:1594`；`Parse.tsx:145`；浏览器步骤 4/11 | 满足 | 场景测试断言 SourceRef 码点半开区间；复跑通过；199 页 PDF 生成 10746 段 |
| 真实五阶段与真实进度 | `parse.ts` 阶段常量、`runJob:964`，进度仅在 checkpoint 提交后 `deps.onProgress`（`parse.ts:1151-1153`） | 满足 | 探针 A 记录 11 次作业行写入、阶段序列 `verify ×7, extract_text, ocr_check, chunk`；心跳不改 stage/progress |
| C03 进度只改作业版本 / 版本校验 | `parse.ts:1797` `transitionStateOnly`、`1718` `commitTransition`、`renewLease:1964` | 满足 | 探针 A：版本严格 +1；`transitionStateOnly:1818` 版本不符返回 INVALID_INPUT |
| C11 R1 无后台任务、逐阶段检查点、关闭/刷新 → interrupted、可从已保存阶段继续或放弃、不声称排队 | `Parse.tsx:336-365` `loadAll`、`Parse.tsx:354` 调 `markInterrupted`、`parse.ts:861`；`parse.ts:823` `resumeParse`、`887` `abandonParse` | **部分不满足** | 同标签页刷新立即中断成立（探针 B1、浏览器 09/10）；但复制标签页共享 sessionStorage 会把别的页面的存活作业中断（阻断 1） |
| 扫描件 → `partial + ocrNeeded` + `OCR_UNAVAILABLE`，无 OCR 不造假文本 | `parse.ts:91` `OCR_PROVIDER_AVAILABLE=false`、`1163-1186` | 满足 | 场景测试与浏览器步骤 6；`partial` 不生成 chunk |
| DOC 未支持时明确失败，不计时器假成功 | `verifyAsset:1274`、guard 复用（`parse.ts:32` 导入 `packages/parsers/src/guard.ts`）；`parse.ts:1344` `runGuard` | 满足（node 覆盖） | 浏览器步骤 7 上传即拒；`.doc` 失败仅 node 测试覆盖（回执已声明） |
| 失败与恢复呈现、重试生成新作业而非复用脏状态 | `retryParse:823`、`failNow:1209`；浏览器步骤 8 | 满足 | 步骤 8 前后 jobId 不同；`retryParse` 创建新 job 并以 `previousJobId` 链接 |
| 取消/放弃终态正确 | `cancelParse:918`、`cancelNow:1235`、`abandonParse:887` | 满足 | 浏览器步骤 10 interrupted→cancelled 持久；场景断言终态不可再推进 |
| UI 四态 + R1 interrupted 恢复杂项（继续/放弃，绝不「排队中」） | `Parse.tsx` 渲染、`parse.ts:586` `effectiveStatus`、`2045` `buildParseRows` | 满足 | 场景 UI 测试逐态断言；浏览器 09 断言无「排队」、含「从已保存阶段继续」「放弃」 |
| 写入案件时机（中间态不冒充成品） | 作业/检查点写 `parse/` 前缀（`parse.ts:425-439`），终态才 `job.succeeded` 提交 Source（`1168`） | 满足 | 探针 A/B3：运行中案件记录不变；终态一次性提交 |
| §10 错误码 | `parse.ts:102`、`114` `OCR_UNAVAILABLE` 等 | 满足 | 场景断言错误码集合 |
| S06 活动白名单与 metadata 白名单 | `parse.ts:1652` 仅四种 `job.*` 动作；`metadataFor` 仅 stage/provider/model/count/errorCode | 满足 | `repository.ts` 白名单校验通过；未发出 `job.interrupted` |
| 编排者共享文件：`onSettled` 成功/失败都触发、不重挂载、无过期闭包 | `Upload.tsx:191-195`（`.finally` 内调用，成功/拒绝/异常均触发）；`V6App.tsx:319/321、393/395`（无 `key`，仅 `refreshToken` prop）；`Parse.tsx:163-166`（`refreshToken` 变更只重跑 `loadAll`，`:168` 仅卸载时 abort） | 满足 | 探针 B3：运行中上传后同一 jobId、检查点不丢、最终 parsed；浏览器步骤 11；未发现 stale closure（`bumpParse` 为 `useCallback` 无依赖） |
| 隐私与厂商中立 | 无网络/日志（命令 11 无命中）；OCR 恒不可用；解析全部本机 | 满足 | 探针与 grep |

## 三、阻断问题

### 阻断 1：复制标签页（共享 sessionStorage）会把另一页面正在运行、租约有效的作业立即中断

- 位置：`apps/web/src/v6/features/sources/Parse.tsx:132-140`（`tabSessionId` 只把 id 存进 `sessionStorage`）、`Parse.tsx:348-357`（`loadAll` 对「同 session + 有有效租约 + 本页无 runner」直接调 `markInterrupted`）、`apps/web/src/v6/features/sources/parse.ts:869-881`（`markInterrupted` 接受 ORPHANED 分支并把 `state` 置 `interrupted`、清空租约；`:880` 还把 Source 置 `failed`）。
- 触发：任意会复制 sessionStorage 的标签页创建方式——Chrome/Edge 右键「复制标签页」、`window.open` 打开同源页面（复制 opener 的 sessionStorage）、关闭后 Ctrl+Shift+T 恢复。浏览器实现已确认复制行为（见 WebSearch 结果：duplicating a tab copies sessionStorage；恢复关闭的标签页也会带回 sessionStorage）。
- 反例命令与输出（可复现；探针 C）：

```
node /tmp/v6-11-r1/probe-c-duplicated-tab.mjs
```
```json
{
  "page2": { "phase": "ready", "status": "interrupted", "jobState": "interrupted", "owner": null },
  "outcome": { "ok": false, "state": "interrupted", "errorCode": "INVALID_INPUT" },
  "finalStatus": "interrupted",
  "jobs": [ { "state": "interrupted", "errorCode": null } ]
}
```
探针用真实 `loadAll`（esbuild 打包 `Parse.tsx`）在页面 1 的 `loadPdfPages` 期间以同一 session id、`runningAsset=()=>null` 执行一次页面 2 的挂载读取；页面 2 写入后，页面 1（从未关闭、租约仍有效）的 `parseSource` 返回 `interrupted/INVALID_INPUT`，持久作业为 `interrupted`。

- 期望：C11 的 interrupted 是「标签页关闭、刷新或休眠」的结果；另一个标签页的挂载读取不应改变一个仍在运行且租约有效的作业。S02 L49 也只要求显示被关闭标签页留下的 interrupted。
- 实际：第二个页面的挂载即可中断第一个页面的作业，且中断写的是持久记录，导致用户必须重新「从已保存阶段继续」；对 199 页文档等同一次无谓的重复解析。
- 为什么算阻断：这是数据层可复现的行为错误（不是推断），违反 C11/S02 对 interrupted 的语义界定，并使「恢复与持久状态一致」（V6-11-A03）在常见浏览器操作下被破坏。场景测试与浏览器证据都只覆盖单标签页，未覆盖该路径。
- 建议的修复方向（非本次实现）：把「页面实例」与「持久会话」分离——例如 session 保存在 sessionStorage 以跨刷新，但页面实例另有内存态 id 并通过 BroadcastChannel/心跳验证原页面是否仍存活；或 `markInterrupted` 的孤儿分支要求 `leaseExpiresAt` 已过期/竞租成功后才允许改写，而不是接受任意有效租约。

## 四、非阻断问题（含回执与证据限制核对）

1. **证据 scope 需重采记录。** `scope.txt` 与 `receipt.changedFiles`（38 项）采集于 16:03，之后 `.planning/2026-10-30-patent-saas-v6/progress.md` 于 16:10:55 被修改（编排者写入本轮进度，非执行者改动）。当前 git 口径 39 项，差集即该文件（`/tmp/v6-11-r1/scope-check.mjs`：`inScopeNotReceipt [".planning/.../progress.md"]`，`inReceiptNotScope []`）。回执对 38 项的记述在当时准确；编排者需在收尾前重采 `scope.txt`/`changedFiles`。不计阻断：该文件不在执行者写集，且剔除 `node_modules`、`.claude/launch.json` 后无其他差异。
2. **跨标签页并发开始的窄竞态（模块层）。** `parseSource` 不检查是否已有存活作业；探针 B4 在同一 Source 上直接并发启动两个作业，两者都 `succeeded`，`currentJobId` 为第一个作业的 id（结果覆盖顺序）。字节相同故产物一致、chunk 键确定性去重，UI 侧由 `canStart: status==="pending"`（`parse.ts:2077`）与 `runningAsset.current` 同步守卫（`Parse.tsx:176/206/237`）拦截，用户操作不可达。建议模块层加「该 Source 已有存活租约则拒绝」的防线。不计阻断：需脚本直接调用，UI 无法触发。
3. **`retryParse` 允许从 parsed/partial/interrupted 重试**（`parse.ts:823`），UI 只在失败态露出「重试」；属实现比界面宽，非虚假成功。不计阻断。
4. **`stopLease` 可能调用两次**（`stopAndDrain` 与 `finally`，`parse.ts:1199`）；幂等 `clearInterval`，探针 A 观察 cleanup 2 次，无副作用。不计阻断。
5. **两处近似空断言**：`parse-engine.test.mjs:409` `resumed.job.jobIds ?? resumed.job.job.id` 与 `:520` `retried.job.jobIds ?? null`。`ParseJobEnvelope` 无 `jobIds` 字段，前半段恒为空，前者退化为「job.id 等于自身」、后者恒为 null，均无实质约束；同一用例中前后相邻的真实断言（`resumed`/`retried` 的 jobId 与 `previousJobId`、阶段、chunk 集）仍生效，故不影响结论。不计阻断。
6. **`browser-log.json` 的 `waitedForLeaseMs: 0` 是常量**（`browser-drive.mjs:352`），而非实测等待时长；但同一步骤的实质断言 `browser-drive.mjs:347`（`Date.now() < Date.parse(before.leaseExpiresAt)`）与 `:349`（持久记录 `interrupted` 且租约清空）真实执行且复跑通过。不计阻断，但日志字段名为限时等待，易误读为计时结果。
7. **09a 与 09b 截图二进制完全相同**（sha256 均为 `1032c4dc…44f5`）。原因是两处截图（`browser-drive.mjs:351` 与 `:505`）之间页面状态未变，均拍摄已稳定为「已中断」的列表。不构成伪造证据，但两张图不能提供增量信息。不计阻断。
8. **中断写 `sourceStatus: "failed"`**（`parse.ts:880`）而作业为 `interrupted`；UI 对 interrupted 显示恢复杂项，语义可接受。不计阻断。
9. **检查点续租的心跳每 20 秒各写一次作业行**（含修改时间戳），长解析期间写入量随页数线性增长但每阶段固定为若干次；探针 A 观察 11 次写。性能风险，非功能缺陷。不计阻断。

**回执限制核对**：`receipt.json` 的 `limitations` 与事实一致，逐项验证：手动补充禁用（未发现补充入口启用）、OCR 不可用（`OCR_PROVIDER_AVAILABLE=false`）、作业记录与案件提交非同事务（`commitTransition` 内 Source 与 Job 同批写入，但跨批次）、无 `job.interrupted` 活动动作（确未发出）、DOCX/TXT 恒计 1 页、`.doc` 失败仅 node 覆盖（浏览器步骤 7 为上传即拒，非解析失败）、浏览器证据依赖 `vite preview` 4176。回执 `status: candidate`，未把未验证项写作已验证。除第一节阻断项覆盖的空白（多标签页身份）外，未发现「未做却写做」或「未满足却写满足」。

## 五、探针与复跑说明

- `/tmp/v6-11-r1/probe-a-lease.mjs`：以包装 backend 的观察者记录每次 readwrite 事务后的 `parse/job/*` 快照，注入 `scheduleLeaseRenewal`，在真实 `loadPdfPages`（verify 与 extract_text 两阶段）内推进时钟并触发心跳。结论：调度间隔 20 000 ms（=leaseMs/3）；11 次作业写入（启动 + 4 checkpoint + 5 心跳 + 终态），版本 2→12 严格 +1；每次 running 写入的 `leaseExpiresAt - wroteAt ≥ 60 000`；心跳不改 stage/progress；终态租约置空；完成后迟到 tick 零写入、无法复活作业。证实自述 (a)。
- `/tmp/v6-11-r1/probe-b-orphan.mjs`：`B1` 用真实 `loadAll` 在同一页面实例重载（`runningAsset=()=>null`）立即得到 `interrupted`，此刻 `Date.now() < leaseExpiresAt` 成立（`beforeLeaseExpiry: true`），作业行 `interrupted`、租约清空、无检查点；`B2` 另一标签（不同 session）读取结果为 `running`、同一 jobId、leaseOwner 不变，且未被改写；`B3` 运行中保存第二个文件并触发 `loadAll` 刷新，作业保持 `running`、jobId 不变、检查点不丢、新资产可见（3 个），原作业最终 `parsed` 并写入 chunk 集；`B4` 并发第二个作业的覆盖顺序（见非阻断 2）。证实自述 (b)(c) 在单会话内成立，同时给出阻断 1 的相关线索。
- `/tmp/v6-11-r1/probe-c-duplicated-tab.mjs`：两个页面实例共享同一 session id，页面 2 挂载读取即中断页面 1 的存活作业，复现阻断 1。
- 浏览器复跑（`vite preview` 4176）：步骤 09 在同一租约内刷新即中断；步骤 10 刷新后放弃→cancelled 持久；步骤 11 199 页解析中上传保存后仍为同一作业、不出现「未解析」闪回、无 console 错误。
- 场景测试审读：`qa/v6/scenarios/V6-11/` 的 `parse-engine.test.mjs`（21 个 `test(`，其中租约续期一条在循环内生成 7 个模式）与 `parse-ui.test.mjs`（12 个）合计 40，与 `runner.tap` 一致；均无 skip、无空断言主体、使用真实 `LocalRepository` + 内存 backend（非 mock 旁路）；`harness.mjs` 用真实 V6-10 `ingestFiles` 播种；`ingest` 断言每个文件 `saved`。测试覆盖 A01/A02/A03、租约续期（注入 tick）、冲突/取消/中止、存储故障注入、UI 各态标记。未覆盖多标签页身份（阻断 1 的成因）。

## 六、最终结论

除「复制/恢复标签页会中断另一页面正在运行且租约有效的作业」这一可复现的 C11 语义违例外，V6-11 的核心实现、场景测试、浏览器证据与回执限制均已独立复核通过；修复该阻断并重采 scope 后可再次送验。
