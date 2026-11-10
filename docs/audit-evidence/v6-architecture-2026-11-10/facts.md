# v6 架构事实清单

- 快照：`codex/v6-prototype-alignment`，HEAD `4682697`；审计目标为本工作树根目录。
- 行数统计口径：`apps/web/src` 下 `.ts/.tsx` 物理行，旧版排除 `src/v6`；inline style 按文本 `style={{` 计数。导入边按静态 `from` / `import()` specifier 计数。
- 执行的构建：`npm run build -w @patent/web`，退出码 0；`tsc --noEmit` 通过；Vite 输出 2243 modules transformed。完整输出：`/tmp/patent-v6-audit-build.log`。未安装依赖、未运行测试。

## 1. 仓库与 workspace

| 路径 | 职责事实 | 入口/依据 |
|---|---|---|
| `apps/web` | React/Vite 浏览器应用；构建脚本含 TypeScript 检查及 Vite build。 | `apps/web/package.json:2-10`；入口 `apps/web/src/main.tsx:1-10` |
| `apps/worker` | Worker 路由静态资源及 API；`src/index.ts` 定义 `fetch`，代理配置的模型 upstream。 | `apps/worker/package.json:1-7`；`apps/worker/src/index.ts:242-264,324-342` |
| `apps/bridge` | Rust loopback runtime，包含 pairing、凭据接口和 DeepSeek provider。 | 无 npm manifest；`apps/bridge/Cargo.toml:1-22`；`apps/bridge/src/api.rs:31-32` |
| `packages/audit` | 检查注册表与类型。 | `packages/audit/src/index.ts:1-2` |
| `packages/contracts` | primitives、matter、draft、jobs、delivery、records、billing、privacy、fixtures 的契约导出。 | `packages/contracts/src/index.ts:1-9` |
| `packages/domain` | 通用类型及 v6 revision、confirmation、gate、checks。 | `packages/domain/src/index.ts:1-6` |
| `packages/export` | ZIP、DOCX、图、PDF、patentpack、notes、assembly 导出。 | `packages/export/src/index.ts:1-9` |
| `packages/parsers` | parser types、文本 normalize、输入 guard。 | `packages/parsers/src/index.ts:1-4` |
| `packages/pipeline` | 阶段、runner、mock、schemas。 | `packages/pipeline/src/index.ts:1-5` |
| `packages/providers` | provider types、LLM interface、DeepSeek bridge、mock、Codex local provider。 | `packages/providers/src/index.ts:1-5` |
| `packages/shared` | result、ID、hash、versioning、assert helpers。 | `packages/shared/src/index.ts:1-5` |
| `packages/prompts`, `packages/rules-cn` | 内容目录；没有各自 `package.json`。规则 JSON 被 v6 rule pack 导入。 | `apps/web/src/v6/features/checks/rule-pack.vite.ts:1-6` |

根 workspace 声明 `apps/*`、`packages/*`，脚本含 `build`、`typecheck`、`test:v6`（`package.json:5-13`）。manifest 内部依赖图：`@patent/web → @patent/export, @patent/pipeline, @patent/providers`；`@patent/pipeline → @patent/audit, @patent/domain, @patent/providers, @patent/shared`；其余 workspace manifest 未声明 `@patent/*` 依赖（各 package manifest 的 `dependencies`）。

`apps/web/src/v6` 对包的实际引用：

