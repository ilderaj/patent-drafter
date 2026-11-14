VERDICT: ACCEPT
# V6-11 解析进度与失败恢复 — 第二轮独立验收复核

复核对象：`codex/patent-saas-v6-foundation-origin` 工作树 `/private/tmp/patent-v6-worktree`，基线 `f89236a12b85f262c7058f0fc9dca6438983a829`。
复核性质：只读。除本文件外未修改工作树文件；探针、临时输出和复跑产物全部位于 `/tmp/v6-11-r2/`；未执行 commit、push、stage、reset、clean 或 stash。

## 一、复核范围与命令（含退出码）

| # | 命令 | 退出码 | 结果与证据 |
|---|------|--------|------------|
| 1 | `npm run test:v6 -- V6-11` | 0 | `runner-final.tap`：53 tests / 53 pass / 0 fail / 0 skipped / 0 todo；`parse-engine.test.mjs` 31/31，`parse-ui.test.mjs` 22/22 |
| 2 | `npm run test:v6 -- V6-10` | 0 | `regression-final.tap`：36 tests / 36 pass / 0 fail / 0 skipped / 0 todo |
| 3 | `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` | 0 | `typecheck-final.txt` 为空，无诊断 |
| 4 | `./node_modules/.bin/vite build apps/web --outDir /tmp/v6-11-r2/build-final --emptyOutDir` | 0 | 2182 modules，`✓ built in 2.59s`；`V6App-CRyYlpsV.js` 115.09 kB，与证据 `build.txt` 的资产名和大小一致。为遵守只读约束未运行会写工作树 `dist/` 的 `npm run build`，而是用 `/tmp` 输出目录重跑等价构建；`tsc` 已单独执行并通过。 |
| 5 | `node qa/v6/evidence/V6-11/browser-drive.mjs /tmp/v6-11-r2/browser-run http://127.0.0.1:4176/patent`，前置 `vite preview` 4176 | 0 | 12/12 步通过，0 console 错误；`browser-run.out` 为 `ok: true`、`failed: []`。09：`reloadToInterruptedMs 1009`、`leaseRemainingMsAfterReload 58791`、版本 3→4、从 `extract_text` 续跑、10450 段/190 页；10：1009、58288、版本 3→5、放弃后 `cancelled`；11：新来源 115 ms 出现、1282 ms 完成、同一 jobId、10746 段/199 页、7 个时间样本；12：复制 session 为 true、第二页 `running/正在校验文件`、同一 jobId、同一 ownerPageId、版本 3→3、原页保持运行并最终 10945 段/199 页完成。 |
| 6 | `node /tmp/v6-11-r2/probe.mjs` | 0 | 独立探针 16/16 通过，0 失败；`probe-final.log`。详见第六节。 |
| 7 | `/usr/bin/git status --porcelain --untracked-files=all` 剔除 `node_modules` 与 `.claude/launch.json` | 0 | 44 项；`receipt.json.changedFiles` 也是 44 项，无缺项、无多项。写入本文件后会变为 45 项，比回执多出的唯一项是本轮复核员自己的 `review-02.md`，属预期，不是执行者漏报。 |
| 8 | 截图 SHA-256 对比 | 0 | `09a` 9f9f6863…、`09b` 1032c4dc…、`10a` 94a403e3…、`10b` e957265f…，四者互不相同；`12a` 6ffcbf30… 与 `12`/`12b` 的 84ddfe86… 不同；`12` 与 `12b` 相同是 `recordStep` 在步骤结束后再次拍摄同一个已完成状态所致，不是复制证据。 |

证据原文件中的浏览器步骤 09/10 为 `reloadToInterruptedMs 1008`、`leaseRemainingMsAfterReload 58798`（版本 3→4）和 `1010`、`58361`（版本 3→6）；本次复跑只是运行时刻、重试次数和 job 版本不同，所有断言语义一致。`vite preview` 已停止；未改动未跟踪的 `.claude/launch.json`。

## 二、需求逐条对照

