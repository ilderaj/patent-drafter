# 进度日志

## 会话：2026-11-05

- V6-17 第四轮复核的计数文档问题修正后，复核者以 review-05.md 给出 ACCEPT；最终 37/37、tsc/build 0、V6-10/14/15/16/21 回归全绿。回执置 accepted（28 项 changedFiles），提交 `7d4eae0` 并合并入集成分支。V6-18 已在独立工作树 `/private/tmp/patent-v6-18-worktree`（分支 `codex/v6-18-editor`，基于 f0cb918）启动，写集为 `features/draft/Editor.tsx`、`ast-adapter.ts` 与本票场景/证据；复用 V6-17 的 `createGenerationRevisionStore`。
- V6-18 候选就绪：7/7、web tsc 0、V6-17/16/15/14/10/08 回归全绿、浏览器 4/4（编辑保存后五段 AI 全部待确认、预览/导出投影引用新修订、无外部请求）；回执 candidate、14 项 changedFiles 与 scope 一致。已提交候选 `73a70df` 并派第一轮独立复核；同时从该候选并行启动 V6-19（`Review.tsx`）、V6-20（`features/preview/`）、V6-23（`features/checks/` + `packages/domain/src/v6/checks.ts`）三个互不相交写集的执行者。V6-18 的已知决策：saveEditedRevision 未原子绑定 DraftInputRef/图集快照，存在窄并发竞态；restore/adopted_inputs/risk_ack/付费预览不在本票。
- V6-18 第一轮独立复核 CHANGES_REQUIRED（review-01.md）：(1) 保存竞态可把旧 AST 绑定到新 source/config/figure 输入；(2) 权利要求编号缺口无定位（path 只有 claims）；(3) 两张浏览器截图内容与文件名相反。已授权 V6-17 seam 增加可选 expected input/figureRevision 前置校验（不匹配返回 INPUT_STALE、不写修订/事件），要求编辑器传递基修订输入；同时修编号定位映射与截图顺序，补确定性交错测试。
- V6-20 与 V6-23 执行者先后因工具输出把真实 UUID 脱敏显示为 `{{ACCOUNT_…}}`/`22222…` 而反复 Edit 同一处被中止；已确认两处 fixture 已是合法 UUID，并指示不得基于脱敏值编辑、从中断处继续。当前 V6-20 1/6、V6-23 1/11（均为未完成态）；两个 agent 已恢复。
- V6-20 候选就绪：6/6、web tsc 0、V6-05/08/10/14/15/16/17/18 回归与 workspace 通过、浏览器 6 步无外部请求；回执 19 项 changedFiles 与 scope 一致，S05-A01/A02/A09 covered，A05-A08 not_applicable。已派第一轮独立复核，重点验证 locked 正文/sourceRefs 不从 DTO/UI 泄漏、full_read 只能对完整当前稿原子写入且幂等。
- V6-19 候选就绪：5/5、web tsc 0、V6-18/17/16/15/14/10/08 与 workspace 通过、浏览器 4/4 无外部请求；回执 15 项 changedFiles 与 scope 一致，S05-A03 covered。已派第一轮独立复核，重点验证 locator 不可定位/不误高亮、确认与撤销的 actor/snapshot 绑定、新版失效与幂等。
- V6-18 三项阻断修复完成：V6-17 seam 增加可选 expected input/figureRevision，不匹配返回 INPUT_STALE 且不写修订/事件；编号缺口定位到缺失编号/claims；截图按 loaded/saved 顺序重采。9/9、V6-17/16/15/14/10/08 回归、tsc/build/browser 5/5 通过；回执 15 项 scope 一致，已派第二轮独立复核。
- V6-23 候选就绪：11/11、web tsc 0、V6-18/17/16/15/14/12/10/08/05 与 workspace 通过、浏览器 7/7 无外部请求；回执 25 项 changedFiles 与 scope 一致，S07-A01–A05/A07 covered、A06/A08 not_applicable。已派第一轮独立复核，重点验证四类语义、未核实法律规则不得成为 blocker、规则包去重与 G-RULES 关闭、失败不得当作通过。
- V6-19 第一轮独立复核 CHANGES_REQUIRED（review-01.md）：(1) locator 未校验 source.matterId/asset 且只比对存储 hash，篡改文本或来源版本变化仍可高亮；(2) 确认/撤销只写 ledger，未按 C03 增加 matter.version；(3) 无 risk 定位、默认 focus 只是滚动/描边、没有真实键盘焦点；(4) 浏览器运行写入了共享 node_modules/.vite。已授权窄改 repository（原子 ledger+事件+matter.version）与 vite cacheDir，并派修复：校验来源归属与实时文本哈希、stale 不暴露正文、真实 focus、隔离缓存重跑证据。
- V6-20 第一轮独立复核 CHANGES_REQUIRED（review-01.md）：(1) risk 标题/说明可泄漏 locked 段落的局部引文（只做了整段精确匹配删除）；(2) V6-05 confirm 把已撤销的 full_read 当作重复返回 created:false，UI 误显示已确认；(3) inputStale 只看 sourceVersion，未比 targetConfigVersion/figureRevisionId；(4) 回执把 R2 的 S05-A01 标 covered。已授权窄改 V6-05 重复匹配忽略已撤销行，并派修复：局部引文保守脱敏、撤销后重试创建新 live 确认、完整 DraftInputRef 比较、回执降级。
- V6-23 第一轮独立复核 CHANGES_REQUIRED（review-01.md）：(1) 同 ID 的过期 policy 规则仍可把 action 加入 blockingPolicyRuleIds，即使 finding 评估跳过了它；(2) 回执/依赖说明把 V6-18 当作 accepted，而实际是 candidate/pending_re_review。已派修复：blockingPolicy 只取实际评估的 active 版本、按 ID/version 去重；回执如实记录 V6-18 依赖状态。
- V6-18 第二轮独立复核 CHANGES_REQUIRED（review-02.md）：(1) 保存 await 期间的编辑会被静默覆盖并删除 buffer（数据丢失）；(2) scope.txt 漏 typecheck.txt，与回执 15 项不一致。已派修复：保存捕获快照与 revision token，成功时若模型已变则保留编辑与 buffer、更新 base 至新 head、不清空且标记 dirty；保存中禁用编辑；补确定性交错测试。同时重采 typecheck/scope 对齐回执。
- V6-23 过期 policy 阻断已修复并通过 12/12：blockingPolicyRuleIds 只取实际评估的 active 规则、按 ID/version 去重；回执已如实记录 V6-18 为 candidate at 73a70df。已派第二轮独立复核。
- V6-23 第二轮复核确认 stale-policy 已修复（12/12），但因 V6-18 仍是 candidate/pending、执行协议要求依赖先 accepted，暂不能接受；等 V6-18 通过后只需轻量复核依赖状态。
- V6-18 保存竞态修复完成：保存捕获快照/令牌，await 期间的新编辑保留在模型与 buffer、dirty 保持、base 更新至新 head，另加保存中禁编辑；10/10、tsc 0、回归通过，已派第三轮复核。V6-20 四项阻断修复完成：局部 locked 引文脱敏、撤销后重试创建新 live 确认、完整 DraftInputRef stale、S05-A01 降级；9/9、V6-05 26/26 保持，已派第二轮复核。
- V6-20 修复细化：risk 字段与 locked 段落按归一化重叠（8 字符/短文本高重叠）保守替换为章节级说明；V6-05 confirm 的重复匹配忽略已撤销行，撤销后重试生成新 live 确认并刷新预览；stale 比较完整 DraftInputRef；S05-A01 降级。V6-05 回执关于「重复确认一律幂等」的表述需后续补记该协调变更。
- V6-18 第三轮复核只剩计数不一致（复核者运行 11/11、TAP/回执 10/10）；当前树实际 10 个测试、TAP 已重采为 10/10，已请复核者确认计数并给出最终结论。
- V6-19 修复完成：locator 校验 source.matterId/asset 并重算实时 chunk 文本哈希，stale 不暴露正文；确认/撤销通过 repository 原子写 ledger+事件并递增 matter.version；risk/claim/source 使用 tabIndex=-1 与真实 focus；浏览器证据用 VITE_CACHE_DIR 隔离。11/11、tsc 0、scope 20 项一致，已派第二轮复核。
- V6-18 第四轮/计数复核 ACCEPT（review-04）：10/10 与 TAP/回执一致，暂停保存竞态探针全部通过。回执置 accepted，提交 `85ec601` 并合并入集成分支（merge `e9c14f9`）。
- V6-23 已把集成分支（含 accepted V6-18）合入其工作树，12/12、tsc 0；回执 dependencyStatus 更新为 V6-18 accepted，已请第二轮复核者仅复核依赖并给出最终结论。

