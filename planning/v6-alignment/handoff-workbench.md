# Workbench alignment handoff

## 已完成

- Native 明暗主题改用原型的系统字体、灰底和蓝色令牌；维持其他主题，并在 V6 样式范围内使用紧凑工具栏、6/10px 圆角和清晰焦点环。
- 专业工作台采用紧凑标题栏和横向标签。概览显示目标表、中文可执行下一步；目标设置折叠显示，单纯查看目标不写入数据。
- 草稿页把编辑器和逐段支持/确认放在同页双栏；确认状态来自既有确认账本并传回编辑器。审阅标签改为“客户审阅（R3）”，说明该能力尚未开放。
- 动态支持 `currentMatterId=""` 跨案件筛选。案件列表、目标路线、下一步、人员和时间使用中文；内部编号放入详情。收件箱改为列表/详情双栏，单独呈现已读与已解决状态。
- AI 与数据页按本机、平台和自带密钥展示实际能力，并单列本地测试处理说明；保留真实外发门关闭状态。页面导航使用 V6 路由构造器，不再使用固定 `/patent` 链接。
- 设置按外观、通知、数据与隐私、旧版入口分组。
- `DraftRevision.testOutput` 为 `true` 时，编辑器、预览和专业工作台显示“测试输出，仅用于验证流程，不能作为正式申请材料”。工作台标记从持久化修订派生，刷新后仍可识别。
- 目标配置改用人员姓名勾选和本案证据材料选择；实际保存仍走原有业务校验。
- 同页刷新接线：`DraftEditor` 新增 `onSaved`（只在真实保存成功后触发）与 `refreshToken`（重读 head，未保存缓冲保留并进入冲突合并视图）。工作台在保存后刷新确认面板。
- 生成接线：工作台把 `onAdopted` 传给 `GenerationPanel`，采纳成功后同时刷新确认面板并让编辑器重读新 head。空状态生成按钮不再派发无人监听事件：有生成面板时显示“查看生成面板”并滚动/聚焦真实面板；没有面板时按钮禁用并说明可先手工撰写。
- 预览接线：无回调时“重新生成/采纳新输入/生成草稿”改为前往同案同目标的草稿页真实路由，不再派发无人监听事件。编辑器“预览/导出此修订”无回调时禁用并提示到交付页。
- 附图首绑：目标已指向第一版图集 id 但尚无图集行时，材料页仍为图库中的每张图渲染“编入图集”；以该目标自带的 id 为 base 创建第一版图集，不改业务校验、不自动加入图。
- 390px 横向溢出（验收 run-8）：在 `v6.css` 内统一处理，未改 checks/delivery 组件。≤700px 时按钮允许换行，`row/row-between` 换行，宽表格改为自身横向滚动容器，`.kv` 改为单列，输入框限宽；草稿审阅面板在 ≤920px 恢复横向滚动以容纳 620px 来源表；长 ID、错误码与 `pre` 在壳内任意换行。390px 注入式测量 documentWidth 均为 390（普通卡片、草稿双栏结构、交付卡+文件行）。

## 主要文件

- `apps/web/src/v6/styles/theme.css`
- `apps/web/src/v6/routes/v6.css`
- `apps/web/src/v6/features/workbench/Workbench.tsx`
- `apps/web/src/v6/features/workbench/workbench.ts`
- `apps/web/src/v6/features/workbench/ActivityFeed.tsx`
- `apps/web/src/v6/features/workbench/TestOutputNotice.tsx`
- `apps/web/src/v6/features/sources/Figures.tsx`（首绑入口）
- `apps/web/src/v6/features/{matters/Matters.tsx,inbox/Inbox.tsx,ai/Ai.tsx,settings/Appearance.tsx,targets/Targets.tsx,draft/Editor.tsx,preview/Preview.tsx}`

## 验证

- `npm --prefix <worktree> run typecheck -w apps/web`：通过。日志：`qa/v6/scenarios/alignment-workbench/typecheck.log`
- `npm --prefix <worktree> run test:v6 -- V6-13`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-13.log`
- `npm --prefix <worktree> run test:v6 -- V6-14`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-14.log`
- `npm --prefix <worktree> run test:v6 -- V6-15`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-15.log`
- `npm --prefix <worktree> run test:v6 -- V6-17`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-17.log`
- `npm --prefix <worktree> run test:v6 -- V6-12`：42/42 通过。日志：`qa/v6/scenarios/alignment-workbench/V6-12.log`
- 新增 `figures-unbound.test.mjs`：2/2 通过，覆盖无图集行时仍显示编入入口、首绑以目标自带 id 为 base 创建第一版。日志：`qa/v6/scenarios/alignment-workbench/figures-unbound.log`
- `npm --prefix <worktree> run test:v6 -- V6-18`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-18.log`
- `npm --prefix <worktree> run test:v6 -- V6-20`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-20.log`
- `npm --prefix <worktree> run test:v6 -- V6-21`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-21.log`
- `npm --prefix <worktree> run test:v6 -- V6-22`：通过。日志：`qa/v6/scenarios/alignment-workbench/V6-22.log`
- 新增 `ui.test.mjs`、`test-output.test.mjs`、`wiring.test.mjs` 场景：9/9 通过。其中 `wiring.test.mjs` 覆盖空状态不再派发无人监听事件、预览空状态走真实草稿路由、采纳新 head 后刷新仍保留未保存缓冲。日志：`qa/v6/scenarios/alignment-workbench/ui-tests.log`、`wiring-tests.log`
- `npm --prefix <worktree> run build -w apps/web`：通过；构建提示一个大于 500 kB 的 chunk。日志：`qa/v6/scenarios/alignment-workbench/build.log`
- 390px 宽度探针（注入卡片/草稿双栏/交付文件行 + 长 ID/表格/按钮到真实 `/patent/v6` 壳）：documentWidth 390，无页面级溢出。日志：`qa/v6/scenarios/alignment-workbench/mobile-width-probe-stress.log`、`mobile-width-probe-draft-deliver.log`
- `npm --prefix <worktree> run test:v6 -- V6-09`：未通过完整套件。17 个纯逻辑用例通过；3 个 headless Chrome 生命周期用例被取消。esbuild 无法解析 `packages/pipeline/src/runner.ts` 的 `node:fs/promises` 与 `node:path`，浏览器测试包未能构建。日志：`qa/v6/scenarios/alignment-workbench/V6-09.log`。
- 基线复现：在干净 `e9723cc` 临时工作树（软链 node_modules）运行同一命令，得到相同结果（18 pass / 0 fail / 3 cancelled，同样的 esbuild 解析错误）。日志：`qa/v6/scenarios/alignment-workbench/V6-09-baseline.log`。据此判定为既存测试环境问题，不是本轮改动引起；本轮不补 shim，不改 `packages/pipeline`。
- `git diff --check`：通过。

## 验收边界

这轮完成了类型检查与组件/领域回归，没有实测真实浏览器的 390px 布局、键盘焦点流程、Safari/Firefox 或截图；按总验收安排由独立浏览器验收继续复核。没有部署或提交。