| 需求 | 结论 | 依据与说明 |
|------|------|------------|
| V6-11-A01 文本 PDF/DOCX/TXT 生成可定位文本 | 满足 | 53/53 场景通过；`chunkSchema`、`sourceRefSchema`、sha256、NFC、PDF 页号 `[1,1,2,2]`、真实 `locateQuote` 均被断言；浏览器 04/11 生成 2 段/1 页、4 段/2 页、10746 段/199 页。 |
| V6-11-A02 非法、陈旧、失败状态明确失败，不计时器假成功 | 满足 | 扫描件 `partial + ocrNeeded + OCR_UNAVAILABLE` 且零伪造 chunk；`.doc` 解析失败、201 页预算失败、MIME 伪装失败均有 node 覆盖；浏览器 06/07/08 复现；续租只在 checkpoint 和心跳中发生，不推进 stage/progress。 |
| V6-11-A03 刷新/重试后结果与持久状态一致，无重复副作用 | 满足 | 浏览器 05/08/09/10/12 与探针的重复挂载、重试、续跑均通过；重复挂载前后 backend 深度相等，重试创建新 job 并链接 `previousJobId`，同一 source 最终只有一个成功 job。 |
| S02-A04 扫描 PDF 无 OCR 配置 | 满足 | 浏览器 06 显示 `部分解析`、禁用 `手动补充`、可重试；引擎无 OCR 文本、零 chunk、`OCR_UNAVAILABLE`，与回执一致。 |
| S02-A05 R1 解析中断、从保存阶段继续或放弃、不显示排队 | 满足（同标签刷新路径实测） | 浏览器 09/10 在原租约剩余约 58.8 s/58.4 s 时刷新，首个稳定渲染即 `已中断`，保留 `verify` 等检查点；继续从 `extract_text` 运行，放弃后 `cancelled`；全程无「排队中」。关闭浏览器标签后由浏览器恢复会话、把 `sessionStorage`（含 marker）带回的路径未单独用浏览器驱动；独立新标签属于不同 session，租约内读 `running` 是当前设计的边界，见非阻断 2。 |
| S02-A06 R2 轮询恢复 | 不适用 | 本票是 R1，A06 明确是 R2 的 2 秒轮询；实现没有持久 worker 或轮询。回执 `specAcceptance` 未逐项列出该 not_applicable 项，属回执完整性小问题，见非阻断 9。 |
| C11-R1 当前标签页执行、逐阶段检查点、关闭/刷新/休眠 interrupted、可继续/放弃、不排队 | 满足（正常路径） | `Parse.tsx` 的 pagehide marker、`loadAll` 的 `orphanInterruptAllowed` 证据校验和 `effectiveStatus` 租约判定均已验证；正常刷新在 1 s 内中断。租约续租抢在 pagehide 之后的窄状态机竞态见非阻断 1，未在本轮正常浏览器路径复现为阻断反例。 |
| UI 四态与陈旧状态 | 满足 | 浏览器 04/06/08/09/10/11 覆盖空、加载、错误、陈旧/中断；中断行有「从已保存阶段继续」「放弃」和 stale 提示，无排队文案；`parse-ui.test.mjs` 22 项无 skip。 |
| 写集、编排者共享文件、回执协议 | 满足 | 执行者写集仅为 `parse.ts`、`Parse.tsx`、`qa/v6/scenarios/V6-11/`、`qa/v6/evidence/V6-11/`；本轮未对 `V6App.tsx`/`Upload.tsx` 做任何修改，二者相对 base 的未提交差异与 review-01 时相同，回执注明是编排者注册；`Parse` 无 `key`、只用 `refreshToken`，`Upload` 在 `.finally` 调用可选 `onSettled`，依赖数组无 stale closure（浏览器 11、探针 4 验证同一 job）。`status: candidate`、`review: pending_review` 未被改写为已验收。 |
| §10 活动白名单与 metadata | 满足（有已声明的决策项） | 只发出 `job.started/succeeded/failed/cancelled`；中断、放弃和续租不伪造 `job.interrupted`；中断把 source 置 `failed` 但 UI 依 job 显示中断。该语义已在回执 decisions/limitations 中声明，非阻断 10。 |