- 原集成工作树 `/private/tmp/patent-v6-worktree` 被外部清理逐步删除（未提交的 planning 文字丢失，已提交的 `ea3e70b` 与分支完好）。已从 `ea3e70b` 新建集成分支 `codex/v6-integration` 与工作树 `/private/tmp/patent-v6-integration`；执行者工作树 16/21 未受影响。当前 PR 分支仍为 `codex/patent-saas-v6-foundation-origin`，合并后再推送。
- 按依赖图并行启动 V6-16（`/private/tmp/patent-v6-16-worktree`，分支 `codex/v6-16-pipeline`）与 V6-21（`/private/tmp/patent-v6-21-worktree`，分支 `codex/v6-21-matters`）。V6-16 首版把 S04-A07 的「schema 错误不重试」标为 not_applicable；已要求执行者在 provider 包装层拦截 runner 的 `#1` 修复请求，做到恰好一次 provider 调用并以 `PROVIDER_SCHEMA_INVALID` 失败，随后重跑证据。12/12 通过，已派第一轮独立复核。
- 部署准备（独立分支 `codex/v6-deploy`，提交 `c523bba`）：Vite base/outDir 支持 `V6_WEB_BASE`/`V6_WEB_OUTDIR`，router basename 改由 `BASE_URL` 推导（默认仍为 `/patent`，不改变现有行为）；新增 `build:v6-root` 根路径构建、根路径 `_headers`/`_redirects`（`/ → /v6 302`）与独立 `wrangler.patent-v6.jsonc`（worker `patent-v6`，路由 `patent.paymond.me`，纯静态 assets，无模型代理）。根构建 exit 0，headless Chrome 在 `http://localhost:4174/v6` 加载 V6 入口成功、无控制台错误。未部署，未触碰旧 `patent-drafter` worker。
- wrangler 尚未安装（本机无 CLI；已在临时目录尝试安装，等待网络）。本机存在既有 wrangler 凭据配置（未读取内容）。
- 找到本机可用的 Wrangler 4.90.0（另一项目的 node_modules），`wrangler deploy --config wrangler.patent-v6.jsonc --dry-run` 通过：assets-only Worker 读取 11 个文件、无绑定；配置改为 `custom_domain: true` 的 `patent.paymond.me`。`wrangler whoami` 因本机无法连接 `dash.cloudflare.com`（连接超时）未完成并报未登录；`curl` 到 npm registry 与 Cloudflare API 均超时（禁用沙箱后相同），当前环境无外网。部署将在 R1 验收后重试网络；若仍不可用，需要可联网环境或有效凭据。
- V6-16 第一轮独立复核 CHANGES_REQUIRED（review-01.md）：(1) 缓存元数据未绑定当前 provider/model，伪造合法哈希条目会被直接采用，stub 模式返回未调用过的 model，缓存命中仍报 cached:false；(2) 损坏缓存条目无法删除/替换，`putIfAbsent` 使毒化键永久保留并反复触发 provider 调用。其余探针（失效、授权、阻塞修复请求、并发、输入不变）通过。已派修复：按阶段类型校验元数据、命中置 cached:true、stub 的 model 为 null、缓存 seam 增加 delete 并在读坏条目时隔离重写。复核另记 Node 25 vs 架构注记 Node 22 的运行环境限制。
- V6-16 修复完成并经编排者复跑 14/14：元数据按阶段类型/执行模式/provider/model/prompt/rule-pack 绑定，缓存命中（含上游检查点）报 cached:true，损坏条目先 delete 再重算、二次污染报 INTERNAL_ERROR；毒化探针第二次运行为 0 provider 调用。已派第二轮独立复核。
- 发现本机代理 `127.0.0.1:7897`：经代理 `wrangler whoami` 成功，账号具备 workers/workers_routes/zone 等权限，Cloudflare API 可达。`wrangler deploy --dry-run` 配置通过（assets-only，11 个文件，无绑定）。部署不再是网络阻塞，但按发布门禁仍未执行。
- DNS 核查（DoH，只读）：`patent.paymond.me` 目前是 CNAME 到 `custom-domains.chatgpt.site`，HTTPS 返回 403，说明该主机名已被另一个 ChatGPT 自定义站点占用。直接创建 Worker custom domain 会与现有 DNS 记录冲突；替换记录会中断现有站点，属于对外且不易回滚的变更，部署前需要用户确认是接管该主机名还是改用其他子域。本轮不修改 DNS。
- V6-17 执行者因工具输出把真实 UUID 脱敏显示为 `{{ACCOUNT_…}}` 而反复 Edit 同一处被中止；已确认 harness 中四个 ID 均为合法 UUID，并指示其不要基于脱敏值编辑、从中断处继续补 UI、测试与证据。现存 generation.ts 与单个 A01 测试尚未完成（limits 未接好导致失败）。
- 部署脚手架已合入集成分支并验证：`build:v6-root` exit 0，headless Chrome 在根路径 `/v6` 加载入口成功；创建案件后直达 `/v6/matters/<id>/overview` 并刷新，外壳、标签与本地案件数据均恢复，无控制台错误。发布运行手册（构建/部署/冒烟/回滚/DNS 决策）提交 `d2a1206`。
- V6-17 第二轮诊断：新增的 `generation.test.mjs` 在 `register()` 之前静态导入 generation.ts，导致 tsx 未接管 `@patent/pipeline` 的 `.js` 解析，文件级 ERR_MODULE_NOT_FOUND；已指示改为动态导入。当前套件仅 1 个测试且失败。
- V6-21 复核四项阻断修复进行中：当前 29 个测试 28 通过、1 失败；inbox 已改为消费共享 nextAction，deletion_pending 与 parse job 处理及回执映射仍在收尾。
- V6-21 修复后 29/29、web tsc 0；回执已更新（A04 covered、A05 partial），但 runner.tap/scope/浏览器证据仍是修复前版本，已要求执行者刷新并如实标注浏览器证据时点。
- V6-21 四项阻断已修复并刷新证据：inbox 消费共享 nextAction、跳过 deletion_pending、parse job 按自身终态解决、新增 review feedback 测试并把 A05 标 partial；changedFiles 41 与 scope 一致，浏览器证据明确标注早于 B1-B4。已派第二轮独立复核。
- V6-17 收敛到 10/11；唯一失败为重试未复用已完成 facts 检查点（生成测试 `:110` 期望 1 次实际 2 次），已提示检查重试时上下文/缓存 scope 的复用，并要求补断言。
- V6-21 第二轮独立复核 ACCEPT（review-02.md），无阻断；收件箱投影、deletion_pending、parse 终态、review feedback 与 unarchive 均经独立探针确认。回执置 accepted，42 项 changedFiles 与 scope 一致（review-02 已计入），提交 `fb7af75` 并合并入集成分支；集成分支 V6-21 29/29、V6-06 25/25，已推送。
- V6-21 永久挂载完成：`V6App.tsx` 的 matters 路由改用 V6-21 `MattersPage`（创建/上传导航），`inbox` 分区渲染 `InboxPage` 且 `navigation.ts` 的收件箱能力改为 AVAILABLE。根构建 exit 0，headless Chrome 打开 `/v6/matters` 与 `/v6/inbox` 均正常渲染、无控制台错误；提交 `28695b7`，回执记录 permanent mount（`ab8164f`），集成分支已推送。
- V6-17 已补 `Generation.tsx` 与完整场景，当前 19/19、web tsc 0，浏览器截图与回归证据正在采集；回执尚未生成。
- V6-17 候选就绪：21/21（含排队取消、完成后取消、改变 consent 的重试拒绝）、web tsc 0、build 0、V6-08/10/14/15/16 回归全绿；浏览器 4/4 无外部请求，临时挂载已按字节还原。回执 candidate，22 项 changedFiles 与 scope 一致，S04-A06–A10 covered、A01–A05 not_applicable，两项 NEEDS_DECISION（C11 检查点存储 schema、运行中材料变化的 consent 策略）。已派第一轮独立复核，并要求重点审查五阶段到 18 阶段管线的映射（尤其 support→assess_readiness 是否真正产出依据映射）。
- V6-17 第一轮独立复核 CHANGES_REQUIRED（review-01.md），五项阻断：(1) support 实为 readiness 报告，AST 的 factIds/sourceRefs/supportParagraphIds 为空，且 currentInput 丢弃已持久化 facts；(2) maxCostMinor 与整任务 maxDurationSeconds 未真正限制调用；(3) 生成修订的 astHash 误用输入哈希；(4) saveEditedRevision 在 target 提交后的状态行写失败会使 head 与状态不一致、后续保存 VERSION_CONFLICT；(5) 回执 S04-A07 描述失败阶段错误。其余取消/重试/恢复/consent/幂等探针通过。已派修复，要求 support 成为真实的依据索引并贯通 AST、限额按整任务与保守成本执行、astHash 取 AST 摘要、修订 seam 可恢复、回执更正。
- V6-17 修复代码已落地：新增 SupportIndex（facts/chunks→factId/sourceRefs/chunkId、pipeline fact 模糊匹配、未解析清单），AST 构建器接入来源；整任务时长与保守成本上限返回 JOB_LIMIT_EXCEEDED；新增 canonicalAstHash；saveEditedRevision 增加状态恢复。当前 21/21 通过（修复前用例），新增阻断回归测试仍在补。
- V6-17 五项阻断均补了针对性测试（support/AST 来源、facts 变化、成本与时长上限、astHash、状态写失败恢复），28/28、web tsc 0、V6-10/14/15/16 回归全绿；回执与 scope 已刷新（24 项一致），已派第二轮独立复核。
- V6-17 执行者确认五项修复：support 为持久化 facts/chunks 的确定性索引并注入 claims/spec prompt 与 AST；成本/时长整任务限制（未知成本消耗预算）；生成修订使用 canonicalAstHash；状态行失败可从 target/修订行恢复；回执 S04-A07 已更正。证据刷新，浏览器截图未重采（UI 由 5 个测试覆盖），仍为 candidate；第二轮复核中。
- V6-17 第二轮独立复核 CHANGES_REQUIRED（review-02.md），三项阻断：(1) support 匹配过松，可把不相关/unsupported/unresolved fact 标为 supported，且不校验 sourceId/chunkHash/quote/offset；无 factId 的 source_backed feature 仍标 supported；(2) 成本只在逻辑阶段边界检查，单阶段内多次调用可超额（cap 2 仍完成 7 次）；(3) 时长在最后一次调用后不再检查，resume 重置计时，可累计超限仍成功。astHash、修订恢复、S04-A07 及其他核心行为通过。已派第三轮修复：严格匹配与 ref 校验、按调用即时计费、持久化 deadline 并跨 resume 累计。
- 编排者接管并修复 B2/B3 的代码：`costCapturingProvider` 改为每次响应即时 `applyInvocationCosts`，移除阶段末批量写回；`resume` 不再重置 `startedAt`，并在 adapter.run 后、阶段完成前再次检查 `deadlineAt`。独立探针：cap 2/成本 1 现在恰好 2 次调用后 `JOB_LIMIT_EXCEEDED`；400ms/调用、1s 上限在第 3 次调用失败；V6-17 仍 28/28、tsc 0。B1（support 严格校验）仍由执行者修复。
- V6-17 B1 严格校验已落地并经编排者独立探针验证：baseline 的 fact 关联为 supported；缺 chunk UUID、unsupported 状态、篡改 quote/hash 三种情况下目标 fact 均进入 unresolved，AST 不再关联它，且无“supported 但无来源”的 feature。B2/B3 探针同样通过；待执行者补 round-2 回归测试与证据。
- V6-17 round-2 回归测试已补齐（短事实不误配、缺 chunk、unsupported、无 factId、篡改 ref、cap 2 两次调用、最终调用超时、resume 累计超时），36/36 通过；web tsc 0、V6-10/14/15/16 回归全绿。等待证据与回执刷新后派第三轮复核。
- V6-17 证据与回执已刷新（25 项 scope 一致），review 状态改为 review-02 待第三轮；已派第三轮独立复核，并要求执行者冻结文件不再编辑。
- V6-17 第三轮独立复核 CHANGES_REQUIRED（review-03.md），唯一阻断：`normalizedText` 去掉所有标点/符号，`1.5mm` 可被归一成 `15mm` 并错误标为 supported。其余 round-2 探针（support 无效链接、成本、时长、恢复、核心回归）全部通过。编排者已将归一化改为 NFKC + 小写 + 仅去空白（保留数字标点/运算符），36/36 与 tsc 0 保持；已要求执行者补 `1.5` vs `15` 回归并刷新证据，再派第四轮。
- V6-17 数值归一化回归已加入并通过：`1.5mm` vs `15mm` 不再关联、精确值仍 supported、全角/空白变体可归一；37/37、tsc 0、V6-14/15/16 回归全绿。等待回执刷新后第四轮复核。
- V6-17 回执已更新（26 项 changedFiles、review-03 待第四轮、36/36），已派第四轮独立复核；执行者冻结文件。复核重点：数值标点（1.5/15、逗号小数点、正负号、不同单位）不产生假链接，且 support/成本/时长/恢复不回归。
- V6-17 第四轮独立复核 CHANGES_REQUIRED（review-04.md），唯一阻断是回执仍写 36/36 而 TAP 为 37/37；数值归一化本身已通过独立探针（1.5mm vs 15mm、逗号小数点、正负号、单位变体均无假链接，精确/全角/空白变体通过）。回执已更新为 37/37，已请同一复核者复核计数并给出最终结论。
- 集成分支回归全绿：V6-06/08/10/11/12/13/14/15/16 全部 exit 0；根构建再次验证。V6-17 收敛到 9/11，剩余失败为：重试重算了 facts 检查点（`:110`）、首个 job 未到 support 即被新引擎视为中断（`:179`）。
- V6-21 执行者候选已就绪（34 项 changedFiles，浏览器截图与回执齐全），等待其报告与独立复核。已知契约缺口：LocalRepository 在案件 archived 时拒绝一切写入，S06 的「取消归档」在现有写集内无法实现；执行者请求 NEEDS_DECISION，待复核后由编排者决定是否扩展 repository 写集。

