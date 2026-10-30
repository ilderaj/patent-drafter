# 进度日志

## 会话：2026-10-30

### 当前状态
- **阶段：** V6-03 accepted；准备 V6-03 scoped PR
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
- V6-03 第一轮矩阵复核 not_accept：指出 S06-A06 的 provider/model 未必存在，且标识字符串可承载自由文本。已要求 job.succeeded/job.adopted 同时提供非空 provider/model，限制 stage/provider/model 字符集，并为要求和自由文本注入补充场景断言及负测。聚焦复核还指出 stage 缺少无效输入覆盖；补充 stage 拒绝断言与探针后，场景 14/14、负测 22/22、workspace typecheck、workspace tests exit 0，baseline preservation 407/407。最终独立只读复核 accept；确认 47 个 action 矩阵完整、21 个 changedFiles 与实际文件一致，receipt 标记 accepted。按用户授权准备切支、提交、推送和开 PR；未部署。

### 检查结果
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

V6-03 证据：`qa/v6/evidence/V6-03/receipt.json`、`runner.tap`、`negative-checks.txt`、`negative-probes.mjs`、`typecheck.txt`、`regression.txt`、`preservation.txt`。

### 错误
| 错误 | 尝试次数 | 解决方案 |
|---|---:|---|
| 初次未跟踪清单包含本次刚创建的基线工件，复采摘要变化 | 1 | 明确排除 `qa/v6/baseline/` 后重采；最终 414 条既有路径和摘要稳定 |
| `rg` 命令执行失败（runner 环境未找到子进程） | 1 | 以已读取的 workspace manifest 为准，直接检查 npm 配置并运行脚本 |
| npm lockfile 更新因 `@patent/vibescanner-core@0.0.1` 404 失败 | 1 | 确认 `npm ci --dry-run` 基线也失败；lockfile 保持不变并记录限制 |
| V6-03 负测导入路径错误，Node 报 `ERR_MODULE_NOT_FOUND` | 1 | 修正为 `../../../../packages/contracts/src/index.ts`，所有 probes 通过 |
