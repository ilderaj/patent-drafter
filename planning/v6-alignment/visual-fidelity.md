# 视觉还原修正规格（2026-11-10）

用户明确不满意当前还原度。证据：`docs/audit-evidence/v6-visual-parity-2026-11-10/`（parity.md、pair-*.jpg）。每位 worker 开工前先看自己负责页面的 pair 图。

## 根因

上一轮只换了颜色令牌，仍沿用旧应用的 `.card / .btn / .tabs-list` 组件类和「卡片纵向堆叠」布局。原型是另一套组件系统和页面骨架。**这次不是调样式，是按原型的标记结构重建呈现层**；数据层、业务调用、data-testid 保持不变。

## 唯一依据

主仓库 `/Users/jared/Personal Projects/Patent/docs/design/patent-saas-v6/prototype/`：`styles.css`、`screens.css`、`polish.css` 是样式真值；`core.js`（外壳、图标 P、状态形状 SH、tag、sheet）、`self.js`、`pro.js`、`services.js` 里每个 `R.<screen>` 的 HTML 模板是结构真值。照它的 DOM 结构和类名写 JSX，不自创布局、不换字号、不加装饰。

## 必须一致的东西

1. 骨架：每页 = `.toolbar`（标题 + 副标题 + 右侧操作）+ `.body > .pane`（宽度按原型：默认 980，narrow 720/760，preview 1120）。22/22 页现在都没有 toolbar。
2. 自助向导：左侧 `.wiz-rail` 步骤栏（含「正在准备」卡）+ `.wiz-main > .wiz-card`，不是横向步骤条。
3. 专业外壳：`.sidebar` 带图标、计数、置顶案件、底部入口（专家服务、AI 与数据、套餐与账单、设置）和用户区；案件页 toolbar 右侧是目标切换按钮 + 「交付」主按钮，下面 `.tabs` 下划线标签。
4. 控件：按钮 6px 圆角（不是胶囊）、高度/字号按原型；正文 13px/1.46；`.group > .row` 列表、`.tbl` 表格、`.callout`（info/warn/ok）、`.tag`、状态形状 ●○▲–◇、`.stat` 统计条、`.section-h`。
5. 文档呈现：预览与草稿用原型 `.doc / .doc-inner / .para / .pno / .inline-note / .doc-aside`（纸面、段落编号、页边批注），不是卡片里的纯文本。
6. 问答：`.q-wrap`，进度条、大标题、`.q-src` 来源条、选择题用 `.optgrid .optcard`（不是下拉框）、`.chip-ex`。
7. 路线：`.route-grid .route-card`，卡片内容密度按原型（描述 + 审查/周期两行），能力限制用 `.route-extra`，人员选择放卡片下方。
8. 检查页：`.statrow` 四格统计 + 分级原则 callout + 分组 `.checkrowline`。
9. 完成页：`.done-hero` + 文件 `.dl-row` 列表 + 「接下来」`.steps3` + 两个 `.upsell`。门禁与批准细节收进可展开区，主视图不出现 SnapshotRef、UUID、原始时间戳。
10. 图标：用 core.js 的 P 路径做成 `<Icon name>` 组件，不用 emoji 或文字符号。

## 不照搬（生产裁决）

假浏览器栏、macOS 菜单、交通灯、原型控制条；演示数据、假支付、模拟回执；未核实的承诺文案（零保留、价格、期限）。文案保持真实能力，但句式、长度、位置贴近原型。测试输出标记保留，用原型 `.callout.warn` 样式，每页只出现一次。

## 分工与写集

- kit（先行）：`v6/styles/proto/*.css`（把三份原型 CSS 限定在 `.v6-shell` 下移植，明暗用 `[data-mode]`，令牌直接取原型值）；`v6/components/ui/*`（Icon、Toolbar、Tabs、Group/Row、Callout、Tag、StatusShape、Stat、Sheet、Pane）；`v6/components/Shell.tsx` 侧栏。完成后其他人才开始。停用 v6 页面对旧 `.card/.btn/.tabs-list/.notice` 的依赖（旧版页面不受影响）。
- self：`features/self-service/**`、V6App 的 StartPage、services/pricing/billing 说明页。
- pro：`features/workbench/**`、`matters/`、`inbox/`、`ai/`、`settings/`、`targets/Targets.tsx`、`intake/Intake.tsx`（专业事实页）、`sources/{Upload,Parse,Figures}.tsx`、`draft/{Editor,Review}.tsx`。
- runtime 呈现：`generation/Generation.tsx`、`preview/Preview.tsx`、`checks/Checks.tsx`、`delivery/{Approval,Done,Workspace}.tsx`。

## 验收（tester 复测 + Lead 看图）

- 结构：toolbar 22/22；向导左栏 5/5；doc 纸面在 preview 与 draft；statrow 在 check。
- 数值：正文 13px；按钮圆角 ≤6px；pane 宽度与原型差 ≤16px；侧栏宽度一致；卡片/分组圆角、边框与原型一致。
- 390px 无横向溢出；明暗都对；功能验收脚本（browser-acceptance.py）全绿——testid 改了要同步告诉 tester。
- 不得删除功能、门禁或测试标记来换取相似度。