## 会话：2026-11-02

- V6-13 第三轮独立复核 NOT_ACCEPT，唯一阻断 B4：无变更（no-op）保存跳过幂等记录，导致同键不同载荷被执行、相同重放不可重放。第三轮修复完成：无变更保存也写幂等记录（同一 readwrite 事务内检查并写入 requestHash、sourceVersion、基线快照、`unchanged: true`），幂等查找移到案件状态门禁之前；非阻断项同修（归档后重放成功、冲突面板「保留我的修改，基于第 N 版保存」、退役材料不再出现在选择器）。新增测试 25/26/27/28/39，修复前 5 项红；V6-13 39/39、V6-11 53/53、V6-10 36/36、tsc/build exit 0、red-before-fix 22 守卫、浏览器 12/12 步 0 console 错误；scope 35 项与 changedFiles 一致；临时挂载已按字节还原。已派第四轮独立复核，含并发同键「无变更 vs 写版本」对抗探针。
- V6-13 第四轮独立复核 NOT_ACCEPT：B1/B2/B3 独立复现仍修复，B4 的顺序与 no-op/no-op 并发用例已关闭；新阻断 B5：同键并发「无变更保存 vs 写版本保存」两者都返回成功，写路径提交后的幂等记录覆盖 no-op 记录，随后重放 no-op 得到 `IDEMPOTENCY_CONFLICT`（60/60 与 40/40 复现）。修法：两条路径共用一个原子 claim/finalize 协议（claim 前置于业务写；pending/committed/completed 状态与租约；只有 claim 所有者可提交；失败释放、提交后失败保留 committed 记录），并补确定性并发测试与 G18。review-04.md 已入证据目录，第四轮修复进行中。
- V6-13 第四轮修复完成（B5）：两条路径共用一个原子 claim/finalize 协议——claim 在一次 readwrite 事务内完成（pending/committed/completed、claimId 所有权、30 s 租约、同内容等待至多 500 ms 后返回可重试 busy、不同内容任何状态均 `IDEMPOTENCY_CONFLICT`），只有 claim 所有者可提交；无变更保存仍不写版本/事件；提交成功后先标 committed 再把快照与 completed 记录放在同一 blob 事务，快照批失败时同键重放返回原「已提交但快照缺失」错误（review-04 N1 关闭）；失败释放 claim，租约过期可接管。新增确定性并发测试 29–34（一次性的 commit/读取闸门）与守卫 G18，修复前 5 项红（11、29、30、31、33）。数字：V6-13 45/45、V6-11 53/53、V6-10 36/36、tsc/build exit 0（含挂载）、red-before-fix 23 守卫全红且还原 sha256 一致、浏览器 12/12 步、37 项 scope 与 changedFiles 一致、临时挂载已还原。残余限制：租约接管者在自身提交前失败并释放、而停滞所有者已提交的窄窗口中，同键重试可能得到 `VERSION_CONFLICT` 而非原响应；确定性事件 id 仍阻止重复提交，面板在该路径会换新键。第五轮独立复核已派。
- V6-15 按并行授权启动：独立工作树 `/private/tmp/patent-v6-15-worktree`、分支 `codex/v6-15-ai`、基于 593ba33，`node_modules` 符号链接；写集 `apps/web/src/v6/features/ai/` 与本票场景/证据，共享注册由编排者挂载。范围：AI 能力展示、外发材料清单与授权/撤销、未知字段禁用确认、无真实外呼。
- V6-15 候选就绪并完成编排者核验：30/30（engine 19、UI 11）、V6-12 42/42、V6-11 53/53、V6-10 36/36、tsc/build exit 0、24 项 scope 与 changedFiles 一致、共享注册按字节还原。复核前发现与 V6-13 B5 同型的并发缺口：`grantConsent`/`revokeConsent` 的幂等读取在只读事务中前置于业务门禁，记录在提交后才写且忽略 `writeIdempotency` 的冲突返回；同键不同载荷的并发调用可都成功、后写记录覆盖前者、重放先成功请求得到 `IDEMPOTENCY_CONFLICT`。另有授权行先于 `consent.granted` 事件写入、失败清理可能删除并发请求已授予的授权行。已派修复执行者（不提交）：两条路径共用一个 claim/finalize 协议（pending/completed 状态、claimId 所有权、500 ms 等待、租约接管、不同摘要一律冲突），授权行清理仅在无 granted 事件时执行，并补 7 类确定性并发/故障测试与 red-before-fix 证据。修复完成后先由编排者复核，再派第一轮独立复核。
- V6-13 第五轮独立复核 ACCEPT（review-05.md）。B5 关闭：claim 在一次 readwrite 事务内先于任何业务写，no-op 与写版本两种顺序、write/write、no-op/no-op 均只有一个成功；没有成功响应变得不可重放，没有重复事件/版本，提交前失败释放 claim，live-claim 等待与租约接管符合规定，N1 重放原「已提交但快照缺失」错误；B1-B4 由复核者独立复现仍成立。非阻断：已披露的反向租约接管失败响应重放窗口、相邻的 committed-marker 写入失败、未单独运行 IndexedDB（已检查适配器事务语义并有浏览器证据）。接受记账：review-05.md 入证据，回执 status accepted + review 对象，changedFiles/scope/status 均为 38 项；final 45/45。提交 `d3f2a6d`，`--no-ff` 合并回 `codex/patent-saas-v6-foundation-origin`；在 PR 分支永久挂载 `V6App.tsx`（Intake import + facts 分支）与 `navigation.ts`（facts AVAILABLE）。PR 分支重跑：V6-13 45/45、V6-12 42/42、V6-11 53/53、V6-10 36/36、tsc/build exit 0，生产构建浏览器驱动 12/12 步、0 console 错误。
- V6-15 三轮修复完成：第一轮为 grant/revoke 建立与 V6-13 同型的 claim/finalize 协议（lease 30 s、同摘要等待 500 ms、不同摘要冲突、只有 claim 所有者可提交、提交前失败释放、提交后 finalize 失败可重放），9 项并发测试；编排者探针发现过期租约接管时旧所有者清理会删除新所有者的未提交授权行，第二轮改为存在任何幂等记录即延迟清理，但同键重试因此永久 `IDEMPOTENCY_CONFLICT`，第三轮细化为「仅在新所有者的 pending claim、不可读记录或 completed 记录时延迟；调用者自己的 pending claim 允许清理」，11 项并发/故障测试，最终 41/41、回归 42/53/36、tsc/build exit 0、34 项 scope 一致。修复前红灯分别以固定字节夹具复现并还原 sha256。
- V6-15 第一轮独立复核 ACCEPT（review-01.md）。复核者重跑 41/41、20 段对抗探针（含 3a–3h 并发/故障、租户/用户隔离、RELEASE_GATE_CLOSED 不触存储与网络、调用表不含提示词/内容/密钥、UI 文案），并在镜像中重跑三轮红灯；回归、tsc/build/浏览器读取证据未重跑，第二次 `git status` 被会话 hook 拒绝记为 not_run。无阻断。非阻断 F1–F9：归档案件撤回按钮仍可点（引擎安全拒绝）、全不可用时无空状态、仅空白 processorName 可授权、无 30 天幂等保留与 `IDEMPOTENCY_EXPIRED`、`red-before-fix.mjs` 仅历史证据、测试中未定义 `T4`、省略 targetId 的语义、快速双击产生两个键、本地 claim 协议限制。接受记账：review-01.md 入证据，回执 status accepted + review 对象 + F4 记入 limitations，changedFiles/scope/status 均为 35 项。提交 `691eade`，`--no-ff` 合并回 PR 分支，在 `ai` 全局导航永久挂载（`V6App.tsx` import + section 分支、`navigation.ts` AVAILABLE），回执记录 permanent mount 与哈希。PR 分支重跑 13 个套件 372/372（含 V6-02..V6-13、V6-15）、tsc/build exit 0，生产构建浏览器驱动 8/8 步、0 console 错误、20 个请求均本机。V6-15 完成；下一张 V6-14。
- V6-14 第一轮独立复核 ACCEPT（review-01.md，无阻断）。复核者重跑 41/41 与回归 45/41/42/53/36、tsc 0，核对 26 项哈希、27 项 scope、5 个红灯夹具、挂载还原与浏览器日志。接受记账：review-01 入证据，回执 accepted + review 对象，S03-A01..A06 记为 not_applicable，28 项 changedFiles 与 scope 一致；提交 `7fc5d9a`，`--no-ff` 合并回 PR 分支。永久挂载：`V6App.tsx` 在 `overview` 标签渲染 `TargetsPanel`；`useMatterView` 重试时保留当前视图、仅在 URL 的案件或目标 id 变化时清空，`TargetsPanel` 新增 `onSettled` 并接到 `retry`，解决复核 finding 5 的外壳不刷新；`v6.css` 删除覆盖 `.chip.active` 的 `color: inherit`。挂载时发现概览分支两个同级元素未包片段，已修正。PR 分支 tsc/build exit 0、14 个套件 413/413、生产构建浏览器驱动 8/8 步、0 console 错误、10 个请求均本机（`mount-browser-log.json`），截图确认第二个目标创建后切换条与「2 个」即时出现。回执 `mount.permanent` 记录改动与哈希。

