# Self-flow worker handoff

## 交付内容

- 新增自助向导路由 `/v6/new/:matterId/{upload,questions,route,generate,preview,done}`；旧上传深链 `/v6/matters/:id/upload` 保留并跳到向导第 1 步。
- 五步外壳在 `routes/V6App.tsx` 按原型组织：公共首页（三入口）、自助步骤栏、专业侧栏。URL 是唯一页面状态，刷新和深链会按已保存的真实进度回到正确步骤；缺前置数据只重定向，不补写答案、同意或目标。
- `components/Shell.tsx` 拆成三种外壳：
  - `public`：首页无侧栏，品牌「卷宗」，AI 数据说明和「设置」入口。
  - `self_service`：向导与旧上传深链无全局侧栏，只显示步骤栏和「同一案件的专业工作台」入口。
  - `professional`：按原型做侧栏：品牌、可用的导航/案件搜索（只匹配页面名和本机案件标题）、分组导航、底部设置和运行时标签；去掉「切换到旧版」与未开放噪音。
- `features/self-service/SelfService.tsx`：
  - 第 1 步复用 `ingest.ts` / `UploadPanel` / `Parse`：真实字节保存、真实解析进度、失败和重试；不生成虚拟附件，也不跳过已保存的材料。
  - 第 2 步 `QuestionsStep.tsx`：一次一题；问题来自 `intake.ts` 定义；公开历史、成熟度只能由人选择；逐题保存答案、来源和人员，保存后刷新仍可恢复；上一题/下一题保留位置（`?q=`）。
  - 第 3 步 `RouteStep.tsx`：四张路线卡显示能力说明和未核实数值；人员按姓名勾选/新增，不出现 ID 文本框；新增人员与路线一起保存，选卡本身不写业务数据；保存成功后进入第 4 步。
  - 第 4 步直接挂 `GenerationPanel` 并传入 `LOCAL_TEST_GENERATION_OPTIONS`；显著说明这是本机固定测试引擎，不发送材料、不产生费用。采纳后进入持久修订。
  - 第 5 步 `PreviewWorkspace` 独立呈现文档和通读确认；第 6 步 `DeliveryWorkspace confirmationMode="self_read"`。测试修订由持久标记驱动 `TestOutputNotice`，说明测试性质不会因采纳/通读/导出改变；blocker 只提供去处理，不绕过。
  - 生成页链接到 `workbench/TestOutputNotice` 与 `generation/generation.ts` 的 `loadHeadRevision`，不修改该文件。
- 自助与专业工作台共用同一案件、目标、事实、修订和导出记录；`V6App` 把同一份 `LOCAL_TEST_GENERATION_OPTIONS` 传给 `ProfessionalWorkbench generation`（`ProfessionalWorkbenchProps.generation` 由协作方已提供的接口承载），专业页不再显示无引擎提示。
- 首页卷宗三入口（自助、专业、人工）不预填案件；服务、账单、套餐/价格（`/v6/pricing`）显示真实范围、未开放原因和不收费事实，不假支付/假账单。动态 `/v6/activity` 挂 `ActivityFeed currentMatterId=""`（跨案件真实筛选）。
- `routes/navigation.ts`：新增 `self_service` 路由与 `SectionKey`（包含 `pricing`）；`createSelfServiceMatter.next` 保持旧 upload 深链（既有回归 `V6-08` 不变）；新增 `SelfServiceStep` 导出供向导与测试共用。
- `features/self-service/route-state.ts`：纯函数实现「缺前置数据回对应步骤」与「问题位置」的 URL 行为，供测试和组件复用；不写任何存储。

## 主要文件

- 写集内：`routes/navigation.ts`、`routes/V6App.tsx`、`components/Shell.tsx`、`features/self-service/**`（含 `self-service.css`）、`qa/v6/scenarios/alignment-self/`、本 handoff。
- 依赖读取：`features/generation/local-runtime.ts`、`features/generation/generation.ts`、`features/delivery/Workspace.tsx`、`features/workbench/TestOutputNotice.tsx`、`features/sources/{ingest,parse,Upload,Parse}.ts(x)`、`features/intake/**`、`features/targets/**`。

