# 任务计划：patent-saas-v6 实施执行

## 目标

按开发准备包逐票实施产品；单票串行，记录证据，候选结果经独立验收后才 accepted。

## 下一步

V6-11 已提交 953e05d。V6-12 经三轮独立复核（第三轮 accept）后接受并随本轮提交。用户已批准并行：V6-13 在独立工作树 `/private/tmp/patent-v6-13-worktree`（分支 `codex/v6-13-intake`，基于 953e05d）执行。V6-13 第五轮独立复核 ACCEPT（review-05.md）：B5 以原子 claim/finalize 协议关闭，B1-B4 独立复现仍成立，45/45、V6-11 53/53、V6-10 36/36、tsc/build 0、38 项 scope 一致；已提交 `d3f2a6d`，合并回 PR 分支并在 `facts` 标签永久挂载（`V6App.tsx`、`navigation.ts`），PR 分支重跑 V6-13 45/45、V6-12 42/42、V6-11 53/53、V6-10 36/36、浏览器 12/12 步 0 console 错误。V6-15（AI 能力与授权界面）经三轮复核前加固（claim/finalize 协议、过期租约接管后清理不得删除新所有者的授权行、失败提交后同键重试可重新执行）后，第一轮独立复核 ACCEPT（review-01.md，无阻断）；已提交 `691eade`，`--no-ff` 合并回 PR 分支，并在 `ai` 全局导航永久挂载。PR 分支 13 个套件 372/372、tsc/build 0、浏览器 8/8 步 0 console 错误。复核非阻断 F1–F4 记为后续项，其中 F4（合同 §2 的 30 天幂等保留与 `IDEMPOTENCY_EXPIRED`）须在服务端或真实适配器票之前解决。V6-14（路线与多目标配置）第一轮独立复核 ACCEPT，已提交 `7fc5d9a`，合并回 PR 分支并在 `overview` 标签永久挂载；PR 分支 14 个套件 413/413。下一张票按依赖图取 V6-16 及后续 R1 票。其余 R1 票按依赖图继续，互不依赖且写集不相交的票可并行。发布仍不满足条件（R1 未完成、无 V6-47a 证据）；patent.paymond.me 的独立 Worker 配置已在 `codex/v6-deploy` 准备并通过 dry-run，经本机代理验证 Cloudflare 凭据可用，待 R1 验收后部署。

## 当前阶段