| 目标 | 方式、导入声明数 | 导入文件 |
|---|---|---|
| `contracts` | 相对路径 27 次 | `features/ai/ai.ts`; `features/checks/Checks.tsx`; `features/delivery/{Approval.tsx,Workspace.tsx,export-adapter.ts}`; `features/draft/{Editor.tsx,Review.tsx,ast-adapter.ts}`; `features/generation/generation.ts`; `features/intake/{Intake.tsx,intake.ts}`; `features/preview/{Preview.tsx,preview.ts}`; `features/recovery/recovery.ts`; `features/self-service/{QuestionsStep.tsx,RouteStep.tsx,persistence.ts}`; `features/sources/drawings.ts`; `features/targets/targets.ts`; `features/workbench/workbench.ts` |
| `domain` | 相对路径 25 次，`@patent/domain` 3 次 | 相对路径：`features/checks/{Checks.tsx,rule-pack.ts,rule-pack.vite.ts}`; `features/delivery/{Approval.tsx,Workspace.tsx,export-adapter.ts}`; `features/draft/Review.tsx`; `features/generation/generation.ts`; `features/intake/intake.ts`; `features/preview/preview.ts`; `features/workbench/{Workbench.tsx,workbench.ts}`。包名导入：`features/generation/generation.ts`; `features/workbench/Workbench.tsx`; `lib/pipeline-adapter.ts` |
| `export` | 相对路径 2 次 | `features/delivery/export-adapter.ts`; `features/recovery/recovery.ts` |
| `parsers` | 相对路径 1 次 | `features/sources/parse.ts` |
| `pipeline` | `@patent/pipeline` 2 次 | `features/generation/generation.ts`; `lib/pipeline-adapter.ts` |
| `providers` | `@patent/providers` 2 次 | `features/generation/generation.ts`; `lib/pipeline-adapter.ts` |
| `rules-cn` | 相对路径导入 raw JSON 5 次 | `features/checks/rule-pack.vite.ts` |

`audit`、`shared`、`prompts` 没有被 `apps/web/src/v6` 直接导入。v6 对 `contracts`、`export`、`parsers`、rule JSON 使用 `../../../../../../packages/...` 形式的源码相对路径；没有使用对应的 `@patent/contracts`、`@patent/export`、`@patent/parsers` 包名导入。

## 2. 旧版与 v6

- `App.tsx` 将旧版页面和 `/v6/*` 放在同一 `BrowserRouter` 内；整个路由树外层仍有 `StoreProvider`。`/v6/*` 默认启用，只有 `VITE_V6_ENABLED=false` 才移除；`V6App` 通过 `lazy(() => import(...))` 加载（`apps/web/src/App.tsx:14-60`）。
- v6 自己在 `V6App.tsx` 打开 IndexedDB 并创建 `LocalRepository`（`apps/web/src/v6/routes/V6App.tsx:44-67,93-109`）。旧版模块中，v6 直接复用 `apps/web/src/lib/extract.ts` 与 `apps/web/src/lib/export-render.ts`；旧版与 v6 共同按包名导入 `@patent/pipeline`、`@patent/domain`、`@patent/providers`（静态导入扫描；旧版引用见 `apps/web/src/lib/pipeline.ts`）。
- 物理行数：旧版 `apps/web/src`（排除 `v6`）4,110 行；v6 `apps/web/src/v6` 38,540 行；均只计 `.ts/.tsx`。
- 同一次默认构建同时输出旧版入口和 v6 路由 chunk。根入口动态导入 v6；构建产物包含 `index-*.js`、`V6App-*.js`、`assembly-*.js`、PDF.js chunk（构建表见第 7 节）。

## 3. v6 文件规模与 UI/业务逻辑

各目录 `.ts/.tsx` 物理行数：

| 目录 | 行数 | 目录 | 行数 |
|---|---:|---|---:|
| `features/ai` | 3,705 | `features/checks` | 421 |
| `features/delivery` | 2,966 | `features/draft` | 2,309 |
| `features/generation` | 2,855 | `features/inbox` | 699 |
| `features/intake` | 3,810 | `features/matters` | 897 |
| `features/preview` | 970 | `features/recovery` | 2,610 |
| `features/self-service` | 1,008 | `features/settings` | 261 |
| `features/sources` | 7,561 | `features/targets` | 2,870 |
| `features/workbench` | 1,158 | `components` | 125 |
| `lib` | 3,439 | `routes` | 626 |
| `styles` | 250 | **合计** | **38,540** |

超过 800 行文件：`features/ai/Ai.tsx` 1,024；`features/ai/ai.ts` 2,681；`features/delivery/Approval.tsx` 969；`features/delivery/export-adapter.ts` 1,308；`features/draft/Editor.tsx` 1,042；`features/draft/Review.tsx` 912；`features/generation/generation.ts` 2,307；`features/intake/Intake.tsx` 1,381；`features/intake/intake.ts` 2,429；`features/recovery/recovery.ts` 2,272；`features/sources/drawings.ts` 2,111；`features/sources/ingest.ts` 1,629；`features/sources/parse.ts` 2,249；`features/targets/Targets.tsx` 840；`features/targets/targets.ts` 2,030；`lib/legacy-import.ts` 1,527；`lib/repository.ts` 1,102。