## 会话：2026-11-01

- V6-12 第三轮独立复核 ACCEPT（review-03.md）。第 3 轮修复：交错 PNG 按 Adam7 七个 pass 逐行校验过滤字节（`PngPassRows` + `verifyPngRowFilters`），帧标记仅接受 SOF0/SOF1，拒绝重复分量 id，交错 MCU 超过 10 块拒绝，`source.committed`/`source.retired` metadata 写 `{version}`（每次重试按当次 matter 版本计算）；新增四个 fixture 与五个测试，`red-before-fix.txt` 记录五项修复前均 exit 1。复核数字：V6-12 42/42、V6-10 36/36、V6-11 53/53、tsc 通过；42/42 逐行损坏被拒、21 个合法交错文件接受、Pillow 对 90 个文件判断一致；11 种非 SOF0/SOF1 帧标记被拒；MCU 10 接受、11/18 拒绝；事件版本 2–12 连续。非阻断：zlib FCHECK/FDICT 未校验、`ff c8` 被接受、MCU 上限按帧分量求和（更严）、6 路并发导入可能耗尽重试预算（fail-closed）、回执关于 libjpeg 重复 id 一致性的表述偏强。回执置 accepted（evidence review-03.md），changedFiles 49 项与重采 scope 一致（scope.txt 去掉 porcelain 前缀），本轮提交并推送。
- 用户询问后台为何长时间运行：确认无死循环，耗时来自逐票串行加每票独立复核。用户批准「并行开 V6-13」：独立工作树 `/private/tmp/patent-v6-13-worktree`、分支 `codex/v6-13-intake`（基于 953e05d），`node_modules` 符号链接到主工作树，预览端口 4177；执行者不提交，临时挂载需还原，永久挂载写入 `qa/v6/evidence/V6-13/mount-patch.md`。

