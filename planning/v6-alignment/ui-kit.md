# V6 UI Kit（原型组件映射）

位置：`apps/web/src/v6/components/ui/`。全部组件只输出原型类名，不套旧应用 `.card/.btn/.tabs-list` 组合；样式来自 `v6/styles/proto/`（已在 `routes/v6.css` 顶部引入，作用域 `.v6-shell`）。

## 图标 `Icon`

- 原型：`core.js` 的 `P` 全量路径、`ic(name, cls)`。
- Props：`name: IconName`（P 的全部 key）、`size?: "sm" | "lg"`、`className?`、`style?`、`label?`（无 label 时 `aria-hidden`）。
- 类名：`svg.ic [sm|lg]`。
- 示例：`<Icon name="folder" />`、`<Icon name="search" size="sm" />`。

## 按钮 `Button`

- 原型：`.btn`、`.btn.primary`、`.btn.ghost`、`.btn.danger`、`.btn.sm`、`.btn.lg`、`.btn.icon`。
- Props：`children?`、`variant?: "primary" | "ghost" | "danger"`、`size?: "sm" | "lg"`、`icon?: IconName`、`iconOnly?`、`to?`（渲染 router Link）、`disabled?`、`type?`、`title?`、`ariaLabel?`、`onClick?`，以及 `data-*`。
- 示例：`<Button variant="primary" size="sm" icon="refresh" onClick={run}>重新检查</Button>`。

## 工具栏 `Toolbar` / 标签 `Tabs`

- 原型：`.toolbar` + `.tb-title/.tb-sub/.tb-right` + `.tabs > .tab.sel`（`tb()`、`tbTitle()`、pro.js TABS）。
- `ToolbarProps`：`title`、`subtitle?`、`back?: { to, label? }`、`right?`、`children?`、`className?`。
- `TabsProps`：`items: { key, label, dot?, to?, onSelect? }[]`、`active`、`ariaLabel?`。
- 示例：
  ```tsx
  <Toolbar title="案件" subtitle="1 个进行中案件" right={<Button variant="primary" size="sm">创建案件</Button>} />
  <Tabs active="overview" items={[{ key: "overview", label: "概览", to: "..." }, { key: "check", label: "检查", to: "..." }]} />
  ```

## 页面容器 `Body` / `Pane`

- 原型：`.body`、`.pane`（980）、`.pane.narrow`（720）、preview 1120（`.pane.wide`）。
- `BodyProps`：`flush?`、`center?`、`className?`。
- `PaneProps`：`width?: "default" | "narrow" | "wide"`。
- 示例：`<Body><Pane width="narrow">…</Pane></Body>`。

## 分组 `Group` / 行 `Row`

- 原型：`.group`、`.row`（`.r-main/.r-title/.r-sub/.r-right`，`row.click/.sel/.sep`）。
- `RowProps`：`title?`、`description?`、`right?`、`children?`、`clickable?`、`selected?`、`separator?`、`to?`、`onClick?`。
- 示例：`<Group><Row title="一种防倾倒的宠物饮水杯" description="中国实用新型 · 进行中" right={<Button size="sm" to={...}>打开工作台</Button>} /></Group>`。

## 提示 `Callout` / 标签 `Tag` / 状态形状 `StatusShape`

- 原型：`.callout.info/.warn/.ok/.risk`（`riskNotice()` 等）、`.tag.ok/.warn/.risk/.ai/.pro/.plain`（`tag()`）、`.stx` + `.st.ok/.warn/.risk/.idle/.ai`（`st()`，形状 ●○▲–◇）。
- `Callout`：`tone?`、`icon?: IconName`、`children`。
- `Tag`：`tone?`、`children`。
- `StatusShape`：`tone: "ok" | "warn" | "risk" | "idle" | "ai"`、`label?`。
- 示例：`<Callout tone="warn" icon="alert"><b>提交前需要人工核实。</b>…</Callout>`。

## 统计 `Stat` / `StatRow`

- 原型：`.statrow > .stat > .s-n/.s-l`（check 页四格）。
- `StatItem`：`{ label, value, tone?: StatusTone }`。
- 示例：`<StatRow items={[{ label: "阻断", value: 0 }, { label: "风险，需人工判断", value: 3, tone: "warn" }]} />`。

## 小节标题 `SectionHeader`

- 原型：`.section-h > .sh-r`。
- Props：`title`、`right?`。
- 示例：`<SectionHeader title="法域目标" right="一个案件可以对应多个目标" />`。

## 弹层 `Sheet`

- 原型：`.scrim > .sheet[.wide] > .sheet-h/.sheet-b/.sheet-f`（`sheetH()`）。
- Props：`title`、`subtitle?`、`children`、`footer?`、`onClose`、`wide?`、`closeLabel?`；Esc 关闭，打开时聚焦首个可操作元素。
- 示例：`<Sheet title="更换申请目标" onClose={close} footer={<Button onClick={close}>关闭</Button>}>…</Sheet>`。

## 外壳

- `Shell` 专业模式：`.sidebar`（`.sb-search/.sb-item/.sb-label/.sb-sub/.count/.sb-spacer/.sb-user`）+ `.main`，数据来自真实 repository：收件箱未结数、进行中案件数、最近案件标题、搜索过滤。
- 无侧栏：`mode="public" | "self_service"`。首页与自助向导不渲染专业侧栏。
- 底部用户区固定显示「本机用户 · 本地网页版」（`runtime-label`）。

## 样式入口

- `v6/styles/proto/tokens.css`：原型令牌（native light/dark），其他主题回退到现有语义令牌。
- `v6/styles/proto/layout.css`：`styles.css` 限定版（已去掉 menubar/browserbar/traffic/pctl/drawer）。
- `v6/styles/proto/screens.css`、`polish.css`：页面补充与收尾样式。
- `v6/styles/proto/index.css`：导入顺序 + 生产外壳胶水（sticky 工具栏/侧栏、窄屏单列、`.pane.wide`）。
- 入口：`v6/routes/v6.css` 第一行 `@import "../styles/proto/index.css";`，V6App 已加载该文件，无需改 V6App。