UI 与业务文件有配对，例如 `features/intake/Intake.tsx` / `intake.ts`、`features/targets/Targets.tsx` / `targets.ts`、`features/generation/Generation.tsx` / `generation.ts`。同一 TSX 文件也包含业务访问：`delivery/Workspace.tsx` 定义 `loadWorkspace`、`persistCheckRun` 并包含 React view；`delivery/Approval.tsx` 定义 `ApprovalSession` 并包含 view；`draft/Editor.tsx` 定义 `IndexedDbDraftBufferStore` 并包含 editor view（对应代码：`Workspace.tsx:107-120,149-240`；`Approval.tsx:216-264`；`Editor.tsx:108-160`）。

`style={{` 共 98 处：`ai/Ai.tsx` 8；`checks/Checks.tsx` 4；`delivery/Approval.tsx` 3、`Done.tsx` 7；`draft/Editor.tsx` 10、`Review.tsx` 2；`generation/Generation.tsx` 2；`inbox/Inbox.tsx` 6；`intake/Intake.tsx` 29；`preview/Preview.tsx` 12；`sources/Parse.tsx` 1、`Upload.tsx` 2；`targets/Targets.tsx` 6；`workbench/ActivityFeed.tsx` 3、`Workbench.tsx` 3。

## 4. 持久化与事务

IndexedDB 名为 `patent.v6.local`，版本 1；store 为 `matters`、`events`、`blobs`。初始化在 `indexeddb-repository.ts:23-24,93-105`；声明在 `repository.ts:41-46`。每个后端事务覆盖这三个 store；异常时 adapter 尝试 abort 并等待结束（`indexeddb-repository.ts:107-149`）。

主要 blob key 构造前缀及所有者：

| 前缀 | 使用 feature / 读写对象 |
|---|---|
| `ai/consent/`, `ai/idempotency/` | `features/ai/ai.ts`：授权行及幂等记录；key 构造 `ai.ts:824-835` |
| `checks/run/` | `features/delivery/Workspace.tsx`：检查快照元数据行；`Workspace.tsx:76-77,107-120,229-239` |
| `draft-review/confirmations/`, `delivery/approvals/`, `delivery/exports/` | `features/delivery/{Approval.tsx,Workspace.tsx,export-adapter.ts}`、`features/draft/Review.tsx`、`features/preview/preview.ts`、`lib/repository.ts`；构造位置 `Approval.tsx:134-139`、`export-adapter.ts:232-239,318-320`、`Review.tsx:801-802`、`preview.ts:551-556`、`repository.ts:1087-1089` |
| `preview/confirmations/` | `features/preview/preview.ts` 的旧确认账本 key；`preview.ts:555-556` |
| `generation/{tenant}/{user}/{job\|index\|revision\|revisions}/`、同命名空间内 `pipeline-cache/` | `features/generation/generation.ts`；owner 前缀与 scope `generation.ts:340-377`，缓存 `475-477`，行 key `769-783` |
| `draft-editor/{tenant}/{user}/active/`, `draft-editor/{tenant}/{user}/buffer/` | `features/draft/Editor.tsx` 未保存编辑缓冲；`Editor.tsx:108-160` |
| `inbox/cursor/` | `features/inbox/inbox.ts` 已读游标；`inbox.ts:471-472` |
| `intake/snapshot/`, `intake/candidates/`, `intake/drafts/`, `intake/idempotency/` | `features/intake/intake.ts`；`intake.ts:307-333`。`features/targets/targets.ts:584-585` 也读取 `intake/snapshot/` |
| `targets/config/`, `targets/idempotency/` | `features/targets/targets.ts`；`targets.ts:593-600,1081-1088` |
| `recovery/validation/`, `recovery/commit/` | `features/recovery/recovery.ts`；`recovery.ts:418-424` |
| `parse/source/`, `parse/chunks/`, `parse/job/`, `parse/checkpoint/` | `features/sources/parse.ts`；`parse.ts:445-466`；恢复导入也写 parse source/chunks（`features/recovery/recovery.ts:328-337,1946-1970`） |
| `drawings/`, `figures/` | `features/sources/drawings.ts`；`drawings.ts:822-830`；恢复导入也写入（`features/recovery/recovery.ts:330-331,1740-1806`） |
| `generation/revision/`, `generation/revisions/`（恢复包行格式） | `features/recovery/recovery.ts:332-333,2254-2262` |
| 无命名空间的 `assetId` | `LocalRepository` 与恢复导入以 asset ID 为 blobs store key；`lib/repository.ts:674-685`、`features/recovery/recovery.ts:1493` |