## 三、阻断项

未发现阻断项。review-01 的阻断 1（复制/恢复标签页共享 session id，导致第二页把第一页正在运行且租约有效的作业立即中断）已被独立探针证实修复：

- 复制标签页、不同 pageId、不同 session、无 marker 四种挂载读取都保持 `running`，多次挂载前后整个 backend 深度相等，原 runner 最终 `parsed`，只有一个 job（`dup-tab / foreign markers write nothing`，`jobRows: 1`）。
- 拥有页的匹配 marker 在租约内立即中断：`leaseRemainingMs: 60000`、`version 3→4`、`leaseExpiresAt` 清空、source `failed`；再次 `markInterrupted` 和再次挂载均不重写版本，runner 不再成功（`owner marker interrupts inside lease and is idempotent`）。
- 过期租约对任意 reader 都是 `interrupted`；`markInterrupted` 可由任意 session 持久化，版本只增一次，重复调用幂等；可从 `verify`、`extract_text`、`ocr_check`、`chunk` 继续（`expired lease any reader persists; resume continues`）。
- 不同 session 读取为 `running`；运行中上传第二个来源后仍为同一 jobId、同一检查点，最终 `parsed`，只有 2 个 chunk（`foreign session reads running; upload keeps job`）。
- `parseSource` 同 realm 锁拒绝第二次启动且不写任何行；持久化 live lease 同样拒绝；调度器在 `job.started` 后抛错时锁被释放，第二个启动仍被 live lease 拒绝，租约过期后 resume 成功（`same-realm start lock refuses without writes`、`persisted live lease refuses; lock released on throw`）。

因此，第一轮阻断所依据的反例（第二页挂载即中断存活作业）本轮不可复现；不再构成阻断。

## 四、非阻断问题

