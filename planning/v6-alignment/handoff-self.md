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