## 接口说明

- `v6Path({ kind: "self_service", matterId, step })` → `/v6/new/:matterId/:step`；`SelfServiceStep = "upload"|"questions"|"route"|"generate"|"preview"|"done"`。
- `requiredSelfServiceStep(step, { intake, target, targetRecord })`：`route/generate/preview/done` 缺答案 → `questions`；`generate/preview/done` 无目标或目标配置不可读 → `route`；`preview/done` 无已采纳修订 → `generate`。
- `resolveQuestionIndex(intake, "?q=")`：保留用户位置，但不超过第一道未回答或来源已变化的题。
- 自助生成与专业生成共用 `LOCAL_TEST_GENERATION_OPTIONS`；测试修订的持久标记由生成/修订契约的 `testOutput` 产生，向导只读不写标记。

## 验证命令与结果

- `npm run typecheck -w @patent/web` — 通过（exit 0）。日志：`qa/v6/scenarios/alignment-self/typecheck.log`。
- `npm run build -w @patent/web` — 通过（exit 0）；`tsc --noEmit && vite build` 成功，`dist/patent/` 生成（只有既有的 >500 kB chunk 警告）。日志：`qa/v6/scenarios/alignment-self/build.log`。
- `node --import tsx --test qa/v6/scenarios/alignment-self/navigation.test.mjs` — 通过，3 tests（URL 往返、旧 upload 别名、缺前置回退、问题位置）。日志：`qa/v6/scenarios/alignment-self/navigation.test.log`。
- `node --import tsx --test qa/v6/scenarios/V6-08/navigation.test.mjs` — 通过，12 tests；既有导航契约未变。日志：`qa/v6/scenarios/alignment-self/v6-08-regression.log`。

## 追加：采纳回调与事件核对（2026-11-10）

- `SelfService.tsx` 生成步骤向 `GenerationPanel` 传入 `onAdopted={refreshAfterAdoption}`：只有采纳成功才触发；回调递增 `refreshToken`，向导在不整页刷新的前提下静默重读案件、目标、`draftRevisionId` 和 `headTestOutput`。刷新期间保留当前面板，不闪回 loading。
- 「查看已采纳的草稿」按钮现在以 `targetRecord.draftRevisionId` 为门禁：无修订时禁用；采纳成功刷新后立即可用，`requiredSelfServiceStep` 也按新修订放行 `preview/done`。按钮旁文字区分「采纳后才能预览」和「已采纳修订」。
- 向导内 CustomEvent 核对：
  - `v6:draft-generate`、`v6:draft-adopt-inputs` 已不再由 `Preview.tsx` 派发；预览在无回调时直接导航到同案草稿页（真实链接），向导内没有这两类无人监听事件。
  - `v6:generation-compare` 仍由 `Generation.tsx` 的 compare 动作派发（非本 worker 写集，`GenerationPanelProps` 无 compare 回调）。`SelfService` 注册监听并导航到同案同目标的专业草稿页，按钮不再是空动作；若后续要改成 prop 回调，需要 runtime 在 `GenerationPanelProps` 增加 `onCompare`。
  - `v6:checks-action` 只属于专业检查面板，向导不挂载该面板，不构成本流程的空动作。
- 追加验证：`npm run typecheck -w @patent/web`（exit 0，`qa/v6/scenarios/alignment-self/typecheck.log`）；`npm run build -w @patent/web`（exit 0，`build.log`）；`node --import tsx --test qa/v6/scenarios/alignment-self/navigation.test.mjs`（3/3，`navigation.test.log`）；`node --import tsx --test qa/v6/scenarios/V6-08/navigation.test.mjs`（12/12，`v6-08-regression.log`）；`npm run test:v6 -- V6-17`（37/37，`v6-17-ticket.log`）。

## 架构审计修正轮（2026-11-10，结构项；未改样式）

### 1. 渲染错误边界

