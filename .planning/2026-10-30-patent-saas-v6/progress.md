# 进度日志

## 会话：2026-10-30

### 当前状态
- **阶段：** V6-05 accepted（第三轮独立复核）；开始 V6-06
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

V6-03 证据：`qa/v6/evidence/V6-03/receipt.json`、`runner.tap`、`negative-checks.txt`、`negative-probes.mjs`、`typecheck.txt`、`regression.txt`、`preservation.txt`。

### 错误
| 错误 | 尝试次数 | 解决方案 |
|---|---:|---|
| 初次未跟踪清单包含本次刚创建的基线工件，复采摘要变化 | 1 | 明确排除 `qa/v6/baseline/` 后重采；最终 414 条既有路径和摘要稳定 |
| `rg` 命令执行失败（runner 环境未找到子进程） | 1 | 以已读取的 workspace manifest 为准，直接检查 npm 配置并运行脚本 |
| npm lockfile 更新因 `@patent/vibescanner-core@0.0.1` 404 失败 | 1 | 确认 `npm ci --dry-run` 基线也失败；lockfile 保持不变并记录限制 |
| V6-03 负测导入路径错误，Node 报 `ERR_MODULE_NOT_FOUND` | 1 | 修正为 `../../../../packages/contracts/src/index.ts`，所有 probes 通过 |
| 工作树隔离钩子拒绝裸 `git` 及指向原始 checkout 的命令 | 2 | 改用 `/usr/bin/git` 显式路径；基线 407 条未跟踪路径无法在本工作树复核（原始 checkout 不可访问），改为记录本工作树完整写集 `scope.txt` 并在回执 limitation 中说明 |