同一逻辑数据的多处记录：

- 确认账本既有 canonical `draft-review/confirmations/`，也有 legacy `preview/confirmations/`；`preview.ts` 同时读两者、按 ID 合并，并将 legacy 内容写入 canonical key，代码未删除 legacy row（`preview.ts:430-478,481-510`）。
- 确认、批准的账本行之外还写入 `events` store 的 activity 事件。`writeConfirmationLedger` 同事务写 matter、event、ledger（`repository.ts:803-815`）；批准写入在 `Approval.tsx:373-384,430-440`。
- 当前草稿修订 ID 存在 `matters` aggregate 的 target 上；generation store 另存 revision row 与 revisions index（`repository.ts:253-275`；`generation.ts:484-486,769-783`）。
- `StoredCheckRun` blob 行只含 `kind/tenantId/actorId/matterId/targetId/snapshot/rulePackVersion/createdAt`，检查 findings 由 `runChecks` 重新生成（`Workspace.tsx:65-74,229-240`）。

所有 IndexedDB 访问经过 `StorageBackend.transaction`；特性代码中有 80 处直接调用 `repository.backend.transaction`（包括只读与读写）：

| 文件（相对 `apps/web/src/v6`） | 直接调用行 |
|---|---|
| `features/ai/ai.ts` | 863, 1315, 1390, 1442, 1479, 1508, 1810, 1860, 1914 |
| `features/delivery/Approval.tsx` | 321, 406, 465 |
| `features/delivery/Workspace.tsx` | 119, 229, 312 |
| `features/delivery/export-adapter.ts` | 390, 411, 542, 590, 1048, 1078, 1085, 1105, 1160, 1268 |
| `features/draft/Editor.tsx` | 552 |
| `features/draft/Review.tsx` | 165, 225, 277, 334 |
| `features/generation/generation.ts` | 825 |
| `features/inbox/inbox.ts` | 476, 511 |
| `features/intake/intake.ts` | 529, 624, 715, 772, 800, 834, 861, 973, 1003, 2393, 2422 |
| `features/matters/matters.ts` | 199 |
| `features/preview/preview.ts` | 334, 422, 488 |
| `features/recovery/recovery.ts` | 439, 556, 1218, 1259, 1364, 1432, 1465, 1524, 2254 |
| `features/sources/drawings.ts` | 1118, 1139, 1171, 1259, 1581, 1606, 1625, 1941 |
| `features/sources/parse.ts` | 534, 678, 693, 1741, 1759, 1996, 2135 |
| `features/targets/targets.ts` | 552, 640, 1157, 1212, 1255, 1292, 1321, 1450 |

`LocalRepository.commit` 在写事务内比较 expectedVersion（`lib/repository.ts:594-634`）；`writeConfirmationLedger` 也在写事务内比较并递增 matter version（`lib/repository.ts:735-816`）。`ApprovalSession` 直接 backend transaction，但在事务内比较预读版本与存储版本（`features/delivery/Approval.tsx:316-325,401-411`）。`persistCheckRun` 直接写 derived row，调用处未传/比较 matter expectedVersion（`features/delivery/Workspace.tsx:107-120`）。

## 5. Feature 间导入与循环

以下为 feature 文件之间静态相对导入声明数；未列出的有向边为 0。

| 来源 | 目标及声明数 |
|---|---|
| delivery | checks 2；generation 3；intake 1；preview 3；sources 4；targets 1 |
| draft | generation 2；sources 2；targets 1；workbench 1 |
| generation | ai 2；targets 1 |
| inbox | matters 1 |
| intake | sources 1 |
| preview | generation 1；workbench 1 |
| self-service | checks 1；delivery 1；generation 3；intake 6；sources 3；targets 2；workbench 1 |
| workbench | delivery 1；draft 3；generation 2；intake 1；matters 2；sources 3；targets 1 |