- 新增 `apps/web/src/v6/components/ErrorBoundary.tsx`：class 组件，`getDerivedStateFromError` 记录错误，`componentDidCatch` 保留 `console.error`，不吞错误。
- 回退界面：中文说明、`重试`（清空错误重渲染）、`返回案件列表`（`/v6/matters`）、`<details>` 折叠技术详情（message、stack、组件栈）。
- 包裹位置：`V6App` 页面区域（`resetKey=pathname`）和 `SelfService` 每个向导步骤（`resetKey=matterId/step/questionIndex`）；外壳与步骤栏保持可用。
- 新增 `qa/v6/scenarios/alignment-self/error-boundary.test.mjs`（3 项，静态渲染回退文案/链接/折叠详情与 `getDerivedStateFromError`）。

### 2. 路由级懒加载

- `V6App.tsx` 改为 `React.lazy + Suspense`（骨架屏 `route-skeleton`）：`SelfService`、`ProfessionalWorkbench`、`AiPage`、`InboxPage`、`MattersFeaturePage`、`ActivityFeedPage`、`SettingsPage` 均为动态 import；新增 `routes/SettingsPage.tsx` 承载设置（`Recovery` 随之拆出）。`AppearanceProvider` 因需包裹全站而保留主 chunk。
- 构建产物确认：`index.html` 只加载 `index-*.js`；`V6App-*.js` 内为 `import("./SelfService-…js")` 等 7 个动态 import，没有 modulepreload 懒加载块。
- 体积对比（`npm run build -w @patent/web`，原始/gzip）：

| 产物 | 改前 | 改后 |
|---|---:|---:|
| V6App | 804.88 kB / 228.61 kB | **136.28 kB / 39.81 kB** |
| V6App CSS | 29.75 kB | 22.14 kB（SelfService CSS 7.61 kB 拆出） |
| SelfService | —（在 V6App 内） | 28.44 kB / 9.43 kB |
| Workbench | — | 101.61 kB / 27.56 kB |
| SettingsPage | — | 52.03 kB / 14.99 kB |
| Ai / Inbox / Matters / ActivityFeed | — | 22.83 / 17.63 / 10.43 / 17.29 kB |
| 共享异步块 Intake / revision / fixtures / matters | — | 373.52 / 6.49 / 36.36 / 10.97 kB |
| assembly（按需） | 440.07 kB / 182.29 kB | 7.59 kB + patentpack 432.49 kB / 179.02 kB |
| pdf.min（按需） | 531.78 kB | 531.78 kB（不变） |
| 旧版 index（未改） | 515.18 kB | 515.22 kB |

- 说明：`Intake-*.js` 是 SelfService/Workbench 共用的异步块（含共享依赖），同样只在进入相关页面时加载；`assembly` 与 `patentpack` 仍为导出时按需块。

### 3. 删除 `TAB_CAPABILITIES`

- 从 `routes/navigation.ts` 删除未被生产代码引用的 `TAB_CAPABILITIES`；`GLOBAL_NAV` 仍带各自 capability。
- `qa/v6/scenarios/V6-08/navigation.test.mjs` 原本导入该常量断言 capability 原因，已最小改为只校验 `GLOBAL_NAV` 的 capability（其余断言不变），并在测试内注明删除原因。

### 4. CI workflow：未新增（阻塞如实记录）

- 核查结果：工作树内 `package-lock.json` **没有** `@patent/vibscanner-core`（workspace 清单/lock 均无该名），所以不是那个 404。
- 实际阻塞：`npm ci --dry-run --ignore-scripts` 在依赖同步检查即失败：
  `npm error code EUSAGE` / ``npm error `npm ci` can only install packages when your package.json and package-lock.json ...`` / `Missing: @patent/contracts@0.0.1 from lock file`（两次）。lock 的 workspace 条目缺 `packages/contracts`。
- 结论：按指示不新增 `.github/workflows/ci.yml`，不修改共享 `package-lock.json`、不绕过。需要先由负责依赖的人重新生成 lock（并确认无 `@patent/vibscanner-core` 依赖）后，CI 才能按 Node 22 + `npm ci` 运行。
- 补充事实：当前测试文件直接 import `.ts`，本机 Node 25 靠原生 type stripping；Node 22 需在 CI 设置 `NODE_OPTIONS=--experimental-strip-types`（22.6+）才能运行 `node --test`/runner。
- `qa/v6/runner.mjs` 只接受单个 ticket（`V6-\d{2,}[a-z]?`），不支持“全部 scenario”，也发现不了 `alignment-*` 目录；若要在 CI 跑全量，需要循环目录或扩展 runner。另外 runner 把 `cancelled > 0` 判为失败，因此 V6-09 的 3 个取消项会直接让全量 job 变红（见下节），必须先处理或显式标注。