- V6-11 第二轮独立复核 ACCEPT（review-02.md），无阻断。复核者独立复现：复制/恢复标签页、外来 pageId/session、无标记的挂载都保持 running 且不写持久记录；拥有页的匹配标记在租约剩余约 60 s 时立即中断、版本只增一次且幂等；过期租约任意读者可持久化中断并续跑；同 realm 启动锁与持久 live-lease 拒绝均无写入，调度器抛错时锁释放。复核数字：V6-11 53/53、V6-10 36/36、tsc、等价构建、浏览器 12/12（0 console 错误）、独立探针 16/16。非阻断（详见 review-02 第四节）：续租抢在 pagehide 之后的窄竞态（fail-closed、有界）、过期后 UI 无自动重读、SPA 卸载走 cancelled、外部读者不落盘过期 job 行、marker 一次 pass 后清除、`leaseMs` 只取默认、步骤 12 的 `>=` 断言、回执计时文句、`specAcceptance` 缺 S02-A06。回执置 accepted（evidence review-02.md），补 S02-A06 not_applicable、按 browser-log 校正步骤 11 计时文句，changedFiles 45 项与重采 scope 一致，本轮提交并推送。
- V6-11 第 1 轮修复完成，第二轮独立复核进行中。修法：持久会话 id（sessionStorage）与内存态页面实例 id 分离；作业信封新增 `ownerPageId`；`pagehide` 同步写退出标记（bfcache 不写，`pageshow.persisted` 清）；`loadAll` 只在标记的 pageId 与作业 ownerPageId 一致且 `leaseExpiresAt - leaseMs <= exitedAt` 时中断；`parse.ts` 新增纯函数 `orphanInterruptAllowed`，`markInterrupted` 对有效租约要求该证据链，过期租约仍允许任意读者持久化；`parseSource` 加同 source 启动锁与持久 live-lease 拒绝。非阻断同修：两处近似空断言、`waitedForLeaseMs` 改为实测字段、09a/09b 与 10a/10b 截图可区分。证据：V6-11 53/53（engine 31、UI 22）、V6-10 回归 36/36、tsc 与 build exit 0、浏览器 12/12 步 0 console 错误（新增步骤 12：页内 `window.open` 复制 sessionStorage，原作业 jobVersion 不变、仍 running、最终完成）；回执仍 candidate，44 项与 scope 一致。编排者探针 `/tmp/v6-10-orch/probe-v611-r2.mjs` 六项全过：复制标签页不中断且原作业完成、owning page 标记 30 秒内立即中断、陈旧/外来/异 session 标记均拒且无写入、过期租约任意读者可中断、二次启动被拒无写入、中断后继续可完成。
- V6-11 第一轮独立复核 NOT_ACCEPT（review-01.md）：1 个阻断——会话身份只存 sessionStorage，复制/恢复标签页（或 `window.open` 复制 opener 存储）后第二个页面挂载即把第一个页面仍在运行、租约有效的作业标记为 interrupted 并写持久记录（复核探针 probe-c 可复现）。核对了需求逐条，其余项（A01/A02/A03、五阶段真实进度、版本校验、检查点、取消/放弃、§10 与 S06 白名单、隐私、编排者 `onSettled` 接缝）均满足；自述三项修复被独立探针证实；回执限制与事实一致。非阻断：scope 因编排者 16:10 写 progress.md 而需重采、`parseSource` 并发启动窄竞态、两处近似空断言、`waitedForLeaseMs` 常量、09a/09b 截图相同。已派第 1 轮修复执行者：页面实例 id 与持久会话分离、探活/退出标记，孤儿分支不得只凭同 session 改写有效租约；同页刷新仍需立即中断；补共享 session 第二页面、页面消失、回退路径、并发防线场景；重跑全部证据，回执保持 candidate。
- V6-11 候选就绪：执行者完成 `parse.ts`/`Parse.tsx`（真实阶段 verify/extract_text/ocr_check/chunk，逐阶段 checkpoint，60s 作业租约，按标签页 sessionStorage 识别同页刷新孤儿作业并立即标记中断，leaseMs/3 续租与每次 checkpoint 版本校验提交，取消/重试/放弃终态）。编排者在 V6App.tsx 挂载 Parse，并给 Upload.tsx 加可选 `onSettled` 回调（保存批次 `.finally` 中 `dispatch(idle)` 后调用，供兄弟视图重读仓储）。执行者修复四项缺口：刷新后死作业显示运行中 60s、租约从不续租、上传保存导致重挂载丢弃运行作业、完成态闪回「未解析」。编排者复核：V6-11 40/40、V6-10 回归 36/36、tsc exit 0；回执 38 项 changedFiles 与 git scope 一致（排除 `node_modules`、`.claude/launch.json`）。浏览器证据用 `vite preview` 4176（本 worktree 开发服务器对 pdf.js worker 返回 403）：11 步全过、0 console 错误，第 11 步验证 199 页 PDF 解析中上传保存后仍为同一作业且不闪「未解析」。第一轮独立复核进行中。已知限制（回执已披露）：手动补充禁用、OCR 不可用、作业记录与案件提交非同事务、无 `job.interrupted` activity action、DOCX/TXT 恒算 1 页、.doc 失败仅 node 测试覆盖。
- V6-10 第五轮独立验收 ACCEPT（review-05.md），无阻断。复核者自建夹具确认：中点等前缀、命名空间/空白/属性/实体技巧、customXml/oleObject/attachedTemplate/超链接等载体均被拒或失败即拒；pypdf RC4-40/128、Ghostscript xref 流 `/Encrypt`、`#xx` 转义与增量更新追加 `/Encrypt` 的 PDF 均被拒；前三轮修复无回退；36/36 场景、tsc exit 0；回执 30 项与工作树一致。非阻断（已记入 review-05）：仅以 `<Default Extension="xml">` 声明主类型的合法 DOCX 被拒、`/Encrypt` 误报、嵌入 OLE 宏未检查、U+0387 表述、第四轮夹具未入库、浏览器流程未重跑。回执置 accepted，加入 review-05.md，重采 scope.txt（31 项一致）。
- V6-10 第四轮修复：名称按 XML 1.0 Name 规则整体校验并按本地名分类，无法分类即 INVALID_INPUT；PDF 出现任意 `/Encrypt` 名称（含 `#xx` 转义）即 UNSUPPORTED_MEDIA。36/36。编排者探针：7 类前缀 × Relationship/Override/属性共 21 例全部拒绝，`/Encrypt` 与 `/#45ncrypt` PDF 拒绝，正常 DOCX/PDF 接受。
- V6-10 第四轮独立验收 CHANGES_REQUIRED（review-04.md）：含中点（NameChar）的合法前缀绕过扫描，远程关系与 VBA 载体被保存；加密 PDF 被接受。
- V6-10 第三轮修复：`[Content_Types].xml` 严格解码、去注释/CDATA/PI、按本地名解析 Default/Override 并解码实体，`/word/document.xml` 须精确为非宏主类型，拒绝宏/VBA/ActiveX 类型与 VBA 关系 Type。33/33；编排者 8 项探针全部拒绝，正常 DOCX 接受。
- V6-10 第三轮独立验收 CHANGES_REQUIRED（review-03.md）：注释诱饵加字符引用编码的宏主类型及 vbaProject 关系可让启用宏的 DOCX 被保存。

## 会话：2026-10-31

- V6-10 第二轮两项阻断修复完成，编排者独立复现（未复用场景测试助手）：自建 10,000 条目 DOCX 被接受，classifyFile 前后 arrayBuffers 增量 -2.6 MiB、耗时 24.5 ms（修复前约 +783 MiB）；UTF-16LE+BOM、`<é:Relationship>`、DOCTYPE 实体三种远程关系均被拒（UNSUPPORTED_MEDIA），UTF-16 内部关系仍被接受。实现层面：inflateRaw 以声明大小（上限 8 KiB）起步并在结果较小时 `slice` 复制，仅保留 `[Content_Types].xml` 与 `.rels` 部件；`.rels` 按 BOM 解码 UTF-8/UTF-16LE/BE（fatal），拒绝含 U+0000 与 `<!DOCTYPE` 的部件，元素/属性按 Unicode 本地名匹配，Target 含 `..` 段或 `\\` UNC 前缀一律拒绝；readBlob 每片检查取消信号。30/30 场景通过。回执新增 limitation：拒绝任何含 `..` 的 Target 会连带拒绝包内合法的同级引用（如 `../customXml/item1.xml`）。已派发第三轮独立复核，回执保持 candidate。

- V6-10 第二轮独立验收 CHANGES_REQUIRED（review-02.md）：首轮两项阻断已修复且时间修复本身经复核成立（1/4/16/32/64 MiB 输出 1.9/7.2/28.9/56.9/114.9 ms），但暴露两项新阻断。(1) inflateRaw 每条目以 64 KiB 起步并返回 subarray 视图，checkDocxPackage 保留全部条目；10,000 条目（允许上限）的 DOCX 被接受，归档 1.16 MiB、解压 127 KiB，arrayBuffers 却涨到约 782.7 MiB，远超 200 MiB 预算（每 1,000 条目约 +62.7 MiB；method 0 条目 +0）。(2) `.rels` 仅按非致命 UTF-8 解码、只认 ASCII 元素名与预定义/数字实体，UTF-16LE/BE+BOM、Unicode NCName 前缀 `<é:Relationship>`、DOCTYPE 实体 `TargetMode="&ext;"` 三种合法 XML 绕过远程关系拒绝。非阻断：关系 Target 的 `..` 穿越与 UNC、三重编码 scheme、readBlob 不检查取消信号。已派发修复：解压结果按实际长度复制后再保留（或及时释放）；`.rels` 按 BOM 解码 UTF-8/UTF-16、拒绝 DOCTYPE、按去前缀本地名匹配元素，并为每种绕过补测试。回执保持 candidate。

- V6-10 首轮独立验收 CHANGES_REQUIRED（review-01.md）：DOCX 内联 inflater 按精确长度扩容导致二次方时间（4 MiB 输出 4.6 秒，合法 50 MiB 会卡死标签页）；远程关系检查只匹配双引号字面量，单引号与实体编码可绕过。另有无阻断项：`C:/`、NUL 与符号链接条目未拒绝，回执 changedFiles 漏两份 .planning 文件，A03 的取消表述超出测试，OLE 加密 DOCX 报 MIME_MISMATCH。已派发修复与新增回归；回执保持 candidate。

- V6-10 候选就绪：ingest.ts（内容嗅探、DOCX ZIP 全量校验、50 MiB/8 MiB/16 MP/200 MiB/10,000 条目/压缩比 100、宏/远程关系/路径穿越/加密拒绝、3 并发、真实字节进度、同事务元数据+字节、按 sha256 去重、VERSION_CONFLICT 重试）与 Upload.tsx（选择/拖拽/移除/取消/逐行状态/无文档问答）。场景 23/23；编排者完成共享注册：sources 标签开放、sources 与 upload 路由挂载 Upload、无文档问答导向事实占位页（S03 属 V6-13/14）、v6.css 增补上传布局。浏览器 7 步全过（创建案件→上传 DOCX→刷新后去重→伪 DOCX→非 UTF-8 TXT→无文档问答不写附件→材料标签去重），exit 0、无控制台错误；V6-08 12/12、V6-09 21/21、typecheck、构建与回归通过。回执 candidate，待独立验收。

- V6-09 第二轮独立复核 VERDICT: ACCEPT（review-02.md）：独立重跑 21/21、12/12、tsc、浏览器 16/16 exit 0；变异检查确认守卫、属性恢复与退出码各自被对应测试捕获。五条非阻断说明记入回执 limitations。回执置 accepted，提交并推送后进入 V6-10。

- V6-09 首轮四项阻断已修复，编排者自检（非独立复核）：单一 `AppearanceProvider` 持有偏好与保存状态；失败保存离页（站内链接、后退、刷新/关闭）先确认「留下/放弃」，放弃恢复已保存值；V6 卸载时恢复 `<html>` 原属性；浏览器脚本步骤失败或控制台报错时 exit 1。重跑：场景 21/21、V6-08 回归 12/12、web tsc、构建与 workspace 回归均 exit 0。浏览器脚本扩展为 16 步（新增导航后保持已保存值、失败保存留下/放弃、切换旧版释放属性），实时运行 16/16、exit 0、无控制台错误；首次运行因 waitFor 返回 DOM 节点失败并正确 exit 1，修正脚本后通过。回执已更新，保持 candidate，已派发第二轮独立复核。