`madge` 未安装。基于相对导入解析得到两个 feature 级循环：`workbench → draft → workbench`（`Workbench.tsx:6`；`Editor.tsx` 导入 `../workbench/TestOutputNotice.tsx`）；`delivery → preview → workbench → delivery`（`Approval.tsx:27`；`Preview.tsx:15`；`Workbench.tsx:15`）。

## 6. 页面加载与刷新

| 页面/功能 | 代码位置 | 刷新间隔事实 |
|---|---|---|
| Workbench | `features/workbench/Workbench.tsx:91-105` | mount、focus 加载；每 15 秒检查一次，数据超过 60 秒时 refresh（`29-30` 定义阈值） |
| Activity feed | `features/workbench/ActivityFeed.tsx:42-51` | mount 加载；每 15 秒检查，超过 60 秒 refresh（`14-15`） |
| Inbox | `features/inbox/Inbox.tsx:41-51` | mount 加载；每 15 秒检查，超过 60 秒 refresh（`16-17`） |
| Matters | `features/matters/Matters.tsx:53-71` | route/focus 加载；每 15 秒检查 `shouldRefreshMatterRows`，stale 阈值 60 秒（`features/matters/matters.ts:17,538`） |
| Generation | `features/generation/Generation.tsx:425-436` | `pollMs` 可传入；默认 2,000 ms，最小 250 ms |
| Parse lease | `features/sources/parse.ts:2116` | lease renew timer 使用调用方传入的 `intervalMs`，不是页面数据轮询 |

v6 由 `V6App` 打开一个 repository 并通过 props 传给页面（`routes/V6App.tsx:44-67,101-107`）；各 feature 调用 repository 读数据。依赖清单没有 React Query/TanStack Query。`features/delivery/Workspace.tsx` 有 2 个 `loadMatter` 调用点：`162`、`299`。

## 7. 构建与代码分块

构建命令输出（Vite 6.4.3，2243 modules）：

| 输出文件 | 原始大小 | gzip |
|---|---:|---:|
| `index-DdwQeOia.css` | 24.34 kB | 4.95 kB |
| `V6App-Dd_d3BLB.css` | 29.75 kB | 6.08 kB |
| `index-DabEqRur.js` | 1.13 kB | 0.62 kB |
| `assembly-WtiKGJlv.js` | 440.07 kB | 182.29 kB |
| `index-CSfi5VGD.js` | 515.18 kB | 162.56 kB |
| `pdf.min-C5rkUzaZ.js` | 531.78 kB | 160.74 kB |
| `V6App-Jo2gWttY.js` | 804.13 kB | 228.38 kB |
| `pdf.worker.min-CLrFZWeq.mjs` | 1,312.45 kB | 构建输出未打印 |

最大 Rollup app chunk 是 `V6App-Jo2gWttY.js`（804.13 kB）；最大 emitted JS/MJS asset 是 PDF worker（1,312.45 kB）。Vite 对大于 500 kB 的 minified chunk 输出 warning。V6App 直接静态导入 Shell、Recovery、AI、Workbench、ActivityFeed、SelfService、rule pack、Matters、Inbox、repository（`routes/V6App.tsx:11-23`）；`Workbench.tsx:4-15` 静态导入 intake、draft、generation、sources、targets、delivery UI。构建输出未提供 chunk 内模块清单。

路由级只有整个 `/v6/*` 的 `V6App` 动态 import；v6 子页面在 `V6App.tsx` 静态导入（`App.tsx:19,47-55`；`V6App.tsx:11-23`）。

## 8. 测试、浏览器与 CI

`qa/v6/scenarios` 有 29 个目录、52 个 `.test.mjs` 文件；静态 `test()` / `it()` 声明合计 627 个。每目录计数：