### 5. V6-09 三个取消项说明（未静默跳过）

- 实测 `node --test qa/v6/scenarios/V6-09/appearance.test.mjs`：21 tests，18 pass，**3 cancelledByParent**。
- 取消项是 headless Chrome describe 中三个浏览器用例（A01 跨导航保留偏好、A02 失败保存保留/放弃、A02 unmount 恢复文档属性）；它们的父 suite 在 `before` 钩子失败：`esbuild` 以 browser platform 打包 `lifecycle-app.tsx` 时无法解析 `packages/pipeline/src/runner.ts` 的 `node:fs/promises`、`node:path`，`failureType: hookFailed`，三个子测试因父级失败被取消（非 skip、非通过）。
- 这是既有测试脚手架的浏览器打包限制，不是本轮删除/跳过；日志留在 `qa/v6/scenarios/alignment-self/v6-09-check.log`。若在 CI 启用全量 scenario，应将其作为可见失败处理（修复方向：给 lifecycle fixture 的 V6App 打包配置 external/alias，或改用 Vite 构建 fixture），不能屏蔽。

### 本轮验证

- `npm run typecheck -w @patent/web`：exit 0（`qa/v6/scenarios/alignment-self/typecheck.log`）
- `npm run build -w @patent/web`：exit 0（`build-after-lazy.log` / 改前 `build-before-lazy.log`）
- `node --test qa/v6/scenarios/V6-08/navigation.test.mjs`：12/12（`v6-08-regression.log`）
- `node --import tsx --test qa/v6/scenarios/alignment-self/navigation.test.mjs qa/v6/scenarios/alignment-self/error-boundary.test.mjs`：6/6（`navigation.test.log`）

## CI 与全量 scenario 轮（2026-11-10，Lead 放开授权）

### 1. lockfile

- 在代理下运行 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`（HTTPS_PROXY/HTTP_PROXY=`http://127.0.0.1:7897`），`node_modules` 软链未动。
- `package-lock.json` 只增加 14 行：`node_modules/@patent/contracts` 链接与 `packages/contracts` 工作区条目；没有版本漂移。
- `npm ci --dry-run --ignore-scripts`：exit 0（`/tmp/v6-npm-ci-dryrun2.log`）。

### 2. runner `--all`

- `qa/v6/runner.mjs`：新增 `--all`，发现 `qa/v6/scenarios` 下所有含 `*.test.mjs` 的目录（含 `alignment-*`），逐目录运行并打印 `tests/pass/fail/cancelled/skipped`，汇总总数与 PASS/FAIL 列表，任何目录失败则整体 exit 1。单 ticket 用法与严格零 skip 规则不变（`V6-08` 单跑 12/12）。
- Node 22：`runNodeTests` 在 Node 22 下自动追加 `--experimental-strip-types`（Node 23+ 不加）；`typeStrippingArgs('22.14.0')` 已验证返回该参数。
- `--all` 对显式 skip 容忍（仅用于无 Chrome 的环境门禁用例），但逐目录仍打印 `skipped=N`，并单列「显式 skip：V6-09=3（原因见 # SKIP 行）」；单 ticket 仍拒绝 skip。
- `qa/v6/scenarios/V6-02/runner.test.mjs` 通过。

### 3. V6-09 fixture