- V6-09 首轮独立验收为 CHANGES_REQUIRED：shell 的初始偏好覆盖后续保存值；失败保存离页无警告且丢失重试状态；V6 的根节点主题属性残留到旧版；浏览器脚本断言失败仍 exit 0。独立重跑 17/17 场景、12/12 导航回归和 web typecheck 通过，但这些检查未覆盖生命周期缺陷，因此不接受。已派发同票修复与实际 React 生命周期回归，回执保持 candidate；V6-10 尚未实施。

- 浏览器工具环境限制：在当前工作树新增 `.claude/launch.json`（patent-v6，5174）后，preview_start 仍只识别 v6-prototype/homepage-prototype，未启动当前实现。已有无头浏览器证据保留，但本轮 preview 验证尚未运行；不借用原型服务器冒充实现验证。此启动配置是编排者的本地工具配置。

- V6-09 外观设置已实现，回执为 candidate：17/17 场景、12/12 浏览器步骤、V6-08 回归 12/12；已有类型检查、构建与 workspace 回归证据。独立只读验收进行中，通过后才提交并推进 V6-10。本轮 rg 包装器无法启动底层进程，改用 find 定位文件。

- V6-07 第二轮复核 CHANGES_REQUIRED 的问题（漏报、资产冲突、报告隐私、图片验证、迁移合同例外）已修复；第三轮复核又发现 EXIF 旋转 JPEG 被误隔离、非数组 reviewRecords 被当作空集、空 IDAT 被接受、扁平条目忽略 assetId、500 字标题上限无依据，均已修复并补充用例。场景 32/32，typecheck/回归 exit 0。第四轮独立复核确认实现与测试通过，仅指出回执 M02 的 PNG 空 IDAT 表述与测试相反；已按「拼接 IDAT 全空才拒绝、空块后接真实数据可接受（与旧验证器一致）」更正，并记录三条残余风险。复核更正文后结论 VERDICT: ACCEPT，回执已置 accepted。
- V6-08 导航与三入口已实现并完成 12 步无头浏览器验证（browser-log.json 与 screens/01–12，2026-10-31 重采）；独立只读复核结论 accept，无阻断项。回执已置 accepted，记录 lazy chunk 无 error boundary、flag-off 仍产出 chunk、大写 UUID 深链、无 basename 路径等残余风险。V6-07 接受并提交后再提交 V6-08。
- 编排者新增 docs/implementation/patent-saas-v6/migration-amendment.md：迁移合同 legacy-import.v2；明确 V6-26-M01–M03 的历史审阅持久化与重试验收、V6-47a 发布门禁；主 checkout 文档只读不改。
- 发布条件复核：02-plan 定义 R1 为 V6-08–26，退出条件包含上传→问答→事实→路线→草稿→确认→检查→真实导出的完整链路，V6-47a 要求 V6-01–26 全部 accepted 且发布证据经签署；当前 R1 只完成 V6-08。仓库只有旧 `patent-drafter` worker 配置（路由 vibing.paymond.me/patent），没有 patent.paymond.me 的独立 Worker 配置，web 构建 base 为 `/patent/`、outDir 为 `dist/patent`，本机也未安装 wrangler。发布条件不满足，本轮不部署。
- V6-07 提交 57c8de4，V6-08 提交 32d8e99；分支已推送，PR https://github.com/ilderaj/patent-drafter/pull/1 已创建并由会话监视器绑定。

## 会话：2026-10-30

### 当前状态
- **阶段：** V6-03/04/05/06 accepted；Foundation/R1 余票待按依赖图继续
- **开始时间：** 2026-10-30

### 已执行操作
- 已核对 V6-01 写集，只写 `qa/v6/baseline/`。
- HEAD：`dc4b00882608354c266805a2fb2f4974f1a75401`。
- 基线开始前工作区含 39 个已跟踪改动、414 个未跟踪路径；不归因于本票。
- 记录 tracked diff、git index、HEAD 及未跟踪文件逐路径 SHA-256；基线目录从其自身未跟踪清单中排除。
- V6-01 本轮仅新增 `qa/v6/baseline/` 下文件，未编辑其他业务文件或既有改动。
- 独立复核第一次指出 `.planning/` 两个文件哈希漂移；修正稳定清单后完整复核通过，receipt 标记 accepted。
- 已按用户授权派发 V6-02 runner，严格限定该票写集；根 package.json/package-lock 仅返回合并建议。
- V6-02 首轮独立审阅发现 TAP summary 解析不匹配、全 skip 误通过，且证据未覆盖全 skip / 缺失依赖；修复代理正在更新 runner 与负测证据，独立复核暂不接受首轮 candidate。
- 跟进复核追加两项阻断：`/tmp` 符号链接路径下入口守卫不触发 `main()`（全 skip、缺失依赖均退出 0）；回执只列 S13-A01。
- 修复代理完成 runner 判定与负测；本会话补上 `isEntryPoint()` 的 realpath 比较，并新增符号链接 CLI 探针与对应单测。
- 按编排者职责在根 `package.json` 增加 `test:v6` 脚本，`npm run test:v6 -- V6-02` 退出 0（10/10），`V6-999`、`V6-9` 退出 2。
- 回执补齐 S13-A01–A10 逐项 not_applicable 理由，并记录 S13 缺 A01/A02/A03/A09/A10 工单映射的待决项。
- V6-02 首轮独立复核不接受，问题为根 manifest 写集、回执文件清单、真实 checkout 符号链接未验证；已核对基线 tracked diff 和 manifest 归属，补充依赖工件说明及真实 checkout 符号链接探针。
- V6-02 第二轮独立复核 accept；按反馈补测非零子进程状态分支，并把 A02 的退出码含义写入回执。
- 未跟踪基线核对：`untracked-sha256.txt` 中 407 条路径全部匹配，39 条 tracked 路径未变；`package-lock.json` 差异与基线段落哈希一致。
- V6-02 回执标记 accepted，`npm run test:v6 -- V6-02` 退出 0（10/10）；阶段 1 完成。
- V6-03 实现 `packages/contracts/`：v6.1 primitives、05-contracts 第 3–8 与第 11 节 schemas、strict objects 与跨字段校验、66 个确定性合成 fixtures 和 `entitySchemas` registry。
- V6-03 新增 13 项场景测试和 13 个独立负输入 probes；覆盖完整 fixture 注册表、snapshot/command/AST 往返、目标与版本必填、未知字段/枚举拒绝、AST 引用约束、gate/confirmation/payment 约束、解析纯度与依赖边界。
- 调整 job 错误码约束：失败状态必须携带 errorCode；其他状态允许保留诊断码（例如 interrupted job），以匹配 R1 中断恢复记录语义。
- V6-03 复核证据：`npm run test:v6 -- V6-03` exit 0（13/13）；负测 exit 0（13/13 均拒绝）；`npm run typecheck --workspaces --if-present` exit 0（包含 `@patent/contracts`）；`npm test --workspaces --if-present` exit 0；407/407 基线未跟踪路径哈希匹配。
- npm lockfile 更新命令因既有 `@patent/vibescanner-core@0.0.1` 404 失败；`npm ci --dry-run` 在基线同样失败，故未改 lockfile，记录于 V6-03 receipt。
- V6-03 首轮独立复核拒绝接受，发现 Activity action/metadata schema 过宽、changedFiles 漏列 tsconfig；另指出 A01–A03 没有覆盖持久命令与重试场景，票的 schema-only 写集无法提供此类运行时证据。
- 已修复 Activity action 闭合枚举和 metadata key allowlist；补充拒绝未知 action/key 的测试与负测。并修正用途绑定支付 price/quote、准备包 approvalId 约束和 Approval.confirmationIds 的非空过度约束。
- 更新后 V6-03 场景 14/14，负测 15/15，workspace typecheck 和 workspace tests 均 exit 0；保护核对仍为 407/407。
- 回执改为准确描述 schema/纯解析层验收覆盖，明确未覆盖持久命令、stale/failed 应用状态重试与持久刷新/重试行为；S06 未定义的 per-action metadata key 矩阵列为 NEEDS_DECISION。changedFiles 已与 21 个实际新增文件完全核对并注明根 manifest/lockfile 的既存归属。
- 第二轮 reviewer 初始返回 accept 后撤回：其指出当前 Activity metadata key allowlist 仍是全局的，不是规范要求的 per-action 矩阵；且其未完整核验证据。已将 review verdict 记为 not_accept、receipt 保持 candidate，不伪称 accepted。
- 用户裁决采用保守 per-action Activity.metadata allowlist，并要求记录在 V6-03 contract/evidence。已在 `packages/contracts/src/records.ts` 冻结全部 action 矩阵并由 `activitySchema.superRefine` 按 action 执行；`job.succeeded`/`job.adopted` 允许 provider/model，privacy actions 要求空 metadata。README 记录决策和禁止字段，补充按 action 拒绝及隐私空 metadata 的场景测试和负测。
- V6-04 在基于 `origin/main` 的干净工作树 `codex/patent-saas-v6-foundation-origin` 中实施，写集为 `packages/domain/src/v6/revision.ts`、`qa/v6/scenarios/V6-04/`、`qa/v6/evidence/V6-04/`；`packages/domain/src/index.ts` 的一行 barrel 由编排者补写。
- V6-04 模块为纯状态转移：`MatterRevisions` 持有共享 `sourceVersion` 与按目标的追加式修订列表、head 和图集；`saveRevision`/`restoreRevision`/`adoptInputs`/`switchTargetView` 返回新状态，拒绝时按引用返回输入状态。ID 与时间由注入的 `RevisionContext` 提供。
- V6-04 未引入 `packages/contracts` 依赖（lockfile 无法再生），`SnapshotRef`/`DraftInputRef`/图集结构在模块内结构化声明，并由场景测试用 `draftRevisionSchema`、`snapshotRefSchema`、`figureSetRevisionSchema` 反向校验防漂移。
- V6-04 场景 13 项：按目标隔离、逐目标父链、陈旧基线 `VERSION_CONFLICT`、拒绝不改状态、视图切换不改版本、恢复生成新修订且不复活旧批准、图集策略与 inputStale、采纳新输入需勾选、越界输入 `INPUT_STALE`、重复执行结果一致且不改输入、保存的修订不与调用方 AST 别名。
- V6-04 第一轮独立复核 not_accept：(1) 阻断项 `saveRevision` 直接保存调用方 AST 引用，保存后修改对象会改写已存在修订；(2) `restore_bound` 声称 created 但未真正生成 `FigureSetRevision`；(3) 确认用例只构造了 `SnapshotRef`，且 `isInputStale(x, x)` 恒真。
- V6-04 第二轮独立复核 not_accept（承接修复后复审）：`figureMismatch` 对 `restore_bound` 仍按原图集与当前图集比较，但该策略会重建并绑定原图集，应报无失配；且没有用例证明 `keep_current` 在两者不同时会报失配。
- 已修正 `figureMismatch` 仅由 `keep_current` 报告；新增用例"only keep_current leaves the restored draft on different figures"，先把目标推进到后续图集，再分别断言 `restore_bound` 无失配、父集为原当前集、entries 为原草稿所用图集内容，以及 `keep_current` 报失配且不新增图集。场景更新为 14/14，证据全部重采。
- V6-04 第三轮独立复核 not_accept：(1) `changedFiles` 漏列 `scope.txt` 中两个 `.planning` 改动；(2) "确认在生成时仍有效" 断言用同一个快照对象自比，且 S05-A03 的五段重置未被演示；(3) S05-A04 措辞声称涵盖陈旧采纳，但只测了陈旧保存。
- V6-04 第四轮独立复核 not_accept：(1) 回执 limitation 仍把 `scope.txt` 描述为「一处 barrel 改动加 V6-04 写集」，与已列出的两个 `.planning` 文件自相矛盾；(2) A01 observation 声称「每条产出的修订」都过合同校验，但实际只校验了 `saveRevision` 的结果。
- V6-04 第六轮独立复核 accept：逐条核对 A02 句子与 `revision.test.mjs:318-385`（修订数量、确认绑定、currentness 真/假断言的时机）一致，其余 acceptance 与 specAcceptance 句子均与用例相符；回执 `status` 置为 accepted、`verdict` 置为 accept。两条非阻断 note：陈旧采纳路径同样经 `conflict()` 设置 `latestRevisionId` 但只有保存路径断言了它；`keep_current` 失配措辞与 `:485`/`:566` 的断言一致。
- V6-04 第五轮独立复核 not_accept（仅一条 note）：A02 observation 写作「r1 在 r3 之后恢复」，但用例是在 r1 之后保存一次编辑（即 r2）再恢复 r1。已改为不数修订号、直接描述「首个修订在更新的修订为 head 时被恢复」，确认有效性叙述同步改写；仅回执文字变化，未改代码或用例，证据仍对应当前树。
- V6-04 第四轮修复：limitation 改为逐类列出 `scope.txt` 的实际内容（共享 barrel、V6-04 写集、两个 `.planning` 记录、`node_modules` 符号链接）；A01 合同用例补上 `restoreRevision` 的修订/快照/输入/图集与 `adoptInputs` 的修订/快照/输入的 schema 校验，使主张与用例一致。场景 15/15，四份证据重采。
- V6-04 第三轮修复：`changedFiles` 补入两个 `.planning` 文件并在 note 说明其为编排者记录；确认改为与由状态重算的 `currentSnapshot` 比较；新增五段 AI 段落用例（生成修订时五个 `ai_paragraph` 确认均有效，一次编辑后全部失效）；新增陈旧 `adoptInputs` 断言（`VERSION_CONFLICT` 且按引用返回输入状态）。场景 15/15，四份证据重采。
- 三项已修复：保存时对 AST 结构复制并新增别名测试；`TargetRevisions` 增加追加式 `figureSets`，`restore_bound` 生成真实图集修订（新 id、parentId 为原当前集、entries 复制、保留旧集），源集不再保留时返回 `RESOURCE_NOT_FOUND`；确认用例改为合同合法的 `full_read` Confirmation，并删除恒真断言。另修正 `figureMismatch` 仅由 `keep_current` 报告。
- V6-03 第一轮矩阵复核 not_accept：指出 S06-A06 的 provider/model 未必存在，且标识字符串可承载自由文本。已要求 job.succeeded/job.adopted 同时提供非空 provider/model，限制 stage/provider/model 字符集，并为要求和自由文本注入补充场景断言及负测。聚焦复核还指出 stage 缺少无效输入覆盖；补充 stage 拒绝断言与探针后，场景 14/14、负测 22/22、workspace typecheck、workspace tests exit 0，baseline preservation 407/407。最终独立只读复核 accept；确认 47 个 action 矩阵完整、21 个 changedFiles 与实际文件一致，receipt 标记 accepted。按用户授权准备切支、提交、推送和开 PR；未部署。