| 目录 | 文件数 | 声明数 | 目录 | 文件数 | 声明数 |
|---|---:|---:|---|---:|---:|
| V6-02 | 1 | 13 | V6-03 | 1 | 14 |
| V6-04 | 1 | 16 | V6-05 | 1 | 26 |
| V6-06 | 1 | 25 | V6-07 | 1 | 32 |
| V6-08 | 1 | 12 | V6-09 | 1 | 21 |
| V6-10 | 2 | 36 | V6-11 | 2 | 45 |
| V6-12 | 3 | 42 | V6-13 | 2 | 45 |
| V6-14 | 4 | 41 | V6-15 | 3 | 41 |
| V6-16 | 1 | 15 | V6-17 | 4 | 39 |
| V6-18 | 1 | 10 | V6-19 | 1 | 16 |
| V6-20 | 1 | 9 | V6-21 | 7 | 29 |
| V6-22 | 1 | 15 | V6-23 | 1 | 12 |
| V6-24 | 1 | 6 | V6-25 | 2 | 22 |
| V6-26 | 1 | 18 | V6-47a | 1 | 5 |
| alignment-runtime | 1 | 8 | alignment-self | 1 | 3 |
| alignment-workbench | 4 | 11 |  |  |  |

20 个测试文件调用 `react-dom/server` 的 `renderToStaticMarkup`；测试依赖解析未发现 `jsdom`、`happy-dom`、`@testing-library/react`、`playwright` 或 `playwright-core`。`qa/v6/runner.mjs` 通过 Node `--test` 执行选定 scenario；入口为 `npm run test:v6 -- V6-xx`（`package.json:13`；`qa/v6/runner.mjs:157-189,218-225`）。

浏览器证据脚本为 `qa/v6/evidence/V6-*/browser-drive.mjs`；例如 `V6-08/browser-drive.mjs:1` 用法为 `node drive.mjs <outDir> <baseUrl>`，脚本通过 Chrome DevTools Protocol 驱动 headless Chrome，Chrome 路径在脚本中写为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`（`V6-08/browser-drive.mjs:8-24`）。脚本要求已运行的 web server/base URL；根 npm scripts 没有 browser-drive 命令。

`git ls-files '.github/workflows/**'` 无输出；目标工作树没有 tracked GitHub Actions workflow。

## 9. Zod 契约与存储读取

`packages/contracts/src/delivery.ts` 定义 `checkRunSchema`、`approvalSchema`（`44-57`）；`draft.ts` 定义 `draftAstSchema`、`previewSchema`、`confirmationSchema`、`revocationSchema`（`68,206,252-283`）。存储读取存在逐项验证与类型断言两种路径：

- Delivery approvals/confirmations 读取会按 item 调用 `approvalSchema.parse`、`confirmationSchema.parse`、`revocationSchema.parse`（`features/delivery/Approval.tsx:168-197`）。
- Checks 从 blob 读取后断言 `as Partial<StoredCheckRun>`，再做字段条件检查；`snapshot` 直接断言为 `SnapshotRef` 后传给 `isCurrent`，未调用 `checkRunSchema.parse`（`features/delivery/Workspace.tsx:229-240`）。
- Export row 经 kind、归属、state、files、manifest 的结构条件检查后直接 `as unknown as StoredExportRow`（`features/delivery/export-adapter.ts:379-395`）。
- Preview 输出由 `previewSchema.parse` 校验（`features/preview/preview.ts:97`）；读取 confirmation ledger 时逐项 `safeParse`，无法解析的 confirmation/revocation 被过滤掉（`preview.ts:460-478`）。
- Repository aggregate 读取以 `isRecord`、数组检查后 `as unknown as StoredAggregate`；blob row 也以局部字段检查后断言为 `StoredBlob`（`lib/repository.ts:1058-1073`）。

## 10. CSP、网络与密钥

`apps/web/public/_headers:1-12` 的 CSP 为：

```text
default-src 'self'; base-uri 'self'; connect-src 'self' http://127.0.0.1:7878 ws://127.0.0.1:7878; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' blob: data:; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:
```

- 旧版浏览器 bridge 调用同源 Worker API 或本机 `127.0.0.1:7878`；`fetch` 位于 `apps/web/src/lib/bridge.ts:8-12,46,92,129,150`。v6 feature 源码中未匹配到 `fetch`、XHR、WebSocket 或 `sendBeacon` 调用。
- Worker 以 `DEEPSEEK_API_KEY` 环境字段向 `DEEPSEEK_BASE_URL`（默认 `https://opencode.ai/zen/go/v1`）发 bearer 请求（`apps/worker/src/index.ts:29-30,242-264`）。
- Bridge 从 CredentialStore 读取 key 并使用 reqwest bearer auth；macOS store 使用系统 Keychain（`apps/bridge/src/provider.rs:46-77`；`apps/bridge/src/credentials.rs:2,14-17`）。`bridge.ts:1-3` 说明浏览器不持有 DeepSeek API key。
- v6 AI profile 为 synthetic processor，`credentialRef` 为 null（`features/ai/ai.ts:115-205`）。
- `git grep` 对 `dangerouslySetInnerHTML` 在 `apps/web/src`、`apps/worker/src`、`apps/bridge/src` 无命中。