1. **续租恰好从 pagehide 之后启动的窄竞态。** `parse.ts:2105` 在续租开始时同步计算新的 `leaseExpiresAt`；若续租调用本身在 exit marker 之后才开始，`orphanInterruptAllowed` 的 `renewedAt = expiresAt - leaseMs`（`parse.ts:662-663`）会晚于 `exitedAt`，刷新后的页面在租约内读 `running`，marker 被消费，直到租约过期才变 `interrupted`。探针 8 的强制顺序输出为 `statusAfterReloadInsideLease: running`、`markInterrupted: INVALID_INPUT`、`delayToInterruptedMs: 70001`、`statusAfterLeaseExpiry: interrupted`。这是 fail-closed（不误伤可能仍存活的页面）、有界且回执 limitation 4/12/16 已覆盖的竞态；正常刷新路径未复现，探针 9 证明「续租在 pagehide 之前已开始」不会延长租约，挂载仍立即中断。非阻断。
2. **无 marker、blocked sessionStorage、独立新标签在租约内只能显示 running，且 UI 没有到期自动重读。** `Parse.tsx:471-480` 对无 marker 的 live lease 不做持久写入；`Parse.tsx:491` 只清除 marker；组件只在挂载、`refreshToken`、`attempt` 时读取（`Parse.tsx:224-238`），没有轮询。租约过期后若没有新的读取，界面不会自动变成 `interrupted`。回执 limitations 5/6/7/16 已声明 crash/blocked storage/无 marker 的 60 秒回退；浏览器只覆盖了 reload 和复制标签，没有驱动「关闭后恢复」或「新独立标签等到过期」。这是证据与体验边界，不是本轮反例；非阻断。
3. **SPA 路由切换没有 pagehide。** `Parse.tsx:238` 在卸载时 abort，`runJob` 在阶段边界得到 abort 后走 `cancelled`（`parse.ts:1022/1202`），下一次挂载显示 `cancelled` 并只提供重试，已保存阶段不能 resume。C11 只规定关闭/刷新/休眠，没有规定内部路由切换；不后台继续也符合 R1。非阻断。
4. **外部 reader 看到过期租约时，`loadAll` 不持久化旧 job 行。** `Parse.tsx:471-480` 只在 `leaseOwner === sessionId` 时调用 `markInterrupted`；不同 session 的挂载通过 `effectiveStatus` 得到 `interrupted`，但底层旧 job 仍可能是 `running` 且租约过期。直接调用 `markInterrupted` 的任何 reader 都能持久化（探针 3 已验证），UI 也能继续/新建 job，因此用户路径正确；留存的 raw job 状态和审计记录不够整洁。非阻断。
5. **marker 在一次完整的 `loadAll` 后被清除，包括被拒绝或过期的 marker。** `Parse.tsx:491` 在遍历完所有 source 后无条件清除；探针 8 的 `markerClearedAfterFirstPass: true` 说明一次被续租拒绝的 marker 不会第二次尝试。该设计避免一个 marker 反复影响后续读取，代价是之后只能等租约或下一次 pagehide；有界且已由回执 limitation 9 说明。非阻断。
6. **`loadAll` 调用 `markInterrupted` 时没有传自定义 `leaseMs`。** `Parse.tsx:471-480` 只传 session、now、jobId、pageExit；`parse.ts:660` 使用默认 60 s。生产 `parseSource` 也用默认值，故当前一致；若未来有非默认租约的调用方，marker 的 renewedAt 判断会偏差。非阻断。
7. **浏览器步骤 12 的 jobVersion 断言是 `>=` 而非 `===`。** `browser-drive.mjs:776` 只能证明版本没有回退，不能单独证明「没有写入」；同一步还断言了同 jobId、同 ownerPageId、jobState running、jobCount 1，本次证据和复跑均观察到 3→3，独立探针也做了 backend 全量深度相等，因此证据足以支持结论；建议以后收紧为 `===`。非阻断。
8. **回执步骤 11 的精确计时与 evidence browser-log 不一致。** `receipt.json` 的 `V6-11-browser.observed` 写「129 ms 出现、932 ms 完成」，`browser-log.json` 记录为 108 ms、901 ms，本轮复跑为 115 ms、1282 ms；三次的行为和最终成果相同（同一 job、10746 段/199 页），只是采样运行不同。步骤 12 的 `completedWhileSecondPageOpen` 在证据中为 true、复跑为 false，也是采样时序（最终均完成）。回执应重采或去掉精确时间，以免证据与回执文句不一致；不构成虚假成功。非阻断。
9. **`specAcceptance` 没有列出 S02-A06 的 `not_applicable`。** `tickets/V6-11.md` 要求逐项列出 covered/not_applicable 及理由；回执只列了 S02-A04、S02-A05、C11-R1、S02-UI-states。A06 明确是 R2 轮询，本票 R1 下合理为 not_applicable；补一行即可，不影响实现结论。非阻断。
10. **中断没有 ActivityRecord 的 `job.interrupted`，且 sourceStatus 写 `failed`。** `parse.ts:998-1000` 的 transition 只改 job/source；`05-contracts` §10 与 `S06` 白名单没有 interrupted 动作，回执 decisionsRequested 已请求决定。UI 依 job 状态显示中断，不虚假成功；非阻断。
11. **blocked-storage 探针中的 `runnerStillSucceededAfterExpiredRead: true` 是模拟产物。** 探针保留了同一 JavaScript runtime 并关闭续租，读数过期后原 runner 仍可能完成；真实卸载会终止 runner。该字段不应被当成浏览器行为或产品缺陷；回执 limitation 7 已说明 blocked storage 的回退。非阻断。
12. **跨标签页同时启动的竞态仍未覆盖。** 回执 limitation 11 明确说两个独立标签在同一瞬间启动、且都还没看到 job 行时未被同步；模块级锁只覆盖同一 realm，持久化 live-lease 只能覆盖 job 行已写入后的窗口。同 realm 锁、持久化检查和异常路径释放本轮均已独立验证；跨标签竞态属未验证范围，非阻断。