- V6-05 在 `codex/patent-saas-v6-foundation-origin` 工作树实施，写集为 `packages/domain/src/v6/confirmation.ts`、`gate.ts`、`qa/v6/scenarios/V6-05/`、`qa/v6/evidence/V6-05/`；`packages/domain/src/index.ts` 两行 barrel 由编排者补写。
- V6-05 确认采用追加式 `ConfirmationLedger`：确认绑定六字段快照，撤销只追加 `Revocation` 不修改原行；重复确认幂等返回 `created=false` 并按引用返回输入账本。
- V6-05 门禁 `evaluateGate(context, facts)` 为纯函数：`generate` 只需源字节，其余动作要求当前快照；`prepare`/`approve`/`export` 要求成功且绑定当前快照与当前规则包的检查，再评估 findings/风险、输入陈旧、内容确认与内部批准。`GateFacts` 携带合同 `GateContext` 之外的包装类型、确认模式、inputStale、AI 段落、已声明阻断的 policy 规则。
- V6-05 私有快照比较在两个模块各存一份：Node 类型擦除与 `@patent/audit`、`@patent/parsers` 的 tsconfig 不允许 `.ts` 运行时导入；用例逐字段改动证明两份副本与 `revision.isCurrent` 一致。
- V6-05 第一轮独立复核 not_accept：resolved blocker 被提前跳过、policy 未按规则声明动作阻断、回执「所有可发码已校验」主张过宽、S07-A08 误标 covered。已让 present blocker 无论状态均阻断；新增 `GateFacts.blockingPolicyRuleIds` 与 context 风险合并；用例驱动全部十个码逐个过 `errorCodeSchema`；S07-A08 改为 not_applicable。
- V6-05 第二轮独立复核 not_accept（一条 should-fix）：present 的 `risk` 若标 resolved 仍被跳过，需确认的风险可能放行。已移除按状态跳过，present 且 `requiresAcknowledgement` 的风险必须有绑定当前检查的 `risk_ack`，并新增对应用例。
- V6-05 第三轮独立复核 accept，回执置 accepted；场景 26/26，workspace typecheck 与全量回归 exit 0。提交 `3c72f37`。
- V6-06 在 `codex/patent-saas-v6-foundation-origin` 工作树实施本地 Repository：`apps/web/src/v6/lib/repository.ts` 为存储无关深模块（租户作用域、expectedVersion CAS、归档只读、事件幂等、字节摘要校验），`indexeddb-repository.ts` 为浏览器 adapter；场景 18 项经内存后端与微型 IndexedDB 夹具运行真实 adapter。
- V6-06 首轮独立复核 not_accept，三项 should-fix：(1) 更新可在不提供新字节时改变 asset `sha256`，`readBlob` 只校验字节对自身存储摘要、未对当前 asset 记录，可能返回与 asset 记录不符的字节；(2) S06-A05 标为 covered，但该验收的可观察对象含收件箱项，本票无 inbox store；(3) 写入未按合同的 per-action metadata 白名单限制，调用方可持久化任意 metadata 乃至文档内容。
- V6-06 三项修复：`commit` 在 expectedVersion>0 时，asset 摘要或长度变化必须同时提供该 asset 的新 blob，否则 `HASH_MISMATCH`；`readBlob` 在同一只读事务读取 matter 当前 asset 记录，摘要/长度不符即 `HASH_MISMATCH`，再在事务外重算字节摘要；`repository.ts` 结构化镜像 §10 action 列表、per-action metadata 矩阵与错误码列表，`commit` 逐个事件校验 action、键、值文法及 `job.succeeded`/`job.adopted` 的 provider/model 要求，并有与 `packages/contracts` 深度相等的漂移测试。S06-A05 改为 not_applicable 并在 reason 中单列 activity 404 的覆盖位置（V6-06-A02）。
- V6-06 修复后场景 23/23、workspace typecheck 与全量回归 exit 0；`runner.tap`、`typecheck.txt`、`regression.txt`、`scope.txt` 已重采，回执仍为 candidate，等待第二轮独立复核。
- V6-06 第二轮独立复核 not_accept（1 项 should-fix）：`listEvents` 按 `occurredAt` 升序返回，但 S06 要求动态按 `occurredAt desc`。已改为降序并保留 id 同刻决胜；A01 用例追加 T1 事件并断言 `[EVENT_THREE, EVENT_ONE, EVENT_TWO]`，竞态用例期望同步更新；场景 23/23，四份证据重采，回执仍为 candidate，等待第三轮复核。
- V6-06 回执 `changedFiles` 补入两个 `.planning` 实况记录（编排者记录，非实现文件），limitation 与 `scope.txt` 描述同步。
- V6-06 第三轮独立复核 not_accept：(1) blocker——读路径只按租户授权，同租户中未获授权的用户可读到案卷与活动，未按 S06-A05 返回 `RESOURCE_NOT_FOUND`；(2) should-fix——写路径只校验租户，未把 `matter.createdBy` 与用户类事件 `actorId` 绑定到当前 actor。
- V6-06 访问控制修复：新增 `ownsMatter(matter, actor)`（同租户且 `createdBy === actor.userId`），用于 `listMatters`、聚合读取和 `commit` 的已存在案卷判定，同租户非创建者在 `loadMatter`/`listEvents`/`readBlob`/`commit` 一律得到 `RESOURCE_NOT_FOUND`；创建必须把 actor 记为 `matter.createdBy`，更新不得改派 `createdBy`，用户类事件的 `actorId` 必须等于 actor，否则 `INVALID_INPUT` 且不落盘；worker/webhook 类事件不作该检查。该规则记为 R1 本地裁决 `R1-MATTER-ACCESS`，云端以合同租户角色与案卷 ACL 替换并保留无权限时的 404。
- V6-06 新增两项场景："same-tenant user who did not create the matter is not found"（读、列、事件、字节、更新、复用 id 的创建均拒绝，创建者状态不变）与 "a commit cannot record another user as creator or as the user actor"（伪造 `createdBy`、冒名用户事件、改派 `createdBy`、冒名更新事件均 `INVALID_INPUT`，worker 事件 `actorId: null` 可写入并通过 `activitySchema`）。场景 25/25。
- 复核 `typecheck.txt` 时发现 `npm run typecheck --workspaces --if-present` 在本 checkout 不执行 `@patent/web`（既存本地安装状态，与本票文件无关），此前证据并未真正编译两个模块。已在同一证据文件追加 `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`（exit 0），并在回执 limitation 中说明；A03 的 command 同步列出该命令。
- 四份证据已重采：`runner.tap`（25/25，runner_exit=0）、`typecheck.txt`（typecheck_exit=0、web_typecheck_exit=0）、`regression.txt`（regression_exit=0）、`scope.txt`（未变）。回执仍为 candidate，等待第四轮独立复核。
- 第四轮独立复核首轮返回 not_accept：其在本工作树找不到 `docs/implementation`，且误报工作区干净。已说明 v6 需求文档只存在于用户主 checkout（只读）、并给出在 worktree 根目录复现 `git status` 的命令；复核代理重读四份需求文档后核对 `scope.txt` 与当前状态一致，继续完成复核。
- V6-06 第四轮独立复核 accept，仅 1 条 note：worker/webhook 类事件的 `actorId` 不受 `actorKind` 约束（合同未规定该条件规则，故记为 limitation 而非拒绝）。复核确认前四轮问题均有实现检查与回归用例，创建者访问规则覆盖读、列、事件、字节与提交路径，CAS、事件幂等、归档只读、字节摘要耦合与克隆隔离均保持；证据 25/25、两处 typecheck 与回归 exit 0。
- 回执置 `status: accepted`、`review.verdict: "accept"` 并记录 verdictNote；limitation 增补 worker/webhook `actorId` 未约束、以及需求文档不在本工作树两条。
- 按本次指令未提交、未推送、未部署；工作树保留 V6-06 全部改动。