- esbuild 插件：`node:fs/promises`、`node:path` 空 shim（仅 fixture 使用，不改 `packages/pipeline` 运行时代码）；新增 `?raw` 文本插件，按 Vite 语义把规则 JSON 以文本注入，修复 `JSON.parse([object Object])`。
- Chrome 发现：`CHROME_PATH` 优先，其次 macOS / Linux（含 `/opt/google/chrome/chrome`）常见路径。
- 无 Chrome 时三个生命周期用例逐个 `it(name, { skip: reason })`：TAP 显示 `# SKIP 未找到 Chrome（…）`，汇总 `tests=21 pass=18 skipped=3`，并打印中文原因与数量；不再整组消失或静默通过。
- 本机有 Chrome：`node --test qa/v6/scenarios/V6-09/appearance.test.mjs` → 21/21 通过（日志 `v6-09-check.log`）；模拟无 Chrome（`CHROME_PATH=/nonexistent-chrome`）→ 18 pass / 3 skipped（`v6-09-skip-check.log`）。
- 另将夹具中过时的侧栏选择器（`全局导航` 下的设置链接）改为直接按 `href` 选择，适配当前侧栏结构。

### 4. CI workflow

- 新增 `.github/workflows/ci.yml`：`push` 与 `pull_request`，`ubuntu-latest`，Node 22（setup-node cache npm），`npm ci` → `npm run typecheck` → `npm run build -w @patent/web` → `npm run test:v6 -- --all` → `npm test -w packages/export`；job 级 `NODE_OPTIONS=--experimental-strip-types`（导出测试也直接 import `.ts`）。

### 5. 本机全量 `--all` 结果（快照，工作树同时在改）

- 29 个场景目录，`tests=635 pass=634 fail=1 cancelled=0 skipped=0`（有 Chrome，日志 `runner-all-final.log`）。
- 唯一失败：`alignment-workbench` 的 `inbox separates selection, reading and resolution states`（`ui.test.mjs:147`）——收件箱新布局不再使用测试断言的 `v6-inbox-layout` 类，属于协作方进行中的呈现层改动，未改断言、未改其代码（工作树同时有未提交的 Workbench/UI 变更）。
- 过程中曾出现随后被协作者修复的临时失败（V6-20 的 `◇`/AI 标签、V6-22/V6-23/alignment-runtime 的 `React is not defined`、alignment-workbench 的旧 `TestOutputNotice` 路径），最终快照均已通过。期间唯一由本轮修复的是 `alignment-self`：`.tsx` 导入改为先 `tsx/esm/api register()` 再动态 import（Node 直接跑目录时不再 `ERR_UNKNOWN_FILE_EXTENSION`）。
- `npm run typecheck`（根，全 workspace）exit 0；`npm test -w packages/export` exit 0（44 通过）；`npm run build -w @patent/web` exit 0（`build-ci-round.log`）。
- Node 22 实测（`npx -y node@22`，v22.23.4）：`node qa/v6/runner.mjs V6-08` 12/12；`node qa/v6/runner.mjs --all` 与 Node 25 相同（635 tests / 634 pass / 1 fail，唯一失败 alignment-workbench）；证明 runner 的 `--experimental-strip-types` 分支和 tsx 注册在 Node 22 可用。日志：`runner-node22-v608.log`、`runner-all-node22.log`。
- 复核：`npm ci --dry-run --ignore-scripts` exit 0（`npm-ci-dryrun.log`）；`node_modules` 仍是主仓库软链。

## 自助页面按原型重建（2026-11-10，kit 后）

### 结构