阶段 2：V6-03 至 V6-13 accepted 并已提交；V6-13、V6-14 与 V6-15 已 accepted 并挂载到 PR 分支。Foundation/R1 余票待按依赖图继续。

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
- [x] V6-13 五问引导与事实冲突：五轮独立复核后 accept（review-05.md）。第 4 轮 B5（同键并发无变更/写版本）以原子 claim/finalize 协议关闭，B1-B4 独立复现仍成立；45/45、V6-11 53/53、V6-10 36/36、tsc/build 0、38 项 scope 一致。提交 `d3f2a6d`，合并回 PR 分支后在 `facts` 标签永久挂载；PR 分支重跑 V6-13 45/45、V6-12 42/42、V6-11 53/53、V6-10 36/36、浏览器 12/12 步 0 console 错误
- [x] V6-15 AI 能力与授权界面：独立复核 ACCEPT（review-01.md，无阻断）。复核前加固 three rounds：授权/撤回共用 claim/finalize 幂等协议；过期租约接管时旧所有者的清理不得删除新所有者的授权行；失败提交后同键重试可重新执行。41/41（含 11 项并发/故障测试）、回归 42/53/36、tsc/build 0、35 项 scope 一致；提交 `691eade`，合并后在 `ai` 导航永久挂载；PR 分支 13 套件 372/372、浏览器 8/8 步 0 console 错误。非阻断 F1–F4 见 review-01；F4（30 天幂等保留与 `IDEMPOTENCY_EXPIRED`）须在服务端/真实适配器票前解决
- [x] V6-14 路线与多目标配置：独立复核 ACCEPT（review-01.md，无阻断）。编排者修正：取消每案目标数上限（S03 专业模式可继续添加目标）；优先权证据只接受 `available` 状态的材料。41/41、回归 45/41/42/53/36、tsc/build 0、红灯 5 项、浏览器 8/8 步 0 console 错误、28 项 scope 一致；提交 `7fc5d9a`，`--no-ff` 合并回 PR 分支后在 `overview` 标签永久挂载，保存目标后外壳原地刷新（`onSettled` → 非破坏性 `retry`），并移除 `v6.css` 中 `.v6-targets .chip { color: inherit }`。PR 分支 14 套件 413/413、浏览器 8/8 步 0 console 错误。复核 finding 1（重试复用请求键）与 2（提交循环内重查材料状态）须在服务端/真实适配器票前处理
- [x] V6-16 版本化 pipeline adapter：两轮独立复核后 accept（review-02.md，无阻断）。第 1 轮阻断为缓存元数据未绑定当前 provider/model、stub 伪造 model、命中仍报 cached:false，以及损坏缓存无法驱逐导致反复 provider 调用；修复为按阶段类型/执行模式校验元数据、命中置 cached:true、缓存 seam 增加 delete 并隔离重写坏条目、二次污染报 INTERNAL_ERROR。14/14 场景；回归 V6-10 36、V6-14 41、V6-15 41、tsc/build 0。提交 `e1017af`，已合并入集成分支。两项 NEEDS_DECISION：C11 检查点存储 schema/所有权/保留策略、每阶段 consent scope 的规范表示；Node 22 未验证
- [x] V6-21 案件列表与待办：两轮独立复核后 accept（review-02.md）。第 1 轮四项阻断：收件箱未消费共享 nextAction、deletion_pending 使整个列表/收件箱读取失败、成功 parse job 永不关闭、S06-A04/A05 覆盖过度；修复为共享投影、跳过 pending、按 parse 终态解决、补 review feedback 测试并把 A05 标 partial。29/29、V6-06 25/25、tsc/build 0、41→42 项 scope 一致。提交 `fb7af75`，合并入集成分支；集成分支 V6-21 29/29、V6-06 25/25。已知契约缺口：无 `matter.unarchived` 事件，取消归档不写事件（已记为 limitation）；nextAction 暂放 features/matters，待 domain 所有者迁移
- [x] V6-17 任务进度与结果采纳：四轮独立复核后 accept（review-05.md）。阻断依次为：support 实为 readiness 且 AST 无来源、成本/时长未真正限制、astHash 误用输入哈希、修订状态写失败不可恢复、support 假关联、数值归一化 1.5=15；修复为真实 SupportIndex 贯通 AST、按调用即时计费与跨 resume deadline、canonicalAstHash、状态重建、严格 ref 校验与保留数字标点。37/37、V6-10/14/15/16 回归全绿，tsc/build 0。提交 `7d4eae0`，合并入集成分支
- [ ] V6-18 统一 AST 草稿编辑：执行中（写集 `features/draft/Editor.tsx`、`ast-adapter.ts`）
- [x] V6-19 支持定位与逐段确认：五轮独立复核后 accept（review-05.md）。阻断依次为 locator 未校验来源/实时哈希、确认未按 C03 递增 matter.version、风险定位与真实焦点缺失、共享 Vite 缓存写入、历史确认无法撤销、存储 rejection 泄漏/错误码误映射；均已修复。16/16、V6-05 26/26、tsc/build/browser 7/7。提交 `e6ae4c9`，合并入集成分支
- [x] V6-22 专业工作台与活动：两轮独立复核后 accept（review-02.md）。首轮阻断为概览缺目标 language、A02 失败测试未覆盖当前版本同 job 成功、浏览器 createRoot 重复；修复为语言投影/列、把主张收窄到真实失败/重试边界并记录同 job 终态守卫为待决、浏览器 9/9 零错误。15/15、38 项 scope 一致，提交 `97eb133`，合并入集成分支
- [x] V6-24 内部批准与交付门禁：两轮独立复核后 accept（review-02）。实现/探针通过，首轮仅证据过期；刷新后 6/6、依赖 200/200、tsc/build 0。提交 `52b732b` 合并入集成分支
- [x] V6-25 真实导出与完成页：四轮独立复核后 accept（review-04）。阻断为 7 天缓存过期、prepared 行失败残留、逐代 TTL、stale 行 TTL，均已修复；20/20、302/302、tsc/build/browser 5/5。提交 `ef496bb` 合并入集成分支
- [x] V6-26 加密备份与恢复：两轮独立复核后 accept（review-02）。阻断为图形历史误拒、非法快照/未知 AST 仍可提交、报告计数不一致、验证行明文保留；修复后 14/14、354/354、tsc/build 0、浏览器 6/6。提交 `575780c` 合并入集成分支
- [x] V6-47a R1 发布证据：第三轮独立复核 ACCEPT（review-03.md）。26/26 accepted、candidate_ready；scope 为 f5082b6 起的 15 项，V6-47a 5/5；回执 accepted，待提交。部署仍需主机名决策与单独授权
- [ ] 按依赖图继续完成 Foundation/R1
- **状态：** in_progress

### 阶段 3：云端与发布切片
- [x] 部署独立 Worker `patent-v6` 到备用主机名 `patent-v6.paymond.me`（2026-11-05，版本 `fdbf2d2c`，免费计划；证据见 `qa/v6/evidence/release/deploy/2026-11-05/`）
- [ ] 将 `patent.paymond.me` 指向 Worker：现为 ChatGPT 自定义域名 CNAME，切换会替换现有记录并使原站点离线，需明确确认
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