## 五、新增机制的边界判断

- **pagehide marker 的归属。** marker 只在 `runningAsset.current !== null` 的页面写入（`Parse.tsx:245-260`），包含 sessionId、内存 pageId 和 ISO 时间。没有 marker、foreign pageId、foreign session、错误 jobId、无效时间、null lease、ownerPageId 不匹配、job 非 running 时，`orphanInterruptAllowed` 全部返回 false；marker 时间等于或晚于租约到期、以及同一时区的等价瞬间均按预期返回 true；缺 session、`leaseMs` 不对、NaN 时间、时钟回拨则拒绝（探针 10 矩阵）。拒绝只返回 `INVALID_INPUT`，不写 job/source/checkpoint。
- **同标签刷新。** 刷新后 `sessionStorage` 保留 session 和 marker，新页面实例没有 runner，但 marker 的 pageId 等于 job 的 `ownerPageId`；租约内立即 `interrupted`，不需要等 60 s。浏览器步骤 09/10 与探针 2 均验证；`markInterrupted` 第二次调用返回成功但不增加版本，探针的 backend 快照不变。
- **复制/恢复标签页。** 复制标签页共享 session 和（若复制时存在）marker，但 `pageInstanceId()` 只在内存中，新页面拿不到 ownerPageId 对应的 pageId；`loadAll` 对 live lease 只读 `running`，不写行。探针 1 做三次挂载，backend 全量相等，原 job 最终完成且只有一个 job；浏览器步骤 12 也观察到 3→3、同 ownerPageId。恢复已关闭标签页时，浏览器恢复 `sessionStorage` 会把原页面写下的 marker 带回，从而满足同标签刷新语义；该具体关闭/恢复操作本轮未用真实浏览器驱动，已在非阻断 2 记录。
- **续租与租约。** 每 `max(1, floor(leaseMs/3))`（默认 20 s）及每个 checkpoint 续租，续租在异步 transition 前计算 `leaseExpiresAt`（`parse.ts:2105`），因此「续租在 pagehide 前已开始、之后才提交」不会把到期时间推到 exit 之后；探针 9 的 `statusAfterMount: interrupted`。只有续租调用在 pagehide 之后才开始才可能延迟，见非阻断 1。租约到期对任意 reader 是 `interrupted`（`effectiveStatus`，`parse.ts:614-624`）；任何 reader 的 `markInterrupted` 都可持久化过期 job，续跑从最后一个保存阶段开始，探针 3 已验证。
- **marker 消费与多来源。** `loadAll` 在一次完整 pass 后清除 marker（`Parse.tsx:491`），因此多来源列表中的每个 source 都有机会认领同一个 marker；第二次挂载或复制标签页不会再使用它。被拒绝的 marker 也会被消费，这是单向证据设计，代价见非阻断 5。malformed 或 foreign marker 会被忽略但仍留在 storage（探针 7：`foreignMarkerRemains: true`、`malformedMarkerRemains: true`），属存储卫生问题，不影响判定。
- **bfcache、blocked storage、crash 与休眠。** `pagehide persisted=true` 不写 marker，`pageshow persisted=true` 清除陈旧 marker，避免 bfcache 恢复的同一页面打断自己的运行；blocked `sessionStorage` 只能使用内存 session 且不能写 marker；crash/OS kill 没有 pagehide，靠租约过期；这些路径回执 limitations 5/6/7/13 已声明，均未在真实浏览器驱动，属未验证边界而非本轮阻断。
- **SPA 路由切换与取消。** 无 pagehide，组件卸载 abort 当前 runner，阶段边界得到 `cancelled`，不伪造 `interrupted`；下一次挂载只能重试，已保存阶段不 resume。C11 未定义内部导航，且没有后台继续，故非阻断 3。
- **`parseSource` 并发。** 模块级 `startingSources` 锁在 `parseSource` 整个 job 生命周期内持有（`parse.ts:796-855`），第二次同 realm 启动在任何写之前返回 `INVALID_INPUT`；持久化 live lease 检查覆盖「job 行已写入」的另一顺序；两处异常路径（job 创建前与 job.started 后）都释放锁。`retryParse`/`resumeParse` 没有同 realm 锁，但本轮未发现 UI 可触发的双启动；跨标签同时启动不在已覆盖范围（非阻断 12）。
- **测试与证据改造。** `parse-engine.test.mjs:409` 与 `:520` 附近的近似空断言已替换为真实的 `ownerPageId`、`abandonedAt`、`previousJobId`、`resumedFromStage` 断言；`waitedForLeaseMs` 已从浏览器证据消失，改为实测的 `reloadToInterruptedMs` 和 `leaseRemainingMsAfterReload`；09a/09b、10a/10b 截图哈希不同；53 项测试无 skip/todo，探针 16/16 无失败。未发现用 mock 绕过、空断言主体或跳过步骤。