- 向导外壳改为原型结构：`Toolbar`（返回、标题、副标题、右侧「第 N 步，共 5 步」）+ `.wizard > .wiz-rail + .wiz-main > .wiz-card`；左栏含 5 个 `.wiz-step`（done/cur）与 `.wr-case`「正在准备 + 案件名 + 路线」；删除横向步骤条和外层大卡片。
- upload：`.wiz-h1/.wiz-sub`、`.dropzone`（上传图标 + 三行说明）、`.filerow` 列表（真实保存进度、状态 tag、移除）、保密 `callout.info`（本机保存不上传）、同页 `Parse`、`.extract` 三格（真实段落/事实/待补数）、`.wiz-foot`；无文档入口保留，主按钮在保存后为「回答问题」。
- questions：`.q-wrap`、`.q-prog`、`.q-meta`、`.q-title`（完整问句）、`.q-help`、`.q-src` 来源条；来源 `<select>` 降为次要控件；选择题 `.optgrid .optcard`；发明人按姓名卡片+输入；公开细节可编辑；`.q-nav`。
- route：`.route-grid` 四张 `.route-card`（保护对象 + 审查/周期，推荐角标、规则提示 tag）、`.route-extra` 能力范围与外语种提示、公开历史 `callout.warn`、真实 `.costsum`（官费按提交日标准 / 服务费未开放 / 本机测试生成或需专业人员）、人员按姓名 `.optcard` 放下方、`.wiz-foot`。
- generate：仅外壳 + `GenerationPanel`（runtime 面板自带标题/阶段/测试输出 callout），页脚提供上一步与采纳后「查看材料」；`onAdopted` 刷新守卫仍保留。
- preview/done：外壳 + `PreviewWorkspace` / `DeliveryWorkspace confirmationMode="self_read"`，页脚衔接上一步/继续导出/返回预览/专业工作台；测试输出 callout 全部交给 runtime 面板，本 worker 不再重复渲染。
- start：`Toolbar` + `.start-intro`（图标、品牌小字、大标题、说明）+ `.entry` 三张 `.entry-card`（图标、标题、描述、分隔线下 meta、箭头入口）+ `.recent` AI 说明条 + `.start-bottom` + 真实能力 callout。
- services/pricing/billing：`Toolbar + Body/Pane`；services 三张 `.svc-card` 与 `.svc-flow`（全部「暂未开放」，无报价/按钮）；pricing 三张 `.price-card` 但价格显示「未定价」，未来套餐按钮禁用；billing 使用原型卡片/`kv` 版式，只显示真实 ¥0、未开启、未开放。
- 公共/自助外壳去掉了重复的顶栏（原型只有页面 toolbar）；专业壳保持 kit 侧栏。`createSelfServiceMatter`、守卫、URL、所有业务调用未改。

### data-testid 变化（供 tester）

- 保留：`start-page`、`entry-self/pro/service`、`self-service`、`self-upload-step`、`upload-dropzone/input/rows/row-*/status-*/remove-*/problems/batch-error/all-saved/save/cancel`、`answer-without-documents`、`self-questions-step`、`self-question-error`、`self-route-step`、`self-route-<route>`、`self-route-error`、`self-route-disclosure-warning`、`self-generation`、`self-view-draft`、`self-preview-step`、`self-done-step`、`section-services/pricing/billing`。
- 新增：`upload-continue`（无待保存文件时的主按钮）、`upload-extract`、`self-service-loading/unavailable/error`、`service-<key>`、`price-<key>`。
- 移除（改为 runtime 面板自带）：`self-preview-test-output`、`self-preview-test-guidance`、`self-done-test-output`、`self-done-test-guidance`、`self-test-output-label`。
- 行为变化：`upload-save` 只在有未保存文件时出现（此前始终渲染但禁用）；无待保存文件时用 `upload-continue`。

### 验证

- `npm run typecheck -w @patent/web` exit 0（`typecheck-rebuild.log`）；`npm run build -w @patent/web` exit 0（`build-rebuild.log`）。
- `node --test qa/v6/scenarios/V6-08/navigation.test.mjs` 12/12（`v6-08-rebuild.log`）；`alignment-self` 6/6（`alignment-self-rebuild.log`）。
- 浏览器结构 smoke（本地 Vite + headless Chrome，`visual-smoke.mjs`）：start 3 entry、upload rail 5/横向步骤 0/dropzone/保密 callout、questions `.q-wrap` + 5 段进度、route 4 卡 + `.route-extra`、generate 面板挂载、services/pricing/billing toolbar 正确；console errors 为空。截图：`qa/v6/scenarios/alignment-self/shots/self-{start,upload,questions,route,generate,services,pricing,billing}-light.png`（本机系统深色，截图实际为深色），日志 `visual-smoke.log`。

### 测试输出提示核对（Preview `showTestOutputNotice`）