## 11. 错误处理

`apps/web/src` 未匹配到 `ErrorBoundary`、`componentDidCatch` 或 `getDerivedStateFromError`。

- `preview.ts:487-510` 的 legacy confirmation ledger migration 在 catch 后返回 `false`。
- `features/settings/Appearance.tsx:33-48` 捕获 `localStorage` / `matchMedia` 访问错误并返回 `null`。
- `features/ai/ai.ts:862-866` 捕获 blobs 读取失败并返回 `STORAGE_UNAVAILABLE` 结果；`features/delivery/Workspace.tsx:282-287` 捕获加载失败并设置面向用户的错误消息。

## 12. 架构文档声明与代码位置对照

文档路径未另注时相对当前工作树；“主仓库”指 `/Users/jared/Personal Projects/Patent` checkout。主仓库 `docs/architecture.md:11-12` 将后续旧蓝图标注为历史设计；工作树自身 `docs/architecture.md` 没有该免责声明。

| 文档声明 | 代码事实 |
|---|---|
| 工作树 `docs/architecture.md:13-26,67-70` 描述 Dexie 只存 UI 状态、正文由 Bridge Vault 持有；`101` 写 TanStack Router。 | v6 在浏览器 IndexedDB `patent.v6.local` 保存 matters/events/blobs（`apps/web/src/v6/lib/indexeddb-repository.ts:23-24,93-105`）；应用使用 `react-router-dom`（`apps/web/src/App.tsx:2,24`）。主仓库 `docs/architecture.md:11-12` 已把蓝图范围标为历史；工作树副本未同步这段说明。 |
| 主仓库 `docs/implementation/patent-saas-v6/01-architecture.md:12-17,24-32` 规划 `apps/api`、`apps/jobs`、PostgreSQL/S3、`packages/contracts/src/v6`；该文档自称目标架构（`1-3,21`）。 | 当前 `apps/` 为 `bridge/web/worker`；没有 `api/jobs`；contracts 源文件在 `packages/contracts/src/` 顶层（`git ls-files`、`packages/contracts/src/index.ts:1-9`）。 |
| `01-architecture.md:12,17,60` 规定唯一 application mutation 入口及 UI→application client→contracts 依赖方向。 | v6 feature 有 80 处直接 `repository.backend.transaction`（第 4 节位置表）；contracts 多处由 `../../../../../../packages/...` 源码相对路径导入（第 1 节）。 |
| 主仓库 `docs/implementation/patent-saas-v6/04-existing-system.md:29` 记载根脚本无 root patent test；`06-execution-protocol.md:25` 称 `npm run test:v6 -- V6-xx` 是目标接口、当前不存在。 | 当前根 `package.json:13` 已声明 `"test:v6": "node qa/v6/runner.mjs"`；runner 存在于 `qa/v6/runner.mjs`。 |
| 主仓库 `docs/implementation/patent-saas-v6/04-existing-system.md:8,19-25` 记载旧 store localStorage、v6 IndexedDB，以及 api/jobs、用户/支付/服务订单尚不存在。 | `App.tsx:23-24,47-60` 仍将旧 `StoreProvider` 包在共同路由外；v6 路由自行打开 IndexedDB（`v6/routes/V6App.tsx:44-67`）；当前 apps 清单无 api/jobs。上述存储分层与“不存在”记录对应当前文件结构。 |