## 六、探针说明（路径与结论）

- `/tmp/v6-11-r2/probe-harness.tsx` 和 `/tmp/v6-11-r2/probe-harness.cjs`：用 esbuild 打包 `Parse.tsx`，导出真实 `loadAll`、marker 读写、`tabSessionId`、`pageInstanceId`，使页面挂载路径不依赖执行者场景；构建仅提示 `import.meta` 的 cjs 警告。
- `/tmp/v6-11-r2/probe.mjs`：16 个独立场景，使用真实 `parse.ts` 引擎、真实 `harness.mjs` 的 `MemoryBackend`/`ingest`，未调用执行者 V6-11 测试用例。`node /tmp/v6-11-r2/probe.mjs` 退出 0，`probe-final.log` 汇总 16 total / 16 pass / 0 fail。关键结果：复制/外部 marker 不写行且原 job 完成；owner marker 立即中断且幂等；过期租约任意 reader 可持久化并可从四个阶段续跑；不同 session 运行中上传保持同一 job 和检查点；同 realm 锁不写；持久化 lease 拒绝且异常后锁释放；marker 被多来源消费一次；续租后置竞态；in-flight 续租不延长；blocked storage；`orphanInterruptAllowed` 矩阵；abort 后 cancelled/只能重试；真实 runner 的复制标签端到端；失败后 retry 新 job。
- 探针 8 的「续租后置」用注入时钟和显式调用续租构造出 `renewedAt > exitedAt`，不是浏览器正常刷新可达的路径；探针 9 则验证真实 in-flight 续租在 pagehide 之前开始时的正确行为。探针 11 的 `runnerStillSucceededAfterExpiredRead` 是保留同一 runtime 的模拟产物，不能当成真实卸载行为（非阻断 11）。
- 其他产物：`/tmp/v6-11-r2/runner-final.tap`、`regression-final.tap`、`typecheck-final.txt`、`build-final.txt`、`browser-run.out`、`browser-run/browser-log.json` 及截图。所有命令均在工作树外写临时输出；工作树仅新增本文件。

## 七、最终结论

VERDICT: ACCEPT。review-01 的阻断 1 已被真实修复：拥有页 marker 在租约内立即中断，复制/恢复标签页的无 marker 挂载不写入任何持久记录，原作业继续运行并完成；过期租约可由任意 reader 持久中断，续跑、锁、异常释放和上传不重挂载均通过独立验证。53/53 场景、36/36 回归、tsc、等价生产构建、浏览器 12/12（0 console 错误）和独立探针 16/16 全部通过，scope 44=44。未发现新的阻断项；续租后置竞态、无 marker/独立新标签的租约窗口、外 session 旧行不落盘、回执 A06/步骤 11 计时一致性和若干测试/证据收紧项均为非阻断边界，已在第四节逐项说明。回执仍为 candidate，本轮不修改执行者证据、源码或 `.planning/`；建议编排者收尾时重采 `receipt.json` 的步骤 11 精确计时并补 S02-A06 的 not_applicable 行，必要时再补一次真实关闭/恢复标签页的浏览器证据。