- 自助预览外层已不再渲染 `TestOutputNotice`（上一轮已移除），`PreviewWorkspace` 使用默认 `showTestOutputNotice=true`，因此预览页恰好由 runtime 面板显示一次；不需要传 `false`。
- 完成页：`DeliveryWorkspace` 在 `data.testOutput` 时渲染 `delivery-test-output-label`，其内部 `Done` 在 `state.testOutput` 时又渲染 `done-test-output-label`；两份文件都在 runtime 写集，当前可能存在两条同义提示。本 worker 未改 runtime 文件；建议 runtime 在 `WorkspaceProps` 增加抑制标记或只保留 Done 一条。自助页不再添加第三条。
- 若后续在向导外壳重新加入测试输出 callout，则预览应传 `showTestOutputNotice={false}`；目前不传。

## round-3 自助外壳返修（2026-11-10）

- preview / done 改为整页（不再渲染 `.wiz-rail`）：
  - preview：`Toolbar`（标题「材料预览」，副标题「路线 · 草稿修订」，右侧按钮：风险与建议（badge=blocker+risk 数，打开 `Sheet` 列出全部 risk findings）、修改材料、进入专业草稿、主按钮「下载材料」→ done）+ `.body > .pane.wide`。直接渲染 runtime `Preview`，传 `hideActions` 与 `onModifyMaterials`/`onOpenDraft` 外层回调；`risks` 由 `loadWorkspace` 读取后同时供 badge/Sheet 和 Preview 使用。测试输出仍由 Preview 显示一次。
  - done：`Toolbar`（「材料已生成 / 准备下载」，右侧「返回预览」「回到首页」）+ `.body > .pane.narrow` + `DeliveryWorkspace self_read`；无向导左栏。
  - 前置守卫、`requiredSelfServiceStep`、URL 行为均未改。
- start：补上 kit 遗漏的 `.start-bottom` 规则（display:flex/gap 14px，来自原型 polish.css），并把 `self-service.css` 提前到 `V6App` 引入，保证首页（非 SelfService chunk）也加载该规则；现在「查看套餐 / 说明 / 设置」分行有间距。
- questions：来源改为 `.q-src` 条右侧「更改来源」链接，点开才显示 `select`；选择后收起，不再整行占位。
- 预览页右侧页边批注有重叠（runtime Preview 的 `.doc-aside` 在宽 pane 下的绝对定位）；属 runtime 呈现层，未改。
- 验证：typecheck/build exit 0；V6-08 12/12；alignment-self 6/6。1440×900 浅色截图：`qa/v6/scenarios/alignment-self/shots/self-{start,preview,preview-risks,done}-light.png`，smoke 日志 `visual-smoke.log`（console errors 为空）；preview 无 `.wiz-rail`、pane wide、toolbar 按钮与风险 Sheet 均实测。

## 限制与未完成项

- 没有真实浏览器实测（上传→问答→路线→生成→预览→确认→下载；无文档路径；390px 和键盘焦点）；按分工由独立 executor tester 复核，不以 typecheck/构建代替。
- `Dist/` 等构建产物未提交；工作树未提交、未部署。
- 自助生成第 4 步依赖 runtime worker 的 `allowTestAdoption`：当前 stub 可采纳为带 `testOutput` 标记的修订；若该接口回退，向导会保留任务结果但无法采纳，并显示真实错误。
- 首页搜索只匹配导航名和本机案件标题，不伪造全局全文搜索；分类计数未加，因为现有数据源没有可靠的批次/计数语义。
- 预览与完成步骤的测试提示文字只在持久 `testOutput` 为 true 时替换为「测试输出」；未标记的真实修订只显示中性指引，不冒称测试或正式能力。

## 验收映射（自助侧）

- A01：首页三入口、`/v6` 无专业侧栏、创建真实空案件。
- A02：无文档只在无材料且未选文件时进入自助问答，不跳专业事实页。
- A03：上传面板真实保存、解析面板真实进度与恢复。
- A04：逐题保存、回退、reload 恢复答案/来源，公开与成熟度由人选择。
- A05：按姓名添加/选择发明人、四张路线卡，无 ID 输入。
- A06：深链缺前置回对应步骤，不自动补写。
- A07–A09：本机测试生成、采纳持久修订、独立预览与 `self_read` 通读。
- A19：服务/套餐/账单为真实范围与未开放说明，无假支付/假回执。
- A21：全部链接经 `v6Path` 构造，不硬编码 `/patent`。
