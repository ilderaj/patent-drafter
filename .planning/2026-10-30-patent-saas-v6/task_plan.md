# 任务计划：patent-saas-v6 实施执行

## 目标

按开发准备包逐票实施产品；单票串行，记录证据，候选结果经独立验收后才 accepted。

## 下一步

V6-11 已提交 953e05d。V6-12 经三轮独立复核（第三轮 accept）后接受并随本轮提交。用户已批准并行：V6-13 在独立工作树 `/private/tmp/patent-v6-13-worktree`（分支 `codex/v6-13-intake`，基于 953e05d）执行，接受后由编排者提交、合并回 PR 分支并应用 `mount-patch.md`。其余 R1 票按依赖图继续，互不依赖且写集不相交的票可并行。发布仍不满足条件（R1 未完成、无 V6-47a 证据、无 patent.paymond.me 的独立 Worker 配置、无用户部署授权）。

## 当前阶段

阶段 2：V6-03 至 V6-12 accepted 并已提交；V6-13 并行执行中。Foundation/R1 余票待按依赖图继续。

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
- [x] V6-10 材料选择与字节保存：五轮独立复核后第五轮 accept（36/36 场景、7 步浏览器验证）。历程：30/30 场景、7 步浏览器验证；第二轮两项阻断已修复，第三轮独立复核确认修复有效，但新发现阻断 B1（`[Content_Types].xml` 按原文匹配，注释诱饵与字符引用可让启用宏的 DOCX 被接受；关系 `Type` 未检查 vbaProject），已修复（33/33，编排者 8 项探针全部拒绝）；第四轮独立复核新发现两项阻断：含中点等合法 NameChar 的前缀绕过扫描、加密 PDF 被接受，已修复，第五轮 accept
- [x] V6-11 解析进度与失败恢复：两轮独立复核后 accept（review-02.md）。第 1 轮阻断为复制/恢复标签页共享 sessionStorage 导致第二页面中断第一页面有效租约的作业；已修复为页面实例 id 与持久会话分离、`ownerPageId` 与 `pagehide` 退出标记、`orphanInterruptAllowed` 证据链、过期租约任意读者可中断、`parseSource` 并发防线。53/53 场景、V6-10 回归 36/36、tsc/build exit 0、浏览器 12/12 步 0 console 错误、独立探针 16/16；回执 accepted，45 项与 scope 一致。非阻断见 review-02 第四节
- [x] V6-12 图纸与图集修订：三轮独立复核后 accept（review-03.md）。第 1 轮阻断：非交错 JPEG 网格与未扫描分量、同字节并发导入；第 2 轮阻断：交错 PNG 过滤字节未校验。修复为 Adam7 逐 pass 行过滤校验、仅接受 SOF0/SOF1、拒绝重复分量 id、交错 MCU 上限 10、`source.committed`/`source.retired` 写 `{version}`。42/42 场景、V6-10 36/36、V6-11 53/53、tsc 通过；复核 42/42 逐行损坏被拒、Pillow 90 文件一致。回执 accepted，49 项与 scope 一致。非阻断见 review-03
- [ ] V6-13 五问引导与事实冲突：独立工作树并行执行中
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
