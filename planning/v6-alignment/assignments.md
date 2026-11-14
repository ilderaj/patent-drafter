# V6 原型对齐实施分工（2026-11-10）

用户已批准按报告建议实施 R1；D1=现有本地测试引擎，D2=验收及备用域名复验后再切主域名，D3=先R1后R2/R3。此刻不部署、不提交、不改真实模型外发门。

工作树：`/Users/jared/Personal Projects/Patent/.claude/worktrees/v6-prototype-alignment`，基于 e9723cc，分支 codex/v6-prototype-alignment。主仓库大量既存改动禁止动。依赖已软链，不 npm install，不写 node_modules。共享工作树，严格写集，不覆盖他人改动，不再派子代理。权限 Full access（宿主批准），被拒必须报告，不绕过。

原型：主仓库 `/Users/jared/Personal Projects/Patent/docs/design/patent-saas-v6/prototype/`。报告：主仓库 `docs/audit-evidence/v6-prototype-gap-2026-11-05/`。按原型设计，不另创新审美。生产裁决：主仓库 docs/implementation/patent-saas-v6/00-baseline.md。运行时只本地测试输出，禁止伪造事实、来源、同意、价格、支付和真实递交。

## runtime worker

写集：apps/web/src/v6/features/generation/、features/delivery/、features/checks/、qa/v6/scenarios/alignment-runtime/，自己的 handoff-runtime.md。

1. generation/local-runtime.ts 导出稳定 `LOCAL_TEST_GENERATION_OPTIONS: Omit<GenerationEngineOptions,'repository'|'actor'>`，采用 engine execution:'stub' 和正确 pipeline/limits；不从测试harness导入、不调用真实provider、不削弱引用校验。让真实新建案件能运行、采纳测试草稿，严格标记测试输出，与真实AI产品能力区分。数据来源和人工确认不伪造。尽早告知Lead接口就绪。
2. Workspace ChecksWorkspace onRiskAck/onAction 空回调接通。用既有 confirmation ledger 记录risk_ack，绑定actor/target/snapshot/checkRunId；持久检查run并恢复同ID，防止reload产生新ID使确认丢失。规则/输入/修订变更旧确认失效，导出门禁读同一记录。ChecksPanel增加可恢复confirmed IDs的prop，失败不能乐观成功。处理动作react-router navigate到同案对应目标标签，禁止硬编码/patent。
3. WorkspaceProps增加 `confirmationMode?: 'self_read'|'professional_paragraphs'` 默认专业，DeliveryWorkspace传给Approval/Done；独立PreviewWorkspace保留，去掉交付后重复堆Preview（向导单独预览）。批准/确认完成刷新gate，不要求整页重载。Done区分导出前/成功，提供实际文件与下一步，测试输出包明确标注。不得解除blocker或伪XML。
4. 检查空草稿给中文下一步，校验原始错误放details；保留四级与真实规则。
5. 针对风险持久/旧确认失效及测试生成做有意义测试，跑对应已有回归。输出handoff含文件、接口、命令结果、限制。

## self-flow worker

写集：apps/web/src/v6/routes/navigation.ts、routes/V6App.tsx、components/Shell.tsx、新features/self-service/**（包括独立css），qa/v6/scenarios/alignment-self/，handoff-self.md。不修改原Intake/Targets业务层、Workbench/theme/delivery/generation。

1. 自助路由 `/v6/new/:matterId/{upload,questions,route,generate,preview,done}`。五步外壳：上传含解析、补充信息、选择路线、生成、预览下载；一次一题，真实来源、回退保存。公开历史成熟度不得预填；无文档允许但不自动造材料。复用intake/targets业务API，不另造store。URL可重载，缺前置数据返回适当步骤；自助与专业同案。旧upload深链保留与正确下一步。
2. 人员按姓名创建/选择，路线四卡可选+真实能力说明，禁止ID文本输入，选卡不写业务直到保存。
3. 首页卷宗三入口，向导无全局专业侧栏，用步骤栏，专业侧栏按原型。搜索/计数等只能真实工作，不能装饰假按钮。服务/pricing/billing显示真实范围和未开放原因，不假收费；设置旧版入口交给workbench worker。
4. 生成使用 runtime worker 的 `LOCAL_TEST_GENERATION_OPTIONS`；V6App把同常量传给ProfessionalWorkbench generation。测试输出显著说明、不称真实AI；stub本地不造外发同意。采纳后才能预览，处理真实前置条件。
5. PreviewWorkspace单独页面/通读确认，Done调用DeliveryWorkspace confirmationMode='self_read'；缺图等blocker提供去处理，不绕过。全局activity挂既有ActivityFeed currentMatterId=''（workbench worker负责支持）；给专业同案入口。
6. 原型系统字体/蓝灰密度，独立scope CSS，不画假系统菜单/交通灯。检验URL往返、持久化、守卫、typecheck。handoff说明文件、测试、限制。

## workbench worker

写集：apps/web/src/v6/styles/**、routes/v6.css、features/workbench/**、features/matters/**、features/inbox/Inbox.tsx、features/ai/Ai.tsx、features/settings/Appearance.tsx、features/targets/Targets.tsx（可读选择UI），qa/v6/scenarios/alignment-workbench/，handoff-workbench.md。不动navigation/V6App/Shell/self-service/generation/delivery/checks。

1. Native明暗取prototype styles.css令牌：系统字体，蓝#0a64d6/#4c9bf5，灰底，6/10px圆角、紧凑工具栏和薄边框；去旧橙色衬线大标题。限定v6/native，保留其他主题，不动旧app全局styles.css。390px与键盘焦点可用。
2. 草稿编辑+DraftReviewPanel支持/确认同页双栏，传确认信息维持状态；review标签变R3客户审阅说明。overview目标表+可执行下一步，配置折叠/弹层；看目标不写数据。generation由V6App传，不自建新引擎。
3. ActivityFeed currentMatterId=''显示全部案件，真实可筛选；routes worker挂载。Matters下一动作/route/人/时间中文可读，ID进details；Inbox列表+详情且已读≠已解决。
4. AI页清晰三种处理方式与实际能力；保留真实外发门关闭和test说明；修过时编辑器未开放文案，链接不硬编码/patent，使用路由。
5. Targets使用姓名/证据选择器替代逗号ID，保留业务校验。设置分组、旧版入口。
6. 只测自己改动与相关回归，必要开发服务器 npx vite --port N --strictPort，不npm run dev透传端口。handoff说明文件、检查、未完成项。

## 验收与协作

接口变化尽早通过Lead同步。共享tsc若因他人中间文件失败，区分来源，不修改越界文件。各worker只写自己的handoff，Lead维护总计划。完成后由独立executor tester跑真实浏览器，无文档和上传路径、风险持久化、生成采纳预览、确认批准导出、刷新失效、明暗与移动；零console error不等于业务通过。