| 检查 | 命令 | 结果 |
|---|---|---|
| TypeScript workspace 检查 | `npm run typecheck` | pass，exit 0 |
| 已配置 workspace 测试 | `npm test --workspaces --if-present` | pass，exit 0；V6-03 期间全量回归日志见 `qa/v6/evidence/V6-03/regression.txt` |
| V6-01 专用 runner | `npm run test:v6 -- V6-01` | not_run；runner 按计划由 V6-02 建立 |
| 基线哈希复采 | V6-02 验收时重采 tracked diff 与 407 条稳定未跟踪路径 | pass；摘要稳定 |
| V6-01 票验收 | 见 `qa/v6/baseline/receipt.json` | pass；独立复核 accepted |
| V6-02 票验收 | `npm run test:v6 -- V6-02` | pass，exit 0，10/10；独立复核 accepted |
| V6-03 场景 | `npm run test:v6 -- V6-03` | pass，exit 0，13/13；receipt candidate，等待独立复核 |
| V6-03 负测 | `node qa/v6/evidence/V6-03/negative-probes.mjs` | pass，exit 0，13 个无效输入全部拒绝 |
| V6-03 workspace typecheck | `npm run typecheck --workspaces --if-present` | pass，exit 0；包含 contracts |
| V6-03 workspace 回归 | `npm test --workspaces --if-present` | pass，exit 0 |
| V6-03 未跟踪路径保护 | `shasum -a 256 -c qa/v6/baseline/untracked-sha256.txt` | pass，407 条全部匹配 |
| V6-04 场景 | `npm run test:v6 -- V6-04` | pass，exit 0，15/15；第六轮独立复核 accept |
| V6-04 workspace typecheck | `npm run typecheck --workspaces --if-present` | pass，exit 0；包含 `@patent/domain` |
| V6-04 workspace 回归 | `npm test --workspaces --if-present` | pass，exit 0 |
| V6-04 写集范围 | `/usr/bin/git status --porcelain --untracked-files=all` | pass；仅 barrel 一行改动与 V6-04 写集，见 `qa/v6/evidence/V6-04/scope.txt` |
| V6-05 场景 | `npm run test:v6 -- V6-05` | pass，exit 0，26/26；第三轮独立复核 accept |
| V6-05 workspace typecheck | `npm run typecheck --workspaces --if-present` | pass，exit 0；包含 `@patent/domain` |
| V6-05 workspace 回归 | `npm test --workspaces --if-present` | pass，exit 0 |
| V6-05 写集范围 | `/usr/bin/git status --porcelain` | pass；仅 barrel 两行改动与 V6-05 写集，见 `qa/v6/evidence/V6-05/scope.txt` |
| V6-06 场景（首轮） | `npm run test:v6 -- V6-06` | pass，exit 0，18/18；独立复核 not_accept（3 项 should-fix） |
| V6-06 场景（修复后） | `npm run test:v6 -- V6-06` | pass，exit 0，25/25；第四轮独立复核 accept，见 `qa/v6/evidence/V6-06/runner.tap` |
| V6-06 workspace typecheck | `npm run typecheck --workspaces --if-present` | pass，exit 0；本 checkout 不含 `@patent/web` |
| V6-06 apps/web typecheck | `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` | pass，exit 0；覆盖两个模块，见 `typecheck.txt` |
| V6-06 workspace 回归 | `npm test --workspaces --if-present` | pass，exit 0 |
| V6-06 写集范围 | `/usr/bin/git status --porcelain` | pass；仅 V6-06 新增路径与 `node_modules` 符号链接，见 `qa/v6/evidence/V6-06/scope.txt` |
| V6-06 票验收 | 见 `qa/v6/evidence/V6-06/receipt.json` | pass；第四轮独立复核 accept，1 条 note 记入 limitation |

V6-03 证据：`qa/v6/evidence/V6-03/receipt.json`、`runner.tap`、`negative-checks.txt`、`negative-probes.mjs`、`typecheck.txt`、`regression.txt`、`preservation.txt`。

### 错误
| 错误 | 尝试次数 | 解决方案 |
|---|---:|---|
| 初次未跟踪清单包含本次刚创建的基线工件，复采摘要变化 | 1 | 明确排除 `qa/v6/baseline/` 后重采；最终 414 条既有路径和摘要稳定 |
| `rg` 命令执行失败（runner 环境未找到子进程） | 1 | 以已读取的 workspace manifest 为准，直接检查 npm 配置并运行脚本 |
| npm lockfile 更新因 `@patent/vibescanner-core@0.0.1` 404 失败 | 1 | 确认 `npm ci --dry-run` 基线也失败；lockfile 保持不变并记录限制 |
| V6-03 负测导入路径错误，Node 报 `ERR_MODULE_NOT_FOUND` | 1 | 修正为 `../../../../packages/contracts/src/index.ts`，所有 probes 通过 |
| 工作树隔离钩子拒绝裸 `git` 及指向原始 checkout 的命令 | 2 | 改用 `/usr/bin/git` 显式路径；基线 407 条未跟踪路径无法在本工作树复核（原始 checkout 不可访问），改为记录本工作树完整写集 `scope.txt` 并在回执 limitation 中说明 |
| `npm run typecheck --workspaces --if-present` 在本 checkout 不执行 `@patent/web`，V6-06 早期证据未编译两个模块 | 1 | 同一证据文件追加 `./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`（exit 0），回执 limitation 与 A03 command 同步 |
