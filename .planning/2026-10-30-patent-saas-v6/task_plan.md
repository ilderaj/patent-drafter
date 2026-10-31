# 任务计划：patent-saas-v6 实施执行

## 目标

按开发准备包逐票实施产品；单票串行，记录证据，候选结果经独立验收后才 accepted。

## 下一步

V6-06 已接受并提交 813fe90。V6-07 经四轮独立复核后 accept（32/32），提交 57c8de4；V6-08 独立复核 accept，提交 32d8e99。分支已推送，PR https://github.com/ilderaj/patent-drafter/pull/1 已创建。发布复核结论：R1 为 V6-08–26，当前只完成 V6-08，且无 patent.paymond.me 的 Worker 配置，不满足发布条件，不部署。下一步按依赖图继续 V6-09 及其后续 R1 票；完整 R1 和 V6-47a 通过前不部署。

## 当前阶段

阶段 2：V6-03、V6-04、V6-05、V6-06、V6-07、V6-08 accepted 并已提交。Foundation/R1 余票待按依赖图继续。

## 阶段

### 阶段 1：基线与 runner
- [x] V6-01 记录 HEAD、既存差异与未跟踪路径哈希
- [x] 独立验收 V6-01 回执（完整复核通过）
- [x] 实施 V6-02 测试 runner 并自测
- [x] 独立复核 V6-02 并标记 accepted
- **状态：** complete

### 阶段 2：核心合同与本地模型
- [x] V6-03 建立共享 Zod 合同、导出类型与确定性 fixtures；最终独立复核 accepted
- [x] 完成 V6-03 per-action metadata 矩阵独立复核并接受
- [x] V6-04 目标与不可变修订：第 2 轮起共五轮 not_accept 全部修复，第六轮独立复核 accept
- [x] V6-05 确认与门禁：三轮独立复核（resolved blocker、policy 声明、resolved risk 均修复）后 accept，26/26
- [x] V6-06 本地 Repository：四轮独立复核（摘要/字节脱钩、S06-A05 覆盖过度、metadata 白名单、activity 排序、同租户越权与身份未绑定均修复）后第四轮 accept，25/25
- [x] V6-07 旧版导入：四轮独立复核（EXIF 对齐旧验证器、PNG IDAT、扁平 assetId、重复摘要、取消标题上限、回执表述）后 accept，32/32
- [x] V6-08 导航与三入口：独立复核 accept，12 步无头浏览器验证
- [x] V6-09 外观设置：首轮四项阻断修复后第二轮独立复核 accept，21/21 场景、16 步浏览器验证
- [ ] 按依赖图继续完成 Foundation/R1
- **状态：** in_progress

### 阶段 3：云端与发布切片
- [ ] 进入 R2 前先完成 V6-48，再做其消费者
- [ ] 按 R1–R4 profile 汇总证据
- **状态：** pending

## 固定约束

- 单次只派一张票；遵守 `docs/implementation/patent-saas-v6/06-execution-protocol.md`。
- V6-01 基线中的 39 个 tracked changes 和 414 个原始 untracked paths 是起始状态，不归因于实施票；原始快照保留 414 条路径，稳定性复采排除 live `.planning/` 和 `qa/v6/baseline/`；不重置或清理。
- V6-01 独立复核指出两份 live planning files 令原哈希主张不成立；按反馈修订排除范围和回执后重新验收。
- V6-02 首轮独立审阅发现 TAP 全 skip 检查失效；跟进复核发现符号链接入口守卫与 S13 映射缺失；均已修复并补证据，第二轮复核结论为 accept。
- 根 `package.json` 的 `test:v6` 由编排者单写，属 V6-02 允许写集；lockfile 与基线一致。
- V6-03 的 `packages/contracts/`、`qa/v6/scenarios/V6-03/`、`qa/v6/evidence/V6-03/` 属该票写集；`package-lock.json` 未改，原因和基线安装失败证据记于 V6-03 回执。
- V6-01、V6-02、V6-03 accepted；commit/push/PR are authorized by the user; deployment remains prohibited.
- V6-03 acceptance commit: `62ca1ed` on `codex/patent-saas-v6-foundation`; unrelated dirty files remain unstaged.

## 关键问题

1. 原型将哪些演示捷径带入了交互？记录生产裁决，不照抄补数据或假成功。
2. 旧本地准备包与新多租户 SaaS 如何共存迁移？等待调研后固定方案。
3. 商户、地域、模型合同与原生分发未确定时，哪些票可实现、哪些只能保留为有明确解锁条件的后续票？

## 已做决策

| 决策 | 理由 |
|------|------|
| 输出位于 docs/implementation/patent-saas-v6 | 与不可变设计基线分开，保留旧实施文档 |
| 不修改旧计划和业务代码 | 本次明确仅为开发准备 |
| 同一案件支撑自助与专业体验 | v6 notes 的核心对象约束 |
| 模型供应商中立、按任务契约编排 | executor 名称是执行环境选择，不是产品模型供应商决定 |
| 合同包直接以 Node 类型擦除加载 TypeScript | V6 runner 的 `.test.mjs` 可直接测试 `.ts` schema，无需编译产物或改 runner |

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| `rg` 指令无结果，退出 1 | 1 | 结合子代理确认指令文件；不把无结果当作已读取 |
| 技能 `init-session.sh` 只生成当前目录模板，没有 PLAN_ID 输出 | 1 | 在独立命名目录运行，后续脚本显式传绝对路径；不改宿主配置 |
| npm lockfile 更新失败：`@patent/vibescanner-core@0.0.1` 返回 404 | 1 | 复现为基线既有问题（`npm ci --dry-run` 同样失败）；保留 lockfile 并记录限制 |
| V6-03 负测首次使用错误的相对导入路径 | 1 | 改为从场景目录到仓库根的四层相对路径，负测 exit 0 |
| V6-06 首轮复核发现 asset 摘要可无新字节变更、activity metadata 未按 action 白名单强制、S06-A05 覆盖过度 | 1 | commit 增加摘要/字节耦合校验，readBlob 对照当前 asset 记录；镜像 per-action 矩阵并校验；S06-A05 改 not_applicable；场景 23/23 |
| V6-06 证据中 `npm run typecheck --workspaces` 实际未执行 `@patent/web` | 1 | 证据文件追加直接运行 `tsc -p apps/web/tsconfig.json --noEmit`；回执 limitation 与 A03 命令同步 |
| V6-06 第三轮复核：同租户非创建者可读、写未绑定 `createdBy`/用户事件 `actorId` | 1 | 增加创建者访问规则（同租户越权一律 404）与身份绑定校验；新增两项用例；场景 25/25 |
| V6-06 第四轮复核首轮误报「工作区干净、需求文档缺失」 | 1 | 说明 v6 需求文档仅在用户主 checkout（只读可读），并给出 worktree 根目录的 `git status` 复现命令；复核代理重读文档后继续并 accept |
